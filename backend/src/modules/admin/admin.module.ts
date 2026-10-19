import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { AuthModule } from '../auth/auth.module';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { EarningsModule } from '../earnings/earnings.module';
import { PaymentsModule } from '../payments/payments.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { UsersModule } from '../users/users.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminController } from './admin.controller';
import { AdminGuard, AdminHostGuard } from './admin.guard';
import { AdminManageController } from './admin-manage.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminPeopleService } from './admin-people.service';
import { AdminRecoveryService } from './admin-recovery.service';

/** The super admin portal's API: its own sign-in, and the same services the apps use for every change. */
@Module({
  imports: [AuthModule, AddressesModule, BookingCoreModule, BookingsModule, CatalogModule, DispatchModule, EarningsModule, PaymentsModule, TechniciansModule, UsersModule],
  controllers: [AdminController, AdminManageController],
  providers: [AdminAuthService, AdminRecoveryService, AdminOverviewService, AdminBookingsService, AdminPeopleService, AdminGuard, AdminHostGuard],
  exports: [AdminAuthService],
})
export class AdminModule {}
