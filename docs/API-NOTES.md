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
