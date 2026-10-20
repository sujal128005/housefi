// Super admin portal: answered only on the secret host, accounts only from the command line, guessing stopped (limits,
// locks, the same answer for every failure), the passkey step required, sessions that end, and "forgot password" with
// a wait no one can shorten, cancelled when the owner signs in.
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { runAdminCommand } from '../src/cli/admin';
import { AuditService } from '../src/common/audit/audit.module';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { Hashing } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { AdminRecoveryService } from '../src/modules/admin/admin-recovery.service';
import { buildTestApp, requireTestDatabase, resetDatabase, type TestApp } from './helpers';

const HOST = 'hq-test1234.housefi.tech';
const CODE = '482915';
const PHONE = '9876500099';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MIN = 60_000;

// Password hashing is slow on purpose (scrypt); the guessing test runs a dozen of them.
jest.setTimeout(30_000);

describe('super admin portal (e2e)', () => {
  let t: TestApp;
  let username: string;
  let password: string;

  const api = (host = HOST) => ({
    get: (path: string, cookie?: string) => request(t.app.getHttpServer()).get(`/v1/admin${path}`).set('Host', host).set('User-Agent', LAPTOP).set('Cookie', cookie ?? ''),
    post: (path: string, body: object = {}, cookie?: string, ua = LAPTOP) =>
      request(t.app.getHttpServer()).post(`/v1/admin${path}`).set('Host', host).set('User-Agent', ua).set('x-housefi-admin', '1').set('Cookie', cookie ?? '').send(body),
  });
  const cookieOf = (res: request.Response) => String(res.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  const cli = (...args: string[]) =>
    runAdminCommand(args, { prisma: t.app.get(PrismaService), cipher: t.app.get(FieldCipher), hashing: t.app.get(Hashing), audit: t.app.get(AuditService), clock: t.clock, via: 'cli:test' });

  /** A full sign-in, as after a passed passkey (WebAuthn itself needs a real authenticator; see the options test). */
  async function signedIn(): Promise<string> {
    const admin = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
    const token = randomBytes(32).toString('base64url');
    const now = new Date(t.clock.now());
    await t.prisma.adminSession.create({
      data: { adminId: admin.id, tokenHash: new Uint8Array(createHash('sha256').update(token).digest()), stage: 'VERIFIED', ip: '1.2.3.4', userAgent: LAPTOP, createdAt: now, lastSeenAt: now, expiresAt: new Date(t.clock.now() + 8 * 60 * MIN) },
    });
    return `hf_admin=${token}`;
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { ADMIN_HOST: HOST, ADMIN_RECOVERY_CODE: CODE } });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.adminUser.deleteMany();
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30); // 12:00 India time
    const out = await cli('create', 'Sujal Negi', PHONE);
    username = /username: (\S+)/.exec(out.join('\n'))![1]!;
    password = /password: (\S+)/.exec(out.join('\n'))![1]!;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('exists only on the secret host, and changes need the portal header', async () => {
    await api('api.housefi.tech').post('/auth/password', { username, password }).expect(404);
    await request(t.app.getHttpServer()).post('/v1/admin/auth/password').set('Host', HOST).set('User-Agent', LAPTOP).send({ username, password }).expect(404);
    await api().post('/auth/password', { username, password }).expect(200);
  });

  it('has no sign-up: accounts come from the command line only, two at most, with strong generated passwords', async () => {
    expect(username).toMatch(/^hq\.sujal\.[a-z2-9]{4}$/);
    expect(password).toMatch(/^[A-Za-z2-9]{24}$/);
    const row = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
    expect(row.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(JSON.stringify(row)).not.toContain(password);
    expect(JSON.stringify(row)).not.toContain(PHONE);
    await cli('create', 'Navya', '9876500098');
    expect(await cli('create', 'Someone', '9876500097')).toEqual(['There are already 2 super admins.']);
  });

  it('asks for the passkey after the password: registering the first one, with Windows Hello on this laptop', async () => {
    const res = await api().post('/auth/password', { username, password }).expect(200);
    expect(res.body).toEqual({ next: 'REGISTER' });
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    const opts = await api().post('/auth/passkey/options', {}, cookieOf(res)).expect(200);
    expect(opts.body).toMatchObject({ mode: 'REGISTER', options: { rp: { id: HOST }, authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' } } });
    // A made-up answer is refused, and the password step alone opens nothing.
    await api().post('/auth/passkey/verify', { response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } }, cookieOf(res)).expect(401);
    await api().get('/me', cookieOf(res)).expect(401);
  });

  it('stops guessing: the same answer for every failure, a lock after 5 wrong passwords, limits per address', async () => {
    const wrong = await api().post('/auth/password', { username, password: 'nope' }).expect(401);
    const unknown = await api().post('/auth/password', { username: 'hq.nobody.zzzz', password: 'nope' }).expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    for (let i = 0; i < 3; i++) await api().post('/auth/password', { username, password: 'nope' }).expect(401);
    await api().post('/auth/password', { username, password: 'nope' }).expect(401); // 5th: locks
    await api().post('/auth/password', { username, password }).expect(429); // even the right password, for 15 min
    t.clock.t += 16 * MIN;
    t.rateLimits.clear();
    await api().post('/auth/password', { username, password }).expect(200);
    // Many tries from one address are refused before any password is checked.
    t.rateLimits.clear();
    for (let i = 0; i < 10; i++) await api().post('/auth/password', { username: `hq.x${i}.zzzz`, password: 'nope' }).expect(401);
    await api().post('/auth/password', { username, password }).expect(429);
  });

  it('is for laptops only', async () => {
    const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    await api().post('/auth/password', { username, password }, undefined, phone).expect(404);
  });

  it('signed in: the dashboard; sessions end when idle, and on sign-out', async () => {
    const cookie = await signedIn();
    expect((await api().get('/me', cookie).expect(200)).body).toMatchObject({ username, displayName: 'Sujal Negi', recoveries: [] });
    const o = (await api().get('/overview', cookie).expect(200)).body;
    expect(o).toMatchObject({ today: { bookings: 0 }, attention: { openSos: 0 } });
    expect(o.daily).toHaveLength(14);
    t.clock.t += 31 * MIN;
    await api().get('/me', cookie).expect(401);
    const again = await signedIn();
    await api().post('/auth/logout', {}, again).expect(204);
    await api().get('/me', again).expect(401);
  });

  it('forgot password: phone and code, then 2 to 5 hours no one can shorten; the owner signing in cancels it', async () => {
    await api().post('/recovery/start', { username, phone: '9876500000', code: CODE }).expect(401);
    await api().post('/recovery/start', { username, phone: PHONE, code: '000000' }).expect(401);
    const started = await api().post('/recovery/start', { username, phone: PHONE, code: CODE }).expect(200);
    expect(started.body.readyAt).toBe(t.clock.now() + 2 * 60 * MIN); // by day: 2 hours
    const rc = cookieOf(started);
    expect((await api().get('/recovery/status', rc).expect(200)).body.state).toBe('WAITING');
    await api().post('/recovery/complete', { password: 'a-much-longer-new-password' }, rc).expect(409);
    // Every signed-in admin sees it waiting.
    const cookie = await signedIn();
    expect((await api().get('/me', cookie).expect(200)).body.recoveries).toHaveLength(1);

    t.clock.t += 2 * 60 * MIN;
    await api().post('/recovery/complete', { password: 'short' }, rc).expect(422);
    await api().post('/recovery/complete', { password: 'a-much-longer-new-password' }, rc).expect(204);
    await api().get('/me', cookie).expect(401); // every session signed out
    await api().post('/auth/password', { username, password }).expect(401);
    await api().post('/auth/password', { username, password: 'a-much-longer-new-password' }).expect(200);
  });

  it('a recovery waiting at night takes 5 hours, and is cancelled when the owner signs in', async () => {
    t.clock.t = Date.UTC(2026, 9, 16, 18, 30); // midnight India time
    const started = await api().post('/recovery/start', { username, phone: PHONE, code: CODE }).expect(200);
    expect(started.body.readyAt).toBe(t.clock.now() + 5 * 60 * MIN);
    const admin = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
    await t.app.get(AdminRecoveryService).cancelOnSignIn(admin.id, '1.2.3.4');
    expect((await api().get('/recovery/status', cookieOf(started)).expect(200)).body.state).toBe('CANCELLED');
  });
});
