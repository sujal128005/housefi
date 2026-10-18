-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('TECH_ASSIGNED', 'TECH_ON_THE_WAY', 'TECH_ARRIVED', 'QUOTE_READY', 'EXTRA_QUOTE', 'PAYMENT_DUE', 'BOOKING_COMPLETED', 'BOOKING_CANCELLED', 'NO_TECHNICIAN', 'JOB_OFFER', 'QUOTE_APPROVED', 'QUOTE_REVISION', 'QUOTE_DECLINED', 'EXTRA_APPROVED', 'EXTRA_DECLINED', 'PAYMENT_RECEIVED', 'JOB_CANCELLED', 'PROFILE_APPROVED', 'PROFILE_NEEDS_CORRECTION');

-- CreateEnum
CREATE TYPE "push_state" AS ENUM ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('ios', 'android', 'web');

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "push_token" TEXT NOT NULL,
    "platform" "device_platform" NOT NULL,
    "session_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "notification_kind" NOT NULL,
    "booking_id" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "push_state" "push_state" NOT NULL DEFAULT 'PENDING',
    "push_attempts" INTEGER NOT NULL DEFAULT 0,
    "push_claimed_at" TIMESTAMPTZ(6),
    "pushed_at" TIMESTAMPTZ(6),
    "sms_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_push_token_key" ON "devices"("push_token");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_seq_idx" ON "notifications"("user_id", "created_at" DESC, "seq" DESC);

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Added by hand (Prisma cannot express these).
-- The delivery worker only looks at notifications still waiting for push.
CREATE INDEX "notifications_push_waiting" ON "notifications" ("created_at") WHERE "push_state" IN ('PENDING', 'SENDING');
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_params_object" CHECK (jsonb_typeof("params") = 'object'),
  ADD CONSTRAINT "notifications_pushed_when_sent" CHECK (("push_state" = 'SENT') = ("pushed_at" IS NOT NULL));
ALTER TABLE "devices" ADD CONSTRAINT "devices_push_token_length" CHECK (char_length("push_token") BETWEEN 1 AND 512);
