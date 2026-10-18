import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { UploadsService } from './uploads.service';

const EVERY_MS = 60 * 60_000;

/** Deletes unused and refused uploads every hour (not in tests, which call sweep()). Safe on every instance. */
@Injectable()
export class UploadsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(UploadsWorker.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly uploads: UploadsService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.uploads
        .sweep()
        .then((n) => n > 0 && this.log.log(`deleted ${n} unused upload(s)`))
        .catch((err: Error) => this.log.warn(`upload sweep failed (${err.message})`));
    }, EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
