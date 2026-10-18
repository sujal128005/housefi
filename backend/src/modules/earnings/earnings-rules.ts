// What a closed job writes to the technician's ledger, and the weekly payout calendar (README §10). Pure functions in
// paise, shared by the ledger writer, the Job view and the tests.
import type { BookingStatus, LedgerType } from '@prisma/client';
import { istDate, windowStartMs } from '../slots/slot-rules';

export interface Shares {
  readonly visitShareRupees: number;
  readonly labourSharePercent: number;
}

export interface ApprovedAmounts {
  readonly labourPaise: bigint;
  readonly materialPaise: bigint;
}

export interface LedgerLine {
  readonly type: Extract<LedgerType, 'VISIT_SHARE' | 'LABOUR_SHARE' | 'MATERIAL_REIMBURSE' | 'CASH_COLLECTED'>;
  /** Credits positive, debits negative. */
  readonly amountPaise: bigint;
}

/** The technician's credits for a visit with these approved quotes: visit share + labour share + all materials. */
export function jobCredits(shares: Shares, approved: readonly ApprovedAmounts[]): LedgerLine[] {
  const labour = approved.reduce((sum, q) => sum + (q.labourPaise * BigInt(shares.labourSharePercent)) / 100n, 0n);
  const materials = approved.reduce((sum, q) => sum + q.materialPaise, 0n);
  const lines: LedgerLine[] = [
    { type: 'VISIT_SHARE', amountPaise: BigInt(shares.visitShareRupees) * 100n },
    { type: 'LABOUR_SHARE', amountPaise: labour },
    { type: 'MATERIAL_REIMBURSE', amountPaise: materials },
  ];
  return lines.filter((l) => l.amountPaise > 0n);
}

export interface JobClose {
  readonly from: BookingStatus;
  readonly to: BookingStatus;
  readonly approved: readonly ApprovedAmounts[];
  /** The bill, when the customer paid it to the technician in cash. */
  readonly cashCollectedPaise: bigint | null;
}

/**
 * The ledger lines for a job reaching a final status:
 * - COMPLETED: the visit share, labour share and materials, and the cash the technician took as a debit (it is
 *   Housefi's money, netted in the weekly payout).
 * - CLOSED_NO_REPAIR: the visit share (the technician came; README §10 "also when no repair happens").
 * - CANCELLED while EN_ROUTE: the visit share (the customer keeps no refund, the technician was travelling).
 * Anything else (cancelled before the trip, unfulfilled, expired) earns nothing.
 */
export function jobCloseLines(shares: Shares, close: JobClose): LedgerLine[] {
  if (close.to === 'COMPLETED') {
    const lines = jobCredits(shares, close.approved);
    if (close.cashCollectedPaise && close.cashCollectedPaise > 0n) lines.push({ type: 'CASH_COLLECTED', amountPaise: -close.cashCollectedPaise });
    return lines;
  }
  if (close.to === 'CLOSED_NO_REPAIR' || (close.to === 'CANCELLED' && close.from === 'EN_ROUTE')) return jobCredits(shares, []);
  return [];
}

/** Paise to whole rupees, rounded half up (the API shows rupees). */
export function rupees(paise: bigint): number {
  return Math.round(Number(paise) / 100);
}

const DAY_MS = 24 * 60 * 60_000;

/** IST weekday, 0 = Sunday ... 1 = Monday. */
function istWeekday(epochMs: number): number {
  return new Date(`${istDate(epochMs)}T00:00:00Z`).getUTCDay();
}

/**
 * The weekly payout day: Mondays. Today when it is Monday (that day's payout covers the week to Sunday), else the
 * coming Monday. "YYYY-MM-DD" in IST.
 */
export function nextPayoutOn(nowMs: number): string {
  const daysAhead = (8 - istWeekday(nowMs)) % 7;
  return istDate(nowMs + daysAhead * DAY_MS);
}

/** The week a payout prepared now settles: entries before 00:00 IST on the latest Monday (today if Monday). */
export function payoutCutoff(nowMs: number): { cutoffMs: number; periodEnd: string } {
  const daysBack = (istWeekday(nowMs) + 6) % 7;
  const monday = istDate(nowMs - daysBack * DAY_MS);
  const cutoffMs = windowStartMs(monday, 0);
  return { cutoffMs, periodEnd: istDate(cutoffMs - 1) };
}
