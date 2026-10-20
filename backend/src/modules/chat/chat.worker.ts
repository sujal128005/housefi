import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ChatService } from './chat.service';

const EVERY_MS = 10 * 60_000;

/** Clears chats a day after their job is done, every 10 minutes. Safe on every instance. */
@Injectable()
export class ChatWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ChatWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly chat: ChatService,
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
      const n = await this.chat.sweep();
      if (n > 0) this.log.log(`cleared ${n} finished chat(s)`);
    } catch (err) {
      this.log.warn(`chat sweep failed (${(err as Error).message}); retrying later`);
    } finally {
      this.running = false;
    }
  }
}
