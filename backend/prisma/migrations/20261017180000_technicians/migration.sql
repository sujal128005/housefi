-- CreateEnum
CREATE TYPE "gender" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "verification" AS ENUM ('PENDING', 'APPROVED', 'NEEDS_CORRECTION');

-- CreateEnum
CREATE TYPE "phone_type" AS ENUM ('SMARTPHONE', 'KEYPAD', 'NONE');

-- CreateTable
CREATE TABLE "technicians" (
    "user_id" UUID NOT NULL,
    "gender" "gender" NOT NULL,
    "experience_years" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "areas" TEXT NOT NULL,
    "vehicle_enc" BYTEA NOT NULL,
    "phone_type" "phone_type" NOT NULL DEFAULT 'SMARTPHONE',
    "coordinator_id" UUID,
    "verification" "verification" NOT NULL,
    "correction_note_en" TEXT,
    "correction_note_te" TEXT,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "missed_offers_in_row" INTEGER NOT NULL DEFAULT 0,
    "rating_avg" DECIMAL(3,2),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "women_rated" BOOLEAN NOT NULL DEFAULT false,
    "jobs_done" INTEGER NOT NULL DEFAULT 0,
    "last_location" geography(Point, 4326),
    "last_location_at" TIMESTAMPTZ(6),
    "last_accuracy_m" INTEGER,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "technicians_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "technician_skills" (
    "technician_id" UUID NOT NULL,
    "category_id" "category_id" NOT NULL,

    CONSTRAINT "technician_skills_pkey" PRIMARY KEY ("technician_id","category_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "request_id" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technicians_pincode_online_verification_idx" ON "technicians"("pincode", "online", "verification");

-- CreateIndex
CREATE INDEX "technicians_verification_submitted_at_idx" ON "technicians"("verification", "submitted_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_at_idx" ON "audit_log"("entity", "entity_id", "at");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_coordinator_id_fkey" FOREIGN KEY ("coordinator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_skills" ADD CONSTRAINT "technician_skills_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express these).
ALTER TABLE "technicians"
  ADD CONSTRAINT "technicians_experience_range" CHECK ("experience_years" BETWEEN 0 AND 50),
  ADD CONSTRAINT "technicians_pincode_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$'),
  ADD CONSTRAINT "technicians_rating_range" CHECK ("rating_avg" IS NULL OR "rating_avg" BETWEEN 1 AND 5),
  ADD CONSTRAINT "technicians_online_only_when_approved" CHECK (NOT "online" OR "verification" = 'APPROVED'),
  ADD CONSTRAINT "technicians_note_only_when_correcting" CHECK ("correction_note_en" IS NULL OR "verification" = 'NEEDS_CORRECTION');
-- Distance queries for dispatch (step 8).
CREATE INDEX "technicians_last_location_gist" ON "technicians" USING gist ("last_location");
