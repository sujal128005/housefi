import { Injectable, Logger } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { type Clock, InjectClock } from '../../common/clock';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AccessTokens } from './access-tokens';
import { SessionCheck } from './session-check';

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Access-token lifetime in seconds. */
  readonly expiresIn: number;
}

export interface Session extends TokenPair {
  readonly userId: string;
  readonly role: UserRole;
}

/** "rt_" + 256 random bits, base64url. */
const REFRESH_FORMAT = /^rt_[A-Za-z0-9_-]{43}$/;

type RotateOutcome = { kind: 'ok'; session: Session } | { kind: 'invalid' } | { kind: 'reused'; familyId: string };

/**
 * Sessions = refresh-token families. Sign-in starts a family; each refresh marks the presented token used and issues
 * a new one in the same family. A used or revoked token coming back means it was copied: the whole family is revoked
 * and the person signs in again. Tokens are stored only as HMACs.
 */
@Injectable()
export class SessionsService {
  private readonly log = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: Hashing,
    private readonly accessTokens: AccessTokens,
    private readonly check: SessionCheck,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async start(userId: string, role: UserRole): Promise<Session> {
    const familyId = randomUUID();
    const refreshToken = await this.issueRefresh(this.prisma, userId, familyId);
    return this.session(userId, role, familyId, refreshToken);
  }

  /** Exchanges a refresh token for a new pair. UNAUTHENTICATED for unknown, expired, revoked or reused tokens. */
  async rotate(refreshToken: string): Promise<Session> {
    if (!REFRESH_FORMAT.test(refreshToken)) throw new AppError('UNAUTHENTICATED');
    const tokenHash = this.hashing.refreshToken(refreshToken);
    const now = new Date(this.clock.now());

    // The transaction returns instead of throwing, so a reuse revocation is committed before we reject.
    const outcome = await this.prisma.$transaction(async (tx): Promise<RotateOutcome> => {
      const current = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { user: { select: { role: true, status: true } } } });
      if (!current) return { kind: 'invalid' };
      const revokeFamily = () => tx.refreshToken.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: now } });
      if (current.usedAt || current.revokedAt) {
        await revokeFamily();
        return { kind: 'reused', familyId: current.familyId };
      }
      if (current.expiresAt <= now || current.user.status !== 'ACTIVE') return { kind: 'invalid' };
      // Claim the token atomically: of two concurrent refreshes with the same token, only one wins.
      const claimed = await tx.refreshToken.updateMany({ where: { id: current.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
      if (claimed.count === 0) {
        await revokeFamily();
        return { kind: 'reused', familyId: current.familyId };
      }
      const next = await this.issueRefresh(tx, current.userId, current.familyId);
      return { kind: 'ok', session: this.session(current.userId, current.user.role, current.familyId, next) };
    });

    if (outcome.kind === 'reused') {
      this.check.forget('', outcome.familyId);
      this.log.warn(`refresh token reused; session ${outcome.familyId} revoked`);
      throw new AppError('UNAUTHENTICATED');
    }
    if (outcome.kind === 'invalid') throw new AppError('UNAUTHENTICATED');
    return outcome.session;
  }

  /** Signs out one session: every refresh token in the family stops working. */
  async revoke(userId: string, familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, familyId, revokedAt: null }, data: { revokedAt: new Date(this.clock.now()) } });
    this.check.forget(userId, familyId);
  }

  /** The family a refresh token belongs to, if it is this user's. */
  async familyOf(userId: string, refreshToken: string): Promise<string | null> {
    if (!REFRESH_FORMAT.test(refreshToken)) return null;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashing.refreshToken(refreshToken) }, select: { userId: true, familyId: true } });
    return row && row.userId === userId ? row.familyId : null;
  }

  private async issueRefresh(db: Pick<PrismaService, 'refreshToken'>, userId: string, familyId: string): Promise<string> {
    const token = `rt_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(this.clock.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await db.refreshToken.create({ data: { userId, familyId, tokenHash: this.hashing.refreshToken(token), expiresAt } });
    return token;
  }

  private session(userId: string, role: UserRole, familyId: string, refreshToken: string): Session {
    const accessToken = this.accessTokens.sign({ sub: userId, role, sid: familyId });
    return { userId, role, accessToken, refreshToken, expiresIn: this.accessTokens.ttlSec };
  }
}
