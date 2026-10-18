-- Team demo accounts (DEMO_PHONES) and sign-in abuse limits.

-- A demo account belongs to the team. Its bookings are demo bookings: simulated payments, only demo technicians,
-- never shown to real customers or technicians, never in payouts.
ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- Whether the challenge cost an SMS (demo numbers do not). The service-wide SMS budget counts these.
ALTER TABLE otp_challenges ADD COLUMN sends_sms boolean NOT NULL DEFAULT true;
CREATE INDEX otp_challenges_sms_created_idx ON otp_challenges (created_at) WHERE sends_sms;

-- Progressive sign-in lock per phone number after wrong codes (OTP_LOCK_STEPS). One row per number that has had a
-- wrong code; deleted on a correct code (except after the final lock, which only support lifts).
CREATE TABLE otp_lockouts (
  phone_hash bytea PRIMARY KEY,
  level smallint NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_failure_at timestamptz NOT NULL
);
