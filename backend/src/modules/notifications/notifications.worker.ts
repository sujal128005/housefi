import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { NotificationsService } from './notifications.service';
import { Notifier } from './notifier';

const EVERY_MS = 5_000;
/** After a notice is written, wait this long for its transaction to commit before delivering (the sweep catches the rest). */
const AFTER_ENQUEUE_MS = 150;

/**
 * Delivers pushes shortly after notices are written in this process, and sweeps every 5 s for anything written
 * elsewhere (the command line, another instance) or left for a retry. Safe on every instance (rows are claimed).
 */
@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(NotificationsWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private soon: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private running = false;
  private again = false;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly notifier: Notifier,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call deliverPending() themselves
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
    this.unsubscribe = this.notifier.onEnqueued(() => {
      if (this.soon) return;
      this.soon = setTimeout(() => {
        this.soon = undefined;
        void this.run();
      }, AFTER_ENQUEUE_MS);
      this.soon.unref();
    });
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.soon);
    this.unsubscribe?.();
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        const r = await this.notifications.deliverPending();
        if (r.failed > 0 || r.retry > 0) this.log.warn(`push: ${r.sent} sent, ${r.skipped} skipped, ${r.failed} failed, ${r.retry} to retry`);
      } while (this.again);
    } catch (err) {
      this.log.warn(`push delivery failed (${(err as Error).message})`);
    } finally {
      this.running = false;
    }
  }
}
