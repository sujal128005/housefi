// Housefi HQ operations: Emergency SOS with who and where, reports, live support conversations (the app's side and
// HQ's), booking chats, analytics, the audit log, the arcade, and Sarathi (the guide) — which only proposes: nothing
// runs until the admin who asked approves it with the checks its risk needs.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { runAdminCommand } from '../src/cli/admin';
import { AuditService } from '../src/common/audit/audit.module';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { Hashing } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { AdminAuthService } from '../src/modules/admin/admin-auth.service';
import { GUIDE_MODEL, type GuideModel, type GuideRun } from '../src/modules/admin/guide/guide-model';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const HOST = 'hq-test1234.housefi.tech';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const PROBLEM = { issueIds: ['tap-leak'], notes: 'Kitchen tap', voiceNote: null, photos: [] };
const MIN = 60_000;

/** A scripted model: each answer runs the given tool calls, then says something. */
class ScriptedModel implements GuideModel {
  available = true;
  script: { calls: [string, unknown][]; say: string } = { calls: [], say: 'ok' };
  seen: string[] = [];
  results: string[] = [];
  async answer(run: GuideRun): Promise<string> {
    this.seen.push(run.message);
    for (const [name, args] of this.script.calls) this.results.push(await run.call(name, args));
    return this.script.say;
  }
}

describe('Housefi HQ operations (e2e)', () => {
  let t: TestApp;
  let cookie: string;
  let cookieNavya: string;
  let customer: { id: string; token: string };
  let addressId: string;
  const model = new ScriptedModel();

  const app = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = {
    get: (path: string, c = cookie) => app().get(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('Cookie', c),
    post: (path: string, body: object = {}, c = cookie) => app().post(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').set('Cookie', c).send(body),
  };

  async function admin(name: string, phone: string): Promise<string> {
    const out = await runAdminCommand(['create', name, phone], { prisma: t.app.get(PrismaService), cipher: t.app.get(FieldCipher), hashing: t.app.get(Hashing), audit: t.app.get(AuditService), clock: t.clock, via: 'cli:test' });
    const username = /username: (\S+)/.exec(out.join('\n'))![1]!;
    const row = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
    const token = randomBytes(32).toString('base64url');
    const now = new Date(t.clock.now());
    await t.prisma.adminSession.create({
      data: { adminId: row.id, tokenHash: new Uint8Array(createHash('sha256').update(token).digest()), stage: 'VERIFIED', ip: '1.2.3.4', userAgent: LAPTOP, createdAt: now, lastSeenAt: now, expiresAt: new Date(t.clock.now() + 8 * 60 * MIN) },
    });
    return `hf_admin=${token}`;
  }

  async function assigned(tech: { id: string; token: string }): Promise<string> {
    const body = { serviceId: 'plumb-tap', problem: PROBLEM, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    const id = (await app().post('/v1/bookings').set(as(customer.token)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id as string;
    await app().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', provider: 'RAZORPAY', providerPaymentId: `pay_${id.slice(0, 8)}`, settledAt: new Date(t.clock.now()) } });
    await t.app.get(DispatchService).offerNext(id);
    const offer = (await app().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
    await app().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
    return id;
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { ADMIN_HOST: HOST, ADMIN_RECOVERY_CODE: '482915' }, overrides: [[GUIDE_MODEL, model]] });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.adminUser.deleteMany();
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    model.available = true;
    model.script = { calls: [], say: 'ok' };
    model.results = [];
    cookie = await admin('Sujal Negi', '9876500099');
    cookieNavya = await admin('Navya', '9876500098');
    const c = await signIn(t, '9876543210');
    customer = { id: c.customer!.id, token: c.accessToken };
    await app().patch('/v1/me').set(as(customer.token)).send({ name: 'Ravi Kumar' }).expect(200);
    addressId = (await app().post('/v1/addresses').set(as(customer.token)).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('shows an SOS with who pressed it, where they were and the technician live; taken, then resolved', async () => {
    const tech = await createTechnician(t);
    const id = await assigned(tech);
    await app().post('/v1/tech/location').set(as(tech.token)).send({ lat: 17.41, lng: 78.44, accuracy: 12 });
    await app().post('/v1/support/tickets').set(as(customer.token)).send({ kind: 'UNSAFE', bookingId: id, note: 'SOS', location: { lat: 17.4126, lng: 78.4482, accuracyM: 9 } }).expect(201);
    expect((await hq.get('/alerts').expect(200)).body).toMatchObject({ sos: 1 });

    const [sos] = (await hq.get('/tickets/sos').expect(200)).body;
    expect(sos).toMatchObject({ kind: 'UNSAFE', priority: 'URGENT', person: { id: customer.id, role: 'CUSTOMER', name: 'Ravi Kumar', phone: '9876543210' }, booking: { id, otherName: 'Swathi Naidu' } });
    expect(sos.spots[0]).toEqual({ lat: 17.4126, lng: 78.4482, accuracyM: 9, at: t.clock.now(), source: 'PHONE' });
    expect(sos.spots.map((s: { source: string }) => s.source)).toContain('ADDRESS');

    await hq.post(`/tickets/${sos.id}/take`).expect(204);
    expect((await hq.get(`/tickets/${sos.id}`, cookieNavya).expect(200)).body).toMatchObject({ state: 'IN_PROGRESS', handledBy: 'Sujal Negi' });
    await hq.post(`/tickets/${sos.id}/resolve`, { note: 'Called the customer: safe, technician left' }).expect(204);
    expect((await hq.get('/tickets/sos').expect(200)).body).toEqual([]);
    expect((await hq.get('/tickets/sos?state=RESOLVED').expect(200)).body).toHaveLength(1);
  });

  it("files a technician's unsafe report with the phone's position under SOS, and other reports under Reports", async () => {
    const tech = await createTechnician(t);
    const id = await assigned(tech);
    await app().post(`/v1/tech/jobs/${id}/reports`).set(as(tech.token)).send({ issue: 'UNSAFE', note: 'Dog attacked', location: { lat: 17.4, lng: 78.45 } }).expect(200);
    await app().post(`/v1/tech/jobs/${id}/reports`).set(as(tech.token)).send({ issue: 'WRONG_ADDRESS', note: 'Gate locked' }).expect(200);
    const [sos] = (await hq.get('/tickets/sos').expect(200)).body;
    expect(sos).toMatchObject({ person: { role: 'TECHNICIAN', name: 'Swathi Naidu' }, booking: { otherName: 'Ravi Kumar' } });
    expect(sos.spots[0]).toMatchObject({ lat: 17.4, lng: 78.45, source: 'PHONE' });
    expect((await hq.get('/tickets/reports').expect(200)).body).toEqual([expect.objectContaining({ kind: 'WRONG_ADDRESS', note: 'Gate locked' })]);
  });

  it('hands a customer over to a live conversation with HQ: replies both ways, unread counts, close, delete', async () => {
    const tech = await createTechnician(t);
    const id = await assigned(tech);
    expect((await app().get('/v1/support/conversation').set(as(customer.token)).expect(200)).body).toEqual({ conversation: null });
    const started = (await app().post('/v1/support/conversation').set(as(customer.token)).send({ topic: 'PAYMENT', bookingId: id, text: 'I was charged twice' }).expect(201)).body.conversation;
    expect(started).toMatchObject({ state: 'OPEN', topic: 'PAYMENT', bookingCode: expect.stringMatching(/^HF-/) });
    expect(started.messages.map((m: { from: string; text: string }) => [m.from, m.text])).toEqual([['SYSTEM', `About: Payment · booking ${started.bookingCode}`], ['ME', 'I was charged twice']]);
    // Asking again adds to the same conversation.
    await app().post('/v1/support/conversation').set(as(customer.token)).send({ topic: 'OTHER', text: 'Please check' }).expect(201);
    expect(await t.prisma.supportThread.count()).toBe(1);

    const [row] = (await hq.get('/conversations').expect(200)).body;
    expect(row).toMatchObject({ name: 'Ravi Kumar', topic: 'PAYMENT', unread: 2, preview: 'Please check' });
    const seen = (await hq.get(`/conversations/${row.id}`).expect(200)).body;
    expect(seen.messages.at(-1)).toMatchObject({ from: 'PERSON', text: 'Please check' });
    expect((await hq.get('/conversations').expect(200)).body[0].unread).toBe(0);

    await hq.post(`/conversations/${row.id}/reply`, { text: 'Refund started, 5–7 days' }).expect(204);
    expect(await t.prisma.notification.count({ where: { userId: customer.id, kind: 'SUPPORT_REPLY' } })).toBe(1);
    const mine = (await app().get('/v1/support/conversation').set(as(customer.token)).expect(200)).body.conversation;
    expect(mine.messages.at(-1)).toMatchObject({ from: 'HQ', text: 'Refund started, 5–7 days' });
    // Stored encrypted.
    const raw = Buffer.concat((await t.prisma.supportMessage.findMany()).map((m) => Buffer.from(m.bodyEnc))).toString('latin1');
    expect(raw).not.toContain('charged twice');

    await hq.post(`/conversations/${row.id}/close`).expect(204);
    await app().post('/v1/support/conversation/messages').set(as(customer.token)).send({ text: 'Thanks' }).expect(409);
    expect((await app().get('/v1/support/conversation').set(as(customer.token)).expect(200)).body.conversation.state).toBe('CLOSED');
    await hq.post(`/conversations/${row.id}/delete`).expect(204);
    expect(await t.prisma.supportMessage.count()).toBe(0);
    await app().post('/v1/support/conversation').set(as(customer.token)).send({ topic: 'BOOKING', bookingId: randomUUID(), text: 'x' }).expect(404);
  });

  it('lists booking chats, reads one (audited) and deletes it', async () => {
    const tech = await createTechnician(t);
    const id = await assigned(tech);
    await app().post(`/v1/bookings/${id}/chat`).set(as(customer.token)).send({ text: 'Gate code 4521' }).expect(200);
    await app().post(`/v1/tech/jobs/${id}/chat`).set(as(tech.token)).send({ text: 'Coming' }).expect(200);
    expect((await hq.get('/chats').expect(200)).body).toEqual([expect.objectContaining({ bookingId: id, messages: 2, customer: 'Ravi Kumar', technician: 'Swathi Naidu' })]);
    const chat = (await hq.get(`/chats/${id}`).expect(200)).body;
    expect(chat.messages.map((m: { from: string; text: string }) => `${m.from}: ${m.text}`)).toEqual(['CUSTOMER: Gate code 4521', 'TECHNICIAN: Coming']);
    expect(await t.prisma.auditLog.count({ where: { action: 'chat.read' } })).toBe(1);
    await hq.post(`/chats/${id}/delete`).expect(204);
    expect(await t.prisma.chatMessage.count()).toBe(0);
  });

  it('gives analytics, the audit log and the arcade leaderboard', async () => {
    const tech = await createTechnician(t);
    await assigned(tech);
    const a = (await hq.get('/analytics?days=7').expect(200)).body;
    expect(a.days).toBe(7);
    expect(a.daily).toHaveLength(7);
    expect(a.daily.at(-1)).toMatchObject({ created: 1 });
    expect(a.funnel).toEqual({ created: 1, paid: 0, assigned: 1, completed: 0 });
    expect(a.byCategory).toEqual([expect.objectContaining({ categoryId: 'PLUMBING', bookings: 1 })]);
    expect(a.ratings).toHaveLength(5);
    await hq.get('/analytics?days=3').expect(422);

    const log = (await hq.get('/audit').expect(200)).body;
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toMatchObject({ at: expect.any(Number), action: expect.any(String) });

    await hq.post('/arcade/scores', { game: 'pipe-panic', score: 420, detail: 'level 3' }).expect(200);
    await hq.post('/arcade/scores', { game: 'pipe-panic', score: 900, detail: 'level 5' }, cookieNavya).expect(200);
    expect((await hq.get('/arcade/scores/pipe-panic').expect(200)).body.map((r: { name: string; score: number }) => `${r.name} ${r.score}`)).toEqual(['Navya 900', 'Sujal Negi 420']);
    await hq.post('/arcade/scores', { game: 'pipe-panic', score: -1 }).expect(422);
  });

  describe('Sarathi, the guide', () => {
    it('looks things up with phones masked, and proposes instead of acting', async () => {
      const tech = await createTechnician(t);
      const id = await assigned(tech);
      const code = (await t.prisma.booking.findUniqueOrThrow({ where: { id } })).code;
      model.script = { calls: [['get_booking', { booking: code }], ['cancel_booking', { booking: code, refund: true, reason: 'customer asked on the phone' }]], say: 'Prepared the cancellation; approve it below.' };
      const r = (await hq.post('/guide/messages', { message: `cancel ${code} with refund` }).expect(200)).body;
      expect(r).toMatchObject({ reply: 'Prepared the cancellation; approve it below.', used: ['get_booking', 'cancel_booking'], mode: 'full' });
      expect(model.results[0]).toContain('••••••3210');
      expect(model.results[0]).not.toContain('9876543210');
      expect(model.results[0]).not.toContain('Flat 4B');
      expect(r.proposals).toEqual([expect.objectContaining({ tool: 'cancel_booking', risk: 'HIGH', phrase: `CANCEL ${code}`, state: 'PROPOSED' })]);
      // Nothing happened yet.
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('ASSIGNED');

      const pid = r.proposals[0].id;
      await hq.post(`/guide/actions/${pid}/approve`, {}).expect(422);
      await hq.post(`/guide/actions/${pid}/approve`, { typed: 'CANCEL HF-00000' }).expect(422);
      // The other admin cannot approve someone else's proposal.
      await hq.post(`/guide/actions/${pid}/approve`, { typed: `CANCEL ${code}` }, cookieNavya).expect(404);
      const done = (await hq.post(`/guide/actions/${pid}/approve`, { typed: `cancel ${code.toLowerCase()}` }).expect(200)).body;
      expect(done).toMatchObject({ state: 'DONE', result: 'Booking cancelled.' });
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
      // Once only.
      await hq.post(`/guide/actions/${pid}/approve`, { typed: `CANCEL ${code}` }).expect(409);
      expect(await t.prisma.auditLog.count({ where: { action: { in: ['guide.proposed', 'guide.approved'] } } })).toBe(2);
    });

    it('needs the confirmation typed twice and Windows Hello to delete; proposals expire', async () => {
      model.script = { calls: [['delete_person', { id: customer.id }]], say: 'Waiting for your approval.' };
      const r = (await hq.post('/guide/messages', { message: 'delete Ravi' }).expect(200)).body;
      const p = r.proposals[0];
      expect(p).toMatchObject({ risk: 'CRITICAL', phrase: 'DELETE Ravi Kumar' });
      await hq.post(`/guide/actions/${p.id}/approve`, { typed: 'DELETE Ravi Kumar' }).expect(422);
      await hq.post(`/guide/actions/${p.id}/approve`, { typed: 'DELETE Ravi Kumar', typedAgain: 'DELETE Ravi Kumar' }).expect(422);
      // A Windows Hello answer without its challenge fails.
      await hq.post(`/guide/actions/${p.id}/approve`, { typed: 'DELETE Ravi Kumar', typedAgain: 'DELETE Ravi Kumar', passkey: { id: 'x' } }).expect(401);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('ACTIVE');

      const verify = jest.spyOn(t.app.get(AdminAuthService), 'verifyStepUp').mockResolvedValue();
      await hq.post(`/guide/actions/${p.id}/approve`, { typed: 'DELETE Ravi Kumar', typedAgain: 'DELETE Ravi Kumar', passkey: { id: 'ok' } }).expect(200);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('DELETED');
      verify.mockRestore();

      model.script = { calls: [['prepare_payouts', {}]], say: 'Ready to prepare.' };
      const q = (await hq.post('/guide/messages', { message: 'prepare payouts' }).expect(200)).body.proposals[0];
      expect(q).toMatchObject({ risk: 'LOW', phrase: null });
      t.clock.t += 16 * MIN;
      await hq.post(`/guide/actions/${q.id}/approve`, {}).expect(409);
    });

    it('keeps an encrypted conversation, rejects proposals, and answers in basic mode without a model', async () => {
      model.script = { calls: [['take_ticket', { id: randomUUID() }]], say: 'No such ticket.' };
      const r = (await hq.post('/guide/messages', { message: 'take that ticket' }).expect(200)).body;
      expect(r.proposals).toEqual([]);
      expect(model.results[0]).toContain('no such ticket');
      const conv = (await hq.get('/guide').expect(200)).body;
      expect(conv.messages.map((m: { role: string; text: string }) => `${m.role}: ${m.text}`)).toEqual(['admin: take that ticket', 'guide: No such ticket.']);
      const raw = Buffer.concat((await t.prisma.adminGuideMessage.findMany()).map((m) => Buffer.from(m.bodyEnc))).toString('latin1');
      expect(raw).not.toContain('take that ticket');
      // Navya sees only her own conversation.
      expect((await hq.get('/guide', cookieNavya).expect(200)).body.messages).toEqual([]);

      model.available = false;
      await app().post('/v1/support/tickets').set(as(customer.token)).send({ kind: 'UNSAFE', note: 'SOS' }).expect(201);
      const basic = (await hq.post('/guide/messages', { message: 'any SOS?' }).expect(200)).body;
      expect(basic).toMatchObject({ mode: 'basic', reply: expect.stringContaining('1 open SOS') });
      const summary = (await hq.post('/guide/messages', { message: 'how is today' }).expect(200)).body;
      expect(summary.reply).toContain('Today:');

      model.available = true;
      model.script = { calls: [['sign_out_person', { id: customer.id }]], say: 'Proposed.' };
      const p = (await hq.post('/guide/messages', { message: 'sign Ravi out' }).expect(200)).body.proposals[0];
      expect((await hq.post(`/guide/actions/${p.id}/reject`).expect(200)).body.state).toBe('REJECTED');
      await hq.post(`/guide/actions/${p.id}/approve`, {}).expect(409);
      await hq.post('/guide/clear').expect(204);
      expect((await hq.get('/guide').expect(200)).body.messages).toEqual([]);
    });

    it('takes a photo with the question, and refuses anything that is not an image', async () => {
      const png = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;
      await hq.post('/guide/messages', { message: 'what is this?', photo: png }).expect(200);
      expect(model.seen.at(-1)).toBe('what is this?');
      await hq.post('/guide/messages', { message: 'x', photo: 'data:text/html;base64,PGgxPg==' }).expect(422);
    });
  });
});
