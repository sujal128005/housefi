import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DispatchService } from './dispatch.service';

/** Offer timeouts are checked every few seconds; answers check the exact expiry themselves. */
const EVERY_MS = 5_000;

/**
 * Dispatch timers: expired offers, MATCHING_DELAYED / UNFULFILLED, late starts (reassignment) and searching bookings
 * without an offer. A sweep rather than one delayed job per offer: nothing is lost on restart, no Redis needed, and
 * every step re-checks under the booking's row lock, so it is safe on every instance.
 */
@Injectable()
export class DispatchWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(DispatchWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly dispatch: DispatchService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call tick() with a test clock
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.dispatch.tick();
      if (r.expired + r.delayed + r.unfulfilled + r.reassigned > 0) this.log.log(`dispatch: ${JSON.stringify(r)}`);
    } catch (err) {
      this.log.warn(`dispatch sweep failed (${(err as Error).message}); retrying`);
    } finally {
      this.running = false;
    }
  }
}
