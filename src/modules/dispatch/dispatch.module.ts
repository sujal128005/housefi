import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { JobsController, OffersController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { DispatchWorker } from './dispatch.worker';

/** Depends only on the booking core, so bookings and payments can start or stop dispatch without cycles. */
@Module({
  imports: [BookingCoreModule],
  controllers: [OffersController, JobsController],
  providers: [DispatchService, DispatchWorker],
  exports: [DispatchService],
})
export class DispatchModule {}
