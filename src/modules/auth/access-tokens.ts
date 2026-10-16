// Access tokens: compact JWTs signed with Ed25519 (alg "EdDSA"), 15 minutes by default. Written on node:crypto
// directly so the rules are visible here: only EdDSA is accepted (no "none", no HMAC confusion), issuer, audience
// and expiry are always checked, and the claims are schema-validated.
import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign, verify } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';

export const ROLES = ['CUSTOMER', 'TECHNICIAN', 'COORDINATOR', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export interface AccessClaims {
  /** User id. */
  readonly sub: string;
  readonly role: Role;
  /** Session id = refresh-token family id. */
  readonly sid: string;
}

const Payload = z.object({
  sub: z.uuid(),
  role: z.enum(ROLES),
  sid: z.uuid(),
  iss: z.string(),
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
});

const AUDIENCE = 'housefi-app';
/** Tolerated clock difference between API instances, in seconds. */
const LEEWAY_SEC = 30;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function loadKey(pemB64: string, kind: 'private' | 'public'): KeyObject {
  const pem = Buffer.from(pemB64, 'base64').toString('utf8');
  const key = kind === 'private' ? createPrivateKey(pem) : createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`JWT ${kind} key must be Ed25519`);
  return key;
}

export interface AccessTokenOptions {
  readonly privateKeyB64: string;
  readonly publicKeyB64: string;
  readonly issuer: string;
  readonly ttlSec: number;
  readonly now?: () => number;
}

export class AccessTokens {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  /** Key id: lets a second key be added for rotation later. */
  private readonly kid: string;
  private readonly now: () => number;

  constructor(private readonly opts: AccessTokenOptions) {
    this.privateKey = loadKey(opts.privateKeyB64, 'private');
    this.publicKey = loadKey(opts.publicKeyB64, 'public');
    const derivedPublic = createPublicKey(this.privateKey).export({ format: 'der', type: 'spki' });
    if (!derivedPublic.equals(this.publicKey.export({ format: 'der', type: 'spki' }))) {
      throw new Error('JWT_PUBLIC_KEY_B64 does not match JWT_PRIVATE_KEY_B64');
    }
    this.kid = createHash('sha256').update(derivedPublic).digest('base64url').slice(0, 16);
    this.now = opts.now ?? Date.now;
  }

  get ttlSec(): number {
    return this.opts.ttlSec;
  }

  sign(claims: AccessClaims): string {
    const iat = Math.floor(this.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: this.kid }));
    const payload = b64url(
      JSON.stringify({ sub: claims.sub, role: claims.role, sid: claims.sid, iss: this.opts.issuer, aud: AUDIENCE, iat, exp: iat + this.opts.ttlSec }),
    );
    const signature = sign(null, Buffer.from(`${header}.${payload}`), this.privateKey);
    return `${header}.${payload}.${b64url(signature)}`;
  }

  /** Returns the claims, or throws UNAUTHENTICATED for anything malformed, forged, expired or foreign. */
  verify(token: string): AccessClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new AppError('UNAUTHENTICATED');
    const [h, p, s] = parts as [string, string, string];
    try {
      const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: unknown; kid?: unknown };
      if (header.alg !== 'EdDSA' || header.kid !== this.kid) throw new Error('header');
      if (!verify(null, Buffer.from(`${h}.${p}`), this.publicKey, Buffer.from(s, 'base64url'))) throw new Error('signature');
      const claims = Payload.parse(JSON.parse(Buffer.from(p, 'base64url').toString('utf8')));
      const nowSec = Math.floor(this.now() / 1000);
      if (claims.iss !== this.opts.issuer || claims.aud !== AUDIENCE) throw new Error('issuer/audience');
      if (claims.exp + LEEWAY_SEC <= nowSec || claims.iat - LEEWAY_SEC > nowSec) throw new Error('time');
      return { sub: claims.sub, role: claims.role, sid: claims.sid };
    } catch {
      throw new AppError('UNAUTHENTICATED');
    }
  }
}
