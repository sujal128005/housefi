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
   *Until then (done in step 4):* derived from the last comma-separated part of `street` ("Road No. 12, Banjara
   Hills" gives "Banjara Hills"), falling back to the city.
10. **Slot capacity.** `FULL` slots depend on capacity per service area, but `schema.sql` has no capacity table and
    the demo marks slots full at random. What capacity rule do you want for v1 (e.g. N bookings per window per
    category per PIN group)?
    *Until then (done in step 4):* N bookings per window per category per PIN code. N comes from
    `SLOT_CAPACITY_PER_WINDOW` (10), with per-PIN overrides in `slot_capacities`. Also, `/slots` has no way to
    know the area: could the app send `pincode` (the chosen address's PIN) with `GET /slots`? The backend
    already accepts it.
11. **Coordinators and technician approval.** OTP accepts only `CUSTOMER` and `TECHNICIAN`, so a coordinator
    cannot sign in, and there is no endpoint to approve a technician.
    *Until then:* a CLI command / internal endpoint protected by an admin key (README §12 allows this).
12. **`/me` for technicians.** `GET/PATCH/DELETE /me` return the `Customer` shape, but technicians are asked to
    send `locale` to `PATCH /me` too. Should `/me` work for both roles (returning `Customer` or `TechProfile`), or
    should technicians use `/tech/me`?
    *Until then (step 3):* `/me` works for both roles and returns the `Customer` shape (`id`, `phone`, `name`).

## Small ones

13. "Typical max = 4 × `repairFrom`" gives ₹596 for `plumb-tap`, but `examples/booking.json` shows ₹600. Round to
    the nearest ₹50?
14. `RatingInput.tags` accepts any string, while `Rating.tags` only allows the six known tags.
    *Until then:* input is validated against the six tags.
15. Demo-only fields: the real backend sends `demo: false`, `viaTechApp: true`, `practice: false`, and voice notes
    without `simulated`. The app's types currently say `demo: true` (literal), so they need relaxing.
16. Product decisions still open (from README): the optional "I am a woman" field for the women-rated badge, and
    the Telugu speech-to-text provider.

## Found in step 2 (auth)

17. **Technician sign-in before the profile exists.** `AuthResult.technician` is a full `TechProfile`, whose required
    fields (`gender`, `skills` with at least 1 item, `name` with at least 2 characters, ...) cannot be filled before
    `PUT /tech/profile`. What should a new technician get?
    *Until then:* empty strings, `skills: []`, `gender: "M"` as a placeholder, `verification: null`, `isNew: true`.
    This does not validate against `openapi.yaml`. Options: make those fields optional or nullable while
    `verification` is null, or return `technician: null` with `isNew: true`.
18. **Concurrent refreshes.** Two refreshes with the same token count as reuse and end the session (see
    API-NOTES.md). Is single-flight refresh in `HttpBackend` fine, or do you need a short grace window?
19. **SMS language.** `PATCH /me` stores `locale`, but MSG91 sends whatever DLT template is configured. Do you want
    a Telugu template for Telugu users (a second `MSG91_OTP_TEMPLATE_ID_TE`)?

## Found in step 3 (users and catalog)

20. **Service ratings and review counts** are demo numbers from the app catalog (e.g. 4.8 from 1,240 reviews).
    Should the API serve them until real ratings exist, or should the app hide them for now? They are shown as they
    are today.
21. **Deleting an account with a technician account on the same phone** deletes only the account that asked; the
    other stays. Is that what the app expects?

## Found in step 4 (addresses and slots)

22. **GPS coordinates are stored unencrypted** (like the city and PIN code) so dispatch can measure distances.
    They pinpoint a home, so please confirm this matches your privacy notice. Rounding them (for example to
    about 100 m) would be an option.
23. **Should addresses outside India be rejected?** Today any valid latitude and longitude is accepted.

## Found in step 5 (bookings)

24. **Booking codes have room for only 90,000 bookings.** `HF-` plus 5 digits gives 90,000 codes, and
    collisions get frequent long before that. After repeated collisions the backend falls back to 6 digits. Is a
    longer code fine for the app (e.g. `HF-123456`), or should codes use letters too?
25. **A payment can arrive after the unpaid booking expired.** The 30-minute expiry can race with a slow
    payment (Razorpay checkout still open). Step 6 will refund automatically when a payment is confirmed for a
    booking that was already cancelled. Please confirm that's what you want, rather than reviving the booking.
26. **Cancelling an unpaid booking needs no reason**, and cancelling twice returns the booking unchanged. Is that
    fine for the app's retry logic?

## Found in step 6 (payments)

27. **Razorpay test keys** (key id, key secret, webhook secret) are needed to try payments for real. Everything is
    tested against a fake Razorpay so far. Who owns the Razorpay account?
28. **Capture setting:** the backend captures `authorized` payments itself, so it works whether or not automatic
    capture is enabled on the Razorpay account. Should automatic capture be on (recommended)?
29. **Refund speed:** refunds are requested at `normal` speed (5-7 working days, free). Should instant refunds be
    used for the ₹49 visit fee? They cost a fee.
30. **Failed refunds** (`refund.failed`) are flagged `REFUND_FAILED` and logged. Until support tickets exist
    (step 13), someone has to check for them. Who should be alerted?

## Found in step 7 (technicians)

31. **Who verifies technicians, and against what?** `npm run tech` lists the details a reviewer sees (name, phone,
    skills, area, vehicle). What checks should they do before approving (a phone call, an ID photo later)?
32. **Should editing an approved profile need re-approval?** The backend says yes: it goes back to `PENDING` and
    offline. Would you rather allow some edits (vehicle, areas) without review?
33. **Gender** is used for the women-rated badge and the "prefer technicians rated highly by women" option. The
    contract only allows `M` and `F`. Should there be an "other" or "prefer not to say" choice?

## Found in step 8 (dispatch)

34. **New technicians have no rating**, but `Technician.rating` must be a number. The backend sends 0. Could the
    app show "New" for 0, or should the field allow `null`?
35. **Distance when a location is unknown:** `JobOffer.distanceKm` is sent as 0. Should it allow `null`, so the
    app can hide it?
36. **Scheduled bookings are searched as soon as they are paid**, and give up after 30 minutes like instant ones,
    even when the visit is days away. Should scheduled bookings be searched later (e.g. the evening before), or
    get a longer search?
37. **"No active job" includes a scheduled job tomorrow**, so a technician with an accepted future visit gets no
    new offers until it is done. Should only jobs happening now count?
38. **Neighbouring PIN codes:** dispatch matches the booking's PIN plus neighbours from `service_area_pincodes`,
    which is empty. Who can provide the neighbour list for Hyderabad?

## Found in step 9 (job actions)

39. **Extra work rules:** README §5 says every quote needs a labour line and at least ₹100, but the app's demo
    extras are a single material (e.g. "New tap ₹340"). The backend applies the rule to the repair quote only.
    Is that right?
40. **One approved extra per job**, because the contract has a single `extraQuote`. Is that enough, or can a
    repair need several approved extras?
41. **Unanswered quotes:** STATE-MACHINE.md says the technician may close the visit as `CUSTOMER_DECLINED` after
    30 minutes without an answer, and reminds the customer after 5. There is no endpoint for the first (QUESTIONS.md
    #8); reminders come with notifications (step 11). Should a 30-minute timeout close it automatically instead?
42. **ETA** is a straight-line estimate (x1.4 at 20 km/h). Is that good enough until a routing API (Google
    Distance Matrix) is added?
