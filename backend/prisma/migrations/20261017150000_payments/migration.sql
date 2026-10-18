-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "last_checked_at" TIMESTAMPTZ(6),
ADD COLUMN     "ordered_at" TIMESTAMPTZ(6),
ADD COLUMN     "refund_processed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "provider_event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("provider_event_id")
);


-- Added by hand: look up payments due for reconciliation and refunds still to send.
CREATE INDEX "payments_reconcile_idx" ON "payments" ("state", "last_checked_at") WHERE "provider" = 'RAZORPAY' AND "state" IN ('PROCESSING', 'PENDING');
CREATE INDEX "payments_refunds_to_send_idx" ON "payments" ("refund_requested_at") WHERE "state" = 'REFUNDED' AND "provider_refund_id" IS NULL;
