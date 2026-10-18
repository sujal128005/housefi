// Addresses end to end: CRUD scoped to the caller, encrypted personal fields, PostGIS location.
import request from 'supertest';
import { MAX_ADDRESSES } from '../src/modules/addresses/addresses.service';
import { buildTestApp, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const HOME = { label: 'HOME', house: ' Flat 4B, Lake View ', street: 'Road No. 12, Banjara Hills', landmark: 'Opp. City Park', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const WORK = { label: 'WORK', house: 'Tower 2, Floor 9', street: 'Charminar Road, Old City', landmark: '', city: 'Hyderabad', pincode: '500002' };

describe('addresses (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  let priya: string;

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.sms.sent.length = 0;
    t.rateLimits.clear();
    priya = (await signIn(t, '9876543210')).accessToken;
  });

  afterAll(async () => {
    await t?.close();
  });

  const create = (token: string, body: object) => http().post('/v1/addresses').set(bearer(token)).send(body);

  it('is for signed-in customers only', async () => {
    await http().get('/v1/addresses').expect(401);
    const tech = await signIn(t, '9876500011', 'TECHNICIAN');
    await http().get('/v1/addresses').set(bearer(tech.accessToken)).expect(404);
  });

  it('creates an address with a GPS point and lists it back exactly', async () => {
    const res = await create(priya, HOME).expect(201);
    expect(res.body).toEqual({ id: expect.any(String), ...HOME, house: 'Flat 4B, Lake View' });
    const list = await http().get('/v1/addresses').set(bearer(priya)).expect(200);
    expect(list.body).toEqual([res.body]);
  });

  it('creates an address without a GPS point (no lat/lng in the response) and keeps an empty landmark', async () => {
    const res = await create(priya, WORK).expect(201);
    expect(res.body).toEqual({ id: expect.any(String), ...WORK });
    expect(res.body).not.toHaveProperty('lat');
  });

  it('encrypts house, street and landmark; keeps city, PIN, locality and a PostGIS point readable', async () => {
    const { body } = await create(priya, HOME).expect(201);
    const row = await t.prisma.address.findUniqueOrThrow({ where: { id: body.id } });
    for (const [col, text] of [[row.houseEnc, 'Flat 4B'], [row.streetEnc, 'Road No. 12'], [row.landmarkEnc!, 'City Park']] as const) {
      expect(Buffer.from(col).toString('latin1')).not.toContain(text);
    }
    expect(row).toMatchObject({ city: 'Hyderabad', pincode: '500034', locality: 'Banjara Hills' });
    const [geo] = await t.prisma.$queryRaw<{ wkt: string; type: string }[]>`
      SELECT ST_AsText(location) AS wkt, GeometryType(location::geometry) AS type FROM addresses WHERE id = ${body.id}::uuid`;
    expect(geo).toEqual({ wkt: 'POINT(78.4482 17.4126)', type: 'POINT' });
  });

  it('stores points dispatch can measure (PostGIS distance in metres)', async () => {
    const a = (await create(priya, HOME).expect(201)).body;
    const b = (await create(priya, { ...WORK, lat: 17.3616, lng: 78.4747 }).expect(201)).body;
    const [d] = await t.prisma.$queryRaw<{ m: number }[]>`
      SELECT ST_Distance(x.location, y.location)::int AS m FROM addresses x, addresses y WHERE x.id = ${a.id}::uuid AND y.id = ${b.id}::uuid`;
    expect(d!.m).toBeGreaterThan(6000);
    expect(d!.m).toBeLessThan(7000);
  });

  it('validates field by field', async () => {
    const res = await create(priya, { ...HOME, house: '', pincode: '12345', lng: undefined }).expect(422);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION', fields: { house: 'REQUIRED', pincode: 'INVALID', lng: 'REQUIRED' } });
  });

  it('replaces an address on PUT (omitting lat/lng clears the point)', async () => {
    const { body } = await create(priya, HOME).expect(201);
    const res = await http().put(`/v1/addresses/${body.id}`).set(bearer(priya)).send({ ...WORK, label: 'OTHER' }).expect(200);
    expect(res.body).toEqual({ id: body.id, ...WORK, label: 'OTHER' });
    expect((await t.prisma.address.findUniqueOrThrow({ where: { id: body.id } })).locality).toBe('Old City');
  });

  it("never shows or changes someone else's address", async () => {
    const { body } = await create(priya, HOME).expect(201);
    const ravi = (await signIn(t, '9876500022')).accessToken;
    expect((await http().get('/v1/addresses').set(bearer(ravi)).expect(200)).body).toEqual([]);
    const put = await http().put(`/v1/addresses/${body.id}`).set(bearer(ravi)).send(WORK).expect(404);
    expect(put.body.error.code).toBe('NOT_FOUND');
    await http().delete(`/v1/addresses/${body.id}`).set(bearer(ravi)).expect(204);
    expect((await http().get('/v1/addresses').set(bearer(priya)).expect(200)).body).toHaveLength(1);
    await http().put('/v1/addresses/not-a-uuid').set(bearer(priya)).send(WORK).expect(404);
  });

  it('deletes by wiping the personal fields and the point', async () => {
    const { body } = await create(priya, HOME).expect(201);
    await http().delete(`/v1/addresses/${body.id}`).set(bearer(priya)).expect(204);
    expect((await http().get('/v1/addresses').set(bearer(priya)).expect(200)).body).toEqual([]);
    const row = await t.prisma.address.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({ deletedAt: expect.any(Date), landmarkEnc: null, locality: '' });
    expect(row.houseEnc).toHaveLength(0);
    const [geo] = await t.prisma.$queryRaw<{ empty: boolean }[]>`SELECT location IS NULL AS empty FROM addresses WHERE id = ${body.id}::uuid`;
    expect(geo!.empty).toBe(true);
    await http().put(`/v1/addresses/${body.id}`).set(bearer(priya)).send(HOME).expect(404);
  });

  it(`allows at most ${MAX_ADDRESSES} saved addresses`, async () => {
    for (let i = 0; i < MAX_ADDRESSES; i++) await create(priya, WORK).expect(201);
    const res = await create(priya, WORK).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('deleting the account wipes every saved address', async () => {
    await create(priya, HOME).expect(201);
    await create(priya, WORK).expect(201);
    await http().delete('/v1/me').set(bearer(priya)).expect(204);
    const rows = await t.prisma.address.findMany();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.deletedAt).not.toBeNull();
      expect(r.houseEnc).toHaveLength(0);
      expect(r.streetEnc).toHaveLength(0);
    }
  });
});
