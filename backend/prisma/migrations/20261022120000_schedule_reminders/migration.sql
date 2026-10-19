-- Reminders for the technician's day: the evening before a scheduled visit (both sides) and the morning plan.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'BOOKING_TOMORROW';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'JOB_TOMORROW';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'JOB_DAY_PLAN';
