-- Reminders (unpaid visit fee, scheduled visit soon, quote waiting, rate the visit) and technician account notices.

ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'PAY_REMINDER';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'BOOKING_REMINDER';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'JOB_REMINDER';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'QUOTE_REMINDER';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'RATE_REMINDER';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'PROFILE_SUSPENDED';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'PROFILE_REINSTATED';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'PROFILE_REJECTED';

-- Each reminder is sent once: the row is claimed (insert, on conflict nothing) in the transaction that writes it.
CREATE TABLE "booking_reminders" (
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  -- PAY, SOON, QUOTE:<event id>, RATE
  "key" text NOT NULL,
  "sent_at" timestamptz(6) NOT NULL,
  PRIMARY KEY ("booking_id", "key")
);
