import { isoDate, slotsFor } from '../domain/rules';
import type { Session } from '../domain/types';
import { ApiError, type Backend } from '../services/api';
import { createMockBackend, memoryStore } from '../services/mock/MockBackend';

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

const ADDRESS = { label: 'HOME' as const, house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', pincode: '500034' };
const TOMORROW_10 = { date: isoDate(new Date(2026, 9, 16)), startHour: 10, endHour: 12 };
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
    await expect(backend.addresses.create(session.token, { ...ADDRESS, pincode: '518001' })).rejects.toBeInstanceOf(ApiError);
    const a = await backend.addresses.create(session.token, ADDRESS);
    expect(a.city).toBe('Hyderabad');
    await backend.addresses.update(session.token, a.id, { ...ADDRESS, label: 'WORK' });
    expect((await backend.addresses.list(session.token))[0]?.label).toBe('WORK');
    await backend.addresses.remove(session.token, a.id);
    expect(await backend.addresses.list(session.token)).toHaveLength(0);
  });
});

describe('demo bookings', () => {
  async function booked(scenario: 'QUICK' | 'SLOW' | 'NONE' = 'QUICK') {
    const t = setup();
    const { session } = await signIn(t.backend);
    const a = await t.backend.addresses.create(session.token, ADDRESS);
    await t.backend.demo?.updateSettings({ matching: scenario });
    const b = await t.backend.bookings.create(session.token, { serviceId: 'plumb-tap', problem: PROBLEM, addressId: a.id, window: TOMORROW_10 });
    return { ...t, session, booking: b, addressId: a.id };
  }

  it('starts matching, then assigns a labelled demo technician', async () => {
    const t = await booked('QUICK');
    expect(t.booking.status).toBe('MATCHING');
    expect(t.booking.code).toMatch(/^HF-\d{5}$/);
    expect(t.booking.visitFee).toBe(199);
    t.advance(9);
    const b = await t.backend.bookings.get(t.session.token, t.booking.id);
    expect(b.status).toBe('ASSIGNED');
    expect(b.technician?.demo).toBe(true);
    expect(b.history.map((h) => h.status)).toEqual(['MATCHING', 'ASSIGNED']);
  });

  it('goes through "still searching" in the slow scenario', async () => {
    const t = await booked('SLOW');
    t.advance(8);
    expect((await t.backend.bookings.get(t.session.token, t.booking.id)).status).toBe('MATCHING_DELAYED');
    t.advance(15);
    const b = await t.backend.bookings.get(t.session.token, t.booking.id);
    expect(b.status).toBe('ASSIGNED');
    expect(b.history.map((h) => h.status)).toEqual(['MATCHING', 'MATCHING_DELAYED', 'ASSIGNED']);
  });

  it('ends without a technician, then a reschedule restarts matching', async () => {
    const t = await booked('NONE');
    t.advance(30);
    expect((await t.backend.bookings.get(t.session.token, t.booking.id)).status).toBe('UNFULFILLED');
    await t.backend.demo?.updateSettings({ matching: 'QUICK' });
    const other = slotsFor(TOMORROW_10.date, 'plumb-tap', new Date(t.now())).find((s) => s.state === 'OPEN' && s.startHour !== 10);
    if (!other) throw new Error('fixture: no other open slot');
    const r = await t.backend.bookings.reschedule(t.session.token, t.booking.id, { date: other.date, startHour: other.startHour, endHour: other.endHour });
    expect(r.status).toBe('MATCHING');
    expect(r.window.startHour).toBe(other.startHour);
    expect(r.technician).toBeNull();
    t.advance(9);
    expect((await t.backend.bookings.get(t.session.token, t.booking.id)).status).toBe('ASSIGNED');
  });

  it('cancels with a reason and refuses a second cancel', async () => {
    const t = await booked();
    const c = await t.backend.bookings.cancel(t.session.token, t.booking.id, 'PLANS_CHANGED');
    expect(c.status).toBe('CANCELLED');
    expect(c.cancelReason).toBe('PLANS_CHANGED');
    t.advance(60);
    expect((await t.backend.bookings.get(t.session.token, t.booking.id)).status).toBe('CANCELLED');
    await expect(t.backend.bookings.cancel(t.session.token, t.booking.id, null)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses closed slots', async () => {
    const t = await booked();
    const today8 = { date: isoDate(new Date(t.now())), startHour: 8, endHour: 10 };
    await expect(t.backend.bookings.create(t.session.token, { serviceId: 'plumb-tap', problem: PROBLEM, addressId: t.addressId, window: today8 }))
      .rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('fails the next request once when asked to, and says it was simulated', async () => {
    const t = await booked();
    await t.backend.demo?.updateSettings({ failNext: 'NETWORK' });
    await expect(t.backend.bookings.list(t.session.token)).rejects.toMatchObject({ code: 'NETWORK', simulated: true });
    await expect(t.backend.bookings.list(t.session.token)).resolves.toHaveLength(1);
  });

  it('simulates a slot being taken on the next booking only', async () => {
    const t = await booked();
    await t.backend.demo?.updateSettings({ failNext: 'SLOT_TAKEN' });
    await expect(t.backend.addresses.list(t.session.token)).resolves.toHaveLength(1);
    await expect(t.backend.bookings.create(t.session.token, { serviceId: 'plumb-tap', problem: PROBLEM, addressId: t.addressId, window: TOMORROW_10 }))
      .rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE', simulated: true });
  });

  it('demo controls jump to any matching outcome', async () => {
    const t = await booked();
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'DELAY'))?.status).toBe('MATCHING_DELAYED');
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'NONE'))?.status).toBe('UNFULFILLED');
    expect((await t.backend.demo?.simulate(t.session.token, t.booking.id, 'ASSIGN'))?.technician?.name.en).toBe('Ramesh Kumar');
  });

  it('keeps bookings across a restart of the demo backend', async () => {
    const t = await booked();
    const again = createMockBackend({ store: t.store, now: t.now, latency: [0, 0] });
    expect(await again.bookings.list(t.session.token)).toHaveLength(1);
  });
});
