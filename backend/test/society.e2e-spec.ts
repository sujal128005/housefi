// Society repair day end to end: an organiser plans a day, neighbours book their flats with the code at the lower
// visit fee, flats wait (no search of their own) until the cutoff; enough paid flats confirm the day and the technician
// who accepts the first flat gets them all; too few cancels and refunds every flat.
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { SocietyService } from '../src/modules/society/society.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TEST_SECRETS, type TestApp } from './helpers';

const HOME = { label: 'HOME', street: 'Lotus Residency, Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
// Mon 19 Oct 2026, 09:00 IST. The day: Thu 22 Oct, 10:00-12:00; flats join until Wed 21 Oct, 18:00 IST.
const NOW = Date.UTC(2026, 9, 19, 3, 30);
const CUTOFF = Date.UTC(2026, 9, 21, 12, 30);
const WINDOW = { date: '2026-10-22', startHour: 10, endHour: 12 };

describe('society repair day (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let organiser: { token: string; addressId: string };

  async function neighbour(n: number, flat = `Flat ${n}0${n}`, pincode = '500034') {
    const token = (await signIn(t, `98765432${String(n).padStart(2, '0')}`)).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(token)).send({ ...HOME, house: flat, pincode }).expect(201)).body.id as string;
    return { token, addressId };
  }

  const flatBody = (addressId: string, societyCode: string, extra: object = {}) => ({
    serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId,
    time: { mode: 'SCHEDULED', window: WINDOW }, preferWomenRated: false, societyCode, ...extra,
  });

  const join = (who: { token: string; addressId: string }, code: string) =>
    api().post('/v1/bookings').set(as(who.token)).set('Idempotency-Key', randomUUID()).send(flatBody(who.addressId, code));

  async function payVisit(token: string, bookingId: string) {
    const order = (await api().post(`/v1/bookings/${bookingId}/payments`).set(as(token)).set('Idempotency-Key', randomUUID()).send({ kind: 'VISIT', method: 'UPI' }).expect(200)).body;
    const rp = t.razorpay.pay(order.orderId);
    const signature = createHmac('sha256', TEST_SECRETS.RAZORPAY_KEY_SECRET).update(`${order.orderId}|${rp.id}`).digest('hex');
    await api().post(`/v1/payments/${order.paymentId}/verify`).set(as(token)).send({ razorpayOrderId: order.orderId, razorpayPaymentId: rp.id, razorpaySignature: signature }).expect(200);
  }

  async function plan(name = 'Lotus Residency') {
    return (await api().post('/v1/society-days').set(as(organiser.token)).send({ name, categoryId: 'PLUMBING', addressId: organiser.addressId, window: WINDOW }).expect(201)).body;
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    t.razorpay.reset();
    t.clock.t = NOW;
    organiser = await neighbour(1, 'Flat 101 (secretary)');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('plans a day that neighbours see by its code (area and count only)', async () => {
    const day = await plan();
    expect(day).toEqual({
      code: expect.stringMatching(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/), name: 'Lotus Residency', categoryId: 'PLUMBING',
      area: { locality: expect.any(String), city: 'Hyderabad', pincode: '500034' }, time: { mode: 'SCHEDULED', window: WINDOW },
      state: 'OPEN', flats: 0, joined: 0, minFlats: 4, maxFlats: 20, visitFee: 25, usualVisitFee: 49, cutoffAt: CUTOFF,
      organiser: true, myBookingId: null, technician: null,
    });
    const other = await neighbour(2);
    const seen = (await api().get(`/v1/society-days/${day.code.toLowerCase()}`).set(as(other.token)).expect(200)).body;
    expect(seen).toMatchObject({ code: day.code, organiser: false });
    expect(JSON.stringify(seen)).not.toMatch(/Flat 101|secretary|Road No/);
    await api().get('/v1/society-days/ZZZZZZ').set(as(other.token)).expect(404);

    // Too late (the cutoff has passed) or too far ahead, or someone else's address: refused.
    await api().post('/v1/society-days').set(as(organiser.token)).send({ name: 'X', categoryId: 'PLUMBING', addressId: organiser.addressId, window: WINDOW }).expect(422);
    await api().post('/v1/society-days').set(as(organiser.token)).send({ name: 'Lotus', categoryId: 'PLUMBING', addressId: organiser.addressId, window: { ...WINDOW, date: '2026-10-19' } }).expect(422);
    await api().post('/v1/society-days').set(as(organiser.token)).send({ name: 'Lotus', categoryId: 'PLUMBING', addressId: organiser.addressId, window: { ...WINDOW, date: '2026-11-20' } }).expect(422);
    await api().post('/v1/society-days').set(as(organiser.token)).send({ name: 'Lotus', categoryId: 'PLUMBING', addressId: other.addressId, window: WINDOW }).expect(422);
  });

  it('books flats at ₹25 with the code, only in its trade, area and window, once per customer', async () => {
    const day = await plan();
    const flat = (await join(organiser, day.code).expect(201)).body;
    expect(flat).toMatchObject({ status: 'AWAITING_PAYMENT', visitPayment: { amount: 25 }, society: { code: day.code, name: 'Lotus Residency', state: 'OPEN' } });
    await join(organiser, day.code).expect(409);

    const b = await neighbour(2);
    await api().post('/v1/bookings').set(as(b.token)).set('Idempotency-Key', randomUUID()).send(flatBody(b.addressId, day.code, { serviceId: 'elec-fan', problem: { issueIds: [], notes: 'fan', voiceNote: null, photos: [] } })).expect(422);
    await api().post('/v1/bookings').set(as(b.token)).set('Idempotency-Key', randomUUID()).send(flatBody(b.addressId, day.code, { time: { mode: 'SCHEDULED', window: { ...WINDOW, startHour: 14, endHour: 16 } } })).expect(422);
    await api().post('/v1/bookings').set(as(b.token)).set('Idempotency-Key', randomUUID()).send(flatBody(b.addressId, 'ABCDEF')).expect(404);
    const far = await neighbour(3, 'Flat 9', '500033');
    await join(far, day.code).expect(422);

    // Paid flats wait for the day: no search, no offer, no "delayed" after 10 minutes.
    const tech = await createTechnician(t);
    await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    await payVisit(organiser.token, flat.id);
    t.clock.advance(15 * 60_000);
    await t.app.get(DispatchService).tick();
    expect((await api().get(`/v1/bookings/${flat.id}`).set(as(organiser.token)).expect(200)).body.status).toBe('MATCHING');
    expect(await t.prisma.jobOffer.count()).toBe(0);
    expect((await api().get(`/v1/society-days/${day.code}`).set(as(organiser.token)).expect(200)).body).toMatchObject({ flats: 1, joined: 1, myBookingId: flat.id });
  });

  it('cancels and refunds every flat when too few have paid by the cutoff', async () => {
    const day = await plan();
    const ids: string[] = [];
    for (const who of [organiser, await neighbour(2), await neighbour(3)]) {
      const flat = (await join(who, day.code).expect(201)).body;
      await payVisit(who.token, flat.id);
      ids.push(flat.id);
    }
    const unpaid = await neighbour(4);
    await join(unpaid, day.code).expect(201);
    t.clock.t = CUTOFF - 60_000;
    expect(await t.app.get(SocietyService).tick()).toEqual({ confirmed: 0, cancelled: 0, assigned: 0 });
    // Joining closes at the cutoff.
    t.clock.t = CUTOFF;
    await join(await neighbour(5), day.code).expect(409);
    expect(await t.app.get(SocietyService).tick()).toMatchObject({ cancelled: 1 });
    const flats = await t.prisma.booking.findMany({ where: { societyDayId: { not: null } }, include: { payments: true } });
    expect(flats.map((f) => f.status)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED', 'CANCELLED']);
    expect(flats.filter((f) => ids.includes(f.id)).map((f) => f.payments.find((p) => p.kind === 'VISIT')?.state)).toEqual(['REFUNDED', 'REFUNDED', 'REFUNDED']);
    // Access tokens last 15 minutes: sign in again after the clock jump.
    const again = (await signIn(t, '9876543201')).accessToken;
    expect((await api().get(`/v1/society-days/${day.code}`).set(as(again)).expect(200)).body.state).toBe('CANCELLED');
  });

  it('confirms with 4 paid flats; the technician who accepts the first flat gets every flat', async () => {
    const day = await plan();
    const people = [organiser, await neighbour(2), await neighbour(3), await neighbour(4)];
    const ids: string[] = [];
    for (const who of people) {
      const flat = (await join(who, day.code).expect(201)).body;
      await payVisit(who.token, flat.id);
      ids.push(flat.id);
    }
    const tech = await createTechnician(t);
    await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    await t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(78.449, 17.4135), 4326)::geography WHERE user_id = ${tech.id}::uuid`;

    t.clock.t = CUTOFF + 30_000;
    expect(await t.app.get(SocietyService).tick()).toMatchObject({ confirmed: 1 });
    // Access tokens last 15 minutes: sign in again after the clock jump.
    tech.token = (await signIn(t, '9876500011', 'TECHNICIAN')).accessToken;
    const neighbourToken = (await signIn(t, '9876543203')).accessToken;
    const offer = (await api().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
    expect(offer).toBeTruthy();
    expect(ids).toContain(offer.bookingId);
    expect(await t.prisma.jobOffer.count()).toBe(1);
    await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);

    const flats = await t.prisma.booking.findMany({ where: { id: { in: ids } } });
    expect(flats.map((f) => [f.status, f.technicianId])).toEqual(ids.map(() => ['ASSIGNED', tech.id]));
    expect((await api().get(`/v1/society-days/${day.code}`).set(as(neighbourToken)).expect(200)).body).toMatchObject({ state: 'ASSIGNED', flats: 4, technician: { name: 'Swathi' } });
    const job = (await api().get(`/v1/tech/jobs/${ids[3]}`).set(as(tech.token)).expect(200)).body;
    expect(job).toMatchObject({ status: 'ASSIGNED', society: { code: day.code, name: 'Lotus Residency', state: 'ASSIGNED' } });
    // ₹25 paid, the technician still earns the ₹30 visit share: Housefi adds ₹5.
    expect(job.fairPay).toMatchObject({ total: 25, technician: 30, housefi: -5 });

    // Flat after flat: the "trip not started 30 minutes before" timer does not take flats away.
    t.clock.t = Date.UTC(2026, 9, 22, 6, 0);
    await t.app.get(DispatchService).tick();
    expect((await t.prisma.booking.findMany({ where: { id: { in: ids } } })).every((f) => f.status === 'ASSIGNED' && f.technicianId === tech.id)).toBe(true);
  });
});
