// The model-backed AI (AI_PROVIDER=anthropic, SPEECH_TO_TEXT_PROVIDER=sarvam) against fake Claude and Sarvam APIs:
// what is sent (only the caller's own facts and files), what is accepted back (catalog ids only), and the fallback to
// the rules whenever a model fails or declines.
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { seedParts } from '../src/modules/parts/parts.service';
import { ANTHROPIC_CLIENT } from '../src/modules/ai/claude';
import { SARVAM_FETCH, SARVAM_STT_URL } from '../src/modules/ai/sarvam';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';
import { jpegWithGps, m4a } from './media-fixtures';

const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };

interface Sent {
  readonly url: string;
  readonly headers: Headers;
  // The request as sent (parsed JSON).
  readonly body: ReturnType<typeof JSON.parse>;
}

/** Answers Messages API calls from a queue: an object becomes the JSON answer, a number an HTTP error. */
class FakeClaude {
  readonly sent: Sent[] = [];
  readonly replies: (object | number | 'refusal')[] = [];

  readonly fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    this.sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const next = this.replies.shift() ?? 500;
    if (typeof next === 'number') return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: next, headers: { 'content-type': 'application/json' } });
    const refusal = next === 'refusal';
    return new Response(
      JSON.stringify({
        id: `msg_${this.sent.length}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: refusal ? [] : [{ type: 'text', text: JSON.stringify(next) }],
        stop_reason: refusal ? 'refusal' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

describe('AI with models (e2e)', () => {
  let t: TestApp;
  const claude = new FakeClaude();
  const sarvam: { calls: { url: string; headers: Headers; form: FormData }[]; reply: object | number } = { calls: [], reply: { transcript: 'నీళ్లు కారుతున్నాయి' } };
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  let bookingId: string;
  let code: string;

  async function uploaded(kind: 'photos' | 'audio', bytes: Buffer, contentType: string, token = customer): Promise<string> {
    const { id } = (await api().post(`/v1/uploads/${kind}`).set(as(token)).send({ contentType, bytes: bytes.length }).expect(200)).body;
    t.store.upload(id, bytes, contentType);
    return id;
  }

  beforeAll(async () => {
    requireTestDatabase();
    const client = new Anthropic({ apiKey: 'sk-ant-test', fetch: claude.fetch, maxRetries: 0 });
    const sarvamFetch = async (url: string | URL | Request, init?: RequestInit) => {
      sarvam.calls.push({ url: String(url), headers: new Headers(init?.headers), form: init?.body as FormData });
      return typeof sarvam.reply === 'number' ? new Response('{}', { status: sarvam.reply }) : new Response(JSON.stringify(sarvam.reply), { status: 200 });
    };
    t = await buildTestApp({
      env: { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', SPEECH_TO_TEXT_PROVIDER: 'sarvam', SARVAM_API_KEY: 'sarvam-test' },
      overrides: [
        [ANTHROPIC_CLIENT, client],
        [SARVAM_FETCH, sarvamFetch],
      ],
    });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    await seedParts(t.prisma);
    t.rateLimits.clear();
    claude.sent.length = 0;
    claude.replies.length = 0;
    sarvam.calls.length = 0;
    sarvam.reply = { transcript: 'నీళ్లు కారుతున్నాయి' };
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

    it("answers with the model, given only the caller's booking facts, and remembers nothing it shouldn't", async () => {
      const tech = await createTechnician(t);
      await t.prisma.booking.update({ where: { id: bookingId }, data: { status: 'EN_ROUTE', technicianId: tech.id, etaMin: 7 } });
      claude.replies.push({ text: 'Swathi is about 7 minutes away.', suggestions: ['Cancel my booking', 'x'.repeat(200), '', 'a', 'b'], offerHuman: false });
      const res = (await chat({ message: 'how far is she', locale: 'en' }).expect(200)).body;
      expect(res).toMatchObject({ text: 'Swathi is about 7 minutes away.', offerHuman: false, conversationId: expect.any(String) });
      expect(res.suggestions).toHaveLength(3);
      expect(res.suggestions[1].length).toBeLessThanOrEqual(60);

      const call = claude.sent[0]!;
      expect(call.url).toContain('/v1/messages');
      expect(call.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
      expect(call.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low', format: { type: 'json_schema' } } });
      expect(call.body.tools).toBeUndefined();
      const prompt = JSON.stringify(call.body.messages);
      expect(prompt).toContain(code);
      expect(prompt).toContain('Swathi');
      // Nothing that identifies the customer or the technician beyond the first name.
      for (const secret of ['9876543210', 'Lake View', 'Road No. 12', 'Naidu', '9876500011']) expect(prompt).not.toContain(secret);
    });

    it('falls back to the rules when the model fails or declines, and never asks it about danger', async () => {
      claude.replies.push(503);
      const failed = (await chat({ message: 'how much does it cost', locale: 'en' }).expect(200)).body;
      expect(failed.text).toContain('The visit fee is ₹49');
      // Cancelling never reaches the model: the rules ask for the reason (no model reply is used up).
      expect((await chat({ message: 'cancel', locale: 'en' }).expect(200)).body.text).toContain(`Why do you want to cancel ${code}`);

      claude.replies.push('refusal');
      const declined = (await chat({ message: 'what does it cost', locale: 'en' }).expect(200)).body;
      expect(declined.text).toContain('The visit fee is ₹49');

      const before = claude.sent.length;
      const danger = (await chat({ message: 'sparks are coming from the switch', locale: 'en' }).expect(200)).body;
      expect(danger).toMatchObject({ offerHuman: true });
      expect(danger.text).toContain('112');
      expect(claude.sent.length).toBe(before);
    });

    it('offers a person whenever one is asked for, even when the model does not', async () => {
      claude.replies.push({ text: 'I can help with that.', suggestions: [], offerHuman: false });
      expect((await chat({ message: 'I want to talk to a person', locale: 'en' }).expect(200)).body.offerHuman).toBe(true);
    });
  });

  describe('photo', () => {
    it('accepts only catalog services, and only when the model is sure', async () => {
      const photoId = await uploaded('photos', jpegWithGps(), 'image/jpeg');
      claude.replies.push({ serviceId: 'plumb-tap', confidence: 0.92, alternatives: ['plumb-block', 'plumb-tap'] });
      const sure = (await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body;
      expect(sure).toMatchObject({ serviceId: 'plumb-tap', confidence: 0.92 });
      expect(sure.alternatives[0]).toBe('plumb-block');
      expect(sure.alternatives).not.toContain('plumb-tap');
      expect(sure.alternatives.length).toBeLessThanOrEqual(4);

      const call = claude.sent[0]!;
      const [image, catalog] = call.body.messages[0].content;
      expect(image).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
      // The photo sent is the stored one, its location already removed.
      expect(Buffer.from(image.source.data, 'base64').equals(Buffer.from(t.store.stored(photoId)!))).toBe(true);
      expect(catalog.text).toContain('plumb-tap');
      expect(call.body.output_config.format.schema.properties.serviceId).toBeDefined();

      claude.replies.push({ serviceId: 'elec-fan', confidence: 0.3, alternatives: [] });
      const unsure = (await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body;
      expect(unsure).toMatchObject({ serviceId: null, confidence: 0 });
      expect(unsure.alternatives[0]).toBe('elec-fan');

      // An answer outside the catalog is not trusted.
      claude.replies.push({ serviceId: 'not-a-service', confidence: 0.99, alternatives: [] });
      expect((await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body).toMatchObject({ serviceId: null, confidence: 0 });

      claude.replies.push(500);
      expect((await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body).toMatchObject({ serviceId: null, confidence: 0 });
    });

    it("never sends someone else's photo", async () => {
      const other = (await signIn(t, '9876543211')).accessToken;
      const photoId = await uploaded('photos', jpegWithGps(), 'image/jpeg', other);
      await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(404);
      expect(claude.sent).toHaveLength(0);
    });
  });

  describe('quote checker', () => {
    it('reads a photographed quote into lines (known ids only), then compares with fixed rules', async () => {
      const photoId = await uploaded('photos', jpegWithGps(), 'image/jpeg');
      const cartridge = (await t.prisma.part.findFirstOrThrow({ where: { nameEn: 'Tap cartridge' } })).id;
      claude.replies.push({
        readable: true,
        serviceId: 'plumb-tap',
        lines: [
          { name: 'Labour', kind: 'LABOUR', qty: 1, amount: 600, partId: null },
          { name: 'Cartridge', kind: 'MATERIAL', qty: 1, amount: 450, partId: cartridge },
        ],
      });
      const read = (await api().post('/v1/ai/read-quote').set(as(customer)).send({ photoId }).expect(200)).body;
      expect(read).toEqual({
        readable: true,
        serviceId: 'plumb-tap',
        lines: [
          { name: 'Labour', kind: 'LABOUR', qty: 1, amount: 600, partId: null },
          { name: 'Cartridge', kind: 'MATERIAL', qty: 1, amount: 450, partId: cartridge },
        ],
      });
      const [image, text] = claude.sent[0]!.body.messages[0].content;
      expect(Buffer.from(image.source.data, 'base64').equals(Buffer.from(t.store.stored(photoId)!))).toBe(true);
      expect(text.text).toContain('Tap cartridge');
      // The model is given names, never Housefi's prices.
      expect(text.text).not.toMatch(/25000|"price/);

      // ₹1,050 for a tap repair (usually ₹198–₹645): high, ₹405 more than usual; the cartridge ₹200 over the price list.
      const check = (await api().post('/v1/ai/check-quote').set(as(customer)).send({ serviceId: read.serviceId, lines: read.lines }).expect(200)).body;
      expect(check).toEqual({
        serviceId: 'plumb-tap', total: 1050, usualMin: 198, usualMax: 645, visitFee: 49, verdict: 'HIGH', over: 405,
        lines: [
          { name: 'Labour', kind: 'LABOUR', qty: 1, amount: 600, partId: null, listPrice: null, overList: 0 },
          { name: 'Cartridge', kind: 'MATERIAL', qty: 1, amount: 450, partId: cartridge, listPrice: 250, overList: 200 },
        ],
      });

      // A failure or a non-quote photo: the customer types the lines instead.
      claude.replies.push(500);
      expect((await api().post('/v1/ai/read-quote').set(as(customer)).send({ photoId }).expect(200)).body).toEqual({ readable: false, serviceId: null, lines: [] });
      claude.replies.push({ readable: false, serviceId: null, lines: [] });
      expect((await api().post('/v1/ai/read-quote').set(as(customer)).send({ photoId }).expect(200)).body.readable).toBe(false);
    });

    it("never reads someone else's photo, and checks input strictly", async () => {
      const other = (await signIn(t, '9876543211')).accessToken;
      const photoId = await uploaded('photos', jpegWithGps(), 'image/jpeg', other);
      await api().post('/v1/ai/read-quote').set(as(customer)).send({ photoId }).expect(404);
      expect(claude.sent).toHaveLength(0);
      const ok = { name: 'Labour', kind: 'LABOUR', qty: 1, amount: 300 };
      await api().post('/v1/ai/check-quote').set(as(customer)).send({ serviceId: 'not-a-service', lines: [ok] }).expect(422);
      await api().post('/v1/ai/check-quote').set(as(customer)).send({ serviceId: 'plumb-tap', lines: [] }).expect(422);
      await api().post('/v1/ai/check-quote').set(as(customer)).send({ serviceId: 'plumb-tap', lines: [{ ...ok, amount: -5 }] }).expect(422);
      await api().post('/v1/ai/check-quote').set(as(customer)).send({ serviceId: 'plumb-tap', lines: Array(21).fill(ok) }).expect(422);
      const tech = await createTechnician(t);
      await api().post('/v1/ai/check-quote').set(as(tech.token)).send({ serviceId: 'plumb-tap', lines: [ok] }).expect(404);
      await api().post('/v1/ai/check-quote').send({ serviceId: 'plumb-tap', lines: [ok] }).expect(401);
    });
  });

  describe('voice notes', () => {
    it('transcribes Telugu with Sarvam; long notes and failures keep only the audio', async () => {
      const audioId = await uploaded('audio', m4a(6), 'audio/m4a');
      expect((await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId, locale: 'te' }).expect(200)).body).toEqual({ text: 'నీళ్లు కారుతున్నాయి' });
      const call = sarvam.calls[0]!;
      expect(call.url).toBe(SARVAM_STT_URL);
      expect(call.headers.get('api-subscription-key')).toBe('sarvam-test');
      expect(call.form.get('language_code')).toBe('te-IN');
      expect(call.form.get('model')).toBe('saaras:v4');
      expect(call.form.get('file')).toBeInstanceOf(Blob);
      // Sarvam refuses "audio/m4a" (what phones send) and takes the same file as "audio/x-m4a".
      expect((call.form.get('file') as Blob).type).toBe('audio/x-m4a');

      const long = await uploaded('audio', m4a(45), 'audio/m4a');
      expect((await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId: long, locale: 'en' }).expect(200)).body).toEqual({ text: '' });
      expect(sarvam.calls).toHaveLength(1);

      sarvam.reply = 429;
      expect((await api().post('/v1/ai/transcribe').set(as(customer)).send({ audioId, locale: 'en' }).expect(200)).body).toEqual({ text: '' });
    });
  });
});
