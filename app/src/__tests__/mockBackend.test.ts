import { isoDate, slotsFor } from '../domain/rules';
import type { Session, VisitTime } from '../domain/types';
import { ApiError, type Backend } from '../services/api';
import { createMockBackend, memoryStore } from '../services/mock/MockBackend';
import { withdrawUnpaid } from '../state/withdrawUnpaid';

/** A fresh idempotency key for each create / pay call. */
let keySeq = 0;
const key = () => `test-key-${++keySeq}`;

function setup(start = new Date(2026, 9, 15, 9, 0).getTime()) {
  let now = start;
  const store = memoryStore();
  const backend = createMockBackend({ store, now: () => now, latency: [0, 0], pollMs: 10_000 });
  return { backend, store, advance: (sec: number) => { now += sec * 1000; }, now: () => now };
}

async function signIn(backend: Backend, phone = '9876543210'): Promise<{ session: Session; isNew: boolean }> {
  const ch = await backend.auth.requestOtp(phone);
  const r = await backend.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '');
  return { session: r.session, isNew: r.isNewCustomer };
}

const ADDRESS = { label: 'HOME' as const, house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034' };
const INSTANT: VisitTime = { mode: 'INSTANT', window: null };
const TOMORROW_10: VisitTime = { mode: 'SCHEDULED', window: { date: isoDate(new Date(2026, 9, 16)), startHour: 10, endHour: 12 } };
const PROBLEM = { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] };

describe('demo auth', () => {
  it('signs up a new number, then recognises it once named', async () => {
    const { backend } = setup();
    const first = await signIn(backend);
    expect(first.isNew).toBe(true);
    await backend.auth.updateName(first.session.token, 'Priya Sharma');
    const again = await signIn(backend);
    expect(again.isNew).toBe(false);
    expect(again.session.customer.name).toBe('Priya Sharma');
  });

  it('counts wrong codes and locks after three', async () => {
    const { backend } = setup();
    const ch = await backend.auth.requestOtp('9876543210');
    const wrong = ch.demoCode === '000000' ? '111111' : '000000';
    await expect(backend.auth.verifyOtp(ch.challengeId, wrong)).rejects.toMatchObject({ code: 'OTP_INVALID', attemptsLeft: 2 });
    await expect(backend.auth.verifyOtp(ch.challengeId, wrong)).rejects.toMatchObject({ code: 'OTP_INVALID', attemptsLeft: 1 });
    await expect(backend.auth.verifyOtp(ch.challengeId, wrong)).rejects.toMatchObject({ code: 'OTP_LOCKED' });
    await expect(backend.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).rejects.toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('expires codes after five minutes', async () => {
    const t = setup();
    const ch = await t.backend.auth.requestOtp('9876543210');
    t.advance(301);
    await expect(t.backend.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('restores a stored session and forgets it after sign-out', async () => {
    const { backend } = setup();
    const { session } = await signIn(backend);
    expect(await backend.auth.restore(session.token)).not.toBeNull();
    await backend.auth.signOut(session.token);
    expect(await backend.auth.restore(session.token)).toBeNull();
  });
});

describe('demo addresses', () => {
  it('validates, creates, updates and removes', async () => {
    const { backend } = setup();
    const { session } = await signIn(backend);
    await expect(backend.addresses.create(session.token, { ...ADDRESS, pincode: '0123' })).rejects.toBeInstanceOf(ApiError);
    const a = await backend.addresses.create(session.token, { ...ADDRESS, city: '  Hyderabad ', lat: 17.41, lng: 78.44 });
    expect(a.city).toBe('Hyderabad');
    expect(a.lat).toBe(17.41);
    await backend.addresses.update(session.token, a.id, { ...ADDRESS, label: 'WORK' });
    expect((await backend.addresses.list(session.token))[0]?.label).toBe('WORK');
    await backend.addresses.remove(session.token, a.id);
    expect(await backend.addresses.list(session.token)).toHaveLength(0);
  });
});

interface Opts {
  time?: VisitTime;
  women?: boolean;
  matching?: 'QUICK' | 'SLOW' | 'NONE';
  extraWork?: boolean;
  start?: number;
}

describe('demo bookings', () => {
  async function created(opts: Opts = {}) {
    const t = setup(opts.start);
    const { session } = await signIn(t.backend);
    const a = await t.backend.addresses.create(session.token, ADDRESS);
    await t.backend.demo?.updateSettings({ matching: opts.matching ?? 'QUICK', extraWork: opts.extraWork ?? false });
    const b = await t.backend.bookings.create(session.token, {
      serviceId: 'plumb-tap', problem: PROBLEM, addressId: a.id, time: opts.time ?? INSTANT, preferWomenRated: opts.women ?? false,
    }, key());
    const get = () => t.backend.bookings.get(session.token, b.id);
    return { ...t, session, booking: b, addressId: a.id, get };
  }

  async function paid(opts: Opts = {}) {
    const t = await created(opts);
    const r = await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', key());
    expect(r.state).toBe('PAID');
    return t;
  }

  /** Walks a paid instant booking up to the repair quote, one demo phase at a time. */
  async function toQuote(opts: Opts = {}) {
    const t = await paid(opts);
    for (const sec of [8, 4, 40, 15, 12, 3]) {
      t.advance(sec);
      await t.get();
    }
    expect((await t.get()).status).toBe('QUOTE_SHARED');
    return t;
  }

  it('waits for the ₹49 visit fee before looking for a technician', async () => {
    const t = await created();
    expect(t.booking.status).toBe('AWAITING_PAYMENT');
    expect(t.booking.code).toMatch(/^HF-\d{5}$/);
    expect(t.booking.visitPayment).toMatchObject({ kind: 'VISIT', amount: 49, state: 'DUE' });
    expect(t.booking.arrivalOtp).toMatch(/^\d{4}$/);
    t.advance(60);
    expect((await t.get()).status).toBe('AWAITING_PAYMENT');
  });

  it('pays the visit fee (simulated), then assigns a labelled demo technician', async () => {
    const t = await paid();
    const b0 = await t.get();
    expect(b0.status).toBe('MATCHING');
    expect(b0.visitPayment.state).toBe('PAID');
    expect(b0.visitPayment.txnId).toMatch(/^DEMO\d{10}$/);
    t.advance(8);
    const b = await t.get();
    expect(b.status).toBe('ASSIGNED');
    expect(b.technician?.demo).toBe(true);
    expect(b.technician?.name.en).toBe('Ramesh Kumar');
    expect(b.history.map((h) => h.status)).toEqual(['AWAITING_PAYMENT', 'MATCHING', 'ASSIGNED']);
  });

  it('refuses cash for the visit fee and a second visit payment', async () => {
    const t = await created();
    await expect(t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'CASH', key())).rejects.toMatchObject({ code: 'VALIDATION' });
    await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'CARD', key());
    await expect(t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'CARD', key())).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a failed payment takes no money and can be retried; the failure applies once', async () => {
    const t = await created();
    await t.backend.demo?.updateSettings({ payment: 'FAILED' });
    const r = await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', key());
    expect(r.state).toBe('FAILED');
    expect(r.booking.status).toBe('AWAITING_PAYMENT');
    expect(r.booking.visitPayment.txnId).toBeNull();
    const again = await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', key());
    expect(again.state).toBe('PAID');
  });

  it('a pending payment confirms by itself, then matching starts', async () => {
    const t = await created();
    await t.backend.demo?.updateSettings({ payment: 'PENDING' });
    const r = await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'NETBANKING', key());
    expect(r.state).toBe('PENDING');
    expect(r.booking.status).toBe('PAYMENT_PENDING');
    t.advance(8);
    const b = await t.get();
    expect(b.status).toBe('MATCHING');
    expect(b.visitPayment.state).toBe('PAID');
  });

  it('a pending payment can still fail: nothing taken, the visit fee can be paid again', async () => {
    const t = await created();
    await t.backend.demo?.updateSettings({ payment: 'PENDING_THEN_FAILED' });
    const r = await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'NETBANKING', key());
    expect(r.state).toBe('PENDING');
    t.advance(8);
    const b = await t.get();
    expect(b.status).toBe('AWAITING_PAYMENT');
    expect(b.visitPayment).toMatchObject({ state: 'FAILED', txnId: null });
    expect((await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', key())).state).toBe('PAID');
  });

  it('a pending final payment can still fail and stays payable', async () => {
    const t = await toQuote();
    await t.backend.bookings.decideQuote(t.session.token, t.booking.id, 'MAIN', 'APPROVE');
    t.advance(16);
    expect((await t.get()).status).toBe('PAYMENT_DUE');
    await t.backend.demo?.updateSettings({ payment: 'PENDING_THEN_FAILED' });
    expect((await t.backend.bookings.pay(t.session.token, t.booking.id, 'FINAL', 'UPI', key())).state).toBe('PENDING');
    t.advance(8);
    const b = await t.get();
    expect(b.status).toBe('PAYMENT_DUE');
    expect(b.finalPayment).toMatchObject({ state: 'FAILED', txnId: null });
    expect((await t.backend.bookings.pay(t.session.token, t.booking.id, 'FINAL', 'UPI', key())).state).toBe('PAID');
  });

  it('a retried create with the same idempotency key returns the first booking; a new key creates another', async () => {
    const t = await created();
    const input = { serviceId: 'plumb-tap', problem: PROBLEM, addressId: t.addressId, time: INSTANT, preferWomenRated: false };
    const first = await t.backend.bookings.create(t.session.token, input, 'retry-create');
    const again = await t.backend.bookings.create(t.session.token, input, 'retry-create');
    expect(again.id).toBe(first.id);
    const other = await t.backend.bookings.create(t.session.token, input, 'another-create');
    expect(other.id).not.toBe(first.id);
    const mine = await t.backend.bookings.list(t.session.token);
    expect(mine.filter((b) => b.id === first.id)).toHaveLength(1);
    expect(mine).toHaveLength(3); // the booking from created(), first, other
    // The same key for a different request is refused rather than answered with the wrong booking.
    await expect(t.backend.bookings.create(t.session.token, { ...input, preferWomenRated: true }, 'retry-create')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it("keeps idempotency keys per customer: another customer's key never returns this booking", async () => {
    const t = await created();
    const input = { serviceId: 'plumb-tap', problem: PROBLEM, addressId: t.addressId, time: INSTANT, preferWomenRated: false };
    const mine = await t.backend.bookings.create(t.session.token, input, 'shared-key');
    const other = await signIn(t.backend, '9123456780');
    const a = await t.backend.addresses.create(other.session.token, ADDRESS);
    const theirs = await t.backend.bookings.create(other.session.token, { ...input, addressId: a.id }, 'shared-key');
    expect(theirs.id).not.toBe(mine.id);
  });

  it('a retried payment with the same key returns the first result and charges once', async () => {
    const t = await created();
    const first = await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', 'retry-pay');
    expect(first.state).toBe('PAID');
    const again = await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', 'retry-pay');
    expect(again.state).toBe('PAID');
    expect(again.booking.visitPayment.txnId).toBe(first.booking.visitPayment.txnId);
    // One payment only: a second payment with a new key is refused (already paid).
    await expect(t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', 'new-pay')).rejects.toMatchObject({ code: 'CONFLICT' });
    const b = await t.get();
    expect(b.history.filter((h) => h.status === 'MATCHING')).toHaveLength(1);
  });

  it('a retried failed payment with the same key returns the failure; a new key is a new attempt', async () => {
    const t = await created();
    await t.backend.demo?.updateSettings({ payment: 'FAILED' });
    expect((await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', 'pay-1')).state).toBe('FAILED');
    expect((await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', 'pay-1')).state).toBe('FAILED');
    expect((await t.backend.bookings.pay(t.session.token, t.booking.id, 'VISIT', 'UPI', 'pay-2')).state).toBe('PAID');
  });

  it('withdraws a booking left unpaid on Confirm & pay (also one that arrives after leaving), never a paid one', async () => {
    const t = await created();
    // The booking arrives after the customer left the step: withdrawn at once.
    expect(await withdrawUnpaid(t.backend, t.session.token, t.booking.id)).toBe(true);
    expect((await t.get()).status).toBe('CANCELLED');
    expect((await t.get()).visitPayment.state).not.toBe('PAID');
    const p = await paid();
    expect(await withdrawUnpaid(p.backend, p.session.token, p.booking.id)).toBe(false);
    expect((await p.get()).status).toBe('MATCHING');
  });

  it('prefers a technician rated highly by women when asked', async () => {
    const t = await paid({ women: true });
    t.advance(8);
    const b = await t.get();
    expect(b.preferWomenRated).toBe(true);
    expect(b.technician?.womenRated).toBe(true);
    expect(b.technician?.name.en).toBe('Swathi Naidu');
  });

  it('runs the whole visit: travel with ETA, arrival, quote, repair, final payment', async () => {
    const t = await paid();
    t.advance(8);
    await t.get();
    t.advance(4);
    expect((await t.get()).status).toBe('EN_ROUTE');
    t.advance(20);
    const mid = await t.get();
    expect(mid.etaMin).toBeGreaterThan(0);
    expect(mid.etaMin).toBeLessThan(18);
    t.advance(20);
    const at = await t.get();
    expect(at.status).toBe('ARRIVED');
    expect(at.etaMin).toBeNull();
    t.advance(15);
    await t.get();
    t.advance(12);
    const checking = await t.get();
    expect(checking.status).toBe('INSPECTING');
    expect(checking.quote).toBeNull(); // hidden while the AI price check runs
    t.advance(3);
    const q = await t.get();
    expect(q.status).toBe('QUOTE_SHARED');
    expect(q.quote?.total).toBeGreaterThanOrEqual(149);
    expect(q.quote?.review.state).toBe('FAIR');
    expect((q.quote?.labourTotal ?? 0) + (q.quote?.materialTotal ?? 0)).toBe(q.quote?.total);
    t.advance(600);
    expect((await t.get()).status).toBe('QUOTE_SHARED'); // waits for the customer
    const approved = await t.backend.bookings.decideQuote(t.session.token, t.booking.id, 'MAIN', 'APPROVE');
    expect(approved.status).toBe('IN_PROGRESS');
    t.advance(16);
    const due = await t.get();
    expect(due.status).toBe('PAYMENT_DUE');
    expect(due.finalPayment).toMatchObject({ kind: 'FINAL', amount: q.quote?.total, state: 'DUE' });
    const r = await t.backend.bookings.pay(t.session.token, t.booking.id, 'FINAL', 'CASH', key());
    expect(r.state).toBe('PENDING'); // the technician confirms cash
    t.advance(4);
    const settled = await t.get();
    expect(settled.status).toBe('COMPLETED');
    expect(settled.finalPayment).toMatchObject({ state: 'PAID', method: 'CASH' });
    const rated = await t.backend.bookings.rate(t.session.token, t.booking.id, { satisfied: true, stars: 5, tags: ['onTime'], comment: '' });
    expect(rated.rating?.stars).toBe(5);
  });

  it('declining the quote closes the visit with only the visit fee paid', async () => {
    const t = await toQuote();
    const b = await t.backend.bookings.decideQuote(t.session.token, t.booking.id, 'MAIN', 'DECLINE');
    expect(b.status).toBe('CLOSED_NO_REPAIR');
    expect(b.quote?.decision).toBe('REJECTED');
    expect(b.finalPayment).toBeNull();
    expect(b.visitPayment.state).toBe('PAID');
  });

  it('asks before extra work and bills only what was approved', async () => {
    const t = await toQuote({ extraWork: true });
    const q = await t.backend.bookings.decideQuote(t.session.token, t.booking.id, 'MAIN', 'APPROVE');
    t.advance(9);
    await t.get();
    t.advance(3);
    const x = await t.get();
    expect(x.status).toBe('EXTRA_WORK');
    expect(x.extraQuote?.total).toBe(340);
    await t.backend.bookings.decideQuote(t.session.token, t.booking.id, 'EXTRA', 'APPROVE');
    t.advance(12);
    const due = await t.get();
    expect(due.status).toBe('PAYMENT_DUE');
    expect(due.finalPayment?.amount).toBe((q.quote?.total ?? 0) + 340);
  });

  it('declined extra work is not billed', async () => {
    const t = await toQuote({ extraWork: true });
    const q = await t.backend.bookings.decideQuote(t.session.token, t.booking.id, 'MAIN', 'APPROVE');
    t.advance(9);
    await t.get();
    t.advance(3);
    await t.get();
    await t.backend.bookings.decideQuote(t.session.token, t.booking.id, 'EXTRA', 'DECLINE');
    t.advance(12);
    expect((await t.get()).finalPayment?.amount).toBe(q.quote?.total);
  });

  it('refunds the visit fee when cancelled before travel, keeps it after', async () => {
    const early = await paid();
    const c = await early.backend.bookings.cancel(early.session.token, early.booking.id, 'PLANS_CHANGED');
    expect(c.status).toBe('CANCELLED');
    expect(c.cancelReason).toBe('PLANS_CHANGED');
    expect(c.visitPayment.state).toBe('REFUNDED');
    await expect(early.backend.bookings.cancel(early.session.token, early.booking.id, null)).rejects.toMatchObject({ code: 'CONFLICT' });

    const late = await paid();
    late.advance(8);
    await late.get();
    late.advance(4);
    expect((await late.get()).status).toBe('EN_ROUTE');
    const k = await late.backend.bookings.cancel(late.session.token, late.booking.id, null);
    expect(k.visitPayment.state).toBe('PAID');
  });

  it('cannot be cancelled once the technician is at the door', async () => {
    const t = await toQuote();
    await expect(t.backend.bookings.cancel(t.session.token, t.booking.id, null)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a scheduled visit waits until 30 minutes before its window', async () => {
    const t = await paid({ time: TOMORROW_10 });
    t.advance(8);
    expect((await t.get()).status).toBe('ASSIGNED');
    t.advance(60 * 60 * 20); // about 05:00 next day
    expect((await t.get()).status).toBe('ASSIGNED');
    t.advance(60 * 60 * 4.5); // about 09:30
    expect((await t.get()).status).toBe('EN_ROUTE');
  });

  it('goes through "still searching" in the slow scenario', async () => {
    const t = await paid({ matching: 'SLOW' });
    t.advance(8);
    expect((await t.get()).status).toBe('MATCHING_DELAYED');
    t.advance(15);
    expect((await t.get()).status).toBe('ASSIGNED');
  });

  it('ends without a technician, then a reschedule restarts matching', async () => {
    const t = await paid({ matching: 'NONE', time: TOMORROW_10 });
    t.advance(30);
    expect((await t.get()).status).toBe('UNFULFILLED');
    await t.backend.demo?.updateSettings({ matching: 'QUICK' });
    const date = TOMORROW_10.window?.date ?? '';
    const other = slotsFor(date, 'plumb-tap', new Date(t.now())).find((s) => s.state === 'OPEN' && s.startHour !== 10);
    if (!other) throw new Error('fixture: no other open slot');
    const time: VisitTime = { mode: 'SCHEDULED', window: { date: other.date, startHour: other.startHour, endHour: other.endHour } };
    const r = await t.backend.bookings.reschedule(t.session.token, t.booking.id, time);
    expect(r.status).toBe('MATCHING');
    expect(r.time.window?.startHour).toBe(other.startHour);
    expect(r.technician).toBeNull();
    t.advance(9);
    expect((await t.get()).status).toBe('ASSIGNED');
  });

  it('refuses closed slots and instant visits at night', async () => {
    const t = await created();
    const today8: VisitTime = { mode: 'SCHEDULED', window: { date: isoDate(new Date(t.now())), startHour: 8, endHour: 10 } };
    await expect(t.backend.bookings.create(t.session.token, { serviceId: 'plumb-tap', problem: PROBLEM, addressId: t.addressId, time: today8, preferWomenRated: false }, key()))
      .rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    const night = await created({ time: TOMORROW_10, start: new Date(2026, 9, 15, 22, 30).getTime() });
    await expect(night.backend.bookings.create(night.session.token, { serviceId: 'plumb-tap', problem: PROBLEM, addressId: night.addressId, time: INSTANT, preferWomenRated: false }, key()))
      .rejects.toMatchObject({ code: 'INSTANT_UNAVAILABLE' });
  });

  it('fails the next request once when asked to, and says it was simulated', async () => {
    const t = await created();
    await t.backend.demo?.updateSettings({ failNext: 'NETWORK' });
    await expect(t.backend.bookings.list(t.session.token)).rejects.toMatchObject({ code: 'NETWORK', simulated: true });
    await expect(t.backend.bookings.list(t.session.token)).resolves.toHaveLength(1);
  });

  it('simulates a slot being taken on the next booking only', async () => {
    const t = await created();
    await t.backend.demo?.updateSettings({ failNext: 'SLOT_TAKEN' });
    await expect(t.backend.addresses.list(t.session.token)).resolves.toHaveLength(1);
    await expect(t.backend.bookings.create(t.session.token, { serviceId: 'plumb-tap', problem: PROBLEM, addressId: t.addressId, time: TOMORROW_10, preferWomenRated: false }, key()))
      .rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE', simulated: true });
  });

  it('demo controls jump to a matching outcome or the next step', async () => {
    const t = await paid();
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'DELAY'))?.status).toBe('MATCHING_DELAYED');
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'NONE'))?.status).toBe('UNFULFILLED');
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'ASSIGN'))?.technician?.name.en).toBe('Ramesh Kumar');
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'NEXT'))?.status).toBe('EN_ROUTE');
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'NEXT'))?.status).toBe('ARRIVED');
  });

  it('keeps bookings across a restart of the demo backend', async () => {
    const t = await created();
    const again = createMockBackend({ store: t.store, now: t.now, latency: [0, 0] });
    expect(await again.bookings.list(t.session.token)).toHaveLength(1);
  });
});

describe('demo AI', () => {
  it('suggests a service for sample photos and admits it cannot read real ones', async () => {
    const { backend } = setup();
    const s = await backend.ai.classifyPhoto('t', { id: 'p1', sample: 3 });
    expect(s.serviceId).toBe('elec-switch');
    expect(s.alternatives).not.toContain('elec-switch');
    const real = await backend.ai.classifyPhoto('t', { id: 'p2', uri: 'file:///photo.jpg' });
    expect(real.serviceId).toBeNull();
    expect(real.alternatives.length).toBeGreaterThan(0);
  });

  it('writes a note from a voice recording in the chosen language', async () => {
    const { backend } = setup();
    expect((await backend.ai.transcribe('t', { uri: 'file:///n.m4a', durationSec: 6 }, 'plumb-tap', 'en')).text).toMatch(/leaking/);
    expect((await backend.ai.transcribe('t', { uri: 'file:///n.m4a', durationSec: 6 }, 'plumb-tap', 'te')).text).toMatch(/నీరు/);
  });

  it('answers support questions and offers a person when it is stuck', async () => {
    const { backend } = setup();
    const { session } = await signIn(backend);
    expect((await backend.ai.chat(session.token, 'How much does it cost?', 'en')).text).toMatch(/₹49/);
    expect((await backend.ai.chat(session.token, 'I want to talk to a person', 'en')).offerHuman).toBe(true);
    expect((await backend.ai.chat(session.token, 'which colour is the sky', 'en')).offerHuman).toBe(true);
  });
});

describe('technician app', () => {
  const PROFILE = {
    name: 'Swathi Naidu', gender: 'F' as const, experienceYears: 5, skills: ['PLUMBING' as const], city: 'Hyderabad', pincode: '500034',
    areas: 'Banjara Hills, Jubilee Hills', vehicle: '', photo: 'demo:tech_woman',
  };

  async function techSignIn(backend: Backend, phone = '9000000001') {
    const ch = await backend.tech.auth.requestOtp(phone);
    return backend.tech.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '');
  }

  async function approvedTech(t: ReturnType<typeof setup>, phone?: string): Promise<string> {
    const { session } = await techSignIn(t.backend, phone);
    await t.backend.tech.submitProfile(session.token, PROFILE);
    t.advance(8);
    expect((await t.backend.tech.me(session.token)).verification).toBe('APPROVED');
    await t.backend.tech.setOnline(session.token, true);
    return session.token;
  }

  /** A customer with an address and a paid instant booking for a tap repair. */
  async function paidBooking(t: ReturnType<typeof setup>, phone = '9876543210') {
    const { session } = await signIn(t.backend, phone);
    const a = await t.backend.addresses.create(session.token, ADDRESS);
    const b = await t.backend.bookings.create(session.token, { serviceId: 'plumb-tap', problem: PROBLEM, addressId: a.id, time: INSTANT, preferWomenRated: false }, key());
    await t.backend.bookings.pay(session.token, b.id, 'VISIT', 'UPI', key());
    return { token: session.token, id: b.id };
  }

  const LABOUR = { kind: 'LABOUR' as const, name: 'Repair labour', qty: 1, unitPrice: 120 };
  const MATERIAL = { kind: 'MATERIAL' as const, name: 'Washer and sealant', qty: 1, unitPrice: 200 };

  it('signs up, waits for verification and only then goes online', async () => {
    const t = setup();
    const { session, isNew } = await techSignIn(t.backend);
    expect(isNew).toBe(true);
    await expect(t.backend.tech.submitProfile(session.token, { ...PROFILE, skills: [] })).rejects.toMatchObject({ code: 'VALIDATION' });
    const p = await t.backend.tech.submitProfile(session.token, PROFILE);
    expect(p.verification).toBe('PENDING');
    await expect(t.backend.tech.setOnline(session.token, true)).rejects.toMatchObject({ code: 'NOT_VERIFIED' });
    t.advance(8);
    expect((await t.backend.tech.me(session.token)).verification).toBe('APPROVED');
    expect((await t.backend.tech.setOnline(session.token, true)).online).toBe(true);
    const inbox = await t.backend.tech.notifications.list(session.token);
    expect(inbox.map((n) => n.kind)).toContain('PROFILE_APPROVED');
  });

  it('can be sent back once for a correction', async () => {
    const t = setup();
    await t.backend.demo?.updateSettings({ verification: 'CORRECTION' });
    const { session } = await techSignIn(t.backend);
    await t.backend.tech.submitProfile(session.token, PROFILE);
    t.advance(8);
    const p = await t.backend.tech.me(session.token);
    expect(p.verification).toBe('NEEDS_CORRECTION');
    expect(p.correctionNote?.en).toMatch(/localities/);
    await t.backend.tech.submitProfile(session.token, PROFILE);
    t.advance(8);
    expect((await t.backend.tech.me(session.token)).verification).toBe('APPROVED');
  });

  it('runs a real customer booking end to end through the technician app', async () => {
    const t = setup();
    const tech = await approvedTech(t);
    const c = await paidBooking(t);

    // The booking is offered to the online technician: area only, no house number.
    const offer = await t.backend.tech.offer(tech);
    expect(offer?.bookingId).toBe(c.id);
    expect(offer?.area).not.toContain('Flat 4B');
    t.advance(10);
    expect((await t.backend.bookings.get(c.token, c.id)).status).toBe('MATCHING'); // held for the technician

    const job = await t.backend.tech.acceptOffer(tech, offer?.id ?? '');
    expect(job.status).toBe('ASSIGNED');
    expect(job.address.house).toBe('Flat 4B, Lake View');
    const assigned = await t.backend.bookings.get(c.token, c.id);
    expect(assigned.technician?.name.en).toBe('Swathi Naidu');
    expect(assigned.viaTechApp).toBe(true);
    t.advance(120);
    expect((await t.backend.bookings.get(c.token, c.id)).status).toBe('ASSIGNED'); // no simulator: waits for the technician

    await t.backend.tech.startTrip(tech, c.id);
    expect((await t.backend.bookings.get(c.token, c.id)).status).toBe('EN_ROUTE');
    await t.backend.tech.arrived(tech, c.id);
    const code = (await t.backend.bookings.get(c.token, c.id)).arrivalOtp;
    const wrong = code === '0000' ? '1111' : '0000';
    await expect(t.backend.tech.verifyStartCode(tech, c.id, wrong)).rejects.toMatchObject({ code: 'OTP_INVALID', attemptsLeft: 4 });
    expect((await t.backend.tech.verifyStartCode(tech, c.id, code)).status).toBe('INSPECTING');

    // Quote: 120 labour + 200 materials, price-checked before the customer sees it.
    await expect(t.backend.tech.submitQuote(tech, c.id, 'MAIN', { diagnosis: 'Worn washer', lines: [{ ...LABOUR, unitPrice: 50 }] }))
      .rejects.toMatchObject({ code: 'VALIDATION' }); // below the minimum
    const sent = await t.backend.tech.submitQuote(tech, c.id, 'MAIN', { diagnosis: 'Worn washer under the sink', lines: [LABOUR, MATERIAL] });
    expect(sent.quote?.review.state).toBe('CHECKING');
    expect((await t.backend.bookings.get(c.token, c.id)).quote).toBeNull();
    t.advance(3);
    const shared = await t.backend.bookings.get(c.token, c.id);
    expect(shared.status).toBe('QUOTE_SHARED');
    expect(shared.quote).toMatchObject({ labourTotal: 120, materialTotal: 200, total: 320, review: { state: 'FAIR' } });
    const inbox = await t.backend.notifications.list(c.token);
    expect(inbox.find((n) => n.kind === 'QUOTE_READY')?.params.amount).toBe(320);

    // The customer asks for a lower price; the technician revises.
    await t.backend.bookings.decideQuote(c.token, c.id, 'MAIN', 'REVISION');
    expect((await t.backend.tech.job(tech, c.id)).quote?.decision).toBe('REVISION_REQUESTED');
    expect((await t.backend.tech.notifications.list(tech)).map((n) => n.kind)).toContain('QUOTE_REVISION');
    await t.backend.tech.submitQuote(tech, c.id, 'MAIN', { diagnosis: 'Worn washer under the sink', lines: [{ ...LABOUR, unitPrice: 100 }, MATERIAL] });
    t.advance(3);
    const revised = await t.backend.bookings.get(c.token, c.id);
    expect(revised.quote).toMatchObject({ version: 2, total: 300 });

    await t.backend.bookings.decideQuote(c.token, c.id, 'MAIN', 'APPROVE');
    await expect(t.backend.tech.completeWork(tech, c.id)).rejects.toMatchObject({ code: 'CONFLICT' }); // not started yet
    await t.backend.tech.startWork(tech, c.id);
    const done = await t.backend.tech.completeWork(tech, c.id);
    expect(done.status).toBe('PAYMENT_DUE');
    expect(done.finalPayment?.amount).toBe(300);

    // Cash: the customer pays, the technician confirms.
    const r = await t.backend.bookings.pay(c.token, c.id, 'FINAL', 'CASH', key());
    expect(r.state).toBe('PENDING');
    t.advance(30);
    expect((await t.backend.bookings.get(c.token, c.id)).status).toBe('PAYMENT_DUE');
    expect((await t.backend.tech.confirmCash(tech, c.id)).status).toBe('COMPLETED');
    expect((await t.backend.bookings.get(c.token, c.id)).status).toBe('COMPLETED');

    const earnings = await t.backend.tech.earnings(tech);
    expect(earnings.today).toBe(30 + 80 + 200);
    expect(earnings.entries[0]?.payout).toBe('PENDING');
    // This week's earnings are paid next Monday; eight weeks are listed, newest first.
    expect(earnings.weeks).toHaveLength(8);
    expect(earnings.weeks?.[0]).toMatchObject({ earned: 30 + 80 + 200, jobs: 1, payout: { state: 'UPCOMING' } });
    expect((await t.backend.bookings.get(c.token, c.id)).technician?.womenRated).toBe(false);
    await expect(t.backend.bookings.rate(c.token, c.id, { satisfied: true, stars: 5, tags: [], comment: '', byWoman: 'yes' as unknown as boolean }))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await t.backend.bookings.rate(c.token, c.id, { satisfied: true, stars: 5, tags: ['fixed'], comment: '', byWoman: true });
    expect((await t.backend.tech.me(tech)).rating).toBe(5);
    // A 5-star rating from a customer who said she is a woman: the technician now shows "Rated highly by women".
    expect((await t.backend.bookings.get(c.token, c.id)).technician?.womenRated).toBe(true);
  });

  it('gives the job to someone else when the offer is missed or rejected', async () => {
    const t = setup();
    const tech = await approvedTech(t);
    const c = await paidBooking(t);
    const offer = await t.backend.tech.offer(tech);
    expect(offer).not.toBeNull();
    t.advance(46);
    expect(await t.backend.tech.offer(tech)).toBeNull();
    await expect(t.backend.tech.acceptOffer(tech, offer?.id ?? '')).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
    t.advance(8);
    const b = await t.backend.bookings.get(c.token, c.id);
    expect(b.status).toBe('ASSIGNED');
    expect(b.technician?.name.en).toBe('Ramesh Kumar'); // simulated technician

    const c2 = await paidBooking(t, '9876500002');
    const o2 = await t.backend.tech.offer(tech);
    expect(o2?.bookingId).toBe(c2.id);
    await t.backend.tech.rejectOffer(tech, o2?.id ?? '', 'TOO_FAR');
    expect(await t.backend.tech.offer(tech)).toBeNull();
    t.advance(8);
    expect((await t.backend.bookings.get(c2.token, c2.id)).technician?.name.en).toBe('Ramesh Kumar');
  });

  it('keeps jobs private to the assigned technician and the customer', async () => {
    const t = setup();
    const tech = await approvedTech(t);
    const c = await paidBooking(t);
    const offer = await t.backend.tech.offer(tech);
    await t.backend.tech.acceptOffer(tech, offer?.id ?? '');
    const other = await approvedTech(t, '9000000002');
    await expect(t.backend.tech.job(other, c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.backend.tech.startTrip(other, c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { session: stranger } = await signIn(t.backend, '9876500003');
    await expect(t.backend.bookings.get(stranger.token, c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.backend.tech.job('not-a-token', c.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('tells the technician when the customer cancels', async () => {
    const t = setup();
    const tech = await approvedTech(t);
    const c = await paidBooking(t);
    await t.backend.tech.acceptOffer(tech, (await t.backend.tech.offer(tech))?.id ?? '');
    const cancelled = await t.backend.bookings.cancel(c.token, c.id, 'PLANS_CHANGED');
    expect(cancelled.visitPayment.state).toBe('REFUNDED');
    expect((await t.backend.tech.job(tech, c.id)).status).toBe('CANCELLED');
    expect((await t.backend.tech.notifications.list(tech)).map((n) => n.kind)).toContain('JOB_CANCELLED');
  });

  it('sends unusually high quotes to a reviewer before the customer sees them', async () => {
    const t = setup();
    const tech = await approvedTech(t);
    const c = await paidBooking(t);
    await t.backend.tech.acceptOffer(tech, (await t.backend.tech.offer(tech))?.id ?? '');
    await t.backend.tech.startTrip(tech, c.id);
    await t.backend.tech.arrived(tech, c.id);
    await t.backend.tech.verifyStartCode(tech, c.id, (await t.backend.demo?.startCode(tech, c.id)) ?? '');
    await t.backend.tech.submitQuote(tech, c.id, 'MAIN', { diagnosis: 'Full replacement', lines: [{ kind: 'LABOUR', name: 'Labour', qty: 1, unitPrice: 2000 }] });
    t.advance(3);
    expect((await t.backend.tech.job(tech, c.id)).quote?.review.state).toBe('UNDER_REVIEW');
    expect((await t.backend.bookings.get(c.token, c.id)).quote).toBeNull();
    t.advance(8);
    const b = await t.backend.bookings.get(c.token, c.id);
    expect(b.status).toBe('QUOTE_SHARED');
    expect(b.quote?.review.state).toBe('CLEARED');
  });

  it('runs a practice job with a simulated customer', async () => {
    const t = setup();
    const tech = await approvedTech(t);
    const offer = await t.backend.demo?.practiceJob(tech);
    const job = await t.backend.tech.acceptOffer(tech, offer?.id ?? '');
    expect(job.practice).toBe(true);
    await t.backend.tech.startTrip(tech, job.id);
    await t.backend.tech.arrived(tech, job.id);
    await t.backend.tech.verifyStartCode(tech, job.id, (await t.backend.demo?.startCode(tech, job.id)) ?? '');
    await t.backend.tech.submitQuote(tech, job.id, 'MAIN', { diagnosis: 'Worn washer', lines: [LABOUR, MATERIAL] });
    t.advance(3);
    expect((await t.backend.tech.job(tech, job.id)).status).toBe('QUOTE_SHARED');
    t.advance(6);
    expect((await t.backend.tech.job(tech, job.id)).status).toBe('IN_PROGRESS'); // simulated customer approved
    await t.backend.tech.startWork(tech, job.id);
    await t.backend.tech.completeWork(tech, job.id);
    t.advance(6);
    const paid = await t.backend.tech.job(tech, job.id);
    expect(paid.status).toBe('COMPLETED');
    expect(paid.earning).toBe(30 + 96 + 200);
  });
});

describe('demo AI top problems', () => {
  it('ranks 6 different problems for a locality', async () => {
    const { backend } = setup();
    const r = await backend.ai.topProblems('t', '500034', 'Banjara Hills, Hyderabad');
    expect(r.area).toBe('Banjara Hills, Hyderabad');
    expect(r.items).toHaveLength(6);
    expect(new Set(r.items.map((x) => x.issueId)).size).toBe(6);
    expect(r.items[0]?.recentCount ?? 0).toBeGreaterThanOrEqual(r.items[5]?.recentCount ?? 0);
    expect((await backend.ai.topProblems('t', null, null)).area).toBeNull();
  });
});
