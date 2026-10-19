// Dispatch end to end: who gets offered, accept / reject / expiry, escalation, reassignment.
// The test clock starts at 2026-10-16 12:00 IST.
import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService, MISSED_OFFERS_LIMIT } from '../src/modules/dispatch/dispatch.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { buildTestApp, createTechnician, openSse, requireTestDatabase, resetDatabase, signIn, TEST_SECRETS, type TestApp } from './helpers';

const SEC = 1000;
const MIN = 60 * SEC;
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: 'Opp. City Park', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };

describe('dispatch (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const dispatch = () => t.app.get(DispatchService);
  let customer: string;
  let addressId: string;
  let phoneN = 0;

  /** An approved technician, online, optionally placed somewhere and with a rating / women-rated badge. */
  async function tech(opts: { at?: [number, number]; profile?: Record<string, unknown>; rating?: number; womenRated?: boolean; online?: boolean } = {}) {
    const phone = `98765${String(100_000 + ++phoneN).slice(1)}`; // 9876500001, 9876500002, ...
    const tk = await createTechnician(t, phone, { profile: opts.profile });
    if (opts.online !== false) await api().post('/v1/tech/availability').set(as(tk.token)).send({ online: true }).expect(200);
    if (opts.at) await t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(${opts.at[1]}, ${opts.at[0]}), 4326)::geography WHERE user_id = ${tk.id}::uuid`;
    if (opts.rating !== undefined || opts.womenRated !== undefined) {
      await t.prisma.technician.update({ where: { userId: tk.id }, data: { ...(opts.rating !== undefined ? { ratingAvg: opts.rating } : {}), ...(opts.womenRated !== undefined ? { womenRated: opts.womenRated } : {}) } });
    }
    return tk;
  }

  /** A booking whose visit fee is paid, searching for a technician (payments are covered in their own tests). */
  async function searching(over: Record<string, unknown> = {}) {
    const body = {
      serviceId: 'plumb-tap',
      problem: { issueIds: ['tap-leak'], notes: 'Leaks under the sink', voiceNote: null, photos: [] },
      addressId,
      time: { mode: 'INSTANT', window: null },
      preferWomenRated: false,
      ...over,
    };
    const id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id as string;
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
    await dispatch().offerNext(id);
    return id;
  }

  const offerOf = async (token: string) => (await api().get('/v1/tech/offers/current').set(as(token)).expect(200)).body;
  const openOffer = (bookingId: string) => t.prisma.jobOffer.findFirst({ where: { bookingId, state: 'OPEN' } });
  const booking = async (id: string) => (await api().get(`/v1/bookings/${id}`).set(as(customer)).expect(200)).body;

  /** Moves the clock and signs everyone in again where needed (access tokens last 15 minutes). */
  async function later(ms: number) {
    t.clock.advance(ms);
    customer = (await signIn(t, '9876543210')).accessToken;
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
    phoneN = 0;
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    customer = (await signIn(t, '9876543210')).accessToken;
    addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('who is offered', () => {
    it('offers only approved, online, skilled technicians in the area who are free', async () => {
      await tech({ profile: { skills: ['AC'] } }); // wrong skill
      await tech({ profile: { pincode: '500081' } }); // other area
      await tech({ online: false });
      const pending = await createTechnician(t, '9876509999', { approve: false }); // not approved (cannot go online)
      const right = await tech();
      const id = await searching();
      expect((await openOffer(id))?.technicianId).toBe(right.id);
      expect(await offerOf(pending.token)).toBeNull();
    });

    it('shares electrical, AC and appliance jobs between those trades; plumbing and carpentry stay with their own', async () => {
      const fanJob = { serviceId: 'elec-fan', problem: { issueIds: ['fan-dead'], notes: '', voiceNote: null, photos: [] } };
      const plumber = await tech({ profile: { skills: ['PLUMBING', 'CARPENTRY'] } });
      expect(await openOffer(await searching(fanJob))).toBeNull();
      const acTech = await tech({ profile: { skills: ['AC'] } });
      expect((await openOffer(await searching(fanJob)))?.technicianId).toBe(acTech.id);
      // The AC technician is busy with that offer; an appliance technician gets the next fan job.
      const applianceTech = await tech({ profile: { skills: ['APPLIANCE'] } });
      expect((await openOffer(await searching(fanJob)))?.technicianId).toBe(applianceTech.id);
      // A plumbing job goes to the plumber only.
      expect((await openOffer(await searching()))?.technicianId).toBe(plumber.id);
    });

    it('includes neighbouring PIN codes', async () => {
      const near = await tech({ profile: { pincode: '500033' } });
      expect(await openOffer(await searching())).toBeNull();
      await t.prisma.serviceAreaPincode.createMany({ data: [{ pincode: '500034', nearPincode: '500033' }, { pincode: '500033', nearPincode: '500034' }] });
      expect((await openOffer(await searching()))?.technicianId).toBe(near.id);
    });

    it('includes technicians with another PIN code who are within DISPATCH_RADIUS_KM (10 km) of the customer', async () => {
      await tech({ profile: { pincode: '500081' }, at: [17.52, 78.4482] }); // about 12 km north: too far
      expect(await openOffer(await searching())).toBeNull();
      const nearby = await tech({ profile: { pincode: '500081' }, at: [17.4146, 78.4482] }); // about 200 m away
      expect((await openOffer(await searching()))?.technicianId).toBe(nearby.id);
    });

    it('book the same technician again: asks them first, from any area; then the search goes on as usual', async () => {
      const close = await tech({ at: [17.413, 78.4485] });
      // Lives 15 km away in another PIN: outside the area, but they have worked for this customer before.
      const favourite = await tech({ at: [17.55, 78.4482], profile: { pincode: '500081', name: 'Ravi Kumar' } });
      const earlier = await searching();
      await t.prisma.jobOffer.updateMany({ where: { bookingId: earlier }, data: { state: 'WITHDRAWN' } });
      await t.prisma.booking.update({ where: { id: earlier }, data: { status: 'COMPLETED', technicianId: favourite.id } });

      const again = await searching({ repeatOf: earlier });
      const first = await openOffer(again);
      expect(first?.technicianId).toBe(favourite.id);
      expect((await booking(again)).preferredTechnician).toEqual({ name: 'Ravi Kumar' });
      await api().post(`/v1/tech/offers/${first!.id}/reject`).set(as(favourite.token)).send({ reason: 'BUSY' }).expect(204);
      expect((await openOffer(again))?.technicianId).toBe(close.id);
    });

    it('book again only from your own visit that took place', async () => {
      const someone = await tech();
      const unfinished = await searching();
      const body = (repeatOf: string) => ({
        serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId,
        time: { mode: 'INSTANT', window: null }, preferWomenRated: false, repeatOf,
      });
      // Still searching (no visit yet): refused.
      const res = await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body(unfinished)).expect(422);
      expect(res.body.error.fields).toMatchObject({ repeatOf: expect.any(String) });
      // Someone else's finished booking: refused the same way (nothing tells it exists).
      await t.prisma.booking.update({ where: { id: unfinished }, data: { status: 'COMPLETED', technicianId: someone.id } });
      const other = (await signIn(t, '9876543211')).accessToken;
      const otherAddress = (await api().post('/v1/addresses').set(as(other)).send(HOME).expect(201)).body.id;
      await api().post('/v1/bookings').set(as(other)).set('Idempotency-Key', randomUUID()).send({ ...body(unfinished), addressId: otherAddress }).expect(422);
    });

    it('estimates "Now" before booking from the nearest free technician, in minutes only', async () => {
      const estimate = async () => (await api().get(`/v1/eta?serviceId=plumb-tap&addressId=${addressId}`).set(as(customer)).expect(200)).body;
      expect(await estimate()).toEqual({ minutes: null }); // nobody online
      await tech({ at: [17.4486, 78.4482] }); // about 4 km north, 12:00 IST (20 km/h)
      expect(await estimate()).toEqual({ minutes: [35, 45] }); // matching 10 + getting ready 5 + 17 min on the road = 32, rounded up
      await tech({ at: [17.413, 78.4485] }); // next door
      expect(await estimate()).toEqual({ minutes: [20, 30] });
      await api().get(`/v1/eta?serviceId=plumb-tap&addressId=${randomUUID()}`).set(as(customer)).expect(404);
    });

    it('shows when an accepted instant visit arrives, and updates it as the technician moves', async () => {
      const t1 = await tech({ at: [17.4486, 78.4482] }); // about 4 km
      const id = await searching();
      const offer = await openOffer(id);
      await api().post(`/v1/tech/offers/${offer!.id}/accept`).set(as(t1.token)).expect(200);
      const first = (await booking(id)).etaMin as number;
      expect(first).toBeGreaterThan(5 + 10);
      await api().post('/v1/tech/location').set(as(t1.token)).send({ lat: 17.4136, lng: 78.4482 }).expect(204); // now 100 m away
      expect((await booking(id)).etaMin).toBe(5 + 1);
    });

    it('ranks the closest first, even over a better rating', async () => {
      await tech({ at: [17.45, 78.5], rating: 5 });
      const close = await tech({ at: [17.413, 78.4485], rating: 4 });
      expect((await openOffer(await searching()))?.technicianId).toBe(close.id);
    });

    it('without locations, ranks by rating', async () => {
      await tech({ rating: 4 });
      const better = await tech({ rating: 4.8 });
      expect((await openOffer(await searching()))?.technicianId).toBe(better.id);
    });

    it('then by fewest jobs accepted today (fairness)', async () => {
      const earlier = await searching(); // nobody online yet: no offer
      const x = await tech();
      const y = await tech();
      // Whoever would win the final tie-break has already accepted a job today.
      const [busier, fresher] = [x.id, y.id].sort();
      await t.prisma.jobOffer.create({
        data: { bookingId: earlier, technicianId: busier!, state: 'ACCEPTED', createdAt: new Date(t.clock.now() - MIN), expiresAt: new Date(t.clock.now()), respondedAt: new Date(t.clock.now() - MIN) },
      });
      await t.prisma.booking.update({ where: { id: earlier }, data: { status: 'CANCELLED' } });
      expect((await openOffer(await searching()))?.technicianId).toBe(fresher);
    });

    it('offers women-rated technicians first when the customer asked', async () => {
      const close = await tech({ at: [17.413, 78.4485] });
      const womenRated = await tech({ at: [17.45, 78.5], womenRated: true });
      expect((await openOffer(await searching({ preferWomenRated: true })))?.technicianId).toBe(womenRated.id);
      expect((await openOffer(await searching({ preferWomenRated: false })))?.technicianId).toBe(close.id);
    });

    it('shows the area, never the address, until accepted', async () => {
      const a = await tech({ at: [17.413, 78.4485] });
      const id = await searching();
      const offer = await offerOf(a.token);
      expect(offer).toEqual({
        id: expect.any(String),
        bookingId: id,
        code: expect.stringMatching(/^HF-/),
        serviceId: 'plumb-tap',
        categoryId: 'PLUMBING',
        issueIds: ['tap-leak'],
        notes: 'Leaks under the sink',
        photoCount: 0,
        area: 'Banjara Hills, Hyderabad',
        pincode: '500034',
        time: { mode: 'INSTANT', window: null },
        distanceKm: expect.any(Number),
        visitEarning: 30,
        createdAt: t.clock.now(),
        expiresAt: t.clock.now() + 45 * SEC,
      });
      expect(offer.distanceKm).toBeLessThan(0.2);
      expect(JSON.stringify(offer)).not.toContain('Flat 4B');
    });
  });

  describe('answering', () => {
    it('accept assigns the job: the technician gets the full job, the customer sees the technician', async () => {
      const a = await tech();
      const id = await searching();
      const offer = await offerOf(a.token);
      const job = await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(a.token)).expect(200);
      expect(job.body).toMatchObject({
        id,
        status: 'ASSIGNED',
        customerName: '',
        address: { house: 'Flat 4B, Lake View', landmark: 'Opp. City Park' },
        maskedPhone: '',
        earning: 30,
        otpAttemptsLeft: 5,
        acceptedAt: t.clock.now(),
        practice: false,
        demo: false,
      });
      const b = await booking(id);
      expect(b).toMatchObject({ status: 'ASSIGNED', technician: { id: a.id, name: { en: 'Swathi Naidu', te: 'Swathi Naidu' }, gender: 'F', years: 5, vehicle: 'Scooter · TS 08 CD 4521', demo: false } });
      // searching() moves the booking to MATCHING directly in the database, so the timeline skips it here.
      expect(b.history.map((h: { status: string }) => h.status)).toEqual(['AWAITING_PAYMENT', 'ASSIGNED']);
      expect(await offerOf(a.token)).toBeNull();
      expect((await api().get('/v1/tech/jobs?scope=active').set(as(a.token)).expect(200)).body.map((j: { id: string }) => j.id)).toEqual([id]);
    });

    it('lets only one accept win, even when sent twice at once', async () => {
      const a = await tech();
      const id = await searching();
      const offer = await offerOf(a.token);
      const results = await Promise.all([1, 2].map(() => api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(a.token))));
      expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
      expect(await t.prisma.bookingEvent.count({ where: { bookingId: id, status: 'ASSIGNED' } })).toBe(1);
    });

    it('refuses an accept after 45 s even before the sweep runs (OFFER_EXPIRED)', async () => {
      const a = await tech();
      await searching();
      const offer = await offerOf(a.token);
      t.clock.advance(45 * SEC);
      const res = await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(a.token)).expect(410);
      expect(res.body.error.code).toBe('OFFER_EXPIRED');
      expect(await offerOf(a.token)).toBeNull();
    });

    it("hides other technicians' offers", async () => {
      const a = await tech({ at: [17.413, 78.4485] });
      const b = await tech({ at: [17.45, 78.5] });
      await searching();
      const offer = await offerOf(a.token);
      expect(await offerOf(b.token)).toBeNull();
      await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(b.token)).expect(404);
    });

    it('reject offers the next technician at once (with the reason kept)', async () => {
      const first = await tech({ at: [17.413, 78.4485] });
      const second = await tech({ at: [17.45, 78.5] });
      const id = await searching();
      const offer = await offerOf(first.token);
      await api().post(`/v1/tech/offers/${offer.id}/reject`).set(as(first.token)).send({ reason: 'BUSY' }).expect(204);
      expect(await t.prisma.jobOffer.findUnique({ where: { id: offer.id } })).toMatchObject({ state: 'REJECTED', rejectReason: 'BUSY' });
      expect((await openOffer(id))?.technicianId).toBe(second.id);
      await api().post(`/v1/tech/offers/${offer.id}/reject`).set(as(first.token)).send({}).expect(204); // no-op
    });
  });

  describe('timers', () => {
    it('moves an unanswered offer on after 45 s; 3 misses in a row take a technician offline', async () => {
      const lazy = await tech({ at: [17.413, 78.4485] });
      const other = await tech({ at: [17.45, 78.5] });
      for (let i = 0; i < MISSED_OFFERS_LIMIT; i++) {
        const id = await searching();
        expect((await openOffer(id))?.technicianId).toBe(lazy.id);
        t.clock.advance(46 * SEC);
        await dispatch().tick();
        expect((await openOffer(id))?.technicianId).toBe(other.id);
        await t.prisma.jobOffer.updateMany({ where: { bookingId: id, state: 'OPEN' }, data: { state: 'WITHDRAWN' } });
        await t.prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
      }
      const me = await t.prisma.technician.findUniqueOrThrow({ where: { userId: lazy.id } });
      expect(me).toMatchObject({ online: false, missedOffersInRow: 0 });
    });

    it('still searching after 10 minutes, none found after 30 (the open offer is withdrawn)', async () => {
      const id = await searching();
      await later(10 * MIN);
      await dispatch().tick();
      expect((await booking(id)).status).toBe('MATCHING_DELAYED');
      const a = await tech();
      await dispatch().tick();
      expect((await openOffer(id))?.technicianId).toBe(a.id);
      await later(20 * MIN);
      await dispatch().tick();
      const b = await booking(id);
      expect(b.status).toBe('UNFULFILLED');
      expect(b.history.map((h: { status: string }) => h.status).slice(-2)).toEqual(['MATCHING_DELAYED', 'UNFULFILLED']);
      expect(await openOffer(id)).toBeNull();
    });

    it('offers a waiting booking as soon as someone comes online', async () => {
      const id = await searching();
      expect(await openOffer(id)).toBeNull();
      const a = await tech();
      await dispatch().tick();
      expect((await openOffer(id))?.technicianId).toBe(a.id);
    });

    it('cancels an unfulfilled booking with a refund after 24 hours', async () => {
      const id = await searching();
      await t.prisma.booking.update({ where: { id }, data: { status: 'UNFULFILLED' } });
      t.clock.advance(30 * MIN + 23 * 60 * MIN);
      expect(await t.app.get(PaymentsService).expireUnfulfilled()).toBe(0);
      t.clock.advance(61 * MIN);
      expect(await t.app.get(PaymentsService).expireUnfulfilled()).toBe(1);
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id }, include: { payments: true } });
      expect(row).toMatchObject({ status: 'CANCELLED', cancelReason: 'UNFULFILLED_EXPIRED' });
      expect(row.payments[0]!.state).toBe('REFUNDED');
    });
  });

  describe('reassignment', () => {
    async function assigned(over: Record<string, unknown> = {}) {
      const first = await tech({ at: [17.413, 78.4485] });
      const second = await tech({ at: [17.45, 78.5] });
      const id = await searching(over);
      const offer = await offerOf(first.token);
      await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(first.token)).expect(200);
      return { id, first, second };
    }

    it('instant: no trip 10 minutes after accepting goes back to matching, without that technician', async () => {
      const { id, first, second } = await assigned();
      t.clock.advance(9 * MIN);
      await dispatch().tick();
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('ASSIGNED');
      t.clock.advance(MIN);
      await dispatch().tick();
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'MATCHING', technicianId: null });
      expect((await openOffer(id))?.technicianId).toBe(second.id);
      first.token = (await signIn(t, '9876500001', 'TECHNICIAN')).accessToken;
      await api().get(`/v1/tech/jobs/${id}`).set(as(first.token)).expect(404);
    });

    it('scheduled: no trip by 30 minutes before the window', async () => {
      const window = { date: '2026-10-16', startHour: 16, endHour: 18 };
      const { id } = await assigned({ time: { mode: 'SCHEDULED', window } });
      t.clock.t = Date.UTC(2026, 9, 16, 10, 0) - 1; // 15:29:59 IST
      await dispatch().tick();
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('ASSIGNED');
      t.clock.advance(1);
      await dispatch().tick();
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('MATCHING');
    });
  });

  describe('customer and technician changes', () => {
    it('cancelling withdraws the open offer', async () => {
      const a = await tech();
      const id = await searching();
      await api().post(`/v1/bookings/${id}/cancel`).set(as(customer)).send({}).expect(200);
      expect(await offerOf(a.token)).toBeNull();
      expect((await t.prisma.jobOffer.findFirstOrThrow({ where: { bookingId: id } })).state).toBe('WITHDRAWN');
    });

    it('a technician going offline gives the offer back without counting a miss', async () => {
      const a = await tech({ at: [17.413, 78.4485] });
      const b = await tech({ at: [17.45, 78.5] });
      const id = await searching();
      await api().post('/v1/tech/availability').set(as(a.token)).send({ online: false }).expect(200);
      await dispatch().tick();
      expect((await openOffer(id))?.technicianId).toBe(b.id);
      expect((await t.prisma.technician.findUniqueOrThrow({ where: { userId: a.id } })).missedOffersInRow).toBe(0);
    });

    it('paying the visit fee offers the job straight away', async () => {
      const a = await tech();
      const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
      const id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
      const order = (await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'VISIT', method: 'UPI' }).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId);
      const signature = createHmac('sha256', TEST_SECRETS.RAZORPAY_KEY_SECRET).update(`${order.orderId}|${rp.id}`).digest('hex');
      await api().post(`/v1/payments/${order.paymentId}/verify`).set(as(customer)).send({ razorpayOrderId: order.orderId, razorpayPaymentId: rp.id, razorpaySignature: signature }).expect(200);
      expect((await offerOf(a.token))?.bookingId).toBe(id);
    });
  });

  it('streams job updates to the technician', async () => {
    await t.app.listen(0, '127.0.0.1');
    const port = (t.app.getHttpServer().address() as AddressInfo).port;
    const a = await tech();
    const id = await searching();
    await api().post(`/v1/tech/offers/${(await offerOf(a.token)).id}/accept`).set(as(a.token)).expect(200);
    const stream = openSse(port, `/v1/tech/jobs/${id}/stream`, a.token, 'job');
    try {
      await stream.waitFor(1);
      expect(stream.events[0]).toMatchObject({ id, status: 'ASSIGNED' });
      await api().post(`/v1/bookings/${id}/cancel`).set(as(customer)).send({ reason: 'FIXED' }).expect(200);
      await stream.waitFor(2);
      expect(stream.events[1]).toMatchObject({ status: 'CANCELLED', cancelReason: 'FIXED', earning: 0 });
    } finally {
      stream.close();
    }
  });
});
