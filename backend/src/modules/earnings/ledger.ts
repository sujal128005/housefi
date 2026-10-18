// Writes a job's earnings to the append-only ledger, in the same transaction as the status change that closes it.
// Called by BookingCore.transition, so every path that completes, closes or cancels a job (payment webhook, cash
// confirmation, declined quote, reports, customer cancellation, and the coordinator later) records it the same way.
import type { Booking, BookingStatus, Prisma } from '@prisma/client';
import { approvedQuotes } from '../bookings/quote-view';
import { jobCloseLines, type Shares } from './earnings-rules';

const CLOSING: readonly BookingStatus[] = ['COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED'];

/**
 * Records the ledger lines for `b` (locked, still in its old status) moving to `to`. A job is credited once per kind
 * of line (unique index), so running this twice for the same booking adds nothing.
 */
export async function recordJobClose(tx: Prisma.TransactionClient, b: Booking, to: BookingStatus, shares: Shares, at: Date): Promise<void> {
  if (!b.technicianId || !CLOSING.includes(to)) return;
  let approved: { labourPaise: bigint; materialPaise: bigint }[] = [];
  let cashCollectedPaise: bigint | null = null;
  if (to === 'COMPLETED') {
    approved = approvedQuotes(await tx.quote.findMany({ where: { bookingId: b.id }, orderBy: { version: 'asc' } }));
    const final = await tx.payment.findFirst({ where: { bookingId: b.id, kind: 'FINAL', state: 'PAID' }, orderBy: { createdAt: 'desc' } });
    if (final?.method === 'CASH') cashCollectedPaise = final.amountPaise;
  }
  const lines = jobCloseLines(shares, { from: b.status, to, approved, cashCollectedPaise });
  if (lines.length === 0) return;
  await tx.earningsLedger.createMany({
    data: lines.map((l) => ({ technicianId: b.technicianId!, bookingId: b.id, type: l.type, amountPaise: l.amountPaise, createdAt: at })),
    skipDuplicates: true,
  });
  if (to === 'COMPLETED') await tx.technician.update({ where: { userId: b.technicianId }, data: { jobsDone: { increment: 1 } } });
}
