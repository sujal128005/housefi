// GET /v1/slots end to end. The test clock starts at 2026-10-16 12:00 IST (06:30 UTC).
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { buildTestApp, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

describe('slots (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  let token: string;

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
    token = (await signIn(t)).accessToken;
  });

  afterAll(async () => {
    await t?.close();
  });

  const slots = (query: string) => http().get(`/v1/slots?${query}`).set('Authorization', `Bearer ${token}`);
  const states = (body: { state: string }[]) => body.map((s) => s.state);

  it('needs a customer token', async () => {
    await http().get('/v1/slots?serviceId=plumb-tap&date=2026-10-17').expect(401);
  });

  it("closes today's past windows and those starting within 60 minutes", async () => {
    const res = await slots('serviceId=plumb-tap&date=2026-10-16').expect(200);
    expect(res.body).toEqual([
      { id: '2026-10-16@8', date: '2026-10-16', startHour: 8, endHour: 10, state: 'CLOSED' },
      { id: '2026-10-16@10', date: '2026-10-16', startHour: 10, endHour: 12, state: 'CLOSED' },
      { id: '2026-10-16@12', date: '2026-10-16', startHour: 12, endHour: 14, state: 'CLOSED' },
      { id: '2026-10-16@14', date: '2026-10-16', startHour: 14, endHour: 16, state: 'OPEN' },
      { id: '2026-10-16@16', date: '2026-10-16', startHour: 16, endHour: 18, state: 'OPEN' },
      { id: '2026-10-16@18', date: '2026-10-16', startHour: 18, endHour: 20, state: 'OPEN' },
    ]);
  });

  it('offers 7 days: day 7 open, day 8 and the past closed', async () => {
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-22').expect(200)).body)).toEqual(Array(6).fill('OPEN'));
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-23').expect(200)).body)).toEqual(Array(6).fill('CLOSED'));
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-15').expect(200)).body)).toEqual(Array(6).fill('CLOSED'));
  });

  it('follows India time: just after 18:30 UTC it is already tomorrow in IST', async () => {
    t.clock.t = Date.UTC(2026, 9, 16, 18, 31); // 00:01 IST on the 17th
    token = (await signIn(t, '9876500033')).accessToken; // the earlier access token has expired by now
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-16').expect(200)).body)).toEqual(Array(6).fill('CLOSED'));
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-23').expect(200)).body)).toEqual(Array(6).fill('OPEN'));
  });

  it('marks windows FULL where an area has no capacity for the category', async () => {
    await t.prisma.slotCapacity.create({ data: { categoryId: 'PLUMBING', pincode: '500034', maxPerWindow: 0 } });
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-17&pincode=500034').expect(200)).body)).toEqual(Array(6).fill('FULL'));
    // Other areas, other categories and requests without a PIN use the default capacity.
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-17&pincode=500002').expect(200)).body)).toEqual(Array(6).fill('OPEN'));
    expect(states((await slots('serviceId=elec-fan&date=2026-10-17&pincode=500034').expect(200)).body)).toEqual(Array(6).fill('OPEN'));
    expect(states((await slots('serviceId=plumb-tap&date=2026-10-17').expect(200)).body)).toEqual(Array(6).fill('OPEN'));
  });

  it('rejects bad queries and unknown services', async () => {
    const bad = await slots('serviceId=plumb-tap&date=2026-02-30&pincode=0123').expect(422);
    expect(bad.body.error.fields).toEqual({ date: 'INVALID', pincode: 'INVALID' });
    const missing = await slots('date=2026-10-17').expect(422);
    expect(missing.body.error.fields).toEqual({ serviceId: 'REQUIRED' });
    await slots('serviceId=garden-hose&date=2026-10-17').expect(404);
  });
});
