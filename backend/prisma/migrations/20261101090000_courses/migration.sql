-- Courses for technicians: HQ's lesson videos and publishing, enrolments, watch progress, quiz attempts, 99-rupee
-- payments; course certificates are skill certificates of the new kind HOUSEFI_COURSE. The course texts are in the code.
-- CreateEnum
CREATE TYPE "course_access" AS ENUM ('FREE', 'RATING', 'PAID');

-- CreateEnum
CREATE TYPE "course_payment_state" AS ENUM ('CREATED', 'PAID', 'FAILED');

-- AlterEnum
ALTER TYPE "certificate_kind" ADD VALUE 'HOUSEFI_COURSE';

-- CreateTable
CREATE TABLE "course_lesson_videos" (
    "course_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "video_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "uploaded_by_id" UUID,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "course_lesson_videos_pkey" PRIMARY KEY ("course_id","lesson_id")
);

-- CreateTable
CREATE TABLE "course_publications" (
    "course_id" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "course_publications_pkey" PRIMARY KEY ("course_id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "technician_id" UUID NOT NULL,
    "course_id" TEXT NOT NULL,
    "access" "course_access" NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "certificate_id" UUID,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("technician_id","course_id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "technician_id" UUID NOT NULL,
    "course_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "watched_sec" INTEGER NOT NULL DEFAULT 0,
    "last_report_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("technician_id","course_id","lesson_id")
);

-- CreateTable
CREATE TABLE "course_quiz_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "technician_id" UUID NOT NULL,
    "course_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "correct" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "course_quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "technician_id" UUID NOT NULL,
    "course_id" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "state" "course_payment_state" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "method" "payment_method",
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "settled_at" TIMESTAMPTZ(6),
    "last_checked_at" TIMESTAMPTZ(6),

    CONSTRAINT "course_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_certificate_id_key" ON "course_enrollments"("certificate_id");

-- CreateIndex
CREATE INDEX "course_enrollments_course_id_idx" ON "course_enrollments"("course_id");

-- CreateIndex
CREATE INDEX "course_quiz_attempts_technician_id_course_id_submitted_at_idx" ON "course_quiz_attempts"("technician_id", "course_id", "submitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "course_payments_provider_order_id_key" ON "course_payments"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_payments_provider_payment_id_key" ON "course_payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "course_payments_technician_id_course_id_idx" ON "course_payments"("technician_id", "course_id");

-- CreateIndex
CREATE INDEX "course_payments_state_created_at_idx" ON "course_payments"("state", "created_at");

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_quiz_attempts" ADD CONSTRAINT "course_quiz_attempts_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_payments" ADD CONSTRAINT "course_payments_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

