import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { PrismaModule } from './common/prisma/prisma.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { HealthModule } from './modules/health/health.module';

@Module({})
export class AppModule {
  static forRoot(config: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), RedisModule, PrismaModule, RateLimitModule, HealthModule],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
