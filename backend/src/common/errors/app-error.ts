import { defaultMessage, ERROR_STATUS, type ErrorCode, type ErrorDetails } from './error-codes';

/**
 * The one error type services throw: `throw new AppError('CONFLICT')`. The global filter turns it into the
 * contract's error body. Keep `message` free of personal data; it is logged and returned.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly details: ErrorDetails = {},
    message?: string,
  ) {
    super(message ?? defaultMessage(code));
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }
}
