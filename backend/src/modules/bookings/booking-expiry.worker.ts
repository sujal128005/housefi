import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingsService } from './bookings.service';

const SWEEP_EVERY_MS = 60_000;

/**
 * Cancels unpaid bookings after UNPAID_BOOKING_EXPIRY_MIN. A sweep instead of one delayed job per booking: nothing
 * is lost on restart, it is safe to run on every instance (each booking is re-checked under a row lock), and reads
 * also expire overdue bookings, so the at-most-one-minute delay is never visible to the customer.
 */
@Injectable()
export class BookingExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(BookingExpiryWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly bookings: BookingsService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call expireUnpaid() directly with a test clock
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.bookings.expireUnpaid();
      if (n > 0) this.log.log(`cancelled ${n} unpaid booking(s)`);
    } catch (err) {
      this.log.warn(`unpaid-booking sweep failed (${(err as Error).message}); retrying in a minute`);
    } finally {
      this.running = false;
    }
  }
}
