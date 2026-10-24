// The Fair-pay meter: where the customer's money goes (technician, parts, Housefi), shown to the customer and the
// technician on the same booking. Worked out with the ledger's own rules (jobCredits), so the technician's part is
// exactly what their earnings record. No tax line: Housefi charges no GST yet (INVOICE_GSTIN unset).
import type { Booking, Payment, Quote } from '@prisma/client';
import { approvedQuotes } from '../bookings/quote-view';
import { jobCredits, rupees, type Shares } from './earnings-rules';

/** openapi.yaml FairPay. Rupees. */
export interface FairPayDto {
  /** What the customer pays in all so far: the visit fee, plus the bill (after any coupon) once there is one. */
  readonly total: number;
  /** The technician's share: their part of the visit fee and of the labour. */
  readonly technician: number;
  /** Parts and materials, paid back to the technician in full. */
  readonly parts: number;
  /** What Housefi keeps (support, warranty, payments, the app). Below 0 when Housefi paid a coupon beyond its share. */
  readonly housefi: number;
  /** Apprentice mode: the trainee's pay for helping, paid by Housefi out of its part (0 without a trainee). */
  readonly trainee: number;
  /** A coupon's discount, paid by Housefi (not by the technician). */
  readonly coupon: number;
  readonly labourSharePercent: number;
  /** The repair bill is included (false: only the visit fee so far). */
  readonly withBill: boolean;
}

type Row = Pick<Booking, 'status' | 'traineeId' | 'traineeHelped'> & { readonly payments: readonly Payment[]; readonly quotes: readonly Quote[]; readonly events: readonly { readonly status: Booking['status'] }[] };

const latest = (payments: readonly Payment[], kind: Payment['kind']) =>
  [...payments].filter((p) => p.kind === kind).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

/**
 * The split of what the customer pays for this booking, or null when there is nothing to split: the visit fee is not
 * paid (or was refunded), or the booking was cancelled before the technician set off.
 */
export function fairPay(shares: Shares, b: Row): FairPayDto | null {
  const visit = latest(b.payments, 'VISIT');
  if (!visit || visit.state !== 'PAID') return null;
  if (b.status === 'CANCELLED' && !b.events.some((e) => e.status === 'EN_ROUTE')) return null;
  const final = latest(b.payments, 'FINAL');
  const withBill = !!final && final.state !== 'FAILED' && final.state !== 'REFUNDED' && b.status !== 'CLOSED_NO_REPAIR' && b.status !== 'CANCELLED';
  const lines = jobCredits(shares, withBill ? approvedQuotes([...b.quotes]) : []);
  const part = (type: string) => lines.filter((l) => l.type === type).reduce((s, l) => s + l.amountPaise, 0n);
  const total = rupees(visit.amountPaise + (withBill ? final.amountPaise : 0n));
  const technician = rupees(part('VISIT_SHARE') + part('LABOUR_SHARE'));
  const parts = rupees(part('MATERIAL_REIMBURSE'));
  // A trainee on the job is paid unless the technician said they did not help, or the job ended without a repair.
  const trainee = b.traineeId && b.traineeHelped !== false && withBill ? (shares.apprenticeShareRupees ?? 0) : 0;
  return {
    total,
    technician,
    parts,
    housefi: total - technician - parts - trainee,
    trainee,
    coupon: withBill ? rupees(final.discountPaise) : 0,
    labourSharePercent: shares.labourSharePercent,
    withBill,
  };
}
