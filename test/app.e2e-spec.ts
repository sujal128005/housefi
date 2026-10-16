// End-to-end tests of the HTTP stack (adapter, hooks, helmet, CORS, guard, filter) exactly as main.ts sets it up.
// No Postgres or Redis needed: the database client is replaced, and rate limits use the in-memory store in tests.
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { AppError } from '../src/common/errors/app-error';
import { PrismaService } from '../src/common/prisma/prisma.module';
import { RateLimit } from '../src/common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../src/common/validation/zod-validation.pipe';
import { parseEnv } from '../src/config/env';
import { configureApp, createAdapter } from '../src/http';

const EchoBody = z.object({ name: z.string().min(2).max(60), pincode: z.string().regex(/^[1-9][0-9]{5}$/) });

/** Routes that exist only in this test, to exercise validation, AppError and rate limits. */
@Controller('test')
class TestController {
  @Post('echo')
  echo(@Body(new ZodValidationPipe(EchoBody)) body: z.infer<typeof EchoBody>): z.infer<typeof EchoBody> {
    return body;
  }

  @Get('conflict')
  conflict(): never {
    throw new AppError('CONFLICT');
  }

  @Get('crash')
  crash(): never {
    throw new Error('db password is hunter2');
  }

  @Get('limited')
  @RateLimit({ limit: 2, windowSec: 60 })
  limited(): { ok: true } {
    return { ok: true };
  }
}

async function buildApp(opts: { database?: 'up' | 'down'; env?: NodeJS.ProcessEnv } = {}): Promise<NestFastifyApplication> {
  const config = parseEnv({ NODE_ENV: 'test', CORS_ORIGINS: 'http://localhost:8081', RATE_LIMIT_PER_MIN: '5', ...opts.env });
  const fakePrisma = {
    $queryRaw: () => (opts.database === 'down' ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve([{ '?column?': 1 }])),
    $disconnect: () => Promise.resolve(),
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)], controllers: [TestController] })
    .overrideProvider(PrismaService)
    .useValue(fakePrisma)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(config));
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('HTTP stack (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/health', () => {
    it('reports liveness with security headers and a request id', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', uptimeSec: expect.any(Number), time: expect.any(Number) });
      expect(res.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('is not rate limited', async () => {
      for (let i = 0; i < 8; i++) await request(app.getHttpServer()).get('/v1/health').expect(200);
    });
  });

  describe('GET /v1/health/ready', () => {
    it('is 200 when the database answers (Redis is disabled in tests)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health/ready').expect(200);
      expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'disabled' } });
    });

    it('is 503 when the database is down', async () => {
      const down = await buildApp({ database: 'down' });
      try {
        const res = await request(down.getHttpServer()).get('/v1/health/ready').expect(503);
        expect(res.body).toEqual({ status: 'degraded', checks: { database: 'down', redis: 'disabled' } });
      } finally {
        await down.close();
      }
    });
  });

  describe('request ids', () => {
    it('keeps a safe incoming X-Request-Id and puts it in error bodies', async () => {
      const res = await request(app.getHttpServer()).get('/v1/test/conflict').set('X-Request-Id', 'mobile-7f3a-0001').expect(409);
      expect(res.headers['x-request-id']).toBe('mobile-7f3a-0001');
      expect(res.body.error.requestId).toBe('mobile-7f3a-0001');
    });

    it('replaces an unsafe incoming X-Request-Id', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health').set('X-Request-Id', 'x<script>').expect(200);
      expect(res.headers['x-request-id']).toMatch(/^req_/);
    });
  });

  describe('error bodies', () => {
    it('unknown routes are NOT_FOUND in the contract shape', async () => {
      const res = await request(app.getHttpServer()).get('/v1/nope').expect(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'not found', requestId: res.headers['x-request-id'] } });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('AppError keeps its code and status', async () => {
      const res = await request(app.getHttpServer()).get('/v1/test/conflict').expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('unexpected errors are INTERNAL and leak nothing', async () => {
      const res = await request(app.getHttpServer()).get('/v1/test/crash').expect(500);
      expect(res.body.error).toMatchObject({ code: 'INTERNAL', message: 'internal error' });
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    });

    it('validation failures list the fields', async () => {
      const res = await request(app.getHttpServer()).post('/v1/test/echo').send({ pincode: '012345' }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION', fields: { name: 'REQUIRED', pincode: 'INVALID' } });
    });

    it('valid bodies pass through parsed', async () => {
      await request(app.getHttpServer()).post('/v1/test/echo').send({ name: 'Priya', pincode: '500034' }).expect(201, { name: 'Priya', pincode: '500034' });
    });

    it('malformed JSON is VALIDATION, not a Fastify error', async () => {
      const res = await request(app.getHttpServer()).post('/v1/test/echo').set('Content-Type', 'application/json').send('{"name":').expect(422);
      expect(res.body).toEqual({ error: { code: 'VALIDATION', message: 'invalid request', requestId: expect.any(String) } });
    });

    it('oversized bodies are rejected', async () => {
      const res = await request(app.getHttpServer()).post('/v1/test/echo').send({ name: 'x'.repeat(200 * 1024), pincode: '500034' }).expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
    });
  });

  describe('rate limits', () => {
    it('applies a route limit, then RATE_LIMITED with Retry-After', async () => {
      await request(app.getHttpServer()).get('/v1/test/limited').expect(200);
      await request(app.getHttpServer()).get('/v1/test/limited').expect(200);
      const res = await request(app.getHttpServer()).get('/v1/test/limited').expect(429);
      expect(res.body.error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: expect.any(Number) });
      expect(Number(res.headers['retry-after'])).toBe(res.body.error.retryAfterSec);
    });

    it('applies the default per-IP limit (RATE_LIMIT_PER_MIN) to other routes', async () => {
      for (let i = 0; i < 5; i++) await request(app.getHttpServer()).get('/v1/test/conflict').expect(409);
      await request(app.getHttpServer()).get('/v1/test/conflict').expect(429);
    });
  });

  describe('CORS', () => {
    it('allows the web preview origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/v1/health')
        .set('Origin', 'http://localhost:8081')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,idempotency-key');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
      expect(res.headers['access-control-allow-headers']).toContain('Idempotency-Key');
    });

    it('does not allow other origins', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health').set('Origin', 'https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
