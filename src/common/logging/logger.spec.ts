import pino from 'pino';
import { Writable } from 'node:stream';
import { loggerOptions, stripQuery } from './logger';

function capture(): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const { transport: _t, ...opts } = loggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'production' });
  const logger = pino(opts, sink);
  return { logger, lines: () => chunks.join('').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe('logger redaction', () => {
  it('redacts personal data, codes and tokens wherever they appear', () => {
    const { logger, lines } = capture();
    logger.info({
      phone: '9876543210',
      body: { code: '123456', name: 'Priya Sharma' },
      customer: { phone: '9876543210', address: { house: 'Flat 4B' } },
      session: { accessToken: 'eyJ', refreshToken: 'rt_1' },
      req: { headers: { authorization: 'Bearer eyJ', cookie: 'a=b' } },
    }, 'test');
    const out = JSON.stringify(lines()[0]);
    for (const leaked of ['9876543210', '123456', 'Priya Sharma', 'Flat 4B', 'eyJ', 'rt_1', 'a=b']) expect(out).not.toContain(leaked);
    expect(out).toContain('[REDACTED]');
  });

  it('keeps error codes and error names, which are needed for debugging', () => {
    const { logger, lines } = capture();
    const err = Object.assign(new TypeError('boom'), { code: 'ECONNREFUSED' });
    logger.error({ err, errorCode: 'CONFLICT' }, 'failed');
    const line = lines()[0] as { err: { type: string; code: string }; errorCode: string };
    expect(line.err.type).toBe('TypeError');
    expect(line.err.code).toBe('ECONNREFUSED');
    expect(line.errorCode).toBe('CONFLICT');
  });

  it('logs request paths without query strings', () => {
    expect(stripQuery('/v1/slots?serviceId=plumb-tap&date=2026-10-17')).toBe('/v1/slots');
    expect(stripQuery('/v1/health')).toBe('/v1/health');
  });

  it('is silent in tests', () => {
    expect(loggerOptions({ LOG_LEVEL: 'debug', NODE_ENV: 'test' }).level).toBe('silent');
  });
});
