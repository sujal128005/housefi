-- CreateEnum
CREATE TYPE "booking_mode" AS ENUM ('INSTANT', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE', 'COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "cancel_reason" AS ENUM ('PLANS_CHANGED', 'FIXED', 'TOO_LONG', 'MISTAKE', 'OTHER', 'UNPAID_EXPIRED', 'UNFULFILLED_EXPIRED');

-- CreateEnum
CREATE TYPE "close_reason" AS ENUM ('CUSTOMER_DECLINED', 'CUSTOMER_UNAVAILABLE', 'CANNOT_COMPLETE');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'COORDINATOR', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('VISIT', 'FINAL');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('UPI', 'CARD', 'NETBANKING', 'CASH');

-- CreateEnum
CREATE TYPE "payment_state" AS ENUM ('DUE', 'PROCESSING', 'PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "service_id" TEXT NOT NULL,
    "category_id" "category_id" NOT NULL,
    "address_snapshot_enc" BYTEA NOT NULL,
    "locality" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "location" geography(Point, 4326),
    "issue_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "voice_transcript" TEXT,
    "voice_object_key" TEXT,
    "voice_duration_sec" INTEGER,
    "time_mode" "booking_mode" NOT NULL,
    "window_date" DATE,
    "window_start_hour" SMALLINT,
    "window_end_hour" SMALLINT,
    "prefer_women_rated" BOOLEAN NOT NULL DEFAULT false,
    "status" "booking_status" NOT NULL,
    "technician_id" UUID,
    "arrival_code_enc" BYTEA NOT NULL,
    "start_code_attempts" INTEGER NOT NULL DEFAULT 0,
    "eta_min" INTEGER,
    "work_started" BOOLEAN NOT NULL DEFAULT false,
    "cancel_reason" "cancel_reason",
    "close_reason" "close_reason",
    "idempotency_key" TEXT NOT NULL,
    "idempotency_hash" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" BIGSERIAL NOT NULL,
    "booking_id" UUID NOT NULL,
    "status" "booking_status" NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "state" "payment_state" NOT NULL DEFAULT 'DUE',
    "method" "payment_method",
    "provider" TEXT,
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "provider_refund_id" TEXT,
    "idempotency_key" TEXT,
    "failure_code" TEXT,
    "settled_at" TIMESTAMPTZ(6),
    "refund_requested_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "bookings_customer_id_created_at_idx" ON "bookings"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_technician_id_status_idx" ON "bookings"("technician_id", "status");

-- CreateIndex
CREATE INDEX "bookings_status_window_date_idx" ON "bookings"("status", "window_date");

-- CreateIndex
CREATE INDEX "bookings_category_id_pincode_window_date_window_start_hour_idx" ON "bookings"("category_id", "pincode", "window_date", "window_start_hour");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_customer_id_idempotency_key_key" ON "bookings"("customer_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_at_idx" ON "booking_events"("booking_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_kind_idx" ON "payments"("booking_id", "kind");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express CHECK constraints).
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_mode_window" CHECK (
    ("time_mode" = 'INSTANT' AND "window_date" IS NULL AND "window_start_hour" IS NULL AND "window_end_hour" IS NULL)
    OR ("time_mode" = 'SCHEDULED' AND "window_date" IS NOT NULL
        AND "window_start_hour" IN (8, 10, 12, 14, 16, 18) AND "window_end_hour" = "window_start_hour" + 2)),
  ADD CONSTRAINT "bookings_code_format" CHECK ("code" ~ '^HF-[0-9]{5,8}$'),
  ADD CONSTRAINT "bookings_pincode_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$'),
  ADD CONSTRAINT "bookings_voice_duration" CHECK ("voice_duration_sec" IS NULL OR "voice_duration_sec" BETWEEN 0 AND 60),
  ADD CONSTRAINT "bookings_cancel_reason_only_when_cancelled" CHECK ("cancel_reason" IS NULL OR "status" = 'CANCELLED'),
  ADD CONSTRAINT "bookings_close_reason_only_when_closed" CHECK ("close_reason" IS NULL OR "status" = 'CLOSED_NO_REPAIR');
ALTER TABLE "bookings" ALTER COLUMN "issue_ids" SET NOT NULL;
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount_paise" >= 0);
