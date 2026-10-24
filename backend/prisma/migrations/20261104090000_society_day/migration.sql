-- Society repair day: a building books one technician for the day; each flat pays a lower visit fee.
-- CreateEnum
CREATE TYPE "society_day_state" AS ENUM ('OPEN', 'CONFIRMED', 'ASSIGNED', 'CANCELLED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "society_day_id" UUID;

-- CreateTable
CREATE TABLE "society_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "organiser_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" "category_id" NOT NULL,
    "city" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "window_date" DATE NOT NULL,
    "window_start_hour" SMALLINT NOT NULL,
    "window_end_hour" SMALLINT NOT NULL,
    "state" "society_day_state" NOT NULL DEFAULT 'OPEN',
    "lead_booking_id" UUID,
    "technician_id" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "society_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "society_days_code_key" ON "society_days"("code");

-- CreateIndex
CREATE UNIQUE INDEX "society_days_lead_booking_id_key" ON "society_days"("lead_booking_id");

-- CreateIndex
CREATE INDEX "society_days_state_window_date_idx" ON "society_days"("state", "window_date");

-- CreateIndex
CREATE INDEX "society_days_organiser_id_idx" ON "society_days"("organiser_id");

-- CreateIndex
CREATE INDEX "bookings_society_day_id_idx" ON "bookings"("society_day_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_society_day_id_fkey" FOREIGN KEY ("society_day_id") REFERENCES "society_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "society_days" ADD CONSTRAINT "society_days_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "society_days" ADD CONSTRAINT "society_days_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

