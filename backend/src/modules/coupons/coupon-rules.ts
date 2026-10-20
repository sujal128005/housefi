// Coupon arithmetic and checks, as pure functions (easy to test). Amounts in paise.
import type { Coupon } from '@prisma/client';

/** At least ₹1 is always paid (Razorpay's minimum; and a bill is never free by mistake). */
export const MIN_PAYABLE_PAISE = 100n;

export const COUPON_CODE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;

/** "first50 " → "FIRST50". */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** The discount on a bill of `grossPaise`, or 0 when the bill is below the coupon's minimum. */
export function discountFor(c: Pick<Coupon, 'kind' | 'value' | 'maxDiscountPaise' | 'minBillPaise'>, grossPaise: bigint): bigint {
  if (grossPaise < c.minBillPaise) return 0n;
  let d = c.kind === 'FLAT' ? BigInt(c.value) * 100n : (grossPaise * BigInt(c.value)) / 100n;
  if (c.maxDiscountPaise !== null && d > c.maxDiscountPaise) d = c.maxDiscountPaise;
  const most = grossPaise - MIN_PAYABLE_PAISE;
  if (d > most) d = most > 0n ? most : 0n;
  return d;
}

export type CouponProblem = 'UNKNOWN' | 'INACTIVE' | 'NOT_YET' | 'EXPIRED' | 'USED_UP' | 'ALREADY_USED' | 'FIRST_BOOKING_ONLY' | 'BILL_TOO_SMALL';

/** Why a coupon cannot be used now (null when it can). Counts exclude this booking's own redemption. */
export function couponProblem(
  c: Pick<Coupon, 'active' | 'validFrom' | 'validTo' | 'maxUses' | 'perCustomer' | 'firstBookingOnly' | 'minBillPaise'> | null,
  ctx: { now: number; usesByAll: number; usesByCustomer: number; customerCompletedBookings: number; grossPaise: bigint },
): CouponProblem | null {
  if (!c) return 'UNKNOWN';
  if (!c.active) return 'INACTIVE';
  if (c.validFrom && c.validFrom.getTime() > ctx.now) return 'NOT_YET';
  if (c.validTo && c.validTo.getTime() <= ctx.now) return 'EXPIRED';
  if (c.maxUses !== null && ctx.usesByAll >= c.maxUses) return 'USED_UP';
  if (ctx.usesByCustomer >= c.perCustomer) return 'ALREADY_USED';
  if (c.firstBookingOnly && ctx.customerCompletedBookings > 0) return 'FIRST_BOOKING_ONLY';
  if (ctx.grossPaise < c.minBillPaise) return 'BILL_TOO_SMALL';
  return null;
}

/** Plain words for each problem (the app shows its own translated text from the code). */
export const PROBLEM_TEXT: Readonly<Record<CouponProblem, string>> = {
  UNKNOWN: 'No such coupon',
  INACTIVE: 'This coupon is switched off',
  NOT_YET: 'This coupon is not valid yet',
  EXPIRED: 'This coupon has expired',
  USED_UP: 'This coupon has been fully used',
  ALREADY_USED: 'You have already used this coupon',
  FIRST_BOOKING_ONLY: 'This coupon is for your first booking only',
  BILL_TOO_SMALL: 'The bill is below the minimum for this coupon',
};
