import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({ imports: [BookingCoreModule], controllers: [CouponsController], providers: [CouponsService], exports: [CouponsService] })
export class CouponsModule {}
