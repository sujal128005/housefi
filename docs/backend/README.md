# Housefi backend: handoff for the backend team

This folder is everything the backend team needs to build the real Housefi backend in parallel with the app.
It answers the 12 questions you sent, in the same order, and points to the exact contract the app already uses.

| File | What it is |
| --- | --- |
| `README.md` (this file) | Answers to all 12 questions: setup, screens, workflow, fields, APIs, auth, location, notifications, payments, integration, MVP. |
| `STARTER-PROMPT.md` | A ready prompt to paste into Claude Code to scaffold the backend repo. |
| `openapi.yaml` | The HTTP API contract (OpenAPI 3.1). Source of truth for request and response shapes. |
| `schema.sql` | Reference PostgreSQL schema (tables, enums, indexes). Use it as the basis for Prisma models or migrations. |
| `STATE-MACHINE.md` | Every booking status, who moves it, and what happens on timeouts. |
| `.env.example` | Backend environment variables (names only, no secrets). |
| `examples/*.json` | Sample request and response bodies. |

The app's own contract lives in code. **If anything here disagrees with these two files, the files win; tell us and we fix the doc:**

- [`src/services/api.ts`](../../src/services/api.ts): every call the app makes (customer, technician, AI, notifications, demo).
- [`src/domain/types.ts`](../../src/domain/types.ts): every object the app shows (Booking, Job, Quote, Payment, ...).

In the zip version of this handoff, these app files are copied under `app-contract/` (with `catalog.ts`, `rules.ts` and `MockBackend.ts`), so the team does not need access to the app repo.

Today the app runs on an in-app **demo backend** ([`src/services/mock/MockBackend.ts`](../../src/services/mock/MockBackend.ts)) that implements those interfaces with synthetic data. Integration means writing a second implementation (`HttpBackend`) that calls your API. No screens change. The mock is also a working reference for the business rules: read it when in doubt.

---

## 1. Project setup

**Repository:** https://github.com/sujal128005/housefi
**Branch:** `path1/customer-booking` (all app work so far; nothing is merged to `main` yet).

**App stack (customer and technician are one app with two interfaces):**

| Part | Choice |
| --- | --- |
| Framework | Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6 |
| Navigation | Expo Router (file routes in `src/app/`) |
| Platforms | Native Android and iOS. Web build only for quick local preview. |
| Languages | English and Telugu (`src/i18n/en.ts`, `src/i18n/te.ts`). Every user-visible text is translated in the app; the API sends codes, not sentences. |
| Storage on device | AsyncStorage (preferences, session token) |
| Device features | expo-location (GPS for the address), expo-image-picker (problem photos), expo-haptics, expo-clipboard |
| Tests | Jest (unit tests for rules and the demo backend), Android emulator journeys in CI |
| CI | GitHub Actions: typecheck, tests, expo-doctor, Android release build plus emulator journeys, iOS simulator build |

**Run the app locally**

```bash
git clone https://github.com/sujal128005/housefi.git
cd housefi
git checkout path1/customer-booking
npm install
npx expo start --web        # fastest: opens in the browser at http://localhost:8081
npx expo run:android        # native Android build (needs Android Studio SDK + emulator or phone)
```

Checks: `npx tsc --noEmit`, `npx jest`, `npx expo lint`, `npx expo-doctor`.

**Folder structure (app)**

```
src/
  app/                      every file is a screen (Expo Router)
    (tabs)/                 customer tabs: home, bookings, help, account
    auth/                   phone, otp, name (shared by both roles)
    book/                   customer booking steps: snap, problem, voice, photos, address, when, confirm, confirmed
    booking/                booking hub [id], receipt, rate
    tech/                   technician app (being built now: onboarding, home, offers, job flow, earnings, profile)
    pay.tsx                 payment screen (visit fee and final bill)
    support.tsx             AI support chat with hand-off to customer care
  domain/
    types.ts                data shapes (THE contract for objects)
    rules.ts                pure business rules: validation, slots, timings, money, lifecycle helpers
  data/catalog.ts           categories, services, issues, demo technicians, demo quote templates
  services/
    api.ts                  THE contract for calls (interfaces Backend, BookingApi, TechApi, AiApi, ...)
    mock/MockBackend.ts     demo implementation (synthetic data, simulated timings)
    device.ts               camera / gallery / GPS helpers
  state/                    app state (language, role, sessions), booking draft
  i18n/                     English + Telugu strings
  ui/                       shared components
tools/                      emulator test drivers
docs/                       reports, screenshots, this backend handoff
```

**Existing backend, database, API calls:** none. There are no network calls in the app today. All data is synthetic and lives on the device in the demo backend (key `housefi.demo-backend.v2`). The catalog (6 categories, 21 services, issues, keywords in both languages) is in `src/data/catalog.ts`; seed your catalog tables from it.

**Environment variables**

- App (to add at integration): `EXPO_PUBLIC_API_URL` (e.g. `https://api.housefi.app/v1`) and `EXPO_PUBLIC_BACKEND=demo|live`. Nothing secret goes in the app.
- Backend: see `.env.example` in this folder.

---

## 2. Customer side: screens and functionality

Status legend: **Done** = built and working against the demo backend. **Needs backend** = UI done; the real behaviour needs your API. **Later** = not in v1.

| Screen / feature | What it does | Data it needs | Status |
| --- | --- | --- | --- |
| Welcome, language, role | 3 intro slides; choose English/Telugu (plus "detect from location", coming soon); choose "Book a home service" or "Work as a technician". | none (on device) | Done |
| Sign in / sign up | Mobile number, then a 6-digit SMS code. New numbers then give their name. One flow for sign up and log in. Google/Apple shown as "Soon". | `POST /auth/otp/request`, `POST /auth/otp/verify`, `PATCH /me` | Needs backend (SMS) |
| Profile | Name, phone, language, saved addresses, sign out. | `GET /me`, `PATCH /me` | Needs backend |
| Home | Greeting, current address, search, active booking card with live progress, "Snap the problem" (photo, AI picks the service), 6 categories, **Top problems near you** (AI-ranked for the customer's locality). | catalog, active bookings, `GET /ai/top-problems?pincode=` | Needs backend |
| Search | Search services and issues in English and Telugu. | catalog (search can stay on device; a server search is optional) | Done |
| Category, service details | Services in a category; a service's description, common issues, ₹49 visit fee, "repair decided by the technician after the visit". | catalog | Done |
| Snap the problem | Take or pick a photo; AI suggests the service (sample photos only in the demo). | `POST /uploads/photos`, `POST /ai/classify-photo` | Needs backend + AI |
| Booking step 1: How can we help? | Photos (up to 4), tap-to-speak voice note (AI writes it down), common issues as chips, own note. At least one is required. | `POST /uploads/photos`, `POST /uploads/audio`, `POST /ai/transcribe` | Needs backend + AI |
| Booking step 2: Address | Saved addresses, "Use my current location" (GPS fills street, city, PIN), add/edit address (house, street, landmark, city, PIN, label). | `GET/POST/PUT/DELETE /addresses` | Needs backend |
| Booking step 3: When | **Now** (technician in 45-60 min, 7 AM-9 PM) or **Schedule** (7 days, six 2-hour windows from 8 AM to 8 PM, closes 60 min before start, "Full" windows shown). | `GET /slots?serviceId&date` | Needs backend |
| Booking step 4: Confirm & pay | Summary with edit links, optional "Prefer technicians rated highly by women", price: ₹49 visit fee now; repair and materials decided by the technician after the visit (minimum ₹100), method UPI / card / net banking. | `POST /bookings` (idempotent) then payment | Needs backend + payments |
| Pay | Pay the visit fee or the final bill. Success, pending (bank confirming), failed (no money taken, retry or change method). Cash is allowed for the final bill only. | payment order + verification + webhook | Needs backend + Razorpay |
| Booking confirmed | Booking ID, visit fee paid, 4-digit **arrival code** to tell the technician at the door. | booking | Done |
| Booking hub (live) | Progress (Booked → Assigned → On the way → Repair → Done); finding technician / still searching / none found; technician card (name, rating, jobs, years, verified, rated highly by women, vehicle, masked call/chat); live map and ETA; arrival code; quote with labour and materials, AI price check badge, Approve / Ask for a lower price / Don't repair; extra work approval; work progress; bill and pay; receipt; rating; SOS and share status; cancel and reschedule; timeline. | `GET /bookings/{id}` + live updates (WebSocket or SSE), all booking actions | Needs backend |
| Quote pop-up | When the technician's quote passes the AI check, a pop-up anywhere in the app shows repair + materials + total with "Review". | live updates / push notification | Needs backend |
| Notifications | Bell on Home: technician assigned, on the way, arrived, quote ready, extra work, payment due, completed, cancelled. | `GET /notifications`, push | Needs backend |
| My bookings | Active and past lists. | `GET /bookings` | Needs backend |
| Cancel / reschedule | Cancel with an optional reason; the ₹49 is refunded if cancelled before the technician starts travelling. Reschedule when still searching, none found or assigned. | `POST /bookings/{id}/cancel`, `/reschedule` | Needs backend |
| Rating | "Were you satisfied?" Yes/No, 1-5 stars, tags, comment. Low ratings offer help. | `POST /bookings/{id}/rating` | Needs backend |
| Receipt | Visit fee + repair lines, payment methods, transaction IDs, share. | booking | Done |
| Help and AI support | AI chat (answers about the booking, prices, cancellation, refunds) and hand-off to customer care call. FAQ. | `POST /ai/chat`, `POST /support/callback` | Needs backend + AI |
| Safety | SOS sheet (call 112, alert Housefi safety team), share live status. | `POST /support/tickets` (kind `UNSAFE`) | Needs backend |

Not in v1 (Later): wallet, coupons, subscriptions, multiple services in one booking, chat with the technician beyond masked calls, Google/Apple sign-in, admin portal.

---

## 3. Technician (worker) side: screens and functionality

The technician app is part of the same app ("Work as a technician"). It is being built now on top of the contract in `src/services/api.ts` (`TechApi`). Everything below is **in v1** unless marked Later.

| Feature | v1 behaviour | API |
| --- | --- | --- |
| Registration / login | Same phone + SMS code flow as customers, separate technician account (a phone number can have both a customer and a technician account). | `POST /auth/otp/request` with `role: TECHNICIAN` |
| Profile | Name, gender, years of experience, skills (categories), base city + PIN, localities covered, vehicle (optional). | `PUT /tech/profile` |
| Verification | After submitting: **Pending**, **Approved**, or **Needs correction** (with a note). Only approved technicians can go online. ID document upload: Later (field reserved). | `GET /tech/me` |
| Phone type | v1 app needs a smartphone. The backend must store `phoneType` (SMARTPHONE, KEYPAD, NONE) and support coordinator-assisted jobs (section 9). | `PUT /tech/profile`, coordinator APIs |
| Availability | Online / Offline switch. Working hours: Later (v1 is the switch only). | `POST /tech/availability` |
| Home | Today's earnings, total earnings, online switch, the one next action (current job or offer), today's jobs, notifications. "Waiting for new jobs" when online with nothing to do. | `GET /tech/me`, `/tech/offers/current`, `/tech/jobs`, `/tech/earnings` |
| Job offer | Service, problem (issues, note, photo count), **area only** (locality, city, PIN; not the house number), time (now or window), distance, visit earning, countdown. Accept or reject (optional reason). "Offer expired" when the timer runs out. | `GET /tech/offers/current`, `POST /tech/offers/{id}/accept`, `/reject` |
| Job details (after accept) | Customer first name, full address with landmark, problem with photos and voice-note text, masked call button, "Navigate" (opens Google Maps / Apple Maps). | `GET /tech/jobs/{id}` |
| Status updates | Start trip (EN_ROUTE) → I've arrived (ARRIVED) → enter the customer's 4-digit start code (INSPECTING) → send quote → start repair → complete. | `POST /tech/jobs/{id}/start-trip`, `/arrived`, `/verify-start-code`, `/quotes`, `/start-work`, `/complete` |
| Quote | Labour lines and material lines (name, qty, price), auto total, minimum ₹100, diagnosis note. AI price check, then the customer sees it. Revise if the customer asks for a lower price. Extra materials during the repair = an EXTRA quote. | `POST /tech/jobs/{id}/quotes` |
| Payment status | Waiting / pending / paid / failed. For cash: "Collect ₹X" then "Cash received". | `GET /tech/jobs/{id}`, `POST /tech/jobs/{id}/confirm-cash` |
| Job summary, history, earnings | Per-job earning, today / total, pending payout and next payout date, list of jobs. | `GET /tech/jobs`, `GET /tech/earnings` |
| Ratings | Technician sees the rating each customer gave and the average on the profile. | inside `Job.rating`, `TechProfile.rating` |
| Notifications | New offer (with sound and vibration), quote approved / revision asked / declined, extra work answered, payment received, job cancelled, profile approved / needs correction. | `GET /notifications`, push |
| Language | English / Telugu, switchable in profile. | stored on device; also send `locale` to `PATCH /me` so SMS and push go out in the right language |
| Support | Report: customer unavailable, wrong address, unsafe situation, cannot complete, payment problem, other. | `POST /tech/jobs/{id}/reports` |
| Missed offers, cancellations, reassignment | An offer not answered in 45 s expires and goes to the next technician. A customer cancellation shows "Job cancelled" and frees the technician. Reassignment is the dispatcher's job (section 4). | push + `JOB_CANCELLED` notification |

---

## 4. Booking and job-assignment workflow

```
Customer books (status AWAITING_PAYMENT)
   └─ pays ₹49 visit fee ──► PAYMENT_PENDING (bank confirming) ──► MATCHING        <- booking is CONFIRMED here
                                                                      │
                     dispatcher offers the job to ONE technician at a time (45 s each)
                       accept ─────────────────────────────────────► ASSIGNED
                       reject / no answer ─► next technician
                       nobody after ~10 min ─► MATCHING_DELAYED ("still searching", customer can wait, reschedule or cancel with full refund)
                       nobody after ~30 min ─► UNFULFILLED (reschedule or cancel with full refund)
ASSIGNED ── technician taps Start trip ──► EN_ROUTE ── I've arrived ──► ARRIVED
ARRIVED ── technician enters the customer's 4-digit code ──► INSPECTING
INSPECTING ── technician sends quote ──► AI price check ──► QUOTE_SHARED (customer sees it)
QUOTE_SHARED ── customer: Approve ──► IN_PROGRESS ── Start repair ── (extra materials? EXTRA quote ─► EXTRA_WORK ─► customer answers ─► IN_PROGRESS)
             ── customer: Ask for lower price ─► technician revises ─► AI check ─► QUOTE_SHARED again
             ── customer: Don't repair ──► CLOSED_NO_REPAIR (only the ₹49 visit fee is kept)
IN_PROGRESS ── technician: Complete ──► PAYMENT_DUE ── customer pays online (or cash, technician confirms) ──► COMPLETED ──► rating
```

Answers:

- **After the customer books:** the booking exists in `AWAITING_PAYMENT`, holding the arrival code. Nothing is dispatched until the ₹49 is paid. Unpaid bookings expire after 30 minutes (release the slot).
- **Automatic or coordinator?** Automatic dispatch in v1. Coordinators can also assign manually (needed for technicians without smartphones; API only now, admin portal later).
- **Dispatch order:** approved + online + has the skill + inside the service area (same PIN or within radius once GPS is used) + no active job + not already offered this booking. If the customer asked for "rated highly by women", offer those technicians first. Then by distance, rating and fewest jobs today (fairness).
- **Can a technician reject?** Yes, with an optional reason (`TOO_FAR`, `BUSY`, `NOT_MY_SKILL`, `OTHER`). The next technician is offered at once.
- **No response:** the offer expires after 45 seconds (`OFFER_EXPIRED`), the technician gets a "missed offer" record, next technician. 3 missed offers in a row sets the technician offline automatically (and tells them).
- **Reassignment:** yes. If an assigned technician reports they cannot come, or does not start the trip in time (instant: within 10 min of accepting; scheduled: by 30 min before the window), the booking goes back to `MATCHING` with that technician excluded. The customer is told "We're finding another technician".
- **When is the booking confirmed?** When the visit fee is paid (`MATCHING`). The customer sees "Booking confirmed, finding your technician".
- **How does the customer see acceptance?** Status `ASSIGNED` with the technician object, via live updates + push notification `TECH_ASSIGNED`.
- **Cancellation by customer:** allowed until the technician is at the door (`AWAITING_PAYMENT` to `EN_ROUTE`). Refund of ₹49 if before `EN_ROUTE`; none after (the technician is travelling, gets the visit share).
- **Failed assignment:** `UNFULFILLED`, full refund on cancel, or reschedule (back to `MATCHING`).
- **Visit ends without repair:** `CLOSED_NO_REPAIR` with `closeReason`: `CUSTOMER_DECLINED` (quote declined), `CUSTOMER_UNAVAILABLE` (technician reported, after trying the masked call), `CANNOT_COMPLETE` (technician cannot do it). Visit fee is kept; technician gets the visit share.
- **Completed:** after the final payment is confirmed. Earnings are written to the ledger at that moment.

Full table of statuses, actors and timeouts: `STATE-MACHINE.md`.

---

## 5. Data fields and sample data

All shapes are defined in `src/domain/types.ts` and `openapi.yaml`. Conventions:

- JSON, **camelCase** field names.
- IDs: opaque strings (UUIDs are fine). Booking `code` is the short human code, `HF-12345` (unique).
- Money: **integer rupees** in the API (the app shows whole rupees). Store **paise** (bigint) in the database and convert at the edge.
- Timestamps: **epoch milliseconds** (numbers) in the API. Dates without time (slot dates, payout dates): `"YYYY-MM-DD"` in IST.
- Text the person typed (notes, names, quote lines) is stored as typed. Catalog names are `{ "en": "...", "te": "..." }`.
- Enums are UPPER_SNAKE strings exactly as in `types.ts`.

Key objects and validation (full list in `openapi.yaml`):

**Address** (`AddressInput`)

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| label | `HOME` / `WORK` / `OTHER` | yes | |
| house | string | yes | 2-120 chars |
| street | string | yes | 3-160 chars |
| landmark | string | no (may be "") | max 120 |
| city | string | yes | 2-60 |
| pincode | string | yes | `^[1-9][0-9]{5}$` |
| lat, lng | number | no | both or neither; from the phone's GPS |

**New booking** (`NewBooking`)

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| serviceId | string | yes | existing service |
| problem.issueIds | string[] | | issues of that service |
| problem.notes | string | | max 500 |
| problem.voiceNote | `{ durationSec, transcript, audioId? }` or null | | max 60 s |
| problem.photos | `{ id }[]` (uploaded photo ids) | | max 4 |
| (problem) | | at least one of issueIds, notes, voiceNote, photos | |
| addressId | string | yes | belongs to the customer |
| time | `{ mode: "INSTANT", window: null }` or `{ mode: "SCHEDULED", window: { date, startHour, endHour } }` | yes | instant only 07:00-21:00; window must be an OPEN slot |
| preferWomenRated | boolean | yes | |

**Quote input** (technician, `QuoteInput`): `diagnosis` (string, 3-500), `lines[]` with `kind` (`LABOUR`/`MATERIAL`), `name` (1-80), `qty` (integer 1-99), `unitPrice` (integer rupees 1-100000). Total must be at least **₹100** (`VALIDATION` otherwise) and contain at least one LABOUR line.

**Technician profile** (`TechProfileInput`): `name` (2-60), `gender` (`M`/`F`), `experienceYears` (0-50), `skills` (1-6 category ids), `city`, `pincode`, `areas` (2-200), `vehicle` (0-40). Backend adds `phoneType`.

**Rating**: `satisfied` (boolean, required), `stars` (1-5), `tags` (from `onTime, polite, clean, fair, explained, fixed`), `comment` (max 500).

Examples: `examples/booking.json` (a booking as the customer sees it), `examples/job.json` (same booking as the technician sees it), `examples/new-booking.json`, `examples/quote-input.json`, `examples/job-offer.json`, `examples/tech-profile.json`, `examples/error.json`, `examples/notification.json`.

---

## 6. Backend API requirements

Every app action that talks to the backend, mapped from `src/services/api.ts` to HTTP. Base path `/v1`. Request and response schemas are in `openapi.yaml`.

**Auth needed?** Everything except `auth/*`, `catalog/*` and the payment webhook needs `Authorization: Bearer <accessToken>`.

**Failure handling in the app** (already built): every request can fail; screens show an inline error with "Try again" and keep what the person typed. Specific codes get specific messages (table below). So: return the right error **code**, not just a status.

### Customer

| App action (trigger) | Method + path | Sends | Needs back |
| --- | --- | --- | --- |
| Send code (phone screen) | `POST /auth/otp/request` | `{ phone, role: "CUSTOMER" }` | `{ challengeId, phone, resendAfterSec, expiresAt }` |
| Verify code | `POST /auth/otp/verify` | `{ challengeId, code }` | `{ accessToken, refreshToken, expiresIn, isNew, customer }` |
| App start (restore) | `POST /auth/refresh` | `{ refreshToken }` | new token pair + `customer` |
| Sign out | `POST /auth/logout` | `{ refreshToken }` | 204 |
| Save name / language | `PATCH /me` | `{ name?, locale? }` | `customer` |
| Delete account | `DELETE /me` | | 204 (DPDP right to erasure) |
| Catalog | `GET /catalog/categories`, `GET /catalog/services?categoryId=`, `GET /catalog/services/{id}` | | categories / services |
| Addresses | `GET /addresses`, `POST /addresses`, `PUT /addresses/{id}`, `DELETE /addresses/{id}` | `AddressInput` | `Address` |
| Time windows | `GET /slots?serviceId=&date=` | | `Slot[]` |
| Upload a photo | `POST /uploads/photos` then `PUT` to the signed URL | `{ contentType, bytes }` | `{ photoId, uploadUrl, expiresAt }` |
| Upload a voice note | `POST /uploads/audio` | same | `{ audioId, uploadUrl }` |
| Book (confirm screen) | `POST /bookings` + header `Idempotency-Key` | `NewBooking` | `Booking` (status `AWAITING_PAYMENT`) |
| Pay | `POST /bookings/{id}/payments` | `{ kind: "VISIT" \| "FINAL", method }` | `{ paymentId, provider: "RAZORPAY", orderId, keyId, amount }` or, for CASH, the updated `Booking` |
| After the Razorpay sheet | `POST /payments/{paymentId}/verify` | `{ razorpayPaymentId, razorpaySignature }` | `{ state: "PAID" \| "PENDING" \| "FAILED", booking }` |
| Payment webhook (server-to-server) | `POST /webhooks/razorpay` | Razorpay event | 200 (verify signature) |
| Booking hub | `GET /bookings/{id}` | | `Booking` |
| Live updates | `GET /bookings/{id}/stream` (SSE) or WebSocket `/ws` channel `booking:{id}` | | `Booking` on every change |
| Booking lists | `GET /bookings?scope=active\|past` | | `Booking[]` |
| Cancel | `POST /bookings/{id}/cancel` | `{ reason }` | `Booking` |
| Reschedule | `POST /bookings/{id}/reschedule` | `{ time }` | `Booking` |
| Answer quote | `POST /bookings/{id}/quotes/{MAIN\|EXTRA}/answer` | `{ answer: "APPROVE" \| "REVISION" \| "DECLINE" }` | `Booking` |
| Rate | `POST /bookings/{id}/rating` | `{ satisfied, stars, tags, comment, byWoman? }` (`byWoman`: optional "I'm a woman"; only recomputes the technician's `women_rated`: 5+ such ratings averaging 4.5+; never returned) | `Booking` |
| Masked call | `POST /bookings/{id}/call` | | `{ dialNumber }` (Exotel bridge) |
| Notifications | `GET /notifications`, `POST /notifications/read`, `POST /devices` | `{ ids }` / `{ pushToken, platform }` | `AppNotification[]` |
| AI: top problems near me | `GET /ai/top-problems?pincode=` | | `{ area, items[6] }` |
| AI: photo to service | `POST /ai/classify-photo` | `{ photoId }` | `{ serviceId, confidence, alternatives }` |
| AI: voice to note | `POST /ai/transcribe` | `{ audioId, serviceId, locale }` | `{ text }` |
| AI: support chat | `POST /ai/chat` | `{ message, locale, conversationId? }` | `{ text, suggestions, offerHuman, conversationId }` |
| Call me back (customer care) | `POST /support/callback` | `{ bookingId?, reason }` | `{ ticketId }` |
| SOS / alert team | `POST /support/tickets` | `{ bookingId, kind: "UNSAFE", note }` | `{ ticketId }` |

### Technician

| App action | Method + path | Sends | Needs back |
| --- | --- | --- | --- |
| Send code / verify | `POST /auth/otp/request`, `/auth/otp/verify` | `{ phone, role: "TECHNICIAN" }` | `{ ..., technician, isNew }` |
| Load profile | `GET /tech/me` | | `TechProfile` |
| Submit / fix profile | `PUT /tech/profile` | `TechProfileInput` | `TechProfile` (verification `PENDING`) |
| Online / offline | `POST /tech/availability` | `{ online }` | `TechProfile` (`NOT_VERIFIED` if not approved) |
| Share location (while online) | `POST /tech/location` | `{ lat, lng, accuracy }` every 60 s while online or on a job | 204 |
| Current offer | `GET /tech/offers/current` (+ push `JOB_OFFER`) | | `JobOffer` or `null` |
| Accept / reject | `POST /tech/offers/{id}/accept`, `/reject` | `{ reason? }` | `Job` / 204; `OFFER_EXPIRED` if late |
| Jobs | `GET /tech/jobs?scope=active\|past`, `GET /tech/jobs/{id}`, stream like bookings | | `Job` |
| Start trip / arrived | `POST /tech/jobs/{id}/start-trip`, `/arrived` | | `Job` |
| Start code | `POST /tech/jobs/{id}/verify-start-code` | `{ code }` | `Job`; `OTP_INVALID` (+`attemptsLeft`), `OTP_LOCKED` |
| Send quote | `POST /tech/jobs/{id}/quotes` | `{ which, diagnosis, lines }` | `Job` (quote `review.state` = `CHECKING`) |
| Start repair / complete | `POST /tech/jobs/{id}/start-work`, `/complete` | | `Job` |
| Cash received | `POST /tech/jobs/{id}/confirm-cash` | | `Job` |
| Report a problem | `POST /tech/jobs/{id}/reports` | `{ issue, note }` | `Job` |
| Earnings | `GET /tech/earnings` | | `Earnings` |
| My Housefi ID | `GET /tech/id-card` | | `TechIdCard` (404 before the first submission) |
| Ask for an identity correction | `POST /tech/identity-corrections` | `{ kind: NAME\|PHOTO, note }` | `TechProfile` |
| Customer: assigned technician's ID card | `GET /bookings/{id}/technician-card` | | `TechIdCard`; 404 unless it is the customer's own booking with a technician assigned |
| QR verification page (public, no sign-in) | `GET /verify/technicians/{token}` | | `TechVerifyResult`; 404 for unknown / revoked tokens |

### Errors

Body: `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "for logs, not shown", "attemptsLeft": 2, "requestId": "..." } }`

| code | HTTP | When | App shows |
| --- | --- | --- | --- |
| `VALIDATION` | 422 | bad input (include `fields: { name: "REQUIRED" }`) | field errors |
| `UNAUTHENTICATED` | 401 | missing/expired token (app refreshes once, then signs out) | sign in again |
| `NOT_FOUND` | 404 | not found **or not yours** (never reveal other people's data) | not found |
| `CONFLICT` | 409 | action not allowed in the current status | "This changed, refresh" |
| `OTP_INVALID` | 400 | wrong code, with `attemptsLeft` | attempts left |
| `OTP_EXPIRED` / `OTP_LOCKED` | 400 / 429 | | ask for a new code / contact support |
| `SLOT_UNAVAILABLE` | 409 | window full or closed | pick another time |
| `INSTANT_UNAVAILABLE` | 409 | outside 07:00-21:00 or no capacity | schedule instead |
| `PAYMENT_FAILED` | 402 | provider refused | retry / other method |
| `OFFER_EXPIRED` | 410 | offer timed out or withdrawn | "Offer expired" |
| `NOT_VERIFIED` | 403 | technician not approved | verification status |
| `IDENTITY_LOCKED` | 409 | the technician tried to change the legal name (or photo) after registration | "Ask support for a correction" |
| `RATE_LIMITED` | 429 | too many requests (`retryAfterSec`) | wait |
| `NETWORK` | (client) | no connection / timeout | try again |

Also: `ApiErrorCode` in `api.ts` lists the codes the app knows. Add `RATE_LIMITED` there when integrating.

---

## 6b. Technician identity: photo, permanent ID, digital ID card, verification page

What the app does today (against the demo backend, `src/services/mock/MockBackend.ts`, tests in
`src/__tests__/identity.test.ts`) and what the real backend must enforce:

- **Photo, mandatory.** First `PUT /tech/profile` needs a photo (live camera or gallery; the app crops it square and
  sends a 480 px JPEG). Store it in a private bucket; serve only short-lived signed URLs. `photoStatus` stays
  `PENDING` until verification is approved; customers only ever get the **approved** photo.
- **Locked identity.** The first submission fixes `legal_name`, the photo and issues the Technician ID. Later
  submissions may change work details only: a different name is `IDENTITY_LOCKED`; a photo is ignored. Corrections
  are `identity_correction_requests`, decided by admin review (audited). Enforce in the database (grants above), not
  only in the API.
- **Technician ID `N9-HF-T-XXXXXX`.** Six characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31^6 ≈ 887 million) drawn
  with a CSPRNG by rejection sampling (`src/domain/identity.ts` has the reference code). Insert into
  `issued_tech_codes` in the same transaction; on a unique-key clash draw again. Never derived from name, phone or a
  sequence; never reused; never accepted as a credential or as permission to read anything.
- **Verification states:** `PENDING`, `APPROVED`, `NEEDS_CORRECTION`, `REJECTED`, `SUSPENDED`. Only `APPROVED`
  technicians get offers or go online. Withdrawing approval (`SUSPENDED`) takes them offline, and every customer-facing
  read (booking, ID card, verification page) reflects it immediately. The app shows the green "Verified" tick only for
  `APPROVED` with `simulated: false`; the real backend always sends `simulated: false`, `verifyIsDemo: false`,
  `fictional: false`.
- **QR code** = `https://<Housefi verification domain>/t/{token}`: a random 24-character token (store its SHA-256),
  no personal data in the URL. The page shows photo (approved only), first name + last initial, Technician ID,
  current status and "checked at". Rate-limit it, `noindex`, no analytics on the token. In the demo the QR opens
  `housefi://verify/{token}`, a page inside the app, and the card says so.
- **Who sees a card:** the technician (their own) and the customer of a booking with that technician assigned. Any
  other request is 404. Responses `Cache-Control: no-store`; do not log card bodies or tokens.
- **The card never carries** identity-document images or numbers, date of birth, home address or phone number.

Screen-capture protection is on the device (`expo-screen-capture`): Android secure window (FLAG_SECURE: no
screenshots or recordings, blank in recent apps); iOS 13+ hides the screen from screenshots and recordings, blurs the
app-switcher snapshot and tells the person on a screenshot attempt. No platform can stop a photo taken with another
camera, which is why the card has a live watermark and the QR shows the current status.

---

## 7. Authentication and user roles

- **Method:** mobile number + 6-digit SMS OTP for both roles (MSG91 or Gupshup, DLT-registered template). No passwords. Google/Apple: later.
- **Roles:** one `users` table with `role` (`CUSTOMER`, `TECHNICIAN`, later `COORDINATOR`, `ADMIN`). The same phone may have one customer and one technician account; they are separate users with separate tokens. The app keeps both sessions and uses the one for the current interface.
- **Sessions:** short-lived access token (JWT, 15 min, signed with EdDSA or RS256, contains `sub`, `role`, `sid`) and a long-lived **refresh token** (30 days, random 256-bit, stored only as a hash, **rotated on every use**, reuse of an old one revokes the whole session family). Logout revokes the refresh token. The app stores tokens in the device's secure storage (we will move from AsyncStorage to `expo-secure-store` at integration).
- **OTP rules (already in the app):** 6 digits, valid 5 minutes, 3 wrong tries locks the challenge, resend after 30 s. Add server limits: max 5 requests per phone per hour and per IP per 10 minutes, store the code as an HMAC (never plain), constant-time compare. Never return the code (the demo backend's `demoCode` must always be `null` in live).
- **Who can see what:**

| Data | Customer | Technician | Coordinator (later) |
| --- | --- | --- | --- |
| Own profile, addresses, bookings | yes | | read for support |
| Booking address | own | area only while offered; full address after accepting, until 24 h after the job closes | yes |
| Customer phone | own | never (masked calls only) | masked |
| Customer first name | own | after accepting | yes |
| Arrival / start code | own booking, after visit fee paid | never (they type what the customer says) | no |
| Technician name, rating, vehicle, photo | assigned technician only | own | yes |
| Technician phone | never (masked) | own | yes |
| Quotes, payments | own booking | own jobs | yes |
| Earnings | | own | yes |

Every query must filter by the owner (`customerId = me` / `technicianId = me`); return `NOT_FOUND` for anything else.

---

## 8. Location and service availability

- **Customer address:** typed address (house, street, landmark, city, PIN) is required. GPS is optional: "Use my current location" fills street/city/PIN on the phone and sends `lat`/`lng` with the address. Store as PostGIS `geography(Point)`.
- **Map integration:** not required for booking. The live map in the app is a demo animation now; for production, use the technician's location updates (below) and the Google Maps SDK (later).
- **Technician service area (v1):** base city + PIN + free-text localities. Dispatch v1 matches by PIN (and neighbouring PINs list per city, a simple table). v2: radius from the technician's live location.
- **Nearby / available workers:** the customer does not see a list of workers. The app only needs (a) whether "Now" is available (`INSTANT_UNAVAILABLE` if no capacity) and (b) slot availability (`FULL` slots).
- **Live tracking:** MVP = status updates + ETA minutes (`etaMin` on the booking). The technician app sends location every 60 s while on a job (`POST /tech/location`); compute ETA from distance (or Google Distance Matrix later). Customers never get the technician's exact coordinates before `EN_ROUTE`, and none after the visit.

---

## 9. Notifications and offline workers

| Need | v1 | Later |
| --- | --- | --- |
| In-app inbox | Yes: `GET /notifications` (kinds listed in `NotificationKind`, `api.ts`). The app writes the text in the right language from `kind` + `params`. | |
| Push (smartphone) | Yes: Expo push tokens via `POST /devices` (Expo push service, or FCM/APNs directly). Job offers use a high-priority channel with sound. | |
| SMS | OTP only. Booking confirmations and "technician on the way" SMS to customers: optional in v1. | |
| Keypad-phone technicians | Data model ready: `phoneType = KEYPAD`, offers with `channel = SMS` ("Reply 1 HF-12345 to accept"). | Two-way SMS and IVR ("press 1 to accept", key in the start code) via Exotel/Knowlarity. |
| Technicians with no phone | `phoneType = NONE`, linked to a coordinator. **Coordinator-assisted assignment API in v1** (assign a job to a technician, update status on their behalf; every action audited with `actorType = COORDINATOR`). No UI yet (admin portal later). | Coordinator app/portal. |
| Acceptance confirmation | Customer: `TECH_ASSIGNED` push + live update. Technician: the accept response. | |
| Reminders | Scheduled visits: technician reminder 60 min before window start; customer reminder the evening before and when the technician starts the trip. | |
| Cancellation alerts | `BOOKING_CANCELLED` (customer), `JOB_CANCELLED` (technician). | |

---

## 10. Payments and job completion

- **MVP supports both:** visit fee **online only** (UPI, card, net banking) via Razorpay; final bill online **or cash** to the technician.
- **Price:** visit fee is **fixed ₹49**, paid in advance. Repair labour and materials are **decided by the technician after the visit** (minimum ₹100), itemised, price-checked, and **approved by the customer before any work**. Extra work during the repair needs a second approval.
- **AI price check (v1 = rules, model later):** compare the quote total with the service's typical range (from catalog and past jobs). Within range → `FAIR`, shared at once. Above 1.5x the typical maximum, or any single line above ₹5,000 → `UNDER_REVIEW` (a reviewer clears it; until the admin portal exists, auto-clear after 2 minutes and log it). The customer only sees the quote after it passes.
- **Completion:** the technician taps Complete (`PAYMENT_DUE`, bill = approved quote + approved extra). The booking is `COMPLETED` when the payment is confirmed (Razorpay webhook) or the technician confirms cash.
- **Technician earnings (shown in the app):** visit share **₹30** of the ₹49 (also when no repair happens) + **80% of labour** + **100% of materials** (reimbursement). Cash collected by the technician is recorded as owed commission and netted in the **weekly payout (every Monday)**. Use a ledger table (`earnings_ledger`) with one row per credit/debit, never a single running number.
- **Refunds:** v1 yes, for the visit fee when cancelled before `EN_ROUTE` and for unfulfilled bookings (Razorpay refund API, state `REFUNDED`). **Disputes:** v1 is a support ticket (`PAYMENT_PROBLEM`) handled manually; a dispute flow is later.
- Never trust the app for a payment result: only the signature-verified Razorpay callback/webhook moves a payment to `PAID`.

---

## 11. Frontend integration

- **Existing endpoints:** none; the app uses the demo backend (mock data, clearly labelled "Demo" on screen).
- **How we integrate:** we write `HttpBackend` implementing the same `Backend` interface, switch with `EXPO_PUBLIC_BACKEND=live`. Your API must return exactly the shapes in `openapi.yaml` (= `types.ts`), camelCase, epoch-ms timestamps, integer rupees.
- **Live updates:** the app expects to "watch" one booking/job and get the full object on every change. SSE (`GET /bookings/{id}/stream`) is simplest; WebSocket is fine too. Polling fallback: the app can poll `GET` every 4 s.
- **States:** loading (skeletons), empty, success and error (with retry) are implemented on every screen. Simulated failures can be forced in Demo settings to test them.
- **Screenshots:** older screens in `docs/screens/path1/` (English, Telugu, edge states) from the first customer flow. A full walkthrough of the new customer flow and the technician app will be added to `docs/screens/` with the next report.
- **CORS:** only needed for the web preview (`http://localhost:8081`).
- **Versioning:** keep `/v1` stable; additive changes only (new optional fields are fine, the app ignores unknown fields).

---

## 12. MVP priorities

**Must-have for the first working demo (end to end on real phones):**

1. OTP auth for both roles, refresh tokens, `/me`.
2. Catalog (seeded from `src/data/catalog.ts`), addresses, slots.
3. Bookings: create (idempotent), get/list, live updates, cancel, reschedule.
4. Razorpay test mode: visit fee and final bill, webhooks, refunds; cash confirmation.
5. Technician profile, verification status (manual approve via a protected endpoint or SQL for now), online/offline.
6. Dispatch: sequential offers with 45 s expiry, accept/reject, reassignment, `MATCHING_DELAYED` / `UNFULFILLED`.
7. Job actions: start trip, arrived, start code, quote (+ rule-based price check), customer answer, start/complete work.
8. Earnings ledger + `GET /tech/earnings`.
9. Notifications inbox + Expo push (offer, assigned, on the way, quote ready, payment).
10. Photo upload (private bucket, signed URLs).
11. Security baseline (section 7 and `STARTER-PROMPT.md`), audit log, rate limits.

**Later:** AI models (photo classification, Telugu speech-to-text, chat with tools, top-problems ranking from real data), masked calls (Exotel), SMS/IVR offers for keypad phones, coordinator portal and admin portal, live GPS map, payouts automation (RazorpayX), ID verification (DigiLocker/Aadhaar via a licensed provider), women-rated badge from real ratings (needs an optional "I am a woman" field on customer ratings, product decision pending), working hours, coupons.

**External services already chosen (recommended, confirm with the business):** Razorpay (payments, refunds, later RazorpayX payouts), MSG91 (OTP SMS, DLT), Expo push, AWS ap-south-1 Mumbai (RDS PostgreSQL + PostGIS, ElastiCache Redis, S3, KMS) to keep data in India (DPDP Act 2023), Exotel (masked calls, IVR) later, Anthropic Claude (support chat, photo understanding) and a Telugu-capable speech-to-text service later.

---

## Recommended backend stack and repo layout

Use TypeScript so the API types can be generated from (and checked against) the app's `types.ts`.

| Part | Choice |
| --- | --- |
| Runtime | Node.js 22 LTS, TypeScript (strict) |
| Framework | NestJS (modules, guards, DI) with Fastify adapter |
| Validation | Zod schemas generated from / matching `openapi.yaml` |
| Database | PostgreSQL 16 + PostGIS, Prisma ORM + migrations |
| Cache / jobs | Redis + BullMQ (offer expiry, reminders, unpaid-booking expiry, price-review auto-clear, payouts) |
| Live updates | SSE (or Socket.IO) backed by Redis pub/sub |
| Files | S3 (private bucket, SSE-KMS, presigned URLs) |
| Tests | Vitest/Jest unit + Supertest e2e against Postgres in Docker; contract tests against `openapi.yaml` |
| Local dev | Docker Compose: postgres+postgis, redis, minio (S3), mailhog-free (SMS logged to console in dev) |
| CI | GitHub Actions: lint, typecheck, unit, e2e, `npm audit`, CodeQL |

```
housefi-backend/
  src/
    main.ts                    bootstrap (Fastify, helmet, CORS, request-id, logger with PII redaction)
    app.module.ts
    config/                    env schema (zod), loads .env
    common/                    auth guards (role + ownership), error filter (error codes), idempotency, rate limit, crypto (AES-GCM envelope, HMAC)
    modules/
      auth/                    otp request/verify, refresh rotation, logout
      users/                   /me, delete account
      catalog/                 categories, services, issues (seeded)
      addresses/
      slots/                   availability per service/date
      bookings/                create, get, list, cancel, reschedule, rating, stream
      dispatch/                matching engine, offers, expiry, reassignment
      jobs/                    technician job actions (trip, arrive, start code, work, cash, reports)
      quotes/                  quotes, revisions, price check
      payments/                Razorpay orders, verify, webhooks, refunds
      earnings/                ledger, summaries, payouts
      technicians/             profile, verification, availability, location
      notifications/           inbox, push (Expo), SMS
      ai/                      top problems, classify photo, transcribe, chat (rule-based first)
      support/                 tickets, callback requests, SOS
      uploads/                 presigned photo/audio uploads
      coordinator/             assisted assignment (API only in v1)
    queue/                     BullMQ processors
  prisma/
    schema.prisma
    migrations/
    seed.ts                    catalog from the app's src/data/catalog.ts
  test/                        e2e
  openapi.yaml                 copy of docs/backend/openapi.yaml (keep in sync)
  docker-compose.yml
  .env.example
```

## Security checklist (must pass before any real user data)

- TLS everywhere (HSTS); no plain HTTP. Mobile app pins nothing in v1 but rejects non-HTTPS URLs.
- PII encrypted at rest at field level: phone numbers, house/street/landmark, names (AES-256-GCM with per-record data keys wrapped by AWS KMS; lookup by HMAC-SHA256 of the phone). Database and backups encrypted (RDS encryption).
- OTP and refresh tokens stored only as hashes; arrival/start codes stored encrypted (the customer must see theirs) with 5 attempts then lock.
- RBAC + ownership check on every endpoint; `NOT_FOUND` for others' data; technicians see the address only after accepting.
- Rate limits per IP, per phone, per user; idempotency keys on booking and payment creation.
- Payment state only from verified Razorpay signatures/webhooks; amounts always computed on the server.
- Input validation on every field (lengths, enums, integer money, max photos/size, content types: jpeg/png/heic up to 8 MB, audio m4a up to 2 MB).
- Signed, short-lived URLs for photos (5 min); private bucket; strip EXIF location from photos.
- Logs: structured, request-id, **no PII, no tokens, no codes** (redact phone, address, OTP, Authorization).
- Audit log for every status change and every coordinator/admin action (who, when, before, after).
- Secrets in AWS Secrets Manager / SSM, never in the repo. `.env` only for local dev.
- DPDP Act 2023: consent text at sign-up (exists in the app), data stored in India, account deletion (`DELETE /me`) with anonymisation of bookings, retention policy (e.g. delete addresses 3 years after last booking), breach process.
- Dependency scanning (Dependabot, `npm audit`), CodeQL, no `eval`, helmet headers, CORS allow-list.
