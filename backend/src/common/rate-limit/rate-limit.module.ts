import { Global, Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { RATE_LIMIT_STORE, RateLimitService } from './rate-limit.service';
import { MemoryRateLimitStore, type RateLimitStore, RedisRateLimitStore } from './rate-limit.store';

@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMIT_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis | null): RateLimitStore => (redis ? new RedisRateLimitStore(redis) : new MemoryRateLimitStore()),
    },
    RateLimitService,
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}
