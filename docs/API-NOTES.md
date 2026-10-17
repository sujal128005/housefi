# Deviations from openapi.yaml

The goal is none. Each entry links to the open question that will remove it.

| Where | Deviation | Why | Question |
| --- | --- | --- | --- |
| Every endpoint | Unexpected failures return `{ error: { code: "INTERNAL" } }` with HTTP 500; `INTERNAL` is not in `ErrorBody.code`. | The enum has no code for server errors. | QUESTIONS.md #5 |
| `GET /v1/health`, `GET /v1/health/ready` | Not in `openapi.yaml`. | Operational endpoints required by STARTER-PROMPT step 1; public, no personal data. | (add to the spec) |
| `POST /auth/otp/verify`, `/auth/refresh` (technician) | Before the profile is submitted, `technician` has placeholder values (`skills: []`, `name: ""`, `gender: "M"`) that break `TechProfileInput`'s min-length rules. | A `TechProfile` cannot be complete before `PUT /tech/profile`. | QUESTIONS.md #17 |

## Behaviour the spec does not describe

- Every response carries `X-Request-Id`. A caller may send its own (8-64 chars of `A-Z a-z 0-9 . _ -`); anything
  else is replaced. The same id is in error bodies as `requestId`.
- `RATE_LIMITED` responses also set the `Retry-After` header (same value as `retryAfterSec`).
- A 403 from the framework maps to `NOT_FOUND`, so the API never reveals whether something exists.
- Request bodies are limited to 100 KB (photos and audio go to S3 directly); larger bodies are `VALIDATION`.

## Auth (step 2)

- **Refresh one at a time.** Every refresh retires the token it used. If the app sends two refreshes with the same
  token at once (say, two screens noticing a 401 together), the second counts as reuse and the session is revoked.
  `HttpBackend` should share a single in-flight refresh.
- **Wrong role on a route is `NOT_FOUND`**, the same as someone else's data (for example a technician token on a
  customer-only route).
- **Blocked accounts** get `UNAUTHENTICATED` at sign-in and refresh (the contract has no dedicated code).
- **Too many codes:** the 6th code request in an hour, or a resend within 30 s, is `RATE_LIMITED` with
  `retryAfterSec`. When the SMS provider fails, the response is `INTERNAL` and that code never works.
- **Access tokens** carry `sub` (user id), `role` and `sid` (session id). Signing out does not cut short an access
  token already issued; it expires on its own within 15 minutes.
- **Schema difference:** `otp_challenges` has an extra `phone_enc` column (the encrypted phone), needed to create
  the account when the code is verified. `docs/schema.sql` has only `phone_hash`.

## Users and catalog (step 3)

- **`/me` works for both roles** (`CUSTOMER`, `TECHNICIAN`) and returns the `Customer` shape for both.
- **A deleted or blocked account gets `UNAUTHENTICATED` on `/me`**, even with an access token that has not
  expired, so the app signs out.
- **`PATCH /me` names** are trimmed and must contain a letter (the app's `isValidName` rule); `{}` returns the
  profile unchanged.
- **`DELETE /me` never returns 409 yet.** It will once bookings exist (step 5), while a booking is active.
- **Catalog responses** send `Cache-Control: public, max-age=300`. `popular` is always present (`true` or
  `false`). An unknown or malformed service id is `NOT_FOUND`; an unknown `categoryId` filter is `VALIDATION`.
- **Schema differences from docs/schema.sql:**
  - `categories.wash`: the API's `Category` requires it.
  - `services.rating` and `services.reviews`: the API's `Service` requires them; demo values for now.
  - `sort` on services and issues: keeps the app's order.
  - CHECK constraints on prices, durations and ratings.

## Addresses and slots (step 4)

- **`GET /slots` takes an optional `pincode`** (not in openapi.yaml; additive). With it, that area's capacity
  applies; without it, the default capacity. The app should send the PIN of the address the customer picked.
- **Slots outside the 7 bookable days** (or in the past) come back as six `CLOSED` windows rather than an error.
  A malformed date or PIN code is `VALIDATION`; an unknown service is `NOT_FOUND`. Customers only.
- **Nothing is `FULL` from bookings yet:** bookings arrive in step 5. Until then a window is `FULL` only when an
  area's capacity is set to 0.
- **Addresses are customers only.**
  - Someone else's address is `NOT_FOUND` on `PUT`. `DELETE` always returns 204 and changes nothing that isn't
    yours.
  - More than 20 saved addresses is `CONFLICT`.
  - Input is trimmed. `lat` and `lng` come together (the missing one is `REQUIRED`). A `PUT` without them
    clears the stored point.
- **Schema differences from docs/schema.sql:**
  - `addresses.locality` is NOT NULL and derived from the street (QUESTIONS.md #9).
  - `addresses.updated_at` is added, plus a CHECK on the PIN format.
  - New table `slot_capacities` (QUESTIONS.md #10).

## Bookings (step 5)

- **`POST /bookings`**
  - `Idempotency-Key` must be 8-64 characters of `A-Z a-z 0-9 _ . : -` (a UUID works). It is unique per
    customer.
  - A replay returns the original booking with 201. The same key with a different body is `CONFLICT`.
- **Validation codes:**
  - An unknown service, an issue from another service, or an address that isn't yours is `VALIDATION` on that
    field.
  - Photo and audio ids are `VALIDATION` until uploads exist (step 10).
  - An instant booking outside 07:00-21:00 IST is `INSTANT_UNAVAILABLE`; a closed or full window is
    `SLOT_UNAVAILABLE`.
- **Fields not filled yet:** `technician`, `quote`, `extraQuote`, `rating` are null and `problem.photos` is
  empty. Later steps fill them.
- **`arrivalOtp`** is `""` until the visit fee is `PAID`, and again once it is refunded.
- **`cancelReason`** is `null` when the system cancelled (unpaid after 30 min); the stored reason is
  `UNPAID_EXPIRED` (QUESTIONS.md #4). Cancelling an already cancelled booking returns it unchanged (200).
- **Lists:** `GET /bookings` returns at most 50 bookings, newest first. There is no paging yet.
- **The stream** sends `retry: 3000`, one `booking` event right away and one per change (only when something
  visible changed), plus a `: ping` comment every 25 s. Others' bookings get the normal `NOT_FOUND` body
  before the stream opens.
- **Schema differences from docs/schema.sql:**
  - `bookings`: `idempotency_hash` is added; `idempotency_key` is NOT NULL.
  - `bookings.technician_id`: no foreign key until the technicians table exists (step 7).
  - `payments`: `settled_at` and `refund_requested_at` are added.
  - CHECK constraints: the time mode matches the window, the code format, and reasons only in their status.

## Payments (step 6)

- **`POST /bookings/{id}/payments`** returns 200 with a `PaymentOrder`, or, for `CASH` (bill only), the
  `Booking` with `finalPayment` `PENDING`/`CASH`.
  - `Idempotency-Key` is required, as on booking creation.
  - `CASH` for the visit fee is `VALIDATION` on `method`.
  - The wrong booking status, a payment still `PENDING` at the bank, or one already paid is `CONFLICT`.
  - Razorpay being unavailable, or no keys configured, is `INTERNAL`.
- **`POST /payments/{id}/verify`**
  - A wrong signature, or a payment from another order, is `PAYMENT_FAILED` (402) and changes nothing.
  - Otherwise the result is Razorpay's status: `PAID`, `PENDING` or `FAILED`. A late payment that is being
    refunded reports `PAID`, with the booking showing `REFUNDED`.
- **Statuses:**
  - Visit fee `PENDING` moves the booking to `PAYMENT_PENDING`. `FAILED` moves it back to
    `AWAITING_PAYMENT`, and the customer can pay again with a new order.
  - Bill `PAID` moves the booking to `COMPLETED`.
- **`visitPayment` / `finalPayment`:**
  - The latest attempt is shown.
  - `txnId` is the Razorpay payment id.
  - `method` is what the customer actually used (UPI, card or netbanking), else what they picked.
  - `PROCESSING` means the checkout sheet is open.
- **`POST /webhooks/razorpay`**
  - Public; authenticated by `X-Razorpay-Signature` over the raw body (`UNAUTHENTICATED` otherwise).
  - Deduplicated by `X-Razorpay-Event-Id`.
  - Answers `{ "status": "ok" }`. A processing error answers 500, so Razorpay retries.
- **Schema differences from docs/schema.sql:**
  - `payments` gains `ordered_at`, `last_checked_at` and `refund_processed_at`.
  - `payment_webhook_events.payload` stores a redacted copy (ids, amounts, statuses).
  - New partial indexes for reconciliation and refunds still to send.

## Technicians (step 7)

- **`GET /tech/me`**, **`PUT /tech/profile`**, **`POST /tech/availability`** and **`POST /tech/location`** are
  technicians only (customers get `NOT_FOUND`).
- **`PUT /tech/profile`**
  - The name is saved to the account (also seen in `GET /me`). Skills come back in catalog order.
  - `phoneType` from the app is ignored (coordinators set it).
  - Any submission makes the profile `PENDING` and the technician offline, even when it was `APPROVED`.
  - Refused (`CONFLICT`) while the technician has a job in progress.
- **`POST /tech/availability`** with `online: true` is `NOT_VERIFIED` (403) unless the profile is `APPROVED`.
  Going offline always works and clears the stored location.
- **`POST /tech/location`** returns 204. The point is stored only while online or on a job, and only the latest
  one is kept. Limit: 10 per minute.
- **Sign-in:** the `technician` in `AuthResult` is the real profile. `isNew` is true until the first
  submission. Before that the profile is the placeholder described in QUESTIONS.md #17.
- **Schema differences from docs/schema.sql:**
  - `technicians.vehicle` is stored encrypted (`vehicle_enc`).
  - `technicians` gains `last_accuracy_m`, `created_at` and CHECK constraints (online only when approved,
    rating 1-5, experience 0-50).
  - A GiST index on `last_location` is added.
  - `audit_log` is as in the reference schema.
