-- Growth: services editable in HQ, coupons, invoices, warranty revisits, announcements, the parts price list.
-- CreateEnum
CREATE TYPE "coupon_kind" AS ENUM ('FLAT', 'PERCENT');

-- AlterEnum
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT';

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "edited_in_hq_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warranty_of" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "coupon_code" TEXT,
ADD COLUMN     "discount_paise" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "quote_lines" ADD COLUMN     "part_id" UUID;

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "coupon_kind" NOT NULL,
    "value" INTEGER NOT NULL,
    "max_discount_paise" BIGINT,
    "min_bill_paise" BIGINT NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMPTZ(6),
    "valid_to" TIMESTAMPTZ(6),
    "max_uses" INTEGER,
    "per_customer" INTEGER NOT NULL DEFAULT 1,
    "first_booking_only" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "coupon_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "discount_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGSERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "booking_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audience" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "title_te" TEXT NOT NULL,
    "body_te" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" "category_id" NOT NULL,
    "service_id" TEXT,
    "name_en" TEXT NOT NULL,
    "name_te" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "price_paise" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_booking_id_key" ON "coupon_redemptions"("booking_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "coupon_redemptions"("coupon_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_customer_id_idx" ON "coupon_redemptions"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_seq_key" ON "invoices"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_booking_id_key" ON "invoices"("booking_id");

-- CreateIndex
CREATE INDEX "announcements_created_at_idx" ON "announcements"("created_at" DESC);

-- CreateIndex
CREATE INDEX "parts_category_id_active_sort_idx" ON "parts"("category_id", "active", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_warranty_of_key" ON "bookings"("warranty_of");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_warranty_of_fkey" FOREIGN KEY ("warranty_of") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_check" CHECK ("value" > 0 AND ("kind" <> 'PERCENT' OR "value" <= 100));
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_audience_check" CHECK ("audience" IN ('CUSTOMERS', 'TECHNICIANS', 'ALL', 'DEMO'));
ALTER TABLE "parts" ADD CONSTRAINT "parts_price_check" CHECK ("price_paise" > 0);
