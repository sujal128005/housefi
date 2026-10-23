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
    'POST /support/tickets': () => json(201, { ticketId: 't2' }),
    [`POST /bookings/${BOOKING.id}/coupon`]: (c) => json(200, (c.body as { code: string }).code === 'FIRST50'
      ? { applied: true, problem: null, discount: 50, booking: { ...BOOKING, finalPayment: { kind: 'FINAL', amount: 450, state: 'DUE', method: null, txnId: null, at: null, discount: 50, couponCode: 'FIRST50' } } }
      : { applied: false, problem: 'EXPIRED', discount: 0, booking: BOOKING }),
    [`DELETE /bookings/${BOOKING.id}/coupon`]: () => json(200, BOOKING),
    [`POST /bookings/${BOOKING.id}/warranty`]: () => json(201, { ...BOOKING, id: 'b-revisit', warrantyOf: 'HF-48291' }),
    [`POST /bookings/${BOOKING.id}/invoice-link`]: () => json(200, { path: '/invoices/abc.123.sig', expiresAt: 9e12 }),
    'GET /support/conversation': () => json(200, { conversation: null }),
    'POST /support/conversation': (c) => json(201, { conversation: { id: 'cv1', state: 'OPEN', topic: (c.body as { topic: string }).topic, bookingCode: 'HF-48291', createdAt: 1, messages: [{ id: 'm1', from: 'ME', text: (c.body as { text: string }).text, at: 1 }] } }),
    'POST /support/conversation/messages': () => json(409, { error: { code: 'CONFLICT' } }),
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

  it('asks for the time windows as the signed-in customer (the API refuses anyone else)', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    const slot = { id: '2026-10-20T10', date: '2026-10-20', startHour: 10, endHour: 12, state: 'OPEN' };
    t.routes['GET /slots?serviceId=plumb-tap&date=2026-10-20'] = (c) =>
      (c.headers.authorization === 'Bearer acc1' ? json(200, [slot]) : json(401, { error: { code: 'UNAUTHENTICATED' } }));
    expect(await t.backend.bookings.slots(s.token, 'plumb-tap', '2026-10-20')).toEqual([slot]);
  });

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

  it('chats through the customer and technician endpoints, uploading a photo first', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    const chat = { bookingId: BOOKING.id, open: true, clearable: false, clearsAt: null, messages: [] };
    t.routes[`GET /bookings/${BOOKING.id}/chat`] = () => json(200, chat);
    t.routes[`POST /bookings/${BOOKING.id}/chat`] = () => json(200, chat);
    t.routes[`DELETE /bookings/${BOOKING.id}/chat`] = () => new Response(null, { status: 204 });
    t.routes['GET /chats'] = () => json(200, [{ bookingId: BOOKING.id, code: BOOKING.code, open: true, unread: 2 }]);
    expect(await t.backend.chat.list(s.token)).toEqual([{ bookingId: BOOKING.id, code: BOOKING.code, open: true, unread: 2 }]);
    expect(await t.backend.chat.get(s.token, BOOKING.id)).toEqual(chat);
    await t.backend.chat.send(s.token, BOOKING.id, { text: 'Gate code 4521', photoUri: 'file:///gate.jpg' });
    expect(t.calls.find((c) => c.url === '/uploads/photos')?.body).toMatchObject({ stage: 'CHAT' });
    expect(t.calls.find((c) => c.method === 'POST' && c.url === `/bookings/${BOOKING.id}/chat`)?.body).toEqual({ text: 'Gate code 4521', photoUploadId: expect.stringMatching(/^up-CHAT/) });
    await t.backend.chat.clear(s.token, BOOKING.id);
    expect(t.calls.at(-1)).toMatchObject({ method: 'DELETE', url: `/bookings/${BOOKING.id}/chat` });
  });

  it('asks for the same technician again only when booking again', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    await t.backend.bookings.create(s.token, { ...input, problem: { ...input.problem, photos: [] } }, 'idem-12345679');
    expect(t.calls.filter((c) => c.url === '/bookings').at(-1)?.body).not.toHaveProperty('repeatOf');
    await t.backend.bookings.create(s.token, { ...input, problem: { ...input.problem, photos: [] }, repeatOf: BOOKING.id }, 'idem-12345680');
    expect(t.calls.filter((c) => c.url === '/bookings').at(-1)?.body).toMatchObject({ repeatOf: BOOKING.id });
  });

  it('asks for the "Now" estimate (minutes only), and reads "unknown" as null', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    t.routes['GET /eta?serviceId=plumb-tap&addressId=ad1'] = () => json(200, { minutes: [25, 35] });
    expect(await t.backend.bookings.eta(s.token, 'plumb-tap', 'ad1')).toEqual({ minutes: [25, 35] });
    t.routes['GET /eta?serviceId=plumb-tap&addressId=ad1'] = () => json(200, { minutes: null });
    expect(await t.backend.bookings.eta(s.token, 'plumb-tap', 'ad1')).toEqual({ minutes: null });
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

  it('sends an SOS with where the phone was, and talks to the Housefi team after the intake', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    await t.backend.support.ticket(s.token, 'UNSAFE', BOOKING.id, 'SOS', { lat: 17.41, lng: 78.44, accuracyM: 8 });
    expect(t.calls.at(-1)).toMatchObject({ url: '/support/tickets', body: { kind: 'UNSAFE', bookingId: BOOKING.id, location: { lat: 17.41, lng: 78.44, accuracyM: 8 } } });
    await t.backend.support.ticket(s.token, 'UNSAFE', BOOKING.id, 'SOS', null);
    expect(t.calls.at(-1)?.body).not.toHaveProperty('location');

    expect(await t.backend.support.conversation(s.token)).toBeNull();
    const c = await t.backend.support.startConversation(s.token, { topic: 'PAYMENT', bookingId: BOOKING.id, text: 'Charged twice' });
    expect(t.calls.at(-1)).toMatchObject({ url: '/support/conversation', body: { topic: 'PAYMENT', bookingId: BOOKING.id, text: 'Charged twice' } });
    expect(c).toMatchObject({ id: 'cv1', state: 'OPEN', messages: [{ from: 'ME', text: 'Charged twice' }] });
    await expect(t.backend.support.sendToTeam(s.token, 'hello')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('applies and removes coupons, books the warranty revisit, and links to the invoice PDF', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    const ok = await t.backend.bookings.applyCoupon(s.token, BOOKING.id, 'FIRST50');
    expect(ok).toMatchObject({ applied: true, problem: null, discount: 50, booking: { finalPayment: { amount: 450, discount: 50, couponCode: 'FIRST50' } } });
    expect(await t.backend.bookings.applyCoupon(s.token, BOOKING.id, 'OLD')).toMatchObject({ applied: false, problem: 'EXPIRED' });
    await t.backend.bookings.removeCoupon(s.token, BOOKING.id);
    expect(t.calls.at(-1)).toMatchObject({ method: 'DELETE', url: `/bookings/${BOOKING.id}/coupon` });
    expect((await t.backend.bookings.claimWarranty(s.token, BOOKING.id, 'still leaking')).warrantyOf).toBe('HF-48291');
    expect(t.calls.at(-1)?.body).toEqual({ note: 'still leaking' });
    expect(await t.backend.bookings.invoiceLink(s.token, BOOKING.id)).toBe(`${BASE.replace(/\/+$/, '')}/invoices/abc.123.sig`);
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

describe('live client: payout details', () => {
  it('reads "not added yet" as null, and saves the details with PUT', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    t.routes['GET /tech/payout-account'] = () => json(200, null);
    expect(await t.backend.tech.payoutAccount(s.token)).toBeNull();
    const saved = { rail: 'BANK', holderName: 'Swathi Naidu', hint: 'XXXXXXX2101 · SBIN0001234', updatedAt: 5 };
    t.routes['PUT /tech/payout-account'] = () => json(200, saved);
    const input = { rail: 'BANK', holderName: 'Swathi Naidu', accountNumber: '98765432101', ifsc: 'SBIN0001234' } as const;
    expect(await t.backend.tech.setPayoutAccount(s.token, input)).toEqual(saved);
    expect(t.calls.at(-1)).toMatchObject({ method: 'PUT', url: '/tech/payout-account', body: input });
  });
});

describe('live client: skill check', () => {
  const CHECK = { level: 'SKILLED', required: true, submittedAt: null, canSubmit: false, demo: false, trades: [], video: null, certificates: [], rules: {} };
  const EXAM = { id: 'ex1', categoryId: 'PLUMBING', level: 'SKILLED', state: 'IN_PROGRESS', serverNow: 1, startedAt: 1, endsAt: 2, sections: [], currentSection: 0, questions: [], answers: {}, leftApp: 0, maxLeftApp: 3, result: null };

  it('runs the exam through its endpoints, part by part', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    t.routes['GET /tech/skills'] = () => json(200, CHECK);
    t.routes['PUT /tech/skills/level'] = () => json(200, CHECK);
    t.routes['POST /tech/skills/exams'] = () => json(200, EXAM);
    t.routes['POST /tech/skills/exams/ex1/sections/1/start'] = () => json(200, { ...EXAM, currentSection: 1 });
    t.routes['PUT /tech/skills/exams/ex1/answers/pl3-m1'] = () => json(200, { ...EXAM, answers: { 'pl3-m1': 'b' } });
    t.routes['POST /tech/skills/exams/ex1/left-app'] = () => json(200, { ...EXAM, leftApp: 1 });
    t.routes['POST /tech/skills/exams/ex1/submit'] = () => json(200, { ...EXAM, state: 'SUBMITTED' });
    t.routes['POST /tech/skills/submit'] = () => json(200, { ...CHECK, submittedAt: 5 });
    expect((await t.backend.tech.skills(s.token)).level).toBe('SKILLED');
    await t.backend.tech.setSkillLevel(s.token, 'SKILLED');
    expect(t.calls.at(-1)).toMatchObject({ method: 'PUT', url: '/tech/skills/level', body: { level: 'SKILLED' } });
    expect((await t.backend.tech.startExam(s.token, 'PLUMBING')).id).toBe('ex1');
    expect(t.calls.at(-1)?.body).toEqual({ categoryId: 'PLUMBING' });
    expect((await t.backend.tech.startExamSection(s.token, 'ex1', 1)).currentSection).toBe(1);
    expect((await t.backend.tech.answerExam(s.token, 'ex1', 'pl3-m1', 'b')).answers).toEqual({ 'pl3-m1': 'b' });
    expect(t.calls.at(-1)?.body).toEqual({ optionId: 'b' });
    expect((await t.backend.tech.examLeftApp(s.token, 'ex1')).leftApp).toBe(1);
    expect((await t.backend.tech.submitExam(s.token, 'ex1')).state).toBe('SUBMITTED');
    expect((await t.backend.tech.submitSkills(s.token)).submittedAt).toBe(5);
  });

  it('uploads the work video and a PDF certificate first, and sends a demo sample without a file', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    t.routes['POST /uploads/videos'] = () => json(200, { id: 'vid-1', uploadUrl: 'https://files.test/u/x?sig', expiresAt: 1 });
    t.routes['POST /uploads/documents'] = () => json(200, { id: 'doc-1', uploadUrl: 'https://files.test/u/x?sig', expiresAt: 1 });
    t.routes['POST /tech/skills/video'] = () => json(200, CHECK);
    t.routes['POST /tech/skills/certificates'] = () => json(200, CHECK);
    t.routes['DELETE /tech/skills/certificates/c1'] = () => json(200, CHECK);
    await t.backend.tech.sendSkillVideo(s.token, { source: 'LIVE', uri: 'file:///rec/work.mp4' });
    expect(t.calls.find((c) => c.url === '/uploads/videos')?.body).toEqual({ contentType: 'video/mp4', bytes: 1234 });
    expect(t.calls.at(-1)).toMatchObject({ url: '/tech/skills/video', body: { source: 'LIVE', uploadId: 'vid-1' } });
    await t.backend.tech.addCertificate(s.token, { kind: 'ITI', title: 'ITI Plumber', uri: 'file:///docs/iti.pdf', mimeType: 'application/pdf' });
    expect(t.calls.find((c) => c.url === '/uploads/documents')?.body).toEqual({ contentType: 'application/pdf', bytes: 1234 });
    expect(t.calls.at(-1)).toMatchObject({ url: '/tech/skills/certificates', body: { kind: 'ITI', title: 'ITI Plumber', uploadId: 'doc-1' } });
    await t.backend.tech.sendSkillVideo(s.token, { source: 'SAMPLE' });
    expect(t.calls.at(-1)?.body).toEqual({ source: 'SAMPLE' });
    await t.backend.tech.addCertificate(s.token, { kind: 'SKILL_INDIA', title: '', sample: true });
    expect(t.calls.at(-1)?.body).toEqual({ kind: 'SKILL_INDIA', title: '', sample: true });
    await t.backend.tech.removeCertificate(s.token, 'c1');
    expect(t.calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/tech/skills/certificates/c1' });
  });
});

describe('live client: courses', () => {
  const COURSE = { id: 'pl-advanced', categoryId: 'PLUMBING', level: 'ADVANCED', title: { en: 'A', te: 'అ' }, summary: { en: 'A', te: 'అ' }, lessons: 4, durationSec: 240, price: 99, access: 'PAY', enrolled: false, completedLessons: 0, completed: false, lessonList: [], quiz: { questions: 5, passCorrect: 3, unlocked: false, attempts: 0, lastCorrect: null }, certificate: null };

  it('buys an advanced course through the checkout, and lets the server confirm it', async () => {
    const checkout = { kind: 'paid' as const, orderId: 'order_c1', paymentId: 'pay_c1', signature: 'sig' };
    const t = setup({ checkout: async () => checkout });
    const s = await signIn(t.backend);
    t.routes['POST /tech/courses/pl-advanced/payments'] = () => json(200, { paymentId: 'cp1', provider: 'RAZORPAY', orderId: 'order_c1', keyId: 'rzp_test_k', amount: 99 });
    t.routes['POST /tech/courses/pl-advanced/payments/cp1/verify'] = () => json(200, { ...COURSE, enrolled: true });
    const course = await t.backend.tech.buyCourse(s.token, 'pl-advanced');
    expect(course.enrolled).toBe(true);
    expect(t.checkouts[0]).toMatchObject({ orderId: 'order_c1', amount: 99, description: 'Housefi course' });
    expect(t.calls.at(-1)?.body).toEqual({ razorpayOrderId: 'order_c1', razorpayPaymentId: 'pay_c1', razorpaySignature: 'sig' });
  });

  it('reads the course again when the checkout is closed, and skips it for demo accounts', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    t.routes['POST /tech/courses/pl-advanced/payments'] = () => json(200, { paymentId: 'cp1', provider: 'RAZORPAY', orderId: 'order_c1', keyId: 'k', amount: 99 });
    t.routes['GET /tech/courses/pl-advanced'] = () => json(200, COURSE);
    expect((await t.backend.tech.buyCourse(s.token, 'pl-advanced')).enrolled).toBe(false);
    t.routes['POST /tech/courses/pl-advanced/payments'] = () => json(200, { paymentId: 'cp2', provider: 'SIMULATED', orderId: 'sim_course_cp2', keyId: '', amount: 99 });
    t.routes['POST /tech/courses/pl-advanced/payments/cp2/verify'] = () => json(200, { ...COURSE, enrolled: true });
    const checkouts = t.checkouts.length;
    expect((await t.backend.tech.buyCourse(s.token, 'pl-advanced')).enrolled).toBe(true);
    expect(t.checkouts).toHaveLength(checkouts);
  });

  it('reports lesson progress in whole seconds and sends quiz answers', async () => {
    const t = setup();
    const s = await signIn(t.backend);
    t.routes['POST /tech/courses/pl-basic/lessons/tools/progress'] = () => json(200, { watchedSec: 40, completed: false });
    t.routes['POST /tech/courses/pl-basic/quiz'] = () => json(200, { correct: 5, total: 5, passed: true, course: { ...COURSE, id: 'pl-basic', completed: true } });
    expect(await t.backend.tech.lessonProgress(s.token, 'pl-basic', 'tools', 41.7)).toEqual({ watchedSec: 40, completed: false });
    expect(t.calls.at(-1)?.body).toEqual({ positionSec: 41 });
    expect((await t.backend.tech.submitCourseQuiz(s.token, 'pl-basic', { '0': 'a' })).passed).toBe(true);
    expect(t.calls.at(-1)?.body).toEqual({ answers: { '0': 'a' } });
  });
});

describe('live client: places and the festive greeting', () => {
  it('asks the directory with the names encoded, and reads the answers', async () => {
    const t = setup();
    t.routes['GET /places/states'] = () => json(200, ['Delhi', 'Telangana']);
    t.routes['GET /places/districts?state=Andaman%20and%20Nicobar%20Islands'] = () => json(200, ['South Andaman']);
    t.routes['GET /places/localities?state=Telangana&district=Medchal%20Malkajgiri'] = () => json(200, [{ name: 'Kukatpally', pincodes: ['500072'] }]);
    t.routes['GET /places/pincodes/500072'] = () => json(200, { pincode: '500072', places: [{ state: 'Telangana', district: 'Medchal Malkajgiri', locality: 'Kukatpally' }] });
    t.routes['GET /places/near?lat=17.48&lng=78.41&pincode=500072&area=Kukatpally%2C%20Hyderabad'] = () =>
      json(200, { state: 'Telangana', district: 'Medchal Malkajgiri', locality: 'Kukatpally', pincode: '500072', distanceKm: null });
    expect(await t.backend.places.states()).toEqual(['Delhi', 'Telangana']);
    expect(await t.backend.places.districts('Andaman and Nicobar Islands')).toEqual(['South Andaman']);
    expect(await t.backend.places.localities('Telangana', 'Medchal Malkajgiri')).toEqual([{ name: 'Kukatpally', pincodes: ['500072'] }]);
    expect((await t.backend.places.pincode('500072')).places[0]?.locality).toBe('Kukatpally');
    expect(await t.backend.places.near(17.48, 78.41, '500072', 'Kukatpally, Hyderabad')).toMatchObject({ locality: 'Kukatpally', distanceKm: null });
    // No sign-in needed: none of these carry a token.
    expect(t.calls.every((c) => !c.headers.authorization)).toBe(true);
    t.routes['GET /places/states'] = () => json(200, [7]);
    await expect(t.backend.places.states()).rejects.toThrow();
  });

  it('reads an ordinary day as no greeting', async () => {
    const t = setup();
    t.routes['GET /catalog/greeting'] = () => json(200, null);
    expect(await t.backend.catalog.greeting()).toBeNull();
    const diwali = { id: 'diwali-2026', theme: 'lights', title: { en: 'Happy Diwali', te: 'దీపావళి శుభాకాంక్షలు' }, body: { en: 'b', te: 'బ' }, categoryId: 'CLEANING', cta: null, techBody: { en: 't', te: 'ట' }, until: 9 };
    t.routes['GET /catalog/greeting'] = () => json(200, diwali);
    expect(await t.backend.catalog.greeting()).toEqual(diwali);
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
