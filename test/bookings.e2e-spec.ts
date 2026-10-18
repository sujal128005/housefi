// Bookings end to end. The test clock starts at 2026-10-16 12:00 IST (06:30 UTC).
import type { BookingStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const MIN = 60_000;
const NOON_IST = Date.UTC(2026, 9, 16, 6, 30);
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: 'Opp. City Park', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const TOMORROW_10 = { mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 10, endHour: 12 } };

describe('bookings (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  let token: string;
  let addressId: string;
  let keyN = 0;

  const newBooking = (over: Record<string, unknown> = {}) => ({
    serviceId: 'plumb-tap',
    problem: { issueIds: ['tap-leak'], notes: 'Leaks more when the hot water is on', voiceNote: { durationSec: 7, transcript: 'Water is leaking under the sink.' }, photos: [] },
    addressId,
    time: { mode: 'INSTANT', window: null },
    preferWomenRated: true,
    ...over,
  });
  const book = (body: object = newBooking(), key = `key-${++keyN}-${randomUUID()}`, as = token) =>
    api().post('/v1/bookings').set('Authorization', `Bearer ${as}`).set('Idempotency-Key', key).send(body);
  const auth = (r: request.Test, as = token) => r.set('Authorization', `Bearer ${as}`);

  /** Moves a booking to a later status directly in the database (payments and dispatch arrive in steps 6-8). */
  async function force(id: string, status: BookingStatus, visitPaid = true) {
    await t.prisma.booking.update({ where: { id }, data: { status } });
    if (visitPaid) {
      await t.prisma.payment.updateMany({ where: { bookingId: id, kind: 'VISIT' }, data: { state: 'PAID', method: 'UPI', providerPaymentId: `pay_${id.slice(0, 8)}`, settledAt: new Date(t.clock.now()) } });
    }
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
    t.clock.t = NOON_IST;
    token = (await signIn(t)).accessToken;
    addressId = (await auth(api().post('/v1/addresses')).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('POST /v1/bookings', () => {
    it('creates an instant booking waiting for the visit fee, in the contract shape', async () => {
      const res = await book().expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        code: expect.stringMatching(/^HF-\d{5}$/),
        serviceId: 'plumb-tap',
        categoryId: 'PLUMBING',
        problem: { issueIds: ['tap-leak'], notes: 'Leaks more when the hot water is on', voiceNote: { durationSec: 7, transcript: 'Water is leaking under the sink.' }, photos: [] },
        address: { id: addressId, ...HOME },
        time: { mode: 'INSTANT', window: null },
        preferWomenRated: true,
        status: 'AWAITING_PAYMENT',
        technician: null,
        arrivalOtp: '',
        etaMin: null,
        technicianLocation: null,
        visitPayment: { kind: 'VISIT', amount: 49, state: 'DUE', method: null, txnId: null, at: null },
        quote: null,
        extraQuote: null,
        finalPayment: null,
        rating: null,
        createdAt: NOON_IST,
        history: [{ status: 'AWAITING_PAYMENT', at: NOON_IST }],
        cancelReason: null,
        closeReason: null,
        workStarted: false,
        viaTechApp: true,
        demo: false,
      });
    });

    it('stores the address copy and the 4-digit arrival code encrypted, the PostGIS point and a ₹49 DUE payment', async () => {
      const { body } = await book().expect(201);
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id: body.id }, include: { payments: true } });
      expect(Buffer.from(row.addressSnapshotEnc).toString('latin1')).not.toContain('Flat 4B');
      expect(await t.app.get(FieldCipher).decrypt('bookings.arrival_code', row.arrivalCodeEnc)).toMatch(/^\d{4}$/);
      expect(row).toMatchObject({ locality: 'Banjara Hills', pincode: '500034', categoryId: 'PLUMBING' });
      expect(row.payments).toMatchObject([{ kind: 'VISIT', amountPaise: 4900n, state: 'DUE' }]);
      const [geo] = await t.prisma.$queryRaw<{ wkt: string }[]>`SELECT ST_AsText(location) AS wkt FROM bookings WHERE id = ${body.id}::uuid`;
      expect(geo!.wkt).toBe('POINT(78.4482 17.4126)');
    });

    it('keeps its own copy of the address when the saved address changes or is deleted', async () => {
      const { body } = await book().expect(201);
      await auth(api().delete(`/v1/addresses/${addressId}`)).expect(204);
      expect((await auth(api().get(`/v1/bookings/${body.id}`)).expect(200)).body.address).toEqual({ id: addressId, ...HOME });
    });

    describe('Idempotency-Key', () => {
      it('returns the original booking when the same request is retried', async () => {
        const first = await book(newBooking(), 'retry-key-0001').expect(201);
        const again = await book(newBooking(), 'retry-key-0001').expect(201);
        expect(again.body.id).toBe(first.body.id);
        expect(await t.prisma.booking.count()).toBe(1);
      });

      it('refuses the same key with a different request', async () => {
        await book(newBooking(), 'retry-key-0002').expect(201);
        const res = await book(newBooking({ preferWomenRated: false }), 'retry-key-0002').expect(409);
        expect(res.body.error.code).toBe('CONFLICT');
      });

      it('creates one booking when the same request arrives twice at once', async () => {
        const [a, b] = await Promise.all([book(newBooking(), 'race-key-0001'), book(newBooking(), 'race-key-0001')]);
        expect([a.status, b.status]).toEqual([201, 201]);
        expect(a.body.id).toBe(b.body.id);
        expect(await t.prisma.booking.count()).toBe(1);
      });

      it('is required and must look like an id', async () => {
        const missing = await auth(api().post('/v1/bookings')).send(newBooking()).expect(422);
        expect(missing.body.error.fields).toEqual({ 'Idempotency-Key': 'REQUIRED' });
        const bad = await book(newBooking(), 'x').expect(422);
        expect(bad.body.error.fields).toEqual({ 'Idempotency-Key': 'INVALID' });
      });

      it('is per customer: another customer may use the same key', async () => {
        await book(newBooking(), 'shared-key-0001').expect(201);
        const ravi = (await signIn(t, '9876500022')).accessToken;
        const raviAddress = (await auth(api().post('/v1/addresses'), ravi).send(HOME).expect(201)).body.id;
        await book(newBooking({ addressId: raviAddress }), 'shared-key-0001', ravi).expect(201);
      });
    });

    describe('validation (README §5)', () => {
      const fieldsOf = async (body: object) => (await book(body).expect(422)).body.error.fields;

      it('needs some description of the problem', async () => {
        expect(await fieldsOf(newBooking({ problem: { issueIds: [], notes: '  ', voiceNote: null, photos: [] } }))).toEqual({ problem: 'INVALID' });
      });

      it('accepts only issues of the chosen service', async () => {
        expect(await fieldsOf(newBooking({ problem: { issueIds: ['fan-dead'], notes: '', voiceNote: null, photos: [] } }))).toEqual({ 'problem.issueIds': 'INVALID' });
      });

      it("refuses photo and audio ids that are not the customer's uploads (test/uploads.e2e-spec.ts has the rest)", async () => {
        await book(newBooking({ problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [{ id: 'ph_1' }] } })).expect(404);
        await book(newBooking({ problem: { issueIds: [], notes: '', voiceNote: { durationSec: 5, transcript: '', audioId: randomUUID() }, photos: [] } })).expect(404);
      });

      it('needs an existing service and one of your own addresses', async () => {
        expect(await fieldsOf(newBooking({ serviceId: 'garden-hose' }))).toEqual({ serviceId: 'INVALID' });
        const ravi = (await signIn(t, '9876500022')).accessToken;
        const raviAddress = (await auth(api().post('/v1/addresses'), ravi).send(HOME).expect(201)).body.id;
        expect(await fieldsOf(newBooking({ addressId: raviAddress }))).toEqual({ addressId: 'INVALID' });
      });

      it('checks the shape of scheduled windows and voice notes', async () => {
        expect(await fieldsOf(newBooking({ time: { mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 9, endHour: 11 } } }))).toEqual({ 'time.window.startHour': 'INVALID' });
        expect(await fieldsOf(newBooking({ problem: { issueIds: [], notes: '', voiceNote: { durationSec: 61, transcript: 'x' }, photos: [] } }))).toEqual({ 'problem.voiceNote.durationSec': 'INVALID' });
      });
    });

    describe('time', () => {
      it('offers instant visits only from 07:00 to 21:00 IST', async () => {
        t.clock.t = Date.UTC(2026, 9, 16, 15, 30); // 21:00 IST
        token = (await signIn(t, '9876500033')).accessToken;
        addressId = (await auth(api().post('/v1/addresses')).send(HOME).expect(201)).body.id;
        expect((await book().expect(409)).body.error.code).toBe('INSTANT_UNAVAILABLE');
        t.clock.t = Date.UTC(2026, 9, 17, 1, 30); // 07:00 IST next day
        token = (await signIn(t, '9876500044')).accessToken;
        addressId = (await auth(api().post('/v1/addresses')).send(HOME).expect(201)).body.id;
        await book().expect(201);
      });

      it('books an open window and refuses a closed one', async () => {
        const res = await book(newBooking({ time: TOMORROW_10 })).expect(201);
        expect(res.body.time).toEqual(TOMORROW_10);
        const closed = await book(newBooking({ time: { mode: 'SCHEDULED', window: { date: '2026-10-16', startHour: 12, endHour: 14 } } })).expect(409);
        expect(closed.body.error.code).toBe('SLOT_UNAVAILABLE');
      });

      it('fills a window at the area capacity and frees it on cancel', async () => {
        await t.prisma.slotCapacity.create({ data: { categoryId: 'PLUMBING', pincode: '500034', maxPerWindow: 1 } });
        const first = await book(newBooking({ time: TOMORROW_10 })).expect(201);
        expect((await book(newBooking({ time: TOMORROW_10 })).expect(409)).body.error.code).toBe('SLOT_UNAVAILABLE');
        const slots = await auth(api().get('/v1/slots?serviceId=plumb-tap&date=2026-10-17&pincode=500034')).expect(200);
        expect(slots.body.find((s: { startHour: number }) => s.startHour === 10).state).toBe('FULL');
        await auth(api().post(`/v1/bookings/${first.body.id}/cancel`)).send({ reason: 'PLANS_CHANGED' }).expect(200);
        await book(newBooking({ time: TOMORROW_10 })).expect(201);
      });

      it('never overbooks the last place when requests arrive together', async () => {
        await t.prisma.slotCapacity.create({ data: { categoryId: 'PLUMBING', pincode: '500034', maxPerWindow: 1 } });
        const results = await Promise.all([1, 2, 3].map(() => book(newBooking({ time: TOMORROW_10 }))));
        expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
        expect(await t.prisma.booking.count()).toBe(1);
      });
    });
  });

  describe('GET /v1/bookings', () => {
    it("shows only the caller's bookings, newest first, by scope", async () => {
      const a = (await book().expect(201)).body;
      t.clock.advance(MIN);
      const b = (await book().expect(201)).body;
      await auth(api().post(`/v1/bookings/${a.id}/cancel`)).send({}).expect(200);
      const ids = async (scope: string) => (await auth(api().get(`/v1/bookings?scope=${scope}`)).expect(200)).body.map((x: { id: string }) => x.id);
      expect(await ids('all')).toEqual([b.id, a.id]);
      expect(await ids('active')).toEqual([b.id]);
      expect(await ids('past')).toEqual([a.id]);
      const ravi = (await signIn(t, '9876500022')).accessToken;
      expect((await auth(api().get('/v1/bookings'), ravi).expect(200)).body).toEqual([]);
      await auth(api().get(`/v1/bookings/${a.id}`), ravi).expect(404);
      await auth(api().get('/v1/bookings/not-a-uuid')).expect(404);
    });

    it('is for customers only', async () => {
      await api().get('/v1/bookings').expect(401);
      const tech = (await signIn(t, '9876500011', 'TECHNICIAN')).accessToken;
      await auth(api().get('/v1/bookings'), tech).expect(404);
    });

    it('shows the arrival code once the visit fee is paid', async () => {
      const { body } = await book().expect(201);
      await force(body.id, 'MATCHING');
      const res = await auth(api().get(`/v1/bookings/${body.id}`)).expect(200);
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id: body.id } });
      expect(res.body.arrivalOtp).toBe(await t.app.get(FieldCipher).decrypt('bookings.arrival_code', row.arrivalCodeEnc));
      expect(res.body.visitPayment).toMatchObject({ state: 'PAID', method: 'UPI', txnId: expect.stringMatching(/^pay_/), at: NOON_IST });
    });
  });

  describe('POST /v1/bookings/{id}/cancel', () => {
    it('cancels an unpaid booking without a refund, and is safe to retry', async () => {
      const { body } = await book().expect(201);
      t.clock.advance(MIN);
      const res = await auth(api().post(`/v1/bookings/${body.id}/cancel`)).send({ reason: 'PLANS_CHANGED' }).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'PLANS_CHANGED', visitPayment: { state: 'DUE' } });
      expect(res.body.history).toEqual([{ status: 'AWAITING_PAYMENT', at: NOON_IST }, { status: 'CANCELLED', at: NOON_IST + MIN }]);
      const again = await auth(api().post(`/v1/bookings/${body.id}/cancel`)).send({ reason: 'OTHER' }).expect(200);
      expect(again.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'PLANS_CHANGED' });
      expect(again.body.history).toHaveLength(2);
    });

    it('refunds the visit fee before the technician travels', async () => {
      for (const status of ['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED'] as const) {
        const { body } = await book().expect(201);
        await force(body.id, status);
        const res = await auth(api().post(`/v1/bookings/${body.id}/cancel`)).send({ reason: null }).expect(200);
        expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: null, arrivalOtp: '', visitPayment: { state: 'REFUNDED' } });
        const pay = await t.prisma.payment.findFirstOrThrow({ where: { bookingId: body.id } });
        expect(pay.refundRequestedAt).not.toBeNull();
      }
    });

    it('does not refund once the technician is on the way, and refuses at the door', async () => {
      const enRoute = (await book().expect(201)).body;
      await force(enRoute.id, 'EN_ROUTE');
      const res = await auth(api().post(`/v1/bookings/${enRoute.id}/cancel`)).send({}).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', visitPayment: { state: 'PAID' } });
      const arrived = (await book().expect(201)).body;
      await force(arrived.id, 'ARRIVED');
      expect((await auth(api().post(`/v1/bookings/${arrived.id}/cancel`)).send({}).expect(409)).body.error.code).toBe('CONFLICT');
    });

    it("validates the reason and hides other people's bookings", async () => {
      const { body } = await book().expect(201);
      await auth(api().post(`/v1/bookings/${body.id}/cancel`)).send({ reason: 'BORED' }).expect(422);
      const ravi = (await signIn(t, '9876500022')).accessToken;
      await auth(api().post(`/v1/bookings/${body.id}/cancel`), ravi).send({}).expect(404);
    });
  });

  describe('POST /v1/bookings/{id}/reschedule', () => {
    it('moves a delayed, unfulfilled or assigned booking back to matching at the new time', async () => {
      const tech = await createTechnician(t);
      for (const status of ['MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED'] as const) {
        const { body } = await book().expect(201);
        await force(body.id, status);
        await t.prisma.booking.update({ where: { id: body.id }, data: { technicianId: status === 'ASSIGNED' ? tech.id : null } });
        const time = { mode: 'SCHEDULED', window: { date: '2026-10-18', startHour: 14, endHour: 16 } };
        const res = await auth(api().post(`/v1/bookings/${body.id}/reschedule`)).send({ time }).expect(200);
        expect(res.body).toMatchObject({ status: 'MATCHING', time });
        expect(res.body.history.at(-1)).toEqual({ status: 'MATCHING', at: NOON_IST });
        expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: body.id } })).technicianId).toBeNull();
      }
    });

    it('refuses other statuses and full windows (leaving the booking as it was)', async () => {
      const unpaid = (await book().expect(201)).body;
      await auth(api().post(`/v1/bookings/${unpaid.id}/reschedule`)).send({ time: TOMORROW_10 }).expect(409);
      await t.prisma.slotCapacity.create({ data: { categoryId: 'PLUMBING', pincode: '500034', maxPerWindow: 0 } });
      const delayed = (await book().expect(201)).body;
      await force(delayed.id, 'MATCHING_DELAYED');
      expect((await auth(api().post(`/v1/bookings/${delayed.id}/reschedule`)).send({ time: TOMORROW_10 }).expect(409)).body.error.code).toBe('SLOT_UNAVAILABLE');
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: delayed.id } })).status).toBe('MATCHING_DELAYED');
    });
  });

  describe('unpaid bookings expire after 30 minutes', () => {
    it('cancels them (system reason hidden from the app) and releases the window', async () => {
      await t.prisma.slotCapacity.create({ data: { categoryId: 'PLUMBING', pincode: '500034', maxPerWindow: 1 } });
      const { body } = await book(newBooking({ time: TOMORROW_10 })).expect(201);
      const service = t.app.get(BookingsService);
      t.clock.advance(29 * MIN);
      expect(await service.expireUnpaid()).toBe(0);
      t.clock.advance(MIN);
      expect(await service.expireUnpaid()).toBe(1);
      token = (await signIn(t)).accessToken; // the 15-minute access token has expired by now
      const res = await auth(api().get(`/v1/bookings/${body.id}`)).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: null });
      expect(res.body.history.at(-1)).toEqual({ status: 'CANCELLED', at: NOON_IST + 30 * MIN });
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id: body.id }, include: { events: true } });
      expect(row.cancelReason).toBe('UNPAID_EXPIRED');
      expect(row.events.at(-1)).toMatchObject({ actorType: 'SYSTEM', actorId: null });
      await book(newBooking({ time: TOMORROW_10 })).expect(201);
    });

    it('never shows an overdue unpaid booking as active, even before the sweep runs', async () => {
      const { body } = await book().expect(201);
      t.clock.advance(31 * MIN);
      token = (await signIn(t)).accessToken; // the morning token has expired
      expect((await auth(api().get('/v1/bookings?scope=active')).expect(200)).body).toEqual([]);
      expect((await auth(api().get(`/v1/bookings/${body.id}`)).expect(200)).body.status).toBe('CANCELLED');
      expect((await auth(api().post(`/v1/bookings/${body.id}/cancel`)).send({}).expect(200)).body.status).toBe('CANCELLED');
    });
  });

  describe('GET /v1/bookings/{id}/stream', () => {
    let port: number;

    beforeAll(async () => {
      await t.app.listen(0, '127.0.0.1');
      port = (t.app.getHttpServer().address() as AddressInfo).port;
    });

    /** Minimal SSE client: collects `booking` events. */
    function openStream(id: string, as: string) {
      const events: { status: string }[] = [];
      const waiters: (() => void)[] = [];
      let statusCode = 0;
      let buffer = '';
      const req = http.get({ host: '127.0.0.1', port, path: `/v1/bookings/${id}/stream`, headers: { Authorization: `Bearer ${as}` } }, (res) => {
        statusCode = res.statusCode ?? 0;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let at: number;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const data = block.split('\n').find((l) => l.startsWith('data: '));
            if (block.includes('event: booking') && data) {
              events.push(JSON.parse(data.slice(6)));
              waiters.splice(0).forEach((w) => w());
            }
          }
        });
      });
      const waitFor = (n: number) =>
        new Promise<void>((resolve, reject) => {
          const check = () => (events.length >= n ? resolve() : waiters.push(check));
          setTimeout(() => reject(new Error(`timed out waiting for event ${n}`)), 5000);
          check();
        });
      return { events, waitFor, status: () => statusCode, close: () => req.destroy() };
    }

    it('sends the booking at once and again after every change', async () => {
      const { body } = await book().expect(201);
      const stream = openStream(body.id, token);
      try {
        await stream.waitFor(1);
        expect(stream.status()).toBe(200);
        expect(stream.events[0]).toMatchObject({ id: body.id, status: 'AWAITING_PAYMENT' });
        await auth(api().post(`/v1/bookings/${body.id}/cancel`)).send({ reason: 'FIXED' }).expect(200);
        await stream.waitFor(2);
        expect(stream.events[1]).toMatchObject({ status: 'CANCELLED', cancelReason: 'FIXED' });
      } finally {
        stream.close();
      }
    });

    it("refuses other people's bookings with the normal error", async () => {
      const { body } = await book().expect(201);
      const ravi = (await signIn(t, '9876500022')).accessToken;
      const res = await auth(api().get(`/v1/bookings/${body.id}/stream`), ravi).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('deleting the account', () => {
    it('cancels unpaid bookings and anonymises them', async () => {
      const { body } = await book().expect(201);
      await auth(api().delete('/v1/me')).expect(204);
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id: body.id } });
      expect(row).toMatchObject({ status: 'CANCELLED', notes: '', voiceTranscript: null, locality: '' });
      expect(row.addressSnapshotEnc).toHaveLength(0);
    });

    it('is refused while a booking is in progress', async () => {
      const { body } = await book().expect(201);
      await force(body.id, 'MATCHING');
      expect((await auth(api().delete('/v1/me')).expect(409)).body.error.code).toBe('CONFLICT');
      await auth(api().get('/v1/me')).expect(200);
    });
  });
});
