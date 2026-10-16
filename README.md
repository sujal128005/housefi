# Housefi backend

API for the Housefi app (customers book home-service technicians; technicians receive and complete jobs).
The contract, product rules and build plan are in [`docs/`](docs/README.md), copied from the app team's handoff.
`docs/openapi.yaml` is the source of truth for every request and response.

## Status

Build step 1 of 14 (`docs/STARTER-PROMPT.md`) is done: scaffold, config, logging, errors, security headers, CORS,
rate limiting, health checks. No business endpoints yet; next is **step 2, auth** (OTP, JWT, refresh tokens).

## Run it locally

Needs Node.js 22+ and Docker.

```bash
cp .env.example .env
docker compose up -d        # Postgres 16 + PostGIS, Redis 7, S3Mock
npm install
npm run dev                 # http://localhost:4000/v1/health
```

The API starts even when Postgres or Redis are down: `GET /v1/health` stays 200 and `GET /v1/health/ready` returns
503 with which dependency is missing. Rate limits fail open while Redis is down (and say so in the log).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with reload, pretty logs |
| `npm test` | Unit tests (`src/**/*.spec.ts`) and e2e tests (`test/**/*.e2e-spec.ts`) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` then `npm start` | Production build in `dist/` |
| `npm run db:migrate` | Create and apply a Prisma migration (from step 2 on) |

## Layout

```
src/
  main.ts                 starts the server (loads .env in development only)
  http.ts                 Fastify adapter, request ids, helmet, CORS: shared by main.ts and the e2e tests
  app.module.ts           wires modules, the global error filter and the global rate-limit guard
  config/                 env schema (zod); fails fast listing bad variable names, never values
  common/
    errors/               AppError, contract error codes, global filter -> { error: { code, message, requestId } }
    validation/           ZodValidationPipe -> VALIDATION with fields { name: REQUIRED | INVALID }
    logging/              pino options with PII redaction; Nest logs go through the same logger
    rate-limit/           Redis fixed-window limits: @RateLimit / @SkipRateLimit, RateLimitService for per-phone limits
    redis/ prisma/        shared clients
    http/                 request id
  modules/health/         GET /v1/health (liveness), GET /v1/health/ready (database + Redis)
prisma/schema.prisma      models arrive feature by feature, following docs/schema.sql
test/                     e2e tests
docs/                     the app team's handoff + QUESTIONS.md, API-NOTES.md, LATER.md
```

## Conventions for new code

- Throw `new AppError('CONFLICT')` (codes in `src/common/errors/error-codes.ts`); never return error bodies by hand.
- Validate every body, query and param with a Zod schema matching `openapi.yaml`: `@Body(new ZodValidationPipe(Schema))`.
- Never log request bodies, phone numbers, addresses, codes or tokens. Log ids and error codes.
- Every non-public endpoint checks role and ownership; other people's data is `NOT_FOUND`.
- Money: paise (`BigInt`) in the database, whole rupees in the API. Timestamps: epoch ms in the API.

## Decisions taken in step 1

- **Jest + SWC** for tests (SWC emits the decorator metadata Nest needs; Vitest's default esbuild does not).
- **TypeScript 6**, matching the app (typescript-eslint does not support TypeScript 7 yet).
- **Security overrides in `package.json`:** Nest 11 pins Fastify 5.11.3, which has high-severity advisories, so
  `overrides` forces one patched Fastify (5.12.7) everywhere (two copies would also break types and Fastify's own
  instance checks). `deepmerge-ts` (inside Prisma 6's config loader) is overridden to 8.0.2 for the same reason.
  Drop both overrides when moving to Nest 12 / Prisma 7.
- **S3Mock instead of MinIO** for local S3: the official MinIO images are no longer published on Docker Hub.
- **Unexpected errors return code `INTERNAL` (500)**, which `openapi.yaml` does not list yet; see `docs/QUESTIONS.md`.
- Added env vars `TRUST_PROXY`, `LOG_LEVEL`, `RATE_LIMIT_PER_MIN` (documented in `.env.example`).
