// Payout details (technician app) and the weekly bank files (Housefi HQ), built on the payout kit.
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { runAdminCommand } from '../src/cli/admin';
import { AuditService } from '../src/common/audit/audit.module';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { Hashing } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const HOST = 'hq-test1234.housefi.tech';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const BANK = { rail: 'BANK', holderName: '  Swathi   Naidu ', accountNumber: '98765432101', ifsc: 'sbin0001234' };
const UPI = { rail: 'UPI', holderName: 'Ravi Kumar', upiId: 'ravi.k@okicici' };
const DAY = 86_400_000;

jest.setTimeout(30_000);

describe('payout details and bank files (e2e)', () => {
  let t: TestApp;
  let cookie: string;
  let tech: { id: string; token: string };

  const app = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = (path: string) => app().post(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').set('Cookie', cookie).send({});
  const payout = (technicianId: string, amountPaise: bigint) =>
    t.prisma.payout.create({ data: { technicianId, periodStart: new Date('2026-10-12T00:00:00Z'), periodEnd: new Date('2026-10-18T00:00:00Z'), amountPaise, createdAt: new Date(t.clock.now()) } });

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { ADMIN_HOST: HOST, ADMIN_RECOVERY_CODE: '482915' } });
    await t.prisma.adminSession.deleteMany();
    await t.prisma.adminUser.deleteMany();
    const out = await runAdminCommand(['create', 'Sujal Negi', '9876500099'], { prisma: t.app.get(PrismaService), cipher: t.app.get(FieldCipher), hashing: t.app.get(Hashing), audit: t.app.get(AuditService), clock: t.clock, via: 'cli:test' });
    const admin = await t.prisma.adminUser.findUniqueOrThrow({ where: { username: /username: (\S+)/.exec(out.join('\n'))![1]! } });
    const token = randomBytes(32).toString('base64url');
    const now = new Date(t.clock.now());
    await t.prisma.adminSession.create({ data: { adminId: admin.id, tokenHash: new Uint8Array(createHash('sha256').update(token).digest()), stage: 'VERIFIED', ip: '1.2.3.4', userAgent: LAPTOP, createdAt: now, lastSeenAt: now, expiresAt: new Date(t.clock.now() + 365 * DAY) } });
    cookie = `hf_admin=${token}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.rateLimits.clear();
    tech = await createTechnician(t);
  });

  describe('GET / PUT /v1/tech/payout-account', () => {
    it('saves a bank account tidied and encrypted, and shows it back masked', async () => {
      expect((await app().get('/v1/tech/payout-account').set(as(tech.token)).expect(200)).body).toBeNull();
      const saved = (await app().put('/v1/tech/payout-account').set(as(tech.token)).send(BANK).expect(200)).body;
      expect(saved).toEqual({ rail: 'BANK', holderName: 'Swathi Naidu', hint: 'XXXXXXX2101 · SBIN0001234', updatedAt: t.clock.now() });
      expect((await app().get('/v1/tech/payout-account').set(as(tech.token)).expect(200)).body).toEqual(saved);

      const row = await t.prisma.technicianPayoutAccount.findUniqueOrThrow({ where: { technicianId: tech.id } });
      expect(Buffer.from(row.accountNumberEnc!).toString('latin1')).not.toContain('98765432101');
      expect(row.ifsc).toBe('SBIN0001234');
      expect(await t.app.get(FieldCipher).decrypt('payout_accounts.account_number', row.accountNumberEnc!)).toBe('98765432101');
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'payout_account.set' } });
      expect(audit.after).toEqual({ rail: 'BANK', hint: 'XXXXXXX2101 · SBIN0001234' });
    });

    it('refuses wrong details, naming the fields', async () => {
      const res = await app().put('/v1/tech/payout-account').set(as(tech.token)).send({ ...BANK, accountNumber: '12', ifsc: 'NOPE' }).expect(422);
      expect(res.body.error.fields).toEqual({ accountNumber: 'INVALID', ifsc: 'INVALID' });
      await app().put('/v1/tech/payout-account').set(as(tech.token)).send({ ...UPI, upiId: 'ravi k@okicici' }).expect(422);
      await app().put('/v1/tech/payout-account').set(as(tech.token)).send({ ...UPI, accountNumber: '98765432101' }).expect(422);
      expect(await t.prisma.technicianPayoutAccount.count()).toBe(0);
    });

    it('switches from a bank account to UPI, keeping the old hint in the audit log', async () => {
      await app().put('/v1/tech/payout-account').set(as(tech.token)).send(BANK).expect(200);
      const saved = (await app().put('/v1/tech/payout-account').set(as(tech.token)).send(UPI).expect(200)).body;
      expect(saved).toMatchObject({ rail: 'UPI', holderName: 'Ravi Kumar', hint: 'r*****@okicici' });
      const row = await t.prisma.technicianPayoutAccount.findUniqueOrThrow({ where: { technicianId: tech.id } });
      expect([row.accountNumberEnc, row.ifsc]).toEqual([null, null]);
      const audits = await t.prisma.auditLog.findMany({ where: { action: 'payout_account.set' }, orderBy: { id: 'asc' } });
      expect(audits[1]?.before).toEqual({ rail: 'BANK', hint: 'XXXXXXX2101 · SBIN0001234' });
    });

    it('is for technicians only', async () => {
      const customer = await signIn(t, '9876543210', 'CUSTOMER');
      await app().get('/v1/tech/payout-account').set(as(customer.accessToken)).expect(404);
      await app().put('/v1/tech/payout-account').send(BANK).expect(401);
    });

    it('goes when the technician deletes their account', async () => {
      await app().put('/v1/tech/payout-account').set(as(tech.token)).send(BANK).expect(200);
      await app().delete('/v1/me').set(as(tech.token)).expect(204);
      expect(await t.prisma.technicianPayoutAccount.count()).toBe(0);
    });
  });

  describe('POST /v1/admin/payouts/bank-files', () => {
    it('makes one file per method, leaves out who has no details, and flags recent changes', async () => {
      const ravi = await createTechnician(t, '9876500012', { profile: { name: 'Ravi Kumar' } });
      const kiran = await createTechnician(t, '9876500013', { profile: { name: 'Kiran Rao' } });
      await app().put('/v1/tech/payout-account').set(as(tech.token)).send(BANK).expect(200);
      await app().put('/v1/tech/payout-account').set(as(ravi.token)).send(UPI).expect(200);
      // Swathi's details are old; Ravi changed his just now.
      await t.prisma.technicianPayoutAccount.update({ where: { technicianId: tech.id }, data: { updatedAt: new Date(t.clock.now() - 3 * DAY) } });
      const p1 = await payout(tech.id, 450050n);
      await payout(ravi.id, 320000n);
      const p3 = await payout(kiran.id, 100000n);

      const res = (await hq('/payouts/bank-files').expect(200)).body;
      expect(res.weekEnding).toBe('2026-10-18');
      expect(res.files).toEqual([
        { filename: 'housefi-payouts-2026-10-18-neft.csv', rail: 'BANK', count: 1, amount: 4500.5, content: expect.any(String) },
        { filename: 'housefi-payouts-2026-10-18-upi.csv', rail: 'UPI', count: 1, amount: 3200, content: expect.any(String) },
      ]);
      const ref = p1.id.replace(/-/g, '').slice(0, 20).toUpperCase();
      expect(res.files[0].content).toBe(`Beneficiary Name,Account Number,IFSC,Amount (Rs),Reference,Narration\r\nSwathi Naidu,98765432101,SBIN0001234,4500.50,${ref},HOUSEFI WK42\r\n`);
      expect(res.files[1].content).toContain('Ravi Kumar,ravi.k@okicici,3200.00,');
      expect(res.skipped).toEqual([{ payoutId: p3.id, technicianName: 'Kiran Rao', problems: [expect.stringContaining('No payout details yet')] }]);
      expect(res.warnings).toEqual([expect.stringMatching(/^Ravi Kumar changed their payout details on .* \(r\*\*\*\*\*@okicici\): confirm with them by phone/)]);
      expect(res.summary).toContain('Total ready to pay: Rs 7,700.50');
      expect(res.summary).not.toMatch(/98765432101|ravi\.k@/);

      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'payouts.bank_files' } });
      expect(audit.after).toMatchObject({ payouts: 3, inFiles: 2, skipped: 1, warnings: 1 });
      expect(JSON.stringify(audit.after)).not.toMatch(/98765432101|ravi\.k@/);
    });

    it('works with nothing to pay', async () => {
      expect((await hq('/payouts/bank-files').expect(200)).body).toMatchObject({ weekEnding: null, files: [], skipped: [], warnings: [] });
    });

    it('needs a signed-in admin', async () => {
      await app().post('/v1/admin/payouts/bank-files').set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').send({}).expect(401);
    });
  });
});
