import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AddressesModule } from '../addresses/addresses.module';
import { CLOUDFLARE_AI_FETCH, WorkersAi } from '../ai/cloudflare';
import { AuthModule } from '../auth/auth.module';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChatModule } from '../chat/chat.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { EarningsModule } from '../earnings/earnings.module';
import { PaymentsModule } from '../payments/payments.module';
import { CoursesModule } from '../courses/courses.module';
import { SkillsModule } from '../skills/skills.module';
import { SupportModule } from '../support/support.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { UsersModule } from '../users/users.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminController } from './admin.controller';
import { AdminGrowthController } from './admin-growth.controller';
import { AdminGrowthService } from './admin-growth.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { AdminGuard, AdminHostGuard } from './admin.guard';
import { AdminManageController } from './admin-manage.controller';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { AdminCoursesController } from './admin-courses.controller';
import { AdminSkillsController } from './admin-skills.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminPeopleService } from './admin-people.service';
import { AdminRecoveryService } from './admin-recovery.service';
import { ClaudeGuideModel, CloudflareGuideModel, createGuideAnthropic, GUIDE_ANTHROPIC, GUIDE_MODEL } from './guide/guide-model';
import { GuideActions, GuideTools } from './guide/guide-tools';
import { GuideService } from './guide/guide.service';

/** The super admin portal's API: its own sign-in, and the same services the apps use for every change. */
@Module({
  imports: [AuthModule, AddressesModule, BookingCoreModule, BookingsModule, CatalogModule, ChatModule, DispatchModule, EarningsModule, PaymentsModule, CoursesModule, SkillsModule, SupportModule, TechniciansModule, UsersModule, InvoicesModule],
  controllers: [AdminController, AdminManageController, AdminOpsController, AdminGrowthController, AdminSkillsController, AdminCoursesController],
  providers: [
    AdminAuthService,
    AdminRecoveryService,
    AdminOverviewService,
    AdminBookingsService,
    AdminPeopleService,
    AdminOpsService,
    AdminGrowthService,
    AdminGuard,
    AdminHostGuard,
    GuideTools,
    GuideActions,
    GuideService,
    ClaudeGuideModel,
    CloudflareGuideModel,
    WorkersAi,
    { provide: CLOUDFLARE_AI_FETCH, useValue: (input: string | URL | Request, init?: RequestInit) => fetch(input, init) },
    { provide: GUIDE_ANTHROPIC, inject: [APP_CONFIG], useFactory: createGuideAnthropic },
    {
      provide: GUIDE_MODEL,
      inject: [APP_CONFIG, ClaudeGuideModel, CloudflareGuideModel],
      useFactory: (c: Env, claude: ClaudeGuideModel, cloudflare: CloudflareGuideModel) => (c.AI_PROVIDER === 'cloudflare' ? cloudflare : claude),
    },
  ],
  exports: [AdminAuthService],
})
export class AdminModule {}
