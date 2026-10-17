import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payment, PaymentKind, PaymentMethod, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCore, SYSTEM, UUID } from '../bookings/booking-core';
import type { BookingDto } from '../bookings/booking-view';
import { RAZORPAY_CLIENT, type RazorpayClient, type RzpPayment } from './razorpay.client';
import { verifyCheckoutSignature, verifyWebhookSignature } from './razorpay.signatures';

/** A PROCESSING order younger than this is reused when the customer reopens the payment sheet. */
const ORDER_REUSE_MIN = 15;
/** PENDING / PROCESSING payments are re-checked with Razorpay at most this often. */
const RECHECK_EVERY_MIN = 10;
/** A PROCESSING order with no payment after this long is abandoned (FAILED). */
const ABANDON_AFTER_MIN = 24 * 60;

/** openapi.yaml PaymentOrder: what the app passes to the Razorpay checkout sheet. */
export interface PaymentOrderDto {
  readonly paymentId: string;
  readonly provider: 'RAZORPAY';
  readonly orderId: string;
  readonly keyId: string;
  /** Whole rupees. */
  readonly amount: number;
}

/** openapi.yaml PaymentResult. */
export interface PaymentResultDto {
  readonly state: 'PAID' | 'PENDING' | 'FAILED';
  readonly booking: BookingDto;
}

export type StartResult = { readonly kind: 'order'; readonly order: PaymentOrderDto } | { readonly kind: 'cash' };

type Outcome = 'PAID' | 'PENDING' | 'FAILED';

const RZP_METHODS: Record<string, PaymentMethod> = { upi: 'UPI', card: 'CARD', netbanking: 'NETBANKING' };

/** Only ids, amounts and statuses are kept from webhook payloads (Razorpay also sends the payer's contact details). */
const KEEP = ['id', 'entity', 'amount', 'currency', 'status', 'order_id', 'payment_id', 'method', 'captured', 'error_code', 'error_reason', 'created_at'];

function redactEntity(e: unknown): Record<string, unknown> | undefined {
  if (!e || typeof e !== 'object') return undefined;
  return Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([k]) => KEEP.includes(k)));
}

interface WebhookBody {
  event?: unknown;
  payload?: { payment?: { entity?: RzpPayment }; refund?: { entity?: { id?: string; payment_id?: string; status?: string } } };
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BookingCore,
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: RazorpayClient | null,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- used by bookings ----------

  async createDue(tx: Prisma.TransactionClient, bookingId: string, kind: PaymentKind, amountPaise: bigint): Promise<void> {
    await tx.payment.create({ data: { bookingId, kind, amountPaise, state: 'DUE', createdAt: this.core.now() } });
  }

  /** Marks a paid visit fee for refund (sent to Razorpay right after commit, and retried by the worker). */
  async refundVisitFee(tx: Prisma.TransactionClient, bookingId: string, at: Date): Promise<boolean> {
    const r = await tx.payment.updateMany({ where: { bookingId, kind: 'VISIT', state: 'PAID' }, data: { state: 'REFUNDED', refundRequestedAt: at, settledAt: at } });
    return r.count > 0;
  }

  // ---------- customer ----------

  /**
   * Starts paying the visit fee (VISIT, online only) or the bill (FINAL, online or CASH). Online: returns a Razorpay
   * order for the checkout sheet. CASH: the bill waits for the technician to confirm. The same Idempotency-Key
   * returns the same answer.
   */
  async start(customerId: string, bookingId: string, kind: PaymentKind, method: PaymentMethod, idempotencyKey: string): Promise<StartResult> {
    if (kind === 'VISIT' && method === 'CASH') throw new AppError('VALIDATION', { fields: { method: 'INVALID' } }, 'the visit fee is paid online');
    const result = await this.core.mutateOwned(customerId, bookingId, async (tx, b): Promise<{ changed: boolean; result: StartResult }> => {
      const attempts = await tx.payment.findMany({ where: { bookingId: b.id, kind }, orderBy: { createdAt: 'asc' } });
      const replay = attempts.find((p) => p.idempotencyKey === idempotencyKey);
      if (replay) return { changed: false, result: this.startResult(replay) };

      const expected = kind === 'VISIT' ? 'AWAITING_PAYMENT' : 'PAYMENT_DUE';
      const latest = attempts.at(-1);
      if (b.status !== expected || !latest) throw new AppError('CONFLICT');
      if (latest.state === 'PAID' || latest.state === 'REFUNDED') throw new AppError('CONFLICT');
      if (latest.state === 'PENDING' && latest.method !== 'CASH') throw new AppError('CONFLICT', {}, 'the bank is still confirming the last payment');

      if (method === 'CASH') {
        if (latest.state === 'PENDING' && latest.method === 'CASH') return { changed: false, result: { kind: 'cash' } };
        const row = latest.state === 'DUE' ? latest : await this.newAttempt(tx, latest);
        await tx.payment.update({ where: { id: row.id }, data: { method: 'CASH', provider: 'CASH', state: 'PENDING', idempotencyKey } });
        return { changed: true, result: { kind: 'cash' } };
      }

      const now = this.core.now();
      const fresh = latest.state === 'PROCESSING' && latest.orderedAt && latest.orderedAt.getTime() > now.getTime() - ORDER_REUSE_MIN * 60_000;
      if (fresh && latest.providerOrderId) {
        // The customer reopened the sheet: the same order can still be paid.
        const row = await tx.payment.update({ where: { id: latest.id }, data: { method, idempotencyKey } });
        return { changed: false, result: this.startResult(row) };
      }
      const razorpay = this.client(); // "payments not configured" is reported as itself, not as an outage
      const row = latest.state === 'DUE' && !latest.providerOrderId ? latest : await this.newAttempt(tx, latest);
      let orderId: string;
      try {
        const order = await razorpay.createOrder({
          amountPaise: Number(row.amountPaise),
          receipt: `${b.code}-${kind}-${row.id.slice(0, 8)}`,
          notes: { bookingId: b.id, paymentId: row.id, kind },
        });
        orderId = order.id;
      } catch (err) {
        this.log.error(`Razorpay order failed for booking ${b.code} (${(err as Error).message})`);
        throw new AppError('INTERNAL', {}, 'payment provider unavailable');
      }
      const updated = await tx.payment.update({
        where: { id: row.id },
        data: { state: 'PROCESSING', method, provider: 'RAZORPAY', providerOrderId: orderId, orderedAt: now, idempotencyKey },
      });
      return { changed: true, result: this.startResult(updated) };
    });
    return result;
  }

  /**
   * After the checkout sheet returns: checks the signature, then asks Razorpay for the payment's real status (the
   * app is never trusted). An invalid signature or a different order is PAYMENT_FAILED and changes nothing.
   */
  async verify(customerId: string, paymentId: string, body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }): Promise<PaymentResultDto> {
    const p = UUID.test(paymentId) ? await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { booking: { select: { customerId: true } } } }) : null;
    if (!p || p.booking.customerId !== customerId) throw new AppError('NOT_FOUND');
    if (p.provider !== 'RAZORPAY' || !p.providerOrderId) throw new AppError('CONFLICT');
    const secret = this.config.RAZORPAY_KEY_SECRET;
    if (!secret) throw new AppError('INTERNAL', {}, 'payments not configured');
    if (body.razorpayOrderId !== p.providerOrderId || !verifyCheckoutSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature, secret)) {
      this.log.warn(`checkout signature rejected for payment ${p.id}`);
      throw new AppError('PAYMENT_FAILED', {}, 'signature mismatch');
    }
    let rp: RzpPayment;
    try {
      rp = await this.client().fetchPayment(body.razorpayPaymentId);
    } catch (err) {
      this.log.error(`Razorpay fetch failed for payment ${p.id} (${(err as Error).message})`);
      throw new AppError('INTERNAL', {}, 'payment provider unavailable');
    }
    if (rp.order_id !== p.providerOrderId) throw new AppError('PAYMENT_FAILED', {}, 'payment belongs to another order');
    const state = await this.settle(p.id, rp);
    return { state, booking: await this.core.get(customerId, p.bookingId) };
  }

  // ---------- technician ----------

  /** The customer chose cash for the bill and the assigned technician confirms receiving it: the booking completes. */
  async confirmCash(technicianId: string, bookingId: string): Promise<void> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      const b = await this.core.lock(tx, bookingId);
      if (!b || b.technicianId !== technicianId) throw new AppError('NOT_FOUND');
      const latest = await tx.payment.findFirst({ where: { bookingId, kind: 'FINAL' }, orderBy: { createdAt: 'desc' } });
      if (b.status !== 'PAYMENT_DUE' || !latest || latest.method !== 'CASH' || latest.state !== 'PENDING') throw new AppError('CONFLICT');
      await tx.payment.update({ where: { id: latest.id }, data: { state: 'PAID', settledAt: this.core.now() } });
      // Step 10: the earnings ledger records cash collected here.
      await this.core.transition(tx, b, 'COMPLETED', {}, { type: 'TECHNICIAN', id: technicianId }, { paymentId: latest.id, cash: true });
    });
    this.core.updates.publish(bookingId);
  }

  // ---------- Razorpay webhooks ----------

  /**
   * Handles one webhook delivery: signature check over the raw body, then each event is processed once (Razorpay
   * retries deliveries; a retry of an event that failed half-way is processed again, which is safe).
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined): Promise<void> {
    const secret = this.config.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new AppError('INTERNAL', {}, 'payments not configured');
    if (!signature || !verifyWebhookSignature(rawBody, signature, secret)) throw new AppError('UNAUTHENTICATED', {}, 'webhook signature mismatch');
    let body: WebhookBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as WebhookBody;
    } catch {
      throw new AppError('VALIDATION');
    }
    const id = eventId || `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
    const event = typeof body.event === 'string' ? body.event : 'unknown';
    const stored = {
      event,
      payment: redactEntity(body.payload?.payment?.entity),
      refund: redactEntity(body.payload?.refund?.entity),
    };
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO payment_webhook_events (provider_event_id, event, payload, received_at)
      VALUES (${id}, ${event}, ${JSON.stringify(stored)}::jsonb, ${this.core.now()})
      ON CONFLICT (provider_event_id) DO NOTHING`;
    if (inserted === 0) {
      const seen = await this.prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: id } });
      if (seen?.processedAt) return;
    }
    await this.processEvent(event, body);
    await this.prisma.paymentWebhookEvent.update({ where: { providerEventId: id }, data: { processedAt: this.core.now() } });
  }

  private async processEvent(event: string, body: WebhookBody): Promise<void> {
    if (event === 'payment.captured' || event === 'payment.authorized' || event === 'payment.failed' || event === 'order.paid') {
      const rp = body.payload?.payment?.entity;
      if (!rp?.order_id) return;
      const row = await this.prisma.payment.findUnique({ where: { providerOrderId: rp.order_id } });
      if (!row) {
        this.log.warn(`webhook ${event} for an unknown order; ignored`);
        return;
      }
      await this.settle(row.id, rp);
      return;
    }
    if (event === 'refund.processed' || event === 'refund.failed') {
      const refund = body.payload?.refund?.entity;
      if (!refund?.id) return;
      const row = await this.prisma.payment.findFirst({ where: { providerRefundId: refund.id } });
      if (!row) return;
      if (event === 'refund.processed') {
        await this.prisma.payment.update({ where: { id: row.id }, data: { refundProcessedAt: this.core.now() } });
      } else {
        // Needs a person: support follows up (support tickets arrive in step 13).
        await this.prisma.payment.update({ where: { id: row.id }, data: { failureCode: 'REFUND_FAILED' } });
        this.log.error(`Razorpay refund failed for payment ${row.id}; needs manual follow-up`);
      }
    }
    // Other events are stored for audit and otherwise ignored.
  }

  // ---------- settling a payment ----------

  /**
   * Applies Razorpay's view of a payment to our records and the booking. Authorized payments are captured first.
   * Returns the resulting state for the app.
   */
  private async settle(paymentId: string, rp0: RzpPayment): Promise<Outcome> {
    let rp = rp0;
    if (rp.status === 'authorized') {
      try {
        rp = await this.client().capture(rp.id, rp.amount);
      } catch (err) {
        this.log.warn(`capture failed for payment ${paymentId} (${(err as Error).message}); will retry`);
      }
    }
    const { outcome, refund, bookingId } = await this.prisma.$transaction(async (tx) => {
      const first = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const b = await this.core.lock(tx, first.bookingId);
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (!b) throw new Error(`payment ${p.id} has no booking`);
      const done = { bookingId: b.id, refund: false };
      if (p.state === 'PAID' || p.state === 'REFUNDED') return { ...done, outcome: 'PAID' as Outcome, changed: false };

      const outcome = this.outcomeOf(p, rp);
      const now = this.core.now();
      // The method the customer actually used (wallets and EMI keep the one they picked).
      const method = (rp.method ? RZP_METHODS[rp.method] : undefined) ?? p.method;
      if (outcome === 'PAID') {
        await tx.payment.update({ where: { id: p.id }, data: { state: 'PAID', providerPaymentId: rp.id, method, settledAt: now, failureCode: null } });
        const paidBefore = await tx.payment.count({ where: { bookingId: b.id, kind: p.kind, state: { in: ['PAID', 'REFUNDED'] }, id: { not: p.id } } });
        const waiting = p.kind === 'VISIT' ? b.status === 'AWAITING_PAYMENT' || b.status === 'PAYMENT_PENDING' : b.status === 'PAYMENT_DUE';
        if (waiting && paidBefore === 0) {
          // VISIT: the booking is confirmed (dispatch starts here in step 8). FINAL: completed (earnings in step 10).
          await this.core.transition(tx, b, p.kind === 'VISIT' ? 'MATCHING' : 'COMPLETED', {}, SYSTEM, { paymentId: p.id });
          return { ...done, outcome, changed: true };
        }
        // Paid for a booking that no longer needs it (cancelled or expired meanwhile, or paid twice): refund in full.
        await tx.payment.update({ where: { id: p.id }, data: { state: 'REFUNDED', refundRequestedAt: now } });
        this.log.warn(`payment ${p.id} arrived for booking ${b.code} in ${b.status}; refunding`);
        return { bookingId: b.id, refund: true, outcome, changed: true };
      }
      if (outcome === 'PENDING') {
        await tx.payment.update({ where: { id: p.id }, data: { state: 'PENDING', providerPaymentId: rp.id, method, lastCheckedAt: now } });
        if (p.state !== 'PENDING' && p.kind === 'VISIT' && b.status === 'AWAITING_PAYMENT') {
          await this.core.transition(tx, b, 'PAYMENT_PENDING', {}, SYSTEM, { paymentId: p.id });
        }
        return { ...done, outcome, changed: p.state !== 'PENDING' };
      }
      if (p.state === 'FAILED') return { ...done, outcome, changed: false };
      await tx.payment.update({
        where: { id: p.id },
        data: { state: 'FAILED', providerPaymentId: rp.id, method, failureCode: rp.error_code ?? 'FAILED', settledAt: now },
      });
      if (p.kind === 'VISIT' && b.status === 'PAYMENT_PENDING') await this.core.transition(tx, b, 'AWAITING_PAYMENT', {}, SYSTEM, { paymentId: p.id });
      return { ...done, outcome, changed: true };
    });
    this.core.updates.publish(bookingId);
    if (refund) this.sendRefundsSoon(bookingId);
    return outcome;
  }

  private outcomeOf(p: Payment, rp: RzpPayment): Outcome {
    if (rp.status === 'failed') return 'FAILED';
    if (rp.status === 'captured' || rp.status === 'refunded') {
      if (rp.amount === Number(p.amountPaise) && rp.currency === 'INR') return 'PAID';
      this.log.error(`payment ${p.id}: Razorpay captured ${rp.amount} ${rp.currency}, expected ${p.amountPaise} INR; held for review`);
    }
    return 'PENDING';
  }

  // ---------- refunds ----------

  /** Sends this booking's pending refunds in the background; the worker retries anything that fails. */
  sendRefundsSoon(bookingId: string): void {
    void this.sendPendingRefunds(bookingId).catch((err: Error) => this.log.warn(`refund send failed (${err.message}); the worker retries`));
  }

  /** Sends refunds that were decided but not yet sent to Razorpay. Each one is claimed first so it goes out once. */
  async sendPendingRefunds(bookingId?: string): Promise<number> {
    if (!this.razorpay) return 0;
    const due = await this.prisma.payment.findMany({
      where: { state: 'REFUNDED', provider: 'RAZORPAY', providerRefundId: null, providerPaymentId: { not: null }, ...(bookingId ? { bookingId } : {}) },
      take: 50,
    });
    let sent = 0;
    for (const p of due) {
      const claim = `claim:${randomUUID()}`;
      const claimed = await this.prisma.payment.updateMany({ where: { id: p.id, providerRefundId: null }, data: { providerRefundId: claim } });
      if (claimed.count === 0) continue;
      try {
        const refund = await this.razorpay.refund(p.providerPaymentId as string, {
          amountPaise: Number(p.amountPaise),
          receipt: `refund-${p.id.slice(0, 8)}`,
          notes: { bookingId: p.bookingId, paymentId: p.id },
        });
        await this.prisma.payment.update({ where: { id: p.id }, data: { providerRefundId: refund.id } });
        sent++;
      } catch (err) {
        await this.prisma.payment.updateMany({ where: { id: p.id, providerRefundId: claim }, data: { providerRefundId: null } });
        this.log.warn(`Razorpay refund failed for payment ${p.id} (${(err as Error).message}); will retry`);
      }
    }
    return sent;
  }

  // ---------- reconciliation ----------

  /**
   * Asks Razorpay about payments we have not heard back on: PENDING ones (bank still confirming) and PROCESSING
   * orders older than the reuse window (the app may have closed after paying, and the webhook may be late).
   * Each payment is checked at most every 10 minutes; orders with no payment after 24 hours are abandoned.
   */
  async reconcile(): Promise<number> {
    if (!this.razorpay) return 0;
    const now = this.clock.now();
    const recheckBefore = new Date(now - RECHECK_EVERY_MIN * 60_000);
    const rows = await this.prisma.payment.findMany({
      where: {
        provider: 'RAZORPAY',
        providerOrderId: { not: null },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: recheckBefore } }],
        AND: [{ OR: [{ state: 'PENDING' }, { state: 'PROCESSING', orderedAt: { lte: new Date(now - ORDER_REUSE_MIN * 60_000) } }] }],
      },
      take: 50,
    });
    let settled = 0;
    for (const p of rows) {
      try {
        const payments = await this.razorpay.fetchOrderPayments(p.providerOrderId as string);
        const rank = { captured: 4, refunded: 4, authorized: 3, created: 2, failed: 1 } as const;
        const best = [...payments].sort((a, b) => rank[b.status] - rank[a.status])[0];
        // A 'created' payment is a checkout that was opened and abandoned: it says nothing, so it changes nothing
        // (otherwise the booking would wait in PAYMENT_PENDING forever instead of expiring).
        if (best && best.status !== 'created') {
          const before = p.state;
          const after = await this.settle(p.id, best);
          if (after !== before) settled++;
        } else if (!best && p.state === 'PROCESSING' && p.orderedAt && p.orderedAt.getTime() <= now - ABANDON_AFTER_MIN * 60_000) {
          await this.prisma.payment.update({ where: { id: p.id }, data: { state: 'FAILED', failureCode: 'ABANDONED', settledAt: new Date(now) } });
          this.core.updates.publish(p.bookingId);
          settled++;
        }
        await this.prisma.payment.update({ where: { id: p.id }, data: { lastCheckedAt: new Date(now) } });
      } catch (err) {
        this.log.warn(`reconcile failed for payment ${p.id} (${(err as Error).message})`);
      }
    }
    return settled;
  }

  // ---------- internals ----------

  private client(): RazorpayClient {
    if (!this.razorpay) throw new AppError('INTERNAL', {}, 'payments not configured (set the RAZORPAY_* test keys)');
    return this.razorpay;
  }

  private newAttempt(tx: Prisma.TransactionClient, previous: Payment): Promise<Payment> {
    return tx.payment.create({ data: { bookingId: previous.bookingId, kind: previous.kind, amountPaise: previous.amountPaise, state: 'DUE', createdAt: this.core.now() } });
  }

  private startResult(p: Payment): StartResult {
    if (p.method === 'CASH') return { kind: 'cash' };
    if (!p.providerOrderId) throw new AppError('CONFLICT');
    return {
      kind: 'order',
      order: { paymentId: p.id, provider: 'RAZORPAY', orderId: p.providerOrderId, keyId: this.config.RAZORPAY_KEY_ID ?? '', amount: paiseToRupees(p.amountPaise) },
    };
  }
}
