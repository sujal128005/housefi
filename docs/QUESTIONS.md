# Questions for the app team

Found while reading the handoff and building. Each one says what the backend does until you answer
("the safest option", as `STARTER-PROMPT.md` asks).

## Contract mismatches

1. **`app-contract/MockBackend.ts` is an older version.** It has no technician side, notifications or
   `topProblems`; quotes have no `version`, `review`, `labourTotal` or `materialTotal`; `decideQuote` takes a
   boolean instead of `APPROVE | REVISION | DECLINE`. It would not compile against the `api.ts` / `types.ts` in the
   same zip. Please send the current version: it is meant to be the reference for dispatch, price check,
   revisions and earnings.
   *Until then:* we follow `README.md` and `STATE-MACHINE.md` for those rules.
2. **Upload response field names.** `openapi.yaml` `UploadTicket` returns `{ id, uploadUrl, expiresAt }`;
   `README.md` §6 says `{ photoId, uploadUrl, expiresAt }` and `{ audioId, uploadUrl }`.
   *Until then:* we follow `openapi.yaml` (`id`).
3. **Payment verify body.** `openapi.yaml` requires `razorpayOrderId, razorpayPaymentId, razorpaySignature`;
   `README.md` §6 lists only the last two.
   *Until then:* `openapi.yaml` (Razorpay's signature check needs the order id).
4. **Automatic cancellations.** `schema.sql` has cancel reasons `UNPAID_EXPIRED` and `UNFULFILLED_EXPIRED`, but
   `CancelReason` in `types.ts` / `openapi.yaml` does not. What should `cancelReason` be when the system cancels
   (unpaid after 30 min, unfulfilled after 24 h)?
   *Until then:* stored internally, returned as `null`.
5. **No error code for server failures.** `ErrorBody.code` has no value for an unexpected 500.
   *Until then:* we return `INTERNAL` with HTTP 500. Please add it to the enum and to `ApiErrorCode` (the app can
   treat it like `NETWORK`: "try again").
6. **`RATE_LIMITED`** is in `openapi.yaml` but not in the app's `ApiErrorCode` (README already notes this).

## Missing pieces

7. **Is "Now" available?** README §8 says the app needs to know whether instant booking is available, but no
   endpoint returns it; the app only finds out from `INSTANT_UNAVAILABLE` on `POST /bookings`. Do you want e.g.
   `GET /availability/instant?serviceId=&pincode=` → `{ available: boolean }`?
8. **Technician closing an unanswered quote.** `STATE-MACHINE.md` lets the technician close as `CUSTOMER_DECLINED`
   30 min after an unanswered quote, but no endpoint or `TechIssue` value does that.
   *Until then:* not implemented; the technician can use `CANNOT_COMPLETE` or support.
9. **Locality for offers.** `JobOffer.area` and `bookings.locality` need a locality ("Banjara Hills"), but
   `AddressInput` has no locality field. Where should it come from: a new optional `locality` field, the street,
   or reverse geocoding?
   *Until then:* derived from the last comma-separated part of `street`, falling back to the city.
10. **Slot capacity.** `FULL` slots depend on capacity per service area, but `schema.sql` has no capacity table and
    the demo marks slots full at random. What capacity rule do you want for v1 (e.g. N bookings per window per
    category per PIN group)?
11. **Coordinators and technician approval.** OTP accepts only `CUSTOMER` and `TECHNICIAN`, so a coordinator
    cannot sign in, and there is no endpoint to approve a technician.
    *Until then:* a CLI command / internal endpoint protected by an admin key (README §12 allows this).
12. **`/me` for technicians.** `GET/PATCH/DELETE /me` return the `Customer` shape, but technicians are asked to
    send `locale` to `PATCH /me` too. Should `/me` work for both roles (returning `Customer` or `TechProfile`), or
    should technicians use `/tech/me`?

## Small ones

13. "Typical max = 4 × `repairFrom`" gives ₹596 for `plumb-tap`, but `examples/booking.json` shows ₹600. Round to
    the nearest ₹50?
14. `RatingInput.tags` accepts any string, while `Rating.tags` only allows the six known tags.
    *Until then:* input is validated against the six tags.
15. Demo-only fields: the real backend sends `demo: false`, `viaTechApp: true`, `practice: false`, and voice notes
    without `simulated`. The app's types currently say `demo: true` (literal), so they need relaxing.
16. Product decisions still open (from README): the optional "I am a woman" field for the women-rated badge, and
    the Telugu speech-to-text provider.
