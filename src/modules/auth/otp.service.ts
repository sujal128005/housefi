import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OtpChallengeDto {
  readonly challengeId: string;
  readonly phone: string;
  readonly resendAfterSec: number;
  readonly expiresAt: number;
  /** Only the app's demo backend returns the code. Always null here. */
  readonly demoCode: null;
}

export interface VerifiedPhone {
  readonly role: UserRole;
  readonly phone: string;
  readonly phoneHash: Bytes;
}

const retryAfter = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

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

  /** Creates a challenge and sends the code. Older open challenges for the same phone and role stop working. */
  async request(phone: string, role: 'CUSTOMER' | 'TECHNICIAN', ip: string | null): Promise<OtpChallengeDto> {
    const phoneHash = this.hashing.phone(phone);
    const now = this.clock.now();
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = now + this.config.OTP_TTL_SEC * 1000;
    const phoneEnc = await this.cipher.encrypt('otp_challenges.phone', phone);

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

      await tx.otpChallenge.updateMany({
        where: { phoneHash, role, consumedAt: null, expiresAt: { gt: new Date(now) } },
        data: { expiresAt: new Date(now) },
      });
      await tx.otpChallenge.create({
        data: { id, phoneHash, phoneEnc, role, codeHash: this.hashing.otp(id, code), expiresAt: new Date(expiresAt), ip, createdAt: new Date(now) },
      });
    });

    try {
      await this.sms.sendOtp(phone, code);
    } catch (err) {
      this.log.error(`sign-in code not sent (${(err as Error).message})`);
      await this.prisma.otpChallenge.update({ where: { id }, data: { expiresAt: new Date(now) } });
      throw new AppError('INTERNAL', {}, 'SMS could not be sent');
    }
    return { challengeId: id, phone, resendAfterSec: this.config.OTP_RESEND_AFTER_SEC, expiresAt, demoCode: null };
  }

  /**
   * Checks a code. Every attempt is counted before the comparison, in one atomic update, so parallel guesses cannot
   * exceed OTP_MAX_ATTEMPTS. A correct code consumes the challenge (single use).
   */
  async verify(challengeId: string, code: string): Promise<VerifiedPhone> {
    if (!UUID.test(challengeId)) throw new AppError('OTP_EXPIRED');
    const now = new Date(this.clock.now());
    const max = this.config.OTP_MAX_ATTEMPTS;
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
      const left = max - row.attempts;
      throw left <= 0 ? new AppError('OTP_LOCKED') : new AppError('OTP_INVALID', { attemptsLeft: left });
    }
    const consumed = await this.prisma.otpChallenge.updateMany({ where: { id: challengeId, consumedAt: null }, data: { consumedAt: now } });
    if (consumed.count === 0) throw new AppError('OTP_EXPIRED');
    return { role: row.role, phone: await this.cipher.decrypt('otp_challenges.phone', row.phone_enc), phoneHash: new Uint8Array(row.phone_hash) };
  }
}
