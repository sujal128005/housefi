import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import type { RateLimitStore } from './rate-limit.store';

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export interface Limit {
  /** Requests allowed per window. */
  readonly limit: number;
  readonly windowSec: number;
  /**
   * When the store (Redis) is down: `open` lets the request through (general API traffic), `closed` rejects it
   * (abuse-sensitive actions such as sending an SMS code).
   */
  readonly onStoreError?: 'open' | 'closed';
}

@Injectable()
export class RateLimitService {
  private readonly log = new Logger(RateLimitService.name);
  private lastWarnAt = 0;

  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  /** Counts one request against `key`; throws RATE_LIMITED (with retryAfterSec) when over the limit. */
  async consume(key: string, { limit, windowSec, onStoreError = 'open' }: Limit): Promise<void> {
    let hit;
    try {
      hit = await this.store.hit(`rl:${key}`, windowSec * 1000);
    } catch (err) {
      // At most one warning a minute: during a Redis outage every request would otherwise log one.
      if (Date.now() - this.lastWarnAt > 60_000) {
        this.lastWarnAt = Date.now();
        this.log.warn(`rate-limit store unavailable (${(err as Error).message}); failing ${onStoreError}`);
      }
      if (onStoreError === 'closed') throw new AppError('RATE_LIMITED', { retryAfterSec: windowSec });
      return;
    }
    if (hit.count > limit) {
      throw new AppError('RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil(hit.resetInMs / 1000)) });
    }
  }
}
