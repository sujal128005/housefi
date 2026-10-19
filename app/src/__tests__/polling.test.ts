// Screens that refresh from the server: never two requests at once, nothing in the background, no redraw when nothing
// changed (what keeps taps quick on a slow network).
import type { AppStateStatus } from 'react-native';
import { keepIfSame, sameData, startPolling } from '../state/polling';

function fakeAppState(initial: AppStateStatus = 'active') {
  let listener: ((s: AppStateStatus) => void) | null = null;
  return {
    currentState: initial,
    addEventListener: (_: 'change', fn: (s: AppStateStatus) => void) => {
      listener = fn;
      return { remove: () => { listener = null; } };
    },
    set(s: AppStateStatus) {
      this.currentState = s;
      listener?.(s);
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('startPolling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for each answer before asking again, however slow the network', async () => {
    let inFlight = 0;
    let most = 0;
    let calls = 0;
    const run = () => {
      calls++;
      inFlight++;
      most = Math.max(most, inFlight);
      return new Promise<void>((resolve) => setTimeout(() => {
        inFlight--;
        resolve();
      }, 3000)); // slower than the interval
    };
    const stop = startPolling(run, 1000, fakeAppState() as never);
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(500);
      await flush();
    }
    stop();
    expect(most).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(3); // 10 s at 3 s + 1 s per round
  });

  it('stops in the background and asks again as soon as the app is back', async () => {
    const app = fakeAppState();
    const run = jest.fn(() => Promise.resolve());
    const stop = startPolling(run, 1000, app as never);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    app.set('background');
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    app.set('active');
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed request', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const stop = startPolling(run, 1000, fakeAppState() as never);
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('no redraw for the same answer', () => {
  it('keeps the previous value when the data did not change', () => {
    const prev = { jobs: [{ id: 'j1', status: 'ASSIGNED' }] };
    expect(keepIfSame({ jobs: [{ id: 'j1', status: 'ASSIGNED' }] })(prev)).toBe(prev);
    const next = { jobs: [{ id: 'j1', status: 'EN_ROUTE' }] };
    expect(keepIfSame(next)(prev)).toBe(next);
    expect(sameData(null, null)).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
  });
});
