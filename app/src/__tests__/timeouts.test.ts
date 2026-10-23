import { isApiError, type Backend } from '../services/api';
import { createMockBackend, memoryStore } from '../services/mock/MockBackend';
import { withTimeouts } from '../services/timeouts';

describe('request time limit', () => {
  afterEach(() => jest.useRealTimers());

  it('fails a call that never answers as TIMEOUT', async () => {
    jest.useFakeTimers();
    const stuck = { catalog: { categories: () => new Promise(() => undefined) } } as unknown as Backend;
    const p = withTimeouts(stuck, 1000).catalog.categories();
    jest.advanceTimersByTime(1001);
    await p.catch((e: unknown) => expect(isApiError(e, 'TIMEOUT')).toBe(true));
  });

  it('passes answers, errors and non-promise results through unchanged', async () => {
    const b = withTimeouts(createMockBackend({ store: memoryStore(), latency: [0, 0] }));
    expect((await b.catalog.categories()).length).toBeGreaterThan(0);
    await expect(b.verify.technician('not-a-token')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const ch = await b.auth.requestOtp('9876543210');
    const s = (await b.auth.verifyOtp(ch.challengeId, ch.demoCode ?? '')).session;
    // watch() returns an unsubscribe function, not a promise: it must come back as a function.
    const stop = b.bookings.watch(s.token, 'none', () => undefined, () => undefined);
    expect(typeof stop).toBe('function');
    stop();
  });

  it('hands out the same wrapper on every read, so screens that depend on backend.chat do not restart', () => {
    const b = withTimeouts(createMockBackend({ store: memoryStore(), latency: [0, 0] }));
    expect(b.chat).toBe(b.chat);
    expect(b.tech.chat).toBe(b.tech.chat);
    expect(b.chat.get).toBe(b.chat.get);
    expect(b.bookings.get).toBe(b.bookings.get);
    expect(b.chat).not.toBe(b.tech.chat);
  });
});
