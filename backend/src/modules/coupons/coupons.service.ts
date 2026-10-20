// Coupons on the final bill: the customer types a code while the bill is due; the server checks it (switched on,
// dates, uses, once per customer, first booking only, minimum bill), takes the discount off the bill, and records it.
// Taking it off again restores the bill. Housefi pays the discount: the technician's earnings come from the approved
// quote and do not change. Not once a payment has started (the bank or the technician is already confirming it).
import { Injectable } from '@nestjs/common';
import type { Coupon, Payment, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { BookingCore } from '../bookings/booking-core';
import type { BookingDto } from '../bookings/booking-view';
import { type CouponProblem, couponProblem, discountFor, normaliseCode } from './coupon-rules';

export interface CouponResult {
  readonly applied: boolean;
  /** Why it could not be used (applied false). */
  readonly problem: CouponProblem | null;
  readonly discount: number;
  readonly booking: BookingDto;
}

@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BookingCore,
  ) {}

  async apply(customerId: string, bookingId: string, rawCode: string): Promise<CouponResult> {
    const code = normaliseCode(rawCode);
    const outcome = await this.core.mutateOwned<{ applied: boolean; problem: CouponProblem | null; discount: bigint }>(customerId, bookingId, async (tx, b) => {
      const bill = await this.openBill(tx, b.id, b.status);
      const gross = bill.amountPaise + bill.discountPaise;
      const coupon = code ? await tx.coupon.findUnique({ where: { code } }) : null;
      if (coupon) await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${coupon.id}::uuid FOR UPDATE`;
      const problem = couponProblem(coupon, {
        now: this.core.now().getTime(),
        usesByAll: coupon ? await tx.couponRedemption.count({ where: { couponId: coupon.id, bookingId: { not: b.id } } }) : 0,
        usesByCustomer: coupon ? await tx.couponRedemption.count({ where: { couponId: coupon.id, customerId, bookingId: { not: b.id } } }) : 0,
        customerCompletedBookings: await tx.booking.count({ where: { customerId, status: 'COMPLETED', id: { not: b.id } } }),
        grossPaise: gross,
      });
      const discount = coupon && !problem ? discountFor(coupon, gross) : 0n;
      if (!coupon || problem || discount <= 0n) return { changed: false, result: { applied: false, problem: problem ?? 'BILL_TOO_SMALL', discount: 0n } };
      await this.rebill(tx, bill, gross - discount, discount, (coupon as Coupon).code);
      await tx.couponRedemption.upsert({
        where: { bookingId: b.id },
        create: { couponId: coupon.id, bookingId: b.id, customerId, discountPaise: discount, createdAt: this.core.now() },
        update: { couponId: coupon.id, discountPaise: discount, createdAt: this.core.now() },
      });
      return { changed: true, result: { applied: true, problem: null, discount } };
    });
    return { applied: outcome.applied, problem: outcome.problem, discount: paiseToRupees(outcome.discount), booking: await this.core.get(customerId, bookingId) };
  }

  async remove(customerId: string, bookingId: string): Promise<BookingDto> {
    await this.core.mutateOwned(customerId, bookingId, async (tx, b) => {
      const bill = await this.openBill(tx, b.id, b.status);
      if (bill.discountPaise === 0n) return { changed: false, result: undefined };
      await this.rebill(tx, bill, bill.amountPaise + bill.discountPaise, 0n, null);
      await tx.couponRedemption.deleteMany({ where: { bookingId: b.id } });
      return { changed: true, result: undefined };
    });
    return this.core.get(customerId, bookingId);
  }

  /** The final bill while it can still change: PAYMENT_DUE, and no payment started. */
  private async openBill(tx: Prisma.TransactionClient, bookingId: string, status: string): Promise<Payment> {
    if (status !== 'PAYMENT_DUE') throw new AppError('CONFLICT', {}, 'a coupon goes on the final bill');
    const latest = await tx.payment.findFirst({ where: { bookingId, kind: 'FINAL' }, orderBy: { createdAt: 'desc' } });
    if (!latest || latest.state === 'PAID' || latest.state === 'REFUNDED' || latest.state === 'PENDING') {
      throw new AppError('CONFLICT', {}, 'the payment has already started');
    }
    return latest;
  }

  /** The bill's new amount: the same row while nothing was sent to the bank, else a fresh attempt. */
  private async rebill(tx: Prisma.TransactionClient, latest: Payment, amountPaise: bigint, discountPaise: bigint, couponCode: string | null): Promise<void> {
    const data = { amountPaise, discountPaise, couponCode };
    if (latest.state === 'DUE' && !latest.providerOrderId) {
      await tx.payment.update({ where: { id: latest.id }, data });
      return;
    }
    // An order made for the old amount is left behind (it can no longer be paid from the app).
    if (latest.state === 'PROCESSING') await tx.payment.update({ where: { id: latest.id }, data: { state: 'FAILED', failureCode: 'BILL_CHANGED' } });
    await tx.payment.create({ data: { bookingId: latest.bookingId, kind: 'FINAL', state: 'DUE', createdAt: this.core.now(), ...data } });
  }
}
