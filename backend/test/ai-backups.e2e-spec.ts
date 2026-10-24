// The free AI backups (AI_BACKUPS): when Cloudflare fails, hangs or answers off-format, Groq answers, then Ollama and
// Cerebras (chat only); a model that just failed waits at the back of the line; with nothing left the rules answer. Fake
// services only: nothing reaches Cloudflare, Groq, Ollama or Cerebras.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CEREBRAS_URL, CLOUDFLARE_AI_FETCH, GROQ_URL, OLLAMA_URL } from '../src/modules/ai/open-models';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { buildTestApp, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';
import { jpegWithGps } from './media-fixtures';

const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const ACCOUNT = '0123456789abcdef0123456789abcdef';
type Reply = object | number | 'hang';
type Service = 'cloudflare' | 'groq' | 'ollama' | 'cerebras';

/** One fake per service: an object becomes the model's JSON answer, a number an HTTP error, 'hang' never answers. */
class FakeModels {
  readonly sent: { service: Service; body: ReturnType<typeof JSON.parse>; auth: string | null }[] = [];
  readonly replies: Record<Service, Reply[]> = { cloudflare: [], groq: [], ollama: [], cerebras: [] };

  reset(): void {
    this.sent.length = 0;
    for (const k of Object.keys(this.replies) as Service[]) this.replies[k].length = 0;
  }

  asked(): Service[] {
    return this.sent.map((s) => s.service);
  }

  readonly fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const service: Service = u === GROQ_URL ? 'groq' : u === OLLAMA_URL ? 'ollama' : u === CEREBRAS_URL ? 'cerebras' : 'cloudflare';
    this.sent.push({ service, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
    const next = this.replies[service].shift() ?? 500;
    if (next === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))));
    }
    if (typeof next === 'number') return new Response('{"error":"boom"}', { status: next });
    const body = service === 'cloudflare'
      ? { success: true, errors: [], messages: [], result: { response: next } }
      : { choices: [{ message: { role: 'assistant', content: JSON.stringify(next) } }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('free AI backups (e2e)', () => {
  let t: TestApp;
  const models = new FakeModels();
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: string;
  const chat = (message = 'when will my technician come?') => api().post('/v1/ai/chat').set(as(customer)).send({ message, locale: 'en' });
  const answer = (text: string) => ({ text, suggestions: [], offerHuman: false });

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({
      env: {
        AI_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_AI_TOKEN: 'cf-test-token',
        AI_BACKUPS: 'groq, ollama, cerebras', GROQ_API_KEY: 'gsk-test', OLLAMA_API_KEY: 'ollama-test', CEREBRAS_API_KEY: 'csk-test',
        AI_ATTEMPT_TIMEOUT_MS: '1000', AI_TIMEOUT_MS: '6000', AI_COOLDOWN_MS: '60000',
      },
      overrides: [[CLOUDFLARE_AI_FETCH, models.fetch]],
    });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    models.reset();
    // A fresh start for every test: no model is waiting at the back of the line.
    t.clock.advance(10 * 60_000);
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('asks Groq when Cloudflare fails, and skips Cloudflare for a minute after', async () => {
    models.replies.cloudflare.push(500);
    models.replies.groq.push(answer('From Groq.'));
    expect((await chat().expect(200)).body.text).toBe('From Groq.');
    expect(models.asked()).toEqual(['cloudflare', 'groq']);
    const groq = models.sent[1]!;
    expect(groq.auth).toBe('Bearer gsk-test');
    expect(groq.body).toMatchObject({ model: 'llama-3.3-70b-versatile', response_format: { type: 'json_object' } });
    for (const secret of ['9876543210', 'Lake View', 'Road No. 12']) expect(JSON.stringify(groq.body)).not.toContain(secret);

    // Cloudflare just failed: Groq first now, so nobody waits on Cloudflare again.
    models.sent.length = 0;
    models.replies.groq.push(answer('Groq again.'));
    expect((await chat().expect(200)).body.text).toBe('Groq again.');
    expect(models.asked()).toEqual(['groq']);

    // A minute later Cloudflare is first again.
    t.clock.advance(61_000);
    models.sent.length = 0;
    models.replies.cloudflare.push(answer('Cloudflare is back.'));
    expect((await chat().expect(200)).body.text).toBe('Cloudflare is back.');
    expect(models.asked()).toEqual(['cloudflare']);
  });

  it('moves on from a hanging or off-format answer, then to Ollama and Cerebras, and to the rules last', async () => {
    models.replies.cloudflare.push('hang');
    models.replies.groq.push({ wrong: 'shape' });
    models.replies.ollama.push(answer('From Ollama.'));
    const started = Date.now();
    expect((await chat().expect(200)).body.text).toBe('From Ollama.');
    expect(Date.now() - started).toBeLessThan(4000);
    expect(models.asked()).toEqual(['cloudflare', 'groq', 'ollama']);
    expect(models.sent[2]).toMatchObject({ auth: 'Bearer ollama-test', body: { model: 'gpt-oss:120b', response_format: { type: 'json_object' } } });

    // Ollama busy too: Cerebras answers.
    t.clock.advance(61_000);
    models.sent.length = 0;
    models.replies.cloudflare.push(500);
    models.replies.groq.push(500);
    models.replies.ollama.push(503);
    models.replies.cerebras.push(answer('From Cerebras.'));
    expect((await chat().expect(200)).body.text).toBe('From Cerebras.');
    expect(models.asked()).toEqual(['cloudflare', 'groq', 'ollama', 'cerebras']);
    expect(models.sent[3]).toMatchObject({ auth: 'Bearer csk-test', body: { model: 'gpt-oss-120b' } });

    // Every model fails: the rules answer, right away for the next customer too.
    t.clock.advance(61_000);
    models.sent.length = 0;
    models.replies.cloudflare.push(503);
    models.replies.groq.push(429);
    models.replies.ollama.push(500);
    models.replies.cerebras.push(500);
    const ruled = (await chat().expect(200)).body;
    expect(ruled.text).toEqual(expect.any(String));
    expect(ruled.text.length).toBeGreaterThan(0);
    expect(models.asked()).toEqual(['cloudflare', 'groq', 'ollama', 'cerebras']);
  });

  it('reads photos with Groq when Cloudflare fails; Ollama (without a vision model) and Cerebras are never sent a photo', async () => {
    const bytes = jpegWithGps();
    const { id: photoId } = (await api().post('/v1/uploads/photos').set(as(customer)).send({ contentType: 'image/jpeg', bytes: bytes.length }).expect(200)).body;
    t.store.upload(photoId, bytes, 'image/jpeg');
    models.replies.cloudflare.push(500);
    models.replies.groq.push({ serviceId: 'plumb-tap', confidence: 0.9, alternatives: [] });
    expect((await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body).toMatchObject({ serviceId: 'plumb-tap', confidence: 0.9 });
    expect(models.asked()).toEqual(['cloudflare', 'groq']);
    expect(models.sent[1]!.body.model).toBe('qwen/qwen3.8-27b');
    expect(JSON.stringify(models.sent[1]!.body.messages)).toContain('image_url');

    t.clock.advance(61_000);
    models.sent.length = 0;
    models.replies.cloudflare.push(500);
    models.replies.groq.push(500);
    expect((await api().post('/v1/ai/classify-photo').set(as(customer)).send({ photoId }).expect(200)).body).toMatchObject({ serviceId: null, confidence: 0 });
    expect(models.asked()).toEqual(['cloudflare', 'groq']);
  });
});
