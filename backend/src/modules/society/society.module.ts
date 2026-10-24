import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PaymentsModule } from '../payments/payments.module';
import { SocietyController } from './society.controller';
import { SocietyService, SocietyWorker } from './society.service';

@Module({ imports: [BookingCoreModule, DispatchModule, PaymentsModule], controllers: [SocietyController], providers: [SocietyService, SocietyWorker], exports: [SocietyService] })
export class SocietyModule {}
