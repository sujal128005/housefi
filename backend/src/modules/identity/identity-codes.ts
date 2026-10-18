// Random identifiers for technician identity, from the system's cryptographic random source.
import { createHash, randomInt } from 'node:crypto';

/** No 0/O, 1/I/L: easy to read out and type. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const TECH_CODE = /^N9-HF-T-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
export const VERIFY_TOKEN = /^[A-Za-z0-9]{24}$/;

const pick = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');

/** Permanent Housefi Technician ID, e.g. N9-HF-T-7K4M9Q (31^6 ≈ 887 million codes; collisions are retried). */
export function newTechCode(): string {
  return `N9-HF-T-${pick(CODE_ALPHABET, 6)}`;
}

/** The QR code's token: 24 characters from 62, about 143 bits, so it cannot be guessed. */
export function newVerifyToken(): string {
  return pick(TOKEN_ALPHABET, 24);
}

export function verifyTokenHash(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token).digest());
}

/** "Swathi Naidu" → "Swathi N." (the public verification page never shows a full name). */
export function displayName(full: string): string {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words[0] ?? '';
  return `${words[0]} ${[...(words.at(-1) as string)][0]?.toUpperCase()}.`;
}
