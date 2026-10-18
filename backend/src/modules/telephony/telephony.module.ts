import { Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { TelephonyController, TelephonyWebhookController } from './telephony.controller';
import { ExotelTelephony, FakeTelephony, TELEPHONY_PROVIDER, type TelephonyProvider } from './telephony-provider';
import { TelephonyService } from './telephony.service';

function createProvider(c: Env): TelephonyProvider | null {
  if (c.TELEPHONY_PROVIDER === 'fake') return new FakeTelephony();
  if (c.TELEPHONY_PROVIDER !== 'exotel') return null;
  return new ExotelTelephony({
    sid: c.EXOTEL_SID as string,
    apiKey: c.EXOTEL_API_KEY as string,
    apiToken: c.EXOTEL_API_TOKEN as string,
    subdomain: c.EXOTEL_SUBDOMAIN,
    callerId: c.EXOTEL_CALLER_ID as string,
    offerFlowId: c.EXOTEL_OFFER_FLOW_ID as string,
  });
}

/** Every 5 minutes: keypad technicians whose calling hours ended go offline. */
@Injectable()
export class TelephonyWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(TelephonyWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly telephony: TelephonyService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onModuleInit(): void {
    if (this.config.NODE_ENV === 'test' || this.config.TELEPHONY_PROVIDER === 'off') return;
    this.timer = setInterval(() => {
      this.telephony.endCallingHours().catch((err: Error) => this.log.warn(`calling-hours sweep failed (${err.message})`));
    }, 5 * 60_000);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({
  imports: [BookingCoreModule, DispatchModule],
  controllers: [TelephonyController, TelephonyWebhookController],
  providers: [{ provide: TELEPHONY_PROVIDER, inject: [APP_CONFIG], useFactory: createProvider }, TelephonyService, TelephonyWorker],
  exports: [TelephonyService, TELEPHONY_PROVIDER],
})
export class TelephonyModule {}
