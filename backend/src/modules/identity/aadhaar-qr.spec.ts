import { generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AadhaarQrError, identityFingerprint, namesMatch, uidaiKey, uidaiKeys, verifyAadhaarQr } from './aadhaar-qr';

const uidai = generateKeyPairSync('rsa', { modulusLength: 2048 });
const forger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const olderUidai = generateKeyPairSync('rsa', { modulusLength: 2048 });
/** A self-signed test certificate (public part only; not UIDAI's), as a .cer file is: DER bytes, here in base64. */
const TEST_CER_B64 = 'MIIDPzCCAiegAwIBAgIUOyb4SwN3a1PCN2P/ba5gw13c878wDQYJKoZIhvcNAQELBQAwLzEtMCsGA1UEAwwkSG91c2VmaSB0ZXN0IGNlcnRpZmljYXRlIChub3QgVUlEQUkpMB4XDTI2MTAxOTEyNDIzMloXDTM2MTAxNjEyNDIzMlowLzEtMCsGA1UEAwwkSG91c2VmaSB0ZXN0IGNlcnRpZmljYXRlIChub3QgVUlEQUkpMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsCr4xPIH6Qv8hZeS4KO8bybLQodeyJ5Mx+p5mWLQOY3dK3Em/yvv5iF0OBn3sfSYlB3c6gApJE05c3AiSP9yvijy8sjRNtrJB5UOsz/VKcz/Yizl4iTwOMj1OWv4LXb3rIxPyN5h2Flw9oPQDc2tqYAngYlIVKa6OUAKvbpjAs0x7xNtearugcji79xa2zXAORp/7L3O1kIt9zpZiX7juLk3Cav/hH4s46QH858SHnqgN/x0cs7fqxbeWoKOg6pQ3SwGQrkzHk4/SoP2EGG7ydYSK5ZI8THZH4ByPQiKmXwccXAJeHqQt26murhm1lWp255B/B+8IAFTmKSGHvCYFwIDAQABo1MwUTAdBgNVHQ4EFgQUEudolgPBmjsQhLoyo4hfRPIeF2kwHwYDVR0jBBgwFoAUEudolgPBmjsQhLoyo4hfRPIeF2kwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAKGNJunU6teZ5EKX2386ftVOovj7fhx3S2c0wlv4TEtiziRPBJ35dLpWjLsgVUurBdBUjbdIZ7wDmaPLfV2maosrwMe4taP3FRk6zEkIasSA5ovayUl/sMPfRGe0A3avGgUKamAWlySjg6btzEsGdo6ulAHX5QTjBD13W/a+sn2cn1WfA+Q7Fy3NMxzcKU54gSr0biz9V4uGe7sm/oMGzTjNZPhqEnEjllM6S/f3woK+/ve9bm55RqD8hht0TBmq8G1RM+dwzVjmxZP0OcEeZZH9mKdw72BrAWbtUuaPuQIPJQN7iuyQj4sQop723Ty/zO/A0AsVN7IsAkFxivXPZ2Q==';

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

  it("accepts a QR signed with any of UIDAI's certificates (an older Aadhaar keeps an older signature)", () => {
    const keys = [uidai.publicKey, olderUidai.publicKey];
    expect(verifyAadhaarQr(makeQr(FIELDS, olderUidai.privateKey), keys).last4).toBe('1234');
    expect(verifyAadhaarQr(makeQr(FIELDS), keys).last4).toBe('1234');
    expect(() => verifyAadhaarQr(makeQr(FIELDS, forger.privateKey), keys)).toThrow(new AadhaarQrError('BAD_SIGNATURE'));
  });

  it('loads certificates as UIDAI publishes them (.cer, DER) or as PEM, several separated by commas', () => {
    const cert = new X509Certificate(Buffer.from(TEST_CER_B64, 'base64'));
    const pemB64 = Buffer.from(cert.toString()).toString('base64');
    const spkiPemB64 = Buffer.from(uidai.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
    expect(uidaiKey(TEST_CER_B64).equals(cert.publicKey)).toBe(true);
    expect(uidaiKey(pemB64).equals(cert.publicKey)).toBe(true);
    const keys = uidaiKeys(` ${TEST_CER_B64}, ${spkiPemB64},`);
    expect(keys).toHaveLength(2);
    expect(keys[1]?.equals(uidai.publicKey)).toBe(true);
    expect(() => uidaiKeys('bm90IGEgY2VydGlmaWNhdGU=')).toThrow();
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
