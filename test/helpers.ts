// Shared e2e helpers: a test environment with throwaway secrets, a controllable clock, a fake SMS sender, a
// database reset, and an app built exactly like main.ts (src/http.ts).
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { CLOCK, type Clock } from '../src/common/clock';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { RATE_LIMIT_STORE } from '../src/common/rate-limit/rate-limit.service';
import { MemoryRateLimitStore } from '../src/common/rate-limit/rate-limit.store';
import { type Env, parseEnv } from '../src/config/env';
import { configureApp, createAdapter } from '../src/http';
import { SMS_SENDER, type SmsSender } from '../src/modules/auth/sms';

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
};

export function testEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:8081',
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

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE refresh_tokens, otp_challenges, users, service_issues, services, categories RESTART IDENTITY CASCADE');
}

export interface TestApp {
  readonly app: NestFastifyApplication;
  readonly prisma: PrismaService;
  readonly clock: TestClock;
  readonly sms: FakeSms;
  /** Per-IP counters; clear between tests, since every test request comes from 127.0.0.1. */
  readonly rateLimits: MemoryRateLimitStore;
  close(): Promise<void>;
}

export async function buildTestApp(opts: {
  env?: NodeJS.ProcessEnv;
  controllers?: Type[];
  prisma?: unknown;
} = {}): Promise<TestApp> {
  const config = testEnv(opts.env);
  const clock = new TestClock();
  const sms = new FakeSms();
  const rateLimits = new MemoryRateLimitStore();
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)], controllers: opts.controllers ?? [] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(SMS_SENDER)
    .useValue(sms)
    .overrideProvider(RATE_LIMIT_STORE)
    .useValue(rateLimits);
  if (opts.prisma) builder = builder.overrideProvider(PrismaService).useValue(opts.prisma);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(config));
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, prisma: app.get(PrismaService), clock, sms, rateLimits, close: () => app.close() };
}

export interface SignedIn {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly isNew: boolean;
  readonly customer?: { readonly id: string; readonly phone: string; readonly name: string };
  readonly technician?: { readonly id: string; readonly phone: string; readonly name: string };
}

/** Requests a code, reads it from the fake SMS sender and verifies it. */
export async function signIn(t: TestApp, phone = '9876543210', role: 'CUSTOMER' | 'TECHNICIAN' = 'CUSTOMER'): Promise<SignedIn> {
  const http = request(t.app.getHttpServer());
  const challenge = await http.post('/v1/auth/otp/request').send({ phone, role }).expect(200);
  const res = await request(t.app.getHttpServer())
    .post('/v1/auth/otp/verify')
    .send({ challengeId: challenge.body.challengeId, code: t.sms.lastCode(phone) })
    .expect(200);
  return res.body as SignedIn;
}
