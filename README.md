# Housefi backend

API for the Housefi app (customers book home-service technicians; technicians receive and complete jobs).
The contract, product rules and build plan are in [`docs/`](docs/README.md), copied from the app team's handoff.
`docs/openapi.yaml` is the source of truth for every request and response.

## Status

Build steps 1-3 of 14 (`docs/STARTER-PROMPT.md`) are done:

1. Scaffold: config, logging, errors, security headers, CORS, rate limiting, health checks.
2. Auth: `POST /v1/auth/otp/request`, `/otp/verify`, `/refresh`, `/logout` for customers and technicians.
3. Users and catalog: `GET/PATCH/DELETE /v1/me`; `GET /v1/catalog/categories`, `/catalog/services`,
   `/catalog/services/{id}`, seeded from the app's catalog.

Next is **step 4**: addresses and slots.

## Run it locally

Needs Node.js 22+ and Docker.

```bash
npm install
npm run setup               # creates .env and generates local secrets (JWT keys, peppers, data key)
docker compose up -d        # Postgres 16 + PostGIS, Redis 7, S3Mock
npm run db:deploy           # apply migrations
npm run db:seed             # load the catalog (safe to repeat)
npm run dev                 # http://localhost:4000/v1/health
```

Sign in locally: `POST /v1/auth/otp/request` with `{ "phone": "9876543210", "role": "CUSTOMER" }`, then read the
6-digit code from the server log (`SMS_PROVIDER=console` prints it instead of sending an SMS), and send it to
`POST /v1/auth/otp/verify` with the `challengeId`.

The API starts even when Postgres or Redis are down: `GET /v1/health` stays 200 and `GET /v1/health/ready` returns
503 with which dependency is missing. Rate limits fail open while Redis is down (and say so in the log, once a
minute); the per-phone OTP limits live in Postgres and always apply.

| Command | What it does |
| --- | --- |
| `npm run setup` | Create `.env` and fill blank local secrets (never overwrites existing values) |
| `npm run dev` | Start with reload, pretty logs |
| `npm test` | Unit + e2e tests against a real PostgreSQL: `DATABASE_URL_TEST` if set, otherwise an embedded PostgreSQL 16 (no Docker needed) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` then `npm start` | Production build in `dist/` |
| `npm run db:migrate` / `npm run db:deploy` | Create a migration (development) / apply migrations |
| `npm run db:seed` | Load `catalog.data.json` into the database; idempotent, run it on every deploy after `db:deploy` |
| `npm run catalog:import` | Re-import the catalog from the app's `catalog.ts` (default `docs/app-contract/catalog.ts`) into `catalog.data.json` |

## Auth in short

- **Sign-in codes:** 6 digits, valid 5 minutes, single use. Stored only as an HMAC with a pepper.
  - The 3rd wrong guess locks the code. Every guess is counted atomically before it is checked, so parallel
    guesses cannot get extra tries.
  - Resend after 30 s, and the new code replaces the old one.
  - At most 5 codes per phone per hour (across both roles), plus per-IP limits.
- **Accounts:** one per role per phone, so a phone can have a customer account and a technician account. Phone
  numbers are stored encrypted (AES-256-GCM envelope, local key in development, AWS KMS in production), plus an
  HMAC column for lookups.
- **Access tokens:** EdDSA (Ed25519) JWTs, valid 15 minutes, carrying `sub`, `role` and `sid`. A global guard
  requires one on every route not marked `@Public()`. `@Roles(...)` limits routes by role; other roles get
  `NOT_FOUND`.
- **Refresh tokens:** 256-bit random values, stored only as an HMAC, valid 30 days.
  - Every refresh issues a new token and retires the old one.
  - Presenting a retired token revokes that whole session (the "family" of tokens), so a copied token stops
    working for both the thief and the owner.
  - Logout revokes the session.

## Layout

```
src/
  main.ts                 starts the server (loads .env in development only)
  http.ts                 Fastify adapter, request ids, helmet, CORS: shared by main.ts and the e2e tests
  app.module.ts           wires modules, the global error filter and the global guards (rate limit, then auth)
  config/                 env schema (zod); fails fast listing bad variable names, never values
  common/
    errors/               AppError, contract error codes, global filter -> { error: { code, message, requestId } }
    validation/           ZodValidationPipe -> VALIDATION with fields { name: REQUIRED | INVALID }
    logging/              pino options with PII redaction; Nest logs go through the same logger
    rate-limit/           Redis fixed-window limits: @RateLimit / @SkipRateLimit, RateLimitService for custom keys
    crypto/               FieldCipher (AES-256-GCM envelope; local key or KMS), Hashing (HMAC: phone, OTP, tokens)
    clock.ts              injectable clock (tests move time)
    redis/ prisma/        shared clients
    http/                 request id
  modules/
    auth/                 OTP challenges, SMS senders (console / MSG91), sessions (refresh rotation), EdDSA access
                          tokens, global AuthGuard with @Public / @Roles / @CurrentUser
    catalog/              public catalog endpoints, catalog.data.json (imported from the app), idempotent seed
    users/                GET/PATCH/DELETE /me (delete = anonymise); maps a user to the API's Customer shape
    health/               GET /v1/health (liveness), GET /v1/health/ready (database + Redis)
  cli/seed.ts             npm run db:seed
  common/money.ts         paise <-> whole rupees (refuses fractions)
prisma/                   schema.prisma + committed migrations (models arrive feature by feature, from docs/schema.sql)
scripts/                  setup.mjs (local secrets), test.mjs (test database + Jest), import-catalog.mjs
test/                     e2e tests and helpers (test clock, fake SMS, database reset)
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

## Decisions taken in step 2

- **JWTs on `node:crypto`, no JWT library:** about 60 lines in `access-tokens.ts`, accepting EdDSA only. This
  removes the classic algorithm-confusion bugs and one dependency.
- **Access tokens are stateless:** logout and reuse detection kill the refresh token at once, but an access token
  already issued keeps working until it expires (at most 15 minutes).
- **Per-phone OTP limits are counted in Postgres, not Redis:** they hold even during a Redis outage, and a Postgres
  advisory lock per phone stops parallel requests from slipping past them.
- **Development secrets are required:** the server refuses to start without them, and `npm run setup` generates
  them once. Changing them later would make local encrypted data unreadable.
- **Embedded PostgreSQL 16 for tests when no database is given**, so `npm test` works without Docker. CI uses its
  PostGIS service instead.
- **PostGIS is not enabled yet:** no table needs it until addresses (step 4).
- **Added env var `SMS_PROVIDER`** (`console` | `msg91`; production requires `msg91`).

## Decisions taken in step 3

- **The catalog is imported, not hand-copied.** `npm run catalog:import` evaluates the app's `catalog.ts` in an
  isolated VM (no `require`, no `process`) and writes `catalog.data.json`, which is committed and reviewed like
  code. `npm run db:seed` loads it. When the app team changes the catalog, re-run both.
- **Removed services are deactivated, never deleted**, because bookings will keep pointing at them. Re-adding a
  service reactivates it.
- **The typical maximum is 4 × `repairFrom`**, as the starter prompt says. It is stored but never sent to the app.
- **`/me` works for both roles** with the `Customer` shape (`id`, `phone`, `name`). Technicians need it for
  their language. See QUESTIONS.md #12.
- **Deleting an account anonymises the row instead of removing it:** the name goes, the phone ciphertext is wiped,
  and the phone hash is replaced with random bytes. Every session ends, and the number can sign up again as a
  brand-new account. Later steps add their own anonymisation (addresses, bookings).
