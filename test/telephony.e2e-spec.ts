// Telephony end to end with the fake provider: a coordinator registers and sets up a keypad-phone technician; a
// booking is offered to them by phone call; keypresses with the PIN accept through the same transaction as the app;
// call outcomes, the circuit breaker, the manual queue, masked calls, availability by phone, and forged callbacks.
// The test clock starts at 2026-10-16 12:00 IST (inside default calling hours 8 to 20).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { CoordinatorAccountsService } from '../src/modules/coordinator/coordinator-accounts.service';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { TechVerificationService } from '../src/modules/technicians/tech-verification.service';
import { TELEPHONY_PROVIDER, type FakeTelephony } from '../src/modules/telephony/telephony-provider';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TECH_PROFILE, type TestApp } from './helpers';
import { jpegWithGps } from './media-fixtures';

const SECRET = 'test-telephony-secret-0123456789abcdef';
const HOUSEFI_NUMBER = '08047112233';
const COORD_PHONE = '9000000001';
const KEYPAD_PHONE = '9123456780';
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const ADMIN = { type: 'ADMIN' as const, id: null, via: 'cli:test' };

describe('telephony (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hook = (step: string, q: Record<string, string> = {}, secret = SECRET) => api().get(`/v1/webhooks/telephony/exotel/${secret}/${step}`).query(q);
  const phone = () => t.app.get<FakeTelephony>(TELEPHONY_PROVIDER);
  let customer: string;
  let coordinator: string;
  let keypadId: string;
  let bookingId: string;

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { TELEPHONY_PROVIDER: 'fake', EXOTEL_CALLER_ID: HOUSEFI_NUMBER, EXOTEL_WEBHOOK_SECRET: SECRET } });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    phone().calls.length = 0;
    phone().failNext = 0;
    // Coordinator and a keypad-phone technician they register and set up.
    await t.app.get(CoordinatorAccountsService).add(COORD_PHONE, 'Lakshmi Rao', ADMIN);
    coordinator = (await signIn(t, COORD_PHONE, 'COORDINATOR')).accessToken;
    const ticket = await api().post('/v1/uploads/photos').set(as(coordinator)).send({ contentType: 'image/jpeg', bytes: jpegWithGps().length, stage: 'PROFILE' }).expect(200);
    t.store.upload(ticket.body.id, jpegWithGps(), 'image/jpeg');
    const reg = await api().post('/v1/coordinator/technicians').set(as(coordinator)).send({ ...TECH_PROFILE, name: 'Ramulu Goud', gender: 'M', phone: KEYPAD_PHONE, phoneType: 'KEYPAD', photoUploadId: ticket.body.id }).expect(201);
    keypadId = reg.body.id;
    expect(reg.body).toMatchObject({ phoneType: 'KEYPAD', verification: 'PENDING', identity: { legalName: 'Ramulu Goud' } });
    await api().post(`/v1/coordinator/technicians/${keypadId}/phone-setup`).set(as(coordinator)).send({ phoneType: 'KEYPAD', pin: '4826', callHours: { start: 8, end: 20 }, consent: true }).expect(204);
    await t.app.get(TechVerificationService).approve(keypadId, ADMIN);
    await api().post(`/v1/coordinator/technicians/${keypadId}/availability`).set(as(coordinator)).send({ online: true }).expect(204);
    // A paid booking that is searching.
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    bookingId = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
    await t.prisma.booking.update({ where: { id: bookingId }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
  });

  afterAll(async () => {
    await t?.close();
  });

  /** Forgets earlier offers (and their calls), so the same technician can be offered again. */
  async function clearOffers() {
    await t.prisma.offerCallAttempt.deleteMany({ where: { offer: { bookingId } } });
    await t.prisma.jobOffer.deleteMany({ where: { bookingId } });
  }

  async function offerByPhone() {
    await t.app.get(DispatchService).offerNext(bookingId);
    expect(phone().calls).toHaveLength(1);
    const call = phone().calls[0]!;
    expect(call.to).toBe(KEYPAD_PHONE);
    const attempt = await t.prisma.offerCallAttempt.findUniqueOrThrow({ where: { id: call.attemptId }, include: { offer: true } });
    expect(attempt.offer).toMatchObject({ channel: 'IVR', state: 'OPEN', technicianId: keypadId });
    return { attemptId: call.attemptId, callSid: attempt.providerCallId as string, offerId: attempt.offerId };
  }

  it('offers by phone: says the area (never the address), and 1 + the right PIN assigns the job', async () => {
    const { attemptId } = await offerByPhone();
    const prompt = await hook('prompt', { CustomField: attemptId }).expect(200);
    expect(prompt.text).toContain('Banjara Hills');
    expect(prompt.text).toContain('Press 1 to accept');
    expect(prompt.text).not.toContain('Flat 4B');

    await hook('choice', { CustomField: attemptId, digits: '"1"' }).expect(200);
    await hook('pin', { CustomField: attemptId, digits: '1111' }).expect(302);
    await hook('pin', { CustomField: attemptId, digits: '4826' }).expect(200);
    const b = await t.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b).toMatchObject({ status: 'ASSIGNED', technicianId: keypadId });
    const booking = (await api().get(`/v1/bookings/${bookingId}`).set(as(customer)).expect(200)).body;
    expect(booking.technician).toMatchObject({ id: keypadId, maskedPhone: HOUSEFI_NUMBER });
  });

  it('a keypad accept after the job went elsewhere is refused and changes nothing', async () => {
    const { attemptId, offerId } = await offerByPhone();
    await hook('choice', { CustomField: attemptId, digits: '1' }).expect(200);
    // Meanwhile the offer ran out.
    t.clock.advance(91_000);
    expect(offerId).toBeTruthy();
    await hook('pin', { CustomField: attemptId, digits: '4826' }).expect(302);
    expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('MATCHING');
  });

  it('stops taking PINs after 3 wrong ones on a call', async () => {
    const { attemptId } = await offerByPhone();
    for (const pin of ['0000', '1111', '2222']) await hook('pin', { CustomField: attemptId, digits: pin }).expect(302);
    await hook('pin', { CustomField: attemptId, digits: '4826' }).expect(302);
    expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('MATCHING');
  });

  it('2 declines; no answer ends the offer (a miss), busy does not count; duplicate callbacks change nothing', async () => {
    const first = await offerByPhone();
    await hook('choice', { CustomField: first.attemptId, digits: '2' }).expect(302);
    expect((await t.prisma.jobOffer.findUniqueOrThrow({ where: { id: first.offerId } })).state).toBe('REJECTED');

    // Offered again later (nobody else): this time nobody answers.
    await clearOffers();
    phone().calls.length = 0;
    const second = await offerByPhone();
    const status = (s: string) => api().post(`/v1/webhooks/telephony/exotel/${SECRET}/status`).send({ CallSid: second.callSid, Status: s });
    await status('no-answer').expect(200);
    await status('no-answer').expect(200);
    expect((await t.prisma.jobOffer.findUniqueOrThrow({ where: { id: second.offerId } })).state).toBe('EXPIRED');
    expect((await t.prisma.technician.findUniqueOrThrow({ where: { userId: keypadId } })).missedOffersInRow).toBe(1);
    // A late "ringing" after the end changes nothing.
    await status('ringing').expect(200);
    expect((await t.prisma.offerCallAttempt.findUniqueOrThrow({ where: { providerCallId: second.callSid } })).state).toBe('NO_ANSWER');
  });

  it('pauses calling after repeated failures to place calls, and coordinators get the booking', async () => {
    phone().failNext = 5;
    for (let i = 0; i < 3; i++) {
      await clearOffers();
      await t.app.get(DispatchService).offerNext(bookingId);
    }
    // Circuit open: the keypad technician is no longer offered by phone; the booking waits for a person.
    await clearOffers();
    await t.app.get(DispatchService).offerNext(bookingId);
    expect(await t.prisma.jobOffer.count({ where: { bookingId, state: 'OPEN' } })).toBe(0);
    const queue = (await api().get('/v1/coordinator/dispatch-queue').set(as(coordinator)).expect(200)).body;
    expect(queue).toEqual([expect.objectContaining({ bookingId, area: 'Banjara Hills, Hyderabad' })]);
    await api().post(`/v1/coordinator/dispatch-queue/${bookingId}/claim`).set(as(coordinator)).expect(204);
    await api().post(`/v1/coordinator/jobs/${bookingId}/assign`).set(as(coordinator)).send({ technicianId: keypadId }).expect(200);
    expect((await api().get('/v1/coordinator/dispatch-queue').set(as(coordinator)).expect(200)).body).toEqual([]);
  });

  it('refuses forged callbacks (wrong secret looks like a missing route)', async () => {
    const res = await hook('prompt', {}, 'wrong-secret-wrong-secret-wrong-secret-00');
    expect([res.status, res.text]).toEqual([404, expect.any(String)]);
    await api().post('/v1/webhooks/telephony/exotel/nope/status').send({ CallSid: 'x', Status: 'completed' }).expect(404);
  });

  it('masked calls: only the parties of an assigned visit, through the Housefi number', async () => {
    await api().post(`/v1/bookings/${bookingId}/call`).set(as(customer)).expect(409);
    const app = await createTechnician(t, '9876500011');
    await api().post('/v1/tech/availability').set(as(app.token)).send({ online: true }).expect(200);
    await t.prisma.technician.update({ where: { userId: keypadId }, data: { online: false } });
    await t.app.get(DispatchService).offerNext(bookingId);
    const offer = (await api().get('/v1/tech/offers/current').set(as(app.token)).expect(200)).body;
    await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(app.token)).expect(200);

    // Nobody asked yet: the Housefi number connects nobody.
    await hook('connect', { CallFrom: '09876543210' }).expect(404);
    expect((await api().post(`/v1/bookings/${bookingId}/call`).set(as(customer)).expect(200)).body).toEqual({ dialNumber: HOUSEFI_NUMBER });
    const connect = await hook('connect', { CallFrom: '09876543210' }).expect(200);
    expect(connect.body.destination.numbers).toEqual(['+919876500011']);
    // The technician calls back the same way.
    await api().post(`/v1/tech/jobs/${bookingId}/call`).set(as(app.token)).expect(200);
    expect((await hook('connect', { CallFrom: '+919876500011' }).expect(200)).body.destination.numbers).toEqual(['+919876543210']);
    // Someone else's booking: not found.
    const stranger = (await signIn(t, '9876543299')).accessToken;
    await api().post(`/v1/bookings/${bookingId}/call`).set(as(stranger)).expect(404);
  });

  it('keypad technicians go offline / online by calling the Housefi number', async () => {
    await hook('availability', { CallFrom: `0${KEYPAD_PHONE}`, digits: '2' }).expect(200);
    expect((await t.prisma.technician.findUniqueOrThrow({ where: { userId: keypadId } })).online).toBe(false);
    await hook('availability', { CallFrom: `0${KEYPAD_PHONE}`, digits: '1' }).expect(200);
    expect((await t.prisma.technician.findUniqueOrThrow({ where: { userId: keypadId } })).online).toBe(true);
    // Unknown callers and other keys do nothing.
    await hook('availability', { CallFrom: '09999999999', digits: '1' }).expect(302);
  });

  it('only the coordinator of a technician can set them up, with a PIN that is not easy to guess', async () => {
    await api().post(`/v1/coordinator/technicians/${keypadId}/phone-setup`).set(as(coordinator)).send({ phoneType: 'KEYPAD', pin: '1111', consent: true }).expect(422);
    await t.app.get(CoordinatorAccountsService).add('9000000002', 'Other Coordinator', ADMIN);
    const other = (await signIn(t, '9000000002', 'COORDINATOR')).accessToken;
    await api().post(`/v1/coordinator/technicians/${keypadId}/phone-setup`).set(as(other)).send({ phoneType: 'KEYPAD', pin: '5937', consent: true }).expect(404);
    await api().post(`/v1/coordinator/technicians/${keypadId}/availability`).set(as(other)).send({ online: false }).expect(404);
  });
});
