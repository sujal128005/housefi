// Pure rules the screens and the mock backend share: input validation, visit slots, search, and how a booking's
// matching status moves over time. No React, no storage, so they are easy to unit test.
import type { AddressInput, BookingStatus, Service, Slot, VisitWindow } from './types';
import { CATEGORIES, SERVICES } from '../data/catalog';
import type { Category } from './types';

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

/** Demo service area: Hyderabad PIN codes 500001-500099. */
export function pincodeProblem(pin: string): 'INVALID' | 'OUTSIDE' | null {
  if (!/^\d{6}$/.test(pin)) return 'INVALID';
  const n = Number(pin);
  return n >= 500001 && n <= 500099 ? null : 'OUTSIDE';
}

export type AddressField = 'house' | 'street' | 'pincode';
export type AddressErrors = Partial<Record<AddressField, 'REQUIRED' | 'INVALID' | 'OUTSIDE'>>;

export function validateAddress(a: AddressInput): AddressErrors {
  const e: AddressErrors = {};
  if (a.house.trim().length < 2) e.house = 'REQUIRED';
  if (a.street.trim().length < 3) e.street = 'REQUIRED';
  const pin = pincodeProblem(a.pincode.trim());
  if (pin) e.pincode = a.pincode.trim() === '' ? 'REQUIRED' : pin;
  return e;
}

// ---------- slots ----------

export const SLOT_HOURS: readonly (readonly [number, number])[] = [[8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20]];
export const BOOKABLE_DAYS = 7;
/** A slot can be booked until this many minutes before it starts. */
export const SLOT_CUTOFF_MIN = 60;

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

// ---------- matching timeline (demo backend) ----------

export type MatchingScenario = 'QUICK' | 'SLOW' | 'NONE';

/** Seconds after matching starts at which the demo backend moves the booking on. */
export const MATCHING_TIMELINE: Readonly<Record<MatchingScenario, { delayedAt: number | null; endAt: number; end: BookingStatus }>> = {
  QUICK: { delayedAt: null, endAt: 8, end: 'ASSIGNED' },
  SLOW: { delayedAt: 7, endAt: 20, end: 'ASSIGNED' },
  NONE: { delayedAt: 7, endAt: 16, end: 'UNFULFILLED' },
};

/** The matching status a booking should show `elapsedSec` after matching started. */
export function matchingStatusAt(scenario: MatchingScenario, elapsedSec: number): BookingStatus {
  const t = MATCHING_TIMELINE[scenario];
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

export function isActive(status: BookingStatus): boolean {
  return status !== 'CANCELLED';
}

/** A booking can be cancelled for free until the technician starts travelling (not modelled before Path 2). */
export function canCancel(status: BookingStatus): boolean {
  return status !== 'CANCELLED';
}

export function canReschedule(status: BookingStatus): boolean {
  return status === 'MATCHING_DELAYED' || status === 'UNFULFILLED' || status === 'ASSIGNED';
}
