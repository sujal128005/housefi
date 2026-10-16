// Auth end to end, against a real PostgreSQL (started by `npm test`): OTP request / verify, refresh rotation with
// reuse detection, logout, and the access-token guard.
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { type AuthUser, CurrentUser, Roles } from '../src/modules/auth/auth.guard';
import { buildTestApp, requireTestDatabase, resetDatabase, type TestApp } from './helpers';

@Controller('test')
class WhoAmIController {
  @Get('whoami')
  whoami(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Get('customers-only')
  @Roles('CUSTOMER')
  customersOnly(): { ok: true } {
    return { ok: true };
  }
}

const PHONE = '9876543210';
const MIN = 60_000;

describe('auth (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ controllers: [WhoAmIController] });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function requestCode(phone = PHONE, role = 'CUSTOMER') {
    const res = await http().post('/v1/auth/otp/request').send({ phone, role }).expect(200);
    return { challengeId: res.body.challengeId as string, code: t.sms.lastCode(phone), body: res.body };
  }

  async function signIn(phone = PHONE, role = 'CUSTOMER') {
    const { challengeId, code } = await requestCode(phone, role);
    const res = await http().post('/v1/auth/otp/verify').send({ challengeId, code }).expect(200);
    return res.body as { accessToken: string; refreshToken: string; expiresIn: number; isNew: boolean; customer?: { id: string }; technician?: { id: string } };
  }

  describe('POST /v1/auth/otp/request', () => {
    it('sends a 6-digit code and returns the challenge (never the code)', async () => {
      const { body, code } = await requestCode();
      expect(body).toEqual({ challengeId: expect.any(String), phone: PHONE, resendAfterSec: 30, expiresAt: t.clock.now() + 5 * MIN, demoCode: null });
      expect(code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(body)).not.toContain(code);
    });

    it('stores neither the code nor the phone number in plain text', async () => {
      const { challengeId, code } = await requestCode();
      const row = await t.prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
      for (const col of [row.codeHash, row.phoneHash, row.phoneEnc]) {
        expect(Buffer.from(col).toString('latin1')).not.toContain(PHONE);
        expect(Buffer.from(col).toString('latin1')).not.toContain(code);
      }
    });

    it('rejects invalid phone numbers and roles field by field', async () => {
      const res = await http().post('/v1/auth/otp/request').send({ phone: '+919876543210', role: 'ADMIN' }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION', fields: { phone: 'INVALID', role: 'INVALID' } });
      expect(t.sms.sent).toHaveLength(0);
    });

    it('allows a resend only after 30 s, and the resend replaces the old code', async () => {
      const first = await requestCode();
      t.clock.advance(10_000);
      const early = await http().post('/v1/auth/otp/request').send({ phone: PHONE, role: 'CUSTOMER' }).expect(429);
      expect(early.body.error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 20 });
      t.clock.advance(20_000);
      const second = await requestCode();
      const old = await http().post('/v1/auth/otp/verify').send({ challengeId: first.challengeId, code: first.code }).expect(400);
      expect(old.body.error.code).toBe('OTP_EXPIRED');
      await http().post('/v1/auth/otp/verify').send({ challengeId: second.challengeId, code: second.code }).expect(200);
    });

    it('allows 5 codes per phone per hour across both roles', async () => {
      for (let i = 0; i < 5; i++) {
        await requestCode(PHONE, i % 2 ? 'TECHNICIAN' : 'CUSTOMER');
        t.clock.advance(31_000);
      }
      const res = await http().post('/v1/auth/otp/request').send({ phone: PHONE, role: 'CUSTOMER' }).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.retryAfterSec).toBe(3600 - 5 * 31);
      await requestCode('9876500011'); // other numbers are not affected
    });

    it('returns INTERNAL when the SMS provider fails, and that code never works', async () => {
      t.sms.failNext = true;
      const res = await http().post('/v1/auth/otp/request').send({ phone: PHONE, role: 'CUSTOMER' }).expect(500);
      expect(res.body.error.code).toBe('INTERNAL');
      const row = await t.prisma.otpChallenge.findFirstOrThrow();
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(t.clock.now());
    });
  });

  describe('POST /v1/auth/otp/verify', () => {
    it('signs up a new customer: isNew, empty name, working tokens', async () => {
      const auth = await signIn();
      expect(auth).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        refreshToken: expect.stringMatching(/^rt_[\w-]{43}$/),
        expiresIn: 900,
        isNew: true,
        customer: { id: expect.any(String), phone: PHONE, name: '' },
      });
      const me = await http().get('/v1/test/whoami').set('Authorization', `Bearer ${auth.accessToken}`).expect(200);
      expect(me.body).toEqual({ id: auth.customer?.id, role: 'CUSTOMER', sessionId: expect.any(String) });
    });

    it('signs the same customer in again (same account), and keeps the phone encrypted at rest', async () => {
      const first = await signIn();
      t.clock.advance(31_000);
      const second = await signIn();
      expect(second.customer?.id).toBe(first.customer?.id);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: first.customer?.id } });
      expect(Buffer.from(user.phoneEnc).toString('latin1')).not.toContain(PHONE);
    });

    it('gives the same phone a separate technician account', async () => {
      const customer = await signIn(PHONE, 'CUSTOMER');
      const tech = await signIn(PHONE, 'TECHNICIAN');
      expect(tech.technician?.id).not.toBe(customer.customer?.id);
      expect(tech).toMatchObject({ isNew: true, technician: { phone: PHONE, verification: null, online: false } });
      expect(tech.customer).toBeUndefined();
    });

    it('counts wrong codes: 2 left, 1 left, then locked (even for the right code)', async () => {
      const { challengeId, code } = await requestCode();
      const wrong = code === '000000' ? '111111' : '000000';
      const r1 = await http().post('/v1/auth/otp/verify').send({ challengeId, code: wrong }).expect(400);
      expect(r1.body.error).toMatchObject({ code: 'OTP_INVALID', attemptsLeft: 2 });
      const r2 = await http().post('/v1/auth/otp/verify').send({ challengeId, code: wrong }).expect(400);
      expect(r2.body.error).toMatchObject({ code: 'OTP_INVALID', attemptsLeft: 1 });
      const r3 = await http().post('/v1/auth/otp/verify').send({ challengeId, code: wrong }).expect(429);
      expect(r3.body.error.code).toBe('OTP_LOCKED');
      const r4 = await http().post('/v1/auth/otp/verify').send({ challengeId, code }).expect(429);
      expect(r4.body.error.code).toBe('OTP_LOCKED');
    });

    it('does not let parallel guesses exceed the attempt limit', async () => {
      const { challengeId, code } = await requestCode();
      const wrong = code === '000000' ? '111111' : '000000';
      const results = await Promise.all(Array.from({ length: 8 }, () => http().post('/v1/auth/otp/verify').send({ challengeId, code: wrong })));
      expect(results.filter((r) => r.body.error?.code === 'OTP_INVALID')).toHaveLength(2);
      const row = await t.prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
      expect(row.attempts).toBe(3);
    });

    it('expires codes after 5 minutes', async () => {
      const { challengeId, code } = await requestCode();
      t.clock.advance(5 * MIN);
      const res = await http().post('/v1/auth/otp/verify').send({ challengeId, code }).expect(400);
      expect(res.body.error.code).toBe('OTP_EXPIRED');
    });

    it('accepts each code once', async () => {
      const { challengeId, code } = await requestCode();
      await http().post('/v1/auth/otp/verify').send({ challengeId, code }).expect(200);
      const again = await http().post('/v1/auth/otp/verify').send({ challengeId, code }).expect(400);
      expect(again.body.error.code).toBe('OTP_EXPIRED');
    });

    it('treats unknown challenges as expired', async () => {
      for (const challengeId of ['nope', '6f1c2d3e-0000-4000-8000-000000000000']) {
        const res = await http().post('/v1/auth/otp/verify').send({ challengeId, code: '123456' }).expect(400);
        expect(res.body.error.code).toBe('OTP_EXPIRED');
      }
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('rotates: a new pair every time, and the old refresh token stops working', async () => {
      const auth = await signIn();
      const next = await http().post('/v1/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(200);
      expect(next.body).toMatchObject({ isNew: true, customer: { id: auth.customer?.id, phone: PHONE } });
      expect(next.body.refreshToken).not.toBe(auth.refreshToken);
      await http().get('/v1/test/whoami').set('Authorization', `Bearer ${next.body.accessToken}`).expect(200);
    });

    it('revokes the whole session when an old refresh token is reused', async () => {
      const auth = await signIn();
      const next = await http().post('/v1/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(200);
      const reuse = await http().post('/v1/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(401);
      expect(reuse.body.error.code).toBe('UNAUTHENTICATED');
      // The thief's copy and the legitimate newer token are both dead now.
      await http().post('/v1/auth/refresh').send({ refreshToken: next.body.refreshToken }).expect(401);
    });

    it('keeps other sessions of the same person working', async () => {
      const phoneA = await signIn();
      t.clock.advance(31_000);
      const phoneB = await signIn();
      await http().post('/v1/auth/refresh').send({ refreshToken: phoneA.refreshToken }).expect(200);
      await http().post('/v1/auth/refresh').send({ refreshToken: phoneA.refreshToken }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: phoneB.refreshToken }).expect(200);
    });

    it('expires refresh tokens after 30 days', async () => {
      const auth = await signIn();
      t.clock.advance(30 * 24 * 60 * MIN);
      await http().post('/v1/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(401);
    });

    it('rejects unknown and malformed tokens', async () => {
      await http().post('/v1/auth/refresh').send({ refreshToken: `rt_${'a'.repeat(43)}` }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: 'garbage' }).expect(401);
      await http().post('/v1/auth/refresh').send({}).expect(422);
    });

    it('stores refresh tokens only as hashes', async () => {
      const auth = await signIn();
      const rows = await t.prisma.refreshToken.findMany();
      expect(rows).toHaveLength(1);
      expect(Buffer.from(rows[0]!.tokenHash).toString('latin1')).not.toContain(auth.refreshToken);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('needs an access token', async () => {
      const res = await http().post('/v1/auth/logout').send({}).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('ends the session: its refresh token stops working', async () => {
      const auth = await signIn();
      await http().post('/v1/auth/logout').set('Authorization', `Bearer ${auth.accessToken}`).send({ refreshToken: auth.refreshToken }).expect(204);
      await http().post('/v1/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(401);
    });
  });

  describe('access tokens (global guard)', () => {
    it('rejects missing, malformed and forged tokens', async () => {
      await http().get('/v1/test/whoami').expect(401);
      await http().get('/v1/test/whoami').set('Authorization', 'Bearer nope').expect(401);
      await http().get('/v1/test/whoami').set('Authorization', 'Basic abc').expect(401);
      const { accessToken } = await signIn();
      const [h, p] = accessToken.split('.');
      const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), role: 'ADMIN' })).toString('base64url');
      await http().get('/v1/test/whoami').set('Authorization', `Bearer ${h}.${forgedPayload}.${accessToken.split('.')[2]}`).expect(401);
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
      await http().get('/v1/test/whoami').set('Authorization', `Bearer ${none}`).expect(401);
    });

    it('expires access tokens after 15 minutes', async () => {
      const { accessToken } = await signIn();
      t.clock.advance(14 * MIN);
      await http().get('/v1/test/whoami').set('Authorization', `Bearer ${accessToken}`).expect(200);
      t.clock.advance(2 * MIN);
      await http().get('/v1/test/whoami').set('Authorization', `Bearer ${accessToken}`).expect(401);
    });

    it('hides role-restricted routes from other roles (NOT_FOUND)', async () => {
      const customer = await signIn(PHONE, 'CUSTOMER');
      const tech = await signIn('9876500011', 'TECHNICIAN');
      await http().get('/v1/test/customers-only').set('Authorization', `Bearer ${customer.accessToken}`).expect(200);
      const res = await http().get('/v1/test/customers-only').set('Authorization', `Bearer ${tech.accessToken}`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
