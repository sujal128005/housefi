import data from './catalog.data.json';
import { CatalogData } from './catalog.seed';

describe('catalog.data.json (imported from the app)', () => {
  const parsed = CatalogData.parse(data);

  it('has the 6 categories, 21 services and 74 issues of the app catalog', () => {
    expect(parsed.categories.map((c) => c.id)).toEqual(['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY']);
    expect(parsed.services).toHaveLength(21);
    expect(parsed.services.reduce((n, s) => n + s.issues.length, 0)).toBe(74);
  });

  it('uses the ₹49 visit fee everywhere and a repair minimum of at least ₹100', () => {
    for (const s of parsed.services) {
      expect(s.visitFee).toBe(49);
      expect(s.repairFrom).toBeGreaterThanOrEqual(100);
    }
  });

  it('contains every issue id the app uses for top problems and quick picks', () => {
    const issueIds = new Set(parsed.services.flatMap((s) => s.issues.map((i) => i.id)));
    for (const id of ['tap-leak', 'fan-dead', 'acs-cool', 'blk-sink', 'sw-dead', 'wm-drain']) expect(issueIds).toContain(id);
  });

  it('rejects duplicate ids', () => {
    const dup = { ...data, services: [...data.services, data.services[0]] };
    expect(CatalogData.safeParse(dup).success).toBe(false);
  });
});
