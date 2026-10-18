# Job offers by phone call (technicians without smartphones)

Status: **requirements only. Nothing here is implemented**, in the app, the demo backend or the backend. The
endpoints and tables below are **proposals** for the backend team to confirm. They are not in `openapi.yaml` and
`schema.sql` yet; add them there once agreed, so the contract tests stay the source of truth.

Housefi must be able to offer jobs to technicians who use a basic (keypad) phone, by an automatic phone call with
keypad answers (IVR), and fall back to a person (coordinator) when calling fails.

## 1. What the current documents cover (checked 2026-10-17)

| # | Requirement | What exists today | Verdict |
|---|---|---|---|
| 1 | Automatic allocation by service, location, availability, eligibility | README section 4 "Dispatch order" (approved, online, skill, PIN area, no active job, women-rated preference, distance, rating, fairness); STARTER-PROMPT step 8; `job_offers` with one open offer per booking and per technician (`schema.sql`); the accept transaction (STATE-MACHINE "Offers") | **Covered** for app users. **Gap:** "online" is set from the app (`POST /tech/availability`), so a keypad technician can never be eligible |
| 2 | Outbound calls through a telephony provider | `phone_type` (`SMARTPHONE`/`KEYPAD`/`NONE`) and `offer_channel` including `IVR` in `schema.sql`; `EXOTEL_*` names in `.env.example`; README section 9 lists "IVR via Exotel/Knowlarity" under **Later**. Only masked customer-technician calls are specified (`POST /bookings/{id}/call`, also later) | **Missing** |
| 3 | IVR accept/reject by keypad | One line in README section 9 ("press 1 to accept"), Later | **Missing** |
| 4 | Timeouts, no answer, busy, retries, rejection, fallback | 45 s offer expiry, reject reasons, next technician, 3 missed offers sets offline: all written for app offers | **Partly covered.** Nothing for call outcomes; 45 s is too short for a ringing call plus a spoken offer |
| 5 | Manual dispatcher when calling fails | `POST /coordinator/jobs/{jobId}/assign` and `/coordinator/jobs/{jobId}/actions/{action}` in `openapi.yaml`, audited; `actor_type COORDINATOR`. The `COORDINATOR` role itself is "later" (README section 7) | **Partly covered.** No queue of jobs needing a person, no trigger when calling fails, no sign-in for coordinators |
| 6 | Call outcomes tracked; starting a call never means accepted | Offer states and the accept transaction exist. No call records at all | **Missing** |
| 7 | Customer told only after a confirmed assignment | `TECH_ASSIGNED` and the technician card only at `ASSIGNED` (README section 4, STATE-MACHINE); the app shows the technician only from `ASSIGNED` | **Covered**, provided every channel uses the same accept transaction (section 4 below) |

The mobile app needs **no change** for any of this: customers see the same statuses, and keypad technicians do not use
the app.

## 2. Who can be called

- `phone_type = KEYPAD`: offers go out by IVR call. `phone_type = NONE`: never called; their jobs go to their
  coordinator (section 6).
- Only admins or coordinators set `phone_type`, the callable number and IVR consent (audited). A technician cannot
  switch themselves to KEYPAD from the app.
- The callable number is the technician's verified number (OTP or a verified call at onboarding), encrypted like
  other phone numbers. Calls go only to that number.
- Record consent to automated job calls (`ivr_consent_at`) and the call hours the technician agreed to. Confirm the
  telecom rules for automated calls (TRAI / DLT, caller ID) with the provider and legal.
- **Availability without an app:** the technician goes online or offline by calling an inbound IVR number ("press 1 to
  start taking jobs, 2 to stop"), or their coordinator sets it. Proposed: availability for KEYPAD technicians also
  ends automatically at the end of their agreed call hours. Store who set it (`availability_source`: APP, IVR,
  COORDINATOR, SYSTEM).

## 3. The call, step by step

Eligibility and ranking are unchanged (README section 4). The dispatcher picks the next technician, creates the
offer (`channel = IVR`), then asks the provider to call:

1. The call rings for up to **30 s** (proposed default, configurable).
2. When answered, the IVR plays in the technician's language (Telugu or English): service, **area only** (locality,
   PIN, never the house number or customer name, the same as the app offer), time (now or window), visit earning.
3. "Press 1 to accept, 2 to reject, 9 to hear again." Proposed: before accepting, the technician keys a 4-digit IVR
   PIN set at onboarding (stored as a hash; 3 wrong tries ends the call), so whoever picks up the phone cannot take
   the job.
4. On **1** (and the correct PIN), the backend runs the accept transaction (section 4). The IVR then says the real
   result: "Job confirmed" with the address sent by SMS to the technician, or "Sorry, this job is no longer
   available".
5. On **2**: offer `REJECTED` (reason `OTHER`, or a key for each reason), next technician at once.
6. No key, a wrong key 3 times, hang-up, voicemail: the offer is not accepted.

The offer's `expires_at` for IVR covers ringing plus the spoken offer: proposed **90 s** from the call request
(configurable), instead of the app's 45 s.

## 4. Call outcomes are not acceptance

- Keep **call state** apart from **offer state**. Proposed table `offer_call_attempts`: `id`, `offer_id`, `provider`,
  `provider_call_id` (unique), `state` (`REQUESTED`, `RINGING`, `ANSWERED`, `COMPLETED`, `NO_ANSWER`, `BUSY`,
  `FAILED`, `CANCELLED`), `keypad_result` (`ACCEPT`, `REJECT`, `NONE`, `INVALID`, `PIN_FAILED`), `requested_at`,
  `answered_at`, `ended_at`, `duration_s`, `failure_reason`.
- Requested, ringing, answered or completed **never** move the offer or the booking. Only a keypad **accept** on an
  answered call does, through **exactly the same transaction** as `POST /tech/offers/{offerId}/accept`: offer still
  `OPEN` and not expired, booking still `MATCHING`/`MATCHING_DELAYED`, technician has no active job, row lock on the
  booking. Anything else returns "no longer available" to the caller and changes nothing.
- A keypad answer that arrives after `expires_at`, for an offer that is no longer `OPEN`, or for a call that does
  not belong to that offer, is recorded and ignored.
- Provider callbacks are verified (provider signature or credentials plus an IP allow-list), deduplicated by provider
  event id, safe to receive twice or out of order (a late `RINGING` after `COMPLETED` changes nothing), and logged
  without phone numbers or keypad input.
- No call recordings by default. If the business wants them: consent, a private bucket, and a retention limit.

## 5. Busy, no answer, retries, fallback

| Outcome | Offer | Technician | Next |
|---|---|---|---|
| Accept (`1`, valid PIN, transaction succeeds) | `ACCEPTED` | assigned | booking `ASSIGNED`, customer gets `TECH_ASSIGNED` |
| Reject (`2`) | `REJECTED` | none | next technician at once |
| No answer, voicemail, no key | `EXPIRED` | counts as a missed offer | next technician at once |
| Busy | `EXPIRED` | not counted as missed | next technician; may be called again for this booking once, if nobody else is left and at least 2 min have passed |
| Provider error / call not placed | `WITHDRAWN` | not counted | next technician; counts toward the provider fallback below |
| Accept after the job was taken or expired | unchanged | told "no longer available" | none |

- Do not hold a booking on one technician while retrying: one open offer per booking still applies, so a retry is a
  new offer later in the order, not a wait.
- At most **2 call attempts per technician per booking**, and none outside their agreed call hours.
- 3 missed IVR offers in a row sets a KEYPAD technician offline, the same as app offers. Tell them by SMS and their
  coordinator.
- **Provider fallback:** if calls fail to be placed N times in a row (proposed 3 within 5 min) or the provider is
  unreachable, stop placing calls (circuit breaker), offer only to app technicians, and put KEYPAD-only bookings in
  the manual queue (section 6). Alert support.
- The booking timers do not change: `MATCHING_DELAYED` after about 10 min and `UNFULFILLED` after about 30 min,
  whatever the channel.

## 6. Manual dispatch (coordinator)

What exists in the contract: `POST /coordinator/jobs/{jobId}/assign` and
`POST /coordinator/jobs/{jobId}/actions/{action}`, both audited. What is still needed:

- **Coordinator sign-in** with the `COORDINATOR` role (README section 7 marks it "later"), limited to their own
  technicians and area.
- **A manual queue.** A booking enters it when: its best technicians are `NONE` phone type; calling is switched off
  or failing (section 5); it reached `MATCHING_DELAYED` with no app or IVR acceptance; or a technician's keypad
  answer could not be confirmed. Proposed: `GET /coordinator/dispatch-queue`, `POST /coordinator/dispatch-queue/{id}/claim`
  (one coordinator at a time), `POST /coordinator/dispatch-queue/{id}/release`.
- **Assigning by phone:** the coordinator phones the technician themselves, then calls the existing assign endpoint
  with the technician id and a required note ("confirmed by phone at 14:05"). It uses the same accept rules
  (booking still matching, technician approved and free); otherwise `CONFLICT`.
- **The offer history** for a booking, with each call attempt and outcome: proposed
  `GET /coordinator/jobs/{jobId}/offers`. Phone numbers masked.
- **Availability on someone's behalf:** proposed `POST /coordinator/technicians/{technicianId}/availability`.
- Every coordinator action is written to `audit_log` (`actor_type = COORDINATOR`).

## 7. What the customer sees

Unchanged, and that is the requirement: "Finding your technician" during `MATCHING`, "Still searching" at
`MATCHING_DELAYED`, and the technician only after `ASSIGNED` (`TECH_ASSIGNED` push and live update). Calls, rings,
retries and keypad answers are never shown to the customer and never trigger a customer notification.

## 8. Work to be done

**Telephony provider (Exotel, Knowlarity or similar; business to choose):**
- Account, KYC, an Indian virtual number and caller ID, DLT / telemarketing registration as required.
- Outbound call API with a callback URL, an IVR flow that collects keypad input, Telugu and English prompts (recorded
  or text-to-speech), an inbound number for go-online / go-offline.
- A sandbox or test mode, and confirmation of callback signing, retry behaviour and the callback event list.

**Backend team:**
1. A `TelephonyProvider` interface (place call, end call, verify callback) with a **fake provider** used in
   development and tests. No real numbers are dialled outside an approved test setup.
2. Schema: `offer_call_attempts`, call-state and keypad-result enums, on `technicians` add `callable_phone_enc`,
   `ivr_consent_at`, `ivr_pin_hash`, `call_hours`, `availability_source`; a `dispatch_queue` table.
3. Dispatcher: channel per technician (APP push, IVR call, coordinator), the IVR offer expiry, the outcome table in
   section 5, the circuit breaker.
4. Provider callbacks (proposed `POST /webhooks/telephony/{provider}/status` and `/webhooks/telephony/{provider}/keypad`):
   verified, deduplicated, idempotent, routed into the one accept transaction.
5. Inbound IVR for availability. SMS to the technician after acceptance (address, customer first name, booking code)
   and when set offline.
6. Coordinator role and sign-in, the queue and the endpoints in section 6.
7. Add the agreed endpoints to `openapi.yaml`, the tables to `schema.sql`, and the new transitions to
   `STATE-MACHINE.md`.
8. Tests (fake provider): accept, reject, no answer, busy, provider failure, keypad accept after expiry, accept racing
   an app technician's accept for the same booking (exactly one wins), duplicate and out-of-order callbacks, a forged
   callback, wrong PIN, the circuit breaker, a manual assignment, and a check that no customer notification is sent
   before `ASSIGNED`.

**Business / operations:** choose the provider; confirm the timings marked "proposed"; write the IVR script in Telugu
and English; decide whether the IVR PIN is required; coordinator staffing and hours; the legal check on automated
calls and consent.

**Mobile app:** none needed.
