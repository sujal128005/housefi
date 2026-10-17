import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { PaymentsModule } from '../payments/payments.module';
import { SlotsModule } from '../slots/slots.module';
import { BookingExpiryWorker } from './booking-expiry.worker';
import { BookingUpdates } from './booking-updates';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [AddressesModule, SlotsModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingUpdates, BookingExpiryWorker],
  exports: [BookingsService, BookingUpdates],
})
export class BookingsModule {}
