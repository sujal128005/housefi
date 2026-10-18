import { generateKeyPairSync, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AadhaarQrError, identityFingerprint, namesMatch, verifyAadhaarQr } from './aadhaar-qr';

const uidai = generateKeyPairSync('rsa', { modulusLength: 2048 });
const forger = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** Builds a QR text the way UIDAI does: fields | photo | signature, gzip, as one big decimal number. */
function makeQr(fields: string[], key = uidai.privateKey, tamper?: (b: Buffer) => void): string {
  const text = Buffer.concat(fields.map((f) => Buffer.concat([Buffer.from(f, 'utf8'), Buffer.from([255])])));
  const photo = Buffer.from([0xff, 0x4f, 0xff, 0x51, 1, 2, 3, 4, 5, 6, 7, 8]);
  const body = Buffer.concat([text, photo]);
  const signature = sign('sha256', body, key);
  const data = Buffer.concat([body, signature]);
  tamper?.(data);
  return BigInt(`0x${gzipSync(data).toString('hex')}`).toString(10);
}

const FIELDS = ['V2', '3', '1234' + '20261012153045123', 'Swathi Naidu', '14-08-1994', 'F', 'D/O Ramesh', 'Hyderabad', '', '4-12', 'Banjara Hills', '500034', 'Banjara Hills', 'Telangana', 'Road 12', 'Khairatabad', 'Hyderabad'];

describe('Aadhaar Secure QR', () => {
  it('reads a genuine QR: last 4 digits, name, birth year, gender, PIN; never the number itself', () => {
    const d = verifyAadhaarQr(makeQr(FIELDS), uidai.publicKey);
    expect(d).toEqual({
      version: 'V2', last4: '1234', name: 'Swathi Naidu', dateOfBirth: '14-08-1994', yearOfBirth: 1994, gender: 'F', pincode: '500034',
      generatedAt: Date.UTC(2026, 9, 12, 15, 30, 45, 123) - 5.5 * 3_600_000,
    });
  });

  it('refuses a QR signed by anyone but UIDAI, or changed after signing', () => {
    expect(() => verifyAadhaarQr(makeQr(FIELDS, forger.privateKey), uidai.publicKey)).toThrow(new AadhaarQrError('BAD_SIGNATURE'));
    const tampered = makeQr(FIELDS, uidai.privateKey, (b) => b.write('Q', 30));
    expect(() => verifyAadhaarQr(tampered, uidai.publicKey)).toThrow(new AadhaarQrError('BAD_SIGNATURE'));
  });

  it('refuses old (V1, unsigned XML) and unreadable codes', () => {
    expect(() => verifyAadhaarQr('<?xml version="1.0"?><PrintLetterBarcodeData uid="123412341234"/>', uidai.publicKey)).toThrow(new AadhaarQrError('OLD_FORMAT'));
    expect(() => verifyAadhaarQr('12345', uidai.publicKey)).toThrow(AadhaarQrError);
    expect(() => verifyAadhaarQr('9'.repeat(400), uidai.publicKey)).toThrow(AadhaarQrError);
    expect(() => verifyAadhaarQr(makeQr(['1', ...FIELDS.slice(1)]), uidai.publicKey)).toThrow(new AadhaarQrError('OLD_FORMAT'));
  });

  it('matches names the way people write them', () => {
    expect(namesMatch('Swathi Naidu', 'swathi  naidu')).toBe(true);
    expect(namesMatch('Naidu Swathi', 'Swathi Naidu')).toBe(true);
    expect(namesMatch('S. Naidu', 'Swathi Naidu')).toBe(true);
    expect(namesMatch('Swathi', 'Swathi Naidu')).toBe(true);
    expect(namesMatch('Ramesh Kumar', 'Swathi Naidu')).toBe(false);
    expect(namesMatch('S. N.', 'Swathi Naidu')).toBe(false);
    expect(namesMatch('', 'Swathi Naidu')).toBe(false);
  });

  it('fingerprints a person without storing who they are', () => {
    const d = verifyAadhaarQr(makeQr(FIELDS), uidai.publicKey);
    const key = Buffer.alloc(32, 1);
    expect(identityFingerprint(d, key)).toEqual(identityFingerprint({ ...d, name: 'swathi  naidu' }, key));
    expect(identityFingerprint(d, key)).not.toEqual(identityFingerprint({ ...d, last4: '9999' }, key));
    expect(identityFingerprint(d, key)).not.toEqual(identityFingerprint(d, Buffer.alloc(32, 2)));
  });
});
