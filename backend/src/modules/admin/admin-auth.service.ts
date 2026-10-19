// Super admin sign-in: username + password, then a passkey (Windows Hello face, fingerprint or PIN) on every sign-in.
// The first sign-in registers the passkey; later devices are added only from the command line.
//
// Guessing is stopped at every level:
// - per network address and per username, few tries per window (Redis; when Redis is down, sign-in is refused);
// - an account locks for 15 minutes after 5 wrong passwords, for a day after 10 (the command line unlocks it);
// - a slow password hash (scrypt), checked even for unknown usernames, and the same answer for every failure;
// - the passkey step must follow within 5 minutes, from the same session; phones are refused.
// Sessions: a random token in an HttpOnly, Secure, SameSite=Strict cookie (stored only as its SHA-256), idle for at
// most 30 minutes, at most 8 hours in all; every sign-in, failure and sign-out is in the audit log.
import { Injectable, Logger } from '@nestjs/common';
import type { AdminSession, AdminUser } from '@prisma/client';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { spendTime, verifyPassword } from './admin-password';
import { AdminRecoveryService } from './admin-recovery.service';

const MIN = 60_000;
export const PASSKEY_STEP_MS = 5 * MIN;
export const IDLE_MS = 30 * MIN;
export const MAX_SESSION_MS = 8 * 60 * MIN;
/** Wrong passwords before a lock, and how long. */
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * MIN;
export const LONG_LOCK_AFTER = 10;
export const LONG_LOCK_MS = 24 * 60 * MIN;
export const COOKIE = 'hf_admin';

/** Who is asking: from the Cloudflare edge (the only way in), else the socket. */
export interface Requester {
  readonly ip: string;
  readonly userAgent: string;
}

export type SignedInAdmin = Pick<AdminUser, 'id' | 'username' | 'displayName'> & { readonly sessionId: string };

const sha256 = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());
const newToken = () => randomBytes(32).toString('base64url');
/** Phones and tablets: the portal is for laptops only. */
export const isMobile = (ua: string) => /android|iphone|ipad|ipod|mobile|silk|kindle|opera mini/i.test(ua);
const fail = () => new AppError('UNAUTHENTICATED', {}, 'wrong username or password');

@Injectable()
export class AdminAuthService {
  private readonly log = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly recovery: AdminRecoveryService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  private get rpID(): string {
    if (!this.config.ADMIN_HOST) throw new AppError('NOT_FOUND');
    return this.config.ADMIN_HOST;
  }

  private get origin(): string {
    return `https://${this.rpID}`;
  }

  // ---------- step 1: password ----------

  /** Returns a short-lived session token for the passkey step, and whether this admin still has to register one. */
  async password(username: string, password: string, who: Requester): Promise<{ token: string; next: 'REGISTER' | 'PASSKEY' }> {
    if (isMobile(who.userAgent)) throw new AppError('NOT_FOUND', {}, 'the portal opens on a laptop only');
    const name = username.trim().toLowerCase();
    // Before anything else, and also when Redis is down (closed): guesses from one place, and at one account.
    await this.limits.consume(`admin:ip:${who.ip}`, { limit: 10, windowSec: 15 * 60, onStoreError: 'closed' });
    await this.limits.consume(`admin:user:${name}`, { limit: 6, windowSec: 15 * 60, onStoreError: 'closed' });

    const admin = await this.prisma.adminUser.findUnique({ where: { username: name }, include: { _count: { select: { passkeys: true } } } });
    const now = this.clock.now();
    if (!admin || admin.disabledAt) {
      await spendTime(password);
      await this.record(null, 'admin.login_failed', { reason: 'unknown' }, who);
      throw fail();
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > now) {
      await spendTime(password);
      await this.record(admin.id, 'admin.login_failed', { reason: 'locked' }, who);
      throw new AppError('RATE_LIMITED', { retryAfterSec: Math.ceil((admin.lockedUntil.getTime() - now) / 1000) }, 'account locked for now');
    }
    if (!(await verifyPassword(password, admin.passwordHash))) {
      const failed = admin.failedLogins + 1;
      const lockMs = failed >= LONG_LOCK_AFTER ? LONG_LOCK_MS : failed >= LOCK_AFTER ? LOCK_MS : 0;
      await this.prisma.adminUser.update({ where: { id: admin.id }, data: { failedLogins: failed, ...(lockMs ? { lockedUntil: new Date(now + lockMs) } : {}) } });
      await this.record(admin.id, 'admin.login_failed', { reason: 'password', failed, ...(lockMs ? { lockedMin: lockMs / MIN } : {}) }, who);
      if (lockMs) this.log.warn(`admin account ${admin.username} locked for ${lockMs / MIN} min after ${failed} wrong passwords`);
      throw fail();
    }
    const token = newToken();
    await this.prisma.adminSession.create({
      data: { adminId: admin.id, tokenHash: sha256(token), stage: 'PASSWORD_OK', ip: who.ip, userAgent: who.userAgent.slice(0, 300), createdAt: new Date(now), lastSeenAt: new Date(now), expiresAt: new Date(now + PASSKEY_STEP_MS) },
    });
    await this.record(admin.id, 'admin.password_ok', {}, who);
    return { token, next: admin._count.passkeys === 0 ? 'REGISTER' : 'PASSKEY' };
  }

  // ---------- step 2: passkey ----------

  /** The WebAuthn options for this step: registering the first passkey, or signing in with one. */
  async passkeyOptions(token: string, who: Requester): Promise<{ mode: 'REGISTER' | 'PASSKEY'; options: unknown }> {
    const { session, admin } = await this.pending(token, who);
    const passkeys = await this.prisma.adminPasskey.findMany({ where: { adminId: admin.id } });
    if (passkeys.length === 0) {
      const options = await generateRegistrationOptions({
        rpName: 'Housefi HQ',
        rpID: this.rpID,
        userName: admin.username,
        userDisplayName: admin.displayName,
        userID: new TextEncoder().encode(admin.id),
        attestationType: 'none',
        // This laptop's own authenticator (Windows Hello), and it must check the person (face, finger or PIN).
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      });
      await this.prisma.adminSession.update({ where: { id: session.id }, data: { challenge: options.challenge } });
      return { mode: 'REGISTER', options };
    }
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
    });
    await this.prisma.adminSession.update({ where: { id: session.id }, data: { challenge: options.challenge } });
    return { mode: 'PASSKEY', options };
  }

  /** Checks the passkey answer; on success the session becomes a full sign-in under a new token. */
  async passkeyVerify(token: string, response: unknown, deviceName: string, who: Requester): Promise<{ token: string }> {
    const { session, admin } = await this.pending(token, who);
    if (!session.challenge) throw new AppError('CONFLICT', {}, 'ask for the passkey options first');
    await this.limits.consume(`admin:passkey:${admin.id}`, { limit: 10, windowSec: 15 * 60, onStoreError: 'closed' });
    const passkeys = await this.prisma.adminPasskey.findMany({ where: { adminId: admin.id } });
    const expected = { expectedChallenge: session.challenge, expectedOrigin: this.origin, expectedRPID: this.rpID, requireUserVerification: true };
    try {
      if (passkeys.length === 0) {
        const r = await verifyRegistrationResponse({ ...expected, response: response as RegistrationResponseJSON });
        if (!r.verified) throw new Error('not verified');
        const c = r.registrationInfo.credential;
        await this.prisma.adminPasskey.create({
          data: { adminId: admin.id, credentialId: c.id, publicKey: new Uint8Array(c.publicKey), counter: BigInt(c.counter), transports: c.transports ?? [], deviceName: deviceName.slice(0, 60) || 'Laptop', createdAt: new Date(this.clock.now()) },
        });
        await this.record(admin.id, 'admin.passkey_registered', { device: deviceName.slice(0, 60) }, who);
      } else {
        const answer = response as AuthenticationResponseJSON;
        const key = passkeys.find((p) => p.credentialId === answer.id);
        if (!key) throw new Error('unknown passkey');
        const r = await verifyAuthenticationResponse({
          ...expected,
          response: answer,
          credential: { id: key.credentialId, publicKey: new Uint8Array(key.publicKey), counter: Number(key.counter), transports: key.transports },
        });
        if (!r.verified) throw new Error('not verified');
        await this.prisma.adminPasskey.update({ where: { id: key.id }, data: { counter: BigInt(r.authenticationInfo.newCounter), lastUsedAt: new Date(this.clock.now()) } });
      }
    } catch (err) {
      await this.prisma.adminSession.update({ where: { id: session.id }, data: { challenge: null } });
      await this.record(admin.id, 'admin.passkey_failed', { reason: (err as Error).message.slice(0, 80) }, who);
      throw new AppError('UNAUTHENTICATED', {}, 'the face, fingerprint or PIN check did not pass');
    }
    // A new token for the full sign-in (the password-step token is never valid again).
    const next = newToken();
    const now = this.clock.now();
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: { tokenHash: sha256(next), stage: 'VERIFIED', challenge: null, lastSeenAt: new Date(now), expiresAt: new Date(now + MAX_SESSION_MS) },
    });
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(now) } });
    await this.record(admin.id, 'admin.signed_in', {}, who);
    // The owner is here: a recovery someone started for this account is cancelled.
    await this.recovery.cancelOnSignIn(admin.id, who.ip);
    return { token: next };
  }

  // ---------- signed in ----------

  /** The admin behind a full sign-in, or UNAUTHENTICATED. Each use keeps the session alive (idle limit). */
  async signedIn(token: string | undefined): Promise<SignedInAdmin> {
    if (!token) throw new AppError('UNAUTHENTICATED');
    const now = this.clock.now();
    const session = await this.prisma.adminSession.findUnique({ where: { tokenHash: sha256(token) }, include: { admin: true } });
    if (!session || session.stage !== 'VERIFIED' || session.revokedAt || session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_MS || session.admin.disabledAt) {
      throw new AppError('UNAUTHENTICATED');
    }
    // At most once a minute, so a busy screen does not write on every request.
    if (now - session.lastSeenAt.getTime() > MIN) await this.prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    return { id: session.admin.id, username: session.admin.username, displayName: session.admin.displayName, sessionId: session.id };
  }

  async signOut(token: string | undefined, who: Requester): Promise<void> {
    if (!token) return;
    const session = await this.prisma.adminSession.findUnique({ where: { tokenHash: sha256(token) } });
    if (!session || session.revokedAt) return;
    await this.prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date(this.clock.now()) } });
    await this.record(session.adminId, 'admin.signed_out', {}, who);
  }

  /** The password step's session: same browser, within 5 minutes, not used up. */
  private async pending(token: string | undefined, who: Requester): Promise<{ session: AdminSession; admin: AdminUser }> {
    if (!token) throw new AppError('UNAUTHENTICATED');
    const session = await this.prisma.adminSession.findUnique({ where: { tokenHash: sha256(token) }, include: { admin: true } });
    if (!session || session.stage !== 'PASSWORD_OK' || session.revokedAt || session.expiresAt.getTime() <= this.clock.now() || session.admin.disabledAt || session.userAgent !== who.userAgent.slice(0, 300)) {
      throw new AppError('UNAUTHENTICATED', {}, 'sign in again');
    }
    return { session, admin: session.admin };
  }

  private async record(adminId: string | null, action: string, after: Record<string, string | number>, who: Requester): Promise<void> {
    await this.audit.record({ actorType: 'ADMIN', actorId: adminId, action, entity: 'admin', entityId: adminId ?? 'unknown', after, ip: who.ip });
  }
}
