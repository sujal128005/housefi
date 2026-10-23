-- Skill Passport: the technician chooses to show their career on their public QR page (off by default).
ALTER TABLE "technicians" ADD COLUMN "passport_public" BOOLEAN NOT NULL DEFAULT false;
