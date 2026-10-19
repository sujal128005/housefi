// The chat and photo reader on Cloudflare Workers AI (AI_PROVIDER=cloudflare) against a fake Workers AI: what is sent
// (only the caller's own facts and files), what is accepted back (catalog ids only, the fixed answer shape), and the
// fallback to the rules whenever the model fails, answers off-format or the message sounds dangerous.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CLOUDFLARE_AI_FETCH, CLOUDFLARE_AI_URL } from '../src/modules/ai/cloudflare';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';
import { jpegWithGps } from './media-fixtures';

const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const ACCOUNT = 'f'.repeat(32);

interface Sent {
  readonly url: string;
  readonly headers: Headers;
  readonly body: ReturnType<typeof JSON.parse>;
}

/** Answers Workers AI calls from a queue: an object or string becomes result.response, a number an HTTP error. */
class FakeWorkersAi {
  readonly sent: Sent[] = [];
  readonly replies: (object | string | number)[] = [];

  readonly fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    this.sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const next = this.replies.shift() ?? 500;
    if (typeof next === 'number') return new Response(JSON.stringify({ success: false, errors: [{ code: 3000, message: 'boom' }], result: null }), { status: next });
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { response: next } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('AI on Cloudflare Workers AI (e2e)', () => {
  let t: TestApp;
  const cf = new FakeWorkersAi();
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let bookingId: string;
  let code: string;

  async function uploadedPhoto(token = customer): Promise<string> {
    const bytes = jpegWithGps();
    const { id } = (await api().post('/v1/uploads/photos').set(as(token)).send({ contentType: 'image/jpeg', bytes: bytes.length }).expect(200)).body;
    t.store.upload(id, bytes, 'image/jpeg');
    return id;
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({
      env: { AI_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_AI_TOKEN: 'cf-test-token' },
      overrides: [[CLOUDFLARE_AI_FETCH, cf.fetch]],
    });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    cf.sent.length = 0;
    cf.replies.length = 0;
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    const res = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body;
    bookingId = res.id;
    code = res.code;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('chat', () => {
    const chat = (body: object, token = customer) => api().post('/v1/ai/chat').set(as(token)).send(body);

    it("answers with the model, given only the caller's booking facts", async () => {
      const tech = await createTechnician(t);
      await t.prisma.booking.update({ where: { id: bookingId }, data: { status: 'EN_ROUTE', technicianId: tech.id, etaMin: 7 } });
      cf.replies.push({ text: 'Swathi is about 7 minutes away.', suggestions: ['Cancel my booking', 'x'.repeat(200), '', 'a', 'b'], offerHuman: false });
      const res = (await chat({ message: 'how far is she', locale: 'en' }).expect(200)).body;
      expect(res).toMatchObject({ text: 'Swathi is about 7 minutes away.', offerHuman: false, conversationId: expect.any(String) });
      expect(res.suggestions).toHaveLength(3);
      expect(res.suggestions[1].length).toBeLessThanOrEqual(60);

      const call = cf.sent[0]!;
      expect(call.url).toBe(`${CLOUDFLARE_AI_URL}/${ACCOUNT}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`);
      expect(call.headers.get('authorization')).toBe('Bearer cf-test-token');
      expect(call.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { type: 'object' } });
      expect(call.body.tools).toBeUndefined();
      const prompt = JSON.stringify(call.body.messages);
      expect(prompt).toContain(code);
      expect(prompt).toContain('Swathi');
      // Nothing that identifies the customer or the technician beyond the first name.
      for (const secret of ['9876543210', 'Lake View', 'Road No. 12', 'Naidu', '9876500011']) expect(prompt).not.toContain(secret);
    });

    it('reads JSON wrapped in text or a code fence', async () => {
      cf.replies.push('Here you go:\n```json\n{"text":"The visit fee is ₹49.","suggestions":[],"offerHuman":false}\n```');
      expect((await chat({ message: 'what does the visit cost', locale: 'en' }).expect(200)).body.text).toBe('The visit fee is ₹49.');
    });

    it('falls back to the rules when the model fails or answers off-format, and never asks it about danger', async () => {
      cf.replies.push(503);
      expect((await chat({ message: 'cancel', locale: 'en' }).expect(200)).body.text).toContain(`You can cancel ${code} in the booking`);

      cf.replies.push('I cannot answer in JSON, sorry.');
      expect((await chat({ message: 'what does it cost', locale: 'en' }).expect(200)).body.text).toContain('The visit fee is ₹49');

      cf.replies.push({ answer: 'wrong shape' });
      expect((await chat({ message: 'what does it cost', locale: 'en' }).expect(200)).body.text).toContain('The visit fee is ₹49');

      const before = cf.sent.length;
      const danger = (await chat({ message: 'sparks are coming from the switch', locale: 'en' }).expect(200)).body;
      expect(danger).toMatchObject({ offerHuman: true });
      expect(danger.text).toContain('112');
      expect(cf.sent.length).toBe(before);
    });

    it('offers a person whenever one is asked for, even when the model does not', async () => {
      cf.replies.push({ text: 'I can help with that.', suggestions: [], offerHuman: false });
      expect((await chat({ message: 'I want to talk to a person', locale: 'en' }).expect(200)).body.offerHuman).toBe(true);
    });
  });

  describe('photo', () => {
    it('sends the stored photo and accepts only catalog services, and only when the model is sure', async () => {
      const photoId = await uploadedPhoto();
      cf.replies.push({ serviceId: 'plumb-tap', confidence: 0.92, alternatives: ['plumb-block', 'plumb-tap'] });
      const sure = (await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body;
      expect(sure).toMatchObject({ serviceId: 'plumb-tap', confidence: 0.92 });
      expect(sure.alternatives[0]).toBe('plumb-block');
      expect(sure.alternatives).not.toContain('plumb-tap');

      const call = cf.sent[0]!;
      expect(call.url).toBe(`${CLOUDFLARE_AI_URL}/${ACCOUNT}/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct`);
      const [image, catalog] = call.body.messages[1].content;
      expect(image.type).toBe('image_url');
      // The photo sent is the stored one, its location already removed.
      const sentBytes = Buffer.from(image.image_url.url.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
      expect(sentBytes.equals(Buffer.from(t.store.stored(photoId)!))).toBe(true);
      expect(catalog.text).toContain('plumb-tap');
      expect(call.body.guided_json.properties.serviceId).toBeDefined();

      cf.replies.push({ serviceId: 'elec-fan', confidence: 0.3, alternatives: [] });
      const unsure = (await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body;
      expect(unsure).toMatchObject({ serviceId: null, confidence: 0 });
      expect(unsure.alternatives[0]).toBe('elec-fan');

      // An answer outside the catalog is not trusted.
      cf.replies.push({ serviceId: 'not-a-service', confidence: 0.99, alternatives: ['also-not-real'] });
      const outside = (await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body;
      expect(outside).toMatchObject({ serviceId: null, confidence: 0 });
      expect(outside.alternatives).not.toContain('not-a-service');
      expect(outside.alternatives).not.toContain('also-not-real');

      cf.replies.push(500);
      expect((await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body).toMatchObject({ serviceId: null, confidence: 0 });
    });

    it("never sends someone else's photo", async () => {
      const other = (await signIn(t, '9876543211')).accessToken;
      const photoId = await uploadedPhoto(other);
      await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(404);
      expect(cf.sent).toHaveLength(0);
    });
  });
});
