// Aadhaar Secure QR verification (UIDAI "offline verification"), for technician onboarding.
//
// The secure QR printed on the Aadhaar letter, PVC card, e-Aadhaar and mAadhaar holds the person's details signed by
// UIDAI. Checking that signature locally proves the details are genuine and unaltered, without calling UIDAI and
// without ever handling the Aadhaar number: the QR carries only its last 4 digits (in the reference id).
//
// Format (UIDAI Secure QR specification, V2 and later):
//   QR text = a big decimal number → its bytes (big-endian) → gzip-compressed data
//   data    = fields separated by byte 255 … | photo (JPEG 2000) | [email hash][mobile hash] | signature (256 bytes)
//   fields  = version ("V2"…), email/mobile indicator, reference id (last 4 digits of Aadhaar + timestamp), name,
//             date of birth (DD-MM-YYYY), gender (M/F/T), care of, district, landmark, house, location, pin code,
//             post office, state, street, sub-district, village/town/city, …
//   signature = RSA-SHA256 (PKCS#1 v1.5) over every byte before it, with UIDAI's signing key; the certificate is
//               published by UIDAI and configured in UIDAI_QR_CERT_PEM_B64.
//
// What Housefi keeps (UIDAI offline-verification rules: never store the Aadhaar number): the last 4 digits, name,
// year of birth, gender, a one-way fingerprint to stop the same person registering twice, and when it was checked.
// The address and photo in the QR are not stored.
import { createHmac, createPublicKey, createVerify, type KeyObject, X509Certificate } from 'node:crypto';
import { gunzipSync, inflateSync } from 'node:zlib';

const SIGNATURE_BYTES = 256;
const DELIMITER = 255;
/** Text fields before the photo in V2 and later. */
const TEXT_FIELDS = 16;

export class AadhaarQrError extends Error {
  constructor(readonly reason: 'UNREADABLE' | 'OLD_FORMAT' | 'BAD_SIGNATURE' | 'INCOMPLETE') {
    super(`Aadhaar QR: ${reason}`);
    this.name = 'AadhaarQrError';
  }
}

export interface AadhaarQrDetails {
  /** "V2", "V3", … */
  readonly version: string;
  /** Last 4 digits of the Aadhaar number (from the reference id). */
  readonly last4: string;
  readonly name: string;
  /** DD-MM-YYYY as printed; only the year is stored. */
  readonly dateOfBirth: string;
  readonly yearOfBirth: number | null;
  readonly gender: 'M' | 'F' | 'T' | null;
  readonly pincode: string;
  /** When UIDAI generated the QR (from the reference id), ms since epoch, or null if unreadable. */
  readonly generatedAt: number | null;
}

/** Loads UIDAI's certificate: base64 of a PEM certificate or key, or of the .cer file itself (DER) as UIDAI publishes it. */
export function uidaiKey(certB64: string): KeyObject {
  const raw = Buffer.from(certB64.trim(), 'base64');
  const pem = raw.toString('utf8');
  if (!pem.includes('-----BEGIN')) return new X509Certificate(raw).publicKey;
  return pem.includes('CERTIFICATE') ? new X509Certificate(pem).publicKey : createPublicKey(pem);
}

/**
 * All of UIDAI's certificates, comma-separated (UIDAI has changed its signing certificate over the years, and an
 * Aadhaar printed or downloaded earlier stays signed with the one in use then).
 */
export function uidaiKeys(certsB64: string): KeyObject[] {
  return certsB64.split(',').map((c) => c.trim()).filter(Boolean).map(uidaiKey);
}

/** QR text (digits) → bytes. */
function bigDecimalToBytes(text: string): Buffer {
  const digits = text.trim();
  if (!/^\d{50,}$/.test(digits)) throw new AadhaarQrError(/^</.test(digits) ? 'OLD_FORMAT' : 'UNREADABLE');
  let hex = BigInt(digits).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Buffer.from(hex, 'hex');
}

function decompress(bytes: Buffer): Buffer {
  for (const fn of [gunzipSync, inflateSync]) {
    try {
      return fn(bytes, { maxOutputLength: 64 * 1024 });
    } catch {
      // try the next
    }
  }
  throw new AadhaarQrError('UNREADABLE');
}

/** Reads and verifies a scanned Aadhaar Secure QR. Throws AadhaarQrError for anything not genuine or not readable. */
export function verifyAadhaarQr(qrText: string, uidai: KeyObject | readonly KeyObject[]): AadhaarQrDetails {
  if (qrText.length > 8000) throw new AadhaarQrError('UNREADABLE');
  const data = decompress(bigDecimalToBytes(qrText));
  if (data.length <= SIGNATURE_BYTES + 32) throw new AadhaarQrError('INCOMPLETE');

  const signed = data.subarray(0, data.length - SIGNATURE_BYTES);
  const signature = data.subarray(data.length - SIGNATURE_BYTES);
  const genuine = (Array.isArray(uidai) ? uidai : [uidai]).some((key: KeyObject) => {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signed);
    return verifier.verify(key, signature);
  });
  if (!genuine) throw new AadhaarQrError('BAD_SIGNATURE');

  // Text fields: split on 255 up to the photo.
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < signed.length && fields.length < TEXT_FIELDS + 1; i++) {
    if (signed[i] === DELIMITER) {
      fields.push(signed.subarray(start, i).toString('latin1'));
      start = i + 1;
    }
  }
  const version = fields[0] ?? '';
  // V1 QR codes have no version field (and no signature over the full data): too old to trust.
  if (!/^V\d+$/.test(version)) throw new AadhaarQrError('OLD_FORMAT');
  if (fields.length < TEXT_FIELDS) throw new AadhaarQrError('INCOMPLETE');
  const decode = (s: string | undefined) => Buffer.from(s ?? '', 'latin1').toString('utf8').trim();
  const reference = decode(fields[2]);
  const last4 = reference.slice(0, 4);
  if (!/^\d{4}$/.test(last4)) throw new AadhaarQrError('INCOMPLETE');
  const dob = decode(fields[4]);
  const year = /(\d{4})$/.exec(dob)?.[1];
  const gender = decode(fields[5]).toUpperCase();
  return {
    version,
    last4,
    name: decode(fields[3]).replace(/\s+/g, ' '),
    dateOfBirth: dob,
    yearOfBirth: year ? Number(year) : null,
    gender: gender === 'M' || gender === 'F' || gender === 'T' ? gender : null,
    pincode: decode(fields[11]),
    generatedAt: referenceTime(reference.slice(4)),
  };
}

/** "YYYYMMDDHHMMSSsss" (IST) → epoch ms. */
function referenceTime(ts: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{0,3})/.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms || 0)) - 5.5 * 3_600_000;
  return Number.isFinite(t) ? t : null;
}

/**
 * Does the name on the Aadhaar match the legal name the technician entered? Case, dots, extra spaces and word order
 * are ignored; initials match a full word that starts with them ("S. Naidu" ≈ "Swathi Naidu"). Every word of the
 * shorter name must match a different word of the longer one.
 */
export function namesMatch(a: string, b: string): boolean {
  const words = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[.,'-]/g, ' ').split(/\s+/).filter(Boolean);
  const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  if (short.length === 0) return false;
  const used = new Set<number>();
  for (const w of short) {
    const i = long.findIndex((v, k) => !used.has(k) && (v === w || (w.length === 1 && v.startsWith(w)) || (v.length === 1 && w.startsWith(v))));
    if (i < 0) return false;
    used.add(i);
  }
  // At least one full word (not only initials) must match.
  return short.some((w) => w.length > 1);
}

/**
 * A one-way fingerprint of the person (name, date of birth, gender, last 4 digits), keyed with a server secret: it
 * stops one person from registering as several technicians without storing anything that identifies them.
 */
export function identityFingerprint(d: AadhaarQrDetails, key: Buffer): Buffer {
  const norm = `${d.name.toLowerCase().replace(/\s+/g, ' ')}|${d.dateOfBirth}|${d.gender ?? ''}|${d.last4}`;
  return createHmac('sha256', key).update(norm).digest();
}
