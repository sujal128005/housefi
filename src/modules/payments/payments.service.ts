import { Injectable } from '@nestjs/common';
import type { PaymentKind, Prisma } from '@prisma/client';

/**
 * Payment records of a booking. Step 5 only creates the ₹49 visit fee as DUE and records refund decisions;
 * step 6 adds Razorpay (orders, signature checks, webhooks) and sends the refunds recorded here to Razorpay.
 */
@Injectable()
export class PaymentsService {
  async createDue(tx: Prisma.TransactionClient, bookingId: string, kind: PaymentKind, amountPaise: bigint): Promise<void> {
    await tx.payment.create({ data: { bookingId, kind, amountPaise, state: 'DUE' } });
  }

  /**
   * Records that a paid visit fee is to be refunded (cancellation before EN_ROUTE, unfulfilled booking) and shows
   * it as REFUNDED, as the contract expects. No money moves in step 5: nothing can be paid yet.
   */
  async refundVisitFee(tx: Prisma.TransactionClient, bookingId: string, at: Date): Promise<boolean> {
    const r = await tx.payment.updateMany({
      where: { bookingId, kind: 'VISIT', state: 'PAID' },
      data: { state: 'REFUNDED', refundRequestedAt: at, settledAt: at },
    });
    return r.count > 0;
  }
}
