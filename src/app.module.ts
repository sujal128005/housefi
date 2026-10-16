import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ClockModule } from './common/clock';
import { CryptoModule } from './common/crypto/crypto.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { PrismaModule } from './common/prisma/prisma.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';

@Module({})
export class AppModule {
  static forRoot(config: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), ClockModule, RedisModule, PrismaModule, CryptoModule, RateLimitModule, AuthModule, HealthModule],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Guards run in this order: per-IP rate limit first (cheap, stops floods before token checks), then auth.
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
