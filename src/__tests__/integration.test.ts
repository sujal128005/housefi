// Backend integration readiness: error presentation, HTTP transport, response decoding, backend selection and
// catalogue hydration. (The screens' independence from the demo backend is checked in architecture.test.js.)
import { CATEGORIES, currentCatalog, hydrateCatalog, SERVICES, serviceById } from '../data/catalog';
import { ApiError, type ApiErrorCode } from '../services/api';
import { BackendConfigError, backendChoiceFromEnv, createBackend } from '../services/createBackend';
import { presentError } from '../services/errorText';
import { decodeTechIdCard, decodeTechVerifyResult } from '../services/http/decode';
import { apiPath, codeForStatus, createTransport } from '../services/http/transport';
import { memoryStore } from '../services/mock/MockBackend';

const ALL_CODES: readonly ApiErrorCode[] = [
  'NETWORK', 'UNAUTHENTICATED', 'NOT_FOUND', 'VALIDATION', 'OTP_INVALID', 'OTP_EXPIRED', 'OTP_LOCKED', 'SLOT_UNAVAILABLE',
  'INSTANT_UNAVAILABLE', 'PAYMENT_FAILED', 'OFFER_EXPIRED', 'NOT_VERIFIED', 'IDENTITY_LOCKED', 'CONFLICT', 'FORBIDDEN',
  'RATE_LIMITED', 'SERVER_ERROR', 'TIMEOUT', 'BAD_RESPONSE',
];

describe('error presentation', () => {
  it("has words for every error kind and never uses the error's own message", () => {
    for (const code of ALL_CODES) {
      const p = presentError(new ApiError(code, { message: 'SECRET internal detail /var/app token=abc' }));
      expect(p.title.startsWith('error.')).toBe(true);
      expect(JSON.stringify(p)).not.toContain('SECRET');
    }
    expect(presentError(new TypeError('x is undefined')).title).toBe('error.generic');
  });

  it('offers Retry only where it can help, and sends expired sessions to sign-in', () => {
    expect(presentError(new ApiError('NETWORK')).retryable).toBe(true);
    expect(presentError(new ApiError('TIMEOUT')).retryable).toBe(true);
    expect(presentError(new ApiError('SERVER_ERROR')).retryable).toBe(true);
    expect(presentError(new ApiError('FORBIDDEN')).retryable).toBe(false);
    expect(presentError(new ApiError('NOT_FOUND')).retryable).toBe(false);
    expect(presentError(new ApiError('VALIDATION')).retryable).toBe(false);
    expect(presentError(new ApiError('UNAUTHENTICATED')).sessionEnded).toBe(true);
    expect(presentError(new ApiError('RATE_LIMITED', { retryAfterSec: 12.2 })).params).toEqual({ sec: 13 });
  });
});

type FakeReply = { status: number; body?: string; headers?: Record<string, string> } | 'network-error' | 'hang';

function fakeFetch(reply: FakeReply, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    if (reply === 'network-error') throw new TypeError('Network request failed');
    if (reply === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    const headers = reply.headers ?? {};
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: (k: string) => headers[k] ?? null },
      text: async () => reply.body ?? '',
    };
  }) as unknown as typeof fetch;
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected a failure');
}

describe('HTTP transport', () => {
  const ok = (json: unknown) => json;

  it('sends the token, idempotency key and language, and decodes the body', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const t = createTransport({ baseUrl: 'https://api.housefi.example/v1/', fetch: fakeFetch({ status: 200, body: '{"a":1}' }, seen), locale: () => 'te' });
    const out = await t.request({ method: 'POST', path: apiPath`/bookings`, token: 'tok_1', idempotencyKey: 'idem-1', body: { x: 1 }, decode: ok });
    expect(out).toEqual({ a: 1 });
    expect(seen.url).toBe('https://api.housefi.example/v1/bookings');
    const h = seen.init?.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok_1');
    expect(h['Idempotency-Key']).toBe('idem-1');
    expect(h['Accept-Language']).toBe('te');
    expect(seen.init?.body).toBe('{"x":1}');
  });

  it('maps statuses and the error envelope to error codes', async () => {
    const t = (r: FakeReply) => createTransport({ baseUrl: 'https://api.example', fetch: fakeFetch(r) });
    const get = (r: FakeReply) => failure(t(r).request({ method: 'GET', path: apiPath`/x`, token: 'tok_secret', decode: ok }));
    expect((await get({ status: 401 })).code).toBe('UNAUTHENTICATED');
    expect((await get({ status: 403, body: '{}' })).code).toBe('FORBIDDEN');
    expect((await get({ status: 409, body: '{"error":{"code":"SLOT_UNAVAILABLE"}}' })).code).toBe('SLOT_UNAVAILABLE');
    expect((await get({ status: 400, body: '{"error":{"code":"OTP_INVALID","attemptsLeft":2}}' })).attemptsLeft).toBe(2);
    expect((await get({ status: 418, body: '{"error":{"code":"MADE_UP"}}' })).code).toBe('BAD_RESPONSE');
    const limited = await get({ status: 429, body: '{"error":{"code":"RATE_LIMITED","retryAfterSec":30}}' });
    expect([limited.code, limited.retryAfterSec]).toEqual(['RATE_LIMITED', 30]);
    expect((await get({ status: 429, headers: { 'Retry-After': '7' } })).retryAfterSec).toBe(7);
    expect((await get({ status: 503, body: '<html>Bad gateway</html>' })).code).toBe('SERVER_ERROR');
    expect((await get({ status: 200, body: 'not json' })).code).toBe('BAD_RESPONSE');
    expect((await get('network-error')).code).toBe('NETWORK');
    const e = await get({ status: 500, body: '{"error":{"code":"SERVER_ERROR","message":"db password=hunter2"}}' });
    expect(e.message).not.toContain('hunter2');
    expect(e.message).not.toContain('tok_secret');
  });

  it('turns a body that does not match the contract into BAD_RESPONSE', async () => {
    const t = createTransport({ baseUrl: 'https://api.example', fetch: fakeFetch({ status: 200, body: '{"techCode":"N9-HF-T-7K4M9Q"}' }) });
    expect((await failure(t.request({ method: 'GET', path: apiPath`/tech/id-card`, decode: decodeTechIdCard }))).code).toBe('BAD_RESPONSE');
  });

  it('gives up after its time limit', async () => {
    const t = createTransport({ baseUrl: 'https://api.example', fetch: fakeFetch('hang'), timeoutMs: 20 });
    expect((await failure(t.request({ method: 'GET', path: apiPath`/slow`, decode: ok }))).code).toBe('TIMEOUT');
  });

  it('only talks https (http just for a local development host)', () => {
    expect(() => createTransport({ baseUrl: 'http://api.housefi.example' })).toThrow();
    expect(() => createTransport({ baseUrl: 'ftp://x' })).toThrow();
    expect(() => createTransport({ baseUrl: 'http://10.0.2.2:3000' })).not.toThrow();
  });

  it('encodes every dynamic part of a path', () => {
    expect(apiPath`/bookings/${'a/../b?c=1'}/rating`).toBe('/bookings/a%2F..%2Fb%3Fc%3D1/rating');
    expect(codeForStatus(404, undefined)).toBe('NOT_FOUND');
  });
});

describe('response decoding', () => {
  const card = {
    techCode: 'N9-HF-T-7K4M9Q', name: 'Test Tech', photo: null, photoStatus: 'APPROVED', gender: 'F', skills: ['PLUMBING'],
    verification: 'APPROVED', simulated: false, verifyUrl: 'https://verify.example/t/abc', verifyIsDemo: false, fictional: false,
  };

  it('accepts a well-formed card and refuses one without an explicit simulated flag', () => {
    expect(decodeTechIdCard(card).verification).toBe('APPROVED');
    const { simulated: _s, ...noFlag } = card;
    expect(() => decodeTechIdCard(noFlag)).toThrow();
    expect(() => decodeTechIdCard({ ...card, verification: 'SUPER_VERIFIED' })).toThrow();
    expect(() => decodeTechIdCard(null)).toThrow();
  });

  it('checks the verification page answer', () => {
    const good = {
      techCode: 'N9-HF-T-7K4M9Q', displayName: 'Test T.', photo: null, gender: 'M', verification: 'SUSPENDED', simulated: false, active: false,
      checkedAt: 1, fictional: false,
    };
    expect(decodeTechVerifyResult(good).active).toBe(false);
    expect(() => decodeTechVerifyResult({ ...good, active: 'yes' })).toThrow();
  });
});

describe('backend selection', () => {
  it('is the demo backend unless live is chosen explicitly', () => {
    expect(backendChoiceFromEnv({})).toEqual({ kind: 'demo' });
    expect(backendChoiceFromEnv({ EXPO_PUBLIC_HOUSEFI_BACKEND: 'demo' })).toEqual({ kind: 'demo' });
    expect(backendChoiceFromEnv({ EXPO_PUBLIC_HOUSEFI_BACKEND: 'live', EXPO_PUBLIC_HOUSEFI_API_URL: 'https://api.example' }))
      .toEqual({ kind: 'live', baseUrl: 'https://api.example' });
    expect(() => backendChoiceFromEnv({ EXPO_PUBLIC_HOUSEFI_BACKEND: 'live' })).toThrow(BackendConfigError);
    expect(() => backendChoiceFromEnv({ EXPO_PUBLIC_HOUSEFI_BACKEND: 'production' })).toThrow(BackendConfigError);
  });

  it('never falls back to the demo backend when live is asked for', () => {
    const deps = { store: memoryStore(), randomBytes: (n: number) => new Uint8Array(n) };
    expect(createBackend({ kind: 'demo' }, deps).mode).toBe('DEMO');
    expect(() => createBackend({ kind: 'live', baseUrl: 'https://api.example' }, deps)).toThrow(BackendConfigError);
  });
});

describe('catalogue', () => {
  afterEach(() => hydrateCatalog(CATEGORIES, SERVICES));

  it("uses the backend's catalogue and ignores an empty or malformed one", () => {
    expect(hydrateCatalog([], SERVICES)).toBe(false);
    expect(hydrateCatalog(CATEGORIES, [{ id: 'x' } as never])).toBe(false);
    expect(currentCatalog().services).toBe(SERVICES);
    const only = SERVICES.filter((s) => s.categoryId === 'PLUMBING');
    expect(hydrateCatalog(CATEGORIES, only)).toBe(true);
    expect(serviceById('ac-service')).toBeUndefined();
    expect(serviceById('plumb-tap')?.id).toBe('plumb-tap');
  });
});
