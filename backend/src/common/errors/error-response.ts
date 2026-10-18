import { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { defaultMessage, ERROR_STATUS, type ErrorBody, type ErrorCode } from './error-codes';

export interface ErrorResponse {
  readonly status: number;
  readonly body: ErrorBody;
  /** True for unexpected failures that should be logged with the stack. */
  readonly unexpected: boolean;
}

/** Maps a bare HTTP status (from Nest or Fastify errors) onto a contract code. */
function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  // 403 has no code of its own; the contract never reveals whether something exists.
  if (status === 403 || status === 404 || status === 405) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 400 && status < 500) return 'VALIDATION';
  return 'INTERNAL';
}

function statusOf(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'statusCode' in e && typeof e.statusCode === 'number') return e.statusCode;
  return undefined;
}

/** Turns anything thrown during a request into the contract's `{ error: { code, message, requestId, ... } }`. */
export function toErrorResponse(e: unknown, requestId: string): ErrorResponse {
  if (e instanceof AppError) {
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message, requestId, ...e.details } },
      unexpected: e.code === 'INTERNAL',
    };
  }
  const raw = e instanceof HttpException ? e.getStatus() : statusOf(e);
  const code = raw === undefined ? 'INTERNAL' : codeForStatus(raw);
  // Never echo messages from unknown errors: they can contain input, SQL or file paths.
  return {
    status: ERROR_STATUS[code],
    body: { error: { code, message: defaultMessage(code), requestId } },
    unexpected: code === 'INTERNAL',
  };
}
