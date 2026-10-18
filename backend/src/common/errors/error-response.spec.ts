import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AppError } from './app-error';
import { toErrorResponse } from './error-response';

describe('toErrorResponse', () => {
  it('keeps AppError codes, statuses and details', () => {
    const r = toErrorResponse(new AppError('OTP_INVALID', { attemptsLeft: 2 }, 'wrong start code'), 'req_1');
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: { code: 'OTP_INVALID', message: 'wrong start code', attemptsLeft: 2, requestId: 'req_1' } });
    expect(r.unexpected).toBe(false);
  });

  it.each([
    ['OTP_LOCKED', 429],
    ['PAYMENT_FAILED', 402],
    ['OFFER_EXPIRED', 410],
    ['NOT_VERIFIED', 403],
    ['SLOT_UNAVAILABLE', 409],
    ['VALIDATION', 422],
  ] as const)('uses the contract status for %s', (code, status) => {
    expect(toErrorResponse(new AppError(code), 'r').status).toBe(status);
  });

  it('maps Nest HTTP exceptions onto contract codes', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /v1/nope'), 'r').body.error).toEqual({
      code: 'NOT_FOUND', message: 'not found', requestId: 'r',
    });
    expect(toErrorResponse(new ConflictException(), 'r').body.error.code).toBe('CONFLICT');
    const bad = toErrorResponse(new BadRequestException(), 'r');
    expect([bad.status, bad.body.error.code]).toEqual([422, 'VALIDATION']);
  });

  it('maps Fastify errors (malformed JSON, body too large) to VALIDATION', () => {
    const malformed = Object.assign(new SyntaxError('Unexpected token } in JSON'), { statusCode: 400 });
    const tooLarge = Object.assign(new Error('Request body is too large'), { statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE' });
    expect(toErrorResponse(malformed, 'r').body.error).toEqual({ code: 'VALIDATION', message: 'invalid request', requestId: 'r' });
    expect(toErrorResponse(tooLarge, 'r').status).toBe(422);
  });

  it('hides the message of unexpected errors', () => {
    const r = toErrorResponse(new Error('connect ECONNREFUSED postgres://housefi:secret@db'), 'r');
    expect(r.status).toBe(500);
    expect(r.body.error).toEqual({ code: 'INTERNAL', message: 'internal error', requestId: 'r' });
    expect(r.unexpected).toBe(true);
  });
});
