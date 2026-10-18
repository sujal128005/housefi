// Catalog end to end: seeded from catalog.data.json (the app's catalog), served publicly in the app's shapes.
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import data from '../src/modules/catalog/catalog.data.json';
import { buildTestApp, requireTestDatabase, resetDatabase, type TestApp } from './helpers';

describe('catalog (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.rateLimits.clear();
    await seedCatalog(t.prisma);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('serves the categories exactly as the app defines them, in order, without a token', async () => {
    const res = await http().get('/v1/catalog/categories').expect(200);
    expect(res.body).toEqual(data.categories);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('serves all 21 services in the app shape (Telugu included)', async () => {
    const res = await http().get('/v1/catalog/services').expect(200);
    expect(res.body).toHaveLength(21);
    expect(res.body).toEqual(data.services);
    expect(res.body[0].name.te).toBe('కుళాయి & మిక్సర్ రిపేర్');
  });

  it('filters services by category', async () => {
    const res = await http().get('/v1/catalog/services?categoryId=AC').expect(200);
    expect(res.body.map((s: { id: string }) => s.id)).toEqual(['ac-service', 'ac-repair', 'ac-install']);
  });

  it('rejects an unknown category filter', async () => {
    const res = await http().get('/v1/catalog/services?categoryId=GARDEN').expect(422);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION', fields: { categoryId: 'INVALID' } });
  });

  it('serves one service with its issues in order', async () => {
    const res = await http().get('/v1/catalog/services/plumb-tap').expect(200);
    expect(res.body).toMatchObject({ id: 'plumb-tap', visitFee: 49, repairFrom: 149, durationMin: [30, 60], popular: true });
    expect(res.body.issues.map((i: { id: string }) => i.id)).toEqual(['tap-leak', 'tap-flow', 'tap-loose', 'tap-handle']);
  });

  it('is NOT_FOUND for unknown or malformed service ids', async () => {
    for (const id of ['garden-hose', 'DROP%20TABLE']) {
      const res = await http().get(`/v1/catalog/services/${id}`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('stores money in paise and sets the typical maximum to 4x repairFrom (internal, not served)', async () => {
    const svc = await t.prisma.service.findUniqueOrThrow({ where: { id: 'plumb-tap' } });
    expect([svc.visitFeePaise, svc.repairFromPaise, svc.repairTypicalMaxPaise]).toEqual([4900n, 14900n, 59600n]);
    const res = await http().get('/v1/catalog/services/plumb-tap').expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/typical/i);
  });

  it('re-seeding is idempotent', async () => {
    const again = await seedCatalog(t.prisma);
    expect(again).toEqual({ categories: 6, services: 21, issues: 74, deactivated: [] });
    expect(await t.prisma.service.count()).toBe(21);
    expect(await t.prisma.serviceIssue.count()).toBe(74);
  });

  it('deactivates (never deletes) services removed from the catalog, and applies edits', async () => {
    const edited = {
      ...data,
      services: data.services
        .filter((s) => s.id !== 'carp-install')
        .map((s) => (s.id === 'plumb-tap' ? { ...s, repairFrom: 199, issues: s.issues.slice(0, 2) } : s)),
    };
    const result = await seedCatalog(t.prisma, edited);
    expect(result.deactivated).toEqual(['carp-install']);
    expect(await t.prisma.service.findUnique({ where: { id: 'carp-install' } })).toMatchObject({ active: false });
    await http().get('/v1/catalog/services/carp-install').expect(404);
    const tap = await http().get('/v1/catalog/services/plumb-tap').expect(200);
    expect(tap.body.repairFrom).toBe(199);
    expect(tap.body.issues).toHaveLength(2);
    // Putting it back reactivates it.
    await seedCatalog(t.prisma);
    await http().get('/v1/catalog/services/carp-install').expect(200);
  });

  it('refuses invalid catalog data before touching the database', async () => {
    const broken = { ...data, services: [{ ...data.services[0], visitFee: -1 }] };
    await expect(seedCatalog(t.prisma, broken)).rejects.toThrow();
    expect(await t.prisma.service.count()).toBe(21);
  });
});
