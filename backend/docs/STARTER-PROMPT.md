# Starter prompt for the backend (paste into Claude Code)

Put this folder (`docs/backend/` from the app repo) into a new, empty repository as `docs/`, then open Claude Code there and paste everything below the line.

---

You are building the production backend for **Housefi**, a home-services marketplace in India (customers book plumbers, electricians, AC, appliance, cleaning and carpentry technicians; technicians receive and complete jobs). The mobile app (Expo / React Native, English + Telugu) is being built in parallel by another team against a fixed contract. Your job is to implement that contract exactly, securely, with tests.

## Read first (in this order)

1. `docs/README.md`: product rules, workflow, roles, payments, security checklist, recommended stack and folder layout.
2. `docs/STATE-MACHINE.md`: every booking status, allowed transitions, actors, timeouts.
3. `docs/openapi.yaml`: the HTTP contract. **Request/response shapes must match it exactly** (camelCase, integer rupees, epoch-ms timestamps, the error body and codes).
4. `docs/schema.sql`: reference PostgreSQL schema (adapt into Prisma; keep the constraints).
5. `docs/examples/*.json`: real payloads the app expects.
6. `docs/.env.example`: configuration names.

If something is ambiguous, follow the README's rules; if still unclear, write the question into `docs/QUESTIONS.md` and choose the safest option.

## Stack (use these)

- Node.js 22 LTS, TypeScript strict, NestJS with the Fastify adapter.
- PostgreSQL 16 + PostGIS via Prisma (migrations committed). Money in paise (BigInt) in the database, rupees in the API.
- Redis + BullMQ for timers and background jobs; Redis pub/sub for live updates (SSE endpoints `/bookings/{id}/stream`, `/tech/jobs/{id}/stream`).
- Zod (or class-validator) for every request body, query and param, matching `openapi.yaml`.
- S3-compatible storage (MinIO locally) with pre-signed URLs for photos and audio.
- Vitest/Jest + Supertest; e2e tests run against Postgres and Redis in Docker.
- Docker Compose for local dev: postgres (postgis image), redis, minio.

## Build order (each step: code + tests + migration, then commit)

1. **Scaffold:** repo layout from README ("Recommended backend stack and repo layout"), config validation from `.env.example`, health check `GET /v1/health`, structured logger with PII redaction (phone, address, OTP, tokens, Authorization), request id, global error filter producing `{ error: { code, message, requestId, ... } }`, helmet, CORS allow-list, rate limiting (Redis).
2. **Auth:** `POST /auth/otp/request|verify`, `/auth/refresh`, `/auth/logout` for roles CUSTOMER and TECHNICIAN. OTP 6 digits, HMAC-hashed with a pepper, 5 min expiry, 3 attempts then `OTP_LOCKED`, resend after 30 s, 5 requests per phone per hour, per-IP limits. In development print the code to the log instead of sending SMS (provider interface with an MSG91 implementation behind a flag). Access JWT 15 min (EdDSA), refresh tokens 30 days, random, hashed, rotated on every use, reuse detection revokes the family. Phone numbers encrypted (AES-256-GCM envelope; local key from env, KMS in prod) plus HMAC lookup column. `demoCode` is always `null`.
3. **Users and catalog:** `/me` (GET, PATCH name/locale, DELETE with anonymisation). Catalog tables + seed script ported from the app's `src/data/catalog.ts` (6 categories, 21 services, issues, keywords, `repairFrom`; add `repairTypicalMax` = 4x `repairFrom`).
4. **Addresses and slots:** CRUD with ownership checks and encrypted house/street/landmark; slot rules: six windows 8-20, closed within 60 min of start, 7 bookable days, capacity per service area (FULL).
5. **Bookings:** create with `Idempotency-Key`, validation from README section 5, arrival code (4 digits, encrypted, hidden until the visit fee is paid), get/list (`scope`), cancel (refund rules), reschedule, live stream, timeline in `booking_events`. Unpaid bookings auto-cancel after 30 min.
6. **Payments (Razorpay test mode):** create order, verify signature, webhook (signature check, dedupe by event id), PENDING handling, refunds for visit fees cancelled before EN_ROUTE and for UNFULFILLED. CASH only for FINAL, confirmed by the technician. Amounts always computed server-side.
7. **Technicians:** profile submit (`PUT /tech/profile`, verification PENDING), `GET /tech/me`, availability (only APPROVED may go online, else `NOT_VERIFIED`), location updates. Add a protected internal endpoint or CLI command to approve / request correction (admin portal comes later).
8. **Dispatch:** sequential offers, one OPEN offer per booking and per technician (unique partial indexes), 45 s expiry via BullMQ, ranking rules from README section 4 (skill, area by PIN + neighbour PINs, no active job, women-rated first when preferred, distance, rating, fewest jobs today), `MATCHING_DELAYED` after 10 min, `UNFULFILLED` after 30 min, reassignment rules, 3 missed offers in a row sets the technician offline. Accept must be a single transaction with row locks (no double assignment).
9. **Job actions:** start-trip, arrived, verify-start-code (5 attempts then lock + support ticket), quotes (MAIN/EXTRA, min ₹100, at least one LABOUR line, versions, revision flow), rule-based price check (`FAIR` within typical range, `UNDER_REVIEW` above 1.5x typical max or any line above ₹5,000, auto-clear after 2 min with audit), customer answers (APPROVE / REVISION / DECLINE), start-work, complete (bill = approved quote + approved extra), confirm-cash, reports (CUSTOMER_UNAVAILABLE and CANNOT_COMPLETE close the visit with `closeReason`; others open tickets; UNSAFE is URGENT). Enforce `STATE-MACHINE.md` "Who may do what" exactly; anything else returns `CONFLICT`.
10. **Earnings:** append-only ledger (visit share ₹30, 80% labour, 100% materials, cash collected as a debit), `GET /tech/earnings` with today / total / pending payout / next Monday payout date.
11. **Notifications:** inbox table, `GET /notifications`, mark read, `POST /devices`, Expo push sender (job offers high priority). Create notifications on every event listed in `NotificationKind`.
12. **AI (rule-based v1):** `GET /ai/top-problems` (rank issues by bookings in the last 7 days for the PIN and its neighbours; fall back to city-wide; always 6 items), `POST /ai/classify-photo` (return `serviceId: null` + popular alternatives until a vision model is added), `POST /ai/transcribe` (stub returning empty text until speech-to-text is chosen), `POST /ai/chat` (keyword rules like the app's demo; only reads the caller's own bookings; `offerHuman` when unsure). Keep each behind an interface so models can be plugged in later.
13. **Support and coordinator:** tickets, callback requests, coordinator assign / act-on-behalf endpoints (role COORDINATOR, every action audited).
14. **Hardening:** audit log on every status change and privileged action, `npm audit` clean, CodeQL workflow, e2e test of the full happy path (book → pay → offer → accept → trip → arrive → code → quote → approve → work → complete → pay → rate) and of each failure path in `STATE-MACHINE.md`.

## Non-negotiable rules

- Every endpoint except auth, catalog, health and the Razorpay webhook requires a valid access token, checks the **role**, and checks **ownership** (customers see only their bookings; technicians see only offers sent to them and jobs assigned to them). Others' data returns `NOT_FOUND`.
- Technicians never receive the customer's phone number or exact address before accepting; customers never receive the technician's phone number (masked numbers only).
- No PII, codes or tokens in logs. Secrets only from env / secrets manager.
- Payment state changes only from verified Razorpay signatures/webhooks or a technician's cash confirmation.
- All money and totals are computed on the server; never trust amounts from the app.
- Keep `openapi.yaml` the source of truth: add a contract test that validates every response against it.
- Keep the README's MVP list in scope; put anything else in `docs/LATER.md`.

## Deliverables

- Working `docker compose up` + `npm run dev` with seeded catalog and two test accounts (one customer, one approved technician) documented in the README.
- `npm test` (unit + e2e) green in GitHub Actions.
- `docs/API-NOTES.md` listing any deviation from `openapi.yaml` (there should be none).
