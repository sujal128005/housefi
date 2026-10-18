# How the app connects to the backend

Status: **connected.** Every screen talks to the backend only through the `Backend` interface in
`src/services/api.ts`; the one implementation the app ships is the live client `src/services/http/HttpBackend.ts`.
`src/services/mock/MockBackend.ts` stays only as a test double for the unit tests (an architecture test checks that
no screen imports it). Tested end to end against a local copy of the API: sign-in, booking with a photo, visit-fee
payment, technician sign-up and approval, job offer, trip, arrival code, quote and approval, completion, final
payment, rating, SOS, notifications.

## Settings

`src/services/createBackend.ts` reads `EXPO_PUBLIC_HOUSEFI_API_URL` (default `https://api.housefi.tech/v1`; https
only, http allowed for localhost). `EXPO_PUBLIC_HOUSEFI_CHECKOUT_URL` (default `https://housefi.tech/pay/`) is the
payment page; `EXPO_PUBLIC_HOUSEFI_SUPPORT_PHONE` the customer-care number. Every call has a 25 s limit, longer for
payments, booking creation, photo reading, voice notes and profile submission (`services/timeouts.ts`).

## How each part works

| Part | How |
|---|---|
| Sign-in | `POST /auth/otp/request` and `/auth/otp/verify` with the role (customer or technician). The access and refresh tokens are kept in the Keychain / Keystore under a random handle (`http/credentials.ts`); the screens only ever see the handle. Access tokens refresh a minute before they expire, one refresh at a time, and a refused token is retried once after a refresh. A refused refresh ends the session ("sign in again") |
| Demo accounts | The server marks the team's demo numbers with `demoAccount: true` (OTP screen badge) and `demo: true` on their bookings and jobs (a "Team demo booking" note). Nothing else in the app changes |
| Uploads | `POST /uploads/photos` or `/uploads/audio` for a ticket, then `PUT` the file to the signed URL. The server checks the bytes before anything uses them (`http/uploads.ts`) |
| Live updates | Server-sent events with the access token; if the stream fails the app polls every few seconds (`http/liveStream.ts`) |
| Payments | `POST /bookings/{id}/payments` returns a Razorpay order and the key ID. The app opens housefi.tech/pay in the phone's secure browser, Razorpay's checkout runs there, and the page sends the result back through `housefi://pay/return`. The app then calls `/payments/{id}/verify`; the booking is "paid" only when the server says so. Cash: the technician confirms it. Demo accounts: simulated, no money moves |
| Calls | `POST /bookings/{id}/call` (customer) or `/tech/jobs/{id}/call` (technician) returns a Housefi number to dial; neither side sees the other's number. If calls are off, the app asks for a call-back (`POST /support/callback`) |
| SOS | 112 opens the phone's dialler; "Alert Housefi safety team" files an urgent `UNSAFE` ticket (`POST /support/tickets`) |
| Location | While a technician is online or on a job, the app sends its position about once a minute (`POST /tech/location`). The customer sees it on a map only while the technician is on the way |
| Push | After sign-in the phone's Expo push token is registered for each signed-in account; job offers use a loud Android channel. Tapping a notification opens the booking or job |
| Aadhaar | The camera reads the Secure QR on the technician's Aadhaar; the server checks UIDAI's signature and keeps only the last 4 digits, birth year, gender and whether the name matches (`POST /tech/aadhaar`) |
| AI | Photo reading and voice notes go through the API (Claude and Sarvam on the server); the app never holds AI keys |

`bookings.create` and `bookings.pay` take an idempotency key from the screen: one key per attempt
(`src/state/idempotency.ts`), sent again on every retry after a time-out or lost connection, and a new one when the
input changes or the backend has answered.

## Error codes the app expects

Envelope: `{ "error": { "code", "message", "attemptsLeft"?, "retryAfterSec"?, "requestId"? } }`. `message` is for
logs; the app never shows it.

| HTTP | `code` | App shows |
|---|---|---|
| network failure | `NETWORK` | "Couldn't connect", Retry |
| (app time limit) | `TIMEOUT` | "Taking too long", Retry |
| 400 / 422 | `VALIDATION` or a flow code (`OTP_INVALID`...) | the flow's message, else "Some details don't look right" |
| 401 | `UNAUTHENTICATED` | "Your session has ended" → sign in again |
| 403 | `FORBIDDEN` | "You don't have access to this" |
| 404 | `NOT_FOUND` (also for other people's records) | "This isn't available any more" |
| 409 | `CONFLICT` or a flow code (`SLOT_UNAVAILABLE`, `IDENTITY_LOCKED`...) | the flow's message, else "This changed, refresh" |
| 429 | `RATE_LIMITED` + `retryAfterSec` (or `Retry-After`) | "Too many tries, wait N seconds" |
| 5xx | `SERVER_ERROR` | "Housefi is having a problem", Retry |
| 2xx with an unreadable body | `BAD_RESPONSE` | as server error |

Unknown codes are treated by their HTTP status.
