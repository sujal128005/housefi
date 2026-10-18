# Phone calls: keypad-phone technicians, masked calls, coordinators

Built and tested with a fake provider (`test/telephony.e2e-spec.ts`). Real calls use **Exotel**. Turn them on with
`TELEPHONY_PROVIDER=exotel` once the account and the two call flows below exist. Make one test call per flow (your own
two phones) before go-live.

## How a booking reaches a technician

Each technician is ranked by the same rules: skill, area, online, free, women-rated preference, distance, rating,
fairness. One technician at a time is offered the job, through the channel that fits them:

| Technician | Channel | Time to answer |
|---|---|---|
| Smartphone | Push notification + Accept / Reject in the app | 45 s (`OFFER_TIMEOUT_SEC`) |
| Keypad phone | Automatic call: the service, the area (never the address), the time and the earning, in Telugu or English. **1** then their **4-digit PIN** accepts; **2** declines | Rings 30 s (`IVR_RING_TIMEOUT_SEC`); offer lasts 90 s (`IVR_OFFER_TIMEOUT_SEC`) |
| No phone, or calls unavailable | **Coordinator queue**: a coordinator claims the booking, phones their technician, and assigns it | — |

The rules that hold for every channel:

- **Exactly one technician wins.** The app's Accept, a keypad accept and a coordinator assignment all run the same
  locked transaction. A late accept hears "no longer available".
- **A call never accepts by itself.** Only 1 followed by the right PIN does. That is 3 PIN tries per call, and 6 wrong PINs a day
  stop phone acceptance for that technician.
- **Call outcomes:**
  - No answer, or hung up without a choice: next technician, counted as a miss. 3 misses in a row sets the
    technician offline.
  - Busy: next technician, not counted as a miss.
  - The call could not be placed: next technician, not counted.
- **Circuit breaker:** after 3 calls in a row fail to be placed (`IVR_CIRCUIT_FAILURES`), calling pauses for 5 minutes
  (`IVR_CIRCUIT_OPEN_MIN`). Meanwhile only app technicians are offered, and bookings their coordinators could cover go
  to the queue. The log says `ALERT phone calls failed…`.
- **The manual queue gets a booking when:**
  - nobody can be offered it but a coordinator's keypad or no-phone technician could do it; or
  - it is still unassigned after 10 minutes (`MATCHING_DELAYED`).
- **What the customer sees** is unchanged: "Finding your technician", then the technician only once assigned.
- **After a phone acceptance**, the technician gets an SMS with the booking code, the customer's first name and the
  address (`MSG91_JOB_TEMPLATE_ID`).
- **Calling hours:** keypad technicians are called only within their hours (default 8:00 to 20:00 IST), and go
  offline automatically when their hours end.

## Keypad technicians: registration and setup (coordinator)

1. `POST /v1/uploads/photos` with `stage: PROFILE`: take the technician's photo.
2. `POST /v1/coordinator/technicians`: their number, profile, `phoneType: KEYPAD` (or `NONE`), `photoUploadId`. The
   account is linked to the coordinator, and the profile goes to verification as usual.
3. `POST /v1/coordinator/technicians/{id}/aadhaar`: scan the Secure QR on their Aadhaar card.
4. `POST /v1/coordinator/technicians/{id}/phone-setup`: `{ phoneType: 'KEYPAD', pin: '5937', callHours: { start: 8, end: 20 }, consent: true }`.
   The technician chooses the PIN. Easy PINs (1111, 1234…) are refused. Consent to automated job calls is required.
5. Approval: `npm run tech -- approve <phone>`.
6. Online / offline: the technician calls the Housefi number and presses 1 or 2, or the coordinator uses
   `POST /v1/coordinator/technicians/{id}/availability`.

The queue: `GET /v1/coordinator/dispatch-queue`, `POST …/dispatch-queue/{bookingId}/claim` (one coordinator at a time),
`…/release`, then `POST /v1/coordinator/jobs/{bookingId}/assign`. To see every offer and call for a booking (no phone
numbers shown): `GET /v1/coordinator/jobs/{bookingId}/offers`.

## Masked calls (customer ↔ technician)

From assignment until payment, either side calls `POST /v1/bookings/{id}/call` (customer) or
`POST /v1/tech/jobs/{id}/call` (technician). The answer is `{ dialNumber }`, the Housefi ExoPhone.

The app opens the dialer with that number. Exotel asks us whom to connect, based on the caller's number and that
recent permission, valid for 30 minutes (`MASKED_CALL_GRANT_MIN`). Neither side ever sees the other's real number.

## Exotel setup (business / ops)

1. **Account and number:**
   - An Exotel account (KYC) and an ExoPhone (Indian virtual number) → `EXOTEL_CALLER_ID`.
   - API key and token → `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`; account SID → `EXOTEL_SID`.
   - The cluster: `api.in.exotel.com` (Mumbai) or `api.exotel.com` → `EXOTEL_SUBDOMAIN`.
   - Confirm the DLT / telemarketing registration for automated calls with Exotel.
2. **Webhook secret:** generate a random secret of 32 or more characters, e.g. `openssl rand -hex 24`, →
   `EXOTEL_WEBHOOK_SECRET`. Every callback URL below contains it. Optionally restrict callers to Exotel's IP addresses
   → `TELEPHONY_ALLOWED_IPS`.
   In the URLs below, `BASE` = `https://api.housefi.tech/v1/webhooks/telephony/exotel/<EXOTEL_WEBHOOK_SECRET>`.
3. **Offer flow** (App Bazaar → new app; its id → `EXOTEL_OFFER_FLOW_ID`):
   1. **Greeting**, dynamic text from URL `BASE/prompt`. It speaks the offer in the technician's language.
   2. **Gather**: 1 digit, timeout 10 s, prompt "Press 1 to accept, 2 to decline".
   3. **Passthru** `BASE/choice`:
      - 200 → Gather 4 digits ("Enter your 4-digit PIN"), then Passthru `BASE/pin`:
        - 200 → Greeting "Job confirmed. Details by SMS." → Hangup.
        - 302 → Greeting "Sorry, the job is no longer available or the PIN is wrong." → Hangup.
      - 302 → Greeting "Thank you." → Hangup.
4. **Inbound flow** on the ExoPhone (customers, technicians and keypad technicians all dial the same number):
   1. **Connect** applet, "dial whom" = dynamic URL `BASE/connect`. It returns the other party of a masked call.
      A 404 means nobody to connect, so the flow continues.
   2. If nothing connected: Gather 1 digit "Technicians: press 1 to start taking jobs, 2 to stop", then Passthru
      `BASE/availability`:
      - 200 → "Done".
      - 302 → "Sorry, we could not find your technician account".
5. **StatusCallback** for the outbound calls is set by the API (`BASE/status`, answered and terminal events).
6. **Job SMS:** a DLT-approved MSG91 template with variables `code`, `name`, `address` → `MSG91_JOB_TEMPLATE_ID`.
7. **Test** with two of your own phones before go-live:
   - accept with the PIN, a wrong PIN, decline, no answer, busy;
   - a masked call both ways;
   - online and offline by phone.

   Check the exact parameter names Exotel sends (`CustomField`, `digits`, `CallFrom`, `Status`). The API reads the
   usual variants, but confirm them in the Exotel call logs.

No call is ever recorded. Logs contain no phone numbers and no keypresses.
