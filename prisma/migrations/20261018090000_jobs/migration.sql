-- CreateEnum
CREATE TYPE "quote_which" AS ENUM ('MAIN', 'EXTRA');

-- CreateEnum
CREATE TYPE "quote_line_kind" AS ENUM ('LABOUR', 'MATERIAL');

-- CreateEnum
CREATE TYPE "quote_review" AS ENUM ('CHECKING', 'FAIR', 'UNDER_REVIEW', 'CLEARED');

-- CreateEnum
CREATE TYPE "quote_decision" AS ENUM ('PENDING', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ticket_state" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "which" "quote_which" NOT NULL,
    "version" INTEGER NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "labour_paise" BIGINT NOT NULL,
    "material_paise" BIGINT NOT NULL,
    "total_paise" BIGINT NOT NULL,
    "review" "quote_review" NOT NULL DEFAULT 'CHECKING',
    "typical_min_paise" BIGINT NOT NULL,
    "typical_max_paise" BIGINT NOT NULL,
    "decision" "quote_decision" NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "superseded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "kind" "quote_line_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_paise" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID,
    "raised_by" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "state" "ticket_state" NOT NULL DEFAULT 'OPEN',
    "priority" "ticket_priority" NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_review_created_at_idx" ON "quotes"("review", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_booking_id_which_version_key" ON "quotes"("booking_id", "which", "version");

-- CreateIndex
CREATE INDEX "quote_lines_quote_id_sort_idx" ON "quote_lines"("quote_id", "sort");

-- CreateIndex
CREATE INDEX "support_tickets_state_priority_created_at_idx" ON "support_tickets"("state", "priority", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_booking_id_idx" ON "support_tickets"("booking_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express CHECK constraints).
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_totals_add_up" CHECK ("total_paise" = "labour_paise" + "material_paise" AND "labour_paise" >= 0 AND "material_paise" >= 0),
  ADD CONSTRAINT "quotes_main_minimum" CHECK ("which" <> 'MAIN' OR "total_paise" >= 10000),
  ADD CONSTRAINT "quotes_extra_positive" CHECK ("total_paise" > 0),
  ADD CONSTRAINT "quotes_version_positive" CHECK ("version" >= 1);
ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_name_length" CHECK (length("name") BETWEEN 1 AND 80),
  ADD CONSTRAINT "quote_lines_qty_range" CHECK ("qty" BETWEEN 1 AND 99),
  ADD CONSTRAINT "quote_lines_unit_positive" CHECK ("unit_paise" > 0);
-- At most one quote of each kind is waiting on the price check or the customer at a time.
CREATE UNIQUE INDEX "one_open_quote_per_kind" ON "quotes" ("booking_id", "which") WHERE NOT "superseded" AND "decision" = 'PENDING';
