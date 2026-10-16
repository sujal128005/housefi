import type Redis from 'ioredis';

export interface Hit {
  /** Requests counted in the current window, including this one. */
  readonly count: number;
  /** Milliseconds until the window resets. */
  readonly resetInMs: number;
}

/** Fixed-window counters. Redis in every real environment so limits hold across API instances. */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<Hit>;
}

// INCR and set the expiry atomically, so a crash between the two cannot leave a counter that never resets.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return { count, ttl }
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, windowMs: number): Promise<Hit> {
    const [count, ttl] = (await this.redis.eval(HIT_SCRIPT, 1, key, String(windowMs))) as [number, number];
    return { count, resetInMs: ttl };
  }
}

/** For tests and single-process tools only. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, windowMs: number): Promise<Hit> {
    const t = this.now();
    const cur = this.windows.get(key);
    const w = cur && cur.resetAt > t ? cur : { count: 0, resetAt: t + windowMs };
    w.count += 1;
    this.windows.set(key, w);
    return { count: w.count, resetInMs: w.resetAt - t };
  }

  clear(): void {
    this.windows.clear();
  }
}
