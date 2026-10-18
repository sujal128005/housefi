// /me end to end: read, update name / language, and delete (anonymise) the account.
import request from 'supertest';
import { buildTestApp, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const PHONE = '9876543210';

describe('/me (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a token', async () => {
    await http().get('/v1/me').expect(401);
    await http().patch('/v1/me').send({ name: 'Priya' }).expect(401);
    await http().delete('/v1/me').expect(401);
  });

  it('returns the signed-in customer', async () => {
    const auth = await signIn(t, PHONE);
    const res = await http().get('/v1/me').set(bearer(auth.accessToken)).expect(200);
    expect(res.body).toEqual({ id: auth.customer?.id, phone: PHONE, name: '' });
  });

  it('saves the name (trimmed, encrypted) and the customer is no longer new', async () => {
    const auth = await signIn(t, PHONE);
    const res = await http().patch('/v1/me').set(bearer(auth.accessToken)).send({ name: '  Priya Sharma ' }).expect(200);
    expect(res.body).toEqual({ id: auth.customer?.id, phone: PHONE, name: 'Priya Sharma' });

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: auth.customer?.id } });
    expect(Buffer.from(row.nameEnc!).toString('latin1')).not.toContain('Priya');

    const refreshed = await http().post('/v1/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(200);
    expect(refreshed.body).toMatchObject({ isNew: false, customer: { name: 'Priya Sharma' } });
  });

  it('accepts Telugu names and saves the language', async () => {
    const auth = await signIn(t, PHONE);
    const res = await http().patch('/v1/me').set(bearer(auth.accessToken)).send({ name: 'ప్రియ', locale: 'te' }).expect(200);
    expect(res.body.name).toBe('ప్రియ');
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: auth.customer?.id } })).toMatchObject({ locale: 'te' });
  });

  it('validates the name and language', async () => {
    const auth = await signIn(t, PHONE);
    for (const name of ['A', '12345', ' ', 'x'.repeat(61)]) {
      const res = await http().patch('/v1/me').set(bearer(auth.accessToken)).send({ name }).expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.fields.name).toMatch(/^(INVALID|REQUIRED)$/);
    }
    const res = await http().patch('/v1/me').set(bearer(auth.accessToken)).send({ locale: 'hi' }).expect(422);
    expect(res.body.error.fields).toEqual({ locale: 'INVALID' });
  });

  it('works for technicians too (same phone, separate account)', async () => {
    await signIn(t, PHONE, 'CUSTOMER');
    const tech = await signIn(t, PHONE, 'TECHNICIAN');
    const res = await http().patch('/v1/me').set(bearer(tech.accessToken)).send({ name: 'Swathi Naidu', locale: 'te' }).expect(200);
    expect(res.body).toEqual({ id: tech.technician?.id, phone: PHONE, name: 'Swathi Naidu' });
  });

  describe('DELETE /v1/me', () => {
    it('anonymises the account, ends every session and frees the number for a new account', async () => {
      const first = await signIn(t, PHONE);
      t.clock.advance(31_000);
      const second = await signIn(t, PHONE);
      await http().patch('/v1/me').set(bearer(first.accessToken)).send({ name: 'Priya Sharma' }).expect(200);

      await http().delete('/v1/me').set(bearer(first.accessToken)).expect(204);

      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: first.customer?.id } });
      expect(row).toMatchObject({ status: 'DELETED', nameEnc: null, deletedAt: expect.any(Date) });
      expect(row.phoneEnc).toHaveLength(0);
      expect(await t.prisma.otpChallenge.count()).toBe(0);

      // Both sessions are over; a still-valid access token no longer works on /me.
      await http().post('/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
      await http().get('/v1/me').set(bearer(second.accessToken)).expect(401);

      // Signing up again with the same number creates a fresh account.
      t.clock.advance(31_000);
      const fresh = await signIn(t, PHONE);
      expect(fresh.customer?.id).not.toBe(first.customer?.id);
      expect(fresh).toMatchObject({ isNew: true, customer: { phone: PHONE, name: '' } });
    });

    it('leaves the technician account on the same phone alone', async () => {
      const customer = await signIn(t, PHONE, 'CUSTOMER');
      const tech = await signIn(t, PHONE, 'TECHNICIAN');
      await http().delete('/v1/me').set(bearer(customer.accessToken)).expect(204);
      await http().get('/v1/me').set(bearer(tech.accessToken)).expect(200);
      await http().post('/v1/auth/refresh').send({ refreshToken: tech.refreshToken }).expect(200);
    });
  });
});
