# Travel Planning and Booking Platform

Software Project I (Winter 2026), GIU. Backend: NestJS + MongoDB Atlas. Frontend (Milestone 2): Next.js.

## Run the backend

1. `cd backend`
2. `npm install`
3. Create `backend/.env` by copying `.env.example` from the repo root and filling in the real values.
   Get the MongoDB link from the team leader privately. Never commit `.env`.
4. `npm run start:dev`
5. Open:
   - API health check: http://localhost:3000/api/health (should say `"database": "connected"`)
   - Swagger docs: http://localhost:3000/api/docs

## Demo login

The admin account is created automatically on the first start from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env`.
Admins cannot register through the API.

## Login and sessions (how auth works)

- `POST /api/auth/register` needs `acceptTerms: true`. Passwords: at least 8 characters with at least one letter and one digit.
- `POST /api/auth/login` sets two httpOnly cookies: `access_token` (15 minutes) and `refresh_token`.
  In Swagger, just log in once; the cookies are sent automatically.
- `POST /api/auth/refresh` gives a new access token. A session with no authenticated request for **30 minutes** ends.
- `POST /api/auth/logout` clears the cookies and revokes the session on the server.
- Moderators created by an admin, and accounts reset by an admin, get `mustChangePassword: true`.
  Until they call `PATCH /api/auth/change-password`, every other logged-in route answers 403.
- `DELETE /api/users/me` is refused (409) while the user has upcoming confirmed bookings.

## Using auth in your module (read this before writing a controller)

Every route **requires login by default**. You do not need to add any guard yourself.

```ts
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { Role, ProviderType } from '../common/enums/role.enum';
import { assertOwnerOrAdmin, assertManagesProvider } from '../common/utils/ownership';

@Public()                                   // guests allowed (searches, public posts)
@Get('search') search() {}

@Get('mine')                                // any logged-in user
mine(@CurrentUser() user: AuthUser) { /* user.id, user.role */ }

@Roles(Role.ADMIN)                          // admins only
@Get('all') all() {}

@Roles(Role.HOTEL_MODERATOR, Role.ADMIN)    // moderators of THIS hotel, or admins
@Patch(':id') async update(@Param('id') id: string, @CurrentUser() user: AuthUser) {
  assertManagesProvider(user, ProviderType.HOTEL, id);
}

// After loading a user-owned record (booking, itinerary, post, comment):
assertOwnerOrAdmin(user, booking.user);     // 403 if it is not theirs
```

- Use `import type { AuthUser }` (with the word `type`) in controllers, or the build fails.
- Need user data in your service? Import `UsersModule` and inject `UsersService`.
- Add `@ApiCookieAuth('access_token')` on protected controllers so Swagger shows the lock.
- In Swagger: call `POST /api/auth/login` once; the cookie is sent automatically after that.

## Project structure

```
backend/src/
  main.ts                 global setup: /api prefix, cookies, CORS, validation, error filter, Swagger
  app.module.ts           loads .env, connects to MongoDB, registers feature modules
  app.controller.ts       GET /api/health
  config/env.validation.ts   checks required .env values at startup
  common/filters/all-exceptions.filter.ts   one error shape for every error
  common/dto/pagination-query.dto.ts        page/limit/sortBy/order for list endpoints
  common/enums/role.enum.ts                 Role, AccountStatus, ProviderType
  common/decorators/                        @Public(), @Roles(), @CurrentUser()
  common/guards/                            JwtAuthGuard + RolesGuard (applied to every route)
  common/utils/ownership.ts                 assertOwnerOrAdmin(), assertManagesProvider()
  config/auth.constants.ts                  password rules, lockout limits (check against the Excel sheet)
  auth/                                     register, login, logout, me, change-password
  users/                                    User schema, /api/users/me, admin seeding
  hotels/                                   hotels, policies, rooms, blocked dates, availability, hotel search
  hotel-bookings/                           multi-room bookings with holds, cancellation + refunds, reservations
```

## Hotels and hotel booking (Member 4)

Dates: `checkIn` is the first night and `checkOut` is the day you leave, both hotel local dates
(`2026-12-01` -> `2026-12-04` = 3 nights). Date ranges (bookable ranges, blocks) work the same way:
`from` = first night, `to` = first night NOT included. All prices are USD (`config/platform.constants.ts`).
Rules (10-minute hold, default tiers) are in `hotels/hotel.constants.ts`.

**Moderator setup for a bookable room:** `POST /api/hotels/:id/rooms`, then
`POST /api/hotels/:id/rooms/:roomId/availability` with `{ from, to }`. A room without a bookable range
never shows up in search.

**Using it from your module**

| Who | Call | What it does |
| --- | --- | --- |
| Payments (Member 6) | `hotelBookings.getForPayment(user, id)` | `{ bookingType: 'hotel', bookingId, user, amount, currency: 'USD', holdExpiresAt }` |
| Payments (Member 6) | `hotelBookings.confirm(id, paymentIntentId)` | Webhook only. Pending -> Confirmed. 409 if the 10-minute hold expired (then refund). Safe to retry. |
| Payments (Member 6) | `hotelBookings.markRefunded(id, refundId, failed?)` | After the Stripe refund: `refundStatus` pending -> refunded (or failed) |
| Payments (Member 6) | `GET /api/hotel-bookings/:id/refund-preview` | Refund on the full total from the hotel's tiers (HTL-21) |
| Reviews (Member 5) | `hotelBookings.getCompletedStay(user, bookingId)` | `{ hotelId }` only for the user's own **completed** reservation; 403 / 400 otherwise |
| Reviews (Member 5) | `hotels.setRating(hotelId, average, count)` | Updates the rating used by search and the details page |
| Reviews (Member 5) | collection `reviews` with fields `hotel`, `rating`, `comment`, `isHidden` | The hotel details page shows the 5 newest visible reviews |
| Admin (Member 1) | `hotels.exists(id)`, `hotels.setActive(id, false / true)` | ACC-13 provider check, ACC-15 deactivate / reactivate |
| Admin (Member 1) | `hotelBookings.listAll({ page, limit, skip, status, hotelId, userId, from, to })` | ACC-17 all hotel reservations |

Import `HotelsModule` / `HotelBookingsModule` to inject `HotelsService` / `HotelBookingsService`.

**Why double booking is impossible (HTL-18):** every taken night of a room (a confirmed reservation,
an unexpired hold or a block) is one `RoomNight` document with a unique index on `(room, date)`.
A reservation is saved together with all its nights in one MongoDB transaction, so if any room is
taken on any night the whole request is rolled back and nothing is held. Prove it on Atlas with
`node scripts/check-room-race.js` (20 parallel requests, exactly 1 succeeds).

## Git workflow

- `main`: graded, stable code. Only updated by PR from `develop`.
- `develop`: integration branch. Every feature is merged here by PR.
- Feature branches: `feature/<REQ-ID>-<short-name>`, e.g. `feature/ACC-01-user-registration`.
- Commits: `feat(auth): implement registration`, `fix(flights): ...`, `chore(core): ...`.

## Demo accounts

To be added after seeding.
