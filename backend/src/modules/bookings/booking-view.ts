// Booking rows -> openapi.yaml Booking, as the customer sees it.
import type { Booking, BookingEvent, BookingStatus, CancelReason, CategoryId, CloseReason, Payment, Prisma, Rating, Technician, TechnicianSkill, Upload, User } from '@prisma/client';
import type { FieldCipher } from '../../common/crypto/field-cipher';
import { paiseToRupees } from '../../common/money';
import type { AddressDto } from '../addresses/addresses.service';
import { latestQuote, type QuoteDto, type QuoteRow, toQuoteDto } from './quote-view';

export type BookingRow = Booking & {
  events: BookingEvent[];
  payments: Payment[];
  technician: (Technician & { user: User; skills: TechnicianSkill[] }) | null;
  preferredTechnician: (Technician & { user: User }) | null;
  quotes: QuoteRow[];
  rating: Rating | null;
  uploads: Upload[];
};

export const BOOKING_INCLUDE = {
  events: { orderBy: [{ at: 'asc' }, { id: 'asc' }] },
  payments: { orderBy: { createdAt: 'asc' } },
  technician: { include: { user: true, skills: true } },
  preferredTechnician: { include: { user: true } },
  quotes: { include: { lines: true }, orderBy: [{ which: 'asc' }, { version: 'asc' }] },
  rating: true,
  uploads: { where: { state: 'READY' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.BookingInclude;

/** Signs short-lived read URLs for photos (common/storage MediaUrls). */
export interface PhotoSigner {
  photoUrl(uploadId: string): Promise<string>;
}

/** openapi.yaml ProblemDescription, as responses carry it: photos and the voice note with a 5-minute signed URL. */
export interface ProblemDto {
  readonly issueIds: readonly string[];
  readonly notes: string;
  readonly voiceNote: { readonly durationSec: number; readonly transcript: string; readonly audioId?: string; readonly url?: string } | null;
  readonly photos: readonly { readonly id: string; readonly url: string }[];
}

export async function toProblemDto(b: BookingRow, media: PhotoSigner): Promise<ProblemDto> {
  const photos = b.uploads.filter((u) => u.kind === 'PHOTO' && u.stage === 'PROBLEM');
  const audio = b.uploads.find((u) => u.kind === 'AUDIO');
  return {
    issueIds: b.issueIds,
    notes: b.notes,
    voiceNote:
      b.voiceDurationSec !== null
        ? { durationSec: b.voiceDurationSec, transcript: b.voiceTranscript ?? '', ...(audio ? { audioId: audio.id, url: await media.photoUrl(audio.id) } : {}) }
        : null,
    photos: await Promise.all(photos.map(async (p) => ({ id: p.id, url: await media.photoUrl(p.id) }))),
  };
}

/** openapi.yaml Rating. */
export interface RatingDto {
  readonly satisfied: boolean;
  readonly stars: number;
  readonly tags: readonly string[];
  readonly comment: string;
  readonly at: number;
}

export const toRatingDto = (r: Rating | null): RatingDto | null =>
  r ? { satisfied: r.satisfied, stars: r.stars, tags: r.tags, comment: r.comment, at: r.createdAt.getTime() } : null;

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
  /** A team demo technician (DEMO_PHONES). */
  readonly demo: boolean;
  /** Identity, read fresh on every request (a suspension shows at once). */
  readonly techCode: string;
  /** Short-lived signed URL of the APPROVED photo only. */
  readonly photo: string | null;
  readonly verification: Technician['verification'];
  readonly verificationSimulated: false;
  readonly skills: readonly CategoryId[];
  readonly fictional: false;
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
  readonly problem: ProblemDto;
  readonly address: AddressDto;
  readonly time: { readonly mode: 'INSTANT'; readonly window: null } | { readonly mode: 'SCHEDULED'; readonly window: { date: string; startHour: number; endHour: number } };
  readonly preferWomenRated: boolean;
  readonly status: BookingStatus;
  /** The assigned technician (only while assigned or after: never before acceptance). */
  readonly technician: TechnicianDto | null;
  /** "Book the same technician again": who is asked first (the customer's technician from an earlier visit). */
  readonly preferredTechnician: { readonly name: string } | null;
  /** 4 digits once the visit fee is paid; "" before. */
  readonly arrivalOtp: string;
  readonly etaMin: number | null;
  /** Where the technician is, only while on the way (EN_ROUTE) and only a recent point (at most 10 minutes old). */
  readonly technicianLocation: TripLocationDto | null;
  readonly visitPayment: PaymentDto;
  /** The latest repair quote that passed the price check; null while none has. */
  readonly quote: QuoteDto | null;
  readonly extraQuote: QuoteDto | null;
  readonly finalPayment: PaymentDto | null;
  readonly rating: RatingDto | null;
  readonly createdAt: number;
  readonly history: readonly { readonly status: BookingStatus; readonly at: number }[];
  readonly cancelReason: Exclude<CancelReason, 'UNPAID_EXPIRED' | 'UNFULFILLED_EXPIRED'> | null;
  readonly closeReason: CloseReason | null;
  readonly workStarted: boolean;
  readonly viaTechApp: true;
  /** A team demo booking: simulated payments, demo technicians only. */
  readonly demo: boolean;
}

export interface TripLocationDto {
  readonly lat: number;
  readonly lng: number;
  /** Metres, as reported by the phone; null when unknown. */
  readonly accuracyM: number | null;
  /** When the phone sent it (epoch ms). */
  readonly at: number;
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

const SKILL_ORDER: readonly CategoryId[] = ['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY'];

export async function technicianDto(t: Technician & { user: User; skills: TechnicianSkill[] }, cipher: FieldCipher, media: PhotoSigner, maskedPhone = ''): Promise<TechnicianDto> {
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
    maskedPhone,
    demo: t.user.isDemo,
    techCode: t.techCode ?? '',
    photo: t.photoUploadId && t.photoStatus === 'APPROVED' ? await media.photoUrl(t.photoUploadId) : null,
    verification: t.verification,
    verificationSimulated: false,
    skills: t.skills.map((s) => s.categoryId).sort((a, b) => SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b)),
    fictional: false,
  };
}

function visibleQuote(quotes: QuoteRow[], which: 'MAIN' | 'EXTRA'): QuoteDto | null {
  const q = latestQuote(quotes, which, true);
  return q ? toQuoteDto(q) : null;
}

export const EMPTY_ADDRESS: AddressDto = { id: '', label: 'OTHER', house: '', street: '', landmark: '', city: '', pincode: '' };

export async function toBookingDto(b: BookingRow, cipher: FieldCipher, media: PhotoSigner, maskedPhone = '', trip: TripLocationDto | null = null): Promise<BookingDto> {
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
    problem: await toProblemDto(b, media),
    address,
    time:
      b.timeMode === 'SCHEDULED' && b.windowDate && b.windowStartHour !== null && b.windowEndHour !== null
        ? { mode: 'SCHEDULED', window: { date: b.windowDate.toISOString().slice(0, 10), startHour: b.windowStartHour, endHour: b.windowEndHour } }
        : { mode: 'INSTANT', window: null },
    preferWomenRated: b.preferWomenRated,
    status: b.status,
    technician: b.technician ? await technicianDto(b.technician, cipher, media, maskedPhone) : null,
    preferredTechnician: b.preferredTechnician?.user.nameEnc ? { name: await cipher.decrypt('users.name', b.preferredTechnician.user.nameEnc) } : null,
    arrivalOtp,
    etaMin: b.etaMin,
    technicianLocation: b.status === 'EN_ROUTE' ? trip : null,
    visitPayment: payment(visit),
    quote: visibleQuote(b.quotes, 'MAIN'),
    extraQuote: visibleQuote(b.quotes, 'EXTRA'),
    finalPayment: final ? payment(final) : null,
    rating: toRatingDto(b.rating),
    createdAt: b.createdAt.getTime(),
    history: b.events.map((e) => ({ status: e.status, at: e.at.getTime() })),
    cancelReason: b.cancelReason && API_CANCEL_REASONS.has(b.cancelReason) ? (b.cancelReason as BookingDto['cancelReason']) : null,
    closeReason: b.closeReason,
    workStarted: b.workStarted,
    viaTechApp: true,
    demo: b.isDemo,
  };
}
