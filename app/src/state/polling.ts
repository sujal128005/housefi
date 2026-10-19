// Keeping a screen fresh without making the phone busy. Every screen that asks the server again and again uses this:
// - never two requests at once: the next one starts `everyMs` after the previous answer, so a slow network (the
//   pilot's tunnel takes 0.3-1.4 s) does not pile requests up behind the customer's own taps;
// - nothing while the app is in the background, and a fresh request the moment it comes back;
// - `sameData` lets a screen skip redrawing when the answer did not change.
import { AppState, type AppStateStatus } from 'react-native';

/** Runs `run` now and again `everyMs` after each answer, while the app is in the foreground. Returns stop(). */
export function startPolling(run: () => Promise<unknown>, everyMs: number, appState: Pick<typeof AppState, 'currentState' | 'addEventListener'> = AppState): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = appState.currentState !== 'background' && appState.currentState !== 'inactive';

  const loop = async () => {
    if (stopped || !active || running) return;
    running = true;
    try {
      await run();
    } catch {
      // The caller handles its errors; one failure must not stop the refreshes.
    } finally {
      running = false;
    }
    if (!stopped && active) timer = setTimeout(() => void loop(), everyMs);
  };

  const sub = appState.addEventListener('change', (s: AppStateStatus) => {
    const was = active;
    active = s === 'active';
    if (!active && timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (active && !was) {
      if (timer) clearTimeout(timer);
      void loop();
    }
  });

  void loop();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    sub.remove();
  };
}

/** True when two answers are the same (plain data from the API), so the screen need not redraw. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** For setState: keeps the previous value (no redraw) when the new answer is the same. */
export const keepIfSame = <T>(next: T) => (prev: T): T => (sameData(prev, next) ? prev : next);
