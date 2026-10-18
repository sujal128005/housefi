-- CreateEnum
CREATE TYPE "ledger_type" AS ENUM ('VISIT_SHARE', 'LABOUR_SHARE', 'MATERIAL_REIMBURSE', 'CASH_COLLECTED', 'ADJUSTMENT', 'PAYOUT');

-- CreateEnum
CREATE TYPE "payout_state" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "earnings_ledger" (
    "id" BIGSERIAL NOT NULL,
    "technician_id" UUID NOT NULL,
    "booking_id" UUID,
    "type" "ledger_type" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "payout_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "earnings_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "technician_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "state" "payout_state" NOT NULL DEFAULT 'PENDING',
    "provider_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "earnings_ledger_technician_id_created_at_idx" ON "earnings_ledger"("technician_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "earnings_ledger_technician_id_payout_id_idx" ON "earnings_ledger"("technician_id", "payout_id");

-- CreateIndex
CREATE INDEX "payouts_state_created_at_idx" ON "payouts"("state", "created_at");

-- AddForeignKey
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express these).
-- A job is credited once per kind of entry, however often the code path that closes it runs.
CREATE UNIQUE INDEX "earnings_once_per_job" ON "earnings_ledger" ("booking_id", "type") WHERE "booking_id" IS NOT NULL;
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_sign_by_type" CHECK (
  ("type" IN ('VISIT_SHARE', 'LABOUR_SHARE', 'MATERIAL_REIMBURSE') AND "amount_paise" > 0)
  OR ("type" IN ('CASH_COLLECTED', 'PAYOUT') AND "amount_paise" < 0)
  OR ("type" = 'ADJUSTMENT' AND "amount_paise" <> 0));
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_job_entries_have_booking" CHECK ("type" IN ('ADJUSTMENT', 'PAYOUT') OR "booking_id" IS NOT NULL);
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_period_order" CHECK ("period_end" >= "period_start"),
  ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount_paise" > 0),
  ADD CONSTRAINT "payouts_paid_has_reference" CHECK ("state" <> 'PAID' OR ("provider_ref" IS NOT NULL AND "paid_at" IS NOT NULL));

-- Append-only: rows are never deleted, and the only change allowed is linking a row to (or, for a failed payout,
-- unlinking it from) the payout that settles it. Corrections are new ADJUSTMENT rows.
CREATE FUNCTION "earnings_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'earnings_ledger is append-only';
  END IF;
  IF NEW.id <> OLD.id OR NEW.technician_id <> OLD.technician_id OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.type <> OLD.type OR NEW.amount_paise <> OLD.amount_paise OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'earnings_ledger is append-only (only payout_id may change)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "earnings_ledger_append_only" BEFORE UPDATE OR DELETE ON "earnings_ledger"
  FOR EACH ROW EXECUTE FUNCTION "earnings_ledger_append_only"();
