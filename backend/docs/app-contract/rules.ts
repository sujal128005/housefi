// Pure rules the screens and the mock backend share: input validation, visit slots, search, money, and the booking
// lifecycle (what can happen next, demo timings). No React, no storage, so they are easy to unit test.
import { CATEGORIES, SERVICES } from '../data/catalog';
import type { AddressInput, BookingStatus, Category, Quote, QuoteLine, Service, Slot, VisitWindow } from './types';

// ---------- validation ----------

/** Indian mobile numbers: 10 digits starting 6-9. Accepts spaces; returns the bare digits or null. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
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

/** What the customer pays at the end: the approved quote plus approved extra work. */
export function finalAmount(quote: Quote | null, extra: Quote | null): number {
  return (quote?.decision === 'APPROVED' ? quote.total : 0) + (extra?.decision === 'APPROVED' ? extra.total : 0);
}

// ---------- lifecycle ----------

export type MatchingScenario = 'QUICK' | 'SLOW' | 'NONE';
export type PaymentOutcome = 'SUCCESS' | 'PENDING' | 'FAILED';

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
