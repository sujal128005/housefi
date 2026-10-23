// Shared e2e helpers: a test environment with throwaway secrets, a controllable clock, a fake SMS sender, a
// database reset, and an app built exactly like main.ts (src/http.ts).
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import http from 'node:http';
import { AppModule } from '../src/app.module';
import { CLOCK, type Clock } from '../src/common/clock';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { RATE_LIMIT_STORE } from '../src/common/rate-limit/rate-limit.service';
import { MemoryRateLimitStore } from '../src/common/rate-limit/rate-limit.store';
import { type Env, parseEnv } from '../src/config/env';
import { configureApp, createAdapter } from '../src/http';
import { SMS_SENDER, type SmsSender } from '../src/modules/auth/sms';
import { TechVerificationService } from '../src/modules/technicians/tech-verification.service';
import { OBJECT_STORE, ObjectTooLarge, type ObjectStore, uploadKey, verifiedKey } from '../src/common/storage/object-store';
import { PUSH_SENDER, PushUnavailable, type PushMessage, type PushSender, type PushTicket } from '../src/modules/notifications/push-sender';
import { jpegWithGps } from './media-fixtures';
import { RAZORPAY_CLIENT, RazorpayError, type RazorpayClient, type RzpOrder, type RzpPayment, type RzpPaymentStatus, type RzpRefund } from '../src/modules/payments/razorpay.client';

const keys = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** Secrets generated once per test run. */
export const TEST_SECRETS = {
  JWT_PRIVATE_KEY_B64: Buffer.from(keys.privateKey).toString('base64'),
  JWT_PUBLIC_KEY_B64: Buffer.from(keys.publicKey).toString('base64'),
  OTP_PEPPER_B64: randomBytes(32).toString('base64'),
  TOKEN_PEPPER_B64: randomBytes(32).toString('base64'),
  PHONE_HASH_KEY_B64: randomBytes(32).toString('base64'),
  LOCAL_DATA_KEY_B64: randomBytes(32).toString('base64'),
  RAZORPAY_KEY_ID: 'rzp_test_housefi',
  RAZORPAY_KEY_SECRET: randomBytes(16).toString('hex'),
  RAZORPAY_WEBHOOK_SECRET: randomBytes(16).toString('hex'),
};

export function testEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:8081',
    // Most tests approve technicians directly; the Aadhaar gate has its own tests.
    AADHAAR_REQUIRED: 'false',
    // Likewise the skill check (an approval verifies the trades); test/skills.e2e-spec.ts switches it on.
    SKILL_CHECK_REQUIRED: 'false',
    // Approval by hand unless a test switches the automatic approval on.
    AUTO_APPROVE_TECHNICIANS: 'false',
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgresql://unused:unused@127.0.0.1:1/unused',
    ...TEST_SECRETS,
    ...overrides,
  });
}

export function requireTestDatabase(): void {
  if (!process.env.DATABASE_URL_TEST) throw new Error('No test database: run the tests with "npm test", which starts one.');
}

export class TestClock implements Clock {
  constructor(public t = Date.UTC(2026, 9, 16, 6, 30)) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Records codes instead of sending SMS; can be told to fail. */
export class FakeSms implements SmsSender {
  readonly sent: { phone: string; code: string }[] = [];
  failNext = false;

  async sendOtp(phone: string, code: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider down');
    }
    this.sent.push({ phone, code });
  }

  lastCode(phone: string): string {
    const hit = [...this.sent].reverse().find((s) => s.phone === phone);
    if (!hit) throw new Error(`no code sent to ${phone}`);
    return hit.code;
  }
}

/** In-memory Razorpay: orders, payments in any status, captures and refunds (which can be made to fail). */
export class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RzpOrder & { receipt: string; notes: Record<string, string> }>();
  readonly payments = new Map<string, RzpPayment>();
  readonly captures: string[] = [];
  readonly refunds: { id: string; paymentId: string; amount: number }[] = [];
  failOrders = false;
  failRefunds = false;
  private n = 0;

  reset(): void {
    this.orders.clear();
    this.payments.clear();
    this.captures.length = 0;
    this.refunds.length = 0;
    this.failOrders = false;
    this.failRefunds = false;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<RzpOrder> {
    if (this.failOrders) throw new RazorpayError(503, 'SERVER_ERROR');
    const order = { id: `order_${++this.n}`, amount: input.amountPaise, currency: 'INR', receipt: input.receipt, notes: input.notes };
    this.orders.set(order.id, order);
    return order;
  }

  /** The customer pays (or tries to) in the checkout sheet. */
  pay(orderId: string, status: RzpPaymentStatus = 'captured', over: Partial<RzpPayment> = {}): RzpPayment {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`no order ${orderId}`);
    const p: RzpPayment = { id: `pay_${++this.n}`, order_id: orderId, amount: order.amount, currency: 'INR', status, method: 'upi', ...over };
    this.payments.set(p.id, p);
    return p;
  }

  async fetchPayment(id: string): Promise<RzpPayment> {
    const p = this.payments.get(id);
    if (!p) throw new RazorpayError(400, 'BAD_REQUEST_ERROR');
    return p;
  }

  async fetchOrderPayments(orderId: string): Promise<RzpPayment[]> {
    return [...this.payments.values()].filter((p) => p.order_id === orderId);
  }

  async capture(id: string, amountPaise: number): Promise<RzpPayment> {
    const p = await this.fetchPayment(id);
    const captured = { ...p, status: 'captured' as const, amount: amountPaise };
    this.payments.set(id, captured);
    this.captures.push(id);
    return captured;
  }

  async refund(paymentId: string, input: { amountPaise: number }): Promise<RzpRefund> {
    if (this.failRefunds) throw new RazorpayError(503, 'SERVER_ERROR');
    const r = { id: `rfnd_${++this.n}`, paymentId, amount: input.amountPaise };
    this.refunds.push(r);
    return { id: r.id, payment_id: paymentId, amount: input.amountPaise, status: 'processed' };
  }
}

/** The uploads bucket in memory. `upload(id, bytes)` is the app's PUT to the signed URL. */
export class FakeObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async presignPut(key: string, contentType: string, bytes: number, expiresInSec: number): Promise<string> {
    return `https://uploads.test/${key}?op=put&type=${encodeURIComponent(contentType)}&bytes=${bytes}&expires=${expiresInSec}`;
  }

  async presignGet(key: string, expiresInSec: number): Promise<string> {
    return `https://uploads.test/${key}?op=get&expires=${expiresInSec}`;
  }

  async get(key: string, maxBytes: number): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (o && o.bytes.length > maxBytes) throw new ObjectTooLarge('too large');
    return o ? new Uint8Array(o.bytes) : null;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  upload(uploadId: string, bytes: Uint8Array, contentType = 'application/octet-stream'): void {
    this.objects.set(uploadKey(uploadId), { bytes: new Uint8Array(bytes), contentType });
  }

  /** The file as served: the checked copy once checked, the uploaded original before. */
  stored(uploadId: string): Uint8Array | undefined {
    return (this.objects.get(verifiedKey(uploadId)) ?? this.objects.get(uploadKey(uploadId)))?.bytes;
  }
}

/** Records pushes instead of sending them; can be made unavailable, or told a device is gone. */
export class FakePush implements PushSender {
  readonly sent: PushMessage[] = [];
  readonly goneTokens = new Set<string>();
  unavailable = false;

  reset(): void {
    this.sent.length = 0;
    this.goneTokens.clear();
    this.unavailable = false;
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    if (this.unavailable) throw new PushUnavailable('push service down (test)');
    return messages.map((m) => {
      if (this.goneTokens.has(m.to)) return { ok: false, error: 'DeviceNotRegistered', deviceGone: true };
      this.sent.push(m);
      return { ok: true };
    });
  }
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE booking_reminders, uploads, ratings, notifications, devices, earnings_ledger, payouts, support_tickets, quote_lines, quotes, job_offers, service_area_pincodes, audit_log, technician_skills, technicians, payment_webhook_events, payments, booking_events, bookings, addresses, slot_capacities, refresh_tokens, otp_challenges, otp_lockouts, telephony_events, call_grants, dispatch_queue, offer_call_attempts, users, service_issues, services, categories, course_lesson_videos, course_publications RESTART IDENTITY CASCADE');
}

export interface TestApp {
  readonly app: NestFastifyApplication;
  readonly prisma: PrismaService;
  readonly clock: TestClock;
  readonly sms: FakeSms;
  /** Per-IP counters; clear between tests, since every test request comes from 127.0.0.1. */
  readonly rateLimits: MemoryRateLimitStore;
  readonly razorpay: FakeRazorpay;
  readonly push: FakePush;
  readonly store: FakeObjectStore;
  close(): Promise<void>;
}

export async function buildTestApp(opts: {
  env?: NodeJS.ProcessEnv;
  controllers?: Type[];
  prisma?: unknown;
  /** Extra provider overrides (token, value), e.g. a model client with a fake fetch. */
  overrides?: readonly (readonly [unknown, unknown])[];
} = {}): Promise<TestApp> {
  const config = testEnv(opts.env);
  const clock = new TestClock();
  const sms = new FakeSms();
  const rateLimits = new MemoryRateLimitStore();
  const razorpay = new FakeRazorpay();
  const push = new FakePush();
  const store = new FakeObjectStore();
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)], controllers: opts.controllers ?? [] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(SMS_SENDER)
    .useValue(sms)
    .overrideProvider(RATE_LIMIT_STORE)
    .useValue(rateLimits)
    .overrideProvider(RAZORPAY_CLIENT)
    .useValue(razorpay)
    .overrideProvider(PUSH_SENDER)
    .useValue(push)
    .overrideProvider(OBJECT_STORE)
    .useValue(store);
  if (opts.prisma) builder = builder.overrideProvider(PrismaService).useValue(opts.prisma);
  for (const [token, value] of opts.overrides ?? []) builder = builder.overrideProvider(token).useValue(value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(config), { rawBody: true });
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, prisma: app.get(PrismaService), clock, sms, rateLimits, razorpay, push, store, close: () => app.close() };
}

export interface SignedIn {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly isNew: boolean;
  readonly customer?: { readonly id: string; readonly phone: string; readonly name: string };
  readonly technician?: { readonly id: string; readonly phone: string; readonly name: string };
  readonly coordinator?: { readonly id: string; readonly name: string };
}

export const TECH_PROFILE = {
  name: 'Swathi Naidu',
  gender: 'F',
  experienceYears: 5,
  skills: ['PLUMBING', 'CLEANING'],
  city: 'Hyderabad',
  pincode: '500034',
  areas: 'Banjara Hills, Jubilee Hills, Ameerpet',
  vehicle: 'Scooter · TS 08 CD 4521',
} as const;

/** The technician's registration photo, uploaded as the app does (ticket, then PUT to storage). */
export async function uploadProfilePhoto(t: TestApp, accessToken: string): Promise<string> {
  const bytes = jpegWithGps();
  const res = await request(t.app.getHttpServer())
    .post('/v1/uploads/photos')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ contentType: 'image/jpeg', bytes: bytes.length, stage: 'PROFILE' })
    .expect(200);
  t.store.upload(res.body.id, bytes, 'image/jpeg');
  return res.body.id as string;
}

/**
 * A technician who signed in and submitted a profile, approved by default (as an admin would with npm run tech). An
 * approved one submitted a day ago, so their review time (review-window.ts) has passed and the approval shows now.
 */
export async function createTechnician(
  t: TestApp,
  phone = '9876500011',
  opts: { approve?: boolean; profile?: Partial<Record<keyof typeof TECH_PROFILE, unknown>> } = {},
): Promise<{ id: string; token: string }> {
  const auth = await signIn(t, phone, 'TECHNICIAN');
  const id = auth.technician!.id;
  const photoUploadId = await uploadProfilePhoto(t, auth.accessToken);
  await request(t.app.getHttpServer())
    .put('/v1/tech/profile')
    .set('Authorization', `Bearer ${auth.accessToken}`)
    .send({ ...TECH_PROFILE, photoUploadId, ...opts.profile })
    .expect(200);
  if (opts.approve !== false) {
    await t.prisma.technician.update({ where: { userId: id }, data: { submittedAt: new Date(t.clock.now() - 25 * 3_600_000) } });
    await t.app.get(TechVerificationService).approve(id, { type: 'ADMIN', id: null, via: 'test' });
  }
  return { id, token: auth.accessToken };
}

/** Requests a code, reads it from the fake SMS sender and verifies it. */
export async function signIn(t: TestApp, phone = '9876543210', role: 'CUSTOMER' | 'TECHNICIAN' | 'COORDINATOR' = 'CUSTOMER'): Promise<SignedIn> {
  const http = request(t.app.getHttpServer());
  const challenge = await http.post('/v1/auth/otp/request').send({ phone, role }).expect(200);
  const res = await request(t.app.getHttpServer())
    .post('/v1/auth/otp/verify')
    .send({ challengeId: challenge.body.challengeId, code: t.sms.lastCode(phone) })
    .expect(200);
  return res.body as SignedIn;
}

/** Minimal Server-Sent Events client for tests: collects the events with the given name. */
export function openSse(port: number, path: string, token: string, event: string) {
  const events: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  let status = 0;
  let buffer = '';
  const req = http.get({ host: '127.0.0.1', port, path, headers: { Authorization: `Bearer ${token}` } }, (res) => {
    status = res.statusCode ?? 0;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (block.includes(`event: ${event}`) && data) {
          events.push(JSON.parse(data.slice(6)) as Record<string, unknown>);
          waiters.splice(0).forEach((w) => w());
        }
      }
    });
  });
  const waitFor = (n: number) =>
    new Promise<void>((resolve, reject) => {
      const check = () => (events.length >= n ? resolve() : waiters.push(check));
      setTimeout(() => reject(new Error(`timed out waiting for ${event} event ${n}`)), 5000);
      check();
    });
  return { events, waitFor, status: () => status, close: () => req.destroy() };
}
