// Error codes and HTTP statuses from the contract (docs/README.md "Errors", openapi.yaml ErrorBody).
// The app shows its own translated text per code, so the code is what matters; `message` is for logs only.

export const ERROR_STATUS = {
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_LOCKED: 429,
  SLOT_UNAVAILABLE: 409,
  INSTANT_UNAVAILABLE: 409,
  PAYMENT_FAILED: 402,
  OFFER_EXPIRED: 410,
  NOT_VERIFIED: 403,
  RATE_LIMITED: 429,
  /** Not in openapi.yaml: unexpected server failure. Raised in docs/QUESTIONS.md. */
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type FieldError = 'REQUIRED' | 'INVALID';

export interface ErrorDetails {
  readonly attemptsLeft?: number;
  readonly retryAfterSec?: number;
  readonly fields?: Readonly<Record<string, FieldError>>;
}

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly requestId: string } & ErrorDetails;
}

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION: 'invalid request',
  UNAUTHENTICATED: 'missing or expired access token',
  NOT_FOUND: 'not found',
  CONFLICT: 'action not allowed in the current state',
  OTP_INVALID: 'wrong code',
  OTP_EXPIRED: 'code expired',
  OTP_LOCKED: 'too many wrong codes',
  SLOT_UNAVAILABLE: 'time window full or closed',
  INSTANT_UNAVAILABLE: 'instant visits unavailable now',
  PAYMENT_FAILED: 'payment failed',
  OFFER_EXPIRED: 'offer expired',
  NOT_VERIFIED: 'technician not verified',
  RATE_LIMITED: 'too many requests',
  INTERNAL: 'internal error',
};

export function defaultMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
