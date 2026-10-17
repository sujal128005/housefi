// Coordinator-assisted jobs end to end: admin-made accounts and sign-in, assigning a searching booking to a linked
// technician without a phone, and doing the whole visit on their behalf (every action recorded as the coordinator).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { runCoordinatorsCommand, USAGE } from '../src/cli/coordinators';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { CoordinatorAccountsService } from '../src/modules/coordinator/coordinator-accounts.service';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const ADMIN = { id: null, via: 'cli:test' };
const COORD_PHONE = '9000000001';
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const QUOTE = { which: 'MAIN', diagnosis: 'Worn-out washer.', lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 120 }, { kind: 'MATERIAL', name: 'Washer', qty: 1, unitPrice: 200 }] };

describe('coordinator (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const accounts = () => t.app.get(CoordinatorAccountsService);
  let customer: string;
  let coordinator: { id: string; token: string };
  let tech: { id: string; token: string };
  let id: string;

  const act = (action: string, body: object = {}, token = coordinator.token) => api().post(`/v1/coordinator/jobs/${id}/actions/${action}`).set(as(token)).send(body);
  const assign = (technicianId: string, token = coordinator.token) => api().post(`/v1/coordinator/jobs/${id}/assign`).set(as(token)).send({ technicianId });

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    customer = (await signIn(t, '9876543210')).accessToken;
    const addressId = (await api().post('/v1/addresses').set(as(customer)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    id = (await api().post('/v1/bookings').set(as(customer)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id;
    await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: id }, data: { state: 'PAID', settledAt: new Date(t.clock.now()) } });
    // A technician without a phone, looked after by the coordinator.
    tech = await createTechnician(t, '9876500011');
    await t.prisma.technician.update({ where: { userId: tech.id }, data: { phoneType: 'NONE' } });
    const coordId = await accounts().add(COORD_PHONE, 'Lakshmi Rao', ADMIN);
    await accounts().link(tech.id, COORD_PHONE, ADMIN);
    const auth = await signIn(t, COORD_PHONE, 'COORDINATOR');
    coordinator = { id: coordId, token: auth.accessToken };
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('accounts and sign-in', () => {
    it('signs in an admin-made coordinator; an unknown number gets the same answer but no SMS and no account', async () => {
      t.clock.advance(31_000); // past the 30 s resend limit of the sign-in in beforeEach
      const auth = await signIn(t, COORD_PHONE, 'COORDINATOR');
      expect(auth).toMatchObject({ isNew: false, coordinator: { id: coordinator.id, name: 'Lakshmi Rao' } });
      expect(auth.customer).toBeUndefined();

      t.sms.sent.length = 0;
      const challenge = await api().post('/v1/auth/otp/request').send({ phone: '9000000002', role: 'COORDINATOR' }).expect(200);
      expect(challenge.body).toMatchObject({ challengeId: expect.any(String), phone: '9000000002' });
      expect(t.sms.sent).toEqual([]);
      await api().post('/v1/auth/otp/verify').send({ challengeId: challenge.body.challengeId, code: '123456' }).expect(400);
      expect(await t.prisma.user.count({ where: { role: 'COORDINATOR' } })).toBe(1);
    });

    it('other roles cannot use the coordinator API, and a coordinator cannot use theirs', async () => {
      await api().get('/v1/coordinator/jobs').set(as(customer)).expect(404);
      await api().get('/v1/coordinator/jobs').set(as(tech.token)).expect(404);
      await api().get('/v1/coordinator/jobs').expect(401);
      await api().get('/v1/bookings').set(as(coordinator.token)).expect(404);
      await api().post('/v1/support/tickets').set(as(coordinator.token)).send({ kind: 'OTHER' }).expect(404);
    });

    it('a blocked coordinator is signed out and cannot sign in again', async () => {
      await accounts().block(COORD_PHONE, ADMIN);
      t.sms.sent.length = 0;
      t.clock.advance(31_000);
      const challenge = await api().post('/v1/auth/otp/request').send({ phone: COORD_PHONE, role: 'COORDINATOR' }).expect(200);
      expect(t.sms.sent).toEqual([]); // blocked accounts get no code
      await api().post('/v1/auth/otp/verify').send({ challengeId: challenge.body.challengeId, code: '000000' }).expect(400);
      expect(await t.prisma.refreshToken.count({ where: { userId: coordinator.id, revokedAt: null } })).toBe(0);
    });

    it('npm run coordinators', async () => {
      const cli = (...args: string[]) => runCoordinatorsCommand(args, accounts(), ADMIN);
      expect(await cli()).toEqual([USAGE]);
      expect(await cli('list')).toEqual([`${coordinator.id}  Lakshmi Rao  ACTIVE  1 technician(s)`, `    ${tech.id}  Swathi Naidu  NONE`]);
      await expect(cli('add', COORD_PHONE, 'Again')).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await cli('add', '9000000003', 'Ravi Kumar'))[0]).toMatch(/^Created coordinator [0-9a-f-]{36}\.$/);
      expect(await cli('unlink', '9876500011')).toEqual(['Unlinked.']);
      expect((await cli('list'))[0]).toContain('0 technician(s)');
      const audit = await t.prisma.auditLog.findMany({ where: { action: { startsWith: 'coordinator.' } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['coordinator.add', 'coordinator.link', 'coordinator.add', 'coordinator.unlink']);
    });
  });

  describe('assigning', () => {
    it('lists searching bookings by area only, and assigns one to a linked technician (audited, as the coordinator)', async () => {
      await t.app.get(DispatchService).offerNext(id); // nobody online: no offer; a second online technician gets one below
      const other = await createTechnician(t, '9876500022');
      await api().post('/v1/tech/availability').set(as(other.token)).send({ online: true }).expect(200);
      await t.prisma.$executeRaw`UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(78.449, 17.4135), 4326)::geography WHERE user_id = ${other.id}::uuid`;
      await t.app.get(DispatchService).offerNext(id);
      expect(await t.prisma.jobOffer.count({ where: { bookingId: id, state: 'OPEN' } })).toBe(1);

      const list = (await api().get('/v1/coordinator/jobs').set(as(coordinator.token)).expect(200)).body;
      expect(list.assigned).toEqual([]);
      expect(list.searching).toEqual([expect.objectContaining({ id, status: 'MATCHING', serviceId: 'plumb-tap', pincode: '500034', searchingSince: t.clock.now() })]);
      expect(JSON.stringify(list.searching)).not.toContain('Flat 4B');

      const res = await assign(tech.id).expect(200);
      expect(res.body).toMatchObject({ id, status: 'ASSIGNED' });
      expect(await t.prisma.jobOffer.count({ where: { bookingId: id, state: 'OPEN' } })).toBe(0); // the open offer was withdrawn
      expect(await t.prisma.bookingEvent.findFirst({ where: { bookingId: id, status: 'ASSIGNED' } })).toMatchObject({ actorType: 'COORDINATOR', actorId: coordinator.id });
      expect(await t.prisma.auditLog.findFirst({ where: { action: 'coordinator.assign' } })).toMatchObject({ actorType: 'COORDINATOR', actorId: coordinator.id, entityId: id, after: { status: 'ASSIGNED', technicianId: tech.id } });
      expect((await api().get('/v1/notifications').set(as(customer)).expect(200)).body[0].kind).toBe('TECH_ASSIGNED');
      expect((await api().get('/v1/coordinator/jobs').set(as(coordinator.token)).expect(200)).body.assigned.map((j: { id: string }) => j.id)).toEqual([id]);
      await assign(tech.id).expect(409); // no longer searching
    });

    it('refuses technicians who are not theirs, not approved, without the skill, or busy', async () => {
      const stranger = await createTechnician(t, '9876500033');
      await assign(stranger.id).expect(404);
      await assign(randomUUID()).expect(404);
      await t.prisma.technicianSkill.deleteMany({ where: { technicianId: tech.id, categoryId: 'PLUMBING' } });
      await assign(tech.id).expect(409);
      await t.prisma.technicianSkill.create({ data: { technicianId: tech.id, categoryId: 'PLUMBING' } });
      await t.prisma.technician.update({ where: { userId: tech.id }, data: { verification: 'PENDING' } });
      await assign(tech.id).expect(403);
    });
  });

  describe('acting for the technician', () => {
    it('runs the whole visit for them; every action is recorded as the coordinator', async () => {
      await assign(tech.id).expect(200);
      await act('start-trip').expect(200);
      await act('arrived').expect(200);
      expect((await act('verify-start-code', { code: '0000' }).expect(400)).body.error.code).toBe('OTP_INVALID');
      const code = await t.app.get(FieldCipher).decrypt('bookings.arrival_code', (await t.prisma.booking.findUniqueOrThrow({ where: { id } })).arrivalCodeEnc);
      await act('verify-start-code', { code }).expect(200);
      await act('quotes', { which: 'MAIN', lines: [] }).expect(422);
      expect((await act('quotes', QUOTE).expect(200)).body.status).toBe('QUOTE_SHARED');
      await api().post(`/v1/bookings/${id}/quotes/MAIN/answer`).set(as(customer)).send({ answer: 'APPROVE' }).expect(200);
      await act('start-work').expect(200);
      expect((await act('complete').expect(200)).body.finalPayment).toMatchObject({ amount: 320, state: 'DUE' });
      await api().post(`/v1/bookings/${id}/payments`).set(as(customer)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'CASH' }).expect(200);
      expect((await act('confirm-cash').expect(200)).body).toMatchObject({ status: 'COMPLETED', earning: 326 });

      const events = await t.prisma.bookingEvent.findMany({ where: { bookingId: id, status: { in: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'PAYMENT_DUE', 'COMPLETED'] } } });
      expect(events.every((e) => e.actorType === 'COORDINATOR' && e.actorId === coordinator.id)).toBe(true);
      const audit = await t.prisma.auditLog.findMany({ where: { actorId: coordinator.id, action: { startsWith: 'coordinator.' } }, orderBy: { id: 'asc' } });
      // Each status change they caused is also in the log, as theirs (booking.status).
      expect(await t.prisma.auditLog.count({ where: { actorId: coordinator.id, action: 'booking.status' } })).toBe(7);
      expect(audit.map((a) => [a.action, (a.after as { outcome?: string }).outcome ?? null])).toEqual([
        ['coordinator.assign', null],
        ['coordinator.start-trip', 'OK'],
        ['coordinator.arrived', 'OK'],
        ['coordinator.verify-start-code', 'OTP_INVALID'],
        ['coordinator.verify-start-code', 'OK'],
        ['coordinator.quotes', 'VALIDATION'],
        ['coordinator.quotes', 'OK'],
        ['coordinator.start-work', 'OK'],
        ['coordinator.complete', 'OK'],
        ['coordinator.confirm-cash', 'OK'],
      ]);
      // The technician still earns it.
      expect(await t.prisma.earningsLedger.count({ where: { technicianId: tech.id } })).toBe(4);
    });

    it('reports for them, and only on jobs of their own technicians', async () => {
      await assign(tech.id).expect(200);
      await act('start-trip').expect(200);
      await act('arrived').expect(200);
      expect((await act('reports', { issue: 'CUSTOMER_UNAVAILABLE', note: 'Nobody home' }).expect(200)).body).toMatchObject({ status: 'CLOSED_NO_REPAIR', closeReason: 'CUSTOMER_UNAVAILABLE' });

      await act('fly-away').expect(404);
      const otherId = (await accounts().add('9000000004', 'Other Coordinator', ADMIN)) && (await signIn(t, '9000000004', 'COORDINATOR')).accessToken;
      await act('start-trip', {}, otherId).expect(404);
      await api().post(`/v1/coordinator/jobs/${randomUUID()}/actions/start-trip`).set(as(coordinator.token)).send({}).expect(404);
    });
  });
});
