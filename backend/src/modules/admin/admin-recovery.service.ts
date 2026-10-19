// "Forgot password" for super admins, like Apple's account recovery: the username, the phone number on the account and
// a one-time code start it; then a wait of 2 to 5 hours (by the time of day, India time) that no one can shorten. If
// the owner signs in normally meanwhile, it is cancelled (an attacker with only the phone gets nowhere), and every
// signed-in admin sees that a recovery is waiting. After the wait, the same browser may set a new password; every
// session is then signed out, and the passkey (Windows Hello) is still needed to sign in.
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { istHour } from '../slots/slot-rules';
import type { Requester } from './admin-auth.service';
import { hashPassword, spendTime } from './admin-password';

const HOUR = 3_600_000;
export const RECOVERY_COOKIE = 'hf_admin_recovery';
/** A new password: long, so it is never something guessable. */
export const MIN_PASSWORD_LENGTH = 16;

/** Hours a recovery waits, by when it was asked (India time): 2 by day, 3 in the evening, 5 at night. */
export function recoveryHours(at: number): 2 | 3 | 5 {
  const h = istHour(at);
  if (h >= 9 && h < 18) return 2;
  if (h >= 18 && h < 22) return 3;
  return 5;
}

export interface RecoveryStatusDto {
  readonly state: 'WAITING' | 'READY' | 'CANCELLED' | 'DONE';
  /** From when the new password may be set (ms). */
  readonly readyAt: number;
}

const sha256 = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const refused = () => new AppError('UNAUTHENTICATED', {}, 'those details do not match an account');

@Injectable()
export class AdminRecoveryService {
  private readonly log = new Logger(AdminRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: Hashing,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** Starts a recovery; returns the token for this browser's cookie and when it will be ready. */
  async start(username: string, phone: string, code: string, who: Requester): Promise<{ token: string; readyAt: number }> {
    if (!this.config.ADMIN_RECOVERY_CODE) throw new AppError('NOT_FOUND', {}, 'recovery is not set up');
    const name = username.trim().toLowerCase();
    await this.limits.consume(`admin:recover:ip:${who.ip}`, { limit: 5, windowSec: 60 * 60, onStoreError: 'closed' });
    await this.limits.consume(`admin:recover:user:${name}`, { limit: 3, windowSec: 24 * 60 * 60, onStoreError: 'closed' });
    const admin = await this.prisma.adminUser.findUnique({ where: { username: name } });
    const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    const phoneOk = !!admin && same(Buffer.from(admin.phoneHash).toString('hex'), Buffer.from(this.hashing.phone(digits)).toString('hex'));
    const codeOk = same(code.trim(), this.config.ADMIN_RECOVERY_CODE);
    await spendTime(code); // the same time whatever was wrong
    if (!admin || admin.disabledAt || !phoneOk || !codeOk) {
      await this.audit.record({ actorType: 'ADMIN', actorId: admin?.id ?? null, action: 'admin.recovery_refused', entity: 'admin', entityId: admin?.id ?? 'unknown', ip: who.ip });
      throw refused();
    }
    const now = this.clock.now();
    const token = randomBytes(32).toString('base64url');
    const readyAt = now + recoveryHours(now) * HOUR;
    await this.prisma.$transaction(async (tx) => {
      // One recovery at a time: a new one replaces any still waiting.
      await tx.adminRecovery.updateMany({ where: { adminId: admin.id, completedAt: null, cancelledAt: null }, data: { cancelledAt: new Date(now) } });
      await tx.adminRecovery.create({ data: { adminId: admin.id, tokenHash: sha256(token), ip: who.ip, userAgent: who.userAgent, createdAt: new Date(now), readyAt: new Date(readyAt) } });
      await this.audit.record({ actorType: 'ADMIN', actorId: admin.id, action: 'admin.recovery_started', entity: 'admin', entityId: admin.id, after: { readyAt: new Date(readyAt).toISOString() }, ip: who.ip }, tx);
    });
    this.log.warn(`account recovery started for admin ${admin.username}; ready ${new Date(readyAt).toISOString()}`);
    return { token, readyAt };
  }

  async status(token: string | undefined): Promise<RecoveryStatusDto> {
    const r = await this.find(token);
    return { state: r.completedAt ? 'DONE' : r.cancelledAt ? 'CANCELLED' : r.readyAt.getTime() <= this.clock.now() ? 'READY' : 'WAITING', readyAt: r.readyAt.getTime() };
  }

  /** After the wait, from the same browser: the new password; every session is signed out. */
  async complete(token: string | undefined, password: string, who: Requester): Promise<void> {
    const r = await this.find(token);
    const now = this.clock.now();
    if (r.completedAt || r.cancelledAt) throw new AppError('CONFLICT', {}, 'this recovery is over; start again if you still need it');
    if (r.readyAt.getTime() > now) throw new AppError('CONFLICT', { retryAfterSec: Math.ceil((r.readyAt.getTime() - now) / 1000) }, 'the waiting time is not over yet');
    if (r.userAgent !== who.userAgent) throw refused();
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: r.adminId } });
    if (password.length < MIN_PASSWORD_LENGTH || password.toLowerCase().includes(admin.username.split('.')[1] ?? admin.username)) {
      throw new AppError('VALIDATION', { fields: { password: 'INVALID' } }, `at least ${MIN_PASSWORD_LENGTH} characters, not containing your name`);
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: admin.id }, data: { passwordHash, passwordChangedAt: new Date(now), failedLogins: 0, lockedUntil: null } });
      await tx.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date(now) } });
      await tx.adminRecovery.update({ where: { id: r.id }, data: { completedAt: new Date(now) } });
      await this.audit.record({ actorType: 'ADMIN', actorId: admin.id, action: 'admin.password_reset_by_recovery', entity: 'admin', entityId: admin.id, ip: who.ip }, tx);
    });
  }

  /** The owner signed in: any recovery waiting for their account is cancelled. */
  async cancelOnSignIn(adminId: string, ip: string): Promise<void> {
    const n = await this.prisma.adminRecovery.updateMany({ where: { adminId, completedAt: null, cancelledAt: null }, data: { cancelledAt: new Date(this.clock.now()) } });
    if (n.count > 0) await this.audit.record({ actorType: 'ADMIN', actorId: adminId, action: 'admin.recovery_cancelled_by_sign_in', entity: 'admin', entityId: adminId, ip });
  }

  /** A signed-in admin cancels a waiting recovery (theirs, or the other admin's they did not ask for). */
  async cancel(byAdminId: string, recoveryId: string, ip: string): Promise<void> {
    const r = await this.prisma.adminRecovery.updateMany({ where: { id: recoveryId, completedAt: null, cancelledAt: null }, data: { cancelledAt: new Date(this.clock.now()) } });
    if (r.count === 0) throw new AppError('NOT_FOUND');
    await this.audit.record({ actorType: 'ADMIN', actorId: byAdminId, action: 'admin.recovery_cancelled', entity: 'admin_recovery', entityId: recoveryId, ip });
  }

  /** Recoveries waiting for any admin account: every signed-in admin sees them. */
  async waiting(): Promise<{ id: string; displayName: string; createdAt: number; readyAt: number }[]> {
    const rows = await this.prisma.adminRecovery.findMany({ where: { completedAt: null, cancelledAt: null }, include: { admin: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ id: r.id, displayName: r.admin.displayName, createdAt: r.createdAt.getTime(), readyAt: r.readyAt.getTime() }));
  }

  private async find(token: string | undefined) {
    if (!token) throw new AppError('NOT_FOUND');
    const r = await this.prisma.adminRecovery.findUnique({ where: { tokenHash: sha256(token) } });
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }
}
