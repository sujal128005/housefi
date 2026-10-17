// Pure rules the screens and the mock backend share: input validation, visit slots, search, money, and the booking
// lifecycle (what can happen next, demo timings). No React, no storage, so they are easy to unit test.
import { CATEGORIES, SERVICES } from '../data/catalog';
import type { AddressInput, BookingStatus, Category, Quote, QuoteLine, Service, Slot, VisitWindow } from './types';

// ---------- validation ----------

/** Digits without one country code (+91, as 12 digits) or trunk 0 (as 11 digits), as pasted or autofilled. */
function withoutPrefix(digits: string): string {
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** The national number while typing: "+91 98765 43210" -> "9876543210" (at most 10 digits). */
export function nationalDigits(input: string): string {
  return withoutPrefix(input.replace(/\D/g, '')).slice(0, 10);
}

/**
 * Indian mobile numbers: 10 digits starting 6-9. Accepts spaces, +91 and a leading 0; returns the bare digits or null.
 * Extra digits are refused rather than cut off, so a mistyped number is never read as someone else's.
 */
export function normalizePhone(input: string): string | null {
  const digits = withoutPrefix(input.replace(/\D/g, ''));
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function isValidName(name: string): boolean {
  const n = name.trim();
  return n.length >= 2 && n.length <= 60 && /\p{L}/u.test(n);
}

/** Indian PIN codes: 6 digits, not starting with 0. */
export function isValidPincode(pin: string): boolean {
  return /^[1-9]\d{5}$/.test(pin);
}

export type AddressField = 'house' | 'street' | 'city' | 'pincode';
export type AddressErrors = Partial<Record<AddressField, 'REQUIRED' | 'INVALID'>>;

export function validateAddress(a: AddressInput): AddressErrors {
  const e: AddressErrors = {};
  if (a.house.trim().length < 2) e.house = 'REQUIRED';
  if (a.street.trim().length < 3) e.street = 'REQUIRED';
  if (a.city.trim().length < 2) e.city = 'REQUIRED';
  const pin = a.pincode.trim();
  if (pin === '') e.pincode = 'REQUIRED';
  else if (!isValidPincode(pin)) e.pincode = 'INVALID';
  return e;
}

// ---------- visit time ----------

export const SLOT_HOURS: readonly (readonly [number, number])[] = [[8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20]];
export const BOOKABLE_DAYS = 7;
/** A slot can be booked until this many minutes before it starts. */
export const SLOT_CUTOFF_MIN = 60;
/** Instant visits are offered between these hours. */
export const INSTANT_HOURS: readonly [number, number] = [7, 21];
/** Typical arrival time promised for an instant visit. */
export const INSTANT_ETA_MIN: readonly [number, number] = [45, 60];

export function isInstantAvailable(now: Date): boolean {
  const h = now.getHours();
  return h >= INSTANT_HOURS[0] && h < INSTANT_HOURS[1];
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function bookableDates(now: Date): Date[] {
  return Array.from({ length: BOOKABLE_DAYS }, (_, k) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + k));
}

/** Small deterministic hash so "full" slots stay the same for a given day and service (demo availability). */
function hash(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return h >>> 0;
}

/** Visit slots for one day. Past slots are CLOSED; about one in five are FULL (demo availability). */
export function slotsFor(date: string, serviceId: string, now: Date): Slot[] {
  const day = parseIsoDate(date);
  return SLOT_HOURS.map(([startHour, endHour]) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour);
    const closed = start.getTime() - now.getTime() < SLOT_CUTOFF_MIN * 60_000;
    const full = !closed && hash(`${date}|${startHour}|${serviceId}`) % 5 === 0;
    return { id: `${date}@${startHour}`, date, startHour, endHour, state: closed ? 'CLOSED' : full ? 'FULL' : 'OPEN' };
  });
}

export function windowStart(w: VisitWindow): Date {
  const d = parseIsoDate(w.date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), w.startHour);
}

// ---------- search ----------

export interface SearchResult {
  readonly categories: readonly Category[];
  readonly services: readonly Service[];
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFC').trim();
}

export function search(query: string): SearchResult {
  const q = norm(query);
  if (q.length === 0) return { categories: [], services: [] };
  const hit = (...texts: string[]) => texts.some((t) => norm(t).includes(q));
  return {
    categories: CATEGORIES.filter((c) => hit(c.name.en, c.name.te, c.tagline.en, c.tagline.te)),
    services: SERVICES.filter((s) => hit(s.name.en, s.name.te, ...s.keywords, ...s.issues.flatMap((x) => [x.name.en, x.name.te]))),
  };
}

// ---------- money ----------

export function lineTotal(l: QuoteLine): number {
  return l.qty * l.unitPrice;
}

export function quoteTotal(lines: readonly QuoteLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

// ---------- quotes and earnings ----------

/** Smallest repair quote (labour + materials). */
export const QUOTE_MIN = 100;
/** A quote has at most this many lines. */
export const MAX_QUOTE_LINES = 20;
/** A single quote line above this goes to a reviewer. */
export const QUOTE_LINE_REVIEW = 5000;
/** Wrong start codes allowed before the visit is locked. */
export const START_CODE_ATTEMPTS = 5;
/** What the technician earns from the ₹49 visit fee, and their share of labour (materials are reimbursed in full). */
export const TECH_VISIT_SHARE = 30;

/** "Rated highly by women": average of at least 4.5 stars from ratings whose customer said they are a woman. */
export const WOMEN_RATED_MIN_STARS = 4.5;

export function isWomenRated(starsFromWomen: readonly number[], minRatings: number): boolean {
  if (starsFromWomen.length < Math.max(1, minRatings)) return false;
  return starsFromWomen.reduce((a, v) => a + v, 0) / starsFromWomen.length >= WOMEN_RATED_MIN_STARS;
}
export const TECH_LABOUR_SHARE = 0.8;
/** How many lower-price requests a customer can make. */
export const MAX_QUOTE_VERSIONS = 3;

export interface QuoteLineDraft {
  readonly kind: QuoteLine['kind'];
  readonly name: string;
  readonly qty: number;
  readonly unitPrice: number;
}

export type QuoteProblem = 'NO_LINES' | 'NO_LABOUR' | 'BAD_LINE' | 'BELOW_MIN' | 'NO_DIAGNOSIS';

/** Checks a technician's quote before it is sent. */
export function quoteProblem(diagnosis: string, lines: readonly QuoteLineDraft[]): QuoteProblem | null {
  if (lines.length === 0) return 'NO_LINES';
  if (lines.length > MAX_QUOTE_LINES) return 'BAD_LINE';
  if (lines.some((l) => l.name.trim() === '' || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 99 || !Number.isInteger(l.unitPrice) || l.unitPrice < 1 || l.unitPrice > 100_000)) return 'BAD_LINE';
  if (!lines.some((l) => l.kind === 'LABOUR')) return 'NO_LABOUR';
  if (lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) < QUOTE_MIN) return 'BELOW_MIN';
  if (diagnosis.trim().length < 3) return 'NO_DIAGNOSIS';
  return null;
}

/** Usual price range for a service, used by the price check. */
export function typicalRange(service: Pick<Service, 'repairFrom'> | undefined): readonly [number, number] {
  const from = service?.repairFrom ?? QUOTE_MIN;
  return [from, from * 4];
}

/** The (rule-based) AI price check: fair, or needs a reviewer. */
export function priceCheck(service: Pick<Service, 'repairFrom'> | undefined, lines: readonly QuoteLine[]): 'FAIR' | 'UNDER_REVIEW' {
  const [, max] = typicalRange(service);
  const total = quoteTotal(lines);
  return total > max * 1.5 || lines.some((l) => lineTotal(l) > QUOTE_LINE_REVIEW) ? 'UNDER_REVIEW' : 'FAIR';
}

export function labourTotal(lines: readonly QuoteLine[]): number {
  return lines.filter((l) => l.kind === 'LABOUR').reduce((s, l) => s + lineTotal(l), 0);
}

export function materialTotal(lines: readonly QuoteLine[]): number {
  return lines.filter((l) => l.kind === 'MATERIAL').reduce((s, l) => s + lineTotal(l), 0);
}

interface EarningInput {
  readonly status: BookingStatus;
  readonly visitPayment: { readonly state: string };
  readonly quote: Quote | null;
  readonly extraQuote: Quote | null;
}

/** What a job earns the technician: visit share once the visit fee is kept, plus labour share and materials of approved work. */
export function earningFor(j: EarningInput): number {
  const visitKept = j.visitPayment.state === 'PAID' && j.status !== 'AWAITING_PAYMENT';
  let sum = visitKept ? TECH_VISIT_SHARE : 0;
  if (j.status === 'CLOSED_NO_REPAIR' || j.status === 'CANCELLED') return sum;
  for (const q of [j.quote, j.extraQuote]) {
    if (q?.decision === 'APPROVED') sum += Math.round(labourTotal(q.lines) * TECH_LABOUR_SHARE) + materialTotal(q.lines);
  }
  return sum;
}

/** Earnings are paid out weekly, every Monday. */
export function nextPayoutDate(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  return isoDate(d);
}

/** Start of the current payout week (Monday 00:00). */
export function weekStart(now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** What the customer pays at the end: the approved quote plus approved extra work. */
export function finalAmount(quote: Quote | null, extra: Quote | null): number {
  return (quote?.decision === 'APPROVED' ? quote.total : 0) + (extra?.decision === 'APPROVED' ? extra.total : 0);
}

// ---------- lifecycle ----------

export type MatchingScenario = 'QUICK' | 'SLOW' | 'NONE';
/** PENDING_THEN_FAILED: the bank first says pending, then the payment fails (nothing taken). */
export type PaymentOutcome = 'SUCCESS' | 'PENDING' | 'PENDING_THEN_FAILED' | 'FAILED';

/** Demo timings in seconds. Real visits take far longer; the demo is sped up and says so. */
export const DEMO_TIMING = {
  matching: {
    QUICK: { delayedAt: null as number | null, endAt: 8, end: 'ASSIGNED' as BookingStatus },
    SLOW: { delayedAt: 7 as number | null, endAt: 20, end: 'ASSIGNED' as BookingStatus },
    NONE: { delayedAt: 7 as number | null, endAt: 16, end: 'UNFULFILLED' as BookingStatus },
  },
  paymentPendingSec: 8,
  startTravelSec: 4,
  travelSec: 40,
  /** What a full trip "looks like" in minutes on screen. */
  travelShownMin: 18,
  verifyOtpSec: 15,
  inspectSec: 12,
  extraWorkAtSec: 9,
  workSec: 16,
  workAfterExtraSec: 12,
  /** AI price check of a technician quote, then (if flagged) the reviewer. */
  quoteCheckSec: 3,
  quoteReviewSec: 8,
  /** The simulated technician sends a lower quote after a revision request. */
  revisionSec: 6,
  /** The simulated technician confirms a cash payment. */
  cashConfirmSec: 4,
  /** The simulated customer of a practice job answers a quote / pays. */
  practiceAnswerSec: 6,
  /** Technician profile review. */
  verificationSec: 8,
  /** A job offer waits this long for the technician. */
  offerSec: 45,
} as const;

/** The matching status a booking should show `elapsedSec` after matching started. */
export function matchingStatusAt(scenario: MatchingScenario, elapsedSec: number): BookingStatus {
  const t = DEMO_TIMING.matching[scenario];
  if (elapsedSec >= t.endAt) return t.end;
  if (t.delayedAt !== null && elapsedSec >= t.delayedAt) return 'MATCHING_DELAYED';
  return 'MATCHING';
}

/** Which of the four "finding a technician" steps is in progress (0-3), for the progress checklist. */
export function matchingStep(elapsedSec: number): number {
  if (elapsedSec < 1.5) return 0;
  if (elapsedSec < 3.5) return 1;
  if (elapsedSec < 5.5) return 2;
  return 3;
}

/** Minutes left on screen while the technician travels. */
export function etaMinutes(remainingSec: number): number {
  const frac = Math.max(0, Math.min(1, remainingSec / DEMO_TIMING.travelSec));
  return Math.max(1, Math.ceil(frac * DEMO_TIMING.travelShownMin));
}

const ACTIVE: readonly BookingStatus[] = [
  'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED',
  'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE',
];

export function isActive(status: BookingStatus): boolean {
  return ACTIVE.includes(status);
}

/** A booking can be cancelled until the technician is at the door. */
export function canCancel(status: BookingStatus): boolean {
  return ['AWAITING_PAYMENT', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED', 'EN_ROUTE'].includes(status);
}

/** The ₹49 visit fee is refunded if the booking is cancelled before the technician starts travelling. */
export function cancelRefundsVisitFee(status: BookingStatus): boolean {
  return ['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED'].includes(status);
}

export function canReschedule(status: BookingStatus): boolean {
  return status === 'MATCHING_DELAYED' || status === 'UNFULFILLED' || status === 'ASSIGNED';
}

/** The visit is under way: show safety tools (SOS, share live status). */
export function isVisitLive(status: BookingStatus): boolean {
  return ['EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK'].includes(status);
}

/** Customer-facing progress steps and which one a status belongs to. */
export const PROGRESS_STEPS = ['booked', 'assigned', 'onTheWay', 'repair', 'done'] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];

export function progressIndex(status: BookingStatus): number {
  switch (status) {
    case 'AWAITING_PAYMENT':
    case 'PAYMENT_PENDING':
    case 'MATCHING':
    case 'MATCHING_DELAYED':
    case 'UNFULFILLED':
      return 0;
    case 'ASSIGNED':
      return 1;
    case 'EN_ROUTE':
    case 'ARRIVED':
      return 2;
    case 'INSPECTING':
    case 'QUOTE_SHARED':
    case 'IN_PROGRESS':
    case 'EXTRA_WORK':
    case 'PAYMENT_DUE':
      return 3;
    default:
      return 4;
  }
}
