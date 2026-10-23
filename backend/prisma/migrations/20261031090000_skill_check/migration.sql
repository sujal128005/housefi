-- Skill check after the Aadhaar scan: level, exams, work videos, certificates; trades verified one by one (job offers
-- only for verified trades).
-- CreateEnum
CREATE TYPE "skill_level" AS ENUM ('UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED');

-- CreateEnum
CREATE TYPE "skill_review" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "trade_verified_via" AS ENUM ('EXAM', 'VIDEO', 'HQ', 'EARLIER');

-- CreateEnum
CREATE TYPE "skill_video_source" AS ENUM ('LIVE', 'UPLOAD', 'SAMPLE');

-- CreateEnum
CREATE TYPE "certificate_kind" AS ENUM ('ITI', 'SKILL_INDIA', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "upload_kind" ADD VALUE 'VIDEO';
ALTER TYPE "upload_kind" ADD VALUE 'DOCUMENT';

-- AlterEnum
ALTER TYPE "upload_stage" ADD VALUE 'SKILL';

-- AlterTable
ALTER TABLE "technicians" ADD COLUMN     "skill_level" "skill_level",
ADD COLUMN     "skill_submitted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "technician_skills" ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_via" "trade_verified_via";

-- CreateTable
CREATE TABLE "skill_exam_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "technician_id" UUID NOT NULL,
    "category_id" "category_id" NOT NULL,
    "level" "skill_level" NOT NULL,
    "question_ids" TEXT[],
    "section_starts" JSONB NOT NULL DEFAULT '[]',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "left_app" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "auto_submitted" BOOLEAN NOT NULL DEFAULT false,
    "correct" INTEGER,
    "base_points" INTEGER,
    "bonus_points" INTEGER,
    "passed" BOOLEAN,

    CONSTRAINT "skill_exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_videos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "technician_id" UUID NOT NULL,
    "upload_id" UUID,
    "source" "skill_video_source" NOT NULL,
    "duration_sec" INTEGER,
    "status" "skill_review" NOT NULL DEFAULT 'PENDING',
    "category_ids" "category_id"[] DEFAULT ARRAY[]::"category_id"[],
    "review_note" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "skill_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "technician_id" UUID NOT NULL,
    "kind" "certificate_kind" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "upload_id" UUID,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "status" "skill_review" NOT NULL DEFAULT 'PENDING',
    "review_note" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "skill_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_exam_attempts_technician_id_category_id_started_at_idx" ON "skill_exam_attempts"("technician_id", "category_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "skill_videos_upload_id_key" ON "skill_videos"("upload_id");

-- CreateIndex
CREATE INDEX "skill_videos_technician_id_created_at_idx" ON "skill_videos"("technician_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "skill_videos_status_created_at_idx" ON "skill_videos"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "skill_certificates_upload_id_key" ON "skill_certificates"("upload_id");

-- CreateIndex
CREATE INDEX "skill_certificates_technician_id_created_at_idx" ON "skill_certificates"("technician_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "skill_certificates_status_created_at_idx" ON "skill_certificates"("status", "created_at");

-- AddForeignKey
ALTER TABLE "skill_exam_attempts" ADD CONSTRAINT "skill_exam_attempts_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_videos" ADD CONSTRAINT "skill_videos_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_videos" ADD CONSTRAINT "skill_videos_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_certificates" ADD CONSTRAINT "skill_certificates_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_certificates" ADD CONSTRAINT "skill_certificates_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Trades from before the skill check keep getting jobs: marked verified as EARLIER.
UPDATE "technician_skills" SET "verified_at" = now(), "verified_via" = 'EARLIER' WHERE "verified_at" IS NULL;

-- Added by hand: the upload checks also know work videos (up to 100 MB and about 2 minutes) and certificates (PDF or
-- photo, up to 10 MB), both with the SKILL stage. "kind"::text because the new enum values cannot be named as such in
-- the transaction that adds them.
ALTER TABLE "uploads"
  DROP CONSTRAINT "uploads_photo_has_stage",
  DROP CONSTRAINT "uploads_size_limits",
  DROP CONSTRAINT "uploads_known_types",
  DROP CONSTRAINT "uploads_audio_length";
ALTER TABLE "uploads"
  ADD CONSTRAINT "uploads_photo_has_stage" CHECK (("kind"::text IN ('PHOTO', 'VIDEO', 'DOCUMENT')) = ("stage" IS NOT NULL)),
  ADD CONSTRAINT "uploads_size_limits" CHECK ("bytes" > 0 AND (("kind"::text = 'PHOTO' AND "bytes" <= 8388608) OR ("kind"::text = 'AUDIO' AND "bytes" <= 2097152)
                                           OR ("kind"::text = 'VIDEO' AND "bytes" <= 104857600) OR ("kind"::text = 'DOCUMENT' AND "bytes" <= 10485760))),
  ADD CONSTRAINT "uploads_known_types" CHECK (("kind"::text = 'PHOTO' AND "content_type" IN ('image/jpeg', 'image/png', 'image/heic'))
                                           OR ("kind"::text = 'AUDIO' AND "content_type" IN ('audio/m4a', 'audio/mp4', 'audio/aac'))
                                           OR ("kind"::text = 'VIDEO' AND "content_type" IN ('video/mp4', 'video/quicktime'))
                                           OR ("kind"::text = 'DOCUMENT' AND "content_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/heic'))),
  ADD CONSTRAINT "uploads_audio_length" CHECK ("duration_sec" IS NULL OR "duration_sec" BETWEEN 0 AND (CASE WHEN "kind"::text = 'VIDEO' THEN 125 ELSE 60 END));
