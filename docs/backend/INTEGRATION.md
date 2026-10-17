# Connecting the app to the real backend

Status: **the app is ready to be connected, not connected.** Every screen talks to the backend only through the
`Backend` interface in `src/services/api.ts`. Today the only implementation is the demo backend
(`src/services/mock/MockBackend.ts`). The live implementation is still to be written, once the endpoints below are
confirmed.

## How the app chooses its backend

`src/services/createBackend.ts`, from build-time settings:

| Setting | Result |
|---|---|
| nothing, or `EXPO_PUBLIC_HOUSEFI_BACKEND=demo` | Demo backend (synthetic data, labelled "Demo" everywhere) |
| `EXPO_PUBLIC_HOUSEFI_BACKEND=live` + `EXPO_PUBLIC_HOUSEFI_API_URL=https://...` | Live backend. Until the HTTP client exists this **fails at start on purpose**: the app never falls back to demo data silently |

Every call, demo or live, has a 25 s limit (`services/timeouts.ts`).

## What is ready on the app side

| Piece | Where |
|---|---|
| The contract the screens use (methods, models, error codes) | `src/services/api.ts`, `src/domain/types.ts` |
| HTTP plumbing: https only, encoded paths, `Authorization: Bearer`, `Idempotency-Key`, `Accept-Language`, time limit, status and error-envelope mapping | `src/services/http/transport.ts` |
| Response checks (identity and verification so far); an answer that doesn't match becomes `BAD_RESPONSE` | `src/services/http/decode.ts` |
| One mapping from error codes to what people see (words, Retry or not, sign in again) | `src/services/errorText.ts` |
| Session tokens in the Keychain / Keystore; a server answer of "session ended" forgets the token | `src/state/sessionTokens.ts`, `src/state/AppState.tsx` |
| The service catalogue loaded from `GET /catalog/...` at start (bundled list only as a fallback) | `src/data/catalog.ts` (`hydrateCatalog`) |
| Demo labels shown only with the demo backend; `demo`, `simulated`, `verifyIsDemo` and `fictional` flags read from responses | `useIsDemo()` in `src/services/ServicesProvider.tsx` |
| Tests: transport against a fake server, decoders, error mapping, backend selection, catalogue, "no screen imports the demo backend" | `src/__tests__/integration.test.ts`, `src/__tests__/architecture.test.js` |

## Writing the live client

Create `src/services/http/HttpBackend.ts` implementing `Backend` with `createTransport(...)`, one method per row of
the API table in `README.md` (section 6), each with a decoder. Then return it from `createBackend` for
`kind: 'live'`. No screen changes. Keep `mode: 'LIVE'` and `demo: null`.

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

## Still needed from the backend team (the app does not guess these)

1. **Confirm the endpoints and bodies** in `openapi.yaml` (written from the app's side), or send the final spec.
2. **Auth flow:** token lifetime, refresh-token endpoint and rotation, sign-out revocation. Today the app keeps one
   token per account and asks people to sign in again when it is refused.
3. **Live updates:** `bookings.watch` / `tech.watchJob` / job offers poll today; confirm SSE or WebSocket and its URL.
4. **Uploads:** problem photos and the technician's registration photo (`POST /uploads` with `kind`?), sizes and
   types, signed `https` URLs for reading.
5. **Idempotency:** confirm `Idempotency-Key` on booking creation and payments, and how long keys are remembered.
6. **Payments:** the Razorpay (or other) order / confirmation flow; the app shows "paid" only after the server says so.
7. **Identity:** `simulated: false`, `verifyIsDemo: false`, `fictional: false` on every live response; the
   verification page domain for QR codes; who approves photos and identities (admin portal).
8. **Error envelope:** confirm the shape above and that `message` never carries personal data.
9. **Catalogue:** confirm `GET /catalog/categories` and `GET /catalog/services` return the `Category` / `Service`
   shapes (localized names in English and Telugu, issues, visit fee).
10. **Pagination** for bookings, jobs, notifications and earnings once lists grow.
