// Technicians end to end: profile, verification (CLI), availability, location, account rules.
import request from 'supertest';
import { runTechCommand, USAGE } from '../src/cli/technicians';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { reviewBy } from '../src/modules/technicians/review-window';
import { TechVerificationService, type VerificationActor } from '../src/modules/technicians/tech-verification.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TECH_PROFILE, type TestApp, uploadProfilePhoto } from './helpers';

const ADMIN: VerificationActor = { type: 'ADMIN', id: null, via: 'cli:asha' };
const PHONE = '9876500011';

describe('technicians (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const verification = () => t.app.get(TechVerificationService);
  const cli = (...args: string[]) => runTechCommand(args, verification(), ADMIN);

  async function locationOf(id: string) {
    const [row] = await t.prisma.$queryRaw<{ wkt: string | null; acc: number | null }[]>`
      SELECT ST_AsText(last_location) AS wkt, last_accuracy_m AS acc FROM technicians WHERE user_id = ${id}::uuid`;
    return row;
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
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

  describe('profile', () => {
    it('starts empty, then submitting puts it into verification', async () => {
      const auth = await signIn(t, PHONE, 'TECHNICIAN');
      expect(auth).toMatchObject({ isNew: true, technician: { verification: null, skills: [], online: false } });
      const empty = await api().get('/v1/tech/me').set(as(auth.accessToken)).expect(200);
      expect(empty.body).toEqual(auth.technician);

      // The first submission needs the registration photo.
      const noPhoto = await api().put('/v1/tech/profile').set(as(auth.accessToken)).send(TECH_PROFILE).expect(422);
      expect(noPhoto.body.error.fields).toEqual({ photoUploadId: 'REQUIRED' });
      const photoUploadId = await uploadProfilePhoto(t, auth.accessToken);
      const res = await api().put('/v1/tech/profile').set(as(auth.accessToken)).send({ ...TECH_PROFILE, photoUploadId, skills: ['CLEANING', 'PLUMBING'] }).expect(200);
      expect(res.body).toEqual({
        id: auth.technician!.id,
        phone: PHONE,
        ...TECH_PROFILE,
        skills: ['PLUMBING', 'CLEANING'],
        phoneType: 'SMARTPHONE',
        verification: 'PENDING',
        identity: {
          techCode: expect.stringMatching(/^N9-HF-T-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/),
          legalName: 'Swathi Naidu',
          photo: `https://uploads.test/v/${photoUploadId}?op=get&expires=300`,
          photoStatus: 'PENDING',
          simulated: false,
          correctionRequest: null,
        },
        aadhaar: null,
        reviewBy: reviewBy(t.clock.now()),
        correctionNote: null,
        online: false,
        rating: null,
        jobsDone: 0,
      });
      const refreshed = await api().post('/v1/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(200);
      expect(refreshed.body).toMatchObject({ isNew: false, technician: { verification: 'PENDING' } });
      expect((await api().get('/v1/me').set(as(auth.accessToken)).expect(200)).body.name).toBe('Swathi Naidu');
    });

    it('encrypts the vehicle number', async () => {
      const { id } = await createTechnician(t, PHONE, { approve: false });
      const row = await t.prisma.technician.findUniqueOrThrow({ where: { userId: id } });
      expect(Buffer.from(row.vehicleEnc).toString('utf8')).not.toContain('4521');
    });

    it('validates field by field and ignores phoneType from the app', async () => {
      const auth = await signIn(t, PHONE, 'TECHNICIAN');
      const res = await api()
        .put('/v1/tech/profile')
        .set(as(auth.accessToken))
        .send({ ...TECH_PROFILE, name: '7', experienceYears: 51, skills: ['PLUMBING', 'PLUMBING'], pincode: '0123', areas: '' })
        .expect(422);
      expect(res.body.error.fields).toEqual({ name: 'INVALID', experienceYears: 'INVALID', skills: 'INVALID', pincode: 'INVALID', areas: 'REQUIRED' });
      expect((await api().put('/v1/tech/profile').set(as(auth.accessToken)).send({ ...TECH_PROFILE, skills: [] }).expect(422)).body.error.fields).toEqual({ skills: 'INVALID' });
      const photoUploadId = await uploadProfilePhoto(t, auth.accessToken);
      const ok = await api().put('/v1/tech/profile').set(as(auth.accessToken)).send({ ...TECH_PROFILE, phoneType: 'NONE', photoUploadId }).expect(200);
      expect(ok.body.phoneType).toBe('SMARTPHONE');
    });

    it('is for technicians only', async () => {
      const customer = await signIn(t, '9876543210');
      await api().get('/v1/tech/me').set(as(customer.accessToken)).expect(404);
      await api().get('/v1/tech/me').expect(401);
    });
  });

  describe('verification (npm run tech)', () => {
    it('lists pending profiles and approves by phone, with an audit record', async () => {
      const { id, token } = await createTechnician(t, PHONE, { approve: false });
      const pending = await cli('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0]).toContain(id);
      expect(pending[0]).toContain('PLUMBING+CLEANING');
      expect((await cli('approve', PHONE))[0]?.startsWith(`Approved ${id}. The technician sees it from `)).toBe(true);
      expect((await api().get('/v1/tech/me').set(as(token)).expect(200)).body.verification).toBe('APPROVED');
      expect(await cli('pending')).toEqual(['No profiles waiting for review.']);
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['tech.profile_submitted', 'tech.approve']);
      expect(audit[1]).toMatchObject({ actorType: 'ADMIN', before: { verification: 'PENDING' }, after: { verification: 'APPROVED', via: 'cli:asha' } });
    });

    it('announces an approval at the review time the technician was given; a correction at once', async () => {
      const HOUR = 3_600_000;
      // The inbox as GET /v1/notifications returns it (read directly: the clock moves past the 15-minute access token).
      const kinds = async (userId: string) => (await t.app.get(NotificationsService).list(userId)).map((n) => n.kind);
      t.clock.t = Date.UTC(2026, 9, 16, 4, 30); // 10:00 India time: the check is promised within 2 hours
      const { id, token } = await createTechnician(t, PHONE, { approve: false });
      expect((await api().get('/v1/tech/me').set(as(token)).expect(200)).body.reviewBy).toBe(t.clock.t + 2 * HOUR);
      t.clock.advance(20 * 60_000);
      expect(await cli('approve', id)).toEqual([`Approved ${id}. The technician sees it from 2026-10-16T06:30:00.000Z (the review time they were given).`]);
      expect(await kinds(id)).not.toContain('PROFILE_APPROVED');
      const pushedEarly = await t.prisma.notification.findMany({ where: { userId: id, kind: 'PROFILE_APPROVED', createdAt: { lte: new Date(t.clock.now()) } } });
      expect(pushedEarly).toEqual([]);
      t.clock.advance(100 * 60_000);
      expect(await kinds(id)).toContain('PROFILE_APPROVED');

      // A correction request is shown straight away.
      const other = await createTechnician(t, '9876500012', { approve: false });
      await cli('correct', other.id, 'Please add your vehicle number');
      expect(await kinds(other.id)).toContain('PROFILE_NEEDS_CORRECTION');
    });

    it('drops an approval that is still waiting when the technician submits the profile again', async () => {
      t.clock.t = Date.UTC(2026, 9, 16, 4, 30);
      const { id, token } = await createTechnician(t, PHONE, { approve: false });
      await cli('approve', id);
      await api().put('/v1/tech/profile').set(as(token)).send(TECH_PROFILE).expect(200);
      expect(await t.prisma.notification.count({ where: { userId: id, kind: 'PROFILE_APPROVED' } })).toBe(0);
    });

    it('approves automatically once the identity checks pass; anything else waits for a person', async () => {
      const ok = await createTechnician(t, PHONE, { approve: false });
      const differs = await createTechnician(t, '9876500012', { approve: false });
      const noAadhaar = await createTechnician(t, '9876500013', { approve: false });
      const checked = { aadhaarVerifiedAt: new Date(t.clock.now()), aadhaarLast4: '1234' };
      await t.prisma.technician.update({ where: { userId: ok.id }, data: { ...checked, aadhaarNameMatch: true } });
      await t.prisma.technician.update({ where: { userId: differs.id }, data: { ...checked, aadhaarNameMatch: false } });
      expect(await verification().autoApprove()).toBe(1);
      const state = async (id: string) => (await t.prisma.technician.findUniqueOrThrow({ where: { userId: id } })).verification;
      expect([await state(ok.id), await state(differs.id), await state(noAadhaar.id)]).toEqual(['APPROVED', 'PENDING', 'PENDING']);
      const audit = await t.prisma.auditLog.findFirst({ where: { entityId: ok.id, action: 'tech.approve' } });
      expect(audit).toMatchObject({ actorType: 'SYSTEM', after: { verification: 'APPROVED', via: 'auto' } });
      expect(await verification().autoApprove()).toBe(0); // once
    });

    it('sends a profile back with a note; resubmitting puts it back into review', async () => {
      const { id, token } = await createTechnician(t, PHONE, { approve: false });
      await cli('correct', id, 'Please add your vehicle number', 'దయచేసి మీ వాహన నంబర్ జోడించండి');
      const me = await api().get('/v1/tech/me').set(as(token)).expect(200);
      expect(me.body).toMatchObject({ verification: 'NEEDS_CORRECTION', correctionNote: { en: 'Please add your vehicle number', te: 'దయచేసి మీ వాహన నంబర్ జోడించండి' } });
      const again = await api().put('/v1/tech/profile').set(as(token)).send(TECH_PROFILE).expect(200);
      expect(again.body).toMatchObject({ verification: 'PENDING', correctionNote: null });
    });

    it('decides only pending profiles, and explains its usage', async () => {
      const { id } = await createTechnician(t, PHONE);
      await expect(cli('approve', id)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(cli('approve', '9999999999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(cli('correct', id, 'ok')).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(await cli('frobnicate')).toEqual([USAGE]);
      expect(await cli('correct', id)).toEqual([USAGE]);
    });
  });

  describe('availability and location', () => {
    it('only approved technicians go online (NOT_VERIFIED otherwise)', async () => {
      const { id, token } = await createTechnician(t, PHONE, { approve: false });
      const refused = await api().post('/v1/tech/availability').set(as(token)).send({ online: true }).expect(403);
      expect(refused.body.error.code).toBe('NOT_VERIFIED');
      await api().post('/v1/tech/availability').set(as(token)).send({ online: false }).expect(200);
      await verification().approve(id, ADMIN);
      expect((await api().post('/v1/tech/availability').set(as(token)).send({ online: true }).expect(200)).body.online).toBe(true);
    });

    it('stores the latest point only while online, and forgets it when going offline', async () => {
      const { id, token } = await createTechnician(t, PHONE);
      await api().post('/v1/tech/location').set(as(token)).send({ lat: 17.41, lng: 78.44, accuracy: 12 }).expect(204);
      expect(await locationOf(id)).toEqual({ wkt: null, acc: null });
      await api().post('/v1/tech/availability').set(as(token)).send({ online: true }).expect(200);
      await api().post('/v1/tech/location').set(as(token)).send({ lat: 17.4126, lng: 78.4482, accuracy: 12.4 }).expect(204);
      expect(await locationOf(id)).toEqual({ wkt: 'POINT(78.4482 17.4126)', acc: 12 });
      await api().post('/v1/tech/availability').set(as(token)).send({ online: false }).expect(200);
      expect(await locationOf(id)).toEqual({ wkt: null, acc: null });
      await api().post('/v1/tech/location').set(as(token)).send({ lat: 95, lng: 0 }).expect(422);
    });

    it('an approved technician who edits the profile goes back to review and offline', async () => {
      const { token } = await createTechnician(t, PHONE);
      await api().post('/v1/tech/availability').set(as(token)).send({ online: true }).expect(200);
      const res = await api().put('/v1/tech/profile').set(as(token)).send({ ...TECH_PROFILE, skills: ['AC'] }).expect(200);
      expect(res.body).toMatchObject({ verification: 'PENDING', online: false, skills: ['AC'] });
    });
  });

  describe('while on a job', () => {
    async function assignJob(technicianId: string) {
      const customer = await signIn(t, '9876543210');
      const addressId = (
        await api().post('/v1/addresses').set(as(customer.accessToken)).send({ label: 'HOME', house: 'Flat 4B', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034' }).expect(201)
      ).body.id;
      const booking = await api()
        .post('/v1/bookings')
        .set(as(customer.accessToken))
        .set('Idempotency-Key', 'job-key-00000001')
        .send({ serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false })
        .expect(201);
      await t.prisma.booking.update({ where: { id: booking.body.id }, data: { status: 'EN_ROUTE', technicianId } });
    }

    it('keeps sending location even when offline, and cannot change the profile', async () => {
      const { id, token } = await createTechnician(t, PHONE);
      await assignJob(id);
      await api().post('/v1/tech/location').set(as(token)).send({ lat: 17.4, lng: 78.4 }).expect(204);
      expect((await locationOf(id))!.wkt).toBe('POINT(78.4 17.4)');
      expect((await api().put('/v1/tech/profile').set(as(token)).send(TECH_PROFILE).expect(409)).body.error.code).toBe('CONFLICT');
      await api().delete('/v1/me').set(as(token)).expect(409);
    });
  });

  it('deleting the account takes the technician offline and wipes the profile details', async () => {
    const { id, token } = await createTechnician(t, PHONE);
    await api().post('/v1/tech/availability').set(as(token)).send({ online: true }).expect(200);
    await api().delete('/v1/me').set(as(token)).expect(204);
    const row = await t.prisma.technician.findUniqueOrThrow({ where: { userId: id } });
    expect(row).toMatchObject({ online: false, areas: '' });
    expect(row.vehicleEnc).toHaveLength(0);
    await api().get('/v1/tech/me').set(as(token)).expect(401);
  });
});
