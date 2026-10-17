-- CreateEnum
CREATE TYPE "offer_state" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "offer_channel" AS ENUM ('APP', 'SMS', 'IVR', 'COORDINATOR');

-- CreateEnum
CREATE TYPE "offer_reject" AS ENUM ('TOO_FAR', 'BUSY', 'NOT_MY_SKILL', 'OTHER');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "assigned_at" TIMESTAMPTZ(6),
ADD COLUMN     "matching_started_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "state" "offer_state" NOT NULL DEFAULT 'OPEN',
    "channel" "offer_channel" NOT NULL DEFAULT 'APP',
    "reject_reason" "offer_reject",
    "distance_m" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_area_pincodes" (
    "pincode" CHAR(6) NOT NULL,
    "near_pincode" CHAR(6) NOT NULL,

    CONSTRAINT "service_area_pincodes_pkey" PRIMARY KEY ("pincode","near_pincode")
);

-- CreateIndex
CREATE INDEX "job_offers_booking_id_technician_id_idx" ON "job_offers"("booking_id", "technician_id");

-- CreateIndex
CREATE INDEX "job_offers_technician_id_state_responded_at_idx" ON "job_offers"("technician_id", "state", "responded_at");

-- CreateIndex
CREATE INDEX "job_offers_state_expires_at_idx" ON "job_offers"("state", "expires_at");

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express partial unique indexes or CHECK constraints).
-- One open offer per booking and per technician: a booking is offered to one technician at a time, and a technician
-- sees one offer at a time.
CREATE UNIQUE INDEX "one_open_offer_per_booking" ON "job_offers" ("booking_id") WHERE "state" = 'OPEN';
CREATE UNIQUE INDEX "one_open_offer_per_technician" ON "job_offers" ("technician_id") WHERE "state" = 'OPEN';
ALTER TABLE "job_offers"
  ADD CONSTRAINT "job_offers_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "job_offers_reason_only_when_rejected" CHECK ("reject_reason" IS NULL OR "state" = 'REJECTED');
ALTER TABLE "service_area_pincodes"
  ADD CONSTRAINT "service_area_pincodes_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$' AND "near_pincode" ~ '^[1-9][0-9]{5}$'),
  ADD CONSTRAINT "service_area_pincodes_not_self" CHECK ("pincode" <> "near_pincode");
