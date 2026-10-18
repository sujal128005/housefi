import { generateKeyPairSync } from 'node:crypto';
import { AccessTokens } from './access-tokens';

function pair(type: 'ed25519' | 'ec' = 'ed25519') {
  const privateKeyEncoding = { type: 'pkcs8', format: 'pem' } as const;
  const publicKeyEncoding = { type: 'spki', format: 'pem' } as const;
  const k =
    type === 'ec'
      ? generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding, publicKeyEncoding })
      : generateKeyPairSync('ed25519', { privateKeyEncoding, publicKeyEncoding });
  return { privateKeyB64: Buffer.from(k.privateKey).toString('base64'), publicKeyB64: Buffer.from(k.publicKey).toString('base64') };
}

const claims = { sub: '6f1c2d3e-0000-4000-8000-000000000001', role: 'CUSTOMER' as const, sid: '6f1c2d3e-0000-4000-8000-000000000002' };
const keys = pair();

function tokens(now: () => number, overrides: Partial<ConstructorParameters<typeof AccessTokens>[0]> = {}) {
  return new AccessTokens({ ...keys, issuer: 'https://api.housefi.app', ttlSec: 900, now, ...overrides });
}

describe('AccessTokens', () => {
  let t = 1_792_150_000_000;
  const at = tokens(() => t);

  it('signs EdDSA JWTs and verifies them back to the claims', () => {
    const jwt = at.sign(claims);
    const header = JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString());
    expect(header).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: expect.any(String) });
    expect(at.verify(jwt)).toEqual({ ...claims, expiresAt: expect.any(Number), remainingMs: expect.any(Number) });
  });

  it('expires after the TTL (with 30 s leeway)', () => {
    const jwt = at.sign(claims);
    t += 900_000 + 29_000;
    expect(at.verify(jwt)).toEqual({ ...claims, expiresAt: expect.any(Number), remainingMs: expect.any(Number) });
    t += 2_000;
    expect(() => at.verify(jwt)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });

  it('rejects tokens from another key, issuer or a tampered payload', () => {
    const jwt = at.sign(claims);
    expect(() => tokens(() => t, pair()).verify(jwt)).toThrow();
    expect(() => tokens(() => t, { issuer: 'https://evil.example' }).verify(jwt)).toThrow();
    const [h, p, s] = jwt.split('.');
    const admin = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), role: 'ADMIN' })).toString('base64url');
    expect(() => at.verify(`${h}.${admin}.${s}`)).toThrow();
  });

  it('rejects alg "none" and garbage', () => {
    const p = at.sign(claims).split('.')[1];
    expect(() => at.verify(`${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`)).toThrow();
    expect(() => at.verify('a.b')).toThrow();
    expect(() => at.verify('')).toThrow();
  });

  it('refuses non-Ed25519 keys and mismatched key pairs', () => {
    expect(() => tokens(() => t, pair('ec'))).toThrow('Ed25519');
    expect(() => tokens(() => t, { publicKeyB64: pair().publicKeyB64 })).toThrow('does not match');
  });
});
