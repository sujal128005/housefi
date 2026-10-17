// Technicians end to end: profile, verification (CLI), availability, location, account rules.
import request from 'supertest';
import { runTechCommand, USAGE } from '../src/cli/technicians';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { TechVerificationService, type VerificationActor } from '../src/modules/technicians/tech-verification.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, TECH_PROFILE, type TestApp } from './helpers';

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

      const res = await api().put('/v1/tech/profile').set(as(auth.accessToken)).send({ ...TECH_PROFILE, skills: ['CLEANING', 'PLUMBING'] }).expect(200);
      expect(res.body).toEqual({
        id: auth.technician!.id,
        phone: PHONE,
        ...TECH_PROFILE,
        skills: ['PLUMBING', 'CLEANING'],
        phoneType: 'SMARTPHONE',
        verification: 'PENDING',
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
      const ok = await api().put('/v1/tech/profile').set(as(auth.accessToken)).send({ ...TECH_PROFILE, phoneType: 'NONE' }).expect(200);
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
      expect(await cli('approve', PHONE)).toEqual([`Approved ${id}.`]);
      expect((await api().get('/v1/tech/me').set(as(token)).expect(200)).body.verification).toBe('APPROVED');
      expect(await cli('pending')).toEqual(['No profiles waiting for review.']);
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['tech.profile_submitted', 'tech.approve']);
      expect(audit[1]).toMatchObject({ actorType: 'ADMIN', before: { verification: 'PENDING' }, after: { verification: 'APPROVED', via: 'cli:asha' } });
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
