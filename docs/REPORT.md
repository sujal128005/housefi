# Backend inspection and hardening report

What the team's backend had, what was missing, and what was added or fixed. Every item below is covered by
automated tests (`npm test`). All tests, lint and typecheck pass.

## 1. What the team delivered (kept, and solid)

The 14-step build plan was complete and well built:
- Auth with sign-in codes, Ed25519 tokens and refresh-token rotation.
- Catalog, encrypted addresses with PostGIS, slots, and bookings with an audited state machine.
- Razorpay payments, refunds and reconciliation.
- Technician onboarding, sequential dispatch, job actions, the price check, the earnings ledger and payouts.
- Notifications with Expo push, rule-based AI, support, coordinators, ratings and uploads with location removal.

The payment core (signature checks, server-side amounts, webhook de-duplication, refund of double payments) and the
ownership checks on every customer and technician route were reviewed and are correct.

## 2. Security problems found and fixed

### Sign-in

| Problem | Fix |
|---|---|
| `trustProxy: true`: anyone could fake their IP with an `X-Forwarded-For` header and get unlimited tries | `TRUST_PROXY` is a number of proxy hops; IPv6 addresses are limited per /64 |
| No limit on SMS for the whole service: a botnet could drain the SMS balance | SMS budget per minute, hour and day, counted in Postgres (holds even when Redis is down), with an `ALERT` log |
| Wrong codes were limited per code only; guessing across many codes was possible | Progressive lock per number (default 5 wrong → 10 min, 3 → 1 h, 1 → 24 h, 1 → 21 days), configurable in `OTP_LOCK_STEPS`; `npm run support -- unlock <phone>` |
| Sign-in requests for unknown coordinator numbers created records; the data key was used before the limits were checked | Rejected before anything is stored; limits come first |
| Sign-in routes failed open when Redis was down | Fail closed in production |
| Access tokens kept working after logout, account deletion or a block (up to 15 min), and live streams stayed open | A session check in the guard (10 s cache); streams close when the session ends; at most 5 streams per person |
| `NODE_ENV` defaulted to development; console SMS and fake providers could run in production; secrets had no upper bounds | `NODE_ENV` is required; production refuses console SMS, fake calls, the local data key, password-less Redis, a resend wait under 15 s and the dev bucket |

### Data and money

| Problem | Fix |
|---|---|
| Field encryption needed AWS KMS in production | Versioned master keys (`DATA_KEYS_B64`), rotatable without re-encrypting; KMS still optional |
| The Exotel webhook secret (in the callback URL) was written to request logs | Redacted in the logger and in Caddy's access log |
| One account could fill every time slot with unpaid bookings | At most 2 unpaid bookings per customer at a time |
| After the server checked an uploaded file, the app could replace it through the same upload URL (bypassing type, size, location removal and the 60 s audio limit) | Checked files move to a key no upload URL can write; only that copy is ever served or sent to a model |
| A failed second payment attempt could cancel a first attempt that had gone through | Ignored while that first payment is pending |
| A payment Razorpay refunded on its own (never captured) counted as paid | Counted as not paid; the customer can pay again |
| A slow Razorpay call could expire the payment transaction | The transaction outlives the provider call |
| Any coordinator could read any booking's offer history and assign a booking another coordinator had claimed; demo bookings showed in the real list | Scoped to queued bookings or their own technicians' jobs; claims respected; demo coordinators see only demo bookings |
| A coordinator could take over a technician account someone had already signed in to | Refused |
| A technician could change their name at any time (it is shown on their ID card) | Locked after the first profile submission; changed only through support |

## 3. What was missing, and is now built

- **Team demo accounts.** Only the numbers in `DEMO_PHONES` sign in with `DEMO_OTP_CODE` (no SMS). Demo data is kept
  apart from real data:
  - demo bookings use simulated payments;
  - demo bookings reach only demo technicians;
  - demo bookings never count in slots or payouts.
- **Technician identity.**
  - A permanent Technician ID (`N9-HF-T-XXXXXX`), a locked legal name and an approved photo.
  - ID cards for the technician and the customer.
  - A QR code that really works: it opens `housefi.tech/t/#<token>`, which checks the status live (website page
    included).
  - Suspend, reinstate, reject and re-issue a QR code, plus correction requests.
- **Aadhaar verification.** The Secure QR on the card is verified offline with UIDAI's signature. The server stores
  only the last 4 digits, the birth year, the gender, a name match and a one-way fingerprint, which stops one Aadhaar
  being used for two accounts. Approval requires it. (No AI is needed for this; UIDAI's signature is stronger than any
  model.)
- **Women-rated badge**, from self-declared women's ratings (at least 5, averaging 4.5 or more).
- **Two kinds of technicians**: smartphone and keypad / no phone (`docs/TELEPHONY.md`).
  - App: push notification, 45 s to accept.
  - Keypad phone: an automatic call in Telugu or English; press 1 and their PIN to accept.
  - No phone: the coordinator queue.
  - Masked calls between customer and technician, availability by phone, and a circuit breaker.
- **Real AI.**
  - Claude answers the support chat from the customer's own booking facts. Danger messages always get the fixed
    safety answer and a person.
  - Claude reads problem photos and can only pick catalog services.
  - Sarvam turns Telugu and English voice notes (up to 30 s) into text.
  - Each falls back to the rules if the provider is slow, down or declines.
- **Live location** of the technician for the customer while on the way, refreshed about every 60 s.
- **Reminders**:
  - unpaid visit fee;
  - visit in an hour (customer and technician);
  - quote waiting;
  - rate the visit.
  - Technicians also get a notice when their account is suspended, reinstated or rejected.
- **Deployment without AWS**: Dockerfile, production compose with HTTPS (Caddy), a production secrets generator,
  backups and the DigitalOcean Bangalore guide (`docs/DEPLOY.md`).
- **Contract**: `docs/openapi.yaml` updated with every new field and endpoint. A test fails if the API and the
  contract ever disagree.

## 4. New fields and endpoints the app must handle (frontend, later)

- `POST /auth/otp/request` → `demoAccount` (show a "demo" hint).
- `Booking.technicianLocation` (map while EN_ROUTE), `Booking.demo`, `Technician.techCode/photo/verification`.
- `GET /bookings/{id}/technician-card`, `GET /tech/id-card`, `POST /tech/identity-corrections`, `POST /tech/aadhaar`.
- `POST /bookings/{id}/call`, `POST /tech/jobs/{id}/call` → `{ dialNumber }` (open the dialler).
- Upload stage `PROFILE` for the technician's registration photo (required on the first profile submission).
- New notification kinds: `PAY_REMINDER`, `BOOKING_REMINDER`, `JOB_REMINDER`, `QUOTE_REMINDER`, `RATE_REMINDER`,
  `PROFILE_SUSPENDED`, `PROFILE_REINSTATED`, `PROFILE_REJECTED` (inbox texts `notif.<kind>`).
- Rating input `byWoman` (optional "I'm a woman" toggle).
- Voice notes: record at most 30 s if you want a transcript (longer notes stay audio only; the limit is 60 s).
- `POST /bookings` can answer 409 when the customer already has 2 unpaid bookings.

## 5. Left for the team (needs accounts, money or a person)

- **Provider accounts and keys**: MSG91 (DLT templates), Razorpay live, Exotel (KYC, ExoPhone, two call flows),
  Anthropic, Sarvam, the UIDAI certificate, DigitalOcean and DNS. Step-by-step: `docs/DEPLOY.md` step 4 and
  `docs/TELEPHONY.md`.
- **Check with live test keys before launch**:
  - one ₹1 Razorpay payment and its refund;
  - one sign-in SMS;
  - one Exotel call per flow;
  - one Sarvam transcription (the API reference was not reachable from the build machine; the request format follows
    Sarvam's documented `speech-to-text` endpoint);
  - one Claude chat.
- **Legal**: the Aadhaar consent text and your obligations under the Aadhaar Act and the DPDP Act; a privacy policy
  that names the processors (Anthropic, Sarvam, MSG91, Exotel, Razorpay, DigitalOcean).
- **CI on PostgreSQL 16**: local tests use PGlite (PostgreSQL 18). Run the suite once against a real Postgres 16.
- **Keep the GitHub repository private.**
