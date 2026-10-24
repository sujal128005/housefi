-- Apprentice mode: mentors and apprentices, a trainee on a job (with the customer's consent), the apprentice share.
-- CreateEnum
CREATE TYPE "apprentice_link_state" AS ENUM ('REQUESTED', 'ACTIVE', 'DECLINED', 'ENDED');

ALTER TYPE "ledger_type" ADD VALUE 'APPRENTICE_SHARE';



ALTER TYPE "notification_kind" ADD VALUE 'APPRENTICE_REQUEST';
ALTER TYPE "notification_kind" ADD VALUE 'APPRENTICE_ACCEPTED';
ALTER TYPE "notification_kind" ADD VALUE 'TRAINEE_JOB';
ALTER TYPE "notification_kind" ADD VALUE 'TRAINEE_REMOVED';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "allow_trainee" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trainee_added_at" TIMESTAMPTZ(6),
ADD COLUMN     "trainee_helped" BOOLEAN,
ADD COLUMN     "trainee_id" UUID;

-- AlterTable
ALTER TABLE "technicians" ADD COLUMN     "mentor_open" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "apprentice_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "apprentice_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "category_id" "category_id" NOT NULL,
    "state" "apprentice_link_state" NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "apprentice_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apprentice_links_apprentice_id_state_idx" ON "apprentice_links"("apprentice_id", "state");

-- CreateIndex
CREATE INDEX "apprentice_links_mentor_id_state_idx" ON "apprentice_links"("mentor_id", "state");

-- CreateIndex
CREATE INDEX "bookings_trainee_id_idx" ON "bookings"("trainee_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trainee_id_fkey" FOREIGN KEY ("trainee_id") REFERENCES "technicians"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apprentice_links" ADD CONSTRAINT "apprentice_links_apprentice_id_fkey" FOREIGN KEY ("apprentice_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apprentice_links" ADD CONSTRAINT "apprentice_links_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One open (requested or active) apprenticeship per apprentice.
CREATE UNIQUE INDEX "apprentice_links_one_open" ON "apprentice_links" ("apprentice_id") WHERE "state" IN ('REQUESTED', 'ACTIVE');

-- The apprentice share is a credit like the job credits (text comparison: the enum value is new in this migration).
ALTER TABLE "earnings_ledger" DROP CONSTRAINT "earnings_sign_by_type";
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_sign_by_type" CHECK (
  ("type"::text IN ('VISIT_SHARE', 'LABOUR_SHARE', 'MATERIAL_REIMBURSE', 'APPRENTICE_SHARE') AND "amount_paise" > 0)
  OR ("type"::text IN ('CASH_COLLECTED', 'PAYOUT') AND "amount_paise" < 0)
  OR ("type"::text = 'ADJUSTMENT' AND "amount_paise" <> 0));
