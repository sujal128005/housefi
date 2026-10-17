import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { JobsService } from './jobs.service';

const EVERY_MS = 10_000;

/** Clears quotes that waited 2 minutes in review (until reviewers exist). Safe on every instance (row locks). */
@Injectable()
export class JobsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(JobsWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly jobs: JobsService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call autoClearReviews() with a test clock
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
      const n = await this.jobs.autoClearReviews();
      if (n > 0) this.log.log(`auto-cleared ${n} quote review(s)`);
    } catch (err) {
      this.log.warn(`quote review sweep failed (${(err as Error).message})`);
    } finally {
      this.running = false;
    }
  }
}
