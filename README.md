# Housefi backend

API for the Housefi app (customers book home-service technicians; technicians receive and complete jobs).
The contract, product rules and build plan are in [`docs/`](docs/README.md), copied from the app team's handoff.
`docs/openapi.yaml` is the source of truth for every request and response.

## Status

Build steps 1-8 of 14 (`docs/STARTER-PROMPT.md`) are done:

1. Scaffold: config, logging, errors, security headers, CORS, rate limiting, health checks.
2. Auth: `POST /v1/auth/otp/request`, `/otp/verify`, `/refresh`, `/logout` for customers and technicians.
3. Users and catalog: `GET/PATCH/DELETE /v1/me`; `GET /v1/catalog/categories`, `/catalog/services`,
   `/catalog/services/{id}`, seeded from the app's catalog.
4. Addresses and slots: `GET/POST/PUT/DELETE /v1/addresses` (encrypted, PostGIS point) and `GET /v1/slots`.
5. Bookings: `POST /v1/bookings` (Idempotency-Key), `GET /v1/bookings[/{id}]`, `/cancel`, `/reschedule`,
   `/stream` (Server-Sent Events); timeline, slot holding, unpaid bookings cancelled after 30 minutes.
6. Payments: `POST /v1/bookings/{id}/payments` (Razorpay order, or cash for the bill), `POST /v1/payments/{id}/verify`,
   `POST /v1/webhooks/razorpay`; refunds, reconciliation, cash confirmation (service; endpoint with step 9).
7. Technicians: `GET /v1/tech/me`, `PUT /v1/tech/profile`, `POST /v1/tech/availability`, `POST /v1/tech/location`;
   verification with `npm run tech` (audited).
8. Dispatch: `GET /v1/tech/offers/current`, `POST /v1/tech/offers/{id}/accept|reject`, `GET /v1/tech/jobs[/{id}][/stream]`;
   sequential 45 s offers, ranking, still searching / none found, reassignment, offline after 3 misses.

Next is **step 9**: job actions (trip, arrival, start code, quotes and price check, work, cash, reports).

## Run it locally

Needs Node.js 22+. Docker is recommended (it matches production); without it, see "No Docker?" below.

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

**No Docker?** `npm run db:local` starts a local database with PostGIS (PGlite, data kept in `.data/pglite`)
and prints the `DATABASE_URL` to put in `.env`. Keep it running in its own terminal, then run `db:deploy`,
`db:seed` and `dev` as above. Redis is optional for local work (rate limits fail open). PGlite is PostgreSQL 18
with a single connection, so treat CI (PostgreSQL 16) as the authoritative check.

The API starts even when Postgres or Redis are down: `GET /v1/health` stays 200 and `GET /v1/health/ready` returns
503 with which dependency is missing. Rate limits fail open while Redis is down (and say so in the log, once a
minute); the per-phone OTP limits live in Postgres and always apply.

| Command | What it does |
| --- | --- |
| `npm run setup` | Create `.env` and fill blank local secrets (never overwrites existing values) |
| `npm run dev` | Start with reload, pretty logs |
| `npm test` | Unit + e2e tests against a real database: `DATABASE_URL_TEST` if set (CI: PostgreSQL 16 + PostGIS), otherwise an in-memory PGlite with PostGIS (no Docker needed) |
| `npm run db:local` | Local PGlite + PostGIS database for development without Docker |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` then `npm start` | Production build in `dist/` |
| `npm run db:migrate` / `npm run db:deploy` | Create a migration (development) / apply migrations |
| `npm run db:seed` | Load `catalog.data.json` into the database; idempotent, run it on every deploy after `db:deploy` |
| `npm run tech -- pending` / `approve <id\|phone>` / `correct <id\|phone> "<note>" ["<te>"]` | Review technician profiles (every decision goes to `audit_log`) |
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
    addresses/            saved addresses: encrypted house/street/landmark, PostGIS point, soft delete that wipes
    slots/                slot-rules.ts (IST windows, cutoff, 7 days) + per-area capacity and window holds
    bookings/             booking-status.ts (the state machine), job-view.ts (the technician's Job),
                          booking-core.ts (locks, transitions, reads, expiry;
                          shared with payments and later steps), service (create, cancel, reschedule),
                          booking-view.ts (rows -> API shape), booking-updates.ts (live-update bus), SSE stream
    payments/             Razorpay client + signatures, start / verify / settle, webhooks (deduplicated, redacted),
                          refunds (claimed, retried), reconciliation and cash confirmation; worker every minute
    technicians/          profile, availability, location; tech-verification.service.ts (approve / correct)
    dispatch/             ranking + offers, accept / reject, timers (DispatchWorker every 5 s), offers and jobs API
    health/               GET /v1/health (liveness), GET /v1/health/ready (database + Redis)
  common/audit/          append-only audit_log of privileged actions
  common/http/sse.ts     Server-Sent Events helper (booking and job streams)
  cli/seed.ts            npm run db:seed
  cli/technicians.ts     npm run tech (verification from the command line)
  common/money.ts         paise <-> whole rupees (refuses fractions)
prisma/                   schema.prisma + committed migrations (models arrive feature by feature, from docs/schema.sql)
scripts/                  setup.mjs (local secrets), test.mjs (test database + Jest), import-catalog.mjs,
                          pglite-server.mjs + local-db.mjs (PostGIS database without Docker)
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
- **A local test database when none is given**, so `npm test` works without Docker (since step 4 this is PGlite
  with PostGIS). CI uses its PostGIS service instead.
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

## Decisions taken in step 4

- **PostGIS from now on.** Addresses store a `geography(Point, 4326)`, written and read with raw SQL (Prisma treats
  the type as `Unsupported`). The migration runs `CREATE EXTENSION postgis`; on AWS RDS the migration user needs
  the `rds_superuser` role for that.
- **Local tests moved from embedded PostgreSQL to PGlite**, because the embedded build has no PostGIS. PGlite
  (pinned to the 0.5.8 release from August) runs PostGIS 3.6 on PostgreSQL 18, behind a socket server that allows
  one connection.
  - `scripts/pglite-server.mjs` works around two problems: shared prepared statements (fixed by Prisma's
    `pgbouncer=true` mode) and a pglite-socket bug where a client that vanishes keeps its connection slot forever.
  - Both are explained in that file. The bug is worth reporting upstream.
- **Times are India time.** Slot windows, the 60-minute cutoff and the 7 bookable days use IST whatever the
  server's time zone is.
- **Slot capacity is per category and PIN area:** `SLOT_CAPACITY_PER_WINDOW` by default, with per-PIN overrides in
  `slot_capacities`. `GET /slots` takes an optional `pincode` (an additive change). Bookings start counting
  against capacity in step 5.
- **Location is stored unencrypted** (needed for distance queries), like city and PIN code. House, street and
  landmark are encrypted. Deleting an address or the account wipes all of them, including the point.

## Decisions taken in step 5

- **One state machine.** `booking-status.ts` holds every transition from `STATE-MACHINE.md`. Each change runs
  under a row lock (`SELECT ... FOR UPDATE`), is checked against that table (anything else is `CONFLICT`), bumps
  `version` and writes a `booking_events` row, which is the timeline the app shows.
- **Idempotent create.** `Idempotency-Key` is unique per customer.
  - A retry with the same body returns the original booking.
  - A different body with the same key is `CONFLICT`.
  - Two identical requests at once still create one booking.
- **Slots are held safely.** Creating or rescheduling takes a per-window advisory lock, then counts the bookings
  holding that window. Three customers racing for the last place get one booking and two `SLOT_UNAVAILABLE`.
- **Unpaid expiry is a sweep, not a delayed job.** Every instance checks once a minute, re-checking each booking
  under its lock. Reads and actions also expire overdue bookings, so the app never sees one as still active.
  Nothing is lost on restart, and it doesn't need Redis. BullMQ comes in with dispatch, where 45-second offer
  timers need precision.
- **Live updates:** `GET /bookings/{id}/stream` sends the full booking at once and after every change, with a
  heartbeat every 25 s.
  - Changes are signalled through Redis pub/sub, so every instance hears them, or in-process when Redis is down.
  - The Redis path hasn't run yet (no Redis here); the in-process path is tested end to end.
- **Refunds are recorded, not sent:** cancelling a paid booking before the trip marks the visit fee `REFUNDED` and
  records the refund decision. No money can be taken yet; step 6 sends refunds to Razorpay.
- **Account deletion:** refused (`CONFLICT`) while a paid booking is in progress. Unpaid bookings are cancelled,
  and every booking is anonymised (address copy, notes, transcript, location), while codes, amounts and the
  timeline are kept.

## Payments: trying it with Razorpay test mode

Put your Razorpay **test** keys in `.env` (Dashboard -> Settings -> API Keys; webhook secret under Webhooks).
The config refuses live keys (`rzp_live_...`) outside production.

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Point a test-mode webhook at `https://<public-url>/v1/webhooks/razorpay` with the events `payment.authorized`,
`payment.captured`, `payment.failed`, `order.paid`, `refund.processed` and `refund.failed`. Locally, a tunnel
(e.g. ngrok) gives the public URL. Without keys, the payment endpoints answer `INTERNAL` ("payments not
configured"); everything else works.

## Decisions taken in step 6

- **Razorpay decides, not the app.**
  - A payment becomes `PAID` only after Razorpay says it is captured: on verify (after the signature check) we
    fetch the payment, and webhooks are signature-checked over the raw body.
  - `authorized` payments are captured by us.
  - A captured amount or currency that doesn't match is held as `PENDING` for review, never marked paid.
- **Every money path is idempotent.**
  - Starting a payment takes an `Idempotency-Key`. Reopening the sheet within 15 minutes reuses the same order.
  - Webhooks are processed once per event id.
  - Settling an already settled payment is a no-op.
  - Refunds are claimed before sending, so two workers can't both send one.
- **Late or double payments are refunded automatically:** a payment for a booking that was cancelled, expired or
  already paid is refunded in full (QUESTIONS.md #25).
- **Nothing gets stuck:**
  - A worker re-checks `PENDING` payments (bank confirming) every 10 minutes, as `STATE-MACHINE.md` asks.
  - It checks orders older than 15 minutes that never reported back, for when the app closed after paying.
  - It abandons orders with no payment after 24 hours.
  - An opened-then-abandoned checkout never blocks the unpaid expiry. An unpaid booking isn't expired while the
    customer has had the payment sheet open within the last 15 minutes.
- **Stored webhooks keep no payer details:** Razorpay includes the payer's email, phone and UPI id. Only ids,
  amounts and statuses are stored.
- **`booking-core.ts`:** locks, transitions, reads and expiry moved out of `BookingsService` so payments (and
  later dispatch and jobs) can move bookings without circular imports.
- **Cash:** the customer picks cash for the bill (`PENDING`, method `CASH`); `PaymentsService.confirmCash`
  completes the booking for the assigned technician. Its HTTP endpoint (`POST /tech/jobs/{id}/confirm-cash`)
  arrives with the technician job API (step 9), which defines the `Job` response.

## Decisions taken in step 7

- **Verification from the command line** (`npm run tech`), not an HTTP endpoint, until the admin portal exists.
  It adds no network attack surface, needs database access to run, and records who ran it (`cli:<os user>`) in
  `audit_log` with before and after. The portal will call the same `TechVerificationService` methods.
- **Only a `PENDING` profile can be decided.** A late decision can't override a resubmission (`CONFLICT`).
  Requesting a correction takes the technician offline.
- **Editing an approved profile sends it back to review.** It becomes `PENDING` and the technician goes offline,
  so skills or areas can't change unchecked. It is refused while on a job.
- **Location privacy:**
  - Only the latest point is stored, and only while online or on a job; anything else is accepted and dropped.
  - Going offline clears it.
  - The vehicle (with its registration number) is encrypted like other personal data.
- **`audit_log` exists from now on.** It is written in the same transaction as the change, and holds ids,
  statuses and decisions, but no personal data.
- **Bookings now reference technicians** with a foreign key, and account deletion covers technicians (refused
  while on a job; otherwise offline, with vehicle, areas and location wiped).
- **`npm run db:local` accepts several processes** (API, `npm run tech`, seed), with one connection each. Its
  query queue keeps transactions from interleaving.

## Decisions taken in step 8

- **Ranking is one SQL query** following README §4.
  - Who qualifies: approved, online, has the skill, same PIN code or a neighbouring one, no job in progress, no
    open offer, not offered this booking before (which also excludes a technician the job was taken from).
  - Order: women-rated first when the customer asked, then distance (PostGIS), rating, then fewest jobs accepted
    today, with the technician id as the final tie-break so the result is deterministic.
- **No double offers.** The chosen technician's row is locked with `FOR UPDATE ... SKIP LOCKED`, so two bookings
  being dispatched at once never pick the same person. Partial unique indexes enforce one open offer per booking
  and per technician as a backstop.
- **No double assignment.** Accept runs in one transaction with the booking, offer and technician rows locked: the
  offer must be open and within its 45 s, the booking still searching, the technician approved and free.
  Otherwise `OFFER_EXPIRED`. Two accepts sent at once give one 200 and one 410.
- **Timers are a 5-second sweep, not BullMQ** (`DispatchWorker`): expired offers, 10 and 30 minute escalation,
  late starts and bookings waiting for a free technician.
  - Answers check the exact 45 s themselves, so a late accept is refused even before the sweep runs.
  - The sweep needs no Redis, loses nothing on restart and is safe on every instance.
- **Reassignment:**
  - Instant: no trip within 10 minutes of accepting. Scheduled: no trip by 30 minutes before the window.
  - The booking goes back to `MATCHING` with a fresh 30-minute search, and the previous technician loses access
    to the job.
- **Missed offers:** an unanswered offer counts as a miss; a decline is an answer. Three misses in a row take the
  technician offline. Going offline, or being sent back for correction, hands the open offer back without counting
  a miss.
- **Unfulfilled bookings** that nobody reschedules are cancelled after 24 hours with a refund (the payments worker
  does this, because it involves the refund).
- **Neighbouring PIN codes** live in `service_area_pincodes` (store both directions). It starts empty, so only
  the same PIN matches; see QUESTIONS.md #38.
