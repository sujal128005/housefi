# Review prompt for the backend (paste into Claude Code when the backend is built)

Use this after the build from `STARTER-PROMPT.md` is finished, in the backend repository, on a local or test setup.
Paste everything below the line. It does for the backend what the app's security and reliability pass did for the
app: find mistakes, leaks and security holes, fix them, prove each fix with a test, and report honestly.

---

You are reviewing and hardening the **Housefi** backend before the mobile app is connected to it. The app is finished
on its side and expects the contract in `docs/` exactly (`README.md`, `STATE-MACHINE.md`, `openapi.yaml`,
`schema.sql`, `examples/`, `INTEGRATION.md`). Find and fix mistakes, data leaks and security holes, prove every fix
with a test, and report what you actually checked.

## Ground rules

- Use only synthetic data and local or test environments: Docker Compose, Razorpay **test mode**, SMS turned off (OTP
  printed to the log in development only). Do not connect to production databases, keys or services. Do not use real
  personal information, contact real people, or trigger real payments, SMS or identity checks.
- Fix problems directly in the code and add a test for each one. Do not weaken or delete tests, skip checks, silence
  meaningful errors or remove protections to make a build pass. Do not say a test passed unless you ran it and saw
  the result.
- Do not change `openapi.yaml` to fit the code. If the contract itself is wrong, write the problem and the reason in
  `docs/API-NOTES.md` so the app team can agree the change.
- Do not commit, push, merge, deploy, or change repository settings, secrets or branch protection. Leave the changes
  in the working tree for review.

## 1. The contract the app depends on

- An automated test checks every endpoint's responses, success and error, against `openapi.yaml`: camelCase names,
  money as whole rupees, timestamps as epoch milliseconds, enums exactly as listed.
- Every error is `{ "error": { "code", "message", "requestId", "attemptsLeft"?, "retryAfterSec"? } }` with a code from
  the contract, and the HTTP status matches what the app maps:

  | HTTP | code |
  |---|---|
  | 400 / 422 | `VALIDATION` or a flow code (`OTP_INVALID`, `OTP_EXPIRED`...) |
  | 401 | `UNAUTHENTICATED` |
  | 403 | `FORBIDDEN` |
  | 404 | `NOT_FOUND` (also for other people's records) |
  | 409 | `CONFLICT` or a flow code (`SLOT_UNAVAILABLE`, `IDENTITY_LOCKED`, `OFFER_EXPIRED`...) |
  | 429 | `RATE_LIMITED` with `retryAfterSec` and a `Retry-After` header |
  | 5xx | `SERVER_ERROR` |

- No error, of any kind, returns a stack trace, SQL, a file path, an internal service name, personal data, a code or
  a token, and that includes `message`. Test it by forcing a database error and a thrown exception.
- Live responses always say they are real: `demo: false`, `verificationSimulated: false`, `simulated: false`,
  `verifyIsDemo: false`, `fictional: false`, `demoCode: null`. The app shows "Verified" and hides its demo labels
  based on these, so a test must fail if any live response sends anything else.
- `Idempotency-Key` on booking creation and payment creation: the same key with the same body returns the first result
  and never creates a second booking or order. The same key with a different body is refused.

## 2. Who can see and do what

For every endpoint, write tests with two customers, two technicians, a coordinator and no token:

- No token, an expired token, a tampered token or a refresh token used as an access token: `401`.
- Wrong role (a customer calling `/tech/...`, a technician calling customer endpoints): refused.
- Someone else's booking, address, job, offer, quote, payment, rating, ID card or notification: `404`, never `403`,
  and never a hint that it exists. Try every id-taking endpoint, including list filters and query parameters.
- Technicians never get the customer's phone number or exact address before accepting. Customers never get a
  technician's phone number (masked numbers only).
- Every action in `STATE-MACHINE.md` "Who may do what" is allowed only for that actor in that state; anything else
  is `CONFLICT`. Test each forbidden transition, not just the allowed ones.
- Requests cannot set fields they do not own: try sending `status`, `price`, `total`, `paid`, `role`, `verification`,
  `techCode`, `userId` or someone else's ids in bodies. They must be rejected or ignored.

## 3. Money and payments

- All amounts are computed on the server. Sending a different amount, a negative or fractional amount, or a changed
  quote total from the app changes nothing.
- A payment becomes `PAID` only from a verified Razorpay signature or webhook (test mode), or a technician's cash
  confirmation for the final bill. Test a bad signature, a replayed webhook (same event id), a webhook for another
  booking's order, out-of-order webhooks, and a payment "verify" call without a real payment. None of them may mark
  anything paid.
- Refunds follow the README rules exactly and happen once. Test cancelling twice at the same time.
- The earnings ledger is append-only and balances. Test that no endpoint can edit or delete a ledger row.

## 4. Races and repeats

Run these with real concurrency (parallel requests), not one after another:

- Two technicians accept the same offer: exactly one wins and the other gets `OFFER_EXPIRED` or `CONFLICT`.
- The same booking is created twice in parallel with one idempotency key, and the last slot is booked by two
  customers at once: one booking each time, never an overbooked slot.
- Start-code guessing: 5 wrong attempts lock it, and parallel guesses cannot get past the limit.
- OTP: 3 wrong attempts lock it, the resend wait and hourly limits hold, and parallel verifies cannot get past them.
- Refresh token reuse revokes the whole family, including when two refreshes race.
- Timers (offer expiry, unpaid auto-cancel, `MATCHING_DELAYED`, `UNFULFILLED`) do the right thing if the state already
  changed, and do not fire twice after a worker restart.

## 5. Input and uploads

- Every body, query and path parameter is validated: lengths, enums, integers, array sizes, unknown fields. Send
  oversized strings, emoji and Telugu text, nulls, wrong types, huge numbers, SQL and script fragments, and path
  tricks (`../`, encoded slashes). Expect `VALIDATION`, never `500`.
- Uploads accept only the listed types and sizes, are checked by content and not just by name, have EXIF location
  removed, go to a private bucket, and are read only through short-lived signed `https` URLs. Test a fake image, an
  oversized file and an SVG/HTML upload.
- No request can make the server fetch an arbitrary URL.

## 6. Technician identity

Check everything in README section 6b, with tests:

- The first profile submission needs a photo, fixes the legal name and issues the Technician ID. A later different
  name is `IDENTITY_LOCKED` and a later photo is ignored, enforced in the database as well as the API.
- Technician IDs are random (CSPRNG, the documented alphabet), unique, never reused, and never accepted as a
  credential or as permission to read anything.
- Only `APPROVED` technicians go online or get offers. `SUSPENDED` takes them offline, and every customer-facing read
  (booking, ID card, verification page) shows it at once.
- ID cards: only the technician themself and the customer of a booking with that technician currently assigned;
  everyone else gets `404`. `Cache-Control: no-store`. Never an ID-document image or number, date of birth, home
  address or phone number.
- Verification page: random token, only its hash stored, no personal data in the URL, rate limited, `noindex`,
  approved photo only, first name and last initial only.

## 7. Leaks, logs and configuration

- Logs: run the full happy path and every failure path, then search the logs for the test phone numbers, addresses,
  OTPs, start codes, tokens, `Authorization` headers and card or verification bodies. There must be none.
- Personal fields are encrypted at rest as the README says. Check the raw database rows, not just the API.
- Secrets come only from the environment or the secrets manager. Search the repository and its git history for keys,
  passwords and `.env` files.
- Production settings: no debug output, no development OTP logging, HTTPS only with HSTS, helmet headers, CORS
  allow-list (no `*` with credentials), rate limits on, Swagger and test endpoints off or protected, admin and
  coordinator actions audited.
- `npm audit` and Dependabot have no high or critical issues; CodeQL runs in CI.

## 8. Reliability

- Health check reports database, Redis and storage. If Redis or storage goes down, requests fail with
  `SERVER_ERROR` quickly and recover by themselves, without corrupting bookings.
- Every outgoing call (Razorpay, SMS, push, storage) has a time limit, and a failure is recorded and retried by a
  job, never left half done.
- Migrations run from empty and from the previous release. Backups can be restored.

## 9. End to end

Run against Docker Compose with the seeded test accounts:

- The full happy path: book, pay (Razorpay test), offer, accept, trip, arrive, start code, quote, approve, work,
  complete, final payment, rate, earnings.
- Every failure path in `STATE-MACHINE.md`: cancellations at each stage, refunds, offer timeouts, reassignment,
  unfulfilled, quote revision and decline, customer unavailable, cannot complete, unsafe report.
- English and Telugu (`Accept-Language: te`): catalogue names and any server text come back in the right language.

## Finish with

A short report in `docs/REVIEW.md`:

1. Each problem found, how serious it was, how it was fixed, and the test that proves it.
2. The checks actually run and their results (command and outcome). Say plainly what was not run and why.
3. Anything that still needs a decision or another team: contract questions for the app team, production setup
   (KMS keys, Razorpay live keys, SMS provider, domain for the verification page), legal or DPDP items.

Do not claim the backend is production ready unless every section above was checked and passes.

## After this: connecting the app (app team)

When the report is clean, the app team writes `src/services/http/HttpBackend.ts` against a **test** deployment
(see `INTEGRATION.md`), then runs the app's own checks with `EXPO_PUBLIC_HOUSEFI_BACKEND=live`: typecheck, lint, unit
tests, and the English and Telugu journeys on the emulator. Both sides confirm no demo label shows, every error
message is the app's own wording, and nothing personal appears in either side's logs.
