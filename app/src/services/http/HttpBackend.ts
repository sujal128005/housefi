// The live Housefi API behind the Backend interface (docs/backend/openapi.yaml). Screens never see HTTP: they get the
// same models and ApiError codes as before. Sessions are handles (credentials.ts); uploads go straight to storage
// (uploads.ts); live updates stream (liveStream.ts); payments open Razorpay's checkout through `openCheckout`.
import {
  ApiError, isApiError, type AiApi, type AppNotification, type Backend, type BookingApi, type KeyValueStore, type NotificationApi,
  type OtpChallenge, type PaymentResult, type TechApi,
} from '../api';
import type {
  Address, Booking, Category, Customer, Earnings, Job, JobOffer, Photo, ProblemDescription, Service, Slot, TechProfile, VoiceNote,
} from '../../domain/types';
import type { RandomBytes } from '../../domain/identity';
import { createVault, roleOf, type Credentials, type Role } from './credentials';
import { DecodeError, decodeTechIdCard, decodeTechVerifyResult, num, obj, str } from './decode';
import { openLiveStream } from './liveStream';
import { apiPath, createTransport, type ApiPath, type HttpMethod } from './transport';
import { createUploader, isLocalFile, type PhotoStage, type UploadKind, type UploadTicket } from './uploads';

export interface CheckoutOrder {
  readonly paymentId: string;
  readonly orderId: string;
  /** Razorpay's public key id (from the server: test or live is the server's choice). */
  readonly keyId: string;
  /** Whole rupees. */
  readonly amount: number;
  readonly description: string;
}

export type CheckoutOutcome =
  | { readonly kind: 'paid'; readonly orderId: string; readonly paymentId: string; readonly signature: string }
  | { readonly kind: 'dismissed' };

export interface HttpBackendDeps {
  readonly baseUrl: string;
  /** Session credentials: the secret store (Keychain / Keystore). */
  readonly secrets: KeyValueStore;
  readonly randomBytes: RandomBytes;
  /** Opens Razorpay's checkout and waits for it to come back (services/checkout.ts). */
  readonly openCheckout: (order: CheckoutOrder) => Promise<CheckoutOutcome>;
  readonly locale?: () => string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Polling interval when streaming is not possible. */
  readonly pollMs?: number;
}

// ---------- decoding ----------

const list = <T>(json: unknown, one: (v: unknown) => T, what: string): T[] => {
  if (!Array.isArray(json)) throw new DecodeError(`${what}: expected a list`);
  return json.map(one);
};

/** Records whose many fields the screens read as-is: check the identifying ones, keep the rest. */
function record<T>(json: unknown, what: string, keys: readonly string[]): T {
  const o = obj(json, what);
  for (const k of keys) if (!(k in o)) throw new DecodeError(`${what}: ${k} missing`);
  return o as unknown as T;
}

function decodeProblem(json: unknown): ProblemDescription {
  const o = obj(json, 'problem');
  const photos = Array.isArray(o.photos) ? o.photos : [];
  const vn = o.voiceNote && typeof o.voiceNote === 'object' ? (o.voiceNote as Record<string, unknown>) : null;
  const voiceNote: VoiceNote | null = vn
    ? {
      durationSec: num(vn, 'durationSec'),
      transcript: typeof vn.transcript === 'string' ? vn.transcript : '',
      audioId: typeof vn.audioId === 'string' ? vn.audioId : null,
      // A short-lived signed URL to play the recording.
      ...(typeof vn.url === 'string' ? { uri: vn.url } : {}),
    }
    : null;
  return {
    issueIds: Array.isArray(o.issueIds) ? (o.issueIds as string[]) : [],
    notes: typeof o.notes === 'string' ? o.notes : '',
    voiceNote,
    // The server sends short-lived signed URLs to the checked copies of the photos.
    photos: photos.map((p): Photo => {
      const ph = obj(p, 'photo');
      return { id: str(ph, 'id'), uri: typeof ph.url === 'string' ? ph.url : undefined };
    }),
  };
}

export function decodeBooking(json: unknown): Booking {
  const b = record<Booking>(json, 'booking', ['id', 'code', 'status', 'serviceId', 'visitPayment', 'history']);
  str(b as unknown as Record<string, unknown>, 'id');
  return { ...b, problem: decodeProblem(b.problem), viaTechApp: true, demo: b.demo === true };
}

export function decodeJob(json: unknown): Job {
  const j = record<Job>(json, 'job', ['id', 'code', 'status', 'serviceId', 'address', 'history']);
  return { ...j, problem: decodeProblem(j.problem), practice: false, demo: j.demo === true };
}

const decodeOffer = (json: unknown): JobOffer | null =>
  json === null || json === undefined ? null : record<JobOffer>(json, 'offer', ['id', 'bookingId', 'expiresAt', 'area']);
const decodeAddress = (json: unknown): Address => record<Address>(json, 'address', ['id', 'house', 'pincode']);
const decodeCustomer = (json: unknown): Customer => record<Customer>(json, 'customer', ['id', 'phone', 'name']);
const decodeProfile = (json: unknown): TechProfile => record<TechProfile>(json, 'technician', ['id', 'phone', 'verification', 'online']);
const decodeService = (json: unknown): Service => record<Service>(json, 'service', ['id', 'categoryId', 'name', 'issues', 'visitFee']);
const decodeCategory = (json: unknown): Category => record<Category>(json, 'category', ['id', 'name', 'art']);
const decodeSlot = (json: unknown): Slot => record<Slot>(json, 'slot', ['id', 'date', 'startHour', 'state']);
const decodeNotification = (json: unknown): AppNotification => record<AppNotification>(json, 'notification', ['id', 'kind', 'at', 'read']);
const decodeEarnings = (json: unknown): Earnings => record<Earnings>(json, 'earnings', ['today', 'total', 'entries']);
const decodeNothing = (): void => undefined;
const decodeDial = (json: unknown) => ({ dialNumber: str(obj(json, 'call'), 'dialNumber') });

function decodeChallenge(json: unknown): OtpChallenge {
  const o = obj(json, 'challenge');
  return {
    challengeId: str(o, 'challengeId'), phone: str(o, 'phone'), resendAfterSec: num(o, 'resendAfterSec'), expiresAt: num(o, 'expiresAt'),
    // Never a code from the live backend; the team's demo numbers use their fixed code.
    demoCode: null, demoAccount: o.demoAccount === true,
  };
}

interface AuthResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly isNew: boolean;
  readonly customer?: unknown;
  readonly technician?: unknown;
}

function decodeAuth(json: unknown): AuthResult {
  const o = obj(json, 'auth');
  return { accessToken: str(o, 'accessToken'), refreshToken: str(o, 'refreshToken'), expiresIn: num(o, 'expiresIn'), isNew: o.isNew === true, customer: o.customer, technician: o.technician };
}

type PaymentOrder = { readonly paymentId: string; readonly provider: 'RAZORPAY' | 'SIMULATED'; readonly orderId: string; readonly keyId: string; readonly amount: number };

// ---------- the client ----------

export function createHttpBackend(deps: HttpBackendDeps): Backend {
  const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const transport = createTransport({ baseUrl: deps.baseUrl, fetch: doFetch, locale: deps.locale });
  const base = deps.baseUrl.replace(/\/+$/, '');

  const credentialsFrom = (a: AuthResult): Credentials => ({ access: a.accessToken, refresh: a.refreshToken, accessExp: now() + a.expiresIn * 1000 });

  const vault = createVault({
    store: deps.secrets,
    randomBytes: deps.randomBytes,
    now,
    refresh: async (refreshToken) => credentialsFrom(await transport.request({ method: 'POST', path: apiPath`/auth/refresh`, body: { refreshToken }, decode: decodeAuth })),
  });

  /** A request as the signed-in account behind `handle`; one retry with a refreshed token if the server refuses it. */
  async function call<T>(handle: string, method: HttpMethod, path: ApiPath, decode: (json: unknown) => T, body?: unknown, idempotencyKey?: string): Promise<T> {
    const send = (token: string) => transport.request({ method, path, token, body, idempotencyKey, decode });
    try {
      return await send(await vault.access(handle));
    } catch (e) {
      if (!isApiError(e, 'UNAUTHENTICATED')) throw e;
      return send(await vault.access(handle, { force: true }));
    }
  }

  const publicCall = <T>(method: HttpMethod, path: ApiPath, decode: (json: unknown) => T, body?: unknown) =>
    transport.request({ method, path, body, decode });

  const uploader = createUploader({
    fetch: doFetch,
    ticket: (handle, kind: UploadKind, body) =>
      call(handle, 'POST', kind === 'photos' ? apiPath`/uploads/photos` : apiPath`/uploads/audio`, (j): UploadTicket => {
        const o = obj(j, 'upload');
        return { id: str(o, 'id'), uploadUrl: str(o, 'uploadUrl') };
      }, body),
  });

  async function signIn(role: Role, challengeId: string, code: string): Promise<{ handle: string; auth: AuthResult }> {
    const auth = await publicCall('POST', apiPath`/auth/otp/verify`, decodeAuth, { challengeId, code });
    const handle = await vault.create(role, credentialsFrom(auth));
    return { handle, auth };
  }

  async function signOut(handle: string): Promise<void> {
    const refreshToken = await vault.refreshToken(handle);
    if (refreshToken) await call(handle, 'POST', apiPath`/auth/logout`, decodeNothing, { refreshToken }).catch(() => undefined);
    uploader.forget(handle);
    await vault.forget(handle);
  }

  /** DELETE /me, then forget the session on this phone. */
  async function deleteAccount(handle: string): Promise<void> {
    await call(handle, 'DELETE', apiPath`/me`, decodeNothing);
    uploader.forget(handle);
    await vault.forget(handle);
  }

  /** null when the session has ended; other failures (no network) are thrown so the app can retry. */
  async function restoreWith<T>(handle: string, role: Role, read: () => Promise<T>): Promise<T | null> {
    if (roleOf(handle) !== role || !(await vault.has(handle))) return null;
    try {
      return await read();
    } catch (e) {
      if (isApiError(e, 'UNAUTHENTICATED')) {
        await vault.forget(handle);
        return null;
      }
      throw e;
    }
  }

  const requestOtp = (role: 'CUSTOMER' | 'TECHNICIAN') => (phone: string) =>
    publicCall('POST', apiPath`/auth/otp/request`, decodeChallenge, { phone: phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''), role });

  // ---------- customer ----------

  async function uploadPhotos(handle: string, photos: readonly Photo[], stage: PhotoStage): Promise<{ id: string }[]> {
    const out: { id: string }[] = [];
    for (const p of photos) out.push({ id: isLocalFile(p.uri) ? await uploader.upload(handle, 'photos', p.uri, stage) : p.id });
    return out;
  }

  function watchStream<T>(handle: string, path: ApiPath, event: string, decode: (j: unknown) => T, once: () => Promise<T>, onChange: (v: T) => void, onError?: (e: unknown) => void) {
    return openLiveStream({
      url: `${base}${path}`,
      event,
      accessToken: (force) => vault.access(handle, { force }),
      decode,
      fetchOnce: once,
      onChange,
      onError,
      pollMs: deps.pollMs,
    });
  }

  const bookings: BookingApi = {
    eta: (handle, serviceId, addressId) => call(handle, 'GET', apiPath`/eta?serviceId=${serviceId}&addressId=${addressId}`, (j) => {
      const m = obj(j, 'estimate').minutes;
      return { minutes: Array.isArray(m) && m.length === 2 && m.every((x) => typeof x === 'number') ? [m[0] as number, m[1] as number] as const : null };
    }),
    slots: (handle, serviceId, date) => call(handle, 'GET', apiPath`/slots?serviceId=${serviceId}&date=${date}`, (j) => list(j, decodeSlot, 'slots')),
    async create(handle, input, idempotencyKey) {
      const photos = await uploadPhotos(handle, input.problem.photos, 'PROBLEM');
      const vn = input.problem.voiceNote;
      const voiceNote = vn ? { durationSec: Math.max(1, Math.round(vn.durationSec)), transcript: vn.transcript, ...(vn.audioId ? { audioId: vn.audioId } : {}) } : null;
      const body = { serviceId: input.serviceId, problem: { issueIds: input.problem.issueIds, notes: input.problem.notes, voiceNote, photos }, addressId: input.addressId, time: input.time, preferWomenRated: input.preferWomenRated, ...(input.repeatOf ? { repeatOf: input.repeatOf } : {}) };
      return call(handle, 'POST', apiPath`/bookings`, decodeBooking, body, idempotencyKey);
    },
    async pay(handle, bookingId, kind, method, idempotencyKey): Promise<PaymentResult> {
      const started = await call(handle, 'POST', apiPath`/bookings/${bookingId}/payments`, (j) => obj(j, 'payment'), { kind, method }, idempotencyKey);
      // Cash for the bill: the booking waits for the technician to confirm they received it.
      if (!('orderId' in started)) return { booking: decodeBooking(started), state: 'PENDING' };
      const order = started as unknown as PaymentOrder;
      const verify = (outcome: { orderId: string; paymentId: string; signature: string }) =>
        call(handle, 'POST', apiPath`/payments/${order.paymentId}/verify`, (j): PaymentResult => {
          const o = obj(j, 'payment result');
          const state = str(o, 'state');
          if (state !== 'PAID' && state !== 'PENDING' && state !== 'FAILED') throw new DecodeError('state');
          return { state, booking: decodeBooking(o.booking) };
        }, { razorpayOrderId: outcome.orderId, razorpayPaymentId: outcome.paymentId, razorpaySignature: outcome.signature });
      // A team demo booking: no money moves, the server confirms at once.
      if (order.provider === 'SIMULATED') return verify({ orderId: order.orderId, paymentId: `sim_${order.paymentId}`, signature: 'simulated' });
      const outcome = await deps.openCheckout({ paymentId: order.paymentId, orderId: order.orderId, keyId: order.keyId, amount: order.amount, description: kind === 'VISIT' ? 'Visit fee' : 'Repair bill' });
      if (outcome.kind === 'paid') return verify(outcome);
      // Closed without finishing: what the server knows (Razorpay may still confirm a payment that went through).
      const booking = await bookings.get(handle, bookingId);
      const p = kind === 'VISIT' ? booking.visitPayment : booking.finalPayment;
      return { booking, state: p?.state === 'PAID' ? 'PAID' : p?.state === 'PENDING' ? 'PENDING' : 'FAILED' };
    },
    get: (handle, id) => call(handle, 'GET', apiPath`/bookings/${id}`, decodeBooking),
    list: (handle) => call(handle, 'GET', apiPath`/bookings?scope=${'all'}`, (j) => list(j, decodeBooking, 'bookings')),
    cancel: (handle, id, reason) => call(handle, 'POST', apiPath`/bookings/${id}/cancel`, decodeBooking, { reason }),
    reschedule: (handle, id, time) => call(handle, 'POST', apiPath`/bookings/${id}/reschedule`, decodeBooking, { time }),
    decideQuote: (handle, id, which, answer) => call(handle, 'POST', apiPath`/bookings/${id}/quotes/${which}/answer`, decodeBooking, { answer }),
    rate: (handle, id, r) => call(handle, 'POST', apiPath`/bookings/${id}/rating`, decodeBooking, { satisfied: r.satisfied, stars: r.stars, tags: r.tags, comment: r.comment, byWoman: r.byWoman === true }),
    technicianCard: (handle, id) => call(handle, 'GET', apiPath`/bookings/${id}/technician-card`, decodeTechIdCard),
    watch: (handle, id, onChange, onError) =>
      watchStream(handle, apiPath`/bookings/${id}/stream`, 'booking', decodeBooking, () => bookings.get(handle, id), onChange, onError),
    call: (handle, id) => call(handle, 'POST', apiPath`/bookings/${id}/call`, decodeDial),
  };

  const notificationsFor = (): NotificationApi => ({
    list: (handle) => call(handle, 'GET', apiPath`/notifications`, (j) => list(j, decodeNotification, 'notifications')),
    markRead: (handle, ids) => call(handle, 'POST', apiPath`/notifications/read`, decodeNothing, { ids }),
    registerDevice: (handle, device) => call(handle, 'POST', apiPath`/devices`, decodeNothing, device),
  });

  const ai: AiApi = {
    topProblems: (handle, pincode) =>
      call(handle, 'GET', pincode ? apiPath`/ai/top-problems?pincode=${pincode}` : apiPath`/ai/top-problems`, (j) => record(j, 'top problems', ['items'])),
    async classifyPhoto(handle, photo) {
      if (!isLocalFile(photo.uri)) return { serviceId: null, confidence: 0, alternatives: [] };
      const photoId = await uploader.upload(handle, 'photos', photo.uri, 'PROBLEM');
      return call(handle, 'POST', apiPath`/ai/classify-photo`, (j) => record(j, 'photo suggestion', ['serviceId', 'alternatives']), { photoId });
    },
    async transcribe(handle, recording, serviceId, locale) {
      const audioId = await uploader.upload(handle, 'audio', recording.uri);
      const text = await call(handle, 'POST', apiPath`/ai/transcribe`, (j) => str(obj(j, 'transcript'), 'text'), { audioId, serviceId, locale }).catch((e) => {
        // The recording is kept and sent with the booking even when it could not be written down.
        if (isApiError(e, 'NETWORK') || isApiError(e, 'TIMEOUT') || isApiError(e, 'SERVER_ERROR')) return '';
        throw e;
      });
      return { text, audioId };
    },
    chat: (handle, message, locale) => call(handle, 'POST', apiPath`/ai/chat`, (j) => record(j, 'chat reply', ['text', 'suggestions', 'offerHuman']), { message, locale }),
  };

  // ---------- technician ----------

  const techAction = (action: 'start-trip' | 'arrived' | 'start-work' | 'complete' | 'confirm-cash') => (handle: string, id: string) =>
    call(handle, 'POST', apiPath`/tech/jobs/${id}/${action}`, decodeJob);

  const tech: TechApi = {
    auth: {
      requestOtp: requestOtp('TECHNICIAN'),
      async verifyOtp(challengeId, code) {
        const { handle, auth } = await signIn('technician', challengeId, code);
        return { session: { token: handle, profile: decodeProfile(auth.technician) }, isNew: auth.isNew };
      },
      restore: (handle) => restoreWith(handle, 'technician', async () => ({ token: handle, profile: await tech.me(handle) })),
      signOut,
      deleteAccount,
    },
    me: (handle) => call(handle, 'GET', apiPath`/tech/me`, decodeProfile),
    async submitProfile(handle, input) {
      // The registration photo is uploaded once, on the first submission; later submissions keep it.
      const photoUploadId = input.photo && isLocalFile(input.photo) ? await uploader.upload(handle, 'photos', input.photo, 'PROFILE') : undefined;
      const { photo: _photo, ...rest } = input;
      return call(handle, 'PUT', apiPath`/tech/profile`, decodeProfile, { ...rest, ...(photoUploadId ? { photoUploadId } : {}) });
    },
    idCard: (handle) => call(handle, 'GET', apiPath`/tech/id-card`, decodeTechIdCard),
    requestIdentityCorrection: (handle, kind, note) => call(handle, 'POST', apiPath`/tech/identity-corrections`, decodeProfile, { kind, note }),
    setOnline: (handle, online) => call(handle, 'POST', apiPath`/tech/availability`, decodeProfile, { online }),
    offer: (handle) => call(handle, 'GET', apiPath`/tech/offers/current`, decodeOffer),
    acceptOffer: (handle, offerId) => call(handle, 'POST', apiPath`/tech/offers/${offerId}/accept`, decodeJob),
    rejectOffer: (handle, offerId, reason) => call(handle, 'POST', apiPath`/tech/offers/${offerId}/reject`, decodeNothing, { reason }),
    jobs: (handle) => call(handle, 'GET', apiPath`/tech/jobs?scope=${'all'}`, (j) => list(j, decodeJob, 'jobs')),
    job: (handle, id) => call(handle, 'GET', apiPath`/tech/jobs/${id}`, decodeJob),
    startTrip: techAction('start-trip'),
    arrived: techAction('arrived'),
    verifyStartCode: (handle, id, code) => call(handle, 'POST', apiPath`/tech/jobs/${id}/verify-start-code`, decodeJob, { code }),
    submitQuote: (handle, id, which, input) => call(handle, 'POST', apiPath`/tech/jobs/${id}/quotes`, decodeJob, { which, diagnosis: input.diagnosis, lines: input.lines }),
    startWork: techAction('start-work'),
    completeWork: techAction('complete'),
    confirmCash: techAction('confirm-cash'),
    report: (handle, id, issue, note) => call(handle, 'POST', apiPath`/tech/jobs/${id}/reports`, decodeJob, { issue, note }),
    earnings: (handle) => call(handle, 'GET', apiPath`/tech/earnings`, decodeEarnings),
    verifyAadhaar: (handle, qr) =>
      call(handle, 'POST', apiPath`/tech/aadhaar`, (j) => {
        const o = obj(j, 'aadhaar');
        return { last4: str(o, 'last4'), nameMatches: o.nameMatches === true, verifiedAt: num(o, 'verifiedAt') };
      }, { qr }),
    callCustomer: (handle, jobId) => call(handle, 'POST', apiPath`/tech/jobs/${jobId}/call`, decodeDial),
    sendLocation: (handle, position) => call(handle, 'POST', apiPath`/tech/location`, decodeNothing, position),
    watchJob: (handle, id, onChange, onError) =>
      watchStream(handle, apiPath`/tech/jobs/${id}/stream`, 'job', decodeJob, () => tech.job(handle, id), onChange, onError),
    notifications: notificationsFor(),
  };

  return {
    mode: 'LIVE',
    demo: null,
    auth: {
      requestOtp: requestOtp('CUSTOMER'),
      async verifyOtp(challengeId, code) {
        const { handle, auth } = await signIn('customer', challengeId, code);
        return { session: { token: handle, customer: decodeCustomer(auth.customer) }, isNewCustomer: auth.isNew };
      },
      restore: (handle) => restoreWith(handle, 'customer', async () => ({ token: handle, customer: await call(handle, 'GET', apiPath`/me`, decodeCustomer) })),
      updateName: (handle, name) => call(handle, 'PATCH', apiPath`/me`, decodeCustomer, { name }),
      signOut,
      deleteAccount,
    },
    catalog: {
      categories: () => publicCall('GET', apiPath`/catalog/categories`, (j) => list(j, decodeCategory, 'categories')),
      services: (categoryId) =>
        publicCall('GET', categoryId ? apiPath`/catalog/services?categoryId=${categoryId}` : apiPath`/catalog/services`, (j) => list(j, decodeService, 'services')),
      service: (id) => publicCall('GET', apiPath`/catalog/services/${id}`, decodeService),
    },
    addresses: {
      list: (handle) => call(handle, 'GET', apiPath`/addresses`, (j) => list(j, decodeAddress, 'addresses')),
      create: (handle, input) => call(handle, 'POST', apiPath`/addresses`, decodeAddress, input),
      update: (handle, id, input) => call(handle, 'PUT', apiPath`/addresses/${id}`, decodeAddress, input),
      remove: (handle, id) => call(handle, 'DELETE', apiPath`/addresses/${id}`, decodeNothing),
    },
    bookings,
    ai,
    notifications: notificationsFor(),
    tech,
    verify: {
      technician: (token) => publicCall('GET', apiPath`/verify/technicians/${token}`, decodeTechVerifyResult),
    },
    support: {
      callback: (handle, bookingId, reason) =>
        call(handle, 'POST', apiPath`/support/callback`, decodeNothing, { ...(bookingId ? { bookingId } : {}), ...(reason ? { reason: reason.slice(0, 300) } : {}) }),
      ticket: (handle, kind, bookingId, note) =>
        call(handle, 'POST', apiPath`/support/tickets`, decodeNothing, { kind, ...(bookingId ? { bookingId } : {}), ...(note ? { note: note.slice(0, 1000) } : {}) }),
    },
  };
}

/** For tests: the error a decoder throws. */
export { ApiError };
