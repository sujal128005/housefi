// DEMO BACKEND: an in-app stand-in for the Housefi API. It keeps synthetic customers, addresses and bookings on the
// device, simulates network latency, OTP codes and technician matching, and can be told to fail (Demo settings).
// Nothing here talks to a network, sends an SMS or contacts a real technician.
import { CATEGORIES, DEMO_TECHNICIANS, SERVICES, serviceById, servicesIn } from '../../data/catalog';
import { matchingStatusAt, MATCHING_TIMELINE, slotsFor, validateAddress, isValidName, normalizePhone, type MatchingScenario } from '../../domain/rules';
import type { Address, AddressInput, Booking, BookingStatus, CancelReason, Customer, Session, StatusEvent, VisitWindow } from '../../domain/types';
import {
  ApiError, type Backend, type DemoOutcome, type DemoSettings, type KeyValueStore, type NewBooking, type OtpChallenge,
} from '../api';

const STORE_KEY = 'housefi.demo-backend.v1';
const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_SEC = 30;
const OTP_MAX_ATTEMPTS = 3;

interface StoredBooking extends Booking {
  /** Which demo timeline this round of matching follows. Internal to the mock. */
  readonly scenario: MatchingScenario;
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

const emptyState = (): DemoState => ({
  customers: {}, sessions: {}, addresses: {}, bookings: {}, settings: { matching: 'QUICK', failNext: 'OFF' },
});

export function createMockBackend(opts: MockOptions): Backend {
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;
  const [minLat, maxLat] = opts.latency ?? [350, 800];
  const pollMs = opts.pollMs ?? 1000;
  const challenges = new Map<string, Challenge>();
  let state: DemoState | null = null;

  const id = (prefix: string) => `${prefix}_${now().toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');

  async function load(): Promise<DemoState> {
    if (state) return state;
    const raw = await opts.store.get(STORE_KEY);
    try {
      state = raw ? { ...emptyState(), ...(JSON.parse(raw) as DemoState) } : emptyState();
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

  /** Moves a booking along its demo matching timeline. Returns true when it changed. */
  function advance(b: StoredBooking): StoredBooking {
    if (b.status !== 'MATCHING' && b.status !== 'MATCHING_DELAYED') return b;
    const elapsed = (now() - b.matchingStartedAt) / 1000;
    const next = matchingStatusAt(b.scenario, elapsed);
    if (next === b.status) return b;
    const t = MATCHING_TIMELINE[b.scenario];
    const events: StatusEvent[] = [];
    if (next !== 'MATCHING_DELAYED' && b.status === 'MATCHING' && t.delayedAt !== null) {
      events.push({ status: 'MATCHING_DELAYED', at: b.matchingStartedAt + t.delayedAt * 1000 });
    }
    const at = next === 'MATCHING_DELAYED' && t.delayedAt !== null ? b.matchingStartedAt + t.delayedAt * 1000 : b.matchingStartedAt + t.endAt * 1000;
    events.push({ status: next, at });
    return withStatus(b, next, events);
  }

  function withStatus(b: StoredBooking, status: BookingStatus, events: StatusEvent[]): StoredBooking {
    return {
      ...b,
      status,
      technician: status === 'ASSIGNED' ? (DEMO_TECHNICIANS[b.categoryId] ?? null) : status === 'CANCELLED' ? b.technician : null,
      history: [...b.history, ...events],
    };
  }

  function publicBooking(b: StoredBooking): Booking {
    const { scenario: _scenario, ...rest } = b;
    return rest;
  }

  function findBooking(s: DemoState, customerId: string, bookingId: string): { list: StoredBooking[]; index: number } {
    const list = s.bookings[customerId] ?? [];
    const index = list.findIndex((b) => b.id === bookingId);
    if (index < 0) throw new ApiError('NOT_FOUND');
    return { list, index };
  }

  async function readBooking(token: string, bookingId: string): Promise<Booking> {
    const s = await load();
    const c = customerFor(s, token);
    const { list, index } = findBooking(s, c.id, bookingId);
    const current = list[index] as StoredBooking;
    const next = advance(current);
    if (next !== current) {
      list[index] = next;
      await save();
    }
    return publicBooking(next);
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
        const a: Address = { ...clean(input), id: id('adr'), city: 'Hyderabad' };
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
        assertSlotOpen(input.serviceId, input.window);
        const t = now();
        const b: StoredBooking = {
          id: id('bkg'),
          code: `HF-${digits(5)}`,
          serviceId: svc.id,
          categoryId: svc.categoryId,
          problem: input.problem,
          address,
          window: input.window,
          visitFee: svc.visitFee,
          status: 'MATCHING',
          technician: null,
          createdAt: t,
          matchingStartedAt: t,
          history: [{ status: 'MATCHING', at: t }],
          cancelReason: null,
          demo: true,
          scenario: s.settings.matching,
        };
        s.bookings[c.id] = [b, ...(s.bookings[c.id] ?? [])];
        await save();
        return publicBooking(b);
      },

      async get(token, bookingId) {
        await request('READ');
        return readBooking(token, bookingId);
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
        const s = await request('WRITE');
        const c = customerFor(s, token);
        const { list, index } = findBooking(s, c.id, bookingId);
        const b = advance(list[index] as StoredBooking);
        if (b.status === 'CANCELLED') throw new ApiError('CONFLICT');
        const next: StoredBooking = { ...withStatus(b, 'CANCELLED', [{ status: 'CANCELLED', at: now() }]), cancelReason: reason };
        list[index] = next;
        await save();
        return publicBooking(next);
      },

      async reschedule(token, bookingId, window: VisitWindow) {
        const s = await request('WRITE');
        const c = customerFor(s, token);
        const { list, index } = findBooking(s, c.id, bookingId);
        const b = advance(list[index] as StoredBooking);
        if (b.status === 'CANCELLED') throw new ApiError('CONFLICT');
        assertSlotOpen(b.serviceId, window);
        const t = now();
        const next: StoredBooking = {
          ...b, window, status: 'MATCHING', technician: null, matchingStartedAt: t, scenario: s.settings.matching,
          history: [...b.history, { status: 'MATCHING', at: t }],
        };
        list[index] = next;
        await save();
        return publicBooking(next);
      },

      watch(token, bookingId, onChange, onError) {
        let last = '';
        let stopped = false;
        const tick = async () => {
          try {
            const b = await readBooking(token, bookingId);
            const sig = `${b.status}|${b.history.length}|${b.window.date}|${b.window.startHour}`;
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
        const s = await load();
        const c = customerFor(s, token);
        const { list, index } = findBooking(s, c.id, bookingId);
        const b = advance(list[index] as StoredBooking);
        if (b.status === 'CANCELLED') throw new ApiError('CONFLICT');
        const t = now();
        let next: StoredBooking;
        if (outcome === 'DELAY') {
          // Restart matching on the slow timeline, already past its "taking longer" point.
          const startedAt = t - (MATCHING_TIMELINE.SLOW.delayedAt ?? 0) * 1000;
          next = { ...withStatus(b, 'MATCHING_DELAYED', [{ status: 'MATCHING_DELAYED', at: t }]), scenario: 'SLOW', matchingStartedAt: startedAt };
        } else {
          next = withStatus(b, outcome === 'ASSIGN' ? 'ASSIGNED' : 'UNFULFILLED', [{ status: outcome === 'ASSIGN' ? 'ASSIGNED' : 'UNFULFILLED', at: t }]);
        }
        list[index] = next;
        await save();
        return publicBooking(next);
      },
      async reset() {
        state = emptyState();
        challenges.clear();
        await opts.store.remove(STORE_KEY);
      },
    },
  };

  function assertSlotOpen(serviceId: string, w: VisitWindow): void {
    const slot = slotsFor(w.date, serviceId, new Date(now())).find((x) => x.startHour === w.startHour);
    if (!slot || slot.state !== 'OPEN') throw new ApiError('SLOT_UNAVAILABLE');
  }

  return backend;
}

function clean(a: AddressInput): AddressInput {
  return { label: a.label, house: a.house.trim(), street: a.street.trim(), landmark: a.landmark.trim(), pincode: a.pincode.trim() };
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
