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
```

## Git workflow

- `main`: graded, stable code. Only updated by PR from `develop`.
- `develop`: integration branch. Every feature is merged here by PR.
- Feature branches: `feature/<REQ-ID>-<short-name>`, e.g. `feature/ACC-01-user-registration`.
- Commits: `feat(auth): implement registration`, `fix(flights): ...`, `chore(core): ...`.

## Demo accounts

To be added after seeding.
