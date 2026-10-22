-- Technician service area from India Post's directory: state, district and the localities they cover.
-- AlterTable
ALTER TABLE "technicians" ADD COLUMN     "district" TEXT,
ADD COLUMN     "localities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "state" TEXT;
