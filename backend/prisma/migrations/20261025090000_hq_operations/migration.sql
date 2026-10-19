-- Housefi HQ, phases 3-5: SOS location on tickets, live support conversations, the guide (Sarathi) and its
-- proposed actions, and the arcade's scores.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'SUPPORT_REPLY';

-- CreateEnum
CREATE TYPE "support_thread_state" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "admin_action_state" AS ENUM ('PROPOSED', 'DONE', 'REJECTED', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "accuracy_m" INTEGER,
ADD COLUMN     "handled_at" TIMESTAMPTZ(6),
ADD COLUMN     "handled_by" UUID,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "located_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "support_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role" "user_role" NOT NULL,
    "booking_id" UUID,
    "topic" TEXT NOT NULL,
    "state" "support_thread_state" NOT NULL DEFAULT 'OPEN',
    "unread_for_hq" INTEGER NOT NULL DEFAULT 0,
    "unread_for_user" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,

    CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGSERIAL NOT NULL,
    "thread_id" UUID NOT NULL,
    "from" TEXT NOT NULL,
    "admin_id" UUID,
    "body_enc" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_guide_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" BIGSERIAL NOT NULL,
    "admin_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "body_enc" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_guide_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "confirm_phrase" TEXT,
    "state" "admin_action_state" NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "result" TEXT,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_game_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "game" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_game_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_threads_state_last_message_at_idx" ON "support_threads"("state", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "support_threads_user_id_state_idx" ON "support_threads"("user_id", "state");

-- CreateIndex
CREATE INDEX "support_messages_thread_id_seq_idx" ON "support_messages"("thread_id", "seq");

-- CreateIndex
CREATE INDEX "admin_guide_messages_admin_id_seq_idx" ON "admin_guide_messages"("admin_id", "seq");

-- CreateIndex
CREATE INDEX "admin_actions_admin_id_state_idx" ON "admin_actions"("admin_id", "state");

-- CreateIndex
CREATE INDEX "admin_game_scores_game_score_idx" ON "admin_game_scores"("game", "score" DESC);

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_guide_messages" ADD CONSTRAINT "admin_guide_messages_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_game_scores" ADD CONSTRAINT "admin_game_scores_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One open conversation per person (two taps at once make one).
CREATE UNIQUE INDEX "one_open_support_thread" ON "support_threads" ("user_id") WHERE "state" = 'OPEN';
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_from_check" CHECK ("from" IN ('USER', 'HQ', 'SYSTEM'));
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_risk_check" CHECK ("risk" IN ('LOW', 'HIGH', 'CRITICAL'));
