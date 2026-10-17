// Technician identity: permanent Technician ID, locked identity fields, verification states, the ID card for the
// technician and for the customer of an assigned booking, the QR verification page, and who may see what.
import {
  displayName, isGenuinelyVerified, isValidPhoto, newTechCode, newVerifyToken, TECH_CODE_RE, verificationLook, VERIFY_TOKEN_RE,
} from '../domain/identity';
import type { VisitTime } from '../domain/types';
import type { Backend } from '../services/api';
import { createMockBackend, DEMO_VERIFY_BASE, memoryStore } from '../services/mock/MockBackend';

const webCrypto = (globalThis as unknown as { crypto: { getRandomValues: (a: Uint8Array) => Uint8Array } }).crypto;
const bytes = (n: number) => webCrypto.getRandomValues(new Uint8Array(n));

function setup() {
  let now = new Date(2026, 9, 15, 9, 0).getTime();
  const backend = createMockBackend({ store: memoryStore(), now: () => now, latency: [0, 0], pollMs: 10_000, randomBytes: bytes });
  return { backend, advance: (sec: number) => { now += sec * 1000; } };
}

const PROFILE = {
  name: 'Swathi Naidu', gender: 'F' as const, experienceYears: 5, skills: ['PLUMBING' as const], city: 'Hyderabad', pincode: '500034',
  areas: 'Banjara Hills, Jubilee Hills', vehicle: '', photo: 'demo:tech_woman',
};
const ADDRESS = { label: 'HOME' as const, house: 'Flat 4B', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034' };
const INSTANT: VisitTime = { mode: 'INSTANT', window: null };

async function techSignIn(backend: Backend, phone = '9000000001') {
  const ch = await backend.tech.auth.requestOtp(phone);
  return (await backend.tech.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).session;
}

async function customer(backend: Backend, phone = '9876543210') {
  const ch = await backend.auth.requestOtp(phone);
  return (await backend.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).session.token;
}

async function paidBooking(backend: Backend, token: string) {
  const a = await backend.addresses.create(token, ADDRESS);
  const b = await backend.bookings.create(token, {
    serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId: a.id, time: INSTANT, preferWomenRated: false,
  });
  await backend.bookings.pay(token, b.id, 'VISIT', 'UPI');
  return b.id;
}

describe('Technician ID', () => {
  it('has the N9-HF-T-XXXXXX format with unambiguous characters', () => {
    for (let i = 0; i < 500; i++) expect(newTechCode(bytes, new Set())).toMatch(TECH_CODE_RE);
    expect(TECH_CODE_RE.test('N9-HF-T-7K4M9Q')).toBe(true);
    expect(TECH_CODE_RE.test('N9-HF-T-0O1IL5')).toBe(false);
  });

  it('never repeats an issued ID, even when the random source collides', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const code = newTechCode(bytes, taken);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
    // A source that first repeats an issued ID: the generator draws again.
    const fixed = new Uint8Array(12).fill(0);
    const first = newTechCode(() => fixed, new Set());
    let calls = 0;
    const repeating = (n: number) => (calls++ < 1 ? fixed.slice(0, n) : bytes(n));
    const second = newTechCode(repeating, new Set([first]));
    expect(second).not.toBe(first);
  });

  it('does not come from the name, phone or a counter', async () => {
    const t = setup();
    const codes: string[] = [];
    for (const phone of ['9000000001', '9000000002', '9000000003']) {
      const s = await techSignIn(t.backend, phone);
      const p = await t.backend.tech.submitProfile(s.token, PROFILE);
      codes.push(p.identity?.techCode ?? '');
    }
    expect(new Set(codes).size).toBe(3);
    for (const c of codes) {
      expect(c).toMatch(TECH_CODE_RE);
      expect(c).not.toMatch(/000000|SWATHI|NAIDU/);
    }
  });
});

describe('verification token and page', () => {
  it('tokens are long, random and carry no personal data', () => {
    const a = newVerifyToken(bytes);
    expect(a).toMatch(VERIFY_TOKEN_RE);
    expect(newVerifyToken(bytes)).not.toBe(a);
  });

  it('the QR link resolves to the current status, and follows a withdrawn approval', async () => {
    const t = setup();
    const s = await techSignIn(t.backend);
    await t.backend.tech.submitProfile(s.token, PROFILE);
    const card = await t.backend.tech.idCard(s.token);
    expect(card.verifyUrl.startsWith(DEMO_VERIFY_BASE)).toBe(true);
    expect(card.verifyUrl).not.toMatch(/Swathi|9000000001|PLUMBING/);
    const token = card.verifyUrl.slice(DEMO_VERIFY_BASE.length);

    let page = await t.backend.verify.technician(token);
    expect(page).toMatchObject({ techCode: card.techCode, displayName: 'Swathi N.', verification: 'PENDING', active: false, simulated: true });
    expect(page.photo).toBeNull(); // not approved yet

    t.advance(8);
    page = await t.backend.verify.technician(token);
    expect(page).toMatchObject({ verification: 'APPROVED', active: true });
    expect(page.photo).toBe('demo:tech_woman');

    await t.backend.demo?.setSuspended(s.token, true);
    page = await t.backend.verify.technician(token);
    expect(page).toMatchObject({ verification: 'SUSPENDED', active: false });
  });

  it('unknown or malformed tokens are not found', async () => {
    const t = setup();
    await expect(t.backend.verify.technician('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.backend.verify.technician(newVerifyToken(bytes))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('identity fields', () => {
  it('the first submission needs a valid photo', async () => {
    const t = setup();
    const s = await techSignIn(t.backend);
    const { photo: _p, ...noPhoto } = PROFILE;
    await expect(t.backend.tech.submitProfile(s.token, noPhoto)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(t.backend.tech.submitProfile(s.token, { ...PROFILE, photo: 'https://example.com/a.jpg' })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(isValidPhoto('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isValidPhoto('data:text/html;base64,PGh0bWw+')).toBe(false);
  });

  it('legal name, photo and Technician ID cannot be changed by the technician', async () => {
    const t = setup();
    const s = await techSignIn(t.backend);
    const first = await t.backend.tech.submitProfile(s.token, PROFILE);
    t.advance(8);
    await expect(t.backend.tech.submitProfile(s.token, { ...PROFILE, name: 'Someone Else' })).rejects.toMatchObject({ code: 'IDENTITY_LOCKED' });
    const edited = await t.backend.tech.submitProfile(s.token, { ...PROFILE, areas: 'Banjara Hills, Madhapur', photo: 'demo:tech_man' });
    expect(edited.identity?.techCode).toBe(first.identity?.techCode);
    expect(edited.identity?.photo).toBe('demo:tech_woman');
    expect(edited.identity?.legalName).toBe('Swathi Naidu');
    expect(edited.areas).toBe('Banjara Hills, Madhapur');
  });

  it('corrections go to support as a request', async () => {
    const t = setup();
    const s = await techSignIn(t.backend);
    await expect(t.backend.tech.requestIdentityCorrection(s.token, 'NAME', 'Spelling')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await t.backend.tech.submitProfile(s.token, PROFILE);
    const p = await t.backend.tech.requestIdentityCorrection(s.token, 'NAME', 'Spelling of my surname');
    expect(p.identity?.correctionRequest).toMatchObject({ kind: 'NAME' });
    expect(p.identity?.legalName).toBe('Swathi Naidu');
  });
});

describe('verification states', () => {
  it('only a genuine approval is shown as verified', () => {
    expect(isGenuinelyVerified('APPROVED', false)).toBe(true);
    expect(isGenuinelyVerified('APPROVED', true)).toBe(false);
    expect(verificationLook('APPROVED', true)).toBe('DEMO');
    for (const v of ['PENDING', 'NEEDS_CORRECTION', 'REJECTED', 'SUSPENDED'] as const) {
      expect(isGenuinelyVerified(v, false)).toBe(false);
      expect(verificationLook(v, false)).not.toBe('VERIFIED');
    }
    expect(verificationLook(null, false)).toBe('UNKNOWN');
  });

  it('the demo backend marks every verification as simulated', async () => {
    const t = setup();
    const s = await techSignIn(t.backend);
    await t.backend.tech.submitProfile(s.token, PROFILE);
    t.advance(8);
    const card = await t.backend.tech.idCard(s.token);
    expect(card).toMatchObject({ verification: 'APPROVED', simulated: true, verifyIsDemo: true });
  });

  it('a suspended technician cannot go online', async () => {
    const t = setup();
    const s = await techSignIn(t.backend);
    await t.backend.tech.submitProfile(s.token, PROFILE);
    t.advance(8);
    await t.backend.tech.setOnline(s.token, true);
    await t.backend.demo?.setSuspended(s.token, true);
    const me = await t.backend.tech.me(s.token);
    expect(me).toMatchObject({ verification: 'SUSPENDED', online: false });
    await expect(t.backend.tech.setOnline(s.token, true)).rejects.toMatchObject({ code: 'NOT_VERIFIED' });
  });

  it('shows names as first name and initial on the public page', () => {
    expect(displayName('Swathi Naidu')).toBe('Swathi N.');
    expect(displayName('  Ravi  ')).toBe('Ravi');
  });
});

describe('ID card access', () => {
  it('the customer of an assigned booking sees that technician\'s card; nobody else does', async () => {
    const t = setup();
    const tech = await techSignIn(t.backend);
    await t.backend.tech.submitProfile(tech.token, PROFILE);
    t.advance(8);
    await t.backend.tech.setOnline(tech.token, true);

    const owner = await customer(t.backend);
    const bookingId = await paidBooking(t.backend, owner);
    await expect(t.backend.bookings.technicianCard(owner, bookingId)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // not assigned yet

    const offer = await t.backend.tech.offer(tech.token);
    expect(offer).not.toBeNull();
    await t.backend.tech.acceptOffer(tech.token, offer?.id ?? '');
    const card = await t.backend.bookings.technicianCard(owner, bookingId);
    const own = await t.backend.tech.idCard(tech.token);
    expect(card).toMatchObject({ techCode: own.techCode, name: 'Swathi Naidu', verification: 'APPROVED', simulated: true, fictional: false });
    expect(card.photo).toBe('demo:tech_woman');
    expect(Object.keys(card).sort()).toEqual(['fictional', 'gender', 'name', 'photo', 'photoStatus', 'simulated', 'skills', 'techCode', 'verification', 'verifyIsDemo', 'verifyUrl']);

    const booking = await t.backend.bookings.get(owner, bookingId);
    expect(booking.technician).toMatchObject({ techCode: own.techCode, verification: 'APPROVED', verificationSimulated: true });

    const stranger = await customer(t.backend, '9876500000');
    await expect(t.backend.bookings.technicianCard(stranger, bookingId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.backend.bookings.technicianCard('not-a-token', bookingId)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // A withdrawn approval reaches the customer's booking too.

    await t.backend.demo?.setSuspended(tech.token, true);
    expect((await t.backend.bookings.get(owner, bookingId)).technician?.verification).toBe('SUSPENDED');
    expect((await t.backend.bookings.technicianCard(owner, bookingId)).verification).toBe('SUSPENDED');
  });

  it('a cancelled booking no longer opens the technician card', async () => {
    const t = setup();
    const owner = await customer(t.backend);
    const bookingId = await paidBooking(t.backend, owner);
    t.advance(10);
    expect((await t.backend.bookings.get(owner, bookingId)).status).toBe('ASSIGNED');
    await t.backend.bookings.technicianCard(owner, bookingId);
    await t.backend.bookings.cancel(owner, bookingId, 'PLANS_CHANGED');
    expect((await t.backend.bookings.get(owner, bookingId)).status).toBe('CANCELLED');
    await expect(t.backend.bookings.technicianCard(owner, bookingId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a simulated technician gets a demo card with a permanent ID', async () => {
    const t = setup();
    const owner = await customer(t.backend);
    const bookingId = await paidBooking(t.backend, owner);
    t.advance(30);
    const b = await t.backend.bookings.get(owner, bookingId);
    expect(b.technician?.fictional).toBe(true);
    const card = await t.backend.bookings.technicianCard(owner, bookingId);
    expect(card).toMatchObject({ fictional: true, simulated: true, photo: null });
    expect(card.techCode).toBe(b.technician?.techCode);
    expect((await t.backend.bookings.technicianCard(owner, bookingId)).techCode).toBe(card.techCode);
  });

  it('the technician card needs the technician\'s own session', async () => {
    const t = setup();
    await expect(t.backend.tech.idCard('not-a-token')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const s = await techSignIn(t.backend);
    await expect(t.backend.tech.idCard(s.token)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // not registered yet
  });
});
