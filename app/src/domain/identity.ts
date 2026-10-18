// Technician identity rules: the permanent Housefi Technician ID, the verification-page token, and how a
// verification state may be shown. Pure functions; randomness is passed in so the backend decides where it comes
// from (a cryptographic source in the app and on the server).
import type { Verification } from './types';

/** Letters and digits that are hard to confuse when read aloud or typed: no 0/O, 1/I/L. 31 characters. */
export const TECH_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TECH_CODE_PREFIX = 'N9-HF-T-';
export const TECH_CODE_RE = /^N9-HF-T-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Random bytes from a cryptographic source. */
export type RandomBytes = (n: number) => Uint8Array;

/**
 * `length` characters drawn uniformly from `alphabet`, by rejection sampling (bytes that would bias the result are
 * thrown away and drawn again).
 */
export function randomString(alphabet: string, length: number, bytes: RandomBytes): string {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < length) {
    for (const b of bytes(length * 2)) {
      if (b < limit) out += alphabet[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * A new Housefi Technician ID: N9 (Nexara9) - HF (Housefi) - T (technician) - six random characters (31^6, about
 * 887 million). Nothing in it comes from the name, phone number or a counter. `taken` holds every ID ever issued;
 * IDs are never reused, even after an account is closed.
 */
export function newTechCode(bytes: RandomBytes, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code = TECH_CODE_PREFIX + randomString(TECH_CODE_ALPHABET, 6, bytes);
    if (!taken.has(code)) return code;
  }
  throw new Error('could not issue a unique technician ID');
}

/** Token for the verification page link: 24 characters (about 143 bits), not guessable, no personal data. */
export function newVerifyToken(bytes: RandomBytes): string {
  return randomString(TOKEN_ALPHABET, 24, bytes);
}

export const VERIFY_TOKEN_RE = /^[A-Za-z0-9]{24}$/;

/**
 * How a verification state is shown. VERIFIED (the tick and badge) only for a genuine, approved verification;
 * an approval made by the demo backend is DEMO ("Demo verification · simulated, not verified").
 */
export type VerificationLook = 'VERIFIED' | 'DEMO' | 'PENDING' | 'NEEDS_CORRECTION' | 'REJECTED' | 'SUSPENDED' | 'UNKNOWN';

export function verificationLook(state: Verification | null | undefined, simulated: boolean | null | undefined): VerificationLook {
  switch (state) {
    // The tick needs an explicit "not simulated"; an approval whose origin is unknown is not shown as verified.
    case 'APPROVED': return simulated === false ? 'VERIFIED' : simulated === true ? 'DEMO' : 'UNKNOWN';
    case 'PENDING': return 'PENDING';
    case 'NEEDS_CORRECTION': return 'NEEDS_CORRECTION';
    case 'REJECTED': return 'REJECTED';
    case 'SUSPENDED': return 'SUSPENDED';
    default: return 'UNKNOWN';
  }
}

/** Only a real, approved verification counts as verified. */
export function isGenuinelyVerified(state: Verification | null | undefined, simulated: boolean | null | undefined): boolean {
  return verificationLook(state, simulated) === 'VERIFIED';
}

/** "Swathi Naidu" -> "Swathi N." (what the public verification page shows). */
export function displayName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]} ${(parts[parts.length - 1] ?? '').charAt(0).toUpperCase()}.`;
}

/** The demo's sample photos (illustrations, clearly not a real person). */
export const DEMO_PHOTOS = ['demo:tech_man', 'demo:tech_woman'] as const;

/** A registration photo the backend accepts: a JPEG/PNG/WebP image (data URI, at most ~450 KB) or a demo sample. */
export function isValidPhoto(photo: string | undefined | null): photo is string {
  if (!photo) return false;
  if ((DEMO_PHOTOS as readonly string[]).includes(photo)) return true;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length <= 600_000;
}

/**
 * A photo URI the app may display: an inline JPEG/PNG/WebP image or an https link (the live backend's signed URL).
 * Anything else (file:, content:, http:, javascript:, other data: types) is not shown.
 */
export function isDisplayablePhoto(uri: string | null | undefined): boolean {
  if (!uri) return false;
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(uri)) return true;
  return /^https:\/\/[^\s/]+\/\S*$/i.test(uri);
}
