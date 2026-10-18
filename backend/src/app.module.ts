import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditModule } from './common/audit/audit.module';
import { ClockModule } from './common/clock';
import { CryptoModule } from './common/crypto/crypto.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { PrismaModule } from './common/prisma/prisma.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/object-store';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CoordinatorModule } from './modules/coordinator/coordinator.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { EarningsModule } from './modules/earnings/earnings.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { TelephonyModule } from './modules/telephony/telephony.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotifierModule } from './modules/notifications/notifier';
import { PaymentsModule } from './modules/payments/payments.module';
import { SlotsModule } from './modules/slots/slots.module';
import { SupportModule } from './modules/support/support.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';

@Module({})
export class AppModule {
  static forRoot(config: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), ClockModule, RedisModule, PrismaModule, StorageModule, CryptoModule, AuditModule, NotifierModule, RateLimitModule, AuthModule, UploadsModule, UsersModule, CatalogModule, AddressesModule, SlotsModule, BookingsModule, PaymentsModule, TechniciansModule, DispatchModule, JobsModule, EarningsModule, NotificationsModule, AiModule, SupportModule, CoordinatorModule, IdentityModule, TelephonyModule, HealthModule],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Guards run in this order: per-IP rate limit first (cheap, stops floods before token checks), then auth.
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
