// Reminders (src/modules/notifications/reminders.service.ts): when each is due, that each is sent once, and the
// technician account notices. The test clock starts at 2026-10-16 12:00 IST.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { RemindersService } from '../src/modules/notifications/reminders.service';
import { TechVerificationService } from '../src/modules/technicians/tech-verification.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const MIN = 60_000;
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };

describe('reminders (e2e)', () => {
  let t: TestApp;
  let reminders: RemindersService;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  let customer: { token: string; id: string };
  let addressId: string;

  const kinds = async (userId: string) => (await t.prisma.notification.findMany({ where: { userId }, orderBy: { seq: 'asc' } })).map((n) => ({ kind: n.kind, params: n.params }));

  async function book(time: object = { mode: 'INSTANT', window: null }): Promise<{ id: string; code: string }> {
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time, preferWomenRated: false };
    const res = (await api().post('/v1/bookings').set(as(customer.token)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body;
    return { id: res.id, code: res.code };
  }

  /** Puts a booking straight into a status, as if it had got there at `at`. */
  async function moveTo(id: string, status: 'ASSIGNED' | 'QUOTE_SHARED' | 'COMPLETED', at: number, technicianId?: string): Promise<void> {
    await t.prisma.booking.update({ where: { id }, data: { status, ...(technicianId ? { technicianId } : {}) } });
    await t.prisma.bookingEvent.create({ data: { bookingId: id, status, actorType: 'SYSTEM', at: new Date(at) } });
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
    reminders = t.app.get(RemindersService);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    const s = await signIn(t, '9876543210');
    customer = { token: s.accessToken, id: s.customer!.id };
    addressId = (await api().post('/v1/addresses').set(as(customer.token)).send(HOME).expect(201)).body.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('reminds about an unpaid visit fee 10 minutes before the booking expires, once', async () => {
    const { code } = await book();
    t.clock.t += 19 * MIN;
    expect(await reminders.sweep()).toBe(0);
    t.clock.t += 2 * MIN;
    expect(await reminders.sweep()).toBe(1);
    expect(await reminders.sweep()).toBe(0);
    expect(await kinds(customer.id)).toEqual([{ kind: 'PAY_REMINDER', params: { code, minutes: 9 } }]);
  });

  it('reminds both sides an hour before a scheduled visit', async () => {
    const tech = await createTechnician(t);
    const { id, code } = await book({ mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 10, endHour: 12 } });
    await moveTo(id, 'ASSIGNED', t.clock.now(), tech.id);
    t.clock.t = Date.UTC(2026, 9, 17, 4, 30) - 61 * MIN; // 08:59 IST, the window starts at 10:00
    expect(await reminders.sweep()).toBe(1); // the technician's day plan (from 07:30), not the hour-before one yet
    t.clock.t += 2 * MIN;
    expect(await reminders.sweep()).toBe(1);
    expect(await reminders.sweep()).toBe(0);
    expect(await kinds(customer.id)).toEqual([{ kind: 'BOOKING_REMINDER', params: { code, startHour: 10 } }]);
    expect((await kinds(tech.id)).filter((n) => n.kind === 'JOB_REMINDER')).toEqual([{ kind: 'JOB_REMINDER', params: { code, startHour: 10 } }]);
  });

  it('reminds both sides the evening before a scheduled visit, from 19:00 IST, once', async () => {
    const tech = await createTechnician(t);
    const { id, code } = await book({ mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 10, endHour: 12 } });
    await moveTo(id, 'ASSIGNED', t.clock.now(), tech.id);
    t.clock.t = Date.UTC(2026, 9, 16, 13, 29); // 18:59 IST on the 16th
    expect(await reminders.sweep()).toBe(0);
    t.clock.t += 2 * MIN; // 19:01
    expect(await reminders.sweep()).toBe(1);
    expect(await reminders.sweep()).toBe(0);
    expect(await kinds(customer.id)).toEqual([{ kind: 'BOOKING_TOMORROW', params: { code, startHour: 10, endHour: 12 } }]);
    expect((await kinds(tech.id)).filter((n) => n.kind === 'JOB_TOMORROW')).toEqual([{ kind: 'JOB_TOMORROW', params: { code, startHour: 10, endHour: 12 } }]);
  });

  it("sends the technician the day's plan from 07:30 IST: how many jobs and the first one's time, once a day", async () => {
    const tech = await createTechnician(t);
    const late = await book({ mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 16, endHour: 18 } });
    const early = await book({ mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 10, endHour: 12 } });
    await moveTo(late.id, 'ASSIGNED', t.clock.now(), tech.id);
    await moveTo(early.id, 'ASSIGNED', t.clock.now(), tech.id);
    t.clock.t = Date.UTC(2026, 9, 17, 1, 59); // 07:29 IST
    expect((await reminders.sweep())).toBe(0);
    t.clock.t += 2 * MIN; // 07:31
    expect(await reminders.sweep()).toBe(1);
    expect(await reminders.sweep()).toBe(0);
    expect((await kinds(tech.id)).filter((n) => n.kind === 'JOB_DAY_PLAN')).toEqual([{ kind: 'JOB_DAY_PLAN', params: { code: early.code, count: 2, startHour: 10 } }]);
    // A job accepted later that morning does not send a second plan.
    customer.token = (await signIn(t, '9876543210')).accessToken;
    const another = await book({ mode: 'SCHEDULED', window: { date: '2026-10-17', startHour: 12, endHour: 14 } });
    await moveTo(another.id, 'ASSIGNED', t.clock.now(), tech.id);
    t.clock.t += 10 * MIN;
    expect((await kinds(tech.id)).filter((n) => n.kind === 'JOB_DAY_PLAN')).toHaveLength(1);
    await reminders.sweep();
    expect((await kinds(tech.id)).filter((n) => n.kind === 'JOB_DAY_PLAN')).toHaveLength(1);
  });

  it('nudges about a waiting quote after 10 minutes, again for a revised quote', async () => {
    const tech = await createTechnician(t);
    const { id, code } = await book();
    await moveTo(id, 'QUOTE_SHARED', t.clock.now(), tech.id);
    t.clock.t += 9 * MIN;
    expect(await reminders.sweep()).toBe(0);
    t.clock.t += 2 * MIN;
    expect(await reminders.sweep()).toBe(1);
    expect(await reminders.sweep()).toBe(0);
    // A revised quote is shared again: a new reminder 10 minutes later.
    await moveTo(id, 'QUOTE_SHARED', t.clock.now(), tech.id);
    t.clock.t += 10 * MIN;
    expect(await reminders.sweep()).toBe(1);
    expect(await kinds(customer.id)).toEqual([
      { kind: 'QUOTE_REMINDER', params: { code } },
      { kind: 'QUOTE_REMINDER', params: { code } },
    ]);
  });

  it('asks for a rating 2 hours after completion, unless already rated', async () => {
    const tech = await createTechnician(t);
    const a = await book();
    const b = await book();
    await moveTo(a.id, 'COMPLETED', t.clock.now(), tech.id);
    await moveTo(b.id, 'COMPLETED', t.clock.now(), tech.id);
    await t.prisma.rating.create({ data: { bookingId: b.id, customerId: customer.id, technicianId: tech.id, satisfied: true, stars: 5, createdAt: new Date(t.clock.now()) } });
    t.clock.t += 119 * MIN;
    expect(await reminders.sweep()).toBe(0);
    t.clock.t += 2 * MIN;
    expect(await reminders.sweep()).toBe(1);
    expect(await kinds(customer.id)).toEqual([{ kind: 'RATE_REMINDER', params: { code: a.code } }]);
  });

  it('tells a technician when their account is suspended, reinstated or rejected', async () => {
    const tech = await createTechnician(t);
    const verification = t.app.get(TechVerificationService);
    const admin = { type: 'ADMIN' as const, id: null, via: 'test' };
    await verification.suspend(tech.id, 'customer complaint', admin);
    await verification.reinstate(tech.id, 'resolved', admin);
    const pending = await createTechnician(t, '9876500012', { approve: false });
    await verification.reject(pending.id, 'documents do not match', admin);
    expect((await kinds(tech.id)).map((n) => n.kind)).toEqual(['PROFILE_APPROVED', 'PROFILE_SUSPENDED', 'PROFILE_REINSTATED']);
    expect((await kinds(pending.id)).map((n) => n.kind)).toEqual(['PROFILE_REJECTED']);
  });
});
