// What each side receives from the backend contract: no internal fields, no other person's private data.
import { MAX_QUOTE_LINES, quoteProblem } from '../domain/rules';
import type { VisitTime } from '../domain/types';
import type { Backend } from '../services/api';
import { createMockBackend, memoryStore } from '../services/mock/MockBackend';

/** A fresh idempotency key for each create / pay call. */
let keySeq = 0;
const key = () => `test-key-${++keySeq}`;

const webCrypto = (globalThis as unknown as { crypto: { getRandomValues: (a: Uint8Array) => Uint8Array } }).crypto;
const INSTANT: VisitTime = { mode: 'INSTANT', window: null };
const ADDRESS = { label: 'HOME' as const, house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: 'Near Ganesh temple', city: 'Hyderabad', pincode: '500034' };
const PROFILE = {
  name: 'Swathi Naidu', gender: 'F' as const, experienceYears: 5, skills: ['PLUMBING' as const], city: 'Hyderabad', pincode: '500034',
  areas: 'Banjara Hills', vehicle: '', photo: 'demo:tech_woman',
};

/** Every key anywhere in a value (to search for fields that must never leave the backend). */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}

async function world() {
  let now = new Date(2026, 9, 15, 9, 0).getTime();
  const backend: Backend = createMockBackend({ store: memoryStore(), now: () => now, latency: [0, 0], pollMs: 10_000, randomBytes: (n) => webCrypto.getRandomValues(new Uint8Array(n)) });
  const tch = await backend.tech.auth.requestOtp('9000000001');
  const tech = (await backend.tech.auth.verifyOtp(tch.challengeId, tch.demoCode ?? '')).session.token;
  await backend.tech.submitProfile(tech, PROFILE);
  now += 8000;
  await backend.tech.setOnline(tech, true);
  const ch = await backend.auth.requestOtp('9876543210');
  const customer = (await backend.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).session.token;
  await backend.auth.updateName(customer, 'Priya Sharma');
  const a = await backend.addresses.create(customer, ADDRESS);
  const b = await backend.bookings.create(customer, { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId: a.id, time: INSTANT, preferWomenRated: false }, key());
  await backend.bookings.pay(customer, b.id, 'VISIT', 'UPI', key());
  return { backend, tech, customer, bookingId: b.id };
}

const INTERNAL = ['customerId', 'techId', 'scenario', 'extraWorkPlanned', 'phaseStartedAt', 'declinedBy', 'otpTries', 'verifyToken', 'submittedAt', 'practice'];

describe('privacy of responses', () => {
  it('a booking carries no backend-internal fields', async () => {
    const w = await world();
    const offer = await w.backend.tech.offer(w.tech);
    await w.backend.tech.acceptOffer(w.tech, offer?.id ?? '');
    const booking = await w.backend.bookings.get(w.customer, w.bookingId);
    const keys = keysOf(booking);
    for (const k of INTERNAL) expect(keys.has(k)).toBe(false);
    // The technician as the customer sees them: no phone number of their own, only the masked one.
    expect(JSON.stringify(booking.technician)).not.toContain('9000000001');
  });

  it('a job offer shows the area only, never the house, landmark or the customer', async () => {
    const w = await world();
    const offer = await w.backend.tech.offer(w.tech);
    const text = JSON.stringify(offer);
    expect(text).not.toContain('Flat 4B');
    expect(text).not.toContain('Ganesh temple');
    expect(text).not.toContain('Priya');
    expect(text).not.toContain('9876543210');
  });

  it('an accepted job gives the technician a first name and a masked number, not the customer\'s phone', async () => {
    const w = await world();
    const offer = await w.backend.tech.offer(w.tech);
    const job = await w.backend.tech.acceptOffer(w.tech, offer?.id ?? '');
    expect(job.customerName).toBe('Priya');
    expect(JSON.stringify(job)).not.toContain('9876543210');
    expect(JSON.stringify(job)).not.toContain('Sharma');
    for (const k of INTERNAL.filter((x) => x !== 'practice')) expect(keysOf(job).has(k)).toBe(false); // practice is part of Job
  });

  it('profiles never carry tokens or review internals', async () => {
    const w = await world();
    const me = await w.backend.tech.me(w.tech);
    const keys = keysOf(me);
    for (const k of ['verifyToken', 'submittedAt', 'token']) expect(keys.has(k)).toBe(false);
    const card = await w.backend.tech.idCard(w.tech);
    expect(JSON.stringify(card)).not.toContain('9000000001');
    expect(card.verifyUrl).not.toMatch(/swathi|naidu|9000000001/i);
  });

  it('one customer cannot read another customer\'s booking or addresses', async () => {
    const w = await world();
    const ch = await w.backend.auth.requestOtp('9123456780');
    const other = (await w.backend.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).session.token;
    await expect(w.backend.bookings.get(other, w.bookingId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await w.backend.addresses.list(other)).toHaveLength(0);
    expect(await w.backend.bookings.list(other)).toHaveLength(0);
  });

  it('a technician cannot open a job that is not theirs', async () => {
    const w = await world();
    const tch = await w.backend.tech.auth.requestOtp('9000000002');
    const stranger = (await w.backend.tech.auth.verifyOtp(tch.challengeId, tch.demoCode ?? '')).session.token;
    await expect(w.backend.tech.job(stranger, w.bookingId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a quote is limited in size', () => {
    const line = { kind: 'LABOUR' as const, name: 'x', qty: 1, unitPrice: 100 };
    expect(quoteProblem('fixed', Array.from({ length: MAX_QUOTE_LINES }, () => line))).toBeNull();
    expect(quoteProblem('fixed', Array.from({ length: MAX_QUOTE_LINES + 1 }, () => line))).toBe('BAD_LINE');
  });
});
