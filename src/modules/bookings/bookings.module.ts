import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { PaymentsModule } from '../payments/payments.module';
import { SlotsModule } from '../slots/slots.module';
import { BookingExpiryWorker } from './booking-expiry.worker';
import { BookingCoreModule } from './booking-core.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [BookingCoreModule, AddressesModule, SlotsModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingExpiryWorker],
  exports: [BookingsService],
})
export class BookingsModule {}
