// Who hears about a booking's status change (README §9, NotificationKind). Called by BookingCore.transition in the
// transaction of the change, so every path (webhooks, sweeps, the customer, the technician, the coordinator later)
// notifies the same way. Notices that are not a status change (job offers, revision requests, profile decisions)
// are written where they happen.
import type { ActorType, Booking, BookingStatus, Prisma } from '@prisma/client';
import { latestQuote } from '../bookings/quote-view';
import type { Notice, NoticeParams } from './notifier';

export interface TransitionActor {
  readonly type: ActorType;
  readonly id: string | null;
}

const rupees = (paise: bigint) => Math.round(Number(paise) / 100);

/**
 * The notices for `before` (locked, old status) becoming `after` (updated row, new status). The actor's own action
 * does not notify them (a customer who cancels gets no "booking cancelled").
 */
export async function transitionNotices(tx: Prisma.TransactionClient, before: Booking, after: Booking, actor: TransitionActor): Promise<Notice[]> {
  const from: BookingStatus = before.status;
  const to: BookingStatus = after.status;
  const code = after.code;
  const notices: Notice[] = [];
  const isActor = (userId: string) => actor.id === userId;
  const customer = (kind: Notice['kind'], params: NoticeParams = {}) => {
    if (!isActor(after.customerId)) notices.push({ userId: after.customerId, kind, bookingId: after.id, params: { code, ...params } });
  };
  const technician = (userId: string | null, kind: Notice['kind'], params: NoticeParams = {}) => {
    if (userId && !isActor(userId)) notices.push({ userId, kind, bookingId: after.id, params: { code, ...params } });
  };
  const quotes = () => tx.quote.findMany({ where: { bookingId: after.id } });
  const finalPayment = (paid: boolean) =>
    tx.payment.findFirst({ where: { bookingId: after.id, kind: 'FINAL', ...(paid ? { state: 'PAID' as const } : {}) }, orderBy: { createdAt: 'desc' } });

  switch (to) {
    case 'ASSIGNED':
      customer('TECH_ASSIGNED', { serviceId: after.serviceId });
      break;
    case 'EN_ROUTE':
      customer('TECH_ON_THE_WAY', after.etaMin !== null ? { etaMin: after.etaMin } : {});
      break;
    case 'ARRIVED':
      customer('TECH_ARRIVED');
      break;
    case 'QUOTE_SHARED': {
      const q = latestQuote(await quotes(), 'MAIN', true);
      if (q) customer('QUOTE_READY', { amount: rupees(q.totalPaise), version: q.version });
      break;
    }
    case 'EXTRA_WORK': {
      const q = latestQuote(await quotes(), 'EXTRA', true);
      if (q) customer('EXTRA_QUOTE', { amount: rupees(q.totalPaise) });
      break;
    }
    case 'IN_PROGRESS': {
      const all = await quotes();
      if (from === 'QUOTE_SHARED') {
        const q = latestQuote(all, 'MAIN', true);
        technician(after.technicianId, 'QUOTE_APPROVED', q ? { amount: rupees(q.totalPaise) } : {});
      } else if (from === 'EXTRA_WORK') {
        const q = latestQuote(all, 'EXTRA', true);
        if (q?.decision === 'APPROVED') technician(after.technicianId, 'EXTRA_APPROVED', { amount: rupees(q.totalPaise) });
        else technician(after.technicianId, 'EXTRA_DECLINED');
      }
      break;
    }
    case 'CLOSED_NO_REPAIR':
      if (after.closeReason === 'CUSTOMER_DECLINED') technician(after.technicianId, 'QUOTE_DECLINED');
      break;
    case 'PAYMENT_DUE': {
      const p = await finalPayment(false);
      customer('PAYMENT_DUE', p ? { amount: rupees(p.amountPaise) } : {});
      break;
    }
    case 'COMPLETED': {
      const p = await finalPayment(true);
      customer('BOOKING_COMPLETED');
      technician(after.technicianId, 'PAYMENT_RECEIVED', p ? { amount: rupees(p.amountPaise), method: p.method ?? 'UPI' } : {});
      break;
    }
    case 'CANCELLED':
      customer('BOOKING_CANCELLED', after.cancelReason ? { reason: after.cancelReason } : {});
      technician(before.technicianId, 'JOB_CANCELLED', { reason: 'BOOKING_CANCELLED' });
      break;
    case 'UNFULFILLED':
      customer('NO_TECHNICIAN');
      break;
    case 'MATCHING':
      // Taken back from an assigned technician: rescheduled by the customer, or reassigned for not starting in time.
      if (from === 'ASSIGNED' && before.technicianId && after.technicianId !== before.technicianId) {
        technician(before.technicianId, 'JOB_CANCELLED', { reason: actor.type === 'CUSTOMER' ? 'RESCHEDULED' : 'REASSIGNED' });
      }
      break;
    default:
      break;
  }
  return notices;
}
