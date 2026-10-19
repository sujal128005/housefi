// The live client (services/http) against a fake Housefi API: sessions and token refresh, uploads, bookings and
// payments, live-stream parsing, and the checkout hand-off.
import { isApiError, type KeyValueStore } from '../services/api';
import { checkoutUrl, outcomeFrom } from '../services/checkout';
import { createHttpBackend, decodeBooking, type CheckoutOrder, type CheckoutOutcome } from '../services/http/HttpBackend';
import { parseSse } from '../services/http/liveStream';
import { contentTypeFor, createUploader } from '../services/http/uploads';

const BASE = 'https://api.test/v1';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

const json = (status: number, body: unknown) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CUSTOMER = { id: 'c1', phone: '9876543210', name: 'Lakshmi' };
const BOOKING = {
  id: '11111111-1111-4111-8111-111111111111', code: 'HF-48291', serviceId: 'plumb-tap', categoryId: 'PLUMBING', status: 'AWAITING_PAYMENT',
  problem: { issueIds: ['tap-leak'], notes: '', voiceNote: { durationSec: 6, transcript: 'leak', audioId: 'a1', url: 'https://files.test/v/a1?sig' }, photos: [{ id: 'p1', url: 'https://files.test/v/p1?sig' }] },
  address: { id: 'ad1', label: 'HOME', house: '4B', street: 'Road 12', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4, lng: 78.4 },
  time: { mode: 'INSTANT', window: null }, preferWomenRated: false, technician: null, arrivalOtp: '', etaMin: null, technicianLocation: null,
  visitPayment: { kind: 'VISIT', amount: 49, state: 'DUE', method: null, txnId: null, at: null }, quote: null, extraQuote: null, finalPayment: null,
  rating: null, createdAt: 1, history: [{ status: 'AWAITING_PAYMENT', at: 1 }], cancelReason: null, closeReason: null, workStarted: false, viaTechApp: true, demo: false,
};

/** A small fake of the Housefi API. Each test adjusts `routes`. */
function server() {
  const calls: Call[] = [];
  let n = 0;
  let accessOk = 'acc1';
  const routes: Record<string, (c: Call) => Response | Promise<Response>> = {
    'POST /auth/otp/request': () => json(200, { challengeId: 'ch1', phone: '9876543210', resendAfterSec: 30, expiresAt: 9e12, demoCode: null, demoAccount: true }),
    'POST /auth/otp/verify': () => json(200, { accessToken: 'acc1', refreshToken: 'ref1', expiresIn: 900, isNew: false, customer: CUSTOMER }),
    'POST /auth/refresh': (c) => {
      n++;
      accessOk = `acc${n + 1}`;
      return (c.body as { refreshToken: string }).refreshToken.startsWith('ref') ? json(200, { accessToken: accessOk, refreshToken: `ref${n + 1}`, expiresIn: 900, isNew: false }) : json(401, { error: { code: 'UNAUTHENTICATED' } });
    },
    'GET /me': (c) => (c.headers.authorization === `Bearer ${accessOk}` ? json(200, CUSTOMER) : json(401, { error: { code: 'UNAUTHENTICATED' } })),
    'POST /auth/logout': () => json(204, undefined),
    'DELETE /me': () => new Response(null, { status: 204 }),
    'POST /uploads/photos': (c) => json(200, { id: `up-${(c.body as { stage: string }).stage}-${calls.length}`, uploadUrl: 'https://files.test/u/x?sig', expiresAt: 1 }),
    'POST /uploads/audio': () => json(200, { id: 'audio-1', uploadUrl: 'https://files.test/u/a?sig', expiresAt: 1 }),
    'PUT https://files.test/u/x?sig': () => new Response('', { status: 200 }),
    'PUT https://files.test/u/a?sig': () => new Response('', { status: 200 }),
    'POST /bookings': () => json(201, BOOKING),
    [`GET /bookings/${BOOKING.id}`]: () => json(200, BOOKING),
    [`POST /bookings/${BOOKING.id}/payments`]: () => json(200, { paymentId: 'pay1', provider: 'RAZORPAY', orderId: 'order_1', keyId: 'rzp_test_k', amount: 49 }),
    'POST /payments/pay1/verify': () => json(200, { state: 'PAID', booking: { ...BOOKING, status: 'MATCHING' } }),
    'POST /ai/transcribe': () => json(200, { text: 'నీళ్లు కారుతున్నాయి' }),
    'POST /support/callback': () => json(201, { ticketId: 't1' }),
  };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('file://')) return new Response(new Blob([new Uint8Array(1234)], { type: url.endsWith('.m4a') ? 'audio/mp4' : 'image/jpeg' }));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : init?.body;
    const c = { method, url: path, headers, body };
    calls.push(c);
    const route = routes[`${method} ${path}`];
    return route ? route(c) : json(404, { error: { code: 'NOT_FOUND' } });
  }) as typeof fetch;
  return { calls, routes, fetchFn };
}

function setup(opts: { checkout?: (o: CheckoutOrder) => Promise<CheckoutOutcome>; now?: () => number } = {}) {
  const s = server();
  const secrets = memory();
  const checkouts: CheckoutOrder[] = [];
  const backend = createHttpBackend({
    baseUrl: BASE, secrets, fetch: s.fetchFn, randomBytes: (n) => new Uint8Array(n).fill(7), now: opts.now,
    openCheckout: async (o) => {
      checkouts.push(o);
      return opts.checkout ? opts.checkout(o) : { kind: 'dismissed' };
    },
  });
  return { ...s, secrets, backend, checkouts };
}

async function signIn(b: ReturnType<typeof setup>['backend']) {
  const ch = await b.auth.requestOtp('+91 98765 43210');
  return (await b.auth.verifyOtp(ch.challengeId, '482915')).session;
}

describe('live client: sessions', () => {
  it('signs in with a session handle; the tokens stay in the secret store', async () => {
    const t = setup();
    const ch = await t.backend.auth.requestOtp('+91 98765 43210');
    expect(ch).toMatchObject({ challengeId: 'ch1', demoCode: null, demoAccount: true });
    expect(t.calls[0]?.body).toEqual({ phone: '9876543210', role: 'CUSTOMER' });
    const session = (await t.backend.auth.verifyOtp(ch.challengeId, '482915')).session;
    expect(session.token).toMatch(/^live1\.customer\.[0-9a-f]{32}$/);
    expect(session.token).not.toContain('acc1');
    expect([...t.secrets.data.values()].join()).toContain('ref1');
    expect(await t.backend.auth.restore(session.token)).toEqual({ token: session.token, customer: CUSTOMER });
    expect(t.calls.at(-1)?.headers.authorization).toBe('Bearer acc1');
    // A technician handle is never accepted as a customer session.
    expect(await t.backend.tech.auth.restore(session.token)).toBeNull();
  });

  it('refreshes an expiring token once, even for parallel requests', async () => {
    let clock = 0;
    const t = setup({ now: () => clock });
    const session = await signIn(t.backend);
    clock = 900_000; // the 15-minute token is about to expire
    await Promise.all([t.backend.auth.restore(session.token), t.backend.auth.restore(session.token), t.backend.auth.restore(session.token)]);
    expect(t.calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
    expect(t.calls.filter((c) => c.url === '/me').every((c) => c.headers.authorization === 'Bearer acc2')).toBe(true);
  });

  it('retries once with a fresh token when the server refuses one, and forgets an ended session', async () => {
    const t = setup();
    const session = await signIn(t.backend);
    t.routes['GET /me'] = (c) => (c.headers.authorization === 'Bearer acc2' ? json(200, CUSTOMER) : json(401, { error: { code: 'UNAUTHENTICATED' } }));
    expect((await t.backend.auth.restore(session.token))?.customer).toEqual(CUSTOMER);
    // The refresh token is refused: signed out everywhere.
    t.routes['POST /auth/refresh'] = () => json(401, { error: { code: 'UNAUTHENTICATED' } });
    t.routes['GET /me'] = () => json(401, { error: { code: 'UNAUTHENTICATED' } });
    expect(await t.backend.auth.restore(session.token)).toBeNull();
    expect([...t.secrets.data.keys()].filter((k) => k.startsWith('housefi.cred.'))).toEqual([]);
  });

  it('signs out on the server and on the phone', async () => {
    const t = setup();
    const session = await signIn(t.backend);
    await t.backend.auth.signOut(session.token);
    expect(t.calls.at(-1)).toMatchObject({ url: '/auth/logout', body: { refreshToken: 'ref1' } });
    expect(await t.backend.auth.restore(session.token)).toBeNull();
  });

  it('deletes the account on the server, then forgets the session; a refusal keeps the person signed in', async () => {
    const t = setup();
    t.routes['DELETE /me'] = () => json(409, { error: { code: 'CONFLICT' } });
    const session = await signIn(t.backend);
    await expect(t.backend.auth.deleteAccount(session.token)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await t.backend.auth.restore(session.token)).not.toBeNull();
    t.routes['DELETE /me'] = () => new Response(null, { status: 204 });
    await t.backend.auth.deleteAccount(session.token);
    expect(t.calls.some((c) => c.method === 'DELETE' && c.url === '/me' && c.headers.authorization === 'Bearer acc1')).toBe(true);
    expect(await t.backend.auth.restore(session.token)).toBeNull();
  });
});

describe('live client: bookings, uploads, payments', () => {
  const input = {
    serviceId: 'plumb-tap', addressId: 'ad1', time: { mode: 'INSTANT' as const, window: null }, preferWomenRated: false,
    problem: { issueIds: ['tap-leak'], notes: '', voiceNote: { durationSec: 6.4, transcript: 'leak', audioId: 'audio-1' }, photos: [{ id: 'local', uri: 'file:///p1.jpg' }] },
  };

  it('uploads local photos once, then books with their ids and the idempotency key', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    await t.backend.bookings.create(s.token, input, 'idem-12345678');
    await t.backend.bookings.create(s.token, input, 'idem-12345678'); // a retry: the photo is not uploaded again
    expect(t.calls.filter((c) => c.url === '/uploads/photos')).toHaveLength(1);
    expect(t.calls.find((c) => c.url === '/uploads/photos')?.body).toEqual({ contentType: 'image/jpeg', bytes: 1234, stage: 'PROBLEM' });
    expect(t.calls.find((c) => c.method === 'PUT')?.headers['content-type']).toBe('image/jpeg');
    expect((t.calls.find((c) => c.method === 'PUT')?.body as ArrayBuffer).byteLength).toBe(1234);
    const booking = t.calls.filter((c) => c.url === '/bookings');
    expect(booking[0]?.headers['idempotency-key']).toBe('idem-12345678');
    expect(booking[0]?.body).toMatchObject({ problem: { photos: [{ id: expect.stringMatching(/^up-PROBLEM/) }], voiceNote: { durationSec: 6, transcript: 'leak', audioId: 'audio-1' } } });
  });

  it('uploads a voice note and returns what was said', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    expect(await t.backend.ai.transcribe(s.token, { uri: 'file:///note.m4a', durationSec: 6 }, 'plumb-tap', 'te')).toEqual({ text: 'నీళ్లు కారుతున్నాయి', audioId: 'audio-1' });
    expect(t.calls.find((c) => c.url === '/uploads/audio')?.body).toEqual({ contentType: 'audio/mp4', bytes: 1234 });
  });

  it('pays through the checkout and lets the server confirm', async () => {
    const t = setup({ checkout: async (o) => ({ kind: 'paid', orderId: o.orderId, paymentId: 'pay_abc', signature: 'sig' }) });
    const s = await signIn(t.backend);
    const r = await t.backend.bookings.pay(s.token, BOOKING.id, 'VISIT', 'UPI', 'idem-pay-0001');
    expect(t.checkouts).toEqual([{ paymentId: 'pay1', orderId: 'order_1', keyId: 'rzp_test_k', amount: 49, description: 'Visit fee' }]);
    expect(t.calls.find((c) => c.url === '/payments/pay1/verify')?.body).toEqual({ razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_abc', razorpaySignature: 'sig' });
    expect(r).toMatchObject({ state: 'PAID', booking: { status: 'MATCHING' } });
  });

  it('reports what the server knows when the checkout is closed, and skips it for team demo bookings', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    expect((await t.backend.bookings.pay(s.token, BOOKING.id, 'VISIT', 'UPI', 'idem-pay-0002')).state).toBe('FAILED');
    t.routes[`POST /bookings/${BOOKING.id}/payments`] = () => json(200, { paymentId: 'pay1', provider: 'SIMULATED', orderId: 'sim_order_1', keyId: '', amount: 49 });
    const before = t.checkouts.length;
    expect((await t.backend.bookings.pay(s.token, BOOKING.id, 'VISIT', 'UPI', 'idem-pay-0003')).state).toBe('PAID');
    expect(t.checkouts).toHaveLength(before);
  });

  it('asks Housefi to call back', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    await t.backend.support.callback(s.token, BOOKING.id, 'call');
    expect(t.calls.at(-1)).toMatchObject({ url: '/support/callback', body: { bookingId: BOOKING.id, reason: 'call' } });
  });

  it('reads signed links to photos and the voice note', () => {
    const b = decodeBooking(BOOKING);
    expect(b.problem.photos).toEqual([{ id: 'p1', uri: 'https://files.test/v/p1?sig' }]);
    expect(b.problem.voiceNote).toEqual({ durationSec: 6, transcript: 'leak', audioId: 'a1', uri: 'https://files.test/v/a1?sig' });
    expect(() => decodeBooking({ id: 'x' })).toThrow();
  });

  it('refuses file types the API does not take', () => {
    expect(contentTypeFor('photos', 'file:///a.JPG', '')).toBe('image/jpeg');
    expect(contentTypeFor('audio', 'file:///a.m4a', 'audio/x-m4a')).toBe('audio/m4a');
    expect(() => contentTypeFor('photos', 'file:///a.webp', 'image/webp')).toThrow();
    try {
      contentTypeFor('audio', 'blob:x', 'audio/webm');
    } catch (e) {
      expect(isApiError(e, 'VALIDATION')).toBe(true);
    }
  });

  it("uploads a file's bytes even where the file cannot be turned into a Blob (Expo Go)", async () => {
    const sent: { url: string; body: unknown }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('file://')) {
        const file = new Response(new Uint8Array(321), { headers: { 'content-type': 'image/jpeg' } });
        // As in Expo Go: reading the file works, but making a React Native Blob from it fails.
        return Object.assign(file, { blob: () => Promise.reject(new Error('unstable_createBlobData is not a function')) });
      }
      sent.push({ url, body: init?.body });
      return new Response('', { status: 200 });
    }) as typeof fetch;
    const uploader = createUploader({ fetch: fetchFn, ticket: async () => ({ id: 'up-1', uploadUrl: 'https://files.test/u/p?sig' }) });
    await expect(uploader.upload('h', 'photos', 'file:///cache/ImageManipulator/A1.jpg', 'PROFILE')).resolves.toBe('up-1');
    expect((sent[0]?.body as ArrayBuffer).byteLength).toBe(321);

    const empty = (async () => new Response(new Uint8Array(0))) as unknown as typeof fetch;
    const none = createUploader({ fetch: empty, ticket: async () => ({ id: 'x', uploadUrl: 'https://files.test/x' }) });
    await expect(none.upload('h', 'photos', 'file:///cache/empty.jpg')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('live updates and checkout hand-off', () => {
  it('parses Server-Sent Events across chunks, ignoring heartbeats', () => {
    const text = ': ping\n\nevent: booking\ndata: {"id":"1"}\n\nevent: booking\ndata: {"id"';
    const r = parseSse(text);
    expect(r.events).toEqual([{ event: 'booking', data: '{"id":"1"}' }]);
    expect(text.slice(r.used)).toBe('event: booking\ndata: {"id"');
  });

  it('puts the order after "#" and accepts only a complete, matching result', () => {
    const url = checkoutUrl('https://housefi.tech/pay/', { paymentId: 'p', orderId: 'order_1', keyId: 'rzp_live_k', amount: 49, description: 'Visit fee' }, 'housefi://pay/return');
    expect(url.startsWith('https://housefi.tech/pay/#')).toBe(true);
    expect(new URLSearchParams(url.split('#')[1])).toEqual(new URLSearchParams({ k: 'rzp_live_k', o: 'order_1', a: '4900', d: 'Visit fee', r: 'housefi://pay/return' }));
    expect(outcomeFrom('housefi://pay/return?status=paid&oid=order_1&pid=pay_1&sig=s', 'order_1')).toEqual({ kind: 'paid', orderId: 'order_1', paymentId: 'pay_1', signature: 's' });
    expect(outcomeFrom('housefi://pay/return?status=paid&oid=order_2&pid=pay_1&sig=s', 'order_1')).toEqual({ kind: 'dismissed' });
    expect(outcomeFrom('housefi://pay/return?status=dismissed', 'order_1')).toEqual({ kind: 'dismissed' });
  });
});
