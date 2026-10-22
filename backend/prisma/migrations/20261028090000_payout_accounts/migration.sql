-- Payout details: where each technician's weekly payout goes (bank account or UPI), entered in the app. The account
-- number, UPI ID and holder name are encrypted by the API; `hint` is the masked form shown in HQ and the app.
-- CreateEnum
CREATE TYPE "payout_rail" AS ENUM ('BANK', 'UPI');

-- CreateTable
CREATE TABLE "technician_payout_accounts" (
    "technician_id" UUID NOT NULL,
    "rail" "payout_rail" NOT NULL,
    "holder_name_enc" BYTEA NOT NULL,
    "account_number_enc" BYTEA,
    "ifsc" CHAR(11),
    "upi_id_enc" BYTEA,
    "hint" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "technician_payout_accounts_pkey" PRIMARY KEY ("technician_id"),
    -- A bank account (number + IFSC) or a UPI ID, never both and never neither.
    CONSTRAINT "technician_payout_accounts_one_rail" CHECK (
        ("rail" = 'BANK' AND "account_number_enc" IS NOT NULL AND "ifsc" IS NOT NULL AND "upi_id_enc" IS NULL)
        OR ("rail" = 'UPI' AND "upi_id_enc" IS NOT NULL AND "account_number_enc" IS NULL AND "ifsc" IS NULL)
    )
);

-- AddForeignKey
ALTER TABLE "technician_payout_accounts" ADD CONSTRAINT "technician_payout_accounts_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
