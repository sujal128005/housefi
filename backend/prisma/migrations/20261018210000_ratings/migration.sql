-- CreateTable
CREATE TABLE "ratings" (
    "booking_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "technician_id" UUID,
    "satisfied" BOOLEAN NOT NULL,
    "stars" SMALLINT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("booking_id")
);

-- CreateIndex
CREATE INDEX "ratings_technician_id_created_at_idx" ON "ratings"("technician_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technicians"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Added by hand (Prisma cannot express these).
ALTER TABLE "ratings"
  ADD CONSTRAINT "ratings_stars_range" CHECK ("stars" BETWEEN 1 AND 5),
  ADD CONSTRAINT "ratings_known_tags" CHECK ("tags" <@ ARRAY['onTime', 'polite', 'clean', 'fair', 'explained', 'fixed']::text[]),
  ADD CONSTRAINT "ratings_comment_length" CHECK (char_length("comment") <= 500);
