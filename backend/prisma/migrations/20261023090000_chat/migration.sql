-- Chat between the customer and the assigned technician (open from assignment until the job is done; cleared after).
ALTER TYPE "upload_stage" ADD VALUE IF NOT EXISTS 'CHAT';
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'CHAT_MESSAGE';

ALTER TABLE "bookings" ADD COLUMN "chat_customer_read_at" TIMESTAMPTZ(6);
ALTER TABLE "bookings" ADD COLUMN "chat_tech_read_at" TIMESTAMPTZ(6);

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGSERIAL NOT NULL,
    "booking_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_role" "user_role" NOT NULL,
    "body_enc" BYTEA NOT NULL,
    "upload_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_messages_upload_id_key" ON "chat_messages"("upload_id");
CREATE INDEX "chat_messages_booking_id_seq_idx" ON "chat_messages"("booking_id", "seq");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
