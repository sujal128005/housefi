import { AppError } from '../errors/app-error';
import { RateLimitService } from './rate-limit.service';
import { MemoryRateLimitStore, type RateLimitStore } from './rate-limit.store';

describe('RateLimitService', () => {
  it('allows up to the limit, then rejects with retryAfterSec until the window resets', async () => {
    let t = 1_000_000;
    const limits = new RateLimitService(new MemoryRateLimitStore(() => t));
    const rule = { limit: 2, windowSec: 60 };
    await limits.consume('ip:1.2.3.4', rule);
    await limits.consume('ip:1.2.3.4', rule);
    t += 15_000;
    await expect(limits.consume('ip:1.2.3.4', rule)).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 45 } });
    await limits.consume('ip:5.6.7.8', rule); // other keys are independent
    t += 45_000;
    await expect(limits.consume('ip:1.2.3.4', rule)).resolves.toBeUndefined();
  });

  describe('when the store is down', () => {
    const broken: RateLimitStore = { hit: () => Promise.reject(new Error('Connection is closed.')) };

    it('lets general traffic through (fail open)', async () => {
      await expect(new RateLimitService(broken).consume('ip:x', { limit: 1, windowSec: 60 })).resolves.toBeUndefined();
    });

    it('rejects abuse-sensitive actions (fail closed)', async () => {
      const p = new RateLimitService(broken).consume('otp:phone', { limit: 5, windowSec: 3600, onStoreError: 'closed' });
      await expect(p).rejects.toBeInstanceOf(AppError);
      await expect(p).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });
  });
});
