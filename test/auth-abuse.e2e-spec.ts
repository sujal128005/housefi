// Sign-in abuse protections, end to end: team demo numbers, the service-wide SMS budget, the progressive lock after
// wrong codes (and support unlocking it), coordinator guesses that cost nothing, spoofed X-Forwarded-For, and
// access tokens that stop working at logout.
import request from 'supertest';
import { runSupportCommand } from '../src/cli/support';
import { SupportService } from '../src/modules/support/support.service';
import { buildTestApp, requireTestDatabase, resetDatabase, type TestApp } from './helpers';

const MIN = 60_000;
const DEMO = '9876500201';
const DEMO_CODE = '482915';

describe('sign-in abuse protections (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({
      env: { DEMO_PHONES: `${DEMO},9876500202`, DEMO_OTP_CODE: DEMO_CODE, OTP_SMS_PER_MINUTE: '4', OTP_LOCK_STEPS: '5:10m,3:1h,1:24h,1:21d' },
    });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
  });

  afterAll(async () => {
    await t?.close();
  });

  const ask = (phone: string, role = 'CUSTOMER') => http().post('/v1/auth/otp/request').send({ phone, role });
  const answer = (challengeId: string, code: string) => http().post('/v1/auth/otp/verify').send({ challengeId, code });
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

  describe('team demo numbers', () => {
    it('sign in with the team code, without an SMS, as demo accounts', async () => {
      const res = await ask(DEMO).expect(200);
      expect(res.body.demoAccount).toBe(true);
      expect(t.sms.sent).toHaveLength(0);
      const ok = await answer(res.body.challengeId, DEMO_CODE).expect(200);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: ok.body.customer.id } });
      expect(user.isDemo).toBe(true);
    });

    it('are refused with any other code, and other numbers are never demo', async () => {
      const res = await ask(DEMO).expect(200);
      await answer(res.body.challengeId, '123123').expect(400);
      const normal = await ask('9876543210').expect(200);
      expect(normal.body.demoAccount).toBe(false);
      expect(t.sms.sent).toHaveLength(1);
      await answer(normal.body.challengeId, DEMO_CODE === t.sms.lastCode('9876543210') ? '000001' : DEMO_CODE).expect(400);
    });
  });

  describe('service-wide SMS budget', () => {
    it('refuses new codes past the per-minute budget, whoever asks', async () => {
      for (const phone of ['9000000001', '9000000002', '9000000003', '9000000004']) await ask(phone).expect(200);
      const over = await ask('9000000005').expect(429);
      expect(over.body.error.code).toBe('RATE_LIMITED');
      // Demo numbers do not use the budget.
      await ask(DEMO).expect(200);
      t.clock.advance(MIN + 1000);
      await ask('9000000005').expect(200);
    });
  });

  describe('progressive lock after wrong codes', () => {
    const PHONE = '9876500001';

    async function failOnce(): Promise<request.Response> {
      const c = await ask(PHONE);
      if (c.status !== 200) return c;
      return answer(c.body.challengeId, wrong(t.sms.lastCode(PHONE)));
    }

    /**
     * Wrong codes, each on a fresh code (so the per-code limit of 3 never decides), 13 minutes apart (so the limit of
     * 5 codes per hour never decides either).
     */
    async function failTimes(n: number): Promise<request.Response> {
      let last!: request.Response;
      for (let i = 0; i < n; i++) {
        t.clock.advance(13 * MIN);
        t.rateLimits.clear();
        last = await failOnce();
      }
      return last;
    }

    it('locks for 10 minutes after 5, 1 hour after 3 more, 24 hours after 1 more, then 21 days', async () => {
      const fifth = await failTimes(5);
      expect(fifth.status).toBe(429);
      expect(fifth.body.error.retryAfterSec).toBe(600);
      // Locked: no new code (and no SMS) until the lock ends.
      t.clock.advance(31_000);
      const sentBefore = t.sms.sent.length;
      await ask(PHONE).expect(429);
      expect(t.sms.sent).toHaveLength(sentBefore);

      t.clock.advance(10 * MIN);
      expect((await failTimes(3)).body.error.retryAfterSec).toBe(3600);
      t.clock.advance(60 * MIN);
      expect((await failTimes(1)).body.error.retryAfterSec).toBe(24 * 3600);
      t.clock.advance(24 * 60 * MIN);
      const final = await failTimes(1);
      expect(final.body.error.retryAfterSec).toBe(21 * 24 * 3600);
      t.clock.advance(20 * 24 * 60 * MIN);
      await ask(PHONE).expect(429);
    });

    it('a correct code resets the count', async () => {
      await failTimes(4);
      t.clock.advance(31_000);
      const c = await ask(PHONE).expect(200);
      await answer(c.body.challengeId, t.sms.lastCode(PHONE)).expect(200);
      // Four more wrong codes do not lock: the count started again.
      expect((await failTimes(4)).status).toBe(400);
    });

    it('cannot keep guessing on a code it already had once the number is locked', async () => {
      t.clock.advance(31_000);
      const held = await ask(PHONE).expect(200);
      await failTimes(5);
      await answer(held.body.challengeId, t.sms.lastCode(PHONE)).expect(429);
    });

    it('support can unlock the number (audited)', async () => {
      await failTimes(5);
      const lines = await runSupportCommand(['unlock', PHONE], t.app.get(SupportService), { type: 'ADMIN', id: null, via: 'test' });
      expect(lines).toEqual(['Sign-in unlocked for that number.']);
      // Past the 5-codes-an-hour limit (the lock alone would still last 9 more minutes).
      t.clock.advance(52 * MIN);
      t.rateLimits.clear();
      await ask(PHONE).expect(200);
      expect(await t.prisma.auditLog.count({ where: { action: 'support.unlock_sign_in' } })).toBe(1);
    });
  });

  describe('coordinator guesses', () => {
    it('cost nothing and never use up a customer or technician sign-in', async () => {
      const PHONE = '9876500002';
      for (let i = 0; i < 8; i++) await ask(PHONE, 'COORDINATOR').expect(200);
      expect(t.sms.sent).toHaveLength(0);
      expect(await t.prisma.otpChallenge.count()).toBe(0);
      await ask(PHONE, 'CUSTOMER').expect(200);
    });
  });

  describe('per-IP limits', () => {
    it('cannot be bypassed with a made-up X-Forwarded-For (no proxy is trusted by default)', async () => {
      for (let i = 0; i < 10; i++) {
        await http().post('/v1/auth/otp/request').set('X-Forwarded-For', `203.0.113.${i}`).send({ phone: `90000100${String(i).padStart(2, '0')}`, role: 'CUSTOMER' });
        t.clock.advance(20_000); // keep under the SMS budget per minute
      }
      const res = await http().post('/v1/auth/otp/request').set('X-Forwarded-For', '198.51.100.7').send({ phone: '9000010099', role: 'CUSTOMER' });
      expect(res.status).toBe(429);
    });
  });

  describe('access tokens', () => {
    it('stop working at logout, before they expire', async () => {
      const c = await ask('9876500003').expect(200);
      const auth = await answer(c.body.challengeId, t.sms.lastCode('9876500003')).expect(200);
      const bearer = `Bearer ${auth.body.accessToken}`;
      await http().get('/v1/notifications').set('Authorization', bearer).expect(200);
      await http().post('/v1/auth/logout').set('Authorization', bearer).send({}).expect(204);
      await http().get('/v1/notifications').set('Authorization', bearer).expect(401);
    });
  });
});
