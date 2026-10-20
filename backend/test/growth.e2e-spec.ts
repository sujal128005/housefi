// Growth features: services and prices edited in Housefi HQ (the seed never overwrites them), coupons on the final
// bill, invoices (PDF behind a signed link), the 15-day free warranty revisit, announcements, and the parts price list
// in quotes and the price check.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { runAdminCommand } from '../src/cli/admin';
import { AuditService } from '../src/common/audit/audit.module';
import { FieldCipher } from '../src/common/crypto/field-cipher';
import { Hashing } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import { seedParts } from '../src/modules/parts/parts.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';

const HOST = 'hq-test1234.housefi.tech';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const HOME = { label: 'HOME', house: 'Flat 4B, Lake View', street: 'Road No. 12, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034', lat: 17.4126, lng: 78.4482 };
const QUOTE = { which: 'MAIN', diagnosis: 'Worn-out washer and a loose joint under the sink.', lines: [{ kind: 'LABOUR', name: 'Repair labour', qty: 1, unitPrice: 300 }, { kind: 'MATERIAL', name: 'Washer and sealant', qty: 1, unitPrice: 200 }] };
const DAY = 86_400_000;

// Whole journeys (booking to bill to invoice) take a few seconds each.
jest.setTimeout(30_000);

describe('growth: catalogue, coupons, invoices, warranty, announcements, parts (e2e)', () => {
  let t: TestApp;
  let cookie: string;
  let customer: { id: string; token: string };
  let tech: { id: string; token: string };
  let id: string;

  const app = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = {
    get: (path: string) => app().get(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('Cookie', cookie),
    post: (path: string, body: object = {}) => app().post(`/v1/admin${path}`).set('Host', HOST).set('User-Agent', LAPTOP).set('x-housefi-admin', '1').set('Cookie', cookie).send(body),
  };
  const act = (action: string, body: object = {}, jobId = id) => app().post(`/v1/tech/jobs/${jobId}/${action}`).set(as(tech.token)).send(body);
  const booking = async (bid = id) => (await app().get(`/v1/bookings/${bid}`).set(as(customer.token)).expect(200)).body;
  const startCode = async (bid = id) => t.app.get(FieldCipher).decrypt('bookings.arrival_code', (await t.prisma.booking.findUniqueOrThrow({ where: { id: bid } })).arrivalCodeEnc);

  async function adminSession(): Promise<string> {
    const out = await runAdminCommand(['create', 'Sujal Negi', '9876500099'], { prisma: t.app.get(PrismaService), cipher: t.app.get(FieldCipher), hashing: t.app.get(Hashing), audit: t.app.get(AuditService), clock: t.clock, via: 'cli:test' });
    const username = /username: (\S+)/.exec(out.join('\n'))![1]!;
    const admin = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
    const token = randomBytes(32).toString('base64url');
    const now = new Date(t.clock.now());
    await t.prisma.adminSession.create({ data: { adminId: admin.id, tokenHash: new Uint8Array(createHash('sha256').update(token).digest()), stage: 'VERIFIED', ip: '1.2.3.4', userAgent: LAPTOP, createdAt: now, lastSeenAt: now, expiresAt: new Date(t.clock.now() + 8 * 3_600_000) } });
    return `hf_admin=${token}`;
  }

  /** A paid booking, offered to and accepted by `tech`. */
  async function assigned(): Promise<string> {
    const addressId = (await app().post('/v1/addresses').set(as(customer.token)).send(HOME).expect(201)).body.id;
    const body = { serviceId: 'plumb-tap', problem: { issueIds: ['tap-leak'], notes: '', voiceNote: null, photos: [] }, addressId, time: { mode: 'INSTANT', window: null }, preferWomenRated: false };
    const bid = (await app().post('/v1/bookings').set(as(customer.token)).set('Idempotency-Key', randomUUID()).send(body).expect(201)).body.id as string;
    await t.prisma.booking.update({ where: { id: bid }, data: { status: 'MATCHING', matchingStartedAt: new Date(t.clock.now()) } });
    await t.prisma.payment.updateMany({ where: { bookingId: bid }, data: { state: 'PAID', provider: 'RAZORPAY', method: 'UPI', providerPaymentId: `pay_${bid.slice(0, 8)}`, settledAt: new Date(t.clock.now()) } });
    await t.app.get(DispatchService).offerNext(bid);
    const offer = (await app().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
    await app().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
    return bid;
  }

  async function atTheDoor(bid = id) {
    await act('start-trip', {}, bid).expect(200);
    await act('arrived', {}, bid).expect(200);
    await act('verify-start-code', { code: await startCode(bid) }, bid).expect(200);
  }

  /** The bill is due (quote approved, work done). */
  async function billDue(quote: object = QUOTE) {
    await atTheDoor();
    await act('quotes', quote).expect(200);
    await app().post(`/v1/bookings/${id}/quotes/MAIN/answer`).set(as(customer.token)).send({ answer: 'APPROVE' }).expect(200);
    await act('start-work').expect(200);
    await act('complete').expect(200);
  }

  async function paidInCash() {
    await app().post(`/v1/bookings/${id}/payments`).set(as(customer.token)).set('Idempotency-Key', randomUUID()).send({ kind: 'FINAL', method: 'CASH' }).expect(200);
    await act('confirm-cash').expect(200);
  }

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { ADMIN_HOST: HOST, ADMIN_RECOVERY_CODE: '482915' } });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.adminUser.deleteMany();
    await t.prisma.$executeRawUnsafe('TRUNCATE parts, coupons, coupon_redemptions, invoices, announcements CASCADE');
    await seedCatalog(t.prisma);
    await seedParts(t.prisma);
    t.rateLimits.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    cookie = await adminSession();
    const c = await signIn(t, '9876543210');
    customer = { id: c.customer!.id, token: c.accessToken };
    await app().patch('/v1/me').set(as(customer.token)).send({ name: 'Ravi Kumar' }).expect(200);
    tech = await createTechnician(t);
    await app().post('/v1/tech/availability').set(as(tech.token)).send({ online: true }).expect(200);
    id = await assigned();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('services and prices in HQ', () => {
    it('changes a price and the problems; the app sees it, and the catalogue seed keeps it', async () => {
      const services = (await hq.get('/services').expect(200)).body;
      const tap = services.find((s: { id: string }) => s.id === 'plumb-tap');
      const edited = { ...tap, visitFee: 59, repairFrom: 199, issues: [...tap.issues, { name: { en: 'Low water pressure', te: '' } }] };
      for (const k of ['id', 'bookings', 'editedInHq', 'sort']) delete edited[k];
      const saved = (await hq.post('/services/plumb-tap', edited).expect(200)).body;
      expect(saved).toMatchObject({ visitFee: 59, repairFrom: 199, editedInHq: true });
      expect(saved.issues.at(-1)).toMatchObject({ id: 'plumb-tap-low-water-pressure', name: { en: 'Low water pressure', te: 'Low water pressure' } });

      const fromApp = (await app().get('/v1/catalog/services/plumb-tap').expect(200)).body;
      expect(fromApp).toMatchObject({ visitFee: 59, repairFrom: 199 });
      await seedCatalog(t.prisma);
      expect((await app().get('/v1/catalog/services/plumb-tap').expect(200)).body.visitFee).toBe(59);
      expect(await t.prisma.auditLog.count({ where: { action: 'catalog.service_update' } })).toBe(1);
    });

    it('adds a new service that the seed leaves alone, and hides one', async () => {
      const made = (await hq.post('/services', {
        categoryId: 'PLUMBING', name: { en: 'Water tank cleaning', te: 'వాటర్ ట్యాంక్ క్లీనింగ్' }, description: { en: 'Overhead tank cleaned and disinfected', te: '' },
        visitFee: 49, repairFrom: 499, repairTypicalMax: 1500, durationMin: 60, durationMax: 120, popular: false, active: true, keywords: ['tank'], issues: [{ name: { en: 'Dirty water', te: '' } }],
      }).expect(201)).body;
      expect(made.id).toBe('plumb-water-tank-cleaning');
      await seedCatalog(t.prisma);
      expect((await app().get(`/v1/catalog/services/${made.id}`).expect(200)).body.name.en).toBe('Water tank cleaning');
      const hide = { categoryId: 'PLUMBING', name: made.name, description: made.description, visitFee: 49, repairFrom: 499, repairTypicalMax: 1500, durationMin: 60, durationMax: 120, popular: false, active: false, keywords: [], issues: made.issues };
      await hq.post(`/services/${made.id}`, hide).expect(200);
      expect((await app().get('/v1/catalog/services?categoryId=PLUMBING').expect(200)).body.map((s: { id: string }) => s.id)).not.toContain(made.id);
    });
  });

  describe('coupons', () => {
    it('takes ₹50 off the bill once per customer; Housefi pays it, the technician earns the same', async () => {
      await hq.post('/coupons', { code: 'first50', kind: 'FLAT', value: 50, firstBookingOnly: true }).expect(204);
      await billDue();
      expect((await booking()).finalPayment).toMatchObject({ amount: 500, discount: 0 });

      const bad = (await app().post(`/v1/bookings/${id}/coupon`).set(as(customer.token)).send({ code: 'NOPE' }).expect(200)).body;
      expect(bad).toMatchObject({ applied: false, problem: 'UNKNOWN' });
      const r = (await app().post(`/v1/bookings/${id}/coupon`).set(as(customer.token)).send({ code: ' First50 ' }).expect(200)).body;
      expect(r).toMatchObject({ applied: true, problem: null, discount: 50 });
      expect(r.booking.finalPayment).toMatchObject({ amount: 450, discount: 50, couponCode: 'FIRST50' });

      // Off and on again.
      expect((await app().delete(`/v1/bookings/${id}/coupon`).set(as(customer.token)).expect(200)).body.finalPayment).toMatchObject({ amount: 500, discount: 0, couponCode: null });
      await app().post(`/v1/bookings/${id}/coupon`).set(as(customer.token)).send({ code: 'FIRST50' }).expect(200);

      // The technician collects ₹450 in cash; their earnings still come from the ₹500 quote.
      expect((await app().get(`/v1/tech/jobs/${id}`).set(as(tech.token)).expect(200)).body.finalPayment.amount).toBe(450);
      await paidInCash();
      const ledger = await t.prisma.earningsLedger.findMany({ where: { bookingId: id } });
      expect(ledger.find((l) => l.type === 'CASH_COLLECTED')?.amountPaise).toBe(-45_000n);
      expect(ledger.find((l) => l.type === 'MATERIAL_REIMBURSE')?.amountPaise).toBe(20_000n);
      await app().post(`/v1/bookings/${id}/coupon`).set(as(customer.token)).send({ code: 'FIRST50' }).expect(409);

      // Once per customer, and first booking only.
      t.rateLimits.clear();
      id = await assigned();
      await billDue();
      expect((await app().post(`/v1/bookings/${id}/coupon`).set(as(customer.token)).send({ code: 'FIRST50' }).expect(200)).body.problem).toBe('ALREADY_USED');
      const list = (await hq.get('/coupons').expect(200)).body;
      expect(list[0]).toMatchObject({ code: 'FIRST50', uses: 1, discountGiven: 50 });
    });

    it('checks dates, switching off, limits, percent caps and the minimum bill', async () => {
      await billDue();
      await hq.post('/coupons', { code: 'DIWALI20', kind: 'PERCENT', value: 20, maxDiscount: 80, minBill: 300, validTo: t.clock.now() + DAY }).expect(204);
      await hq.post('/coupons', { code: 'BIGBILL', kind: 'FLAT', value: 100, minBill: 1000 }).expect(204);
      await hq.post('/coupons', { code: 'OFF', kind: 'FLAT', value: 10, active: false }).expect(204);
      await hq.post('/coupons', { code: 'DIWALI20', kind: 'FLAT', value: 10 }).expect(409);
      await hq.post('/coupons', { code: 'X', kind: 'PERCENT', value: 150 }).expect(422);
      const tryCode = async (code: string) => (await app().post(`/v1/bookings/${id}/coupon`).set(as(customer.token)).send({ code }).expect(200)).body;
      expect((await tryCode('OFF')).problem).toBe('INACTIVE');
      expect((await tryCode('BIGBILL')).problem).toBe('BILL_TOO_SMALL');
      // 20% of ₹500 = ₹100, capped at ₹80.
      expect((await tryCode('DIWALI20')).booking.finalPayment).toMatchObject({ amount: 420, discount: 80 });
      t.clock.t += 2 * DAY;
      t.rateLimits.clear();
      customer.token = (await signIn(t, '9876543210')).accessToken;
      expect((await tryCode('DIWALI20')).problem).toBe('EXPIRED');
    });
  });

  describe('invoices', () => {
    it('gives a numbered PDF behind a short-lived signed link, with the coupon on it', async () => {
      await hq.post('/coupons', { code: 'FIRST50', kind: 'FLAT', value: 50 }).expect(204);
      await app().post(`/v1/bookings/${id}/invoice-link`).set(as(customer.token)).expect(409);
      await billDue();
      await app().post(`/v1/bookings/${id}/coupon`).set(as(customer.token)).send({ code: 'FIRST50' }).expect(200);
      await paidInCash();

      const link = (await app().post(`/v1/bookings/${id}/invoice-link`).set(as(customer.token)).expect(200)).body;
      expect(link.path).toMatch(/^\/invoices\/[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]+$/);
      const pdf = await app().get(`/v1${link.path}`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      const data = await t.app.get(InvoicesService).data(id);
      expect(data.number).toBe('HFI/2026-27/000001');
      expect(data.customer.name).toBe('Ravi Kumar');
      expect(data.lines.map((l) => [l.label, l.amount])).toEqual([['Visit and inspection fee', 49], ['Repair labour', 300], ['Washer and sealant', 200]]);
      expect(data).toMatchObject({ subtotal: 549, discount: { code: 'FIRST50', amount: 50 }, total: 499, paid: 499 });
      expect(data.warrantyUntil).toBeGreaterThan(t.clock.now());
      // Same number every time.
      expect((await t.app.get(InvoicesService).data(id)).number).toBe('HFI/2026-27/000001');

      // A changed or expired link opens nothing.
      await app().get(`/v1${link.path.slice(0, -2)}xx`).expect(404);
      t.clock.t += 16 * 60_000;
      await app().get(`/v1${link.path}`).expect(404);
      // HQ downloads it too.
      const fromHq = await hq.get(`/bookings/${id}/invoice`).expect(200);
      expect(fromHq.headers['content-type']).toBe('application/pdf');
    });
  });

  describe('warranty revisit', () => {
    async function completed() {
      await billDue();
      await paidInCash();
    }

    it('books a free, priority revisit with the same technician first, within 15 days, once', async () => {
      await app().post(`/v1/bookings/${id}/warranty`).set(as(customer.token)).send({}).expect(409);
      await completed();
      const done = await booking();
      expect(done.warrantyUntil).toBe(t.clock.now() + 15 * DAY);
      expect(done.warrantyClaim).toBeNull();

      const revisit = (await app().post(`/v1/bookings/${id}/warranty`).set(as(customer.token)).send({ note: 'Still dripping' }).expect(201)).body;
      expect(revisit).toMatchObject({ status: 'MATCHING', warrantyOf: done.code, visitPayment: { state: 'PAID' } });
      expect(revisit.problem.notes).toBe(`Warranty revisit of ${done.code}: Still dripping`);
      const row = await t.prisma.booking.findUniqueOrThrow({ where: { id: revisit.id }, include: { payments: true } });
      expect(row).toMatchObject({ priority: true, preferredTechnicianId: tech.id });
      expect(row.payments[0]).toMatchObject({ provider: 'WAIVED', state: 'PAID' });
      // Offered first to the same technician, who accepts.
      const offer = (await app().get('/v1/tech/offers/current').set(as(tech.token)).expect(200)).body;
      expect(offer.bookingId ?? offer.jobId ?? offer.id).toBeTruthy();
      await app().post(`/v1/tech/offers/${offer.id}/accept`).set(as(tech.token)).expect(200);
      expect((await booking()).warrantyClaim).toEqual({ id: revisit.id, code: revisit.code });
      // Asking again returns the same revisit; a revisit has no revisit of its own.
      expect((await app().post(`/v1/bookings/${id}/warranty`).set(as(customer.token)).send({}).expect(201)).body.id).toBe(revisit.id);

      // The technician fixes it at no charge.
      const job = (await app().get(`/v1/tech/jobs/${revisit.id}`).set(as(tech.token)).expect(200)).body;
      expect(job.warrantyOf).toBe(done.code);
      await act('warranty-fixed', {}, revisit.id).expect(409);
      await atTheDoor(revisit.id);
      expect((await act('warranty-fixed', {}, revisit.id).expect(200)).body.status).toBe('COMPLETED');
      expect((await booking(revisit.id)).warrantyUntil).toBeNull();
      await app().post(`/v1/bookings/${revisit.id}/warranty`).set(as(customer.token)).send({}).expect(409);
    });

    it('ends after 15 days, and is not for ordinary jobs', async () => {
      await completed();
      t.clock.t += 16 * DAY;
      t.rateLimits.clear();
      customer.token = (await signIn(t, '9876543210')).accessToken;
      tech.token = (await signIn(t, '9876500011', 'TECHNICIAN')).accessToken;
      await app().post(`/v1/bookings/${id}/warranty`).set(as(customer.token)).send({}).expect(409);
      const other = await assigned();
      await atTheDoor(other);
      await act('warranty-fixed', {}, other).expect(409);
    });
  });

  describe('announcements', () => {
    it('reaches everyone in the audience with the words in both languages', async () => {
      const r = (await hq.post('/announcements', { audience: 'CUSTOMERS', title: { en: 'Heavy rain today', te: 'ఈరోజు భారీ వర్షం' }, body: { en: 'Technicians may be late. Thank you for your patience.', te: '' } }).expect(200)).body;
      expect(r.recipients).toBe(1);
      const notes = await t.prisma.notification.findMany({ where: { kind: 'ANNOUNCEMENT' } });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ userId: customer.id, params: { title: 'Heavy rain today', titleTe: 'ఈరోజు భారీ వర్షం', bodyTe: 'Technicians may be late. Thank you for your patience.' } });
      t.clock.t += 60_000;
      expect((await hq.post('/announcements', { audience: 'TECHNICIANS', title: { en: 'Festival bonus', te: '' }, body: { en: 'Extra ₹100 per job this week', te: '' } }).expect(200)).body.recipients).toBe(1);
      t.clock.t += 60_000;
      expect((await hq.post('/announcements', { audience: 'DEMO', title: { en: 'Test', te: '' }, body: { en: 'Only demo accounts', te: '' } }).expect(200)).body.recipients).toBe(0);
      await hq.post('/announcements', { audience: 'ALL', title: { en: 'x', te: '' }, body: { en: 'too short title', te: '' } }).expect(422);
      expect((await hq.get('/announcements').expect(200)).body.map((a: { title: string }) => a.title)).toEqual(['Test', 'Festival bonus', 'Heavy rain today']);
    });
  });

  describe('parts price list', () => {
    it('lists parts for the job; listed parts at their price pass the price check', async () => {
      await atTheDoor();
      const parts = (await app().get(`/v1/tech/jobs/${id}/parts`).set(as(tech.token)).expect(200)).body;
      expect(parts.length).toBeGreaterThan(5);
      expect(parts.every((p: { categoryId: string }) => p.categoryId === 'PLUMBING')).toBe(true);
      const tap = parts.find((p: { name: { en: string } }) => p.name.en === 'Tap (CP brass)');
      // Four new taps at the listed price: far above plumb-tap's usual range, but fair.
      const quote = { which: 'MAIN', diagnosis: 'All four taps are cracked.', lines: [{ kind: 'LABOUR', name: 'Fitting', qty: 1, unitPrice: 300 }, { kind: 'MATERIAL', name: tap.name.en, qty: 4, unitPrice: tap.price, partId: tap.id }] };
      expect((await act('quotes', quote).expect(200)).body.quote.review.state).toBe('FAIR');
      expect((await t.prisma.quoteLine.findFirstOrThrow({ where: { kind: 'MATERIAL' } })).partId).toBe(tap.id);

      // HQ changes the price; a part from another trade is refused.
      await hq.post(`/parts/${tap.id}`, { categoryId: 'PLUMBING', serviceId: null, name: tap.name, unit: 'piece', price: 700, active: true, sort: 1 }).expect(204);
      expect((await hq.get('/parts').expect(200)).body.find((p: { id: string }) => p.id === tap.id)).toMatchObject({ price: 700, used: 1 });
      const elec = (await t.prisma.part.findFirstOrThrow({ where: { categoryId: 'ELECTRICAL' } })).id;
      await app().post(`/v1/bookings/${id}/quotes/MAIN/answer`).set(as(customer.token)).send({ answer: 'REVISION' }).expect(200);
      await act('quotes', { ...quote, lines: [quote.lines[0], { ...quote.lines[1], partId: elec }] }).expect(422);
    });

    it('sends the same quote without listed parts to review', async () => {
      await atTheDoor();
      const quote = { which: 'MAIN', diagnosis: 'All four taps are cracked.', lines: [{ kind: 'LABOUR', name: 'Fitting', qty: 1, unitPrice: 300 }, { kind: 'MATERIAL', name: 'Tap', qty: 4, unitPrice: 650 }] };
      expect((await act('quotes', quote).expect(200)).body.quote.review.state).toBe('UNDER_REVIEW');
    });
  });
});
