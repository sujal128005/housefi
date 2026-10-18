// Notifications end to end: who gets which notice as a visit goes on, the inbox, devices, and push delivery.
// The test clock starts at 2026-10-16 12:00 IST.
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { TechVerificationService } from '../src/modules/technicians/tech-verification.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type SignedIn, TEST_SECRETS, type TestApp } from './helpers';

const MIN = 60_000;
const TECH_PHONE = '9876500011';
const CUSTOMER_TOKEN = 'ExponentPushToken[customer-phone]';
const TECH_TOKEN = 'ExponentPushToken[tech-phone]';
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const QUOTE = { which: 'MAIN', diagnosis: 'Worn-out washer and a loose joint under the sink.', lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 120 }, { kind: 'MATERIAL', name: 'Washer and sealant', qty: 1, unitPrice: 200 }] };
const EXTRA = { which: 'EXTRA', diagnosis: 'The tap body is cracked and should be replaced.', lines: [{ kind: 'MATERIAL', name: 'New tap (ISI)', qty: 1, unitPrice: 340 }] };

describe('notifications (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const deliver = () => t.app.get(NotificationsService).deliverPending();
  let customer: SignedIn;
  let tech: { id: string; token: string };
  let id: string;
  let code: string;

  const act = (action: string, body: object = {}) => api().post(`/v1/tech/jobs/${id}/${action}`).set(as(tech.token)).send(body);
  const answer = (which: 'MAIN' | 'EXTRA', a: string) => api().post(`/v1/bookings/${id}/quotes/${which}/answer`).set(as(customer.accessToken)).send({ answer: a });
  const inbox = async (token: string) => (await api().get('/v1/notifications').set(as(token)).expect(200)).body as { id: string; kind: string; bookingId: string | null; params: Record<string, unknown>; at: number; read: boolean }[];
  const kinds = async (token: string) => (await inbox(token)).map((n) => n.kind);
  const register = (token: string, pushToken: string, platform = 'android') => api().post('/v1/devices').set(as(token)).send({ pushToken, platform });

  /** Booking paid, offered and accepted: the technician is assigned. */
  async function assignedJob() {
    customer = await signIn(t, '9876543210');
    const addressId = (await api().post('/v1/addresses').set(as(customer.accessToken)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    const created = (await api().post('/v1/bookings').set(as(customer.accessToken)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body;
    id = created.id;
    code = created.code;
    tech = await createTechnician(t, TECH_PHONE);
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
    await assignedJob();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('who hears what', () => {
    it('a whole visit paid online: the customer follows each step, the technician hears the answers and the payment', async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      await answer('MAIN', 'APPROVE').expect(200);
      await act('start-work').expect(200);
      await act('quotes', EXTRA).expect(200);
      await answer('EXTRA', 'APPROVE').expect(200);
      await act('complete').expect(200);
      const order = (await api().post(`/v1/bookings/${id}/payments`).set(as(customer.accessToken)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'UPI' }).expect(200)).body;
      const rp = t.razorpay.pay(order.orderId);
      const signature = createHmac('sha256', TEST_SECRETS.RAZORPAY_KEY_SECRET).update(`${order.orderId}|${rp.id}`).digest('hex');
      await api().post(`/v1/payments/${order.paymentId}/verify`).set(as(customer.accessToken)).send({ razorpayOrderId: order.orderId, razorpayPaymentId: rp.id, razorpaySignature: signature }).expect(200);

      const mine = await inbox(customer.accessToken);
      expect(mine.map((n) => n.kind)).toEqual(['BOOKING_COMPLETED', 'PAYMENT_DUE', 'EXTRA_QUOTE', 'QUOTE_READY', 'TECH_ARRIVED', 'TECH_ON_THE_WAY', 'TECH_ASSIGNED']);
      expect(mine.find((n) => n.kind === 'QUOTE_READY')).toEqual({ id: expect.any(String), kind: 'QUOTE_READY', bookingId: id, params: { code, amount: 320, version: 1 }, at: t.clock.now(), read: false });
      expect(mine.find((n) => n.kind === 'EXTRA_QUOTE')?.params).toEqual({ code, amount: 340 });
      expect(mine.find((n) => n.kind === 'PAYMENT_DUE')?.params).toEqual({ code, amount: 660 });
      expect(mine.find((n) => n.kind === 'TECH_ON_THE_WAY')?.params).toEqual({ code, etaMin: 1 });

      const theirs = await inbox(tech.token);
      expect(theirs.map((n) => n.kind)).toEqual(['PAYMENT_RECEIVED', 'EXTRA_APPROVED', 'QUOTE_APPROVED', 'JOB_OFFER', 'PROFILE_APPROVED']);
      expect(theirs[0]?.params).toEqual({ code, amount: 660, method: 'UPI' });
      expect(theirs.find((n) => n.kind === 'JOB_OFFER')).toMatchObject({ bookingId: id, params: { code, serviceId: 'plumb-tap', earning: 30, offerId: expect.any(String), expiresAt: t.clock.now() + 45_000 } });
      expect(theirs.at(-1)).toMatchObject({ kind: 'PROFILE_APPROVED', bookingId: null, params: {} });
    });

    it("the technician's own confirmation of cash does not notify them", async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      await answer('MAIN', 'APPROVE').expect(200);
      await act('start-work').expect(200);
      await act('complete').expect(200);
      await api().post(`/v1/bookings/${id}/payments`).set(as(customer.accessToken)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'CASH' }).expect(200);
      await act('confirm-cash').expect(200);
      expect((await kinds(customer.accessToken))[0]).toBe('BOOKING_COMPLETED');
      expect((await kinds(tech.token))[0]).toBe('QUOTE_APPROVED');
    });

    it('revision asked, then the quote declined', async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      await answer('MAIN', 'REVISION').expect(200);
      await act('quotes', { ...QUOTE, lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 100 }] }).expect(200);
      await answer('MAIN', 'DECLINE').expect(200);
      expect((await kinds(tech.token)).slice(0, 2)).toEqual(['QUOTE_DECLINED', 'QUOTE_REVISION']);
      const quotes = (await inbox(customer.accessToken)).filter((n) => n.kind === 'QUOTE_READY');
      expect(quotes.map((n) => n.params)).toEqual([{ code, amount: 100, version: 2 }, { code, amount: 320, version: 1 }]);
    });

    it('a declined extra', async () => {
      await atTheDoor();
      await act('quotes', QUOTE).expect(200);
      await answer('MAIN', 'APPROVE').expect(200);
      await act('start-work').expect(200);
      await act('quotes', EXTRA).expect(200);
      await answer('EXTRA', 'DECLINE').expect(200);
      expect((await kinds(tech.token))[0]).toBe('EXTRA_DECLINED');
    });

    it('the customer cancels: the technician is told, the customer is not told about their own action', async () => {
      await act('start-trip').expect(200);
      await api().post(`/v1/bookings/${id}/cancel`).set(as(customer.accessToken)).send({ reason: 'PLANS_CHANGED' }).expect(200);
      expect((await inbox(tech.token))[0]).toMatchObject({ kind: 'JOB_CANCELLED', bookingId: id, params: { code, reason: 'BOOKING_CANCELLED' } });
      expect(await kinds(customer.accessToken)).not.toContain('BOOKING_CANCELLED');
    });

    it('the customer reschedules: the technician who was assigned is told', async () => {
      const tomorrow10 = { mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 10, endHour: 12 } };
      await api().post(`/v1/bookings/${id}/reschedule`).set(as(customer.accessToken)).send({ time: tomorrow10 }).expect(200);
      expect((await inbox(tech.token))[0]).toMatchObject({ kind: 'JOB_CANCELLED', params: { code, reason: 'RESCHEDULED' } });
    });

    it('nobody found: NO_TECHNICIAN; an unpaid booking that expires: BOOKING_CANCELLED', async () => {
      await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING_DELAYED', technicianId: null, matchingStartedAt: new Date(t.clock.now() - 31 * MIN) } });
      await t.app.get(DispatchService).escalate();
      expect((await kinds(customer.accessToken))[0]).toBe('NO_TECHNICIAN');

      const addressId = (await api().get('/v1/addresses').set(as(customer.accessToken)).expect(200)).body[0].id;
      const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
      const unpaid = (await api().post('/v1/bookings').set(as(customer.accessToken)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body;
      t.clock.advance(30 * MIN);
      expect(await t.app.get(BookingsService).expireUnpaid()).toBe(1);
      customer = await signIn(t, '9876543210');
      expect((await inbox(customer.accessToken))[0]).toMatchObject({ kind: 'BOOKING_CANCELLED', bookingId: unpaid.id, params: { code: unpaid.code, reason: 'UNPAID_EXPIRED' } });
    });

    it('profile sent back for correction', async () => {
      const other = await createTechnician(t, '9876500022', { approve: false });
      await t.app.get(TechVerificationService).requestCorrection(other.id, { en: 'Upload a clearer photo' }, { type: 'ADMIN', id: null, via: 'test' });
      expect(await inbox(other.token)).toEqual([expect.objectContaining({ kind: 'PROFILE_NEEDS_CORRECTION', bookingId: null, params: {} })]);
    });
  });

  describe('the inbox', () => {
    it('marks only your own notifications read, ignoring anything else', async () => {
      const [first, second] = await inbox(customer.accessToken);
      expect(first?.kind).toBe('TECH_ASSIGNED');
      expect(second).toBeUndefined();
      const techIds = (await inbox(tech.token)).map((n) => n.id);
      await api().post('/v1/notifications/read').set(as(customer.accessToken)).send({ ids: [first!.id, ...techIds, 'not-an-id', randomUUID()] }).expect(204);
      expect((await inbox(customer.accessToken))[0]?.read).toBe(true);
      expect((await inbox(tech.token)).every((n) => !n.read)).toBe(true);
      await api().post('/v1/notifications/read').set(as(customer.accessToken)).send({ ids: [] }).expect(204);
      await api().post('/v1/notifications/read').set(as(customer.accessToken)).send({}).expect(422);
      await api().get('/v1/notifications').expect(401);
    });

    it('account deletion removes the inbox and devices', async () => {
      await register(customer.accessToken, CUSTOMER_TOKEN).expect(204);
      await api().post(`/v1/bookings/${id}/cancel`).set(as(customer.accessToken)).send({}).expect(200);
      await api().delete('/v1/me').set(as(customer.accessToken)).expect(204);
      expect(await t.prisma.notification.count({ where: { userId: customer.customer!.id } })).toBe(0);
      expect(await t.prisma.device.count()).toBe(0);
    });
  });

  describe('push', () => {
    it('sends to registered devices in the account language; job offers go high priority until they expire', async () => {
      await t.prisma.notification.updateMany({ data: { pushState: 'SKIPPED' } }); // what happened before the phones registered
      await register(customer.accessToken, CUSTOMER_TOKEN, 'ios').expect(204);
      await register(tech.token, TECH_TOKEN).expect(204);
      await api().patch('/v1/me').set(as(customer.accessToken)).send({ locale: 'te' }).expect(200);
      await act('start-trip').expect(200);
      expect(await deliver()).toEqual({ sent: 1, skipped: 0, failed: 0, retry: 0 });
      expect(t.push.sent).toEqual([
        {
          to: CUSTOMER_TOKEN,
          title: 'టెక్నీషియన్ బయలుదేరారు',
          body: `${code} కోసం సుమారు 1 నిమిషాల్లో చేరుకుంటారు.`,
          data: { notificationId: expect.any(String), kind: 'TECH_ON_THE_WAY', bookingId: id, params: { code, etaMin: 1 } },
          priority: 'default',
          sound: 'default',
          channelId: 'default',
        },
      ]);
      expect(await t.prisma.notification.findFirst({ where: { kind: 'TECH_ON_THE_WAY' } })).toMatchObject({ pushState: 'SENT', pushedAt: new Date(t.clock.now()), pushAttempts: 1 });
      expect(await deliver()).toEqual({ sent: 0, skipped: 0, failed: 0, retry: 0 });

      // A new offer to the technician (another booking), delivered 10 s later.
      await t.prisma.notification.create({ data: { userId: tech.id, kind: 'JOB_OFFER', bookingId: id, params: { code, earning: 30 }, createdAt: new Date(t.clock.now()) } });
      t.clock.advance(10_000);
      t.push.reset();
      await deliver();
      expect(t.push.sent[0]).toMatchObject({ to: TECH_TOKEN, title: 'New job nearby', priority: 'high', sound: 'default', channelId: 'job-offers', ttl: 35 });
    });

    it('stops when the session that registered the phone ends (logout)', async () => {
      await register(customer.accessToken, CUSTOMER_TOKEN).expect(204);
      await deliver();
      expect(t.push.sent.map((m) => m.data.kind)).toEqual(['TECH_ASSIGNED']);
      await api().post('/v1/auth/logout').set(as(customer.accessToken)).send({ refreshToken: customer.refreshToken }).expect(204);
      t.push.reset();
      await act('start-trip').expect(200);
      expect(await deliver()).toMatchObject({ sent: 0, skipped: 1 });
      expect(t.push.sent).toEqual([]);
      expect((await t.prisma.notification.findFirstOrThrow({ where: { kind: 'TECH_ON_THE_WAY' } })).pushState).toBe('SKIPPED');
    });

    it('a phone moves to whoever registers it last', async () => {
      await register(customer.accessToken, CUSTOMER_TOKEN).expect(204);
      await register(tech.token, CUSTOMER_TOKEN).expect(204);
      expect(await t.prisma.device.findMany({ select: { userId: true } })).toEqual([{ userId: tech.id }]);
      await deliver(); // the customer's TECH_ASSIGNED has no phone any more; the technician's notices go to it
      expect(t.push.sent.map((m) => [m.to, m.data.kind]).sort()).toEqual([[CUSTOMER_TOKEN, 'JOB_OFFER'], [CUSTOMER_TOKEN, 'PROFILE_APPROVED']]);
    });

    it('skips pushes that are too old to help (an expired offer, anything after an hour)', async () => {
      await register(tech.token, TECH_TOKEN).expect(204);
      await register(customer.accessToken, CUSTOMER_TOKEN).expect(204);
      t.clock.advance(46_000);
      const r = await deliver();
      expect(t.push.sent.map((m) => m.data.kind).sort()).toEqual(['PROFILE_APPROVED', 'TECH_ASSIGNED']);
      expect(r).toEqual({ sent: 2, skipped: 1, failed: 0, retry: 0 }); // the offer expired 1 s ago
      await t.prisma.notification.create({ data: { userId: customer.customer!.id, kind: 'BOOKING_COMPLETED', bookingId: id, params: { code }, createdAt: new Date(t.clock.now() - 61 * MIN) } });
      expect(await deliver()).toEqual({ sent: 0, skipped: 1, failed: 0, retry: 0 });
    });

    it('retries while the push service is down, then gives up after 3 attempts; forgets phones that are gone', async () => {
      await t.prisma.notification.updateMany({ data: { pushState: 'SKIPPED' } });
      await register(customer.accessToken, CUSTOMER_TOKEN).expect(204);
      await act('start-trip').expect(200);
      t.push.unavailable = true;
      expect(await deliver()).toEqual({ sent: 0, skipped: 0, failed: 0, retry: 1 });
      expect(await deliver()).toEqual({ sent: 0, skipped: 0, failed: 0, retry: 1 });
      expect(await deliver()).toEqual({ sent: 0, skipped: 0, failed: 1, retry: 0 });
      expect(await t.prisma.notification.findFirstOrThrow({ where: { kind: 'TECH_ON_THE_WAY' } })).toMatchObject({ pushState: 'FAILED', pushAttempts: 3 });

      t.push.unavailable = false;
      t.push.goneTokens.add(CUSTOMER_TOKEN);
      await act('arrived').expect(200);
      expect(await deliver()).toEqual({ sent: 0, skipped: 0, failed: 1, retry: 0 });
      expect(await t.prisma.device.count()).toBe(0);
    });

    it('validates the device', async () => {
      await register(customer.accessToken, CUSTOMER_TOKEN, 'windows').expect(422);
      await register(customer.accessToken, '').expect(422);
      await api().post('/v1/devices').send({ pushToken: CUSTOMER_TOKEN, platform: 'ios' }).expect(401);
      // A token that is not an Expo token is stored but never sent through Expo.
      await register(customer.accessToken, 'fcm-raw-token', 'web').expect(204);
      expect(await deliver()).toMatchObject({ sent: 0 });
    });
  });
});
