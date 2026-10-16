-- CreateEnum
CREATE TYPE "category_id" AS ENUM ('PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY');

-- CreateTable
CREATE TABLE "categories" (
    "id" "category_id" NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_te" TEXT NOT NULL,
    "tagline_en" TEXT NOT NULL,
    "tagline_te" TEXT NOT NULL,
    "art" TEXT NOT NULL,
    "wash" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "category_id" "category_id" NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_te" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "description_te" TEXT NOT NULL,
    "visit_fee_paise" BIGINT NOT NULL DEFAULT 4900,
    "repair_from_paise" BIGINT NOT NULL,
    "repair_typical_max_paise" BIGINT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "duration_max" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "reviews" INTEGER NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_issues" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_te" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "service_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_category_id_sort_idx" ON "services"("category_id", "sort");

-- CreateIndex
CREATE INDEX "service_issues_service_id_sort_idx" ON "service_issues"("service_id", "sort");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_issues" ADD CONSTRAINT "service_issues_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express CHECK constraints): catalog values the price check relies on.
ALTER TABLE "services"
  ADD CONSTRAINT "services_visit_fee_positive" CHECK ("visit_fee_paise" > 0),
  ADD CONSTRAINT "services_repair_range" CHECK ("repair_from_paise" > 0 AND "repair_typical_max_paise" >= "repair_from_paise"),
  ADD CONSTRAINT "services_duration_range" CHECK ("duration_min" > 0 AND "duration_max" >= "duration_min"),
  ADD CONSTRAINT "services_rating_range" CHECK ("rating" BETWEEN 0 AND 5 AND "reviews" >= 0);
ALTER TABLE "services" ALTER COLUMN "keywords" SET NOT NULL;
