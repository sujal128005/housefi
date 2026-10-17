// Build step 14: the whole product end to end. The happy path goes through the real endpoints only (book, pay, offer,
// accept, trip, arrive, code, quote, approve, work, complete, pay, rate); then every failure path in
// docs/STATE-MACHINE.md, with the timers driven by the test clock. Each journey also checks that every status change
// left an audit_log row. The clock starts on Friday 2026-10-16 12:00 IST.
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { SupportWatchdog } from '../src/modules/support/support-watchdog';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TEST_SECRETS, type TestApp } from './helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;
const CUSTOMER_PHONE = '9876543210';
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const QUOTE = { which: 'MAIN', diagnosis: 'Worn-out washer and a loose joint under the sink.', lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 120 }, { kind: 'MATERIAL', name: 'Washer and sealant', qty: 1, unitPrice: 200 }] };
const EXTRA = { which: 'EXTRA', diagnosis: 'The tap body is cracked.', lines: [{ kind: 'MATERIAL', name: 'New tap', qty: 1, unitPrice: 340 }] };
const TOMORROW_10 = { mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 10, endHour: 12 } };

type Tech = { id: string; phone: string; token: string };

describe('journeys (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let addressId: string;
  const techs: Tech[] = [];

  // ---------- the customer ----------

  async function book(time: object = { mode: 'INSTANT', window: null }): Promise<string> {
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time, preferWomenRated: false };
    return (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
  }

  const booking = async (id: string) => (await api().get(`/v1/bookings/${id}`).set(as(customer)).expect(200)).body;
  const history = async (id: string) => (await booking(id)).history.map((h: { status: string }) => h.status);

  /** Pays online through the Razorpay checkout (fake), then verifies like the app does. */
  async function pay(id: string, kind: 'VISIT' | 'FINAL', status: 'captured' | 'failed' | 'created' = 'captured') {
    const order = (await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind, method: 'UPI' }).expect(200)).body;
    const rp = t.razorpay.pay(order.orderId, status, status === 'failed' ? { error_code: 'BAD_REQUEST_ERROR' } : {});
    const signature = createHmac('sha256', TEST_SECRETS.RAZORPAY_KEY_SECRET).update(`${order.orderId}|${rp.id}`).digest('hex');
    return (await api().post(`/v1/payments/${order.paymentId}/verify`).set(as(customer)).send({ razorpayOrderId: order.orderId, razorpayPaymentId: rp.id, razorpaySignature: signature }).expect(200)).body;
  }

  const answer = (id: string, which: 'MAIN' | 'EXTRA', a: string) => api().post(`/v1/bookings/${id}/quotes/${which}/answer`).set(as(customer)).send({ answer: a });
  const rate = (id: string, stars = 5) => api().post(`/v1/bookings/${id}/rating`).set(as(customer)).send({ satisfied: stars >= 3, stars, tags: ['onTime', 'fixed'], comment: 'Quick and tidy.' });

  // ---------- technicians ----------

  async function onlineTech(phone: string): Promise<Tech> {
    const created = await createTechnician(t, phone);
    const tech = { id: created.id, phone, token: created.token };
    await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    await t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(78.449, 17.4135), 4326)::geography WHERE user_id = ${tech.id}::uuid`;
    techs.push(tech);
    return tech;
  }

  const offerOf = async (tech: Tech) => (await api().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
  const act = (tech: Tech, id: string, action: string, body: object = {}) => api().post(`/v1/tech/jobs/${id}/${action}`).set(as(tech.token)).send(body);

  async function accept(tech: Tech, id: string) {
    const offer = await offerOf(tech);
    expect(offer).toMatchObject({ bookingId: id });
    return api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
  }

  /** The customer reads the start code from their booking and says it to the technician. */
  async function atTheDoor(tech: Tech, id: string) {
    await act(tech, id, 'start-trip').expect(200);
    await act(tech, id, 'arrived').expect(200);
    await act(tech, id, 'verify-start-code', { code: (await booking(id)).arrivalOtp }).expect(200);
  }

  /** Paid and assigned to `tech` through the real offer flow. */
  async function assigned(tech: Tech): Promise<string> {
    const id = await book();
    await pay(id, 'VISIT');
    await t.app.get(DispatchService).offerNext(id);
    await accept(tech, id);
    return id;
  }

  /** Moves the clock and signs everyone in again (access tokens last 15 minutes). */
  async function later(ms: number) {
    t.clock.advance(ms);
    t.rateLimits.clear();
    customer = (await signIn(t, CUSTOMER_PHONE)).accessToken;
    for (const tech of techs) tech.token = (await signIn(t, tech.phone, 'TECHNICIAN')).accessToken;
  }

  /** Every status change of the booking has its audit row, in order, with the actor (README hardening). */
  async function expectAudited(id: string) {
    const events = await t.prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
    const audit = await t.prisma.auditLog.findMany({ where: { entity: 'booking', entityId: id, action: 'booking.status' }, orderBy: { id: 'asc' } });
    const changes = events.slice(1); // the first event is the booking being created
    expect(audit.map((a) => [(a.before as { status: string }).status, (a.after as { status: string }).status, a.actorType])).toEqual(
      changes.map((e, i) => [(events[i] ?? e).status, e.status, e.actorType]),
    );
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
    t.push.reset();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    techs.length = 0;
    customer = (await signIn(t, CUSTOMER_PHONE)).accessToken;
    addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('happy path: book, pay, offer, accept, trip, arrive, code, quote, approve, work, complete, pay, rate', async () => {
    const swathi = await onlineTech('9876500011');
    const id = await book();
    expect((await booking(id)).status).toBe('AWAITING_PAYMENT');
    expect((await pay(id, 'VISIT')).booking).toMatchObject({ status: 'MATCHING', visitPayment: { state: 'PAID', amount: 49 } });

    await t.app.get(DispatchService).offerNext(id);
    expect((await accept(swathi, id)).body).toMatchObject({ id, status: 'ASSIGNED' });
    expect((await booking(id)).technician).toMatchObject({ id: swathi.id, name: { en: 'Swathi Naidu' } });

    await atTheDoor(swathi, id);
    expect((await act(swathi, id, 'quotes', QUOTE).expect(200)).body.status).toBe('QUOTE_SHARED');
    expect((await answer(id, 'MAIN', 'APPROVE').expect(200)).body.status).toBe('IN_PROGRESS');
    await act(swathi, id, 'start-work').expect(200);
    expect((await act(swathi, id, 'complete').expect(200)).body.finalPayment).toMatchObject({ amount: 320, state: 'DUE' });
    expect((await pay(id, 'FINAL')).booking).toMatchObject({ status: 'COMPLETED', finalPayment: { state: 'PAID', amount: 320 } });

    const rated = (await rate(id).expect(200)).body;
    expect(rated.rating).toEqual({ satisfied: true, stars: 5, tags: ['onTime', 'fixed'], comment: 'Quick and tidy.', at: t.clock.now() });
    await rate(id).expect(409); // once

    expect(await history(id)).toEqual(['AWAITING_PAYMENT', 'MATCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'PAYMENT_DUE', 'COMPLETED']);
    const job = (await api().get(`/v1/tech/jobs/${id}`).set(as(swathi.token)).expect(200)).body;
    expect(job).toMatchObject({ status: 'COMPLETED', earning: 326, rating: { stars: 5, comment: 'Quick and tidy.' } });
    expect((await api().get('/v1/tech/me').set(as(swathi.token)).expect(200)).body).toMatchObject({ rating: 5, jobsDone: 1 });
    expect((await api().get('/v1/tech/earnings').set(as(swathi.token)).expect(200)).body).toMatchObject({ today: 326, pendingPayout: 326 });
    expect((await api().get('/v1/notifications').set(as(customer)).expect(200)).body.map((n: { kind: string }) => n.kind)).toEqual([
      'BOOKING_COMPLETED', 'PAYMENT_DUE', 'QUOTE_READY', 'TECH_ARRIVED', 'TECH_ON_THE_WAY', 'TECH_ASSIGNED',
    ]);
    expect(t.razorpay.refunds).toEqual([]);
    await expectAudited(id);
  });

  describe('failure paths (STATE-MACHINE.md)', () => {
    it('AWAITING_PAYMENT: unpaid for 30 minutes is cancelled', async () => {
      const id = await book();
      t.clock.advance(30 * MIN);
      expect(await t.app.get(BookingsService).expireUnpaid()).toBe(1);
      await later(0);
      expect(await booking(id)).toMatchObject({ status: 'CANCELLED', cancelReason: null });
      await expectAudited(id);
    });

    it('PAYMENT_PENDING: a payment the bank fails goes back to AWAITING_PAYMENT; paying again confirms the booking', async () => {
      const id = await book();
      expect((await pay(id, 'VISIT', 'created')).booking.status).toBe('PAYMENT_PENDING');
      const pending = await t.prisma.payment.findFirstOrThrow({ where: { bookingId: id, state: 'PENDING' } });
      const rp = t.razorpay.payments.get(pending.providerPaymentId!)!;
      t.razorpay.payments.set(rp.id, { ...rp, status: 'failed', error_code: 'GATEWAY_ERROR' });
      t.clock.advance(11 * MIN);
      await t.app.get(PaymentsService).reconcile();
      await later(0);
      expect((await booking(id)).status).toBe('AWAITING_PAYMENT');
      expect((await pay(id, 'VISIT')).booking.status).toBe('MATCHING');
      expect(await history(id)).toEqual(['AWAITING_PAYMENT', 'PAYMENT_PENDING', 'AWAITING_PAYMENT', 'MATCHING']);
      await expectAudited(id);
    });

    it('MATCHING: still searching after 10 min, nobody after 30 min, rescheduled, then cancelled with a refund after 24 h unanswered', async () => {
      const id = await book();
      await pay(id, 'VISIT');
      const dispatch = t.app.get(DispatchService);
      t.clock.advance(10 * MIN);
      await dispatch.escalate();
      t.clock.advance(20 * MIN);
      await dispatch.escalate();
      await later(0);
      expect((await booking(id)).status).toBe('UNFULFILLED');

      await api().post(`/v1/bookings/${id}/reschedule`).set(as(customer)).send({ time: TOMORROW_10 }).expect(200);
      expect((await booking(id)).status).toBe('MATCHING');
      t.clock.advance(30 * MIN);
      await dispatch.escalate();
      await dispatch.escalate();
      t.clock.advance(24 * HOUR);
      expect(await t.app.get(PaymentsService).expireUnfulfilled()).toBe(1);
      await t.app.get(PaymentsService).sendPendingRefunds(id);
      await later(0);
      expect(await booking(id)).toMatchObject({ status: 'CANCELLED', cancelReason: null, visitPayment: { state: 'REFUNDED' } });
      expect(t.razorpay.refunds).toEqual([expect.objectContaining({ amount: 4900 })]);
      expect(await history(id)).toEqual(['AWAITING_PAYMENT', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'CANCELLED']);
      expect(await t.prisma.auditLog.count({ where: { action: 'payment.refund' } })).toBe(1);
      await expectAudited(id);
    });

    it('offers: a rejected or expired offer goes to the next technician; 3 misses in a row take a technician offline', async () => {
      const a = await onlineTech('9876500011');
      const b = await onlineTech('9876500022');
      const id = await book();
      await pay(id, 'VISIT');
      const dispatch = t.app.get(DispatchService);
      await dispatch.offerNext(id);
      const first = (await offerOf(a)) ? a : b;
      const second = first === a ? b : a;
      await api().post(`/v1/tech/offers/${(await offerOf(first)).id}/reject`).set(as(first.token)).send({ reason: 'TOO_FAR' }).expect(204);
      expect(await offerOf(second)).toMatchObject({ bookingId: id });
      t.clock.advance(46_000);
      await dispatch.expireOffers();
      await later(0);
      expect(await offerOf(second)).toBeNull();
      expect((await booking(id)).status).toBe('MATCHING'); // nobody left to ask; the search goes on

      // Three more bookings offered to the same technician and left to expire.
      await api().post('/v1/tech/availability').set(as(first.token)).send({ online: false }).expect(200);
      for (let i = 0; i < 3; i++) {
        const next = await book();
        await pay(next, 'VISIT');
        await dispatch.offerNext(next);
        t.clock.advance(46_000);
        await dispatch.expireOffers();
      }
      await later(0);
      expect((await api().get('/v1/tech/me').set(as(second.token)).expect(200)).body.online).toBe(false);
      expect(await t.prisma.auditLog.findFirst({ where: { action: 'tech.set_offline', entityId: second.id } })).toMatchObject({ actorType: 'SYSTEM' });
    });

    it('ASSIGNED: a technician who does not start in time loses the job (told), and it is offered again', async () => {
      const a = await onlineTech('9876500011');
      const id = await assigned(a);
      const b = await onlineTech('9876500022');
      t.clock.advance(11 * MIN);
      expect(await t.app.get(DispatchService).reassignLate()).toBe(1);
      await later(0);
      expect(await offerOf(b)).toMatchObject({ bookingId: id });
      await accept(b, id);
      expect((await booking(id)).technician.id).toBe(b.id);
      expect((await api().get('/v1/notifications').set(as(a.token)).expect(200)).body[0]).toMatchObject({ kind: 'JOB_CANCELLED', params: { reason: 'REASSIGNED' } });
      await api().get(`/v1/tech/jobs/${id}`).set(as(a.token)).expect(404); // no longer theirs
      await expectAudited(id);
    });

    it('cancel: refunded until the trip starts; once the technician is on the way the ₹49 is kept and they earn the visit share', async () => {
      const a = await onlineTech('9876500011');
      const early = await assigned(a);
      await api().post(`/v1/bookings/${early}/cancel`).set(as(customer)).send({ reason: 'PLANS_CHANGED' }).expect(200);
      await t.app.get(PaymentsService).sendPendingRefunds(early);
      expect(await booking(early)).toMatchObject({ status: 'CANCELLED', cancelReason: 'PLANS_CHANGED', visitPayment: { state: 'REFUNDED' } });

      const lateId = await assigned(a);
      await act(a, lateId, 'start-trip').expect(200);
      await api().post(`/v1/bookings/${lateId}/cancel`).set(as(customer)).send({ reason: 'FIXED' }).expect(200);
      expect(await booking(lateId)).toMatchObject({ status: 'CANCELLED', visitPayment: { state: 'PAID' } });
      expect(t.razorpay.refunds).toHaveLength(1);
      expect((await api().get('/v1/tech/earnings').set(as(a.token)).expect(200)).body.total).toBe(30);
      await api().post(`/v1/bookings/${lateId}/cancel`).set(as(customer)).send({}).expect(200); // already cancelled: no change
      await expectAudited(early);
      await expectAudited(lateId);
    });

    it('ARRIVED: 5 wrong start codes lock the visit and open a support ticket; the customer not at the door closes it', async () => {
      const a = await onlineTech('9876500011');
      const id = await assigned(a);
      await act(a, id, 'start-trip').expect(200);
      await act(a, id, 'arrived').expect(200);
      const right = (await booking(id)).arrivalOtp as string;
      const wrong = right === '0000' ? '1111' : '0000';
      for (let i = 0; i < 4; i++) expect((await act(a, id, 'verify-start-code', { code: wrong }).expect(400)).body.error.code).toBe('OTP_INVALID');
      expect((await act(a, id, 'verify-start-code', { code: wrong }).expect(429)).body.error.code).toBe('OTP_LOCKED');
      await act(a, id, 'verify-start-code', { code: right }).expect(429);
      expect(await t.prisma.supportTicket.findFirst({ where: { bookingId: id, kind: 'START_CODE_LOCKED' } })).toMatchObject({ priority: 'HIGH' });
      expect((await act(a, id, 'reports', { issue: 'CUSTOMER_UNAVAILABLE' }).expect(200)).body).toMatchObject({ status: 'CLOSED_NO_REPAIR', closeReason: 'CUSTOMER_UNAVAILABLE', earning: 30 });
      await rate(id, 2).expect(200); // a visit without repair can be rated too
      await expectAudited(id);
    });

    it('QUOTE_SHARED: a revision, then declined: closed without repair, visit fee kept', async () => {
      const a = await onlineTech('9876500011');
      const id = await assigned(a);
      await atTheDoor(a, id);
      await act(a, id, 'quotes', QUOTE).expect(200);
      await answer(id, 'MAIN', 'REVISION').expect(200);
      await act(a, id, 'quotes', { ...QUOTE, lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 150 }] }).expect(200);
      expect((await booking(id)).quote).toMatchObject({ version: 2, total: 150 });
      expect((await answer(id, 'MAIN', 'DECLINE').expect(200)).body).toMatchObject({ status: 'CLOSED_NO_REPAIR', closeReason: 'CUSTOMER_DECLINED', visitPayment: { state: 'PAID' } });
      expect(await history(id)).toEqual(['AWAITING_PAYMENT', 'MATCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'QUOTE_SHARED', 'CLOSED_NO_REPAIR']);
      await expectAudited(id);
    });

    it('INSPECTING and IN_PROGRESS: "cannot complete" closes the visit', async () => {
      const a = await onlineTech('9876500011');
      const inspecting = await assigned(a);
      await atTheDoor(a, inspecting);
      expect((await act(a, inspecting, 'reports', { issue: 'CANNOT_COMPLETE', note: 'Needs a spare part' }).expect(200)).body).toMatchObject({ status: 'CLOSED_NO_REPAIR', closeReason: 'CANNOT_COMPLETE' });

      const repairing = await assigned(a);
      await atTheDoor(a, repairing);
      await act(a, repairing, 'quotes', QUOTE).expect(200);
      await answer(repairing, 'MAIN', 'APPROVE').expect(200);
      await act(a, repairing, 'start-work').expect(200);
      expect((await act(a, repairing, 'reports', { issue: 'CANNOT_COMPLETE' }).expect(200)).body.status).toBe('CLOSED_NO_REPAIR');
      await expectAudited(inspecting);
      await expectAudited(repairing);
    });

    it('EXTRA_WORK declined: the repair goes on and the bill leaves the extra out', async () => {
      const a = await onlineTech('9876500011');
      const id = await assigned(a);
      await atTheDoor(a, id);
      await act(a, id, 'quotes', QUOTE).expect(200);
      await answer(id, 'MAIN', 'APPROVE').expect(200);
      await act(a, id, 'start-work').expect(200);
      expect((await act(a, id, 'quotes', EXTRA).expect(200)).body.status).toBe('EXTRA_WORK');
      expect((await answer(id, 'EXTRA', 'DECLINE').expect(200)).body.status).toBe('IN_PROGRESS');
      expect((await act(a, id, 'complete').expect(200)).body.finalPayment.amount).toBe(320);
      await expectAudited(id);
    });

    it('PAYMENT_DUE: a failed payment can be retried; a bill unpaid for 24 h opens one support ticket', async () => {
      const a = await onlineTech('9876500011');
      const id = await assigned(a);
      await atTheDoor(a, id);
      await act(a, id, 'quotes', QUOTE).expect(200);
      await answer(id, 'MAIN', 'APPROVE').expect(200);
      await act(a, id, 'start-work').expect(200);
      await act(a, id, 'complete').expect(200);
      expect((await pay(id, 'FINAL', 'failed')).booking).toMatchObject({ status: 'PAYMENT_DUE', finalPayment: { state: 'FAILED' } });

      const watchdog = t.app.get(SupportWatchdog);
      t.clock.advance(23 * HOUR);
      expect(await watchdog.sweep()).toEqual({ tripsOverdue: 0, billsUnpaid: 0 });
      t.clock.advance(HOUR);
      expect(await watchdog.sweep()).toEqual({ tripsOverdue: 0, billsUnpaid: 1 });
      expect(await watchdog.sweep()).toEqual({ tripsOverdue: 0, billsUnpaid: 0 }); // once
      expect(await t.prisma.supportTicket.findFirst({ where: { bookingId: id, kind: 'BILL_UNPAID' } })).toMatchObject({ priority: 'HIGH' });

      await later(0);
      expect((await pay(id, 'FINAL')).booking.status).toBe('COMPLETED');
      await expectAudited(id);
    });

    it('EN_ROUTE: a trip 30 minutes past its ETA alerts support once', async () => {
      const a = await onlineTech('9876500011');
      const id = await assigned(a);
      await act(a, id, 'start-trip').expect(200);
      const eta = (await booking(id)).etaMin as number;
      const watchdog = t.app.get(SupportWatchdog);
      t.clock.advance((eta + 29) * MIN);
      expect((await watchdog.sweep()).tripsOverdue).toBe(0);
      t.clock.advance(2 * MIN);
      expect((await watchdog.sweep()).tripsOverdue).toBe(1);
      expect((await watchdog.sweep()).tripsOverdue).toBe(0);
      expect(await t.prisma.supportTicket.findFirst({ where: { bookingId: id, kind: 'TRIP_OVERDUE' } })).toMatchObject({ priority: 'HIGH' });
    });

    it('anything not in the table is CONFLICT', async () => {
      const a = await onlineTech('9876500011');
      const id = await assigned(a);
      for (const action of ['arrived', 'start-work', 'complete', 'confirm-cash']) await act(a, id, action).expect(409);
      await act(a, id, 'verify-start-code', { code: '1234' }).expect(409);
      await act(a, id, 'quotes', QUOTE).expect(409);
      await answer(id, 'MAIN', 'APPROVE').expect(409);
      await rate(id).expect(409);
      await act(a, id, 'start-trip').expect(200);
      await act(a, id, 'start-trip').expect(409);
      await api().post(`/v1/bookings/${id}/reschedule`).set(as(customer)).send({ time: TOMORROW_10 }).expect(409);
      await act(a, id, 'arrived').expect(200);
      await api().post(`/v1/bookings/${id}/cancel`).set(as(customer)).send({}).expect(409); // at the door: no cancelling in the app
      await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'UPI' }).expect(409);
      expect((await booking(id)).status).toBe('ARRIVED');
      await expectAudited(id);
    });
  });
});
