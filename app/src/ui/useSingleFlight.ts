// One request at a time per action. Buttons already ignore a quick second press (pressGuard), but some actions start
// from elsewhere: the keyboard's Done key, a text link, an auto-submit. A second start while the first is still
// running (slow network) would send twice: a second SMS code, a second saved address. Wrapped actions are dropped
// until the running one has finished, whatever started them.
import { useRef } from 'react';

export type SingleFlight = <T>(action: () => Promise<T>) => Promise<T | undefined>;

export function createSingleFlight(): SingleFlight {
  let running = false;
  return async (action) => {
    if (running) return undefined;
    running = true;
    try {
      return await action();
    } finally {
      running = false;
    }
  };
}

export function useSingleFlight(): SingleFlight {
  return useRef(createSingleFlight()).current;
}
