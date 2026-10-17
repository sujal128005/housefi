// The rule-based AI endpoints: top problems near a PIN, photo and voice stand-ins, and the support chat.
// The test clock starts at 2026-10-16 12:00 IST.
import type { Booking, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { FALLBACK_PROBLEMS } from '../src/modules/ai/top-problems';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const DAY = 24 * 60 * 60_000;
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };

describe('AI endpoints (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let base: Booking;
  let n = 0;

  /** A copy of the customer's booking with other facts (another service, PIN, age, status). */
  async function booking(over: Partial<Prisma.BookingUncheckedCreateInput>): Promise<void> {
    const { id: _id, code: _code, version: _v, ...rest } = base;
    await t.prisma.booking.create({
      data: { ...rest, code: `HF-${90000 + ++n}`, idempotencyKey: randomUUID(), status: 'COMPLETED', ...over } as Prisma.BookingUncheckedCreateInput,
    });
  }

  const top = async (query = '', token = customer) => (await api().get(`/v1/ai/top-problems${query}`).set(as(token)).expect(200)).body;

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
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    const id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
    base = await t.prisma.booking.findUniqueOrThrow({ where: { id } }); // AWAITING_PAYMENT: does not count
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('GET /v1/ai/top-problems', () => {
    it('ranks the last 7 days in the PIN and its neighbours, then city-wide, then the usual list; always 6', async () => {
      await t.prisma.serviceAreaPincode.create({ data: { pincode: '500034', nearPincode: '500033' } });
      const now = new Date(t.clock.now());
      for (let i = 0; i < 3; i++) await booking({ createdAt: new Date(t.clock.now() - i * DAY) }); // tap-leak in 500034
      await booking({ serviceId: 'elec-fan', categoryId: 'ELECTRICAL', issueIds: ['fan-dead', 'fan-slow'], pincode: '500033', createdAt: now });
      await booking({ serviceId: 'elec-fan', categoryId: 'ELECTRICAL', issueIds: ['fan-dead'], pincode: '500033', createdAt: now, status: 'MATCHING' });
      await booking({ serviceId: 'ac-service', categoryId: 'AC', issueIds: ['acs-cool'], createdAt: new Date(t.clock.now() - 8 * DAY) }); // too old
      await booking({ serviceId: 'ac-service', categoryId: 'AC', issueIds: ['acs-cool'], status: 'CANCELLED', cancelReason: 'UNPAID_EXPIRED', createdAt: now }); // never paid
      for (let i = 0; i < 4; i++) await booking({ serviceId: 'app-washer', categoryId: 'APPLIANCE', issueIds: ['wm-drain'], pincode: '500001', createdAt: now }); // elsewhere in the city
      await booking({ serviceId: 'plumb-block', categoryId: 'PLUMBING', issueIds: ['blk-sink'], pincode: '560001', city: 'Bengaluru', createdAt: now }); // another city

      const res = await top('?pincode=500034');
      expect(res).toEqual({
        area: `${base.locality}, Hyderabad`,
        items: [
          { serviceId: 'plumb-tap', issueId: 'tap-leak', recentCount: 3 },
          { serviceId: 'elec-fan', issueId: 'fan-dead', recentCount: 2 },
          { serviceId: 'elec-fan', issueId: 'fan-slow', recentCount: 1 },
          { serviceId: 'app-washer', issueId: 'wm-drain', recentCount: 4 },
          { serviceId: 'ac-service', issueId: 'acs-cool', recentCount: 0 },
          { serviceId: 'plumb-block', issueId: 'blk-sink', recentCount: 0 },
        ],
      });
      expect(base.locality).not.toBe('');

      // No PIN: everything, everywhere; no area.
      const all = await top();
      expect(all.area).toBeNull();
      expect(all.items.slice(0, 3)).toEqual([
        { serviceId: 'app-washer', issueId: 'wm-drain', recentCount: 4 },
        { serviceId: 'plumb-tap', issueId: 'tap-leak', recentCount: 3 },
        { serviceId: 'elec-fan', issueId: 'fan-dead', recentCount: 2 },
      ]);
      expect(all.items).toHaveLength(6);
    });

    it('with no bookings yet: the usual list, recentCount 0; a PIN we never served has no area', async () => {
      expect(await top()).toEqual({ area: null, items: FALLBACK_PROBLEMS.map((p) => ({ ...p, recentCount: 0 })) });
      expect(await top('?pincode=110001')).toEqual({ area: null, items: FALLBACK_PROBLEMS.map((p) => ({ ...p, recentCount: 0 })) });
    });

    it('validates the PIN and is for customers only', async () => {
      await api().get('/v1/ai/top-problems?pincode=50003').set(as(customer)).expect(422);
      await api().get('/v1/ai/top-problems?pincode=abc123').set(as(customer)).expect(422);
      await api().get('/v1/ai/top-problems').expect(401);
      const tech = await createTechnician(t);
      await api().get('/v1/ai/top-problems').set(as(tech.token)).expect(404);
    });
  });

  describe('photo and voice (no models yet)', () => {
    it('classify-photo does not guess: it offers the most booked services', async () => {
      for (let i = 0; i < 2; i++) await booking({ serviceId: 'app-washer', categoryId: 'APPLIANCE', issueIds: ['wm-drain'], createdAt: new Date(t.clock.now()) });
      const res = await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId: 'ph_123' }).expect(200);
      expect(res.body).toEqual({ serviceId: null, confidence: 0, alternatives: ['app-washer', 'plumb-tap', 'elec-fan', 'ac-service'] });
      await api().post('/v1/ai/classify-photo').set(as(customer)).send({}).expect(422);
    });

    it('transcribe returns no text until speech-to-text is chosen', async () => {
      expect((await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId: 'au_1', serviceId: 'plumb-tap', locale: 'te' }).expect(200)).body).toEqual({ text: '' });
      expect((await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId: 'au_1', serviceId: null, locale: 'en' }).expect(200)).body).toEqual({ text: '' });
      await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId: 'au_1', serviceId: 'no-such-service', locale: 'en' }).expect(422);
      await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId: 'au_1', locale: 'hi' }).expect(422);
    });
  });

  describe('POST /v1/ai/chat', () => {
    const chat = (body: object, token = customer) => api().post('/v1/ai/chat').set(as(token)).send(body);

    it("answers from the caller's own active booking, and starts or keeps a conversation id", async () => {
      const tech = await createTechnician(t);
      await t.prisma.booking.update({ where: { id: base.id }, data: { status: 'EN_ROUTE', technicianId: tech.id, etaMin: 7 } });
      const first = (await chat({ message: 'Where is my technician?', locale: 'en' }).expect(200)).body;
      expect(first).toEqual({
        text: 'Swathi is on the way and should reach you in about 7 min.',
        suggestions: ['Cancel my booking', 'Talk to a person'],
        offerHuman: false,
        conversationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      const next = (await chat({ message: 'cancel', locale: 'en', conversationId: first.conversationId }).expect(200)).body;
      expect(next).toMatchObject({ conversationId: first.conversationId, offerHuman: false });
      expect(next.text).toContain(`cancelling ${base.code} now keeps the ₹49`);

      // Someone else asking sees nothing of this booking.
      const other = (await signIn(t, '9876543211')).accessToken;
      expect((await chat({ message: 'Where is my technician?', locale: 'te' }, other).expect(200)).body.text).toBe('మీకు ఇప్పుడు యాక్టివ్ బుకింగ్ లేదు.');
    });

    it('understands Telugu and hands danger to a person', async () => {
      const res = (await chat({ message: 'స్విచ్ నుండి నిప్పు వస్తోంది', locale: 'te' }).expect(200)).body;
      expect(res).toMatchObject({ offerHuman: true, suggestions: [] });
      expect(res.text).toContain('112');
    });

    it('validates the message', async () => {
      await chat({ message: '', locale: 'en' }).expect(422);
      await chat({ message: 'x'.repeat(1001), locale: 'en' }).expect(422);
      await chat({ message: 'hi', locale: 'fr' }).expect(422);
      await api().post('/v1/ai/chat').send({ message: 'hi', locale: 'en' }).expect(401);
    });
  });
});
