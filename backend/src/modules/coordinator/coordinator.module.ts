import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { JobsModule } from '../jobs/jobs.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { CoordinatorAccountsService } from './coordinator-accounts.service';
import { CoordinatorController } from './coordinator.controller';
import { CoordinatorService } from './coordinator.service';

@Module({
  imports: [BookingCoreModule, DispatchModule, JobsModule, TechniciansModule],
  controllers: [CoordinatorController],
  providers: [CoordinatorService, CoordinatorAccountsService],
  exports: [CoordinatorAccountsService],
})
export class CoordinatorModule {}

/** For the command line: accounts only, without the job machinery. */
@Module({ imports: [TechniciansModule], providers: [CoordinatorAccountsService], exports: [CoordinatorAccountsService] })
export class CoordinatorAccountsModule {}
