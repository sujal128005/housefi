# Housefi backend

API for the Housefi app (customers book home-service technicians; technicians receive and complete jobs).
The contract, product rules and build plan are in [`docs/`](docs/README.md), copied from the app team's handoff.
`docs/openapi.yaml` is the source of truth for every request and response.

## Status

Build steps 1-12 of 14 (`docs/STARTER-PROMPT.md`) are done:

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
9. Job actions: `POST /v1/tech/jobs/{id}/start-trip|arrived|verify-start-code|quotes|start-work|complete|confirm-cash|reports`,
   `POST /v1/bookings/{id}/quotes/{MAIN|EXTRA}/answer`; rule-based price check, ETA from location updates.
10. Earnings: append-only `earnings_ledger` written when a job closes, `GET /v1/tech/earnings`, weekly payouts with
    `npm run payouts` (audited).
11. Notifications: `GET /v1/notifications`, `POST /v1/notifications/read`, `POST /v1/devices`; an inbox row for every
    `NotificationKind`, written with the change it announces, and Expo push (job offers high priority).
12. AI (rule-based v1): `GET /v1/ai/top-problems`, `POST /v1/ai/classify-photo`, `/ai/transcribe`, `/ai/chat`, each
    behind an interface a model can replace.

Next is **step 13**: support and coordinator (tickets, callback requests, coordinator assign / act on behalf).

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
| `npm run payouts -- prepare` / `list [STATE]` / `paid <id> <ref>` / `failed <id>` | Monday payouts: create them, list them, record the transfer (audited) |
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
    bookings/             booking-status.ts (the state machine), job-view.ts (the technician's Job), quote-view.ts,
                          booking-core.ts (locks, transitions, reads, expiry;
                          shared with payments and later steps), service (create, cancel, reschedule),
                          booking-view.ts (rows -> API shape), booking-updates.ts (live-update bus), SSE stream
    payments/             Razorpay client + signatures, start / verify / settle, webhooks (deduplicated, redacted),
                          refunds (claimed, retried), reconciliation and cash confirmation; worker every minute
    technicians/          profile, availability, location; tech-verification.service.ts (approve / correct)
    dispatch/             ranking + offers, accept / reject, timers (DispatchWorker every 5 s), offers API
    jobs/                 the visit step by step (jobs.service.ts), price-check.ts, review auto-clear worker, jobs API
    earnings/             earnings-rules.ts (shares, payout calendar), ledger.ts (written by BookingCore.transition),
                          GET /tech/earnings and the payout run
    ai/                   top-problems.ts (ranking), models.ts (photo / speech stand-ins), chat-rules.ts + chat.ts
                          (support assistant); swap implementations in ai.module.ts
    notifications/        notifier.ts (the outbox every module writes to), booking-notices.ts (who hears about a
                          status change), push texts (en / te), Expo sender, delivery worker, inbox and devices API
    health/               GET /v1/health (liveness), GET /v1/health/ready (database + Redis)
  common/audit/          append-only audit_log of privileged actions
  common/http/sse.ts     Server-Sent Events helper (booking and job streams)
  cli/seed.ts            npm run db:seed
  cli/technicians.ts     npm run tech (verification from the command line)
  cli/payouts.ts         npm run payouts (weekly payouts from the command line)
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

## Decisions taken in step 9

- **"Who may do what" is enforced exactly.** Each action checks the status (and `workStarted` or the quote
  decision where the table says so) under the booking's row lock, and only the assigned technician (or the owning
  customer, for answers) can act. Anything else is `CONFLICT`; someone else's job is `NOT_FOUND`.
- **The price check runs synchronously.** `price-check.ts` (pure functions, in paise) applies README §10.
  - `FAIR`: within or below the usual range. It is shared at once and the booking moves to `QUOTE_SHARED` or
    `EXTRA_WORK`.
  - `UNDER_REVIEW`: above 1.5 x the typical maximum, or any line above ₹5,000. The customer doesn't see it.
    `JobsWorker` clears it after 2 minutes, records it in `audit_log`, and shares it.
- **Quotes have versions.**
  - A revision is a new version; the old one is kept (superseded).
  - The customer sees the latest version that passed the check; the technician sees the latest version.
  - A partial unique index allows only one quote of each kind waiting at a time.
- **Extra work:** after the repair started; one approved extra per job, and a declined one can be followed by a
  new proposal. The bill is the approved repair quote plus the approved extra.
- **Start code:** compared in constant time. Each wrong attempt is committed before answering, so it always
  counts. The 5th wrong attempt locks the visit and opens a `HIGH` support ticket.
- **ETA:** straight-line distance x 1.4 at 20 km/h. It is set at the start of the trip and refreshed by location
  updates during it. The customer gets minutes, never coordinates.
- **Reports:** `CUSTOMER_UNAVAILABLE` (at the door) and `CANNOT_COMPLETE` (inspecting, quote shared, repairing)
  close the visit; any note goes to a support ticket. Other issues open a ticket (`UNSAFE` urgent,
  `PAYMENT_PROBLEM` high) and leave the job unchanged.
- **`support_tickets` exists from now on;** the support API comes in step 13. **`POST /tech/location` moved to
  the jobs controller** (same path) so it can refresh the ETA.
- **`Job.earning`** is the visit share plus 80% of approved labour plus approved materials, using the same rules
  as the step 10 ledger.

## Decisions taken in step 10

- **The ledger is written by the state machine.** `BookingCore.transition` calls `earnings/ledger.ts` in the same
  transaction whenever a job closes, so every path (payment webhook or verify, cash confirmation, declined quote,
  reports, customer cancellation, the coordinator later) records the same amounts:
  - `COMPLETED`: `VISIT_SHARE` ₹30, `LABOUR_SHARE` 80% of approved labour, `MATERIAL_REIMBURSE` 100% of approved
    materials, and for a cash bill `CASH_COLLECTED` = minus the bill (the technician holds Housefi's money).
    `technicians.jobs_done` goes up by one.
  - `CLOSED_NO_REPAIR` (declined, customer unavailable, cannot complete) and `CANCELLED` while `EN_ROUTE`: the visit
    share only. Cancelled before the trip, unfulfilled or expired: nothing.
- **Amounts stay in paise in the ledger** (80% of ₹149 is 11,920 paise); the API rounds to whole rupees. `Job.earning`
  uses the same functions (`earnings-rules.ts`), so the job card and the ledger always agree.
- **Append-only, enforced by the database:** a trigger refuses `DELETE` and any change except linking a row to a
  payout (or unlinking it when the payout failed); CHECK constraints fix the sign of each type; a partial unique index
  on `(booking_id, type)` means a job is credited once, however often the closing code runs. Corrections are new
  `ADJUSTMENT` rows. The ledger's foreign keys are `RESTRICT`, so a booking with earnings can never be deleted.
- **`GET /v1/tech/earnings`:**
  - `today` / `jobsToday`: job credits written since 00:00 IST, before cash is netted.
  - `total`: all job credits and adjustments.
  - `pendingPayout`: the balance: everything in the ledger, i.e. credits minus cash collected minus payouts made. It
    can be negative when the technician collected more cash than they earned (QUESTIONS.md #43).
  - `entries`: the latest 50 jobs, each with its credits (cash is netted in the payout, not per job), `PAID` once
    the payout holding it is paid.
  - `nextPayoutOn`: the coming Monday (today on a Monday).
- **Payouts by hand until RazorpayX:** `npm run payouts -- prepare` on Monday creates one payout per technician for
  the unsettled balance up to Sunday 23:59 IST and links those rows to it. A zero or negative balance creates nothing
  and carries over. `paid <id> <ref>` records the transfer and adds a `PAYOUT` debit, so the balance drops to zero;
  `failed <id>` unlinks the rows for next week. Running `prepare` twice creates nothing new; every change is audited.
- **Test database fix:** PGlite answers a database error in the extended protocol with two ReadyForQuery messages,
  and Prisma's engine then dropped the connection. `scripts/pglite-server.mjs` now passes on one per Sync, so tests
  can assert on constraint and trigger errors. Production (PostgreSQL) never had this problem.

## Decisions taken in step 11

- **The inbox is also the push outbox.** `Notifier.enqueue(tx, ...)` writes notification rows in the transaction of
  the change they announce: a rolled-back change never notifies, and a committed one always does, even if the
  process dies before pushing. `NotificationsWorker` delivers right after each enqueue (150 ms later, after commit)
  and sweeps every 5 s. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so several instances can run it.
- **Status changes notify from one place.** `BookingCore.transition` calls `booking-notices.ts`, so every path
  (webhooks, sweeps, the customer, the technician, the coordinator later) behaves the same. Who hears what:
  - The customer: `TECH_ASSIGNED`, `TECH_ON_THE_WAY` (with `etaMin`), `TECH_ARRIVED`, `QUOTE_READY` (again
    for a revised quote), `EXTRA_QUOTE`, `PAYMENT_DUE`, `BOOKING_COMPLETED`, `BOOKING_CANCELLED`,
    `NO_TECHNICIAN`.
  - The technician: `QUOTE_APPROVED` / `QUOTE_DECLINED`, `EXTRA_APPROVED` / `EXTRA_DECLINED`,
    `PAYMENT_RECEIVED`, and `JOB_CANCELLED` (cancelled, rescheduled or reassigned away from them).
  - Written where they happen: `JOB_OFFER` (dispatch), `QUOTE_REVISION` (no status change),
    `PROFILE_APPROVED` / `PROFILE_NEEDS_CORRECTION` (verification).
  - **Nobody is told about their own action:** a customer who cancels gets no `BOOKING_CANCELLED`, and a technician
    who confirms cash gets no `PAYMENT_RECEIVED`.
- **`params` hold codes, amounts and ids only:** `code`, `amount`, `etaMin`, `version`, `reason`, `method`,
  `serviceId`, `offerId`, `earning`, `expiresAt`. Never names, phones or addresses: the inbox is not
  encrypted, and the app fetches the booking for details.
- **Push text is written by the server** in the account's language (`users.locale`, en / te). The phone shows it
  before the app runs; the in-app inbox is still worded by the app from `kind` + `params`.
  - **Job offers:** `priority: high`, sound, the `job-offers` Android channel, and a `ttl` that ends with the
    offer.
  - **Too old to send:** an expired offer, or anything older than an hour, is `SKIPPED`.
  - **Failures:** a push service outage is retried up to 3 times, then `FAILED` (it stays in the inbox).
    `DeviceNotRegistered` deletes the device.
- **Devices belong to a sign-in session.** `POST /devices` records the refresh-token family of the access token, and
  pushes go only to devices whose session is still live. Logout, refresh-token reuse, expiry and account deletion
  stop pushes with no change to auth. A token registered by another account moves to it (one phone, whoever is
  signed in). Only Expo tokens are sent (others are stored and ignored).
- **No SMS in v1** (README §9: SMS is for OTP only). `sms_at` is kept for keypad-phone technicians later.
- **Account deletion** deletes the user's inbox and devices.
- **`PUSH_PROVIDER`:** `log` (default, development and tests) or `expo` (required in production).
  `EXPO_ACCESS_TOKEN` is needed only if the Expo project turns on enhanced push security.

## Decisions taken in step 12

- **Customers only.** The AI endpoints are customer features (Home, booking, Help). A technician gets `NOT_FOUND`,
  like any other wrong role. All four need a signed-in customer (README: only auth, catalog, health and the
  webhook are open).
- **Each feature is an interface with a DI token** (`TOP_PROBLEMS_RANKER`, `PHOTO_CLASSIFIER`, `SPEECH_TO_TEXT`,
  `CHAT_ASSISTANT`). A model replaces the rules by changing one provider in `ai.module.ts`.
- **Top problems** counts issue chips on bookings from the last 7 days:
  - First in the PIN and its neighbours (`service_area_pincodes`), then city-wide (the PIN's city, from past
    bookings), then the app's own `TOP_PROBLEMS` list with `recentCount` 0. There are always 6 items.
  - Only bookings that went ahead count: awaiting payment, payment pending and expired-unpaid bookings do not.
    Only issues still in the catalog count.
  - `area` is the most common locality booked in that PIN plus its city ("Banjara Hills, Hyderabad"). It is null
    without a PIN, or for a PIN never booked.
  - A city-wide fill keeps its city-wide count.
- **Photo classification** never guesses (`serviceId: null`, `confidence: 0`); it offers the 4 most booked
  services. **Transcription** returns `""`, and the app keeps the voice note as audio. Uploads do not exist yet, so
  `photoId` / `audioId` are only checked for shape (QUESTIONS.md #52).
- **Support chat** uses keyword rules in English and Telugu (like the app's demo) over the caller's newest active
  booking, read through `BookingCore.list` (their own bookings only):
  - It answers where the technician is, the quote or bill waiting, prices (from config), cancelling (by status, with
    the refund rule), rescheduling (where allowed) and refunds.
  - Anything that sounds dangerous (sparks, gas, shock, fire) gets safety advice and `offerHuman`. So does asking
    for a person, a cancellation the app cannot do, or anything it does not understand.
  - It is stateless: `conversationId` is echoed, or a new one is started. Messages are not logged or stored.
- **Rate limits:** chat 30 per minute; photo and voice 20 per minute.
