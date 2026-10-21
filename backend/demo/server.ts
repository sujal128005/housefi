// The demo server behind `npm run demo` (scripts/demo.mjs starts the database and the screens). The real API, built
// like src/main.ts, on a throwaway database, with everything outside the laptop replaced:
// - the two demo phone numbers sign in with a fixed code (the same rules as the team's DEMO_PHONES in production:
//   payments are simulated and the two only ever meet each other); no SMS is sent;
// - uploaded photos are kept in memory and served by a small file server on the next port;
// - no Redis and no request limits (both phones and the demo itself share one address, which the anti-spam limits
//   on sign-in would soon block), push messages only logged, AI in its basic rule mode, no phone calls.
// The technician is ready: approved, online, near Banjara Hills, all six trades, and every Hyderabad PIN (500001-500110)
// counts as their area.
// Never deploy this: it is a local demo with generated secrets that change on every start.
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { REDIS } from '../src/common/redis/redis.module';
import { RATE_LIMIT_STORE } from '../src/common/rate-limit/rate-limit.service';
import type { RateLimitStore } from '../src/common/rate-limit/rate-limit.store';
import { OBJECT_STORE, ObjectTooLarge, uploadKey, type ObjectStore } from '../src/common/storage/object-store';
import { parseEnv } from '../src/config/env';
import { configureApp, createAdapter } from '../src/http';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { seedParts } from '../src/modules/parts/parts.service';
import { CATEGORY_ORDER } from '../src/modules/technicians/technicians.schemas';
import { TechVerificationService } from '../src/modules/technicians/tech-verification.service';

/** Fake numbers (never the team's real demo numbers): customer, technician. */
export const DEMO_CUSTOMER = '9876500001';
export const DEMO_TECHNICIAN = '9876500002';
export const DEMO_CODE = '482916';

const API_PORT = Number(process.env.DEMO_API_PORT ?? 4100);
const FILES_PORT = API_PORT + 1;
const SCREENS = (process.env.DEMO_SCREENS ?? 'http://localhost:8095,http://localhost:8096').split(',');
/** Near Banjara Hills, Hyderabad: where the technician waits (the customer screen's location is Jubilee Hills). */
const TECH_AT = { lat: 17.4156, lng: 78.4347 };

/** Every request allowed: see the top of the file. */
const noLimits: RateLimitStore = { hit: () => Promise.resolve({ count: 1, resetInMs: 60_000 }) };

/** Photos in memory, served by the file server: what S3 does in production. */
class DemoObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  private url = (op: string, key: string) => `http://localhost:${FILES_PORT}/${op}/${encodeURIComponent(key)}`;

  presignPut(key: string): Promise<string> {
    return Promise.resolve(this.url('put', key));
  }

  presignGet(key: string): Promise<string> {
    return Promise.resolve(this.url('get', key));
  }

  get(key: string, maxBytes: number): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (o && o.bytes.length > maxBytes) throw new ObjectTooLarge('too large');
    return Promise.resolve(o ? new Uint8Array(o.bytes) : null);
  }

  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  serve(): http.Server {
    return http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      const [, op, rawKey] = (req.url ?? '').split('?')[0]!.split('/');
      const key = decodeURIComponent(rawKey ?? '');
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (req.method === 'PUT' && op === 'put') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          this.objects.set(key, { bytes: Buffer.concat(chunks), contentType: req.headers['content-type'] ?? 'application/octet-stream' });
          res.writeHead(200).end();
        });
        return;
      }
      const o = op === 'get' ? this.objects.get(key) : undefined;
      if (!o) return void res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': o.contentType, 'Cache-Control': 'no-store' }).end(Buffer.from(o.bytes));
    });
  }
}

async function main(): Promise<void> {
  const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const secret = () => randomBytes(32).toString('base64');
  const config = parseEnv({
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    DATABASE_URL: process.env.DATABASE_URL,
    CORS_ORIGINS: SCREENS.join(','),
    JWT_PRIVATE_KEY_B64: Buffer.from(keys.privateKey).toString('base64'),
    JWT_PUBLIC_KEY_B64: Buffer.from(keys.publicKey).toString('base64'),
    OTP_PEPPER_B64: secret(),
    TOKEN_PEPPER_B64: secret(),
    PHONE_HASH_KEY_B64: secret(),
    LOCAL_DATA_KEY_B64: secret(),
    DEMO_PHONES: `${DEMO_CUSTOMER},${DEMO_TECHNICIAN}`,
    DEMO_OTP_CODE: DEMO_CODE,
    AADHAAR_REQUIRED: 'false',
    // Sign in again straight away (a presenter may sign out and in several times).
    OTP_RESEND_AFTER_SEC: '0',
    // Bookable at any hour, so the demo works in the evening too.
    INSTANT_HOURS: '00-24',
    AI_PROVIDER: 'rules',
    SPEECH_TO_TEXT_PROVIDER: 'none',
    TELEPHONY_PROVIDER: 'off',
    PUSH_PROVIDER: 'log',
    SMS_PROVIDER: 'console',
  });

  const store = new DemoObjectStore();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(REDIS)
    .useValue(null)
    .overrideProvider(OBJECT_STORE)
    .useValue(store)
    .overrideProvider(RATE_LIMIT_STORE)
    .useValue(noLimits)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(config), { rawBody: true });
  await configureApp(app, config);
  await app.listen(API_PORT, '127.0.0.1');
  await new Promise<void>((resolve) => store.serve().listen(FILES_PORT, '127.0.0.1', resolve));

  const prisma = app.get(PrismaService);
  await seedCatalog(prisma);
  await seedParts(prisma);
  // Any Hyderabad PIN the customer types counts as near the technician's (500034), so the job always reaches them.
  const pins = Array.from({ length: 110 }, (_, i) => String(500001 + i)).filter((p) => p !== '500034');
  await prisma.serviceAreaPincode.createMany({ data: pins.map((pincode) => ({ pincode, nearPincode: '500034' })), skipDuplicates: true });
  await readyTechnician(app, store);
  // The sign-in limit (5 codes a number an hour) would stop a presenter who signs in again and again: codes that have
  // expired are forgotten (and the technician's set-up one right away).
  await prisma.otpChallenge.deleteMany({});
  setInterval(() => void prisma.otpChallenge.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - config.OTP_TTL_SEC * 1000) } } }).catch(() => undefined), 30_000).unref();
  process.stdout.write(`DEMO_READY ${API_PORT}\n`);
}

/** Signs the demo technician in, fills in the profile, approves it and puts them online near Banjara Hills. */
async function readyTechnician(app: NestFastifyApplication, store: DemoObjectStore): Promise<void> {
  const api = async (path: string, body: unknown, token?: string, method = 'POST') => {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
  };
  const challenge = await api('/auth/otp/request', { phone: DEMO_TECHNICIAN, role: 'TECHNICIAN' });
  const auth = await api('/auth/otp/verify', { challengeId: challenge.challengeId, code: DEMO_CODE });
  const token = auth.accessToken as string;
  const userId = (auth.technician as { id: string }).id;

  const photo = readFileSync(join(__dirname, '..', '..', 'demo', 'technician.jpg'));
  const upload = await api('/uploads/photos', { contentType: 'image/jpeg', bytes: photo.length, stage: 'PROFILE' }, token);
  await store.put(uploadKey(upload.id as string), photo, 'image/jpeg');
  await api('/tech/profile', {
    name: 'Ravi Kumar',
    gender: 'M',
    experienceYears: 8,
    skills: [...CATEGORY_ORDER],
    city: 'Hyderabad',
    pincode: '500034',
    areas: 'Banjara Hills, Jubilee Hills, Ameerpet',
    vehicle: 'Scooter · TS 09 AB 1234',
    photoUploadId: upload.id,
  }, token, 'PUT');

  // Approved as an admin would with `npm run tech -- approve`, with the review time already over.
  const prisma = app.get(PrismaService);
  await prisma.technician.update({ where: { userId }, data: { submittedAt: new Date(Date.now() - 25 * 3_600_000) } });
  await app.get(TechVerificationService).approve(userId, { type: 'ADMIN', id: null, via: 'demo' });
  await api('/tech/availability', { online: true }, token);
  await api('/tech/location', { ...TECH_AT, accuracy: 20 }, token);
}

main().catch((err: unknown) => {
  process.stderr.write(`Demo server failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
