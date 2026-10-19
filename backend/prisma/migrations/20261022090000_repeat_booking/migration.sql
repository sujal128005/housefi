-- "Book the same technician again": the new booking is offered to the technician of the customer's earlier booking first.
ALTER TABLE "bookings" ADD COLUMN "preferred_technician_id" UUID;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_preferred_technician_id_fkey" FOREIGN KEY ("preferred_technician_id") REFERENCES "technicians"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
