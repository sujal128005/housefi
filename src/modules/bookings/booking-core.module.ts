import { Module } from '@nestjs/common';
import { BookingCore } from './booking-core';
import { BookingUpdates } from './booking-updates';

/** Booking primitives shared by bookings, payments, dispatch and jobs. */
@Module({ providers: [BookingCore, BookingUpdates], exports: [BookingCore, BookingUpdates] })
export class BookingCoreModule {}
