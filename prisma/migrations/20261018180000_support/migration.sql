-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolved_by" UUID;


-- Added by hand (Prisma cannot express these).
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_resolved_consistent" CHECK (("state" = 'RESOLVED') = ("resolved_at" IS NOT NULL));
-- At most one open call-back request per person and booking (repeats return the same ticket).
CREATE UNIQUE INDEX "support_tickets_one_open_callback" ON "support_tickets" ("raised_by", COALESCE("booking_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "kind" = 'CALLBACK' AND "state" <> 'RESOLVED';
