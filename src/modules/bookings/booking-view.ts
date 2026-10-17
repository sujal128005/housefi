// Booking rows -> openapi.yaml Booking, as the customer sees it.
import type { Booking, BookingEvent, BookingStatus, CancelReason, CategoryId, CloseReason, Payment, Prisma } from '@prisma/client';
import type { FieldCipher } from '../../common/crypto/field-cipher';
import { paiseToRupees } from '../../common/money';
import type { AddressDto } from '../addresses/addresses.service';

export type BookingRow = Booking & { events: BookingEvent[]; payments: Payment[] };

export const BOOKING_INCLUDE = {
  events: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BookingInclude;

export interface PaymentDto {
  readonly kind: 'VISIT' | 'FINAL';
  readonly amount: number;
  readonly state: Payment['state'];
  readonly method: Payment['method'];
  readonly txnId: string | null;
  readonly at: number | null;
}

export interface BookingDto {
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
  readonly address: AddressDto;
  readonly time: { readonly mode: 'INSTANT'; readonly window: null } | { readonly mode: 'SCHEDULED'; readonly window: { date: string; startHour: number; endHour: number } };
  readonly preferWomenRated: boolean;
  readonly status: BookingStatus;
  /** The assigned technician arrives with dispatch (step 8). */
  readonly technician: null;
  /** 4 digits once the visit fee is paid; "" before. */
  readonly arrivalOtp: string;
  readonly etaMin: number | null;
  readonly visitPayment: PaymentDto;
  readonly quote: null;
  readonly extraQuote: null;
  readonly finalPayment: PaymentDto | null;
  readonly rating: null;
  readonly createdAt: number;
  readonly history: readonly { readonly status: BookingStatus; readonly at: number }[];
  readonly cancelReason: Exclude<CancelReason, 'UNPAID_EXPIRED' | 'UNFULFILLED_EXPIRED'> | null;
  readonly closeReason: CloseReason | null;
  readonly workStarted: boolean;
  readonly viaTechApp: true;
  readonly demo: false;
}

const API_CANCEL_REASONS = new Set<CancelReason>(['PLANS_CHANGED', 'FIXED', 'TOO_LONG', 'MISTAKE', 'OTHER']);

function payment(p: Payment): PaymentDto {
  return {
    kind: p.kind,
    amount: paiseToRupees(p.amountPaise),
    state: p.state,
    method: p.method,
    txnId: p.providerPaymentId,
    at: p.settledAt?.getTime() ?? null,
  };
}

/** The most recent payment of a kind (step 6 may add retries). */
function latest(payments: Payment[], kind: Payment['kind']): Payment | undefined {
  return payments.filter((p) => p.kind === kind).at(-1);
}

const EMPTY_ADDRESS: AddressDto = { id: '', label: 'OTHER', house: '', street: '', landmark: '', city: '', pincode: '' };

export async function toBookingDto(b: BookingRow, cipher: FieldCipher): Promise<BookingDto> {
  const visit = latest(b.payments, 'VISIT');
  if (!visit) throw new Error(`booking ${b.id} has no visit payment`);
  const final = latest(b.payments, 'FINAL');
  // An anonymised booking (account deleted) has an empty snapshot.
  const address = b.addressSnapshotEnc.length > 0 ? (JSON.parse(await cipher.decrypt('bookings.address', b.addressSnapshotEnc)) as AddressDto) : EMPTY_ADDRESS;
  const arrivalOtp = visit.state === 'PAID' ? await cipher.decrypt('bookings.arrival_code', b.arrivalCodeEnc) : '';
  return {
    id: b.id,
    code: b.code,
    serviceId: b.serviceId,
    categoryId: b.categoryId,
    problem: {
      issueIds: b.issueIds,
      notes: b.notes,
      voiceNote: b.voiceDurationSec !== null ? { durationSec: b.voiceDurationSec, transcript: b.voiceTranscript ?? '' } : null,
      // Photos arrive with uploads (step 10).
      photos: [],
    },
    address,
    time:
      b.timeMode === 'SCHEDULED' && b.windowDate && b.windowStartHour !== null && b.windowEndHour !== null
        ? { mode: 'SCHEDULED', window: { date: b.windowDate.toISOString().slice(0, 10), startHour: b.windowStartHour, endHour: b.windowEndHour } }
        : { mode: 'INSTANT', window: null },
    preferWomenRated: b.preferWomenRated,
    status: b.status,
    technician: null,
    arrivalOtp,
    etaMin: b.etaMin,
    visitPayment: payment(visit),
    quote: null,
    extraQuote: null,
    finalPayment: final ? payment(final) : null,
    rating: null,
    createdAt: b.createdAt.getTime(),
    history: b.events.map((e) => ({ status: e.status, at: e.at.getTime() })),
    cancelReason: b.cancelReason && API_CANCEL_REASONS.has(b.cancelReason) ? (b.cancelReason as BookingDto['cancelReason']) : null,
    closeReason: b.closeReason,
    workStarted: b.workStarted,
    viaTechApp: true,
    demo: false,
  };
}
