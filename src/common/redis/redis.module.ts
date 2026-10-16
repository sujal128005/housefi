import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';

export const REDIS = Symbol('REDIS');

/** Injects the shared Redis client, or null in tests (in-memory stand-ins are used instead). */
export const InjectRedis = (): ParameterDecorator => Inject(REDIS);

function createRedis(config: Env): Redis | null {
  if (config.NODE_ENV === 'test') return null;
  const log = new Logger('Redis');
  const client = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    // Fail fast instead of queueing commands while Redis is down; callers decide whether to fail open or closed.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  let warned = false;
  client.on('error', (err: Error & { code?: string }) => {
    // Connection refusals arrive as an AggregateError with an empty message; the code is the useful part.
    if (!warned) log.warn(`Redis unavailable (${err.code ?? (err.message || err.name)}); retrying in the background`);
    warned = true;
  });
  client.on('ready', () => {
    warned = false;
    log.log('Redis connected');
  });
  client.connect().catch(() => undefined);
  return client;
}

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [APP_CONFIG], useFactory: createRedis }],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@InjectRedis() private readonly redis: Redis | null) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis && this.redis.status !== 'end') this.redis.disconnect();
  }
}
