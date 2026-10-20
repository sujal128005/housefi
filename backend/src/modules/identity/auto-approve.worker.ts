import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { TechVerificationService } from '../technicians/tech-verification.service';

const EVERY_MS = 60_000;

/**
 * Approves technicians whose identity checks all passed, every minute (AUTO_APPROVE_TECHNICIANS, on by default). In
 * the API only: the command-line tools do not load this module. Safe on several instances (approval is decided once).
 */
@Injectable()
export class AutoApproveWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(AutoApproveWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly verification: TechVerificationService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test' || !this.config.AUTO_APPROVE_TECHNICIANS) return; // tests call autoApprove()
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
      const n = await this.verification.autoApprove();
      if (n > 0) this.log.log(`approved ${n} technician(s) automatically`);
    } catch (err) {
      this.log.warn(`automatic approval failed (${(err as Error).message}); retrying in a minute`);
    } finally {
      this.running = false;
    }
  }
}
