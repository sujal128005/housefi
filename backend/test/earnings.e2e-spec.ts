// Earnings end to end: what each way of closing a job writes to the ledger, GET /tech/earnings, and the weekly payout.
// The test clock starts on Friday 2026-10-16 12:00 IST; the next payout day is Monday 2026-10-19.
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { runPayoutsCommand, USAGE } from '../src/cli/payouts';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { EarningsService, type PayoutActor } from '../src/modules/earnings/earnings.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TEST_SECRETS, type TestApp } from './helpers';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const TECH_PHONE = '9876500011';
const ADMIN: PayoutActor = { type: 'ADMIN', id: null, via: 'cli:test' };
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
// ₹120 labour + ₹200 materials: the technician earns 30 + 96 + 200 = ₹326 (examples/earnings.json).
const QUOTE = { which: 'MAIN', diagnosis: 'Worn-out washer and a loose joint under the sink.', lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 120 }, { kind: 'MATERIAL', name: 'Washer and sealant', qty: 1, unitPrice: 200 }] };

describe('earnings (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const earnings = () => t.app.get(EarningsService);
  let customer: string;
  let tech: { id: string; token: string };
  let id: string;
  let code: string;

  const act = (action: string, body: object = {}) => api().post(`/v1/tech/jobs/${id}/${action}`).set(as(tech.token)).send(body);
  const answer = (a: string) => api().post(`/v1/bookings/${id}/quotes/MAIN/answer`).set(as(customer)).send({ answer: a });
  const summary = async () => (await api().get('/v1/tech/earnings').set(as(tech.token)).expect(200)).body;
  const ledger = () => t.prisma.earningsLedger.findMany({ where: { technicianId: tech.id }, orderBy: { id: 'asc' } });
  const ledgerTypes = async () => (await ledger()).map((l) => [l.type, Number(l.amountPaise)]);

  /** Moves the test clock and signs both people in again (access tokens last 15 minutes). */
  async function later(ms: number) {
    t.clock.advance(ms);
    customer = (await signIn(t, '9876543210')).accessToken;
    tech = { ...tech, token: (await signIn(t, TECH_PHONE, 'TECHNICIAN')).accessToken };
  }

  /** Booking paid, offered and accepted: the technician is assigned. */
  async function assignedJob() {
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    const created = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body;
    id = created.id;
    code = created.code;
    await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    await t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(78.449, 17.4135), 4326)::geography WHERE user_id = ${tech.id}::uuid`;
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
    await t.app.get(DispatchService).offerNext(id);
    const offer = (await api().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
    await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
  }

  async function atTheDoor() {
    await act('start-trip').expect(200);
    await act('arrived').expect(200);
    const startCode = await t.app.get(FieldCipher).decrypt('bookings.arrival_code', (await t.prisma.booking.findUniqueOrThrow({ where: { id } })).arrivalCodeEnc);
    await act('verify-start-code', { code: startCode }).expect(200);
  }

  /** Quote approved, repair done, bill due. */
  async function billDue() {
    await atTheDoor();
    await act('quotes', QUOTE).expect(200);
    await answer('APPROVE').expect(200);
    await act('start-work').expect(200);
    await act('complete').expect(200);
  }

  async function paidInCash() {
    await billDue();
    await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'CASH' }).expect(200);
    await act('confirm-cash').expect(200);
  }

  async function paidOnline() {
    await billDue();
    const order = (await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'UPI' }).expect(200)).body;
    const rp = t.razorpay.pay(order.orderId);
    const signature = createHmac('sha256', TEST_SECRETS.RAZORPAY_KEY_SECRET).update(`${order.orderId}|${rp.id}`).digest('hex');
    await api().post(`/v1/payments/${order.paymentId}/verify`).set(as(customer)).send({ razorpayOrderId: order.orderId, razorpayPaymentId: rp.id, razorpaySignature: signature }).expect(200);
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
    tech = await createTechnician(t, TECH_PHONE);
    await assignedJob();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('Fair-pay meter', () => {
    const seen = async () => ({
      customer: (await api().get(`/v1/bookings/${id}`).set(as(customer)).expect(200)).body.fairPay,
      tech: (await api().get(`/v1/tech/jobs/${id}`).set(as(tech.token)).expect(200)).body.fairPay,
    });

    it('shows customer and technician the same split, and the technician part is what the ledger records', async () => {
      // Visit fee only: ₹30 to the technician, ₹19 to Housefi.
      expect(await seen()).toEqual({
        customer: { total: 49, technician: 30, parts: 0, housefi: 19, coupon: 0, labourSharePercent: 80, withBill: false },
        tech: { total: 49, technician: 30, parts: 0, housefi: 19, coupon: 0, labourSharePercent: 80, withBill: false },
      });
      // Bill due (₹120 labour + ₹200 parts): technician ₹30 + ₹96, parts ₹200, Housefi ₹19 + ₹24.
      await billDue();
      const due = { total: 369, technician: 126, parts: 200, housefi: 43, coupon: 0, labourSharePercent: 80, withBill: true };
      expect(await seen()).toEqual({ customer: due, tech: due });
      await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'CASH' }).expect(200);
      await act('confirm-cash').expect(200);
      expect((await seen()).customer).toEqual(due);
      const credited = (await ledger()).filter((l) => l.type !== 'CASH_COLLECTED').reduce((sum, l) => sum + Number(l.amountPaise), 0) / 100;
      expect(credited).toBe(due.technician + due.parts);
    });
  });

  describe('what a closed job writes to the ledger', () => {
    it('paid in cash: the credits, and the cash the technician kept as a debit', async () => {
      await paidInCash();
      expect(await ledgerTypes()).toEqual([['VISIT_SHARE', 3000], ['LABOUR_SHARE', 9600], ['MATERIAL_REIMBURSE', 20000], ['CASH_COLLECTED', -32000]]);
      expect(await summary()).toEqual({
        today: 326,
        jobsToday: 1,
        total: 326,
        pendingPayout: 6,
        nextPayoutOn: '2026-10-19',
        entries: [{ jobId: id, code, serviceId: 'plumb-tap', amount: 326, at: t.clock.now(), payout: 'PENDING' }],
        weeks: expect.any(Array),
      });
      // This week (Mon 12 – Sun 18 Oct): earned, the cash kept, and paid next Monday.
      expect((await summary()).weeks[0]).toEqual({
        start: '2026-10-12', end: '2026-10-18', earned: 326, cash: 320, jobs: 1, payout: { state: 'UPCOMING', on: '2026-10-19', amount: null, ref: null },
      });
      expect((await api().get(`/v1/tech/jobs/${id}`).set(as(tech.token)).expect(200)).body.earning).toBe(326);
      expect((await api().get('/v1/tech/me').set(as(tech.token)).expect(200)).body.jobsDone).toBe(1);
    });

    it('paid online: credits only, all of it waiting for the payout', async () => {
      await paidOnline();
      expect(await ledgerTypes()).toEqual([['VISIT_SHARE', 3000], ['LABOUR_SHARE', 9600], ['MATERIAL_REIMBURSE', 20000]]);
      expect(await summary()).toMatchObject({ today: 326, total: 326, pendingPayout: 326 });
    });

    it('declined quote: the visit share, and the job does not count as done', async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      await answer('DECLINE').expect(200);
      expect(await ledgerTypes()).toEqual([['VISIT_SHARE', 3000]]);
      expect(await summary()).toMatchObject({ today: 30, jobsToday: 1, total: 30, pendingPayout: 30, entries: [{ jobId: id, amount: 30 }] });
      expect((await api().get('/v1/tech/me').set(as(tech.token)).expect(200)).body.jobsDone).toBe(0);
    });

    it('customer not at the door: the visit share', async () => {
      await act('start-trip').expect(200);
      await act('arrived').expect(200);
      await act('reports', { issue: 'CUSTOMER_UNAVAILABLE' }).expect(200);
      expect(await ledgerTypes()).toEqual([['VISIT_SHARE', 3000]]);
    });

    it('cancelled by the customer while the technician travels: the visit share', async () => {
      await act('start-trip').expect(200);
      await api().post(`/v1/bookings/${id}/cancel`).set(as(customer)).send({ reason: 'PLANS_CHANGED' }).expect(200);
      expect(await ledgerTypes()).toEqual([['VISIT_SHARE', 3000]]);
      expect((await api().get(`/v1/tech/jobs/${id}`).set(as(tech.token)).expect(200)).body.earning).toBe(30);
    });

    it('cancelled before the trip: nothing', async () => {
      await api().post(`/v1/bookings/${id}/cancel`).set(as(customer)).send({}).expect(200);
      expect(await ledger()).toEqual([]);
      expect(await summary()).toEqual({ today: 0, jobsToday: 0, total: 0, pendingPayout: 0, nextPayoutOn: '2026-10-19', entries: [], weeks: expect.any(Array) });
    });
  });

  describe('the ledger is append-only', () => {
    it('refuses changes to amounts, deletions and a second credit of the same kind for a job', async () => {
      await paidOnline();
      const [visit] = await ledger();
      await expect(t.prisma.$executeRaw`UPDATE earnings_ledger SET amount_paise = 1 WHERE id = ${visit!.id}`).rejects.toThrow(/append-only/);
      await expect(t.prisma.$executeRaw`DELETE FROM earnings_ledger WHERE id = ${visit!.id}`).rejects.toThrow(/append-only/);
      await expect(
        t.prisma.earningsLedger.create({ data: { technicianId: tech.id, bookingId: id, type: 'VISIT_SHARE', amountPaise: 3000n, createdAt: new Date(t.clock.now()) } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        t.prisma.earningsLedger.create({ data: { technicianId: tech.id, bookingId: id, type: 'CASH_COLLECTED', amountPaise: 100n, createdAt: new Date(t.clock.now()) } }),
      ).rejects.toThrow(/earnings_sign_by_type/);
      expect(await ledger()).toHaveLength(3);
    });
  });

  describe('GET /v1/tech/earnings', () => {
    it("today counts only today's jobs (IST); the total keeps everything", async () => {
      await paidOnline();
      await later(DAY);
      expect(await summary()).toMatchObject({ today: 0, jobsToday: 0, total: 326, pendingPayout: 326, nextPayoutOn: '2026-10-19' });
    });

    it('is for technicians only', async () => {
      await api().get('/v1/tech/earnings').set(as(customer)).expect(404);
      await api().get('/v1/tech/earnings').expect(401);
    });
  });

  describe('weekly payouts', () => {
    const MONDAY_9AM = Date.UTC(2026, 9, 19, 3, 30); // 2026-10-19 09:00 IST

    it("pays Monday the week up to Sunday, once, and marks the jobs paid", async () => {
      await paidOnline();
      expect(await earnings().prepare(ADMIN)).toEqual([]); // this week's job waits for next Monday
      await later(MONDAY_9AM - t.clock.now());

      const [payout, ...more] = await earnings().prepare(ADMIN);
      expect(more).toEqual([]);
      expect(payout).toEqual({
        id: expect.any(String),
        technicianId: tech.id,
        technicianName: 'Swathi Naidu',
        periodStart: '2026-10-16',
        periodEnd: '2026-10-18',
        amount: 326,
        state: 'PENDING',
        providerRef: null,
      });
      expect(await earnings().prepare(ADMIN)).toEqual([]);
      expect(await summary()).toMatchObject({ pendingPayout: 326, nextPayoutOn: '2026-10-19', entries: [{ payout: 'PENDING' }] });
      expect((await summary()).weeks[1]).toMatchObject({ start: '2026-10-12', earned: 326, payout: { state: 'PENDING', on: '2026-10-19', amount: 326, ref: null } });

      expect(await earnings().markPaid(payout!.id, 'UTR 4521 0098 7766', ADMIN)).toMatchObject({ state: 'PAID', providerRef: 'UTR 4521 0098 7766' });
      expect((await ledgerTypes()).at(-1)).toEqual(['PAYOUT', -32600]);
      expect(await summary()).toMatchObject({ total: 326, pendingPayout: 0, entries: [{ jobId: id, payout: 'PAID' }] });
      expect((await summary()).weeks[1]?.payout).toEqual({ state: 'PAID', on: '2026-10-19', amount: 326, ref: 'UTR 4521 0098 7766' });
      await expect(earnings().markPaid(payout!.id, 'again', ADMIN)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(earnings().markPaid(randomUUID(), 'x', ADMIN)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const audit = await t.prisma.auditLog.findMany({ where: { entity: 'payout' }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['payout.prepare', 'payout.paid']);
      expect(audit[1]).toMatchObject({ actorType: 'ADMIN', entityId: payout!.id, after: { state: 'PAID', via: 'cli:test' } });
    });

    it('nets the cash collected, and carries a negative balance to next week', async () => {
      await paidInCash(); // ₹326 earned, ₹320 kept in cash
      await t.prisma.earningsLedger.create({ data: { technicianId: tech.id, type: 'ADJUSTMENT', amountPaise: -1000n, createdAt: new Date(t.clock.now()) } });
      await later(MONDAY_9AM - t.clock.now());
      expect(await earnings().prepare(ADMIN)).toEqual([]);
      expect(await summary()).toMatchObject({ total: 316, pendingPayout: -4 });
    });

    it('a failed transfer goes back into the next run', async () => {
      await paidInCash();
      await later(MONDAY_9AM - t.clock.now());
      const [first] = await earnings().prepare(ADMIN);
      expect(first).toMatchObject({ amount: 6 });
      expect(await earnings().markFailed(first!.id, ADMIN)).toMatchObject({ state: 'FAILED' });
      expect((await ledger()).every((l) => l.payoutId === null)).toBe(true);
      const [second] = await earnings().prepare(ADMIN);
      expect(second).toMatchObject({ amount: 6, state: 'PENDING' });
      expect(second!.id).not.toBe(first!.id);
      await expect(earnings().markFailed(first!.id, ADMIN)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('npm run payouts', async () => {
      const cli = (...args: string[]) => runPayoutsCommand(args, earnings(), ADMIN);
      expect(await cli()).toEqual([USAGE]);
      expect(await cli('list', 'NOPE')).toEqual([USAGE]);
      expect(await cli('prepare')).toEqual(['Nothing to pay out.']);
      await paidOnline();
      await later(MONDAY_9AM - t.clock.now());
      const prepared = await cli('prepare');
      expect(prepared[0]).toBe('Prepared 1 payout(s):');
      expect(prepared[1]).toMatch(/ PENDING {2}Rs 326 {2}Swathi Naidu \(.+\) {2}2026-10-16\.\.2026-10-18$/);
      const payoutId = prepared[1]!.split(' ')[0]!;
      expect(await cli('list')).toEqual([prepared[1]]);
      expect(await cli('paid', payoutId)).toEqual([USAGE]);
      expect((await cli('paid', payoutId, 'UTR123'))[0]).toMatch(/^Marked paid: .+ PAID .+ref UTR123$/);
      expect(await cli('list')).toEqual(['No PENDING payouts.']);
      expect(await cli('list', 'paid')).toHaveLength(1);
    });
  });
});
