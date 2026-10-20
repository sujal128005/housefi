import { createHmac, timingSafeEqual } from 'node:crypto';

/** Bytes as Prisma stores them (bytea). */
export type Bytes = Uint8Array<ArrayBuffer>;

/** HMAC-SHA256 under a secret key: lookups by phone number and storage of OTP codes and refresh tokens. */
export class Hmac {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error('HMAC keys must be at least 32 bytes');
  }

  digest(...parts: readonly string[]): Bytes {
    // Unit separator between parts, so ("ab", "c") and ("a", "bc") never collide.
    return new Uint8Array(createHmac('sha256', this.key).update(parts.join('\u001f')).digest());
  }
}

/** Constant-time comparison of two digests. */
export function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The three keyed hashes auth needs, each with its own key so one leaking does not expose the others. */
export class Hashing {
  constructor(
    private readonly phoneKey: Hmac,
    private readonly otpKey: Hmac,
    private readonly tokenKey: Hmac,
  ) {}

  /** `phone` is the 10-digit Indian mobile number without +91 (already validated). */
  phone(phone: string): Bytes {
    return this.phoneKey.digest('phone', phone);
  }

  /** Bound to the challenge, so the same code in two challenges hashes differently. */
  otp(challengeId: string, code: string): Bytes {
    return this.otpKey.digest('otp', challengeId, code);
  }

  refreshToken(token: string): Bytes {
    return this.tokenKey.digest('refresh', token);
  }

  /** Signs a short-lived invoice download link (booking id + expiry). */
  invoiceLink(bookingId: string, expiresAtMs: number): Bytes {
    return this.tokenKey.digest('invoice', bookingId, String(expiresAtMs));
  }
}
