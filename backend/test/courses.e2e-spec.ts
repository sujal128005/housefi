// Courses end to end: HQ uploads lesson videos and publishes, technicians start free courses or buy an advanced one
// (Razorpay checkout, webhook, 3.8★ free, demo accounts simulated), watch without skipping ahead, pass the quiz and get
// a Housefi course certification. The test clock starts at 2026-10-16 12:00 IST.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { runAdminCommand } from '../src/cli/admin';
import { AuditService } from '../src/common/audit/audit.module';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { Hashing } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { courseDef } from '../src/modules/courses/course-catalog';
import { optionId, quizOrder } from '../src/modules/courses/course-rules';
import { CoursesService } from '../src/modules/courses/courses.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, TEST_SECRETS, type TestApp } from './helpers';
import { mp4Video } from './media-fixtures';

const HOST = 'hq-test1234.housefi.tech';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SEC = 1000;

describe('courses (e2e)', () => {
  let t: TestApp;
  let cookie: string;
  let tech: { id: string; token: string };
  const app = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = {
    get: (path: string) => app().get(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('Cookie', cookie),
    post: (path: string, body: object = {}) => app().post(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').set('Cookie', cookie).send(body),
    video: (path: string, bytes: Buffer, type = 'video/mp4') => app().put(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').set('Cookie', cookie).set('content-type', type).send(bytes),
  };

  async function admin(): Promise<string> {
    const out = await runAdminCommand(['create', 'Sujal Negi', '9876500099'], { prisma: t.app.get(PrismaService), cipher: t.app.get(FieldCipher), hashing: t.app.get(Hashing), audit: t.app.get(AuditService), clock: t.clock, via: 'cli:test' });
    const row = await t.prisma.adminUser.findUniqueOrThrow({ where: { username: /username: (\S+)/.exec(out.join('\n'))![1]! } });
    const token = randomBytes(32).toString('base64url');
    const now = new Date(t.clock.now());
    await t.prisma.adminSession.create({
      data: { adminId: row.id, tokenHash: new Uint8Array(createHash('sha256').update(token).digest()), stage: 'VERIFIED', ip: '1.2.3.4', userAgent: LAPTOP, createdAt: now, lastSeenAt: now, expiresAt: new Date(t.clock.now() + 8 * 3_600_000) },
    });
    return `hf_admin=${token}`;
  }

  /** HQ puts a video on every lesson of a course and publishes it. */
  async function publish(courseId: string, seconds = 120): Promise<void> {
    for (const l of courseDef(courseId)!.lessons) await hq.video(`/courses/${courseId}/lessons/${l.id}/video`, mp4Video(seconds)).expect(204);
    await hq.post(`/courses/${courseId}/publish`, { published: true }).expect(204);
  }

  /** Watches a lesson at normal speed, reporting every 30 s as the app does. */
  async function watch(token: string, courseId: string, lessonId: string, seconds: number): Promise<{ completed: boolean }> {
    await app().get(`/v1/tech/courses/${courseId}/lessons/${lessonId}`).set(as(token)).expect(200);
    let last = { completed: false };
    for (let at = 30; at <= seconds; at += 30) {
      t.clock.advance(30 * SEC);
      last = (await app().post(`/v1/tech/courses/${courseId}/lessons/${lessonId}/progress`).set(as(token)).send({ positionSec: at }).expect(200)).body;
    }
    return last;
  }

  const checkoutSignature = (orderId: string, paymentId: string) => createHmac('sha256', TEST_SECRETS.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { ADMIN_HOST: HOST, ADMIN_RECOVERY_CODE: '482915' } });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.adminUser.deleteMany();
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    t.razorpay.reset();
    t.store.objects.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    cookie = await admin();
    tech = await createTechnician(t, '9876500011');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('shows technicians only courses HQ published, with a video on every lesson', async () => {
    const list = (await hq.get('/courses').expect(200)).body;
    expect(list).toHaveLength(18);
    expect(list.map((c: { level: string }) => c.level).slice(0, 3)).toEqual(['BASIC', 'SAFETY', 'ADVANCED']);
    expect((await app().get('/v1/tech/courses').set(as(tech.token)).expect(200)).body.courses).toEqual([]);

    // Not before every lesson has its video; only real videos.
    await hq.post('/courses/pl-basic/publish', { published: true }).expect(409);
    await hq.video('/courses/pl-basic/lessons/tools/video', Buffer.from('not a video')).expect(422);
    await hq.video('/courses/pl-basic/lessons/nope/video', mp4Video(60)).expect(404);
    await publish('pl-basic', 90);
    const hqCourse = (await hq.get('/courses').expect(200)).body.find((c: { id: string }) => c.id === 'pl-basic');
    expect(hqCourse).toMatchObject({ published: true, lessons: [{ video: { durationSec: 90 } }, {}, {}, {}] });
    // The place a phone stores in a video is removed.
    const stored = [...t.store.objects.entries()].find(([k]) => k.startsWith('courses/pl-basic/tools/'))![1].bytes;
    expect(Buffer.from(stored).includes(Buffer.from('+17.4126'))).toBe(false);

    const courses = (await app().get('/v1/tech/courses').set(as(tech.token)).expect(200)).body;
    expect(courses).toMatchObject({ rating: null, freeFromRating: 3.8, price: 99, courses: [{ id: 'pl-basic', level: 'BASIC', price: 0, access: 'FREE', enrolled: false, lessons: 4, durationSec: 360 }] });

    // Removing a lesson's video closes the course.
    await app().delete('/v1/admin/courses/pl-basic/lessons/tools/video').set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').set('Cookie', cookie).expect(204);
    expect((await app().get('/v1/tech/courses').set(as(tech.token)).expect(200)).body.courses).toEqual([]);
  });

  it('counts only lessons watched at normal speed to the end, then the quiz gives a certification', async () => {
    await publish('pl-basic', 120);
    await app().get('/v1/tech/courses/pl-basic/lessons/tools').set(as(tech.token)).expect(409); // not started
    await app().post('/v1/tech/courses/pl-basic/enroll').set(as(tech.token)).expect(200);

    // Dragging the player to the end does not count.
    const lesson = (await app().get('/v1/tech/courses/pl-basic/lessons/tools').set(as(tech.token)).expect(200)).body;
    expect(lesson).toMatchObject({ durationSec: 120, watchedSec: 0, completed: false, url: expect.stringContaining('courses/pl-basic/tools/') });
    const skip = (await app().post('/v1/tech/courses/pl-basic/lessons/tools/progress').set(as(tech.token)).send({ positionSec: 119 }).expect(200)).body;
    expect(skip).toEqual({ watchedSec: 10, completed: false });
    await app().get('/v1/tech/courses/pl-basic/quiz').set(as(tech.token)).expect(409); // lessons first

    for (const l of courseDef('pl-basic')!.lessons) expect(await watch(tech.token, 'pl-basic', l.id, 120)).toEqual({ watchedSec: 120, completed: true });
    const before = (await app().get('/v1/tech/courses/pl-basic').set(as(tech.token)).expect(200)).body;
    expect(before).toMatchObject({ completedLessons: 4, quiz: { questions: 5, passCorrect: 3, unlocked: true, attempts: 0 }, certificate: null });

    // A first try with every answer wrong; then right (the options come in a new order each try).
    const quiz = (await app().get('/v1/tech/courses/pl-basic/quiz').set(as(tech.token)).expect(200)).body;
    expect(JSON.stringify(quiz)).not.toMatch(/answer/);
    const right = (attempt: number) => Object.fromEntries(quizOrder(`${tech.id}:pl-basic:${attempt}`, courseDef('pl-basic')!.quiz.map((q) => q.options.length)).map((order, i) => [String(i), optionId(order.indexOf(courseDef('pl-basic')!.quiz[i]!.answer))]));
    const wrong = Object.fromEntries(Object.entries(right(0)).map(([k, v]) => [k, v === 'a' ? 'b' : 'a']));
    const failed = (await app().post('/v1/tech/courses/pl-basic/quiz').set(as(tech.token)).send({ answers: wrong }).expect(200)).body;
    expect(failed).toMatchObject({ correct: 0, total: 5, passed: false, course: { completed: false } });
    const passed = (await app().post('/v1/tech/courses/pl-basic/quiz').set(as(tech.token)).send({ answers: right(1) }).expect(200)).body;
    expect(passed).toMatchObject({ correct: 5, passed: true, course: { completed: true, certificate: { title: 'Housefi course: Plumbing basics' } } });

    // The certification shows on the profile and the ID card, not in the skill check's own certificates.
    const me = (await app().get('/v1/tech/me').set(as(tech.token)).expect(200)).body;
    expect(me.skillCheck.certifications).toEqual([{ kind: 'HOUSEFI_COURSE', title: 'Housefi course: Plumbing basics' }]);
    expect((await app().get('/v1/tech/id-card').set(as(tech.token)).expect(200)).body.certifications).toEqual([{ kind: 'HOUSEFI_COURSE', title: 'Housefi course: Plumbing basics' }]);
    expect((await app().get('/v1/tech/skills').set(as(tech.token)).expect(200)).body.certificates).toEqual([]);
    expect((await hq.get('/courses').expect(200)).body.find((c: { id: string }) => c.id === 'pl-basic').stats).toEqual({ enrolled: 1, completed: 1, paid: 0, revenue: 0 });
  });

  it('sells an advanced course for 99 rupees (checkout or webhook), free from 3.8★, simulated for demo accounts', async () => {
    await publish('pl-advanced', 60);
    const card = (await app().get('/v1/tech/courses').set(as(tech.token)).expect(200)).body.courses[0];
    expect(card).toMatchObject({ id: 'pl-advanced', price: 99, access: 'PAY' });
    await app().post('/v1/tech/courses/pl-advanced/enroll').set(as(tech.token)).expect(409);

    // Checkout: the server checks the signature and asks Razorpay.
    const order = (await app().post('/v1/tech/courses/pl-advanced/payments').set(as(tech.token)).expect(200)).body;
    expect(order).toMatchObject({ provider: 'RAZORPAY', amount: 99, keyId: 'rzp_test_housefi' });
    expect(t.razorpay.orders.get(order.orderId)?.amount).toBe(9900);
    const paid = t.razorpay.pay(order.orderId);
    await app().post(`/v1/tech/courses/pl-advanced/payments/${order.paymentId}/verify`).set(as(tech.token)).send({ razorpayOrderId: order.orderId, razorpayPaymentId: paid.id, razorpaySignature: 'f'.repeat(64) }).expect(402);
    const after = (await app().post(`/v1/tech/courses/pl-advanced/payments/${order.paymentId}/verify`).set(as(tech.token)).send({ razorpayOrderId: order.orderId, razorpayPaymentId: paid.id, razorpaySignature: checkoutSignature(order.orderId, paid.id) }).expect(200)).body;
    expect(after).toMatchObject({ enrolled: true, access: 'PAY' });
    expect((await t.prisma.courseEnrollment.findFirstOrThrow({ where: { technicianId: tech.id } })).access).toBe('PAID');

    // Another technician closes the app after paying: Razorpay's webhook settles it.
    const other = await createTechnician(t, '9876500022');
    const order2 = (await app().post('/v1/tech/courses/pl-advanced/payments').set(as(other.token)).expect(200)).body;
    const payment = t.razorpay.pay(order2.orderId);
    const raw = JSON.stringify({ entity: 'event', event: 'payment.captured', payload: { payment: { entity: payment } }, created_at: 1792150000 });
    await app().post('/v1/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-event-id', randomUUID())
      .set('x-razorpay-signature', createHmac('sha256', TEST_SECRETS.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')).send(raw).expect(200);
    expect((await app().get('/v1/tech/courses/pl-advanced').set(as(other.token)).expect(200)).body.enrolled).toBe(true);

    // 3.8★ or more: free.
    const rated = await createTechnician(t, '9876500033');
    await t.prisma.technician.update({ where: { userId: rated.id }, data: { ratingAvg: 3.8, ratingCount: 4 } });
    expect((await app().get('/v1/tech/courses').set(as(rated.token)).expect(200)).body.courses[0].access).toBe('RATING');
    await app().post('/v1/tech/courses/pl-advanced/payments').set(as(rated.token)).expect(409);
    expect((await app().post('/v1/tech/courses/pl-advanced/enroll').set(as(rated.token)).expect(200)).body.enrolled).toBe(true);

    // The team's demo accounts: a simulated payment, nothing sent to Razorpay.
    const demo = await createTechnician(t, '9876500044');
    await t.prisma.user.update({ where: { id: demo.id }, data: { isDemo: true } });
    const orders = t.razorpay.orders.size;
    const sim = (await app().post('/v1/tech/courses/pl-advanced/payments').set(as(demo.token)).expect(200)).body;
    expect(sim).toMatchObject({ provider: 'SIMULATED', keyId: '' });
    expect((await app().post(`/v1/tech/courses/pl-advanced/payments/${sim.paymentId}/verify`).set(as(demo.token)).send({ razorpayOrderId: sim.orderId, razorpayPaymentId: 'x', razorpaySignature: 'x' }).expect(200)).body.enrolled).toBe(true);
    expect(t.razorpay.orders.size).toBe(orders);
    expect((await hq.get('/courses').expect(200)).body.find((c: { id: string }) => c.id === 'pl-advanced').stats).toMatchObject({ enrolled: 4, paid: 3, revenue: 297 });
  });

  it('settles an order the app never came back from, and gives up after a day', async () => {
    await publish('pl-advanced', 60);
    const order = (await app().post('/v1/tech/courses/pl-advanced/payments').set(as(tech.token)).expect(200)).body;
    t.razorpay.pay(order.orderId);
    t.clock.advance(11 * 60 * SEC);
    expect(await t.app.get(CoursesService).reconcile()).toBe(1);
    expect((await t.prisma.coursePayment.findUniqueOrThrow({ where: { id: order.paymentId } })).state).toBe('PAID');

    const other = await createTechnician(t, '9876500022');
    const abandoned = (await app().post('/v1/tech/courses/pl-advanced/payments').set(as(other.token)).expect(200)).body;
    t.clock.advance(25 * 3_600_000);
    await t.app.get(CoursesService).reconcile();
    expect((await t.prisma.coursePayment.findUniqueOrThrow({ where: { id: abandoned.paymentId } })).state).toBe('FAILED');
  });
});
