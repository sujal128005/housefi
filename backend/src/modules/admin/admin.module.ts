import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminGuard, AdminHostGuard } from './admin.guard';
import { AdminOverviewService } from './admin-overview.service';
import { AdminRecoveryService } from './admin-recovery.service';

/** The super admin portal's API. Global infrastructure only (database, rate limits, audit, crypto). */
@Module({
  controllers: [AdminController],
  providers: [AdminAuthService, AdminRecoveryService, AdminOverviewService, AdminGuard, AdminHostGuard],
  exports: [AdminAuthService],
})
export class AdminModule {}
