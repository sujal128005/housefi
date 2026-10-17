// Booking rows -> openapi.yaml Job: the same booking as the assigned technician sees it.
import type { BookingStatus, CancelReason, CategoryId, CloseReason, Prisma } from '@prisma/client';
import type { FieldCipher } from '../../common/crypto/field-cipher';
import type { AddressDto } from '../addresses/addresses.service';
import { ACTIVE_STATUSES } from './booking-status';
import { BOOKING_INCLUDE, type BookingRow, EMPTY_ADDRESS, latest, payment, type PaymentDto } from './booking-view';

export const JOB_INCLUDE = { ...BOOKING_INCLUDE, customer: { select: { nameEnc: true } } } satisfies Prisma.BookingInclude;
export type JobRow = BookingRow & { customer: { nameEnc: Uint8Array | null } };

/** README §7: the technician sees the full address after accepting, until 24 h after the job closes. */
export const ADDRESS_VISIBLE_AFTER_CLOSE_MS = 24 * 60 * 60_000;

export interface JobDto {
  readonly id: string;
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: CategoryId;
  readonly problem: {
    readonly issueIds: readonly string[];
    readonly notes: string;
    readonly voiceNote: { readonly durationSec: number; readonly transcript: string } | null;
    readonly photos: readonly { readonly id: string }[];
  };
  /** First name only. */
  readonly customerName: string;
  readonly address: AddressDto;
  /** Masked calling arrives with Exotel (later); empty until then. The customer's number is never sent. */
  readonly maskedPhone: string;
  readonly time: { readonly mode: 'INSTANT'; readonly window: null } | { readonly mode: 'SCHEDULED'; readonly window: { date: string; startHour: number; endHour: number } };
  readonly status: BookingStatus;
  /** Quotes arrive with job actions (step 9). */
  readonly quote: null;
  readonly extraQuote: null;
  readonly visitPayment: PaymentDto;
  readonly finalPayment: PaymentDto | null;
  readonly workStarted: boolean;
  readonly closeReason: CloseReason | null;
  readonly cancelReason: Exclude<CancelReason, 'UNPAID_EXPIRED' | 'UNFULFILLED_EXPIRED'> | null;
  readonly otpAttemptsLeft: number;
  readonly earning: number;
  readonly rating: null;
  readonly history: readonly { readonly status: BookingStatus; readonly at: number }[];
  readonly acceptedAt: number;
  readonly practice: false;
  readonly demo: false;
}

export interface JobViewOptions {
  readonly now: number;
  readonly visitShareRupees: number;
  readonly startCodeMaxAttempts: number;
}

const API_CANCEL_REASONS = new Set<CancelReason>(['PLANS_CHANGED', 'FIXED', 'TOO_LONG', 'MISTAKE', 'OTHER']);

/**
 * What the job earns the technician so far: the visit share once the visit is on (also when it ends without repair,
 * or the customer cancels after the trip started), nothing when cancelled before the trip. Labour and materials are
 * added with quotes (step 9) and the earnings ledger (step 10).
 */
function earningSoFar(b: BookingRow, visitShare: number): number {
  if (b.status !== 'CANCELLED') return visitShare;
  return b.events.some((e) => e.status === 'EN_ROUTE') ? visitShare : 0;
}

export async function toJobDto(b: JobRow, cipher: FieldCipher, opts: JobViewOptions): Promise<JobDto> {
  const visit = latest(b.payments, 'VISIT');
  if (!visit) throw new Error(`booking ${b.id} has no visit payment`);
  const final = latest(b.payments, 'FINAL');
  const closedAt = !ACTIVE_STATUSES.includes(b.status) ? b.events.at(-1)?.at.getTime() : undefined;
  const addressHidden = b.addressSnapshotEnc.length === 0 || (closedAt !== undefined && opts.now - closedAt > ADDRESS_VISIBLE_AFTER_CLOSE_MS);
  let address: AddressDto;
  if (addressHidden) {
    // Keep the coarse area so the job history still makes sense.
    address = { ...EMPTY_ADDRESS, city: b.city, pincode: b.pincode.trim(), street: b.locality };
  } else {
    address = JSON.parse(await cipher.decrypt('bookings.address', b.addressSnapshotEnc)) as AddressDto;
  }
  const fullName = b.customer.nameEnc ? await cipher.decrypt('users.name', b.customer.nameEnc) : '';
  const accepted = b.assignedAt ?? [...b.events].reverse().find((e) => e.status === 'ASSIGNED')?.at;
  return {
    id: b.id,
    code: b.code,
    serviceId: b.serviceId,
    categoryId: b.categoryId,
    problem: {
      issueIds: b.issueIds,
      notes: b.notes,
      voiceNote: b.voiceDurationSec !== null ? { durationSec: b.voiceDurationSec, transcript: b.voiceTranscript ?? '' } : null,
      photos: [],
    },
    customerName: fullName.split(/\s+/)[0] ?? '',
    address,
    maskedPhone: '',
    time:
      b.timeMode === 'SCHEDULED' && b.windowDate && b.windowStartHour !== null && b.windowEndHour !== null
        ? { mode: 'SCHEDULED', window: { date: b.windowDate.toISOString().slice(0, 10), startHour: b.windowStartHour, endHour: b.windowEndHour } }
        : { mode: 'INSTANT', window: null },
    status: b.status,
    quote: null,
    extraQuote: null,
    visitPayment: payment(visit),
    finalPayment: final ? payment(final) : null,
    workStarted: b.workStarted,
    closeReason: b.closeReason,
    cancelReason: b.cancelReason && API_CANCEL_REASONS.has(b.cancelReason) ? (b.cancelReason as JobDto['cancelReason']) : null,
    otpAttemptsLeft: Math.max(0, opts.startCodeMaxAttempts - b.startCodeAttempts),
    earning: earningSoFar(b, opts.visitShareRupees),
    rating: null,
    history: b.events.map((e) => ({ status: e.status, at: e.at.getTime() })),
    acceptedAt: accepted?.getTime() ?? 0,
    practice: false,
    demo: false,
  };
}
