// Offer rows -> openapi.yaml JobOffer: what a technician sees before accepting. Area only, never the house or street.
import type { Booking, JobOffer } from '@prisma/client';

export interface JobOfferDto {
  readonly id: string;
  readonly bookingId: string;
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: Booking['categoryId'];
  readonly issueIds: readonly string[];
  readonly notes: string;
  /** Photos arrive with uploads (step 10). */
  readonly photoCount: number;
  /** Locality and city only. */
  readonly area: string;
  readonly pincode: string;
  readonly time: { readonly mode: 'INSTANT'; readonly window: null } | { readonly mode: 'SCHEDULED'; readonly window: { date: string; startHour: number; endHour: number } };
  /** Straight-line km; 0 when either location is unknown (docs/QUESTIONS.md #35). */
  readonly distanceKm: number;
  /** The visit share earned even if no repair happens. */
  readonly visitEarning: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export function toJobOfferDto(o: JobOffer & { booking: Booking }, visitShareRupees: number): JobOfferDto {
  const b = o.booking;
  return {
    id: o.id,
    bookingId: b.id,
    code: b.code,
    serviceId: b.serviceId,
    categoryId: b.categoryId,
    issueIds: b.issueIds,
    notes: b.notes,
    photoCount: 0,
    area: b.locality && b.locality !== b.city ? `${b.locality}, ${b.city}` : b.city,
    pincode: b.pincode.trim(),
    time:
      b.timeMode === 'SCHEDULED' && b.windowDate && b.windowStartHour !== null && b.windowEndHour !== null
        ? { mode: 'SCHEDULED', window: { date: b.windowDate.toISOString().slice(0, 10), startHour: b.windowStartHour, endHour: b.windowEndHour } }
        : { mode: 'INSTANT', window: null },
    distanceKm: o.distanceM !== null ? Math.round(o.distanceM / 100) / 10 : 0,
    visitEarning: visitShareRupees,
    createdAt: o.createdAt.getTime(),
    expiresAt: o.expiresAt.getTime(),
  };
}
