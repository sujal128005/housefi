import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import { isIP } from 'node:net';
import { randomInt, randomUUID } from 'node:crypto';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { type Bytes, digestsEqual, Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SMS_SENDER, type SmsSender } from './sms';

/** Codes per phone number per hour, across both roles (README §7). */
export const OTP_PER_PHONE_PER_HOUR = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Wrong-code counts start again after this long without a wrong code (not after the final lock). */
const LOCK_FORGET_MS = 30 * DAY_MS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OtpChallengeDto {
  readonly challengeId: string;
  readonly phone: string;
  readonly resendAfterSec: number;
  readonly expiresAt: number;
  /** Only the app's demo backend returns the code. Always null here. */
  readonly demoCode: null;
  /** A team demo number (DEMO_PHONES): no SMS is sent; the team's demo code signs in. */
  readonly demoAccount: boolean;
}

export interface VerifiedPhone {
  readonly role: UserRole;
  readonly phone: string;
  readonly phoneHash: Bytes;
}

const retryAfter = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** The client address as stored for forensics: only a real IPv4 / IPv6 address, else nothing. */
const validIp = (ip: string | null): string | null => (ip && isIP(ip) ? ip : null);

@Injectable()
export class OtpService {
  private readonly log = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: Hashing,
    private readonly cipher: FieldCipher,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /**
   * Creates a challenge and sends the code. Older open challenges for the same phone and role stop working.
   *
   * Abuse limits, all in the database so they hold when Redis is down, and all checked before any encryption or SMS
   * work is done:
   * - per phone: OTP_PER_PHONE_PER_HOUR codes an hour (customer and technician together), one resend every
   *   OTP_RESEND_AFTER_SEC per role, and the progressive lock after wrong codes (OTP_LOCK_STEPS, see verify());
   * - for the whole service: OTP_SMS_PER_MINUTE / _HOUR / _DAY real SMS (a request flood cannot drain the balance).
   * Per-IP limits are applied by the route (RateLimitGuard).
   */
  async request(phone: string, role: 'CUSTOMER' | 'TECHNICIAN' | 'COORDINATOR', ip: string | null): Promise<OtpChallengeDto> {
    const phoneHash = this.hashing.phone(phone);
    const now = this.clock.now();
    const expiresAt = now + this.config.OTP_TTL_SEC * 1000;
    const demo = this.isDemoPhone(phone);
    const answer = (challengeId: string): OtpChallengeDto => ({
      challengeId, phone, resendAfterSec: this.config.OTP_RESEND_AFTER_SEC, expiresAt, demoCode: null, demoAccount: demo,
    });

    // Coordinator accounts are made by an admin, never by signing in. An unknown number gets the same answer, but
    // nothing is stored and no SMS is sent: guesses cost nothing and cannot use up anyone's sign-in limits.
    if (role === 'COORDINATOR' && !(await this.prisma.user.findFirst({ where: { role, phoneHash, status: 'ACTIVE' }, select: { id: true } }))) {
      return answer(randomUUID());
    }

    const id = randomUUID();
    const code = demo ? (this.config.DEMO_OTP_CODE as string) : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.$transaction(async (tx) => {
      // Serialise requests for one phone so two parallel requests cannot both slip under the limits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${Buffer.from(phoneHash).readBigInt64BE(0)})`;
      const recent = await tx.otpChallenge.findMany({
        where: { phoneHash, createdAt: { gt: new Date(now - HOUR_MS) } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, role: true },
      });
      const oldest = recent[0];
      if (oldest && recent.length >= OTP_PER_PHONE_PER_HOUR) {
        throw new AppError('RATE_LIMITED', { retryAfterSec: retryAfter(oldest.createdAt.getTime() + HOUR_MS - now) });
      }
      const last = recent.filter((r) => r.role === role).at(-1);
      const resendAt = last ? last.createdAt.getTime() + this.config.OTP_RESEND_AFTER_SEC * 1000 : 0;
      if (resendAt > now) throw new AppError('RATE_LIMITED', { retryAfterSec: retryAfter(resendAt - now) });

      // Locked after too many wrong codes: no new code until the lock ends.
      await this.assertNotLocked(tx, phoneHash, now);

      if (!demo) await this.checkSmsBudget(tx, now);

      await tx.otpChallenge.updateMany({
        where: { phoneHash, role, consumedAt: null, expiresAt: { gt: new Date(now) } },
        data: { expiresAt: new Date(now) },
      });
      const phoneEnc = await this.cipher.encrypt('otp_challenges.phone', phone);
      await tx.otpChallenge.create({
        data: {
          id, phoneHash, phoneEnc, role, codeHash: this.hashing.otp(id, code), expiresAt: new Date(expiresAt), ip: validIp(ip),
          sendsSms: !demo, createdAt: new Date(now),
        },
      });
    });

    // Team demo numbers: no SMS, the code is the team's DEMO_OTP_CODE.
    if (demo) return answer(id);
    try {
      await this.sms.sendOtp(phone, code);
    } catch (err) {
      this.log.error(`sign-in code not sent (${(err as Error).message})`);
      await this.prisma.otpChallenge.update({ where: { id }, data: { expiresAt: new Date(now) } });
      throw new AppError('INTERNAL', {}, 'SMS could not be sent');
    }
    return answer(id);
  }

  /** True for the team's demo numbers (DEMO_PHONES). */
  isDemoPhone(phone: string): boolean {
    return this.config.DEMO_PHONES.includes(phone);
  }

  /** RATE_LIMITED with the time left while the number is locked after wrong codes. */
  private async assertNotLocked(db: Prisma.TransactionClient | PrismaService, phoneHash: Uint8Array, now: number): Promise<void> {
    const lock = await db.otpLockout.findUnique({ where: { phoneHash: Uint8Array.from(phoneHash) }, select: { lockedUntil: true } });
    if (lock?.lockedUntil && lock.lockedUntil.getTime() > now) {
      throw new AppError('RATE_LIMITED', { retryAfterSec: retryAfter(lock.lockedUntil.getTime() - now) });
    }
  }

  /**
   * Counts one wrong code for the number and applies the next lock step when its count is reached (OTP_LOCK_STEPS:
   * 5 wrong → 10 min, 3 more → 1 h, 1 more → 24 h, 1 more → 21 days with the account locked). Counts start again 30
   * days after the last wrong code. Returns the lock length in seconds, or 0. Accounts already signed in keep working:
   * the lock only stops new sign-ins.
   */
  private async recordFailure(phoneHash: Uint8Array, now: number): Promise<number> {
    const steps = this.config.OTP_LOCK_STEPS;
    const hash = Buffer.from(phoneHash);
    const at = new Date(now);
    const forgetBefore = new Date(now - LOCK_FORGET_MS);
    // One atomic statement per step, so parallel wrong guesses are all counted and none is lost.
    const [counted] = await this.prisma.$queryRaw<{ level: number; failures: number }[]>`
      INSERT INTO otp_lockouts (phone_hash, level, failures, last_failure_at) VALUES (${hash}, 0, 1, ${at})
      ON CONFLICT (phone_hash) DO UPDATE SET
        level = CASE WHEN otp_lockouts.last_failure_at < ${forgetBefore} AND otp_lockouts.level < ${steps.length} THEN 0 ELSE otp_lockouts.level END,
        failures = CASE WHEN otp_lockouts.last_failure_at < ${forgetBefore} AND otp_lockouts.level < ${steps.length} THEN 1 ELSE otp_lockouts.failures + 1 END,
        last_failure_at = ${at}
      RETURNING level, failures`;
    if (!counted) return 0;
    const step = steps[Math.min(counted.level, steps.length - 1)] as { failures: number; lockSec: number };
    if (counted.failures < step.failures) return 0;
    // This step is reached: lock, and move to the next step. Only one of several parallel guesses does it.
    const advanced = await this.prisma.$executeRaw`
      UPDATE otp_lockouts SET level = LEAST(level + 1, ${steps.length}), failures = 0, locked_until = ${new Date(now + step.lockSec * 1000)}
      WHERE phone_hash = ${hash} AND level = ${counted.level} AND failures >= ${step.failures}`;
    if (advanced === 0) return step.lockSec;
    const level = Math.min(counted.level + 1, steps.length);
    const final = level >= steps.length;
    // Long locks are alerts: either an attack on the number or a person who needs support.
    const msg = `sign-in locked for one number for ${Math.round(step.lockSec / 60)} min after repeated wrong codes (step ${level} of ${steps.length})`;
    if (final || step.lockSec >= 86_400) this.log.error(`ALERT ${msg}${final ? '; support can unlock it with "npm run support -- unlock <phone>"' : ''}`);
    else this.log.warn(msg);
    return step.lockSec;
  }

  /** Refuses a new SMS when the service-wide budget for the last minute, hour or day is used up, and raises an alert. */
  private async checkSmsBudget(tx: Prisma.TransactionClient, now: number): Promise<void> {
    const [row] = await tx.$queryRaw<{ m: bigint; h: bigint; d: bigint }[]>`
      SELECT count(*) FILTER (WHERE created_at > ${new Date(now - 60_000)})::bigint AS m,
             count(*) FILTER (WHERE created_at > ${new Date(now - HOUR_MS)})::bigint AS h,
             count(*)::bigint AS d
      FROM otp_challenges WHERE sends_sms AND created_at > ${new Date(now - DAY_MS)}`;
    const over: [string, bigint | undefined, number, number][] = [
      ['minute', row?.m, this.config.OTP_SMS_PER_MINUTE, 60],
      ['hour', row?.h, this.config.OTP_SMS_PER_HOUR, 3600],
      ['day', row?.d, this.config.OTP_SMS_PER_DAY, 3600],
    ];
    for (const [window, used, cap, retry] of over) {
      if (Number(used ?? 0) >= cap) {
        // ALERT: a flood of sign-in requests, or real growth past the budget. Investigate, then raise OTP_SMS_PER_*.
        this.log.error(`ALERT sign-in SMS budget reached for the last ${window} (${cap}); new codes are refused`);
        throw new AppError('RATE_LIMITED', { retryAfterSec: retry });
      }
    }
  }

  /**
   * Checks a code. Every attempt is counted before the comparison, in one atomic update, so parallel guesses cannot
   * exceed OTP_MAX_ATTEMPTS. A correct code consumes the challenge (single use).
   */
  async verify(challengeId: string, code: string): Promise<VerifiedPhone> {
    if (!UUID.test(challengeId)) throw new AppError('OTP_EXPIRED');
    const now = new Date(this.clock.now());
    const max = this.config.OTP_MAX_ATTEMPTS;
    // A number that got locked meanwhile cannot keep guessing on a code it already has.
    const owner = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId }, select: { phoneHash: true } });
    if (owner) await this.assertNotLocked(this.prisma, owner.phoneHash, now.getTime());
    const counted = await this.prisma.$queryRaw<{ attempts: number; code_hash: Uint8Array; phone_hash: Uint8Array; phone_enc: Uint8Array; role: UserRole }[]>`
      UPDATE otp_challenges SET attempts = attempts + 1
      WHERE id = ${challengeId}::uuid AND consumed_at IS NULL AND expires_at > ${now} AND attempts < ${max}
      RETURNING attempts, code_hash, phone_hash, phone_enc, role`;
    const row = counted[0];
    if (!row) {
      const ch = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId }, select: { consumedAt: true, expiresAt: true } });
      if (!ch || ch.consumedAt || ch.expiresAt <= now) throw new AppError('OTP_EXPIRED');
      throw new AppError('OTP_LOCKED');
    }
    if (!digestsEqual(this.hashing.otp(challengeId, code), row.code_hash)) {
      const lockedFor = await this.recordFailure(new Uint8Array(row.phone_hash), now.getTime());
      if (lockedFor > 0) throw new AppError('RATE_LIMITED', { retryAfterSec: lockedFor });
      const left = max - row.attempts;
      throw left <= 0 ? new AppError('OTP_LOCKED') : new AppError('OTP_INVALID', { attemptsLeft: left });
    }
    const consumed = await this.prisma.otpChallenge.updateMany({ where: { id: challengeId, consumedAt: null }, data: { consumedAt: now } });
    if (consumed.count === 0) throw new AppError('OTP_EXPIRED');
    // The right code proves the person has the phone: the wrong-code count starts again.
    await this.prisma.otpLockout.deleteMany({ where: { phoneHash: new Uint8Array(row.phone_hash), level: { lt: this.config.OTP_LOCK_STEPS.length } } });
    return { role: row.role, phone: await this.cipher.decrypt('otp_challenges.phone', row.phone_enc), phoneHash: new Uint8Array(row.phone_hash) };
  }
}
