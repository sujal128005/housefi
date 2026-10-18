// Is a session still allowed? Access tokens are self-contained (15 minutes), so on their own they would keep working
// after logout, account deletion or a block. Every authenticated request asks here: the user must be ACTIVE and the
// session (refresh-token family) must still have a token that is neither revoked nor expired. Answers are cached per
// API instance for a few seconds; a revocation made on this instance takes effect at once, on others within
// CACHE_MS.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.module';

const CACHE_MS = 10_000;
const CACHE_MAX = 20_000;

@Injectable()
export class SessionCheck {
  private readonly cache = new Map<string, { ok: boolean; until: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async isActive(userId: string, sessionId: string): Promise<boolean> {
    const key = `${userId}:${sessionId}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.ok;
    const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM refresh_tokens r JOIN users u ON u.id = r.user_id
        WHERE r.family_id = ${sessionId}::uuid AND r.user_id = ${userId}::uuid AND r.revoked_at IS NULL
          AND r.expires_at > now() AND u.status = 'ACTIVE'
      ) AS ok`;
    const ok = rows[0]?.ok === true;
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { ok, until: now + CACHE_MS });
    return ok;
  }

  /** Forget cached answers for a user (all sessions) or one session, after revoking. */
  forget(userId: string, sessionId?: string): void {
    for (const key of this.cache.keys()) {
      if (sessionId ? key.endsWith(`:${sessionId}`) : key.startsWith(`${userId}:`)) this.cache.delete(key);
    }
  }
}
