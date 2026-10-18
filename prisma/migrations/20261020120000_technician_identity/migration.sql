-- Technician identity (openapi.yaml TechIdentity, TechIdCard, TechVerifyResult) and Aadhaar offline verification.

ALTER TYPE "verification" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "verification" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "upload_stage" ADD VALUE IF NOT EXISTS 'PROFILE';
CREATE TYPE "tech_photo_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "technicians"
  -- Permanent Housefi Technician ID, N9-HF-T-XXXXXX (random, never reused).
  ADD COLUMN "tech_code" text,
  -- Legal name as on the identity document, locked after the first submission (encrypted).
  ADD COLUMN "legal_name_enc" bytea,
  -- Registration photo (an upload with stage PROFILE) and its review state.
  ADD COLUMN "photo_upload_id" uuid REFERENCES "uploads"("id") ON DELETE SET NULL,
  ADD COLUMN "photo_status" "tech_photo_status" NOT NULL DEFAULT 'PENDING',
  -- The QR code's verification token: SHA-256 for lookup, and encrypted so the ID card can show the same link.
  ADD COLUMN "verify_token_hash" bytea,
  ADD COLUMN "verify_token_enc" bytea,
  -- A name or photo correction the technician asked for (handled by support / admin).
  ADD COLUMN "correction_kind" text CHECK ("correction_kind" IN ('NAME', 'PHOTO')),
  ADD COLUMN "correction_note" text,
  ADD COLUMN "correction_at" timestamptz(6),
  -- Aadhaar Secure QR (offline verification): never the Aadhaar number, only its last 4 digits.
  ADD COLUMN "aadhaar_last4" char(4),
  ADD COLUMN "aadhaar_year_of_birth" smallint,
  ADD COLUMN "aadhaar_gender" char(1),
  ADD COLUMN "aadhaar_name_match" boolean,
  -- HMAC of name, birth date, gender and last 4 digits: one person, one technician account.
  ADD COLUMN "aadhaar_fingerprint" bytea,
  ADD COLUMN "aadhaar_verified_at" timestamptz(6);

CREATE UNIQUE INDEX "technicians_tech_code_key" ON "technicians" ("tech_code");
CREATE UNIQUE INDEX "technicians_photo_upload_id_key" ON "technicians" ("photo_upload_id");
CREATE UNIQUE INDEX "technicians_verify_token_hash_key" ON "technicians" ("verify_token_hash");
CREATE UNIQUE INDEX "technicians_aadhaar_fingerprint_key" ON "technicians" ("aadhaar_fingerprint");

-- "I'm a woman" on a rating: only feeds the technician's women-rated badge, never shown to anyone.
ALTER TABLE "ratings" ADD COLUMN "by_woman" boolean NOT NULL DEFAULT false;
