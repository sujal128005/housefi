import { Module } from '@nestjs/common';
import { PartsModule } from '../parts/parts.module';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { PaymentsModule } from '../payments/payments.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { JobsController, QuoteAnswersController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsWorker } from './jobs.worker';

@Module({
  imports: [BookingCoreModule, PaymentsModule, TechniciansModule, PartsModule],
  controllers: [JobsController, QuoteAnswersController],
  providers: [JobsService, JobsWorker],
  exports: [JobsService],
})
export class JobsModule {}
