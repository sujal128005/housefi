// DEMO BACKEND: an in-app stand-in for the Housefi API. It keeps synthetic customers, addresses and bookings on the
// device, simulates latency, OTP codes, payments, technician matching and the whole visit (sped up), and can be told
// to fail (Demo settings). Nothing here talks to a network, sends an SMS, takes money or contacts a real technician.
import { CATEGORIES, DEMO_TECHNICIANS, QUOTE_TEMPLATES, SAMPLE_PHOTO_SERVICE, SERVICES, serviceById, servicesIn, TOP_PROBLEMS } from '../../data/catalog';
import {
  canCancel, cancelRefundsVisitFee, canReschedule, DEMO_TIMING, etaMinutes, isInstantAvailable, isValidName, matchingStatusAt, normalizePhone,
  quoteTotal, slotsFor, validateAddress, windowStart, type MatchingScenario,
} from '../../domain/rules';
import type {
  Address, AddressInput, Booking, BookingStatus, CancelReason, Customer, Payment, PaymentMethod, Quote, QuoteLine, Session, StatusEvent, Technician,
  VisitTime,
} from '../../domain/types';
import {
  ApiError, type Backend, type ChatReply, type DemoOutcome, type DemoSettings, type KeyValueStore, type NewBooking, type OtpChallenge,
  type PaymentResult,
} from '../api';

const STORE_KEY = 'housefi.demo-backend.v2';
const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_SEC = 30;
const OTP_MAX_ATTEMPTS = 3;
const T = DEMO_TIMING;

interface StoredBooking extends Booking {
  /** Internal to the mock: which matching timeline, whether extra work turns up, when the current timed phase began. */
  readonly scenario: MatchingScenario;
  readonly extraWorkPlanned: boolean;
  readonly phaseStartedAt: number;
}

interface DemoState {
  customers: Record<string, Customer>;
  sessions: Record<string, string>;
  addresses: Record<string, Address[]>;
  bookings: Record<string, StoredBooking[]>;
  settings: DemoSettings;
}

interface Challenge {
  readonly id: string;
  readonly phone: string;
  readonly code: string;
  readonly expiresAt: number;
  attempts: number;
}

export interface MockOptions {
  readonly store: KeyValueStore;
  readonly now?: () => number;
  /** Simulated network latency in ms: [min, max]. Use [0, 0] in tests. */
  readonly latency?: readonly [number, number];
  readonly random?: () => number;
  /** Poll interval for watch(), ms. */
  readonly pollMs?: number;
}

const DEFAULT_SETTINGS: DemoSettings = { matching: 'QUICK', failNext: 'OFF', payment: 'SUCCESS', extraWork: false };

const emptyState = (): DemoState => ({ customers: {}, sessions: {}, addresses: {}, bookings: {}, settings: DEFAULT_SETTINGS });

const due = (kind: 'VISIT' | 'FINAL', amount: number): Payment => ({ kind, amount, state: 'DUE', method: null, txnId: null, at: null });

export function createMockBackend(opts: MockOptions): Backend {
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;
  const [minLat, maxLat] = opts.latency ?? [300, 700];
  const pollMs = opts.pollMs ?? 1000;
  const challenges = new Map<string, Challenge>();
  let state: DemoState | null = null;

  const id = (prefix: string) => `${prefix}_${now().toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');

  async function load(): Promise<DemoState> {
    if (state) return state;
    const raw = await opts.store.get(STORE_KEY);
    try {
      const parsed = raw ? (JSON.parse(raw) as DemoState) : null;
      state = parsed ? { ...emptyState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } } : emptyState();
    } catch {
      state = emptyState();
    }
    return state;
  }

  async function save(): Promise<void> {
    if (state) await opts.store.set(STORE_KEY, JSON.stringify(state));
  }

  async function delay(): Promise<void> {
    const ms = minLat + Math.floor(random() * Math.max(0, maxLat - minLat));
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  /** Every request: latency, then a forced failure if Demo settings asked for one. */
  async function request(kind: 'READ' | 'BOOKING_CREATE' | 'WRITE'): Promise<DemoState> {
    await delay();
    const s = await load();
    const fail = s.settings.failNext;
    if (fail === 'NETWORK') {
      s.settings = { ...s.settings, failNext: 'OFF' };
      await save();
      throw new ApiError('NETWORK', { simulated: true });
    }
    if (fail === 'SLOT_TAKEN' && kind === 'BOOKING_CREATE') {
      s.settings = { ...s.settings, failNext: 'OFF' };
      await save();
      throw new ApiError('SLOT_UNAVAILABLE', { simulated: true });
    }
    return s;
  }

  function customerFor(s: DemoState, token: string): Customer {
    const cid = s.sessions[token];
    const c = cid ? Object.values(s.customers).find((x) => x.id === cid) : undefined;
    if (!c) throw new ApiError('UNAUTHENTICATED');
    return c;
  }

  function pickTechnician(b: StoredBooking): Technician | null {
    const pool = DEMO_TECHNICIANS[b.categoryId] ?? [];
    if (b.preferWomenRated) return pool.find((x) => x.womenRated) ?? pool[0] ?? null;
    return pool[0] ?? null;
  }

  function makeQuote(b: StoredBooking, at: number): Quote {
    const tpl = QUOTE_TEMPLATES[b.categoryId] ?? QUOTE_TEMPLATES.PLUMBING;
    const svc = serviceById(b.serviceId);
    let lines: QuoteLine[] = [...(tpl?.lines ?? [])];
    const floor = svc?.repairFrom ?? 100;
    const short = floor - quoteTotal(lines);
    if (short > 0 && lines[0]) lines = [{ ...lines[0], unitPrice: lines[0].unitPrice + short }, ...lines.slice(1)];
    return { id: id('qt'), lines, total: quoteTotal(lines), diagnosis: tpl?.diagnosis ?? { en: '', te: '' }, decision: 'PENDING', at };
  }

  function makeExtraQuote(b: StoredBooking, at: number): Quote {
    const tpl = QUOTE_TEMPLATES[b.categoryId] ?? QUOTE_TEMPLATES.PLUMBING;
    const lines = tpl ? [tpl.extra.line] : [];
    return { id: id('qx'), lines, total: quoteTotal(lines), diagnosis: tpl?.extra.diagnosis ?? { en: '', te: '' }, decision: 'PENDING', at };
  }

  function go(b: StoredBooking, status: BookingStatus, at: number, patch: Partial<StoredBooking> = {}): StoredBooking {
    const ev: StatusEvent = { status, at };
    return { ...b, ...patch, status, phaseStartedAt: at, history: [...b.history, ev] };
  }

  /** Moves a booking along its timed demo lifecycle until it waits for time or for the customer. */
  function advance(b0: StoredBooking): StoredBooking {
    let b = b0;
    const t = now();
    for (let guard = 0; guard < 12; guard++) {
      const el = (t - b.phaseStartedAt) / 1000;
      let next: StoredBooking | null = null;
      switch (b.status) {
        case 'PAYMENT_PENDING':
          if (el >= T.paymentPendingSec) {
            const at = b.phaseStartedAt + T.paymentPendingSec * 1000;
            next = go(b, 'MATCHING', at, { visitPayment: { ...b.visitPayment, state: 'PAID', txnId: `DEMO${digits(10)}`, at } });
          }
          break;
        case 'MATCHING':
        case 'MATCHING_DELAYED': {
          const target = matchingStatusAt(b.scenario, el);
          if (target !== b.status) {
            const tl = T.matching[b.scenario];
            if (target === 'MATCHING_DELAYED') next = go(b, 'MATCHING_DELAYED', b.phaseStartedAt + (tl.delayedAt ?? 0) * 1000, { phaseStartedAt: b.phaseStartedAt });
            else {
              const at = b.phaseStartedAt + tl.endAt * 1000;
              const withDelay = b.status === 'MATCHING' && tl.delayedAt !== null
                ? { ...b, history: [...b.history, { status: 'MATCHING_DELAYED' as BookingStatus, at: b.phaseStartedAt + tl.delayedAt * 1000 }] } : b;
              next = target === 'ASSIGNED' ? go(withDelay, 'ASSIGNED', at, { technician: pickTechnician(b) }) : go(withDelay, target, at);
            }
            // MATCHING_DELAYED keeps the original matching start so the end time stays on the same timeline.
            if (next && target === 'MATCHING_DELAYED') next = { ...next, phaseStartedAt: b.phaseStartedAt };
          }
          break;
        }
        case 'ASSIGNED': {
          const startAt = b.time.mode === 'INSTANT' ? b.phaseStartedAt + T.startTravelSec * 1000
            : b.time.window ? windowStart(b.time.window).getTime() - 30 * 60_000 : Infinity;
          if (t >= startAt) next = go(b, 'EN_ROUTE', startAt);
          break;
        }
        case 'EN_ROUTE':
          if (el >= T.travelSec) next = go(b, 'ARRIVED', b.phaseStartedAt + T.travelSec * 1000, { etaMin: null });
          break;
        case 'ARRIVED':
          if (el >= T.verifyOtpSec) next = go(b, 'INSPECTING', b.phaseStartedAt + T.verifyOtpSec * 1000);
          break;
        case 'INSPECTING':
          if (el >= T.inspectSec) {
            const at = b.phaseStartedAt + T.inspectSec * 1000;
            next = go(b, 'QUOTE_SHARED', at, { quote: makeQuote(b, at) });
          }
          break;
        case 'IN_PROGRESS':
          if (b.extraWorkPlanned && !b.extraQuote && el >= T.extraWorkAtSec) {
            const at = b.phaseStartedAt + T.extraWorkAtSec * 1000;
            next = go(b, 'EXTRA_WORK', at, { extraQuote: makeExtraQuote(b, at) });
          } else {
            const doneAfter = b.extraQuote ? T.workAfterExtraSec : T.workSec;
            if ((!b.extraWorkPlanned || b.extraQuote) && el >= doneAfter) {
              const at = b.phaseStartedAt + doneAfter * 1000;
              const amount = (b.quote?.decision === 'APPROVED' ? b.quote.total : 0) + (b.extraQuote?.decision === 'APPROVED' ? b.extraQuote.total : 0);
              next = go(b, 'PAYMENT_DUE', at, { finalPayment: due('FINAL', amount) });
            }
          }
          break;
        case 'PAYMENT_DUE':
          if (b.finalPayment?.state === 'PENDING' && el >= T.paymentPendingSec) {
            const at = b.phaseStartedAt + T.paymentPendingSec * 1000;
            next = go(b, 'COMPLETED', at, { finalPayment: { ...b.finalPayment, state: 'PAID', txnId: `DEMO${digits(10)}`, at } });
          }
          break;
        default:
          break;
      }
      if (!next) break;
      b = next;
    }
    return b;
  }

  function publicBooking(b: StoredBooking): Booking {
    const { scenario: _s, extraWorkPlanned: _e, phaseStartedAt, ...rest } = b;
    const etaMin = b.status === 'EN_ROUTE' ? etaMinutes(T.travelSec - (now() - phaseStartedAt) / 1000) : null;
    return { ...rest, etaMin };
  }

  function findBooking(s: DemoState, customerId: string, bookingId: string): { list: StoredBooking[]; index: number } {
    const list = s.bookings[customerId] ?? [];
    const index = list.findIndex((b) => b.id === bookingId);
    if (index < 0) throw new ApiError('NOT_FOUND');
    return { list, index };
  }

  /** Loads a booking, advances it, saves if changed, and hands back both forms. */
  async function touch(token: string, bookingId: string): Promise<{ s: DemoState; list: StoredBooking[]; index: number; b: StoredBooking }> {
    const s = await load();
    const c = customerFor(s, token);
    const { list, index } = findBooking(s, c.id, bookingId);
    const cur = list[index] as StoredBooking;
    const b = advance(cur);
    if (b !== cur) {
      list[index] = b;
      await save();
    }
    return { s, list, index, b };
  }

  async function store(list: StoredBooking[], index: number, b: StoredBooking): Promise<Booking> {
    list[index] = b;
    await save();
    return publicBooking(b);
  }

  const backend: Backend = {
    mode: 'DEMO',

    auth: {
      async requestOtp(phone) {
        await request('WRITE');
        const p = normalizePhone(phone);
        if (!p) throw new ApiError('VALIDATION');
        const ch: Challenge = { id: id('otp'), phone: p, code: digits(6), expiresAt: now() + OTP_TTL_MS, attempts: 0 };
        challenges.set(ch.id, ch);
        const out: OtpChallenge = { challengeId: ch.id, phone: p, resendAfterSec: OTP_RESEND_SEC, expiresAt: ch.expiresAt, demoCode: ch.code };
        return out;
      },

      async verifyOtp(challengeId, code) {
        const s = await request('WRITE');
        const ch = challenges.get(challengeId);
        if (!ch) throw new ApiError('OTP_EXPIRED');
        if (now() > ch.expiresAt) {
          challenges.delete(challengeId);
          throw new ApiError('OTP_EXPIRED');
        }
        if (ch.attempts >= OTP_MAX_ATTEMPTS) throw new ApiError('OTP_LOCKED');
        if (code !== ch.code) {
          ch.attempts += 1;
          const left = OTP_MAX_ATTEMPTS - ch.attempts;
          throw left <= 0 ? new ApiError('OTP_LOCKED') : new ApiError('OTP_INVALID', { attemptsLeft: left });
        }
        challenges.delete(challengeId);
        const existing = s.customers[ch.phone];
        const customer: Customer = existing ?? { id: id('cus'), phone: ch.phone, name: '' };
        s.customers[ch.phone] = customer;
        const token = id('tok');
        s.sessions[token] = customer.id;
        await save();
        const session: Session = { token, customer };
        return { session, isNewCustomer: !existing || customer.name === '' };
      },

      async restore(token) {
        const s = await load();
        try {
          return { token, customer: customerFor(s, token) };
        } catch {
          return null;
        }
      },

      async updateName(token, name) {
        const s = await request('WRITE');
        if (!isValidName(name)) throw new ApiError('VALIDATION');
        const c = customerFor(s, token);
        const updated: Customer = { ...c, name: name.trim() };
        s.customers[c.phone] = updated;
        await save();
        return updated;
      },

      async signOut(token) {
        const s = await load();
        delete s.sessions[token];
        await save();
      },
    },

    catalog: {
      async categories() {
        await request('READ');
        return CATEGORIES;
      },
      async services(categoryId) {
        await request('READ');
        return categoryId ? servicesIn(categoryId) : SERVICES;
      },
      async service(serviceId) {
        await request('READ');
        const svc = serviceById(serviceId);
        if (!svc) throw new ApiError('NOT_FOUND');
        return svc;
      },
    },

    addresses: {
      async list(token) {
        const s = await request('READ');
        return s.addresses[customerFor(s, token).id] ?? [];
      },
      async create(token, input) {
        const s = await request('WRITE');
        const c = customerFor(s, token);
        if (Object.keys(validateAddress(input)).length > 0) throw new ApiError('VALIDATION');
        const a: Address = { ...clean(input), id: id('adr') };
        s.addresses[c.id] = [...(s.addresses[c.id] ?? []), a];
        await save();
        return a;
      },
      async update(token, addressId, input) {
        const s = await request('WRITE');
        const c = customerFor(s, token);
        if (Object.keys(validateAddress(input)).length > 0) throw new ApiError('VALIDATION');
        const list = s.addresses[c.id] ?? [];
        const k = list.findIndex((a) => a.id === addressId);
        if (k < 0) throw new ApiError('NOT_FOUND');
        const a: Address = { ...(list[k] as Address), ...clean(input) };
        list[k] = a;
        await save();
        return a;
      },
      async remove(token, addressId) {
        const s = await request('WRITE');
        const c = customerFor(s, token);
        s.addresses[c.id] = (s.addresses[c.id] ?? []).filter((a) => a.id !== addressId);
        await save();
      },
    },

    bookings: {
      async slots(serviceId, date) {
        await request('READ');
        return slotsFor(date, serviceId, new Date(now()));
      },

      async create(token, input: NewBooking) {
        const s = await request('BOOKING_CREATE');
        const c = customerFor(s, token);
        const svc = serviceById(input.serviceId);
        if (!svc) throw new ApiError('NOT_FOUND');
        const address = (s.addresses[c.id] ?? []).find((a) => a.id === input.addressId);
        if (!address) throw new ApiError('VALIDATION');
        assertTimeOpen(input.serviceId, input.time);
        const t = now();
        const b: StoredBooking = {
          id: id('bkg'),
          code: `HF-${digits(5)}`,
          serviceId: svc.id,
          categoryId: svc.categoryId,
          problem: input.problem,
          address,
          time: input.time,
          preferWomenRated: input.preferWomenRated,
          status: 'AWAITING_PAYMENT',
          technician: null,
          arrivalOtp: String(1000 + Math.floor(random() * 9000)),
          etaMin: null,
          visitPayment: due('VISIT', svc.visitFee),
          quote: null,
          extraQuote: null,
          finalPayment: null,
          rating: null,
          createdAt: t,
          history: [{ status: 'AWAITING_PAYMENT', at: t }],
          cancelReason: null,
          demo: true,
          scenario: s.settings.matching,
          extraWorkPlanned: s.settings.extraWork,
          phaseStartedAt: t,
        };
        s.bookings[c.id] = [b, ...(s.bookings[c.id] ?? [])];
        await save();
        return publicBooking(b);
      },

      async pay(token, bookingId, kind, method: PaymentMethod) {
        const s0 = await request('WRITE');
        const outcome = s0.settings.payment;
        // A forced pending / failed outcome applies to one payment only, like the other demo failures.
        if (outcome !== 'SUCCESS') s0.settings = { ...s0.settings, payment: 'SUCCESS' };
        const { list, index, b } = await touch(token, bookingId);
        const t = now();
        const simulatedTxn = `DEMO${digits(10)}`;
        if (kind === 'VISIT') {
          if (b.status !== 'AWAITING_PAYMENT') throw new ApiError('CONFLICT');
          if (method === 'CASH') throw new ApiError('VALIDATION');
          if (outcome === 'FAILED') {
            const nb = { ...b, visitPayment: { ...b.visitPayment, state: 'FAILED' as const, method, at: t } };
            return { booking: await store(list, index, nb), state: 'FAILED' } satisfies PaymentResult;
          }
          if (outcome === 'PENDING') {
            const nb = go(b, 'PAYMENT_PENDING', t, { visitPayment: { ...b.visitPayment, state: 'PENDING', method, at: t } });
            return { booking: await store(list, index, nb), state: 'PENDING' };
          }
          const nb = go(b, 'MATCHING', t, { visitPayment: { ...b.visitPayment, state: 'PAID', method, txnId: simulatedTxn, at: t } });
          return { booking: await store(list, index, nb), state: 'PAID' };
        }
        if (b.status !== 'PAYMENT_DUE' || !b.finalPayment) throw new ApiError('CONFLICT');
        if (outcome === 'FAILED' && method !== 'CASH') {
          const nb = { ...b, finalPayment: { ...b.finalPayment, state: 'FAILED' as const, method, at: t } };
          return { booking: await store(list, index, nb), state: 'FAILED' };
        }
        if (outcome === 'PENDING' && method !== 'CASH') {
          const nb = { ...b, phaseStartedAt: t, finalPayment: { ...b.finalPayment, state: 'PENDING' as const, method, at: t } };
          return { booking: await store(list, index, nb), state: 'PENDING' };
        }
        const nb = go(b, 'COMPLETED', t, { finalPayment: { ...b.finalPayment, state: 'PAID', method, txnId: method === 'CASH' ? null : simulatedTxn, at: t } });
        return { booking: await store(list, index, nb), state: 'PAID' };
      },

      async get(token, bookingId) {
        await request('READ');
        return publicBooking((await touch(token, bookingId)).b);
      },

      async list(token) {
        const s = await request('READ');
        const c = customerFor(s, token);
        const list = (s.bookings[c.id] ?? []).map(advance);
        s.bookings[c.id] = list;
        await save();
        return list.map(publicBooking);
      },

      async cancel(token, bookingId, reason: CancelReason | null) {
        await request('WRITE');
        const { list, index, b } = await touch(token, bookingId);
        if (!canCancel(b.status)) throw new ApiError('CONFLICT');
        const refund = cancelRefundsVisitFee(b.status);
        const nb = go(b, 'CANCELLED', now(), {
          cancelReason: reason,
          visitPayment: refund && b.visitPayment.state === 'PAID' ? { ...b.visitPayment, state: 'REFUNDED' } : b.visitPayment,
        });
        return store(list, index, nb);
      },

      async reschedule(token, bookingId, time: VisitTime) {
        const s = await request('WRITE');
        const { list, index, b } = await touch(token, bookingId);
        if (!canReschedule(b.status)) throw new ApiError('CONFLICT');
        assertTimeOpen(b.serviceId, time);
        const nb = go(b, 'MATCHING', now(), { time, technician: null, scenario: s.settings.matching });
        return store(list, index, nb);
      },

      async decideQuote(token, bookingId, which, approve) {
        await request('WRITE');
        const { list, index, b } = await touch(token, bookingId);
        const t = now();
        if (which === 'MAIN') {
          if (b.status !== 'QUOTE_SHARED' || !b.quote) throw new ApiError('CONFLICT');
          const quote: Quote = { ...b.quote, decision: approve ? 'APPROVED' : 'REJECTED' };
          return store(list, index, go(b, approve ? 'IN_PROGRESS' : 'CLOSED_NO_REPAIR', t, { quote }));
        }
        if (b.status !== 'EXTRA_WORK' || !b.extraQuote) throw new ApiError('CONFLICT');
        const extraQuote: Quote = { ...b.extraQuote, decision: approve ? 'APPROVED' : 'REJECTED' };
        return store(list, index, go(b, 'IN_PROGRESS', t, { extraQuote }));
      },

      async rate(token, bookingId, rating) {
        await request('WRITE');
        const { list, index, b } = await touch(token, bookingId);
        if (b.status !== 'COMPLETED' && b.status !== 'CLOSED_NO_REPAIR') throw new ApiError('CONFLICT');
        if (rating.stars < 1 || rating.stars > 5) throw new ApiError('VALIDATION');
        return store(list, index, { ...b, rating: { ...rating, at: now() } });
      },

      watch(token, bookingId, onChange, onError) {
        let last = '';
        let stopped = false;
        const tick = async () => {
          try {
            const b = publicBooking((await touch(token, bookingId)).b);
            const sig = JSON.stringify([b.status, b.history.length, b.etaMin, b.quote?.decision, b.extraQuote?.decision, b.visitPayment.state,
              b.finalPayment?.state, b.rating?.stars, b.time]);
            if (!stopped && sig !== last) {
              last = sig;
              onChange(b);
            }
          } catch (e) {
            if (!stopped) onError?.(e);
          }
        };
        void tick();
        const timer = setInterval(() => void tick(), pollMs);
        return () => {
          stopped = true;
          clearInterval(timer);
        };
      },
    },

    ai: {
      async classifyPhoto(photo) {
        await delay();
        await delay();
        if (photo.sample !== undefined) {
          const svc = SAMPLE_PHOTO_SERVICE[photo.sample] ?? null;
          return { serviceId: svc, confidence: svc ? 0.92 : 0, alternatives: TOP_PROBLEMS.map((p) => p.serviceId).filter((x) => x !== svc).slice(0, 3) };
        }
        // The demo AI cannot look at real photos yet: it offers the most common services instead of guessing.
        return { serviceId: null, confidence: 0, alternatives: TOP_PROBLEMS.map((p) => p.serviceId).slice(0, 4) };
      },

      async transcribe(_durationSec, serviceId, locale) {
        await delay();
        const cat = serviceId ? serviceById(serviceId)?.categoryId : undefined;
        const text = TRANSCRIPTS[cat ?? 'DEFAULT'] ?? TRANSCRIPTS.DEFAULT;
        return text ? text[locale] : '';
      },

      async chat(token, message, locale) {
        await delay();
        const s = await load();
        const c = customerFor(s, token);
        const active = (s.bookings[c.id] ?? []).map(advance).find((b) => !['COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED'].includes(b.status));
        return reply(message, locale, active ? publicBooking(active) : null);
      },
    },

    demo: {
      async settings() {
        return (await load()).settings;
      },
      async updateSettings(patch) {
        const s = await load();
        s.settings = { ...s.settings, ...patch };
        await save();
        return s.settings;
      },
      async simulate(token, bookingId, outcome: DemoOutcome) {
        const { list, index, b } = await touch(token, bookingId);
        const t = now();
        if (outcome === 'NEXT') {
          // Pretend the current timed phase is over; customer decisions (quote, payment) still wait for the customer.
          if (b.status === 'ASSIGNED' && b.time.mode === 'SCHEDULED') return store(list, index, go(b, 'EN_ROUTE', t));
          const sec = phaseSec(b);
          if (sec === null) return publicBooking(b);
          // Start the current phase exactly `sec` ago: the next transition happens now, and the following phase
          // starts now, so only one step is taken.
          return store(list, index, advance({ ...b, phaseStartedAt: t - sec * 1000 }));
        }
        if (!['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED'].includes(b.status)) throw new ApiError('CONFLICT');
        if (outcome === 'DELAY') {
          const startedAt = t - (T.matching.SLOW.delayedAt ?? 0) * 1000;
          return store(list, index, { ...go(b, 'MATCHING_DELAYED', t), scenario: 'SLOW', phaseStartedAt: startedAt });
        }
        if (outcome === 'ASSIGN') return store(list, index, go(b, 'ASSIGNED', t, { technician: pickTechnician(b) }));
        return store(list, index, go(b, 'UNFULFILLED', t));
      },
      async reset() {
        state = emptyState();
        challenges.clear();
        await opts.store.remove(STORE_KEY);
      },
    },
  };

  /** Seconds the current timed phase lasts; null when the booking waits for the customer or is finished. */
  function phaseSec(b: StoredBooking): number | null {
    switch (b.status) {
      case 'PAYMENT_PENDING': return T.paymentPendingSec;
      case 'MATCHING':
      case 'MATCHING_DELAYED': return T.matching[b.scenario].endAt;
      case 'ASSIGNED': return b.time.mode === 'INSTANT' ? T.startTravelSec : null;
      case 'EN_ROUTE': return T.travelSec;
      case 'ARRIVED': return T.verifyOtpSec;
      case 'INSPECTING': return T.inspectSec;
      case 'IN_PROGRESS': return b.extraWorkPlanned && !b.extraQuote ? T.extraWorkAtSec : b.extraQuote ? T.workAfterExtraSec : T.workSec;
      case 'PAYMENT_DUE': return b.finalPayment?.state === 'PENDING' ? T.paymentPendingSec : null;
      default: return null;
    }
  }

  function assertTimeOpen(serviceId: string, time: VisitTime): void {
    if (time.mode === 'INSTANT') {
      if (!isInstantAvailable(new Date(now()))) throw new ApiError('INSTANT_UNAVAILABLE');
      return;
    }
    const w = time.window;
    if (!w) throw new ApiError('VALIDATION');
    const slot = slotsFor(w.date, serviceId, new Date(now())).find((x) => x.startHour === w.startHour);
    if (!slot || slot.state !== 'OPEN') throw new ApiError('SLOT_UNAVAILABLE');
  }

  return backend;
}

function clean(a: AddressInput): AddressInput {
  const base = { label: a.label, house: a.house.trim(), street: a.street.trim(), landmark: a.landmark.trim(), city: a.city.trim(), pincode: a.pincode.trim() };
  return a.lat !== undefined && a.lng !== undefined ? { ...base, lat: a.lat, lng: a.lng } : base;
}

const TRANSCRIPTS: Readonly<Record<string, { en: string; te: string }>> = {
  PLUMBING: { en: 'Water is leaking under the kitchen sink since yesterday and the floor gets wet.', te: 'నిన్నటి నుండి కిచెన్ సింక్ కింద నీరు కారుతోంది, నేల తడిసిపోతోంది.' },
  ELECTRICAL: { en: 'The bedroom fan stopped working and the switch makes a sparking sound.', te: 'బెడ్‌రూమ్ ఫ్యాన్ ఆగిపోయింది, స్విచ్ నుండి నిప్పురవ్వల శబ్దం వస్తోంది.' },
  AC: { en: 'The AC is running but not cooling, and water drips from the indoor unit.', te: 'ఏసీ నడుస్తోంది కానీ చల్లబడటం లేదు, లోపలి యూనిట్ నుండి నీరు కారుతోంది.' },
  APPLIANCE: { en: 'The washing machine does not drain and makes a loud noise while spinning.', te: 'వాషింగ్ మెషిన్ నీరు బయటకు పోవడం లేదు, తిరిగేటప్పుడు పెద్ద శబ్దం చేస్తోంది.' },
  CLEANING: { en: 'The bathroom tiles have hard-water stains and need a deep clean.', te: 'బాత్రూమ్ టైల్స్‌పై ఉప్పునీటి మరకలు ఉన్నాయి, డీప్ క్లీనింగ్ కావాలి.' },
  CARPENTRY: { en: 'The main door does not close properly and the lock is stuck.', te: 'మెయిన్ డోర్ సరిగా మూసుకోవడం లేదు, తాళం ఇరుక్కుపోయింది.' },
  DEFAULT: { en: 'The problem started yesterday and it is getting worse. Please check it soon.', te: 'సమస్య నిన్న మొదలైంది, ఇంకా పెరుగుతోంది. దయచేసి త్వరగా చూడండి.' },
};

/** Rule-based stand-in for the AI support assistant. */
function reply(message: string, locale: 'en' | 'te', active: Booking | null): ChatReply {
  const m = message.toLowerCase();
  const te = locale === 'te';
  const has = (...words: string[]) => words.some((w) => m.includes(w));
  const S = {
    track: te ? 'నా టెక్నీషియన్ ఎక్కడ?' : 'Where is my technician?',
    price: te ? 'ధర ఎంత?' : 'How much will it cost?',
    cancel: te ? 'బుకింగ్ రద్దు' : 'Cancel my booking',
    refund: te ? 'రీఫండ్' : 'Refund',
    human: te ? 'మనిషితో మాట్లాడాలి' : 'Talk to a person',
  };
  const chips = [S.track, S.price, S.cancel, S.human];
  if (has('person', 'human', 'agent', 'call', 'customer care', 'మనిషి', 'కాల్')) {
    return { text: te ? 'సరే, మా సపోర్ట్ టీమ్‌కు కనెక్ట్ చేస్తాను. కింద "కస్టమర్ కేర్‌కు కాల్" నొక్కండి.' : 'Sure, I can connect you to our support team. Tap "Call customer care" below.', suggestions: [], offerHuman: true };
  }
  if (has('where', 'technician', 'eta', 'late', 'track', 'ఎక్కడ', 'టెక్నీషియన్')) {
    if (!active) return { text: te ? 'మీకు ఇప్పుడు యాక్టివ్ బుకింగ్ లేదు.' : "You don't have an active booking right now.", suggestions: chips, offerHuman: false };
    const name = active.technician ? (te ? active.technician.name.te : active.technician.name.en) : null;
    const line = active.status === 'EN_ROUTE' && name
      ? (te ? `${name} దారిలో ఉన్నారు, సుమారు ${active.etaMin ?? 10} నిమిషాల్లో వస్తారు.` : `${name} is on the way and should reach you in about ${active.etaMin ?? 10} min.`)
      : name ? (te ? `${name} మీ బుకింగ్ ${active.code} కు కేటాయించబడ్డారు.` : `${name} is assigned to your booking ${active.code}.`)
        : (te ? `బుకింగ్ ${active.code} కోసం టెక్నీషియన్‌ను వెతుకుతున్నాం.` : `We're still finding a technician for booking ${active.code}.`);
    return { text: line, suggestions: [S.cancel, S.human], offerHuman: false };
  }
  if (has('price', 'cost', 'fee', 'charge', 'how much', 'ధర', 'ఫీజు')) {
    return { text: te ? 'విజిట్ ఫీజు ₹49, బుకింగ్ సమయంలో చెల్లిస్తారు. రిపేర్, సామగ్రి ధర తనిఖీ తర్వాత చెబుతారు (₹100 నుండి). మీరు ఒప్పుకున్న తర్వాతే పని మొదలవుతుంది.' : 'The visit fee is ₹49, paid when you book. Repair and material charges are quoted after the inspection (from ₹100), and work starts only after you approve.', suggestions: [S.track, S.human], offerHuman: false };
  }
  if (has('cancel', 'రద్దు')) {
    return { text: te ? 'టెక్నీషియన్ బయలుదేరే ముందు రద్దు చేస్తే ₹49 పూర్తిగా తిరిగి వస్తుంది. బుకింగ్ స్క్రీన్‌లో "బుకింగ్ రద్దు చేయండి" నొక్కండి.' : 'If you cancel before the technician starts travelling, the ₹49 is refunded in full. Open the booking and tap "Cancel booking".', suggestions: [S.refund, S.human], offerHuman: false };
  }
  if (has('refund', 'money back', 'రీఫండ్')) {
    return { text: te ? 'రీఫండ్‌లు 5–7 పని దినాల్లో మీ అసలు చెల్లింపు విధానానికి వస్తాయి (డెమోలో డబ్బు కదలదు).' : 'Refunds reach your original payment method in 5–7 working days (no money moves in this demo).', suggestions: [S.human], offerHuman: false };
  }
  if (/\b(hi|hello|hey|namaste)\b/.test(m) || has('నమస్తే', 'హలో')) {
    return { text: te ? 'నమస్తే! నేను Housefi అసిస్టెంట్‌ని. మీకు ఎలా సహాయం చేయగలను?' : "Hi! I'm the Housefi assistant. How can I help?", suggestions: chips, offerHuman: false };
  }
  return { text: te ? 'క్షమించండి, అది నాకు అర్థం కాలేదు. కింద ఒకటి ఎంచుకోండి, లేదా మా టీమ్‌తో మాట్లాడండి.' : "Sorry, I didn't get that. Pick one below, or talk to our team.", suggestions: chips, offerHuman: true };
}

/** In-memory store for tests. */
export function memoryStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      data.set(k, v);
    },
    async remove(k) {
      data.delete(k);
    },
  };
}
