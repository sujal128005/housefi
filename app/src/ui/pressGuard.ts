// One press per action: a second press within the window (a double tap, a tap that lands while the screen is still
// re-rendering into its loading state) is ignored, so a booking, payment or quote is never sent twice from the UI.
// Servers must still reject duplicates (idempotency keys); this only stops the obvious ones at the source.
export const PRESS_GUARD_MS = 800;

export function createPressGuard(windowMs: number = PRESS_GUARD_MS, now: () => number = Date.now): (action: () => void) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (action) => {
    const t = now();
    if (t - last < windowMs) return;
    last = t;
    action();
  };
}
