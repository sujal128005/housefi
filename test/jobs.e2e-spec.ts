// Job actions end to end: the visit from the trip to payment, quotes and the price check, the start code, reports.
// The test clock starts at 2026-10-16 12:00 IST. plumb-tap: typical range ₹149-₹596, review above ₹894.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const MIN = 60_000;
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const QUOTE = { which: 'MAIN', diagnosis: 'Worn-out washer and a loose joint under the sink.', lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 120 }, { kind: 'MATERIAL', name: 'Washer and sealant', qty: 1, unitPrice: 200 }] };
const EXTRA = { which: 'EXTRA', diagnosis: 'The tap body is cracked and should be replaced.', lines: [{ kind: 'MATERIAL', name: 'New tap (ISI)', qty: 1, unitPrice: 340 }] };

describe('job actions (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let tech: { id: string; token: string };
  let id: string;

  const act = (action: string, body: object = {}, token = tech.token) => api().post(`/v1/tech/jobs/${id}/${action}`).set(as(token)).send(body);
  const answer = (which: 'MAIN' | 'EXTRA', a: string) => api().post(`/v1/bookings/${id}/quotes/${which}/answer`).set(as(customer)).send({ answer: a });
  const booking = async () => (await api().get(`/v1/bookings/${id}`).set(as(customer)).expect(200)).body;
  const job = async () => (await api().get(`/v1/tech/jobs/${id}`).set(as(tech.token)).expect(200)).body;
  const startCode = async () => t.app.get(FieldCipher).decrypt('bookings.arrival_code', (await t.prisma.booking.findUniqueOrThrow({ where: { id } })).arrivalCodeEnc);
  const placeTech = (lat: number, lng: number) => t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography WHERE user_id = ${tech.id}::uuid`;

  /** Booking paid, offered and accepted: the technician is assigned. */
  async function assignedJob() {
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
    tech = await createTechnician(t);
    await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    await placeTech(17.4135, 78.449); // about 100 m away
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
    await t.app.get(DispatchService).offerNext(id);
    const offer = (await api().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
    await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
  }

  /** From assigned to inspecting (trip, arrival, start code). */
  async function atTheDoor() {
    await act('start-trip').expect(200);
    await act('arrived').expect(200);
    await act('verify-start-code', { code: await startCode() }).expect(200);
  }

  async function repairing() {
    await atTheDoor();
    await act('quotes', QUOTE).expect(200);
    await answer('MAIN', 'APPROVE').expect(200);
    await act('start-work').expect(200);
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
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    await assignedJob();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('runs a whole visit: trip, door, quote, approval, repair, bill, cash', async () => {
    const trip = await act('start-trip').expect(200);
    expect(trip.body.status).toBe('EN_ROUTE');
    expect((await booking()).etaMin).toBe(1);
    await placeTech(17.45, 78.5); // further away: the ETA follows the location updates
    await api().post('/v1/tech/location').set(as(tech.token)).send({ lat: 17.45, lng: 78.5 }).expect(204);
    const onTheWay = await booking();
    expect(onTheWay.etaMin).toBeGreaterThan(20);
    // The customer sees the technician move, only while they travel and only from a recent point.
    expect(onTheWay.technicianLocation).toEqual({ lat: 17.45, lng: 78.5, accuracyM: null, at: t.clock.now() });
    t.clock.t += 11 * 60_000;
    expect((await booking()).technicianLocation).toBeNull();
    await api().post('/v1/tech/location').set(as(tech.token)).send({ lat: 17.45, lng: 78.5, accuracy: 12.4 }).expect(204);
    expect((await booking()).technicianLocation).toMatchObject({ accuracyM: 12 });

    expect((await act('arrived').expect(200)).body.status).toBe('ARRIVED');
    const arrived = await booking();
    expect(arrived.etaMin).toBeNull();
    expect(arrived.technicianLocation).toBeNull();
    expect((await act('verify-start-code', { code: await startCode() }).expect(200)).body.status).toBe('INSPECTING');

    const quoted = await act('quotes', QUOTE).expect(200);
    expect(quoted.body).toMatchObject({ status: 'QUOTE_SHARED', quote: { version: 1, total: 320, review: { state: 'FAIR' }, decision: 'PENDING' } });
    const shared = await booking();
    expect(shared.quote).toEqual({
      id: expect.any(String),
      version: 1,
      lines: [
        { kind: 'LABOUR', name: { en: 'Repair labour', te: 'Repair labour' }, qty: 1, unitPrice: 120 },
        { kind: 'MATERIAL', name: { en: 'Washer and sealant', te: 'Washer and sealant' }, qty: 1, unitPrice: 200 },
      ],
      labourTotal: 120,
      materialTotal: 200,
      total: 320,
      diagnosis: { en: QUOTE.diagnosis, te: QUOTE.diagnosis },
      review: { state: 'FAIR', typicalMin: 149, typicalMax: 596 },
      decision: 'PENDING',
      at: t.clock.now(),
    });

    expect((await answer('MAIN', 'APPROVE').expect(200)).body).toMatchObject({ status: 'IN_PROGRESS', workStarted: false, quote: { decision: 'APPROVED' } });
    await act('complete').expect(409); // not before the repair has started
    expect((await act('start-work').expect(200)).body.workStarted).toBe(true);
    expect((await act('complete').expect(200)).body).toMatchObject({ status: 'PAYMENT_DUE', finalPayment: { kind: 'FINAL', amount: 320, state: 'DUE' } });

    await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'CASH' }).expect(200);
    const done = await act('confirm-cash').expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', earning: 326, finalPayment: { state: 'PAID', method: 'CASH' } });
    expect((await booking()).history.map((h: { status: string }) => h.status)).toEqual([
      'AWAITING_PAYMENT', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'PAYMENT_DUE', 'COMPLETED',
    ]);
  });

  describe('start code', () => {
    it('counts wrong codes and locks after 5, opening a support ticket', async () => {
      await act('start-trip').expect(200);
      await act('arrived').expect(200);
      const right = await startCode();
      const wrong = right === '0000' ? '1111' : '0000';
      for (let left = 4; left >= 1; left--) {
        const res = await act('verify-start-code', { code: wrong }).expect(400);
        expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', attemptsLeft: left });
      }
      expect((await act('verify-start-code', { code: wrong }).expect(429)).body.error.code).toBe('OTP_LOCKED');
      expect((await act('verify-start-code', { code: right }).expect(429)).body.error.code).toBe('OTP_LOCKED');
      expect((await job()).otpAttemptsLeft).toBe(0);
      expect(await t.prisma.supportTicket.findFirstOrThrow({ where: { bookingId: id } })).toMatchObject({ kind: 'START_CODE_LOCKED', priority: 'HIGH', state: 'OPEN' });
    });

    it('only at the door', async () => {
      expect((await act('verify-start-code', { code: await startCode() }).expect(409)).body.error.code).toBe('CONFLICT');
    });
  });

  describe('quotes and the price check', () => {
    it('needs a labour line and at least ₹100, and only while inspecting', async () => {
      await act('quotes', QUOTE).expect(409);
      await atTheDoor();
      await act('quotes', { ...QUOTE, lines: [QUOTE.lines[1]] }).expect(422);
      await act('quotes', { ...QUOTE, lines: [{ kind: 'LABOUR', name: 'Check', qty: 1, unitPrice: 99 }] }).expect(422);
    });

    it('holds a high quote for review, hidden from the customer, then clears it after 2 minutes (audited)', async () => {
      await atTheDoor();
      const res = await act('quotes', { ...QUOTE, lines: [{ kind: 'LABOUR', name: 'Full replacement', qty: 1, unitPrice: 1000 }] }).expect(200);
      expect(res.body).toMatchObject({ status: 'INSPECTING', quote: { review: { state: 'UNDER_REVIEW' } } });
      expect((await booking()).quote).toBeNull();
      await act('quotes', QUOTE).expect(409); // one at a time
      const jobs = t.app.get(JobsService);
      t.clock.advance(2 * MIN - 1);
      expect(await jobs.autoClearReviews()).toBe(0);
      t.clock.advance(1);
      expect(await jobs.autoClearReviews()).toBe(1);
      expect((await booking()).quote).toMatchObject({ total: 1000, review: { state: 'CLEARED' } });
      expect((await booking()).status).toBe('QUOTE_SHARED');
      expect(await t.prisma.auditLog.findFirst({ where: { action: 'quote.auto_clear' } })).toMatchObject({ actorType: 'SYSTEM', entity: 'quote' });
    });

    it('revises after the customer asks for a lower price (new version, old kept)', async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      expect((await answer('MAIN', 'REVISION').expect(200)).body).toMatchObject({ status: 'QUOTE_SHARED', quote: { version: 1, decision: 'REVISION_REQUESTED' } });
      await answer('MAIN', 'APPROVE').expect(409); // nothing pending to approve
      const revised = { ...QUOTE, lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 100 }, QUOTE.lines[1]] };
      await act('quotes', revised).expect(200);
      expect((await booking()).quote).toMatchObject({ version: 2, total: 300, decision: 'PENDING' });
      expect((await booking()).history.filter((h: { status: string }) => h.status === 'QUOTE_SHARED')).toHaveLength(2);
      expect(await t.prisma.quote.findMany({ where: { bookingId: id }, orderBy: { version: 'asc' }, select: { version: true, superseded: true } })).toEqual([
        { version: 1, superseded: true },
        { version: 2, superseded: false },
      ]);
    });

    it('declining ends the visit without repair; the technician still earns the visit share', async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      const res = await answer('MAIN', 'DECLINE').expect(200);
      expect(res.body).toMatchObject({ status: 'CLOSED_NO_REPAIR', closeReason: 'CUSTOMER_DECLINED', visitPayment: { state: 'PAID' }, quote: { decision: 'REJECTED' } });
      expect((await job()).earning).toBe(30);
    });
  });

  describe('extra work', () => {
    it('needs a second approval and is added to the bill', async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      await answer('MAIN', 'APPROVE').expect(200);
      await act('quotes', EXTRA).expect(409); // only once the repair has started
      await act('start-work').expect(200);
      expect((await act('quotes', EXTRA).expect(200)).body.status).toBe('EXTRA_WORK');
      await act('complete').expect(409);
      await answer('EXTRA', 'REVISION').expect(422);
      expect((await answer('EXTRA', 'APPROVE').expect(200)).body).toMatchObject({ status: 'IN_PROGRESS', extraQuote: { total: 340, decision: 'APPROVED' } });
      await act('quotes', EXTRA).expect(409); // one approved extra per job
      expect((await act('complete').expect(200)).body.finalPayment.amount).toBe(660);
    });

    it('a declined extra is not billed, and another may be proposed', async () => {
      await repairing();
      await act('quotes', EXTRA).expect(200);
      await answer('EXTRA', 'DECLINE').expect(200);
      await act('quotes', { ...EXTRA, lines: [{ kind: 'MATERIAL', name: 'Cheaper tap', qty: 1, unitPrice: 200 }] }).expect(200);
      expect((await booking()).extraQuote).toMatchObject({ version: 2, total: 200 });
      await answer('EXTRA', 'DECLINE').expect(200);
      expect((await act('complete').expect(200)).body.finalPayment.amount).toBe(320);
    });
  });

  describe('reports', () => {
    it('customer unavailable at the door closes the visit', async () => {
      await act('start-trip').expect(200);
      await act('reports', { issue: 'CUSTOMER_UNAVAILABLE' }).expect(409);
      await act('arrived').expect(200);
      expect((await act('reports', { issue: 'CUSTOMER_UNAVAILABLE', note: 'Called twice, no answer' }).expect(200)).body).toMatchObject({ status: 'CLOSED_NO_REPAIR', closeReason: 'CUSTOMER_UNAVAILABLE', earning: 30 });
    });

    it('cannot complete during the repair closes the visit', async () => {
      await repairing();
      expect((await act('reports', { issue: 'CANNOT_COMPLETE' }).expect(200)).body).toMatchObject({ status: 'CLOSED_NO_REPAIR', closeReason: 'CANNOT_COMPLETE' });
    });

    it('unsafe opens an urgent ticket and leaves the job as it is', async () => {
      await act('start-trip').expect(200);
      expect((await act('reports', { issue: 'UNSAFE', note: 'Aggressive dog at the gate' }).expect(200)).body.status).toBe('EN_ROUTE');
      expect(await t.prisma.supportTicket.findFirstOrThrow({ where: { bookingId: id } })).toMatchObject({ kind: 'UNSAFE', priority: 'URGENT', note: 'Aggressive dog at the gate' });
    });
  });

  it("refuses actions on someone else's job", async () => {
    const other = await createTechnician(t, '9876500022');
    await act('start-trip', {}, other.token).expect(404);
    const stranger = (await signIn(t, '9876500033')).accessToken;
    await api().post(`/v1/bookings/${id}/quotes/MAIN/answer`).set(as(stranger)).send({ answer: 'APPROVE' }).expect(404);
    await answer('MAIN', 'APPROVE').expect(409);
  });
});
