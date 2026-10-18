// Structured JSON logs (pino, via Fastify) with personal data and secrets redacted. Rule of thumb: never log request
// bodies; log ids and codes. The redaction list is a safety net for objects that slip through anyway.
import type { LoggerService } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import type { LoggerOptions } from 'pino';
import type { Env } from '../../config/env';

/** Field names that may hold personal data, codes or secrets, wherever they appear (up to 3 levels deep). */
const SENSITIVE_FIELDS = [
  'phone', 'customerName', 'house', 'street', 'landmark', 'address', 'lat', 'lng', 'otp', 'arrivalOtp', 'startCode', 'demoCode',
  'token', 'accessToken', 'refreshToken', 'pushToken', 'authorization', 'password', 'secret', 'razorpaySignature',
  // Free text people type can hold anything personal. ('message' is left out: it is also every error's text.)
  'note', 'comment', 'transcript', 'resolution',
] as const;

export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-razorpay-signature"]',
  'res.headers["set-cookie"]',
  // `code` and `name` also appear on errors (error code, error class), so they are only redacted where request
  // bodies would sit.
  'body.code', 'req.body.code', 'request.body.code', 'body.name', 'req.body.name', 'request.body.name',
  ...SENSITIVE_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`]),
];

/** Path segments that are secrets themselves (the Exotel callback URLs carry EXOTEL_WEBHOOK_SECRET). */
const SECRET_PATH = /(\/webhooks\/telephony\/[^/]+\/)[^/]+/;

/** Logs the path only (query strings can carry identifiers), with secret path segments hidden. */
export function stripQuery(url: string | undefined): string {
  if (!url) return '';
  const q = url.indexOf('?');
  return (q < 0 ? url : url.slice(0, q)).replace(SECRET_PATH, '$1[REDACTED]');
}

/** Readable logs on a developer's machine, when pino-pretty is installed (not in the production image). */
function prettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export function loggerOptions(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): LoggerOptions {
  return {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: 'housefi-api' },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    serializers: {
      // Only method and path: no headers, no IP, no query.
      req: (req: IncomingMessage) => ({ method: req.method, url: stripQuery(req.url) }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    ...(env.NODE_ENV === 'development' && prettyAvailable()
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' } } }
      : {}),
  };
}

/** Routes Nest's own logs (startup, route mapping) into the same pino logger. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  private write(level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal', message: unknown, rest: unknown[]): void {
    const context = typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : undefined;
    if (message instanceof Error) this.logger[level]({ context, err: message }, message.message);
    else if (typeof message === 'object' && message !== null) this.logger[level]({ context, ...message });
    else this.logger[level]({ context }, String(message));
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }
}
