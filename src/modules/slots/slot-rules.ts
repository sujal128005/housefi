// Visit-window rules, as in the app's src/domain/rules.ts but on India time regardless of the server's time zone:
// six 2-hour windows from 08:00 to 20:00 IST, bookable until 60 minutes before they start, for 7 days from today.
// Pure functions, so they are easy to test.

export const SLOT_HOURS: readonly (readonly [number, number])[] = [[8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20]];
export const BOOKABLE_DAYS = 7;
export const SLOT_CUTOFF_MIN = 60;

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export type SlotState = 'OPEN' | 'FULL' | 'CLOSED';

/** openapi.yaml Slot. */
export interface Slot {
  /** "2026-10-17@10" */
  readonly id: string;
  readonly date: string;
  readonly startHour: number;
  readonly endHour: number;
  readonly state: SlotState;
}

/** The IST calendar date ("YYYY-MM-DD") of an instant. */
export function istDate(epochMs: number): string {
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The IST hour (0-23) of an instant. */
export function istHour(epochMs: number): number {
  return new Date(epochMs + IST_OFFSET_MS).getUTCHours();
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** When a window starts, as an instant: `hour`:00 IST on `date`. */
export function windowStartMs(date: string, hour: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, hour) - IST_OFFSET_MS;
}

/** Today and the next six days, in IST. */
export function bookableDates(nowMs: number): string[] {
  const today = Date.parse(`${istDate(nowMs)}T00:00:00Z`);
  return Array.from({ length: BOOKABLE_DAYS }, (_, k) => new Date(today + k * DAY_MS).toISOString().slice(0, 10));
}

export interface SlotInputs {
  readonly date: string;
  readonly nowMs: number;
  /** Bookings allowed per window. */
  readonly capacity: number;
  /** Bookings already holding each window, by start hour. */
  readonly booked: ReadonlyMap<number, number>;
}

/** The six windows of a day. Outside the 7 bookable days every window is CLOSED. */
export function slotsFor({ date, nowMs, capacity, booked }: SlotInputs): Slot[] {
  const bookable = bookableDates(nowMs).includes(date);
  return SLOT_HOURS.map(([startHour, endHour]) => {
    const closed = !bookable || windowStartMs(date, startHour) - nowMs < SLOT_CUTOFF_MIN * 60_000;
    const full = !closed && (booked.get(startHour) ?? 0) >= capacity;
    return { id: `${date}@${startHour}`, date, startHour, endHour, state: closed ? 'CLOSED' : full ? 'FULL' : 'OPEN' };
  });
}
