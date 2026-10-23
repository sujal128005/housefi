// One request at a time: a second start while the first runs (double Done on a slow network) is dropped.
import { createSingleFlight } from '../ui/useSingleFlight';

describe('single flight', () => {
  it('drops a second start while the first is running, and allows the next one after', async () => {
    const once = createSingleFlight();
    let calls = 0;
    let release: () => void = () => undefined;
    const slow = () => new Promise<string>((resolve) => {
      calls++;
      release = () => resolve('sent');
    });
    const first = once(slow);
    const second = once(slow);
    const third = once(slow);
    release();
    expect(await first).toBe('sent');
    expect(await second).toBeUndefined();
    expect(await third).toBeUndefined();
    expect(calls).toBe(1);
    // Finished: the next start goes through.
    const next = once(slow);
    release();
    expect(await next).toBe('sent');
    expect(calls).toBe(2);
  });

  it('frees itself after a failure', async () => {
    const once = createSingleFlight();
    await expect(once(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(await once(async () => 'retried')).toBe('retried');
  });
});
