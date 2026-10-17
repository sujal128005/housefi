// Booking rows -> openapi.yaml Booking, as the customer sees it.
import type { Booking, BookingEvent, BookingStatus, CancelReason, CategoryId, CloseReason, Payment, Prisma, Technician, User } from '@prisma/client';
import type { FieldCipher } from '../../common/crypto/field-cipher';
import { paiseToRupees } from '../../common/money';
import type { AddressDto } from '../addresses/addresses.service';
import { latestQuote, type QuoteDto, type QuoteRow, toQuoteDto } from './quote-view';

export type BookingRow = Booking & { events: BookingEvent[]; payments: Payment[]; technician: (Technician & { user: User }) | null; quotes: QuoteRow[] };

export const BOOKING_INCLUDE = {
  events: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
  payments: { orderBy: { createdAt: 'asc' } },
  technician: { include: { user: true } },
  quotes: { include: { lines: true }, orderBy: [{ which: 'asc' }, { version: 'asc' }] },
} satisfies Prisma.BookingInclude;

/** openapi.yaml Technician: the assigned technician as the customer sees them. */
export interface TechnicianDto {
  readonly id: string;
  /** Technician-typed text: the same in both languages. */
  readonly name: { readonly en: string; readonly te: string };
  readonly gender: 'M' | 'F';
  /** 0 until the first rating (the contract has no "not rated yet"; docs/QUESTIONS.md #34). */
  readonly rating: number;
  readonly jobs: number;
  readonly years: number;
  readonly womenRated: boolean;
  readonly vehicle: string;
  /** Masked calling arrives with Exotel (later); empty until then. */
  readonly maskedPhone: string;
  readonly demo: false;
}

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
  /** The assigned technician (only while assigned or after: never before acceptance). */
  readonly technician: TechnicianDto | null;
  /** 4 digits once the visit fee is paid; "" before. */
  readonly arrivalOtp: string;
  readonly etaMin: number | null;
  readonly visitPayment: PaymentDto;
  /** The latest repair quote that passed the price check; null while none has. */
  readonly quote: QuoteDto | null;
  readonly extraQuote: QuoteDto | null;
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

export function payment(p: Payment): PaymentDto {
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
export function latest(payments: Payment[], kind: Payment['kind']): Payment | undefined {
  return payments.filter((p) => p.kind === kind).at(-1);
}

export async function technicianDto(t: Technician & { user: User }, cipher: FieldCipher): Promise<TechnicianDto> {
  const name = t.user.nameEnc ? await cipher.decrypt('users.name', t.user.nameEnc) : '';
  return {
    id: t.userId,
    name: { en: name, te: name },
    gender: t.gender,
    rating: t.ratingAvg !== null ? Number(t.ratingAvg) : 0,
    jobs: t.jobsDone,
    years: t.experienceYears,
    womenRated: t.womenRated,
    vehicle: t.vehicleEnc.length > 0 ? await cipher.decrypt('technicians.vehicle', t.vehicleEnc) : '',
    maskedPhone: '',
    demo: false,
  };
}

function visibleQuote(quotes: QuoteRow[], which: 'MAIN' | 'EXTRA'): QuoteDto | null {
  const q = latestQuote(quotes, which, true);
  return q ? toQuoteDto(q) : null;
}

export const EMPTY_ADDRESS: AddressDto = { id: '', label: 'OTHER', house: '', street: '', landmark: '', city: '', pincode: '' };

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
    technician: b.technician ? await technicianDto(b.technician, cipher) : null,
    arrivalOtp,
    etaMin: b.etaMin,
    visitPayment: payment(visit),
    quote: visibleQuote(b.quotes, 'MAIN'),
    extraQuote: visibleQuote(b.quotes, 'EXTRA'),
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
