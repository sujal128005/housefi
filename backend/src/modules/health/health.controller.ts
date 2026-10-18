import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.module';
import { SkipRateLimit } from '../../common/rate-limit/rate-limit.guard';
import { Public } from '../auth/auth.guard';
import { InjectRedis } from '../../common/redis/redis.module';

type CheckState = 'up' | 'down' | 'disabled';

const CHECK_TIMEOUT_MS = 1500;

async function check(run: () => Promise<unknown>): Promise<CheckState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([run(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Public, unauthenticated, not rate limited. No personal data, no configuration values. */
@Controller('health')
@SkipRateLimit()
@Public()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis | null,
  ) {}

  /** Liveness: the process is up and serving HTTP. Load balancers restart the task when this fails. */
  @Get()
  live(): { status: 'ok'; version: string; uptimeSec: number; time: number } {
    return {
      status: 'ok',
      version: process.env.npm_package_version ?? 'dev',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      time: Date.now(),
    };
  }

  /** Readiness: dependencies reachable. 503 takes the instance out of rotation without restarting it. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<{ status: 'ok' | 'degraded'; checks: Record<string, CheckState> }> {
    // Public and unthrottled (load balancers poll it): the answer is reused for a second, so a flood of requests
    // cannot turn into a flood of database and Redis round trips.
    const now = Date.now();
    if (!this.lastReady || this.lastReady.at + 1000 <= now) {
      const redis = this.redis;
      const [database, cache] = await Promise.all([
        check(() => this.prisma.$queryRaw`SELECT 1`),
        redis ? check(() => redis.ping()) : Promise.resolve<CheckState>('disabled'),
      ]);
      this.lastReady = { at: now, database, cache };
    }
    const { database, cache } = this.lastReady;
    const ok = database === 'up' && cache !== 'down';
    void reply.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks: { database, redis: cache } };
  }

  private lastReady: { at: number; database: CheckState; cache: CheckState } | null = null;
}
