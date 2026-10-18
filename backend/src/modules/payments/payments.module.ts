import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsWorker } from './payments.worker';
import { HttpRazorpayClient, RAZORPAY_CLIENT, type RazorpayClient } from './razorpay.client';

/** Null without keys: payment calls then answer "payments not configured" instead of failing at startup. */
function createRazorpay(config: Env): RazorpayClient | null {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) return null;
  return new HttpRazorpayClient({ keyId: config.RAZORPAY_KEY_ID, keySecret: config.RAZORPAY_KEY_SECRET });
}

@Module({
  imports: [BookingCoreModule, DispatchModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, PaymentsWorker, { provide: RAZORPAY_CLIENT, inject: [APP_CONFIG], useFactory: createRazorpay }],
  exports: [PaymentsService],
})
export class PaymentsModule {}
