// Payments end to end against a fake Razorpay. The test clock starts at 2026-10-16 12:00 IST.
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { PaymentsService } from '../src/modules/payments/payments.service';
import type { RzpPayment } from '../src/modules/payments/razorpay.client';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TEST_SECRETS, type TestApp } from './helpers';

const MIN = 60_000;
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034' };

const checkoutSignature = (orderId: string, paymentId: string) =>
  createHmac('sha256', TEST_SECRETS.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

describe('payments (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  let token: string;
  let addressId: string;
  const auth = (r: request.Test, as = token) => r.set('Authorization', `Bearer ${as}`);
  const payments = () => t.app.get(PaymentsService);

  async function newBooking(): Promise<string> {
    const body = {
      serviceId: 'plumb-tap',
      problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] },
      addressId,
      time: { mode: 'INSTANT', window: null },
      preferWomenRated: false,
    };
    return (await auth(api().post('/v1/bookings')).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
  }

  const start = (bookingId: string, kind = 'VISIT', method = 'UPI', key: string = randomUUID(), as = token) =>
    auth(api().post(`/v1/bookings/${bookingId}/payments`), as).set('Idempotency-Key', key).send({ kind, method });

  const verify = (paymentId: string, orderId: string, rp: RzpPayment, signature = checkoutSignature(orderId, rp.id)) =>
    auth(api().post(`/v1/payments/${paymentId}/verify`)).send({ razorpayOrderId: orderId, razorpayPaymentId: rp.id, razorpaySignature: signature });

  function webhook(event: string, entity: object, eventId: string = randomUUID(), secret = TEST_SECRETS.RAZORPAY_WEBHOOK_SECRET) {
    const kind = event.startsWith('refund.') ? 'refund' : 'payment';
    const raw = JSON.stringify({ entity: 'event', event, payload: { [kind]: { entity } }, created_at: 1792150000 });
    return api()
      .post('/v1/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-event-id', eventId)
      .set('x-razorpay-signature', createHmac('sha256', secret).update(raw).digest('hex'))
      .send(raw);
  }

  const booking = async (id: string) => (await auth(api().get(`/v1/bookings/${id}`)).expect(200)).body;

  /** Moves the test clock and signs in again (access tokens last 15 minutes). */
  async function later(ms: number) {
    t.clock.advance(ms);
    token = (await signIn(t)).accessToken;
  }

  /** Pays the visit fee end to end; returns the ids involved. */
  async function payVisit(bookingId: string) {
    const order = (await start(bookingId).expect(200)).body;
    const rp = t.razorpay.pay(order.orderId);
    await verify(order.paymentId, order.orderId, rp).expect(200);
    return { order, rp };
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
    t.razorpay.reset();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    token = (await signIn(t)).accessToken;
    addressId = (await auth(api().post('/v1/addresses')).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('starting a payment', () => {
    it('returns a Razorpay order for the ₹49 visit fee', async () => {
      const id = await newBooking();
      const res = await start(id).expect(200);
      expect(res.body).toEqual({ paymentId: expect.any(String), provider: 'RAZORPAY', orderId: 'order_1', keyId: 'rzp_test_housefi', amount: 49 });
      expect(t.razorpay.orders.get('order_1')).toMatchObject({ amount: 4900, currency: 'INR', notes: { bookingId: id, kind: 'VISIT' } });
      expect((await booking(id)).visitPayment).toMatchObject({ state: 'PROCESSING', method: 'UPI' });
    });

    it('is idempotent and reuses a fresh order when the sheet is reopened', async () => {
      const id = await newBooking();
      const a = (await start(id, 'VISIT', 'UPI', 'pay-key-0001').expect(200)).body;
      const b = (await start(id, 'VISIT', 'UPI', 'pay-key-0001').expect(200)).body;
      const c = (await start(id, 'VISIT', 'CARD').expect(200)).body;
      expect(b).toEqual(a);
      expect(c.orderId).toBe(a.orderId);
      expect(t.razorpay.orders.size).toBe(1);
    });

    it('takes the visit fee online only and needs an Idempotency-Key', async () => {
      const id = await newBooking();
      expect((await start(id, 'VISIT', 'CASH').expect(422)).body.error.fields).toEqual({ method: 'INVALID' });
      const missing = await auth(api().post(`/v1/bookings/${id}/payments`)).send({ kind: 'VISIT', method: 'UPI' }).expect(422);
      expect(missing.body.error.fields).toEqual({ 'Idempotency-Key': 'REQUIRED' });
    });

    it("refuses the wrong state and other people's bookings", async () => {
      const id = await newBooking();
      await start(id, 'FINAL').expect(409);
      const ravi = (await signIn(t, '9876500022')).accessToken;
      await start(id, 'VISIT', 'UPI', randomUUID(), ravi).expect(404);
      await payVisit(id);
      expect((await start(id).expect(409)).body.error.code).toBe('CONFLICT');
    });

    it('answers INTERNAL when Razorpay is down, leaving nothing half-done', async () => {
      const id = await newBooking();
      t.razorpay.failOrders = true;
      expect((await start(id).expect(500)).body.error.code).toBe('INTERNAL');
      expect((await booking(id)).visitPayment).toMatchObject({ state: 'DUE', method: null });
      t.razorpay.failOrders = false;
      await start(id).expect(200);
    });
  });

  describe('verifying after the checkout sheet', () => {
    it('confirms the booking when Razorpay says captured', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId);
      const res = await verify(order.paymentId, order.orderId, rp).expect(200);
      expect(res.body.state).toBe('PAID');
      expect(res.body.booking).toMatchObject({
        status: 'MATCHING',
        arrivalOtp: expect.stringMatching(/^\d{4}$/),
        visitPayment: { kind: 'VISIT', amount: 49, state: 'PAID', method: 'UPI', txnId: rp.id, at: t.clock.now() },
      });
      expect(res.body.booking.history.map((h: { status: string }) => h.status)).toEqual(['AWAITING_PAYMENT', 'MATCHING']);
      // A repeat verify changes nothing.
      const again = await verify(order.paymentId, order.orderId, rp).expect(200);
      expect(again.body.booking.history).toHaveLength(2);
    });

    it('captures an authorized payment', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId, 'authorized');
      expect((await verify(order.paymentId, order.orderId, rp).expect(200)).body.state).toBe('PAID');
      expect(t.razorpay.captures).toEqual([rp.id]);
    });

    it('rejects a forged signature or another order, changing nothing (402)', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId);
      expect((await verify(order.paymentId, order.orderId, rp, 'ab'.repeat(32)).expect(402)).body.error.code).toBe('PAYMENT_FAILED');
      await verify(order.paymentId, 'order_999', rp, checkoutSignature('order_999', rp.id)).expect(402);
      expect((await booking(id)).status).toBe('AWAITING_PAYMENT');
    });

    it('trusts Razorpay, not the app: a captured amount that does not match is held, not paid', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId, 'captured', { amount: 100 });
      expect((await verify(order.paymentId, order.orderId, rp).expect(200)).body.state).toBe('PENDING');
    });

    it('lets the customer retry after a failed payment', async () => {
      const id = await newBooking();
      const first = (await start(id).expect(200)).body;
      const failed = t.razorpay.pay(first.orderId, 'failed', { error_code: 'BAD_REQUEST_ERROR' });
      const res = await verify(first.paymentId, first.orderId, failed).expect(200);
      expect(res.body).toMatchObject({ state: 'FAILED', booking: { status: 'AWAITING_PAYMENT', visitPayment: { state: 'FAILED' } } });
      const second = (await start(id).expect(200)).body;
      expect(second.orderId).not.toBe(first.orderId);
      const ok = t.razorpay.pay(second.orderId);
      expect((await verify(second.paymentId, second.orderId, ok).expect(200)).body.booking.status).toBe('MATCHING');
    });
  });

  describe('webhooks', () => {
    it('confirms a payment the bank was still confirming (PENDING -> PAID)', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId, 'created');
      const res = await verify(order.paymentId, order.orderId, rp).expect(200);
      expect(res.body).toMatchObject({ state: 'PENDING', booking: { status: 'PAYMENT_PENDING', visitPayment: { state: 'PENDING' } } });
      await webhook('payment.captured', { ...rp, status: 'captured' }).expect(200, { status: 'ok' });
      expect(await booking(id)).toMatchObject({ status: 'MATCHING', visitPayment: { state: 'PAID' } });
    });

    it('sends a pending payment back to "pay again" when it fails', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId, 'created');
      await verify(order.paymentId, order.orderId, rp).expect(200);
      await webhook('payment.failed', { ...rp, status: 'failed', error_code: 'GATEWAY_ERROR' }).expect(200);
      expect(await booking(id)).toMatchObject({ status: 'AWAITING_PAYMENT', visitPayment: { state: 'FAILED' } });
    });

    it('ignores the failure of another attempt while a payment that went through is pending', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const first = t.razorpay.pay(order.orderId, 'created');
      await verify(order.paymentId, order.orderId, first).expect(200);
      const second = t.razorpay.pay(order.orderId, 'failed');
      await webhook('payment.failed', { ...second, error_code: 'BAD_REQUEST_ERROR' }).expect(200);
      expect(await booking(id)).toMatchObject({ status: 'PAYMENT_PENDING', visitPayment: { state: 'PENDING' } });
      await webhook('payment.captured', { ...first, status: 'captured' }).expect(200);
      expect(await booking(id)).toMatchObject({ status: 'MATCHING', visitPayment: { state: 'PAID' } });
    });

    it('does not count a payment Razorpay refunded on its own (never captured) as paid', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId, 'created');
      await verify(order.paymentId, order.orderId, rp).expect(200);
      t.razorpay.payments.set(rp.id, { ...rp, status: 'refunded' });
      await later(11 * 60_000);
      await payments().reconcile();
      expect(await booking(id)).toMatchObject({ status: 'AWAITING_PAYMENT', visitPayment: { state: 'FAILED' } });
    });

    it('confirms a payment even if the app never called verify', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId);
      await webhook('payment.captured', rp).expect(200);
      expect((await booking(id)).status).toBe('MATCHING');
    });

    it('processes each event once', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId);
      await webhook('payment.captured', rp, 'evt_same').expect(200);
      await webhook('payment.captured', rp, 'evt_same').expect(200);
      expect(await t.prisma.paymentWebhookEvent.count()).toBe(1);
      expect((await booking(id)).history).toHaveLength(2);
    });

    it('rejects a bad signature and ignores unknown orders', async () => {
      await webhook('payment.captured', { id: 'pay_x', order_id: 'order_x' }, randomUUID(), 'wrong-secret').expect(401);
      await webhook('payment.captured', { id: 'pay_x', order_id: 'order_x', amount: 4900, currency: 'INR', status: 'captured' }).expect(200);
    });

    it("stores no payer details (Razorpay sends the customer's email and phone)", async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId);
      await webhook('payment.captured', { ...rp, email: 'priya@example.com', contact: '+919876543210', vpa: 'priya@okbank' }).expect(200);
      const stored = JSON.stringify((await t.prisma.paymentWebhookEvent.findFirstOrThrow()).payload);
      for (const leak of ['priya@example.com', '9876543210', 'okbank']) expect(stored).not.toContain(leak);
      expect(stored).toContain(rp.id);
    });
  });

  describe('refunds', () => {
    it('refunds the visit fee through Razorpay when cancelled before the trip', async () => {
      const id = await newBooking();
      const { rp } = await payVisit(id);
      const res = await auth(api().post(`/v1/bookings/${id}/cancel`)).send({ reason: 'PLANS_CHANGED' }).expect(200);
      expect(res.body.visitPayment.state).toBe('REFUNDED');
      await payments().sendPendingRefunds(); // in case the background send has not finished yet
      expect(t.razorpay.refunds).toEqual([{ id: expect.stringMatching(/^rfnd_/), paymentId: rp.id, amount: 4900 }]);
      const row = await t.prisma.payment.findFirstOrThrow({ where: { bookingId: id, state: 'REFUNDED' } });
      expect(row.providerRefundId).toBe(t.razorpay.refunds[0]!.id);
      await webhook('refund.processed', { id: row.providerRefundId, payment_id: rp.id, amount: 4900, status: 'processed' }).expect(200);
      expect((await t.prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).refundProcessedAt).not.toBeNull();
    });

    it('retries a refund Razorpay refused, and never sends one twice', async () => {
      const id = await newBooking();
      await payVisit(id);
      t.razorpay.failRefunds = true;
      await auth(api().post(`/v1/bookings/${id}/cancel`)).send({}).expect(200);
      expect(await payments().sendPendingRefunds()).toBe(0);
      t.razorpay.failRefunds = false;
      const [a, b] = await Promise.all([payments().sendPendingRefunds(), payments().sendPendingRefunds()]);
      expect(a + b).toBe(1);
      expect(await payments().sendPendingRefunds()).toBe(0);
      expect(t.razorpay.refunds).toHaveLength(1);
    });

    it('refunds a payment that arrives after the booking expired', async () => {
      const id = await newBooking();
      await later(20 * MIN);
      const order = (await start(id).expect(200)).body;
      t.clock.advance(11 * MIN); // 31 minutes old, but the customer opened the sheet 11 minutes ago
      expect(await t.app.get(BookingsService).expireUnpaid()).toBe(0);
      t.clock.advance(5 * MIN); // the payment attempt is now 16 minutes old
      expect(await t.app.get(BookingsService).expireUnpaid()).toBe(1);
      await webhook('payment.captured', t.razorpay.pay(order.orderId)).expect(200);
      await payments().sendPendingRefunds();
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id }, include: { payments: true } });
      expect(row.status).toBe('CANCELLED');
      expect(row.payments.find((p) => p.providerOrderId === order.orderId)).toMatchObject({ state: 'REFUNDED', providerRefundId: expect.stringMatching(/^rfnd_/) });
    });

    it('refunds a second payment for the same visit fee', async () => {
      const id = await newBooking();
      const first = (await start(id).expect(200)).body;
      await later(16 * MIN); // the first order is stale, so a new one is made
      const second = (await start(id).expect(200)).body;
      expect(second.orderId).not.toBe(first.orderId);
      await webhook('payment.captured', t.razorpay.pay(second.orderId)).expect(200);
      await webhook('payment.captured', t.razorpay.pay(first.orderId)).expect(200);
      await payments().sendPendingRefunds();
      expect((await booking(id)).status).toBe('MATCHING');
      expect(t.razorpay.refunds).toHaveLength(1);
    });
  });

  describe('reconciliation', () => {
    it('settles a payment whose verify and webhook never arrived', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      t.razorpay.pay(order.orderId);
      t.clock.advance(10 * MIN);
      expect(await payments().reconcile()).toBe(0); // the order is still fresh: the customer may be paying
      t.clock.advance(6 * MIN);
      expect(await payments().reconcile()).toBe(1);
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('MATCHING');
    });

    it('polls a pending payment every 10 minutes until the bank answers', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId, 'created');
      await verify(order.paymentId, order.orderId, rp).expect(200);
      t.razorpay.payments.set(rp.id, { ...rp, status: 'captured' });
      t.clock.advance(5 * MIN);
      expect(await payments().reconcile()).toBe(0);
      t.clock.advance(6 * MIN);
      expect(await payments().reconcile()).toBe(1);
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('MATCHING');
    });

    it('leaves an abandoned checkout alone so the booking can expire', async () => {
      const id = await newBooking();
      const order = (await start(id).expect(200)).body;
      t.razorpay.pay(order.orderId, 'created');
      t.clock.advance(20 * MIN);
      await payments().reconcile();
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('AWAITING_PAYMENT');
      t.clock.advance(15 * MIN);
      expect(await t.app.get(BookingsService).expireUnpaid()).toBe(1);
    });
  });

  describe('the final bill', () => {
    let techId: string;

    beforeEach(async () => {
      techId = (await createTechnician(t, '9876500055')).id;
    });

    async function billDue(amountPaise = 32000n): Promise<string> {
      const id = await newBooking();
      await payVisit(id);
      await t.prisma.booking.update({ where: { id }, data: { status: 'PAYMENT_DUE', technicianId: techId } });
      await t.prisma.payment.create({ data: { bookingId: id, kind: 'FINAL', amountPaise, state: 'DUE' } });
      return id;
    }

    it('pays online and completes the booking', async () => {
      const id = await billDue();
      const order = (await start(id, 'FINAL', 'CARD').expect(200)).body;
      expect(order.amount).toBe(320);
      const rp = t.razorpay.pay(order.orderId, 'captured', { method: 'card' });
      const res = await verify(order.paymentId, order.orderId, rp).expect(200);
      expect(res.body.booking).toMatchObject({ status: 'COMPLETED', finalPayment: { kind: 'FINAL', amount: 320, state: 'PAID', method: 'CARD' } });
    });

    it('takes cash: waits for the technician, who confirms it', async () => {
      const id = await billDue();
      const res = await start(id, 'FINAL', 'CASH').expect(200);
      expect(res.body).toMatchObject({ id, status: 'PAYMENT_DUE', finalPayment: { state: 'PENDING', method: 'CASH' } });
      await expect(payments().confirmCash(randomUUID(), id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await payments().confirmCash(techId, id);
      expect(await booking(id)).toMatchObject({ status: 'COMPLETED', finalPayment: { state: 'PAID', method: 'CASH' } });
      await expect(payments().confirmCash(techId, id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('lets the customer switch from cash to paying online', async () => {
      const id = await billDue();
      await start(id, 'FINAL', 'CASH').expect(200);
      const order = (await start(id, 'FINAL', 'UPI').expect(200)).body;
      await verify(order.paymentId, order.orderId, t.razorpay.pay(order.orderId)).expect(200);
      expect((await booking(id)).status).toBe('COMPLETED');
    });
  });
});
