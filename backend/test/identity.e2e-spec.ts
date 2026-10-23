// Technician identity end to end: the ID card with its QR link, the public verification check the QR opens, the
// customer's view of their technician's card, suspension and QR re-issue, the locked legal name, identity corrections,
// the women-rated badge, and Aadhaar Secure QR verification (with a test UIDAI key).
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { runTechCommand } from '../src/cli/technicians';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { TechVerificationService, type VerificationActor } from '../src/modules/technicians/tech-verification.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TECH_PROFILE, type TestApp, uploadProfilePhoto } from './helpers';

const HOME = { label: 'HOME', house: 'Flat 4B', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const ADMIN: VerificationActor = { type: 'ADMIN', id: null, via: 'cli:test' };
const uidai = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

/** An Aadhaar Secure QR as UIDAI makes it, signed with the test key. */
function aadhaarQr(name: string, last4 = '1234', dob = '14-08-1994', gender = 'F'): string {
  const fields = ['V2', '3', `${last4}20261012153045123`, name, dob, gender, 'D/O R', 'Hyderabad', '', '4-12', 'Banjara Hills', '500034', 'BH', 'Telangana', 'Road 12', 'Khairatabad', 'Hyderabad'];
  const body = Buffer.concat([...fields.map((f) => Buffer.concat([Buffer.from(f), Buffer.from([255])])), Buffer.from([0xff, 0x4f, 0xff, 0x51, 9, 9])]);
  const data = Buffer.concat([body, sign('sha256', body, uidai.privateKey)]);
  return BigInt(`0x${gzipSync(data).toString('hex')}`).toString(10);
}

describe('technician identity (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tokenOf = (url: string) => url.split('#')[1] as string;

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { UIDAI_QR_CERT_PEM_B64: Buffer.from(uidai.publicKey).toString('base64') } });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('ID card and QR verification', () => {
    it('gives the technician a card whose QR link opens a live, minimal verification', async () => {
      const tech = await createTechnician(t);
      const card = await api().get('/v1/tech/id-card').set(as(tech.token)).expect(200);
      expect(card.headers['cache-control']).toBe('no-store');
      expect(card.body).toEqual({
        techCode: expect.stringMatching(/^N9-HF-T-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/),
        name: 'Swathi Naidu',
        photo: expect.stringContaining('op=get'),
        photoStatus: 'APPROVED',
        gender: 'F',
        skills: ['PLUMBING', 'CLEANING'],
        verifiedSkills: ['PLUMBING', 'CLEANING'],
        certifications: [],
        verification: 'APPROVED',
        simulated: false,
        verifyUrl: expect.stringMatching(/^https:\/\/housefi\.tech\/t\/#[A-Za-z0-9]{24}$/),
        verifyIsDemo: false,
        fictional: false,
      });
      // The same link every time (it is printed in the QR).
      expect((await api().get('/v1/tech/id-card').set(as(tech.token)).expect(200)).body.verifyUrl).toBe(card.body.verifyUrl);

      // Anyone can scan it: no sign-in, only the minimum.
      const scan = await api().get(`/v1/verify/technicians/${tokenOf(card.body.verifyUrl)}`).expect(200);
      expect(scan.headers['cache-control']).toBe('no-store');
      expect(scan.body).toEqual({
        techCode: card.body.techCode, displayName: 'Swathi N.', photo: expect.stringContaining('op=get'), gender: 'F',
        verification: 'APPROVED', verifiedSkills: ['PLUMBING', 'CLEANING'], certifications: [], simulated: false, active: true, checkedAt: t.clock.now(), fictional: false,
      });
      expect(JSON.stringify(scan.body)).not.toMatch(/9876500011|Naidu|Banjara|4521/);
    });

    it('refuses unknown and malformed tokens', async () => {
      await api().get('/v1/verify/technicians/AAAAAAAAAAAAAAAAAAAAAAAA').expect(404);
      await api().get('/v1/verify/technicians/short').expect(404);
      await api().get('/v1/verify/technicians/../../etc/passwd').expect(404);
    });

    it('shows "not active" at once when an approval is withdrawn, and a re-issued QR kills the old link', async () => {
      const tech = await createTechnician(t);
      const url = (await api().get('/v1/tech/id-card').set(as(tech.token)).expect(200)).body.verifyUrl as string;
      const cli = (...args: string[]) => runTechCommand(args, t.app.get(TechVerificationService), ADMIN);

      expect(await cli('suspend', tech.id, 'Customer complaint under review')).toEqual([`Suspended ${tech.id}.`]);
      const scan = await api().get(`/v1/verify/technicians/${tokenOf(url)}`).expect(200);
      expect(scan.body).toMatchObject({ verification: 'SUSPENDED', active: false });
      await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(403);

      await cli('reinstate', tech.id, 'Complaint resolved');
      await cli('reissue-qr', tech.id);
      await api().get(`/v1/verify/technicians/${tokenOf(url)}`).expect(404);
      const fresh = (await api().get('/v1/tech/id-card').set(as(tech.token)).expect(200)).body.verifyUrl as string;
      expect((await api().get(`/v1/verify/technicians/${tokenOf(fresh)}`).expect(200)).body.active).toBe(true);
      expect((await t.prisma.auditLog.findMany({ where: { entityId: tech.id } })).map((a) => a.action)).toEqual(
        expect.arrayContaining(['tech.suspend', 'tech.reinstate', 'tech.qr_reissued']),
      );
    });

    it('is not available before the profile is submitted', async () => {
      const auth = await signIn(t, '9876500012', 'TECHNICIAN');
      await api().get('/v1/tech/id-card').set(as(auth.accessToken)).expect(404);
    });
  });

  describe('the customer sees their technician', () => {
    it('from assignment on, with identity fields in the booking, and the card for their own booking only', async () => {
      const customer = (await signIn(t, '9876543210')).accessToken;
      const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
      const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
      const id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
      await api().get(`/v1/bookings/${id}/technician-card`).set(as(customer)).expect(404);

      const tech = await createTechnician(t);
      await api().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
      await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
      await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
      await t.app.get(DispatchService).offerNext(id);
      const offer = (await api().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
      await api().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);

      const card = await api().get(`/v1/bookings/${id}/technician-card`).set(as(customer)).expect(200);
      expect(card.body).toMatchObject({ name: 'Swathi Naidu', verification: 'APPROVED', verifyUrl: expect.stringContaining('#') });
      const booking = (await api().get(`/v1/bookings/${id}`).set(as(customer)).expect(200)).body;
      expect(booking.technician).toMatchObject({ techCode: card.body.techCode, verification: 'APPROVED', verificationSimulated: false, skills: ['PLUMBING', 'CLEANING'], fictional: false, photo: expect.any(String) });

      const stranger = (await signIn(t, '9876543299')).accessToken;
      await api().get(`/v1/bookings/${id}/technician-card`).set(as(stranger)).expect(404);
      await api().get(`/v1/bookings/${id}/technician-card`).set(as(tech.token)).expect(404);
    });
  });

  describe('locked legal name and photo', () => {
    it('cannot be changed by the technician; corrections go to support, and support applies them', async () => {
      const tech = await createTechnician(t);
      await api().patch('/v1/me').set(as(tech.token)).send({ name: 'Someone Else' }).expect(409);
      const resubmit = await api().put('/v1/tech/profile').set(as(tech.token)).send({ ...TECH_PROFILE, name: 'Someone Else' }).expect(200);
      expect(resubmit.body.identity.legalName).toBe('Swathi Naidu');
      expect(resubmit.body.name).toBe('Swathi Naidu');

      const asked = await api().post('/v1/tech/identity-corrections').set(as(tech.token)).send({ kind: 'NAME', note: 'My Aadhaar says Swathi Naidu Kota' }).expect(200);
      expect(asked.body.identity.correctionRequest).toEqual({ kind: 'NAME', note: 'My Aadhaar says Swathi Naidu Kota', at: t.clock.now() });

      const cli = (...args: string[]) => runTechCommand(args, t.app.get(TechVerificationService), ADMIN);
      await cli('name', tech.id, 'Swathi Naidu Kota');
      const me = (await api().get('/v1/tech/me').set(as(tech.token)).expect(200)).body;
      expect(me.identity).toMatchObject({ legalName: 'Swathi Naidu Kota', correctionRequest: null });

      // A new photo only after support allows one.
      await cli('new-photo', tech.id);
      await api().put('/v1/tech/profile').set(as(tech.token)).send(TECH_PROFILE).expect(422);
      const photoUploadId = await uploadProfilePhoto(t, tech.token);
      const withPhoto = await api().put('/v1/tech/profile').set(as(tech.token)).send({ ...TECH_PROFILE, photoUploadId }).expect(200);
      expect(withPhoto.body.identity.photoStatus).toBe('PENDING');
    });
  });

  describe('Aadhaar Secure QR', () => {
    it('verifies the QR, keeps only the last 4 digits, and gates approval', async () => {
      const app2 = await buildTestApp({ env: { UIDAI_QR_CERT_PEM_B64: Buffer.from(uidai.publicKey).toString('base64'), AADHAAR_REQUIRED: 'true' } });
      try {
        const api2 = () => request(app2.app.getHttpServer());
        const tech = await createTechnician(app2, '9876500021', { approve: false });
        const verification = app2.app.get(TechVerificationService);
        await expect(verification.approve(tech.id, ADMIN)).rejects.toMatchObject({ code: 'CONFLICT' });

        // A forged QR (not UIDAI's signature) is refused.
        const forged = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const fake = (() => {
          const body = Buffer.concat([...['V2', '3', '123420261012153045123', 'Swathi Naidu', '14-08-1994', 'F', ...Array(11).fill('x')].map((f) => Buffer.concat([Buffer.from(f), Buffer.from([255])]))]);
          return BigInt(`0x${gzipSync(Buffer.concat([body, sign('sha256', body, forged.privateKey)])).toString('hex')}`).toString(10);
        })();
        expect((await api2().post('/v1/tech/aadhaar').set(as(tech.token)).send({ qr: fake }).expect(422)).body.error.fields).toEqual({ qr: 'INVALID' });

        const ok = await api2().post('/v1/tech/aadhaar').set(as(tech.token)).send({ qr: aadhaarQr('Swathi Naidu') }).expect(200);
        expect(ok.body).toEqual({ last4: '1234', nameMatches: true, genderMatches: true, verifiedAt: app2.clock.now() });
        const row = await app2.prisma.technician.findUniqueOrThrow({ where: { userId: tech.id } });
        expect(row.aadhaarLast4).toBe('1234');
        expect(JSON.stringify(row)).not.toContain('Khairatabad');
        await verification.approve(tech.id, ADMIN);
        expect((await api2().get('/v1/tech/me').set(as(tech.token)).expect(200)).body).toMatchObject({ verification: 'APPROVED', aadhaar: { last4: '1234', nameMatches: true } });

        // The same person cannot hold a second technician account.
        const other = await createTechnician(app2, '9876500022', { approve: false });
        await api2().post('/v1/tech/aadhaar').set(as(other.token)).send({ qr: aadhaarQr('Swathi Naidu') }).expect(409);
      } finally {
        await app2.close();
      }
    });

    it('with automatic approval on: a passed Aadhaar check approves at once (shown at the review time); a demo account waits 10 s', async () => {
      const app2 = await buildTestApp({ env: { UIDAI_QR_CERT_PEM_B64: Buffer.from(uidai.publicKey).toString('base64'), AADHAAR_REQUIRED: 'true', AUTO_APPROVE_TECHNICIANS: 'true' } });
      try {
        const tech = await createTechnician(app2, '9876500024', { approve: false });
        await request(app2.app.getHttpServer()).post('/v1/tech/aadhaar').set(as(tech.token)).send({ qr: aadhaarQr('Swathi Naidu') }).expect(200);
        const row = await app2.prisma.technician.findUniqueOrThrow({ where: { userId: tech.id }, include: { user: true } });
        expect(row.verification).toBe('APPROVED');
        const audit = await app2.prisma.auditLog.findFirst({ where: { entityId: tech.id, action: 'tech.approve' } });
        expect(audit).toMatchObject({ actorType: 'SYSTEM', after: { via: 'auto' } });
        // Shown at the promised time (2 to 24 h); a team demo account (DEMO_PHONES) 10 s after submitting.
        const me = (await request(app2.app.getHttpServer()).get('/v1/tech/me').set(as(tech.token)).expect(200)).body;
        expect(me.reviewBy).toBeGreaterThanOrEqual(row.submittedAt.getTime() + 2 * 3_600_000);
        await app2.prisma.user.update({ where: { id: tech.id }, data: { isDemo: true } });
        expect((await request(app2.app.getHttpServer()).get('/v1/tech/me').set(as(tech.token)).expect(200)).body.reviewBy).toBe(row.submittedAt.getTime() + 10_000);
      } finally {
        await app2.close();
      }
    });

    it('holds approval when the gender on the Aadhaar differs from the profile, until the technician corrects it', async () => {
      const app2 = await buildTestApp({ env: { UIDAI_QR_CERT_PEM_B64: Buffer.from(uidai.publicKey).toString('base64'), AADHAAR_REQUIRED: 'true', AUTO_APPROVE_TECHNICIANS: 'true' } });
      try {
        const api2 = () => request(app2.app.getHttpServer());
        // The profile says F (TECH_PROFILE); the Aadhaar says M.
        const tech = await createTechnician(app2, '9876500025', { approve: false });
        const res = await api2().post('/v1/tech/aadhaar').set(as(tech.token)).send({ qr: aadhaarQr('Swathi Naidu', '4321', '14-08-1994', 'M') }).expect(200);
        expect(res.body).toMatchObject({ nameMatches: true, genderMatches: false });
        expect((await app2.prisma.technician.findUniqueOrThrow({ where: { userId: tech.id } })).verification).toBe('PENDING');
        expect((await api2().get('/v1/tech/me').set(as(tech.token)).expect(200)).body.aadhaar).toMatchObject({ genderMatches: false });
        const verification = app2.app.get(TechVerificationService);
        await expect(verification.approve(tech.id, ADMIN)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('gender') });
        expect((await verification.pending()).find((p) => p.id === tech.id)?.aadhaar).toContain('GENDER DIFFERS: Aadhaar M, profile F');
        const audit = await app2.prisma.auditLog.findFirstOrThrow({ where: { entityId: tech.id, action: 'tech.aadhaar_verified' } });
        expect(audit.after).toMatchObject({ genderMatches: false });

        // The technician corrects the gender in Edit profile: it matches now, and approval goes through.
        await api2().put('/v1/tech/profile').set(as(tech.token)).send({ ...TECH_PROFILE, gender: 'M' }).expect(200);
        expect((await app2.prisma.technician.findUniqueOrThrow({ where: { userId: tech.id } })).aadhaarGenderMatch).toBe(true);
        await verification.approve(tech.id, ADMIN);
        expect((await api2().get('/v1/tech/me').set(as(tech.token)).expect(200)).body).toMatchObject({ verification: 'APPROVED', aadhaar: { genderMatches: true } });
      } finally {
        await app2.close();
      }
    });

    it('never blocks on an Aadhaar that says T (the profile offers M and F only)', async () => {
      const app2 = await buildTestApp({ env: { UIDAI_QR_CERT_PEM_B64: Buffer.from(uidai.publicKey).toString('base64'), AADHAAR_REQUIRED: 'true' } });
      try {
        const tech = await createTechnician(app2, '9876500026', { approve: false });
        const res = await request(app2.app.getHttpServer()).post('/v1/tech/aadhaar').set(as(tech.token)).send({ qr: aadhaarQr('Swathi Naidu', '8765', '14-08-1994', 'T') }).expect(200);
        expect(res.body.genderMatches).toBe(true);
        await app2.app.get(TechVerificationService).approve(tech.id, ADMIN);
      } finally {
        await app2.close();
      }
    });

    it('flags a name that differs from the legal name, and refuses approval until it is resolved', async () => {
      const app2 = await buildTestApp({ env: { UIDAI_QR_CERT_PEM_B64: Buffer.from(uidai.publicKey).toString('base64'), AADHAAR_REQUIRED: 'true' } });
      try {
        const tech = await createTechnician(app2, '9876500023', { approve: false });
        const res = await request(app2.app.getHttpServer()).post('/v1/tech/aadhaar').set(as(tech.token)).send({ qr: aadhaarQr('Ramesh Kumar', '5678', '01-01-1990', 'M') }).expect(200);
        expect(res.body.nameMatches).toBe(false);
        await expect(app2.app.get(TechVerificationService).approve(tech.id, ADMIN)).rejects.toMatchObject({ code: 'CONFLICT' });
      } finally {
        await app2.close();
      }
    });
  });
});
