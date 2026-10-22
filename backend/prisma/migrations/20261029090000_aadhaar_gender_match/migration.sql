-- Aadhaar check: whether the gender on the Aadhaar matches the profile. A mismatch holds the approval, like the name.
-- AlterTable
ALTER TABLE "technicians" ADD COLUMN     "aadhaar_gender_match" BOOLEAN;

-- Technicians already checked: worked out once from what is stored (T or no gender on the Aadhaar never blocks).
UPDATE "technicians"
SET "aadhaar_gender_match" = ("aadhaar_gender" IS NULL OR "aadhaar_gender" NOT IN ('M', 'F') OR "aadhaar_gender" = "gender"::text)
WHERE "aadhaar_verified_at" IS NOT NULL;
