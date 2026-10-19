// HTTP setup shared by main.ts and the e2e tests, so tests exercise exactly what production runs.
import helmet from '@fastify/helmet';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { genReqId, REQUEST_ID_HEADER } from './common/http/request-id';
import { loggerOptions, PinoNestLogger } from './common/logging/logger';
import type { Env } from './config/env';

/** Request bodies are small JSON: photos and audio go straight to S3 with signed URLs. */
const BODY_LIMIT_BYTES = 100 * 1024;
/** The one exception: a photo shown to the HQ portal's guide (resized in the browser, sent inline, never stored). */
export const GUIDE_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

export function createAdapter(config: Env): FastifyAdapter {
  return new FastifyAdapter({
    logger: loggerOptions(config),
    genReqId,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    // A hop count (not "true"): only addresses appended by our own proxies are believed, never one the client sent.
    trustProxy: config.TRUST_PROXY > 0 ? (_address: string, hop: number) => hop < config.TRUST_PROXY : false,
    bodyLimit: BODY_LIMIT_BYTES,
  });
}

export async function configureApp(app: NestFastifyApplication, config: Env): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  app.useLogger(new PinoNestLogger(fastify.log));
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  fastify.addHook('onRoute', (route) => {
    if (route.url === '/v1/admin/guide/messages') route.bodyLimit = GUIDE_BODY_LIMIT_BYTES;
  });

  // Nest also routes Fastify's own errors (malformed JSON, body too large) through AllExceptionsFilter.
  fastify.addHook('onRequest', async (req, reply) => {
    void reply.header(REQUEST_ID_HEADER, req.id);
  });

  await app.register(helmet, {
    // A JSON API: nothing may be framed, scripted or embedded.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // Only the web preview of the app needs CORS; native apps do not send an Origin.
  const allowed = new Set(config.CORS_ORIGINS);
  app.enableCors({
    origin: (origin, cb) => cb(null, origin !== undefined && allowed.has(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  });
}
