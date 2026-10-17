-- CreateEnum
CREATE TYPE "upload_kind" AS ENUM ('PHOTO', 'AUDIO');

-- CreateEnum
CREATE TYPE "upload_stage" AS ENUM ('PROBLEM', 'INSPECTION', 'COMPLETION');

-- CreateEnum
CREATE TYPE "upload_state" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "kind" "upload_kind" NOT NULL,
    "stage" "upload_stage",
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "state" "upload_state" NOT NULL DEFAULT 'PENDING',
    "duration_sec" INTEGER,
    "booking_id" UUID,
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "url_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uploads_owner_id_created_at_idx" ON "uploads"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "uploads_booking_id_idx" ON "uploads"("booking_id");

-- CreateIndex
CREATE INDEX "uploads_state_created_at_idx" ON "uploads"("state", "created_at");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express these).
ALTER TABLE "uploads"
  ADD CONSTRAINT "uploads_photo_has_stage" CHECK (("kind" = 'PHOTO') = ("stage" IS NOT NULL)),
  ADD CONSTRAINT "uploads_size_limits" CHECK ("bytes" > 0 AND (("kind" = 'PHOTO' AND "bytes" <= 8388608) OR ("kind" = 'AUDIO' AND "bytes" <= 2097152))),
  ADD CONSTRAINT "uploads_known_types" CHECK (("kind" = 'PHOTO' AND "content_type" IN ('image/jpeg', 'image/png', 'image/heic'))
                                           OR ("kind" = 'AUDIO' AND "content_type" IN ('audio/m4a', 'audio/mp4', 'audio/aac'))),
  ADD CONSTRAINT "uploads_audio_length" CHECK ("duration_sec" IS NULL OR "duration_sec" BETWEEN 0 AND 60),
  ADD CONSTRAINT "uploads_attached_is_ready" CHECK ("booking_id" IS NULL OR "state" = 'READY');
