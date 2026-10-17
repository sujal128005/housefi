// Support end to end: SOS and other tickets, "call me back", and the support queue on the command line.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { runSupportCommand, USAGE } from '../src/cli/support';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { SupportService } from '../src/modules/support/support.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const ADMIN = { type: 'ADMIN' as const, id: null, via: 'cli:test' };
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };

describe('support (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const support = () => t.app.get(SupportService);
  let customer: string;
  let id: string;

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
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('POST /v1/support/tickets', () => {
    it('raises SOS as urgent, payment problems as high, on the caller\'s own booking', async () => {
      const sos = await api().post('/v1/support/tickets').set(as(customer)).send({ bookingId: id, kind: 'UNSAFE', note: 'Technician is aggressive' }).expect(201);
      expect(sos.body).toEqual({ ticketId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      expect(await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: sos.body.ticketId } })).toMatchObject({ kind: 'UNSAFE', priority: 'URGENT', state: 'OPEN', bookingId: id, note: 'Technician is aggressive', createdAt: new Date(t.clock.now()) });
      const pay = await api().post('/v1/support/tickets').set(as(customer)).send({ kind: 'PAYMENT_PROBLEM' }).expect(201);
      expect(await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: pay.body.ticketId } })).toMatchObject({ priority: 'HIGH', bookingId: null, note: '' });
    });

    it("refuses someone else's booking and bad input; a technician may raise one on their job", async () => {
      const other = (await signIn(t, '9876543211')).accessToken;
      await api().post('/v1/support/tickets').set(as(other)).send({ bookingId: id, kind: 'OTHER' }).expect(404);
      await api().post('/v1/support/tickets').set(as(customer)).send({ kind: 'COMPLAINT' }).expect(422);
      await api().post('/v1/support/tickets').set(as(customer)).send({ kind: 'OTHER', note: 'x'.repeat(1001) }).expect(422);
      await api().post('/v1/support/tickets').send({ kind: 'OTHER' }).expect(401);
      const tech = await createTechnician(t);
      await api().post('/v1/support/tickets').set(as(tech.token)).send({ bookingId: id, kind: 'UNSAFE' }).expect(404); // not their job
      await t.prisma.booking.update({ where: { id }, data: { status: 'ASSIGNED', technicianId: tech.id } });
      await api().post('/v1/support/tickets').set(as(tech.token)).send({ bookingId: id, kind: 'UNSAFE' }).expect(201);
    });
  });

  describe('POST /v1/support/callback', () => {
    it('one open request per person and booking: asking again returns it and adds the reason', async () => {
      const first = (await api().post('/v1/support/callback').set(as(customer)).send().expect(201)).body.ticketId;
      expect((await api().post('/v1/support/callback').set(as(customer)).send({ reason: 'About my refund' }).expect(201)).body.ticketId).toBe(first);
      expect(await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ kind: 'CALLBACK', priority: 'NORMAL', note: 'About my refund' });

      // About a booking in progress: its own request, and high priority.
      await t.prisma.booking.update({ where: { id }, data: { status: 'MATCHING' } });
      const onBooking = (await api().post('/v1/support/callback').set(as(customer)).send({ bookingId: id, reason: 'Is someone coming?' }).expect(201)).body.ticketId;
      expect(onBooking).not.toBe(first);
      expect((await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: onBooking } })).priority).toBe('HIGH');

      // Once resolved, a new request is a new ticket.
      await support().resolve(first, 'Called back, refund explained', ADMIN);
      expect((await api().post('/v1/support/callback').set(as(customer)).send({}).expect(201)).body.ticketId).not.toBe(first);
      await api().post('/v1/support/callback').set(as(customer)).send({ reason: 'x'.repeat(301) }).expect(422);
    });
  });

  describe('npm run support', () => {
    it('lists the queue most urgent first and resolves tickets (audited)', async () => {
      const cli = (...args: string[]) => runSupportCommand(args, support(), ADMIN);
      expect(await cli()).toEqual([USAGE]);
      expect(await cli('open')).toEqual(['No open tickets.']);
      const other = (await api().post('/v1/support/tickets').set(as(customer)).send({ kind: 'OTHER', note: 'App is slow' }).expect(201)).body.ticketId;
      t.clock.advance(60_000);
      const sos = (await api().post('/v1/support/tickets').set(as(customer)).send({ bookingId: id, kind: 'UNSAFE' }).expect(201)).body.ticketId;
      const booking = await t.prisma.booking.findUniqueOrThrow({ where: { id } });
      const open = await cli('open');
      expect(open).toHaveLength(2);
      expect(open[0]).toMatch(new RegExp(`^${sos}  URGENT  UNSAFE  ${booking.code}  from customer `));
      expect(open[1]).toMatch(new RegExp(`^${other}  NORMAL  OTHER  -  from customer .+"App is slow"$`));

      expect(await cli('resolve', sos, 'Called the customer, technician replaced')).toEqual([`Resolved ${sos}.`]);
      expect(await t.prisma.supportTicket.findUniqueOrThrow({ where: { id: sos } })).toMatchObject({ state: 'RESOLVED', resolution: 'Called the customer, technician replaced', resolvedAt: new Date(t.clock.now()) });
      expect(await t.prisma.auditLog.findFirst({ where: { action: 'support.resolve' } })).toMatchObject({ actorType: 'ADMIN', entityId: sos, after: { state: 'RESOLVED', via: 'cli:test' } });
      await expect(cli('resolve', sos, 'again')).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(cli('resolve', other, 'ok')).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(cli('resolve', randomUUID(), 'done now')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await cli('open')).toHaveLength(1);
    });
  });
});
