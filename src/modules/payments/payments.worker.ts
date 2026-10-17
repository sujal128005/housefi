import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PaymentsService } from './payments.service';

const EVERY_MS = 60_000;

/**
 * Once a minute: sends refunds that are decided but not yet with Razorpay, and asks Razorpay about payments we
 * have not heard back on (STATE-MACHINE.md: PAYMENT_PENDING is polled after 10 minutes). Safe on every instance:
 * refunds are claimed before sending and settling is idempotent.
 */
@Injectable()
export class PaymentsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PaymentsWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly payments: PaymentsService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call the service directly
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const refunds = await this.payments.sendPendingRefunds();
      const settled = await this.payments.reconcile();
      const unfulfilled = await this.payments.expireUnfulfilled();
      if (refunds + settled + unfulfilled > 0) this.log.log(`sent ${refunds} refund(s), settled ${settled} payment(s), closed ${unfulfilled} unfulfilled booking(s)`);
    } catch (err) {
      this.log.warn(`payments tick failed (${(err as Error).message}); retrying in a minute`);
    } finally {
      this.running = false;
    }
  }
}
