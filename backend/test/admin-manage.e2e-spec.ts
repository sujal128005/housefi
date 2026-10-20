// Super admin portal, management: every booking (cancel at any stage with or without a refund, send back to the
// search, give to a chosen technician, mark done, waive the visit fee, create for a customer, erase), customers and
// technicians (block, sign out, delete, approve / suspend), payouts. Signed-in admins only; everything audited.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { runAdminCommand } from '../src/cli/admin';
import { AuditService } from '../src/common/audit/audit.module';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { Hashing } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const HOST = 'hq-test1234.housefi.tech';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const PROBLEM = { issueIds: ['tap-leak'], notes: 'Kitchen tap', voiceNote: null, photos: [] };

describe('super admin portal: management (e2e)', () => {
  let t: TestApp;
  let cookie: string;
  let customer: { id: string; token: string };
  let addressId: string;

  const app = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = {
    get: (path: string, c = cookie) => app().get(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('Cookie', c),
    post: (path: string, body: object = {}, c = cookie) => app().post(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').set('Cookie', c).send(body),
  };

  async function signedInAdmin(name = 'Sujal Negi'): Promise<string> {
    const out = await runAdminCommand(['create', name, name === 'Navya' ? '9876500098' : '9876500099'], { prisma: t.app.get(PrismaService), cipher: t.app.get(FieldCipher), hashing: t.app.get(Hashing), audit: t.app.get(AuditService), clock: t.clock, via: 'cli:test' });
    const username = /username: (\S+)/.exec(out.join('\n'))![1]!;
    const admin = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
    const token = randomBytes(32).toString('base64url');
    const now = new Date(t.clock.now());
    await t.prisma.adminSession.create({
      data: { adminId: admin.id, tokenHash: new Uint8Array(createHash('sha256').update(token).digest()), stage: 'VERIFIED', ip: '1.2.3.4', userAgent: LAPTOP, createdAt: now, lastSeenAt: now, expiresAt: new Date(t.clock.now() + 8 * 3_600_000) },
    });
    return `hf_admin=${token}`;
  }

  /** A booking waiting for its visit fee. */
  async function booked(): Promise<string> {
    const body = { serviceId: 'plumb-tap', problem: PROBLEM, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    return (await app().post('/v1/bookings').set(as(customer.token)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id as string;
  }

  /** Paid, offered and accepted by this technician. */
  async function assigned(tech: { id: string; token: string }): Promise<string> {
    const id = await booked();
    await app().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', provider: 'RAZORPAY', providerPaymentId: `pay_${id.slice(0, 8)}`, settledAt: new Date(t.clock.now()) } });
    await t.app.get(DispatchService).offerNext(id);
    const offer = (await app().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
    await app().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
    return id;
  }

  const actions = async (action: string) => t.prisma.auditLog.findMany({ where: { action } });

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { ADMIN_HOST: HOST, ADMIN_RECOVERY_CODE: '482915' } });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.adminUser.deleteMany();
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    cookie = await signedInAdmin();
    const c = await signIn(t, '9876543210');
    customer = { id: c.customer!.id, token: c.accessToken };
    await app().patch('/v1/me').set(as(customer.token)).send({ name: 'Ravi Kumar' }).expect(200);
    addressId = (await app().post('/v1/addresses').set(as(customer.token)).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('is for signed-in admins only, on the secret host only', async () => {
    await hq.get('/bookings', '').expect(401);
    await app().get('/v1/admin/bookings').set('Host', 'api.housefi.tech').set('Cookie', cookie).expect(404);
    await hq.post('/bookings/00000000-0000-4000-8000-000000000000/cancel', { refund: true }, '').expect(401);
    await hq.get('/bookings').expect(200);
  });

  it('lists and finds bookings, with the full picture of one', async () => {
    const id = await booked();
    const list = (await hq.get('/bookings').expect(200)).body;
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({ id, status: 'AWAITING_PAYMENT', serviceId: 'plumb-tap', customer: { id: customer.id, name: 'Ravi Kumar' }, technician: null, visitFee: { state: 'DUE' } });
    const code = list.rows[0].code as string;
    expect((await hq.get(`/bookings?search=${code.slice(3)}`).expect(200)).body.total).toBe(1);
    expect((await hq.get('/bookings?status=CANCELLED').expect(200)).body.total).toBe(0);

    const one = (await hq.get(`/bookings/${id}`).expect(200)).body;
    expect(one.customer).toEqual({ id: customer.id, name: 'Ravi Kumar', phone: '9876543210' });
    expect(one.booking.address.house).toBe('Flat 4B, Lake View');
    expect(one.can).toEqual({ cancel: true, sendBack: false, assign: false, complete: false, waiveFee: true });
    await hq.get('/bookings/not-a-uuid').expect(404);
  });

  it('cancels at any stage, refunding the visit fee when asked; the history says it was forced', async () => {
    const tech = await createTechnician(t);
    const id = await assigned(tech);
    await t.prisma.booking.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    await hq.post(`/bookings/${id}/cancel`, { refund: true, note: 'Customer called: water main burst, plumber unsafe' }).expect(204);

    const b = await t.prisma.booking.findUniqueOrThrow({ where: { id }, include: { events: { orderBy: { at: 'asc' } }, payments: true } });
    expect(b.status).toBe('CANCELLED');
    expect(b.cancelReason).toBe('BY_HOUSEFI');
    expect(b.events.at(-1)).toMatchObject({ status: 'CANCELLED', actorType: 'ADMIN', meta: expect.objectContaining({ forced: true, refund: true }) });
    expect(b.payments.find((p) => p.kind === 'VISIT')?.state).toBe('REFUNDED');
    expect(await actions('admin.booking_cancel')).toHaveLength(1);
    // The technician is free again.
    expect(await t.prisma.booking.count({ where: { technicianId: tech.id, status: { not: 'CANCELLED' } } })).toBe(0);
    await hq.post(`/bookings/${id}/cancel`, { refund: false }).expect(409);
  });

  it('sends a job back to the search, and gives a searching job to a chosen technician', async () => {
    const first = await createTechnician(t, '9876500011');
    const id = await assigned(first);
    await app().post('/v1/tech/availability').set(as(first.token)).send({ online: false }).expect(200);
    await hq.post(`/bookings/${id}/send-back`).expect(204);
    let b = await t.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(b.technicianId).toBeNull();
    expect(['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED']).toContain(b.status);

    const second = await createTechnician(t, '9876500012');
    await hq.post(`/bookings/${id}/assign`, { technicianId: randomUUID() }).expect(409);
    await hq.post(`/bookings/${id}/assign`, { technicianId: second.id }).expect(204);
    b = await t.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(b).toMatchObject({ status: 'ASSIGNED', technicianId: second.id });
    expect(await actions('admin.booking_assign')).toHaveLength(1);
    // Busy now: not given a second job.
    const other = await assigned(first);
    await t.prisma.booking.update({ where: { id: other }, data: { status: 'MATCHING', technicianId: null } });
    await hq.post(`/bookings/${other}/assign`, { technicianId: second.id }).expect(409);
  });

  it('marks a job done once the technician is there', async () => {
    const tech = await createTechnician(t);
    const id = await assigned(tech);
    await hq.post(`/bookings/${id}/complete`).expect(409);
    await t.prisma.booking.update({ where: { id }, data: { status: 'ARRIVED' } });
    await hq.post(`/bookings/${id}/complete`).expect(204);
    expect((await t.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED');
  });

  it('creates a booking for a customer with the visit fee waived, never counted as revenue', async () => {
    const addresses = (await hq.get(`/customers/${customer.id}/addresses`).expect(200)).body;
    expect(addresses).toEqual([expect.objectContaining({ id: addressId, house: 'Flat 4B, Lake View' })]);
    const services = (await hq.get('/catalog').expect(200)).body;
    expect(services.find((s: { id: string }) => s.id === 'plumb-tap')).toMatchObject({ name: expect.any(String), issues: expect.any(Array) });

    const booking = { serviceId: 'plumb-tap', problem: PROBLEM, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    const made = (await hq.post('/bookings', { customerId: customer.id, booking, waiveFee: true }).expect(201)).body;
    expect(made.code).toMatch(/^HF-/);
    const b = await t.prisma.booking.findUniqueOrThrow({ where: { id: made.id }, include: { payments: true } });
    expect(['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED']).toContain(b.status);
    expect(b.payments[0]).toMatchObject({ state: 'PAID', provider: 'WAIVED' });
    expect((await hq.get('/overview').expect(200)).body.today.revenue).toBe(0);
    // The customer sees it in their app.
    expect((await app().get('/v1/bookings').set(as(customer.token)).expect(200)).body.map((x: { id: string }) => x.id)).toContain(made.id);
  });

  it('erases a booking: its address, notes and chat go, the money records stay', async () => {
    const tech = await createTechnician(t);
    const id = await assigned(tech);
    await app().post(`/v1/bookings/${id}/chat`).set(as(customer.token)).send({ text: 'Gate code 4521' }).expect(200);
    await hq.post(`/bookings/${id}/erase`).expect(204);
    const b = await t.prisma.booking.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    expect(b).toMatchObject({ status: 'CANCELLED', notes: '', voiceTranscript: null, issueIds: [] });
    expect(b.addressSnapshotEnc.length).toBe(0);
    expect(b.payments.length).toBeGreaterThan(0);
    expect(await t.prisma.chatMessage.count({ where: { bookingId: id } })).toBe(0);
    // Still listed (the history), without the erased content breaking the page.
    await hq.get(`/bookings/${id}`).expect(200);
  });

  it('finds customers by name or phone, blocks and unblocks them, signs them out, deletes them', async () => {
    expect((await hq.get('/customers').expect(200)).body.rows).toEqual([expect.objectContaining({ id: customer.id, name: 'Ravi Kumar', phone: '9876543210', status: 'ACTIVE' })]);
    expect((await hq.get('/customers?search=ravi').expect(200)).body.total).toBe(1);
    expect((await hq.get('/customers?search=98765%2043210').expect(200)).body.total).toBe(1);
    expect((await hq.get('/customers?search=nobody').expect(200)).body.total).toBe(0);
    expect((await hq.get(`/people/${customer.id}`).expect(200)).body).toMatchObject({ person: { name: 'Ravi Kumar' }, activeBooking: null });

    await hq.post(`/people/${customer.id}/block`, { blocked: true, reason: 'abusive calls' }).expect(204);
    await app().get('/v1/me').set(as(customer.token)).expect(401);
    expect((await hq.get('/customers?filter=BLOCKED').expect(200)).body.total).toBe(1);
    await hq.post(`/people/${customer.id}/block`, { blocked: false }).expect(204);
    t.clock.t += 10 * 60_000;
    t.rateLimits.clear();
    await t.prisma.adminSession.updateMany({ data: { lastSeenAt: new Date(t.clock.now()) } });
    const again = await signIn(t, '9876543210');
    await app().get('/v1/me').set(as(again.accessToken)).expect(200);

    expect((await hq.post(`/people/${customer.id}/sign-out`).expect(200)).body.sessions).toBeGreaterThan(0);
    await app().get('/v1/me').set(as(again.accessToken)).expect(401);

    await hq.post(`/people/${customer.id}/delete`).expect(204);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('DELETED');
    expect(await actions('admin.user_delete')).toHaveLength(1);
  });

  it('manages technicians: suspend, reinstate, take offline; no way to mark an Aadhaar checked', async () => {
    const tech = await createTechnician(t);
    await app().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    const list = (await hq.get('/technicians?filter=ONLINE').expect(200)).body;
    expect(list.rows).toEqual([expect.objectContaining({ id: tech.id, verification: 'APPROVED', online: true, trades: expect.arrayContaining(['PLUMBING']), aadhaarChecked: false })]);

    await hq.post(`/technicians/${tech.id}/action`, { action: 'offline' }).expect(204);
    expect((await t.prisma.technician.findUniqueOrThrow({ where: { userId: tech.id } })).online).toBe(false);
    await hq.post(`/technicians/${tech.id}/action`, { action: 'suspend', reason: 'complaints' }).expect(204);
    expect((await hq.get('/technicians?filter=SUSPENDED').expect(200)).body.total).toBe(1);
    await hq.post(`/technicians/${tech.id}/action`, { action: 'reinstate', reason: 'cleared' }).expect(204);
    await hq.post(`/technicians/${tech.id}/action`, { action: 'verify-aadhaar' }).expect(422);
    await hq.post(`/technicians/${customer.id}/action`, { action: 'suspend' }).expect(404);
  });

  it('prepares and settles weekly payouts', async () => {
    const tech = await createTechnician(t);
    await t.prisma.earningsLedger.create({ data: { technicianId: tech.id, type: 'ADJUSTMENT', amountPaise: 50_000n, createdAt: new Date(t.clock.now() - 3 * 86_400_000) } });
    t.clock.t = Date.UTC(2026, 9, 20, 4, 0); // Monday
    cookie = await signedInAdmin('Navya');
    const prepared = (await hq.post('/payouts/prepare').expect(200)).body;
    expect(prepared).toEqual([expect.objectContaining({ technicianId: tech.id, amount: 500, state: 'PENDING' })]);
    await hq.post(`/payouts/${prepared[0].id}/paid`, { reference: 'UPI 4421' }).expect(200);
    expect((await hq.get('/payouts?state=PAID').expect(200)).body).toHaveLength(1);
  });
});
