-- Telephony (docs/TELEPHONY.md): job offers by phone call for keypad-phone technicians (IVR with a PIN), masked
-- calls between customer and technician, going online / offline by phone, and the coordinator's manual queue.

CREATE TYPE "call_state" AS ENUM ('REQUESTED', 'RINGING', 'ANSWERED', 'COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED');
CREATE TYPE "keypad_result" AS ENUM ('ACCEPT', 'REJECT', 'NONE', 'INVALID', 'PIN_FAILED', 'TOO_LATE');

ALTER TABLE "technicians"
  -- 4-digit PIN keyed before accepting a job by phone, stored only as an HMAC.
  ADD COLUMN "ivr_pin_hash" bytea,
  -- Consent to automated job calls, and the hours (IST) they agreed to be called.
  ADD COLUMN "ivr_consent_at" timestamptz(6),
  ADD COLUMN "call_hours_start" smallint CHECK ("call_hours_start" BETWEEN 0 AND 23),
  ADD COLUMN "call_hours_end" smallint CHECK ("call_hours_end" BETWEEN 1 AND 24),
  -- Who last set online / offline: APP, IVR, COORDINATOR, SYSTEM.
  ADD COLUMN "availability_source" text;

-- One row per phone call made for a job offer. Call states never change the offer by themselves: only a keypad accept
-- with the right PIN on an answered call does, through the same transaction as an app accept.
CREATE TABLE "offer_call_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "offer_id" uuid NOT NULL REFERENCES "job_offers"("id"),
  "provider" text NOT NULL,
  "provider_call_id" text UNIQUE,
  "state" "call_state" NOT NULL DEFAULT 'REQUESTED',
  "keypad_result" "keypad_result",
  "pin_attempts" smallint NOT NULL DEFAULT 0,
  "requested_at" timestamptz(6) NOT NULL,
  "answered_at" timestamptz(6),
  "ended_at" timestamptz(6),
  "duration_s" integer,
  "failure_reason" text
);
CREATE INDEX "offer_call_attempts_offer_idx" ON "offer_call_attempts" ("offer_id");

-- Bookings waiting for a person to assign them (no app or phone technician took them).
CREATE TABLE "dispatch_queue" (
  "booking_id" uuid PRIMARY KEY REFERENCES "bookings"("id"),
  "reason" text NOT NULL,
  "entered_at" timestamptz(6) NOT NULL,
  "claimed_by" uuid REFERENCES "users"("id"),
  "claimed_at" timestamptz(6),
  "resolved_at" timestamptz(6)
);
CREATE INDEX "dispatch_queue_open_idx" ON "dispatch_queue" ("entered_at") WHERE "resolved_at" IS NULL;

-- Masked calls: who may call whom through the Housefi number, for a booking, for a short time.
CREATE TABLE "call_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id"),
  "caller_id" uuid NOT NULL REFERENCES "users"("id"),
  "callee_id" uuid NOT NULL REFERENCES "users"("id"),
  "expires_at" timestamptz(6) NOT NULL,
  "created_at" timestamptz(6) NOT NULL
);
CREATE INDEX "call_grants_caller_idx" ON "call_grants" ("caller_id", "expires_at" DESC);

-- Provider callbacks already handled (deduplication; providers retry).
CREATE TABLE "telephony_events" (
  "event_id" text PRIMARY KEY,
  "received_at" timestamptz(6) NOT NULL
);
