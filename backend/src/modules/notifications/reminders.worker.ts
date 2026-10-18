import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RemindersService } from './reminders.service';

const EVERY_MS = 60_000;

/** Sends due reminders every minute. Safe on every instance (each reminder is claimed once). */
@Injectable()
export class RemindersWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(RemindersWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly reminders: RemindersService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call sweep() with a test clock
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
      const n = await this.reminders.sweep();
      if (n > 0) this.log.log(`sent ${n} reminder(s)`);
    } catch (err) {
      this.log.warn(`reminder sweep failed (${(err as Error).message}); retrying in a minute`);
    } finally {
      this.running = false;
    }
  }
}
