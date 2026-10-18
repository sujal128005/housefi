-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "address_label" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" "address_label" NOT NULL,
    "house_enc" BYTEA NOT NULL,
    "street_enc" BYTEA NOT NULL,
    "landmark_enc" BYTEA,
    "locality" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "location" geography(Point, 4326),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_capacities" (
    "category_id" "category_id" NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "max_per_window" INTEGER NOT NULL,

    CONSTRAINT "slot_capacities_pkey" PRIMARY KEY ("category_id","pincode")
);

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express CHECK constraints).
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_pincode_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$');
ALTER TABLE "slot_capacities"
  ADD CONSTRAINT "slot_capacities_pincode_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$'),
  ADD CONSTRAINT "slot_capacities_max_non_negative" CHECK ("max_per_window" >= 0);
