import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { ApprenticeController } from './apprentice.controller';
import { ApprenticeService } from './apprentice.service';

@Module({ imports: [BookingCoreModule], controllers: [ApprenticeController], providers: [ApprenticeService] })
export class ApprenticeModule {}
