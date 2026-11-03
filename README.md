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

## Project structure

```
backend/src/
  main.ts                 global setup: /api prefix, cookies, CORS, validation, error filter, Swagger
  app.module.ts           loads .env, connects to MongoDB, registers feature modules
  app.controller.ts       GET /api/health
  config/env.validation.ts   checks required .env values at startup
  common/filters/all-exceptions.filter.ts   one error shape for every error
  common/dto/pagination-query.dto.ts        page/limit/sortBy/order for list endpoints
```

## Git workflow

- `main`: graded, stable code. Only updated by PR from `develop`.
- `develop`: integration branch. Every feature is merged here by PR.
- Feature branches: `feature/<REQ-ID>-<short-name>`, e.g. `feature/ACC-01-user-registration`.
- Commits: `feat(auth): implement registration`, `fix(flights): ...`, `chore(core): ...`.

## Demo accounts

To be added after seeding.
