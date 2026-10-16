// DEMO BACKEND: an in-app stand-in for the Housefi API. It keeps synthetic customers, technicians, addresses and
// bookings on the device, simulates latency, OTP codes, payments, technician matching, job offers, the AI price check
// and the whole visit (sped up), and can be told to fail (Demo settings). Nothing here talks to a network, sends an SMS,
// takes money or contacts a real person.
//
// Customer and technician share one store, like the real backend: a customer's booking is offered to a technician
// who is online in the technician app (on this phone); if none is, a simulated technician takes it and the visit runs
// by itself. Practice jobs give a technician a simulated customer.
import {
  CATEGORIES, DEMO_TECHNICIANS, LOCAL_PROBLEM_POOL, QUOTE_TEMPLATES, SAMPLE_PHOTO_SERVICE, SERVICES, serviceById, servicesIn, TOP_PROBLEMS,
} from '../../data/catalog';
import {
  canCancel, cancelRefundsVisitFee, canReschedule, DEMO_TIMING, earningFor, etaMinutes, finalAmount, isActive, isInstantAvailable, isValidName,
  isValidPincode, labourTotal, materialTotal, matchingStatusAt, MAX_QUOTE_VERSIONS, nextPayoutDate, normalizePhone, priceCheck, quoteProblem,
  quoteTotal, slotsFor, START_CODE_ATTEMPTS, TECH_VISIT_SHARE, typicalRange, validateAddress, weekStart, windowStart, type MatchingScenario,
} from '../../domain/rules';
import type {
  Address, AddressInput, Booking, BookingStatus, CancelReason, CategoryId, Customer, Earnings, Job, JobOffer, Payment, PaymentMethod, Quote,
  QuoteLine, Session, StatusEvent, TechIssue, TechProfile, TechProfileInput, Technician, VisitTime,
} from '../../domain/types';
import { quoteVisible } from '../../domain/types';
import {
  ApiError, type AppNotification, type Backend, type ChatReply, type DemoOutcome, type DemoSettings, type KeyValueStore, type NewBooking,
  type NotificationKind, type OtpChallenge, type PaymentResult, type QuoteAnswer, type QuoteInput,
} from '../api';

const STORE_KEY = 'housefi.demo-backend.v3';
const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_SEC = 30;
const OTP_MAX_ATTEMPTS = 3;
const T = DEMO_TIMING;
const PRACTICE_CUSTOMER = 'cus_practice';

interface StoredBooking extends Booking {
  /** Internal to the mock. */
  readonly customerId: string;
  readonly scenario: MatchingScenario;
  readonly extraWorkPlanned: boolean;
  /** When the current timed phase began. */
  readonly phaseStartedAt: number;
  /** Technician-app account handling this booking (null = simulated technician). */
  readonly techId: string | null;
  readonly practice: boolean;
  /** Technicians who rejected or missed the offer. */
  readonly declinedBy: readonly string[];
  readonly otpTries: number;
}

interface StoredTech extends TechProfile {
  readonly submittedAt: number | null;
}

interface StoredOffer {
  readonly id: string;
  readonly bookingId: string;
  readonly techId: string;
  state: 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'WITHDRAWN';
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly distanceKm: number;
}

interface DemoState {
  customers: Record<string, Customer>;
  sessions: Record<string, string>;
  addresses: Record<string, Address[]>;
  bookings: Record<string, StoredBooking[]>;
  techs: Record<string, StoredTech>;
  techSessions: Record<string, string>;
  offers: StoredOffer[];
  notifications: Record<string, AppNotification[]>;
  tickets: { id: string; bookingId: string; by: string; issue: TechIssue; note: string; at: number }[];
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

const DEFAULT_SETTINGS: DemoSettings = {
  matching: 'QUICK', failNext: 'OFF', payment: 'SUCCESS', extraWork: false, practiceCustomer: 'APPROVE', verification: 'APPROVE',
};

const emptyState = (): DemoState => ({
  customers: {}, sessions: {}, addresses: {}, bookings: {}, techs: {}, techSessions: {}, offers: [], notifications: {}, tickets: [],
  settings: DEFAULT_SETTINGS,
});

const due = (kind: 'VISIT' | 'FINAL', amount: number): Payment => ({ kind, amount, state: 'DUE', method: null, txnId: null, at: null });
const same = (text: string) => ({ en: text, te: text });
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

export function createMockBackend(opts: MockOptions): Backend {
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;
  const [minLat, maxLat] = opts.latency ?? [300, 700];
  const pollMs = opts.pollMs ?? 1000;
  const challenges = new Map<string, Challenge>();
  let state: DemoState | null = null;
  /** Set when something other than the booking being advanced changed (offers, notifications), so it gets saved. */
  let dirty = false;

  const id = (prefix: string) => `${prefix}_${now().toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');
  const S = (): DemoState => {
    if (!state) throw new Error('demo state not loaded');
    return state;
  };

  async function load(): Promise<DemoState> {
    if (state) return state;
    const raw = await opts.store.get(STORE_KEY);
    try {
      const parsed = raw ? (JSON.parse(raw) as Partial<DemoState>) : null;
      state = parsed ? { ...emptyState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } } : emptyState();
    } catch {
      state = emptyState();
    }
    return state;
  }

  async function save(): Promise<void> {
    dirty = false;
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

  function techFor(s: DemoState, token: string): StoredTech {
    const tid = s.techSessions[token];
    const tech = tid ? Object.values(s.techs).find((x) => x.id === tid) : undefined;
    if (!tech) throw new ApiError('UNAUTHENTICATED');
    return advanceTech(tech);
  }

  function putTech(tech: StoredTech): StoredTech {
    S().techs[tech.phone] = tech;
    return tech;
  }

  // ---------- notifications ----------

  function notify(userId: string, kind: NotificationKind, bookingId: string | null, params: Record<string, string | number> = {}): void {
    if (userId === PRACTICE_CUSTOMER) return;
    const s = S();
    const list = s.notifications[userId] ?? [];
    s.notifications[userId] = [{ id: id('ntf'), kind, bookingId, params, at: now(), read: false }, ...list].slice(0, 60);
    dirty = true;
  }

  // ---------- technicians ----------

  function techById(techId: string | null): StoredTech | undefined {
    return techId ? Object.values(S().techs).find((x) => x.id === techId) : undefined;
  }

  /** Profile review in the demo: approved (or sent back once for correction) a few seconds after submitting. */
  function advanceTech(tech: StoredTech): StoredTech {
    if (tech.verification !== 'PENDING' || tech.submittedAt === null || now() - tech.submittedAt < T.verificationSec * 1000) return tech;
    const s = S();
    if (s.settings.verification === 'CORRECTION') {
      s.settings = { ...s.settings, verification: 'APPROVE' };
      notify(tech.id, 'PROFILE_NEEDS_CORRECTION', null);
      return putTech({
        ...tech, verification: 'NEEDS_CORRECTION',
        correctionNote: { en: 'Please list at least two localities you cover, separated by commas.', te: 'మీరు పనిచేసే కనీసం రెండు ప్రాంతాలను కామాలతో రాయండి.' },
      });
    }
    notify(tech.id, 'PROFILE_APPROVED', null);
    return putTech({ ...tech, verification: 'APPROVED', correctionNote: null });
  }

  function maskedFor(seed: string): string {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const n = String(h % 1e8).padStart(8, '0');
    return `+91 80${n.slice(0, 3)} ${n.slice(3)}`;
  }

  function publicTech(tech: StoredTech): Technician {
    return {
      id: tech.id, name: same(tech.name), gender: tech.gender, rating: tech.rating ?? 0, jobs: tech.jobsDone, years: tech.experienceYears,
      womenRated: false, vehicle: tech.vehicle, maskedPhone: maskedFor(tech.id), demo: true,
    };
  }

  function hasActiveJob(techId: string): boolean {
    return allBookings().some((b) => b.techId === techId && isActive(b.status));
  }

  function eligibleTech(b: StoredBooking): StoredTech | undefined {
    const s = S();
    return Object.values(s.techs).map(advanceTech).find((x) => x.verification === 'APPROVED' && x.online && x.skills.includes(b.categoryId)
      && !b.declinedBy.includes(x.id) && !hasActiveJob(x.id) && !s.offers.some((o) => o.techId === x.id && o.state === 'OPEN'));
  }

  function makeOffer(b: StoredBooking, techId: string, t: number): StoredOffer {
    const o: StoredOffer = { id: id('ofr'), bookingId: b.id, techId, state: 'OPEN', createdAt: t, expiresAt: t + T.offerSec * 1000, distanceKm: Math.round((1 + random() * 5) * 10) / 10 };
    S().offers.push(o);
    notify(techId, 'JOB_OFFER', b.id, { code: b.code });
    dirty = true;
    return o;
  }

  function withdrawOffers(bookingId: string): void {
    for (const o of S().offers) {
      if (o.bookingId === bookingId && o.state === 'OPEN') {
        o.state = 'WITHDRAWN';
        dirty = true;
      }
    }
  }

  // ---------- bookings ----------

  function allBookings(): StoredBooking[] {
    return Object.values(S().bookings).flat();
  }

  function findAny(bookingId: string): { list: StoredBooking[]; index: number } {
    for (const list of Object.values(S().bookings)) {
      const index = list.findIndex((b) => b.id === bookingId);
      if (index >= 0) return { list, index };
    }
    throw new ApiError('NOT_FOUND');
  }

  function pickTechnician(b: StoredBooking): Technician | null {
    const pool = DEMO_TECHNICIANS[b.categoryId] ?? [];
    if (b.preferWomenRated) return pool.find((x) => x.womenRated) ?? pool[0] ?? null;
    return pool[0] ?? null;
  }

  function buildQuote(b: StoredBooking, lines: QuoteLine[], diagnosis: { en: string; te: string }, version: number, at: number): Quote {
    const svc = serviceById(b.serviceId);
    const [typicalMin, typicalMax] = typicalRange(svc);
    return {
      id: id('qt'), version, lines, labourTotal: labourTotal(lines), materialTotal: materialTotal(lines), total: quoteTotal(lines), diagnosis,
      review: { state: 'CHECKING', typicalMin, typicalMax }, decision: 'PENDING', at,
    };
  }

  /** The simulated technician's quote from the category template, raised to at least the service's lowest repair price. */
  function templateQuote(b: StoredBooking, at: number): Quote {
    const tpl = QUOTE_TEMPLATES[b.categoryId] ?? QUOTE_TEMPLATES.PLUMBING;
    const svc = serviceById(b.serviceId);
    let lines: QuoteLine[] = [...(tpl?.lines ?? [])];
    const short = (svc?.repairFrom ?? 100) - quoteTotal(lines);
    if (short > 0 && lines[0]) lines = [{ ...lines[0], unitPrice: lines[0].unitPrice + short }, ...lines.slice(1)];
    return buildQuote(b, lines, tpl?.diagnosis ?? same(''), 1, at);
  }

  function templateExtra(b: StoredBooking, at: number): Quote {
    const tpl = QUOTE_TEMPLATES[b.categoryId] ?? QUOTE_TEMPLATES.PLUMBING;
    return buildQuote(b, tpl ? [tpl.extra.line] : [], tpl?.extra.diagnosis ?? same(''), 1, at);
  }

  /** The simulated technician's answer to "ask for a lower price": 15% off the labour, never below the minimum. */
  function revisedQuote(b: StoredBooking, q: Quote, at: number): Quote {
    const lines = q.lines.map((l) => (l.kind === 'LABOUR' ? { ...l, unitPrice: Math.max(1, Math.round((l.unitPrice * 0.85) / 10) * 10) } : l));
    const fixed: QuoteLine[] = quoteTotal(lines) >= 100 ? lines : [...q.lines];
    return buildQuote(b, fixed, q.diagnosis, q.version + 1, at);
  }

  function go(b: StoredBooking, status: BookingStatus, at: number, patch: Partial<StoredBooking> = {}): StoredBooking {
    const ev: StatusEvent = { status, at };
    const nb: StoredBooking = { ...b, ...patch, status, phaseStartedAt: at, history: [...b.history, ev] };
    announce(b, nb);
    return nb;
  }

  /** Inbox entries for the customer and the technician when a booking changes status. */
  function announce(prev: StoredBooking, b: StoredBooking): void {
    const c = b.customerId;
    const code = b.code;
    const name = b.technician ? b.technician.name.en : '';
    switch (b.status) {
      case 'ASSIGNED': notify(c, 'TECH_ASSIGNED', b.id, { code, name }); break;
      case 'EN_ROUTE': notify(c, 'TECH_ON_THE_WAY', b.id, { code, name }); break;
      case 'ARRIVED': notify(c, 'TECH_ARRIVED', b.id, { code, name }); break;
      case 'QUOTE_SHARED': notify(c, 'QUOTE_READY', b.id, { code, amount: b.quote?.total ?? 0 }); break;
      case 'EXTRA_WORK': notify(c, 'EXTRA_QUOTE', b.id, { code, amount: b.extraQuote?.total ?? 0 }); break;
      case 'PAYMENT_DUE': notify(c, 'PAYMENT_DUE', b.id, { code, amount: b.finalPayment?.amount ?? 0 }); break;
      case 'COMPLETED':
        notify(c, 'BOOKING_COMPLETED', b.id, { code });
        if (b.techId) notify(b.techId, 'PAYMENT_RECEIVED', b.id, { code, amount: b.finalPayment?.amount ?? 0 });
        break;
      case 'UNFULFILLED': notify(c, 'NO_TECHNICIAN', b.id, { code }); break;
      case 'CANCELLED':
        notify(c, 'BOOKING_CANCELLED', b.id, { code });
        if (b.techId) notify(b.techId, 'JOB_CANCELLED', b.id, { code });
        break;
      case 'IN_PROGRESS':
        if (prev.status === 'QUOTE_SHARED' && b.techId) notify(b.techId, 'QUOTE_APPROVED', b.id, { code, amount: b.quote?.total ?? 0 });
        break;
      case 'CLOSED_NO_REPAIR':
        if (b.closeReason === 'CUSTOMER_DECLINED' && b.techId) notify(b.techId, 'QUOTE_DECLINED', b.id, { code });
        break;
      default:
        break;
    }
  }

  /** Moves the price check of a submitted quote along; shows it to the customer once it passes. */
  function reviewStep(b: StoredBooking, t: number): StoredBooking | null {
    const svc = serviceById(b.serviceId);
    for (const which of ['quote', 'extraQuote'] as const) {
      const q = b[which];
      if (!q || q.decision !== 'PENDING') continue;
      const checkedAt = q.at + T.quoteCheckSec * 1000;
      const clearedAt = checkedAt + T.quoteReviewSec * 1000;
      let next: Quote | null = null;
      let at = 0;
      if (q.review.state === 'CHECKING' && t >= checkedAt) {
        next = { ...q, review: { ...q.review, state: priceCheck(svc, q.lines) } };
        at = checkedAt;
      } else if (q.review.state === 'UNDER_REVIEW' && t >= clearedAt) {
        next = { ...q, review: { ...q.review, state: 'CLEARED' } };
        at = clearedAt;
      }
      if (!next) continue;
      if (!quoteVisible(next)) return { ...b, [which]: next };
      if (which === 'quote' && b.status === 'INSPECTING') return go(b, 'QUOTE_SHARED', at, { quote: next });
      if (which === 'extraQuote' && b.status === 'IN_PROGRESS') return go(b, 'EXTRA_WORK', at, { extraQuote: next });
      return { ...b, [which]: next };
    }
    return null;
  }

  function matchingStep(b: StoredBooking, t: number, el: number): StoredBooking | null {
    const s = S();
    const open = s.offers.find((o) => o.bookingId === b.id && o.state === 'OPEN');
    if (open) {
      if (t < open.expiresAt) return null; // waiting for the technician to answer
      open.state = 'EXPIRED';
      dirty = true;
      if (b.practice) return go(b, 'CANCELLED', open.expiresAt);
      // Missed: try the next technician, or the simulated one, from now.
      return { ...b, declinedBy: [...b.declinedBy, open.techId], phaseStartedAt: open.expiresAt };
    }
    if (b.practice) return null;
    const tech = eligibleTech(b);
    if (tech) {
      makeOffer(b, tech.id, t);
      return null;
    }
    const target = matchingStatusAt(b.scenario, el);
    if (target === b.status) return null;
    const tl = T.matching[b.scenario];
    if (target === 'MATCHING_DELAYED') {
      return { ...go(b, 'MATCHING_DELAYED', b.phaseStartedAt + (tl.delayedAt ?? 0) * 1000), phaseStartedAt: b.phaseStartedAt };
    }
    const at = b.phaseStartedAt + tl.endAt * 1000;
    const withDelay = b.status === 'MATCHING' && tl.delayedAt !== null
      ? { ...b, history: [...b.history, { status: 'MATCHING_DELAYED' as BookingStatus, at: b.phaseStartedAt + tl.delayedAt * 1000 }] } : b;
    return target === 'ASSIGNED' ? go(withDelay, 'ASSIGNED', at, { technician: pickTechnician(b) }) : go(withDelay, target, at);
  }

  /** The simulated customer of a practice job. */
  function practiceStep(b: StoredBooking, el: number): StoredBooking | null {
    if (el < T.practiceAnswerSec) return null;
    const at = b.phaseStartedAt + T.practiceAnswerSec * 1000;
    if (b.status === 'QUOTE_SHARED' && b.quote?.decision === 'PENDING') {
      const want = S().settings.practiceCustomer;
      const answer = want === 'REVISION' && b.quote.version > 1 ? 'APPROVE' : want;
      return answerQuote(b, 'MAIN', answer, at);
    }
    if (b.status === 'EXTRA_WORK') return answerQuote(b, 'EXTRA', 'APPROVE', at);
    if (b.status === 'PAYMENT_DUE' && b.finalPayment?.state === 'DUE') {
      return go(b, 'COMPLETED', at, { finalPayment: { ...b.finalPayment, state: 'PAID', method: 'UPI', txnId: `DEMO${digits(10)}`, at } });
    }
    return null;
  }

  /** Moves a booking along its timed demo lifecycle until it waits for time or for a person. */
  function advance(b0: StoredBooking): StoredBooking {
    let b = b0;
    const t = now();
    const sim = !b.techId; // the simulated technician runs the visit
    for (let guard = 0; guard < 16; guard++) {
      const reviewed = reviewStep(b, t);
      if (reviewed) {
        b = reviewed;
        continue;
      }
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
        case 'MATCHING_DELAYED':
          next = matchingStep(b, t, el);
          break;
        case 'ASSIGNED':
          if (sim) {
            const startAt = b.time.mode === 'INSTANT' ? b.phaseStartedAt + T.startTravelSec * 1000
              : b.time.window ? windowStart(b.time.window).getTime() - 30 * 60_000 : Infinity;
            if (t >= startAt) next = go(b, 'EN_ROUTE', startAt);
          }
          break;
        case 'EN_ROUTE':
          if (sim && el >= T.travelSec) next = go(b, 'ARRIVED', b.phaseStartedAt + T.travelSec * 1000, { etaMin: null });
          break;
        case 'ARRIVED':
          if (sim && el >= T.verifyOtpSec) next = go(b, 'INSPECTING', b.phaseStartedAt + T.verifyOtpSec * 1000);
          break;
        case 'INSPECTING':
          if (sim && !b.quote && el >= T.inspectSec) next = { ...b, quote: templateQuote(b, b.phaseStartedAt + T.inspectSec * 1000) };
          break;
        case 'QUOTE_SHARED':
          if (sim && b.quote?.decision === 'REVISION_REQUESTED' && el >= T.revisionSec) {
            const at = b.phaseStartedAt + T.revisionSec * 1000;
            next = go(b, 'INSPECTING', at, { quote: revisedQuote(b, b.quote, at) });
          } else if (b.practice) next = practiceStep(b, el);
          break;
        case 'IN_PROGRESS':
          if (sim) {
            if (b.extraWorkPlanned && !b.extraQuote && el >= T.extraWorkAtSec) {
              next = { ...b, extraQuote: templateExtra(b, b.phaseStartedAt + T.extraWorkAtSec * 1000) };
            } else if (!b.extraQuote || b.extraQuote.decision !== 'PENDING') {
              const doneAfter = b.extraQuote ? T.workAfterExtraSec : T.workSec;
              if ((!b.extraWorkPlanned || b.extraQuote) && el >= doneAfter) {
                next = go(b, 'PAYMENT_DUE', b.phaseStartedAt + doneAfter * 1000, { finalPayment: due('FINAL', finalAmount(b.quote, b.extraQuote)) });
              }
            }
          }
          break;
        case 'EXTRA_WORK':
          if (b.practice) next = practiceStep(b, el);
          break;
        case 'PAYMENT_DUE': {
          const fp = b.finalPayment;
          if (!fp) break;
          if (fp.state === 'PENDING' && fp.method !== 'CASH' && el >= T.paymentPendingSec) {
            const at = b.phaseStartedAt + T.paymentPendingSec * 1000;
            next = go(b, 'COMPLETED', at, { finalPayment: { ...fp, state: 'PAID', txnId: `DEMO${digits(10)}`, at } });
          } else if (fp.state === 'PENDING' && fp.method === 'CASH' && sim && el >= T.cashConfirmSec) {
            const at = b.phaseStartedAt + T.cashConfirmSec * 1000;
            next = go(b, 'COMPLETED', at, { finalPayment: { ...fp, state: 'PAID', at } });
          } else if (b.practice) next = practiceStep(b, el);
          break;
        }
        default:
          break;
      }
      if (!next) break;
      b = next;
    }
    return b;
  }

  /** Advances every booking (the technician app drives the clock when the customer app is not open). */
  function advanceAll(): void {
    for (const list of Object.values(S().bookings)) {
      for (let k = 0; k < list.length; k++) {
        const cur = list[k] as StoredBooking;
        const b = advance(cur);
        if (b !== cur) {
          list[k] = b;
          dirty = true;
        }
      }
    }
  }

  function publicBooking(b: StoredBooking): Booking {
    const { customerId: _c, scenario: _s, extraWorkPlanned: _e, phaseStartedAt, techId: _t, practice: _p, declinedBy: _d, otpTries: _o, ...rest } = b;
    const etaMin = b.status === 'EN_ROUTE' ? etaMinutes(T.travelSec - (now() - phaseStartedAt) / 1000) : null;
    // The customer sees a quote only after it passes the price check.
    return { ...rest, etaMin, quote: quoteVisible(b.quote) ? b.quote : null, extraQuote: quoteVisible(b.extraQuote) ? b.extraQuote : null };
  }

  function jobView(b: StoredBooking): Job {
    const s = S();
    const customer = Object.values(s.customers).find((x) => x.id === b.customerId);
    const accepted = [...b.history].reverse().find((h) => h.status === 'ASSIGNED');
    return {
      id: b.id, code: b.code, serviceId: b.serviceId, categoryId: b.categoryId, problem: b.problem,
      customerName: b.practice ? 'Anjali' : firstName(customer?.name ?? ''), address: b.address, maskedPhone: maskedFor(b.id), time: b.time,
      status: b.status, quote: b.quote, extraQuote: b.extraQuote, visitPayment: b.visitPayment, finalPayment: b.finalPayment,
      workStarted: b.workStarted, closeReason: b.closeReason, cancelReason: b.cancelReason,
      otpAttemptsLeft: Math.max(0, START_CODE_ATTEMPTS - b.otpTries), earning: earningFor(b), rating: b.rating, history: b.history,
      acceptedAt: accepted?.at ?? b.createdAt, practice: b.practice, demo: true,
    };
  }

  function offerView(o: StoredOffer, b: StoredBooking): JobOffer {
    return {
      id: o.id, bookingId: b.id, code: b.code, serviceId: b.serviceId, categoryId: b.categoryId, issueIds: b.problem.issueIds,
      notes: [b.problem.notes, b.problem.voiceNote?.transcript ?? ''].filter(Boolean).join(' · '), photoCount: b.problem.photos.length,
      area: `${b.address.street}, ${b.address.city}`, pincode: b.address.pincode, time: b.time, distanceKm: o.distanceKm,
      visitEarning: TECH_VISIT_SHARE, createdAt: o.createdAt, expiresAt: o.expiresAt,
    };
  }

  function findBooking(s: DemoState, customerId: string, bookingId: string): { list: StoredBooking[]; index: number } {
    const list = s.bookings[customerId] ?? [];
    const index = list.findIndex((b) => b.id === bookingId);
    if (index < 0) throw new ApiError('NOT_FOUND');
    return { list, index };
  }

  /** Loads a customer's booking, advances it, saves if changed, and hands back both forms. */
  async function touch(token: string, bookingId: string): Promise<{ s: DemoState; list: StoredBooking[]; index: number; b: StoredBooking }> {
    const s = await load();
    const c = customerFor(s, token);
    const { list, index } = findBooking(s, c.id, bookingId);
    const cur = list[index] as StoredBooking;
    const b = advance(cur);
    if (b !== cur) list[index] = b;
    if (b !== cur || dirty) await save();
    return { s, list, index, b };
  }

  /** Loads a technician's job (only jobs assigned to them), advanced and saved. */
  async function touchJob(token: string, jobId: string): Promise<{ tech: StoredTech; list: StoredBooking[]; index: number; b: StoredBooking }> {
    const s = await load();
    const tech = techFor(s, token);
    const { list, index } = findAny(jobId);
    const cur = list[index] as StoredBooking;
    if (cur.techId !== tech.id) throw new ApiError('NOT_FOUND');
    const b = advance(cur);
    if (b !== cur) list[index] = b;
    if (b !== cur || dirty) await save();
    return { tech, list, index, b };
  }

  async function store(list: StoredBooking[], index: number, b: StoredBooking): Promise<Booking> {
    list[index] = b;
    await save();
    return publicBooking(b);
  }

  async function storeJob(list: StoredBooking[], index: number, b: StoredBooking): Promise<Job> {
    list[index] = b;
    await save();
    return jobView(b);
  }

  /** Customer's (or practice customer's) answer to a quote. */
  function answerQuote(b: StoredBooking, which: 'MAIN' | 'EXTRA', answer: QuoteAnswer, t: number): StoredBooking {
    if (which === 'MAIN') {
      if (b.status !== 'QUOTE_SHARED' || !b.quote || b.quote.decision !== 'PENDING') throw new ApiError('CONFLICT');
      if (answer === 'APPROVE') return go(b, 'IN_PROGRESS', t, { quote: { ...b.quote, decision: 'APPROVED' }, workStarted: !b.techId });
      if (answer === 'REVISION') {
        if (b.quote.version >= MAX_QUOTE_VERSIONS) throw new ApiError('CONFLICT');
        if (b.techId) notify(b.techId, 'QUOTE_REVISION', b.id, { code: b.code });
        return { ...b, quote: { ...b.quote, decision: 'REVISION_REQUESTED' }, phaseStartedAt: t };
      }
      return go(b, 'CLOSED_NO_REPAIR', t, { quote: { ...b.quote, decision: 'REJECTED' }, closeReason: 'CUSTOMER_DECLINED' });
    }
    if (b.status !== 'EXTRA_WORK' || !b.extraQuote) throw new ApiError('CONFLICT');
    const approve = answer === 'APPROVE';
    if (b.techId) notify(b.techId, approve ? 'EXTRA_APPROVED' : 'EXTRA_DECLINED', b.id, { code: b.code });
    return go(b, 'IN_PROGRESS', t, { extraQuote: { ...b.extraQuote, decision: approve ? 'APPROVED' : 'REJECTED' } });
  }

  function newBooking(customerId: string, input: NewBooking, address: Address, t: number, extra: Partial<StoredBooking> = {}): StoredBooking {
    const svc = serviceById(input.serviceId);
    if (!svc) throw new ApiError('NOT_FOUND');
    const s = S();
    return {
      id: id('bkg'), code: `HF-${digits(5)}`, serviceId: svc.id, categoryId: svc.categoryId, problem: input.problem, address, time: input.time,
      preferWomenRated: input.preferWomenRated, status: 'AWAITING_PAYMENT', technician: null, arrivalOtp: String(1000 + Math.floor(random() * 9000)),
      etaMin: null, visitPayment: due('VISIT', svc.visitFee), quote: null, extraQuote: null, finalPayment: null, rating: null, createdAt: t,
      history: [{ status: 'AWAITING_PAYMENT', at: t }], cancelReason: null, closeReason: null, workStarted: false, viaTechApp: false, demo: true,
      customerId, scenario: s.settings.matching, extraWorkPlanned: s.settings.extraWork, phaseStartedAt: t, techId: null, practice: false,
      declinedBy: [], otpTries: 0, ...extra,
    };
  }

  async function verifyChallenge(challengeId: string, code: string): Promise<{ s: DemoState; phone: string }> {
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
    return { s, phone: ch.phone };
  }

  async function requestOtp(phone: string): Promise<OtpChallenge> {
    await request('WRITE');
    const p = normalizePhone(phone);
    if (!p) throw new ApiError('VALIDATION');
    const ch: Challenge = { id: id('otp'), phone: p, code: digits(6), expiresAt: now() + OTP_TTL_MS, attempts: 0 };
    challenges.set(ch.id, ch);
    return { challengeId: ch.id, phone: p, resendAfterSec: OTP_RESEND_SEC, expiresAt: ch.expiresAt, demoCode: ch.code };
  }

  function userIdFor(s: DemoState, token: string): string {
    const cid = s.sessions[token];
    if (cid) return cid;
    const tid = s.techSessions[token];
    if (tid) return tid;
    throw new ApiError('UNAUTHENTICATED');
  }

  const notifications = {
    async list(token: string) {
      const s = await request('READ');
      const uid = userIdFor(s, token);
      advanceAll();
      if (dirty) await save();
      return s.notifications[uid] ?? [];
    },
    async markRead(token: string, ids: readonly string[]) {
      const s = await load();
      const uid = userIdFor(s, token);
      s.notifications[uid] = (s.notifications[uid] ?? []).map((n) => (ids.includes(n.id) ? { ...n, read: true } : n));
      await save();
    },
    async registerDevice() {
      // Push notifications come with the real backend.
    },
  };

  const backend: Backend = {
    mode: 'DEMO',

    auth: {
      requestOtp,

      async verifyOtp(challengeId, code) {
        const { s, phone } = await verifyChallenge(challengeId, code);
        const existing = s.customers[phone];
        const customer: Customer = existing ?? { id: id('cus'), phone, name: '' };
        s.customers[phone] = customer;
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
        if (!serviceById(input.serviceId)) throw new ApiError('NOT_FOUND');
        const address = (s.addresses[c.id] ?? []).find((a) => a.id === input.addressId);
        if (!address) throw new ApiError('VALIDATION');
        assertTimeOpen(input.serviceId, input.time);
        const b = newBooking(c.id, input, address, now());
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
        const fp = b.finalPayment;
        if (b.status !== 'PAYMENT_DUE' || !fp || fp.state === 'PAID' || (fp.state === 'PENDING' && fp.method !== 'CASH')) throw new ApiError('CONFLICT');
        if (method === 'CASH') {
          // Cash is confirmed by the technician (the simulated one does it after a few seconds).
          const nb = { ...b, phaseStartedAt: t, finalPayment: { ...fp, state: 'PENDING' as const, method, at: t } };
          return { booking: await store(list, index, nb), state: 'PENDING' };
        }
        if (outcome === 'FAILED') {
          const nb = { ...b, finalPayment: { ...fp, state: 'FAILED' as const, method, at: t } };
          return { booking: await store(list, index, nb), state: 'FAILED' };
        }
        if (outcome === 'PENDING') {
          const nb = { ...b, phaseStartedAt: t, finalPayment: { ...fp, state: 'PENDING' as const, method, at: t } };
          return { booking: await store(list, index, nb), state: 'PENDING' };
        }
        const nb = go(b, 'COMPLETED', t, { finalPayment: { ...fp, state: 'PAID', method, txnId: simulatedTxn, at: t } });
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
        withdrawOffers(b.id);
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
        withdrawOffers(b.id);
        if (b.techId) notify(b.techId, 'JOB_CANCELLED', b.id, { code: b.code });
        const nb = go(b, 'MATCHING', now(), { time, technician: null, techId: null, viaTechApp: false, declinedBy: [], scenario: s.settings.matching });
        return store(list, index, nb);
      },

      async decideQuote(token, bookingId, which, answer) {
        await request('WRITE');
        const { list, index, b } = await touch(token, bookingId);
        if (which === 'MAIN' && b.quote && !quoteVisible(b.quote)) throw new ApiError('CONFLICT');
        return store(list, index, answerQuote(b, which, answer, now()));
      },

      async rate(token, bookingId, rating) {
        await request('WRITE');
        const { list, index, b } = await touch(token, bookingId);
        if (b.status !== 'COMPLETED' && b.status !== 'CLOSED_NO_REPAIR') throw new ApiError('CONFLICT');
        if (b.rating) throw new ApiError('CONFLICT');
        if (!Number.isInteger(rating.stars) || rating.stars < 1 || rating.stars > 5 || typeof rating.satisfied !== 'boolean') throw new ApiError('VALIDATION');
        const nb = { ...b, rating: { ...rating, comment: rating.comment.slice(0, 500), at: now() } };
        const tech = techById(b.techId);
        if (tech) {
          const rated = allBookings().filter((x) => x.techId === tech.id && x.rating && x.id !== b.id).map((x) => x.rating?.stars ?? 0);
          const all = [...rated, rating.stars];
          putTech({ ...tech, rating: Math.round((all.reduce((a, v) => a + v, 0) / all.length) * 10) / 10 });
        }
        return store(list, index, nb);
      },

      watch(token, bookingId, onChange, onError) {
        let last = '';
        let stopped = false;
        const tick = async () => {
          try {
            const b = publicBooking((await touch(token, bookingId)).b);
            const sig = JSON.stringify([b.status, b.history.length, b.etaMin, b.quote?.id, b.quote?.decision, b.extraQuote?.id, b.extraQuote?.decision,
              b.visitPayment.state, b.finalPayment?.state, b.rating?.stars, b.time, b.workStarted]);
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
      async topProblems(pincode, area) {
        await delay();
        // Demo "AI": a stable ranking per PIN code (each locality gets its own top 6), with this week's counts.
        const seed = (pincode ?? '000000').split('').reduce((a, ch) => (a * 33 + ch.charCodeAt(0)) >>> 0, 7);
        const week = Math.floor(now() / (7 * 86_400_000));
        const ranked = LOCAL_PROBLEM_POOL.map((p, k) => {
          const wobble = ((seed >> (k % 16)) ^ (week * (k + 3))) % 13;
          return { serviceId: p.serviceId, issueId: p.issueId, recentCount: p.weight + wobble };
        }).sort((a, b) => b.recentCount - a.recentCount);
        return { area: pincode ? area : null, items: ranked.slice(0, 6) };
      },

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
        const active = (s.bookings[c.id] ?? []).map(advance).find((b) => isActive(b.status));
        return reply(message, locale, active ? publicBooking(active) : null);
      },
    },

    notifications,

    tech: {
      auth: {
        requestOtp,
        async verifyOtp(challengeId, code) {
          const { s, phone } = await verifyChallenge(challengeId, code);
          const existing = s.techs[phone];
          const tech: StoredTech = existing ?? {
            id: id('tech'), phone, name: '', gender: 'M', experienceYears: 0, skills: [], city: '', pincode: '', areas: '', vehicle: '',
            verification: null, correctionNote: null, online: false, rating: null, jobsDone: 0, submittedAt: null,
          };
          s.techs[phone] = tech;
          const token = id('ttok');
          s.techSessions[token] = tech.id;
          await save();
          return { session: { token, profile: publicProfile(advanceTech(tech)) }, isNew: tech.verification === null };
        },
        async restore(token) {
          const s = await load();
          try {
            return { token, profile: publicProfile(techFor(s, token)) };
          } catch {
            return null;
          }
        },
        async signOut(token) {
          const s = await load();
          const tid = s.techSessions[token];
          const tech = techById(tid ?? null);
          if (tech) putTech({ ...tech, online: false });
          delete s.techSessions[token];
          await save();
        },
      },

      async me(token) {
        const s = await request('READ');
        const tech = techFor(s, token);
        if (dirty) await save();
        return publicProfile(tech);
      },

      async submitProfile(token, input: TechProfileInput) {
        const s = await request('WRITE');
        const tech = techFor(s, token);
        if (!isValidName(input.name) || input.skills.length === 0 || input.skills.some((k) => !CATEGORIES.some((c) => c.id === k))
          || !Number.isInteger(input.experienceYears) || input.experienceYears < 0 || input.experienceYears > 50
          || input.city.trim().length < 2 || !isValidPincode(input.pincode.trim()) || input.areas.trim().length < 2) {
          throw new ApiError('VALIDATION');
        }
        const next = putTech({
          ...tech, name: input.name.trim(), gender: input.gender, experienceYears: input.experienceYears, skills: [...new Set(input.skills)] as CategoryId[],
          city: input.city.trim(), pincode: input.pincode.trim(), areas: input.areas.trim(), vehicle: input.vehicle.trim().slice(0, 40),
          verification: 'PENDING', correctionNote: null, online: false, submittedAt: now(),
        });
        await save();
        return publicProfile(next);
      },

      async setOnline(token, online) {
        const s = await request('WRITE');
        const tech = techFor(s, token);
        if (online && tech.verification !== 'APPROVED') throw new ApiError('NOT_VERIFIED');
        const next = putTech({ ...tech, online });
        await save();
        return publicProfile(next);
      },

      async offer(token) {
        const s = await request('READ');
        const tech = techFor(s, token);
        advanceAll();
        if (dirty) await save();
        const o = s.offers.find((x) => x.techId === tech.id && x.state === 'OPEN' && x.expiresAt > now());
        if (!o) return null;
        const { list, index } = findAny(o.bookingId);
        return offerView(o, list[index] as StoredBooking);
      },

      async acceptOffer(token, offerId) {
        const s = await request('WRITE');
        const tech = techFor(s, token);
        const o = s.offers.find((x) => x.id === offerId && x.techId === tech.id);
        if (!o) throw new ApiError('NOT_FOUND');
        const { list, index } = findAny(o.bookingId);
        const cur = list[index] as StoredBooking;
        if (o.state !== 'OPEN' || now() >= o.expiresAt) {
          if (o.state === 'OPEN') {
            list[index] = advance(cur);
            await save();
          }
          throw new ApiError('OFFER_EXPIRED');
        }
        if (cur.status !== 'MATCHING' && cur.status !== 'MATCHING_DELAYED') {
          o.state = 'WITHDRAWN';
          await save();
          throw new ApiError('OFFER_EXPIRED');
        }
        o.state = 'ACCEPTED';
        const nb = go(cur, 'ASSIGNED', now(), { technician: publicTech(tech), techId: tech.id, viaTechApp: true });
        return storeJob(list, index, nb);
      },

      async rejectOffer(token, offerId) {
        const s = await request('WRITE');
        const tech = techFor(s, token);
        const o = s.offers.find((x) => x.id === offerId && x.techId === tech.id);
        if (!o) throw new ApiError('NOT_FOUND');
        if (o.state !== 'OPEN') return;
        o.state = 'REJECTED';
        const { list, index } = findAny(o.bookingId);
        const cur = list[index] as StoredBooking;
        list[index] = cur.practice ? go(cur, 'CANCELLED', now()) : { ...cur, declinedBy: [...cur.declinedBy, tech.id], phaseStartedAt: now() };
        await save();
      },

      async jobs(token) {
        const s = await request('READ');
        const tech = techFor(s, token);
        advanceAll();
        if (dirty) await save();
        return allBookings().filter((b) => b.techId === tech.id).sort((a, b) => b.createdAt - a.createdAt).map(jobView);
      },

      async job(token, jobId) {
        await request('READ');
        return jobView((await touchJob(token, jobId)).b);
      },

      async startTrip(token, jobId) {
        await request('WRITE');
        const { list, index, b } = await touchJob(token, jobId);
        if (b.status !== 'ASSIGNED') throw new ApiError('CONFLICT');
        return storeJob(list, index, go(b, 'EN_ROUTE', now()));
      },

      async arrived(token, jobId) {
        await request('WRITE');
        const { list, index, b } = await touchJob(token, jobId);
        if (b.status !== 'EN_ROUTE') throw new ApiError('CONFLICT');
        return storeJob(list, index, go(b, 'ARRIVED', now(), { etaMin: null }));
      },

      async verifyStartCode(token, jobId, code) {
        await request('WRITE');
        const { list, index, b } = await touchJob(token, jobId);
        if (b.status !== 'ARRIVED') throw new ApiError('CONFLICT');
        if (b.otpTries >= START_CODE_ATTEMPTS) throw new ApiError('OTP_LOCKED');
        if (code.trim() !== b.arrivalOtp) {
          const tries = b.otpTries + 1;
          list[index] = { ...b, otpTries: tries };
          await save();
          const left = START_CODE_ATTEMPTS - tries;
          throw left <= 0 ? new ApiError('OTP_LOCKED') : new ApiError('OTP_INVALID', { attemptsLeft: left });
        }
        return storeJob(list, index, go(b, 'INSPECTING', now()));
      },

      async submitQuote(token, jobId, which, input: QuoteInput) {
        await request('WRITE');
        const { list, index, b } = await touchJob(token, jobId);
        if (quoteProblem(input.diagnosis, input.lines)) throw new ApiError('VALIDATION');
        const lines: QuoteLine[] = input.lines.map((l) => ({ kind: l.kind, name: same(l.name.trim().slice(0, 80)), qty: l.qty, unitPrice: l.unitPrice }));
        const t = now();
        if (which === 'MAIN') {
          const revising = b.status === 'QUOTE_SHARED' && b.quote?.decision === 'REVISION_REQUESTED';
          const first = b.status === 'INSPECTING' && (!b.quote || b.quote.review.state === 'CHECKING' || b.quote.review.state === 'UNDER_REVIEW');
          if (!revising && !first) throw new ApiError('CONFLICT');
          const quote = buildQuote(b, lines, same(input.diagnosis.trim().slice(0, 500)), (b.quote?.version ?? 0) + (revising ? 1 : b.quote ? 0 : 1), t);
          return storeJob(list, index, revising ? go(b, 'INSPECTING', t, { quote }) : { ...b, quote });
        }
        if (b.status !== 'IN_PROGRESS' || !b.workStarted || b.extraQuote) throw new ApiError('CONFLICT');
        return storeJob(list, index, { ...b, extraQuote: buildQuote(b, lines, same(input.diagnosis.trim().slice(0, 500)), 1, t) });
      },

      async startWork(token, jobId) {
        await request('WRITE');
        const { list, index, b } = await touchJob(token, jobId);
        if (b.status !== 'IN_PROGRESS' || b.workStarted) throw new ApiError('CONFLICT');
        return storeJob(list, index, { ...b, workStarted: true });
      },

      async completeWork(token, jobId) {
        await request('WRITE');
        const { list, index, b } = await touchJob(token, jobId);
        if (b.status !== 'IN_PROGRESS' || !b.workStarted || b.extraQuote?.decision === 'PENDING') throw new ApiError('CONFLICT');
        const t = now();
        const tech = techById(b.techId);
        if (tech) putTech({ ...tech, jobsDone: tech.jobsDone + 1 });
        return storeJob(list, index, go(b, 'PAYMENT_DUE', t, { finalPayment: due('FINAL', finalAmount(b.quote, b.extraQuote)) }));
      },

      async confirmCash(token, jobId) {
        await request('WRITE');
        const { list, index, b } = await touchJob(token, jobId);
        const fp = b.finalPayment;
        if (b.status !== 'PAYMENT_DUE' || !fp || fp.method !== 'CASH' || fp.state !== 'PENDING') throw new ApiError('CONFLICT');
        return storeJob(list, index, go(b, 'COMPLETED', now(), { finalPayment: { ...fp, state: 'PAID', at: now() } }));
      },

      async report(token, jobId, issue, note) {
        const s = await request('WRITE');
        const { tech, list, index, b } = await touchJob(token, jobId);
        const t = now();
        if (issue === 'CUSTOMER_UNAVAILABLE' || issue === 'CANNOT_COMPLETE') {
          const allowed = issue === 'CUSTOMER_UNAVAILABLE' ? ['ARRIVED'] : ['INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS'];
          if (!allowed.includes(b.status)) throw new ApiError('CONFLICT');
          s.tickets.push({ id: id('tkt'), bookingId: b.id, by: tech.id, issue, note: note.slice(0, 500), at: t });
          return storeJob(list, index, go(b, 'CLOSED_NO_REPAIR', t, { closeReason: issue }));
        }
        s.tickets.push({ id: id('tkt'), bookingId: b.id, by: tech.id, issue, note: note.slice(0, 500), at: t });
        return storeJob(list, index, b);
      },

      async earnings(token): Promise<Earnings> {
        const s = await request('READ');
        const tech = techFor(s, token);
        advanceAll();
        if (dirty) await save();
        const t = now();
        const dayStart = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate()).getTime();
        const ws = weekStart(new Date(t));
        const done = allBookings().filter((b) => b.techId === tech.id && !isActive(b.status));
        const entries = done.map((b) => ({ b, amount: earningFor(b), at: b.history[b.history.length - 1]?.at ?? b.createdAt }))
          .filter((e) => e.amount > 0)
          .sort((a, b) => b.at - a.at)
          .map((e) => ({ jobId: e.b.id, code: e.b.code, serviceId: e.b.serviceId, amount: e.amount, at: e.at, payout: (e.at < ws ? 'PAID' : 'PENDING') as 'PAID' | 'PENDING' }));
        const today = entries.filter((e) => e.at >= dayStart);
        return {
          today: today.reduce((a, e) => a + e.amount, 0), jobsToday: today.length, total: entries.reduce((a, e) => a + e.amount, 0),
          pendingPayout: entries.filter((e) => e.payout === 'PENDING').reduce((a, e) => a + e.amount, 0), nextPayoutOn: nextPayoutDate(new Date(t)), entries,
        };
      },

      watchJob(token, jobId, onChange, onError) {
        let last = '';
        let stopped = false;
        const tick = async () => {
          try {
            const j = jobView((await touchJob(token, jobId)).b);
            const sig = JSON.stringify([j.status, j.history.length, j.quote?.id, j.quote?.review.state, j.quote?.decision, j.extraQuote?.id,
              j.extraQuote?.review.state, j.extraQuote?.decision, j.finalPayment?.state, j.finalPayment?.method, j.workStarted, j.rating?.stars, j.otpAttemptsLeft]);
            if (!stopped && sig !== last) {
              last = sig;
              onChange(j);
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

      notifications,
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
          if (b.techId) return publicBooking(b); // a technician-app job moves when the technician acts
          // Pretend the current timed phase is over; customer decisions (quote, payment) still wait for the customer.
          if (b.status === 'ASSIGNED' && b.time.mode === 'SCHEDULED') return store(list, index, go(b, 'EN_ROUTE', t));
          const sec = phaseSec(b);
          if (sec === null) return publicBooking(b);
          // Start the current phase exactly `sec` ago: the next transition happens now, so only one step is taken.
          const shifted = { ...b, phaseStartedAt: t - sec * 1000 };
          const pendingQuote = b.quote && !quoteVisible(b.quote) ? { ...b.quote, at: t - (T.quoteCheckSec + T.quoteReviewSec) * 1000 } : b.quote;
          return store(list, index, advance({ ...shifted, quote: pendingQuote }));
        }
        if (!['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED'].includes(b.status)) throw new ApiError('CONFLICT');
        withdrawOffers(b.id);
        if (outcome === 'DELAY') {
          const startedAt = t - (T.matching.SLOW.delayedAt ?? 0) * 1000;
          return store(list, index, { ...go(b, 'MATCHING_DELAYED', t), scenario: 'SLOW', phaseStartedAt: startedAt });
        }
        if (outcome === 'ASSIGN') return store(list, index, go(b, 'ASSIGNED', t, { technician: pickTechnician(b) }));
        return store(list, index, go(b, 'UNFULFILLED', t));
      },
      async practiceJob(techToken) {
        const s = await request('WRITE');
        const tech = techFor(s, techToken);
        if (tech.verification !== 'APPROVED') throw new ApiError('NOT_VERIFIED');
        if (hasActiveJob(tech.id) || s.offers.some((o) => o.techId === tech.id && o.state === 'OPEN')) throw new ApiError('CONFLICT');
        const svcs = SERVICES.filter((x) => tech.skills.includes(x.categoryId));
        const svc = svcs[Math.floor(random() * svcs.length)] ?? SERVICES[0];
        if (!svc) throw new ApiError('NOT_FOUND');
        const t = now();
        const street = tech.areas.split(',')[0]?.trim() || 'Main Road';
        const address: Address = {
          id: id('adr'), label: 'HOME', house: 'H.No 8-2-293/A, 2nd floor', street: `Road No. 3, ${street}`, landmark: 'Near Ganesh temple',
          city: tech.city, pincode: tech.pincode,
        };
        const issue = svc.issues[0];
        const transcript = TRANSCRIPTS[svc.categoryId]?.en ?? '';
        const b0 = newBooking(PRACTICE_CUSTOMER, {
          serviceId: svc.id, addressId: address.id, time: { mode: 'INSTANT', window: null }, preferWomenRated: false,
          problem: { issueIds: issue ? [issue.id] : [], notes: '', voiceNote: { durationSec: 7, transcript, simulated: true }, photos: [] },
        }, address, t, { practice: true });
        const b = go(b0, 'MATCHING', t, { visitPayment: { ...b0.visitPayment, state: 'PAID', method: 'UPI', txnId: `DEMO${digits(10)}`, at: t } });
        s.bookings[PRACTICE_CUSTOMER] = [b, ...(s.bookings[PRACTICE_CUSTOMER] ?? [])];
        const o = makeOffer(b, tech.id, t);
        await save();
        return offerView(o, b);
      },
      async startCode(techToken, jobId) {
        const { b } = await touchJob(techToken, jobId);
        return b.arrivalOtp;
      },
      async reset() {
        state = emptyState();
        challenges.clear();
        await opts.store.remove(STORE_KEY);
      },
    },
  };

  function publicProfile(t: StoredTech): TechProfile {
    const { submittedAt: _s, ...rest } = t;
    return rest;
  }

  /** Seconds the current timed phase lasts; null when the booking waits for a person or is finished. */
  function phaseSec(b: StoredBooking): number | null {
    switch (b.status) {
      case 'PAYMENT_PENDING': return T.paymentPendingSec;
      case 'MATCHING':
      case 'MATCHING_DELAYED': return T.matching[b.scenario].endAt;
      case 'ASSIGNED': return b.time.mode === 'INSTANT' ? T.startTravelSec : null;
      case 'EN_ROUTE': return T.travelSec;
      case 'ARRIVED': return T.verifyOtpSec;
      case 'INSPECTING': return b.quote ? 0 : T.inspectSec;
      case 'QUOTE_SHARED': return b.quote?.decision === 'REVISION_REQUESTED' ? T.revisionSec : null;
      case 'IN_PROGRESS': return b.extraWorkPlanned && !b.extraQuote ? T.extraWorkAtSec : b.extraQuote ? T.workAfterExtraSec : T.workSec;
      case 'PAYMENT_DUE': return b.finalPayment?.state === 'PENDING' ? (b.finalPayment.method === 'CASH' ? T.cashConfirmSec : T.paymentPendingSec) : null;
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
    return { text: te ? 'విజిట్ ఫీజు ₹49, బుకింగ్ సమయంలో చెల్లిస్తారు. రిపేర్, సామగ్రి ధరను టెక్నీషియన్ విజిట్ తర్వాత నిర్ణయిస్తారు (కనీసం ₹100). మా AI ధరను తనిఖీ చేస్తుంది, మీరు ఒప్పుకున్న తర్వాతే పని మొదలవుతుంది.' : 'The visit fee is ₹49, paid when you book. Repair and material charges are decided by the technician after the visit (minimum ₹100). Our AI checks the price, and work starts only after you approve.', suggestions: [S.track, S.human], offerHuman: false };
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
