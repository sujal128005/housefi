// Society repair day: the join code, the cutoff, and the checks for a flat's booking. Pure functions and one database
// check shared by the bookings service (joining is booking with a code) and the society service.
import { randomInt } from 'node:crypto';
import type { Prisma, SocietyDay } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { windowStartMs } from '../slots/slot-rules';

/** No 0/O or 1/I/L: the code is read out and typed by neighbours. */
const CODE_LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
/** A society day can be planned up to this many days ahead. */
export const SOCIETY_MAX_DAYS_AHEAD = 14;
/** The cutoff must be at least this far away when the day is planned (time to gather flats). */
export const SOCIETY_MIN_LEAD_MS = 2 * 60 * 60_000;

export function newSocietyCode(): string {
  return Array.from({ length: 6 }, () => CODE_LETTERS[randomInt(0, CODE_LETTERS.length)]).join('');
}

/** Flats join and pay until this instant: the evening before the day (cutoffHour IST). */
export function societyCutoffMs(windowDate: string, cutoffHour: number): number {
  return windowStartMs(windowDate, cutoffHour) - 24 * 60 * 60_000;
}

/** The day's date as YYYY-MM-DD. */
export const dayDate = (d: Pick<SocietyDay, 'windowDate'>): string => d.windowDate.toISOString().slice(0, 10);

/** Flats that hold a place: not cancelled (unpaid ones expire on their own after 30 minutes). */
export const HOLDING: Prisma.BookingWhereInput = { status: { notIn: ['CANCELLED'] } };
/** Flats that count towards the minimum: their visit fee is paid. */
export const PAID: Prisma.BookingWhereInput = { status: { notIn: ['CANCELLED', 'AWAITING_PAYMENT', 'PAYMENT_PENDING'] } };

export interface SocietyLimits {
  readonly SOCIETY_MAX_FLATS: number;
  readonly SOCIETY_CUTOFF_HOUR: number;
  readonly SOCIETY_VISIT_FEE_RUPEES: number;
}

/**
 * A flat's booking for a society day: the day is open and before its cutoff, the service is in the day's trade, the
 * address is in the day's PIN code, the time is the day's window, demo accounts only with demo days, one flat per
 * customer, and room left. Returns the day (the caller books it with SOCIETY_VISIT_FEE_RUPEES and no slot hold).
 */
export async function checkSocietyJoin(
  tx: Prisma.TransactionClient,
  input: {
    readonly code: string;
    readonly customerId: string;
    readonly categoryId: string;
    readonly pincode: string;
    readonly isDemo: boolean;
    readonly time: { readonly mode: 'INSTANT' | 'SCHEDULED'; readonly window: { readonly date: string; readonly startHour: number; readonly endHour: number } | null };
    readonly now: number;
  },
  limits: SocietyLimits,
): Promise<SocietyDay> {
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new AppError('VALIDATION', { fields: { societyCode: 'INVALID' } });
  // Locked so two neighbours cannot take the last place at once.
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM society_days WHERE code = ${code} FOR UPDATE`;
  const day = row ? await tx.societyDay.findUnique({ where: { id: row.id } }) : null;
  if (!day || day.isDemo !== input.isDemo) throw new AppError('NOT_FOUND');
  if (day.state !== 'OPEN' || input.now >= societyCutoffMs(dayDate(day), limits.SOCIETY_CUTOFF_HOUR)) throw new AppError('CONFLICT', {}, 'this society day is closed for new flats');
  if (input.categoryId !== day.categoryId) throw new AppError('VALIDATION', { fields: { serviceId: 'INVALID' } });
  if (input.pincode.trim() !== day.pincode.trim()) throw new AppError('VALIDATION', { fields: { addressId: 'INVALID' } });
  const w = input.time.window;
  if (input.time.mode !== 'SCHEDULED' || !w || w.date !== dayDate(day) || w.startHour !== day.windowStartHour || w.endHour !== day.windowEndHour) {
    throw new AppError('VALIDATION', { fields: { time: 'INVALID' } });
  }
  if (await tx.booking.count({ where: { societyDayId: day.id, customerId: input.customerId, ...HOLDING } })) throw new AppError('CONFLICT', {}, 'your flat is already booked for this day');
  if ((await tx.booking.count({ where: { societyDayId: day.id, ...HOLDING } })) >= limits.SOCIETY_MAX_FLATS) throw new AppError('CONFLICT', {}, 'this society day is full');
  return day;
}
