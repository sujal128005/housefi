// The current time for screens that change with it (a promised review time): read once when the screen opens, again
// every 30 s, and exactly at `at` when given, so what depends on it appears on time.
import { useEffect, useState } from 'react';

/** setTimeout cannot wait longer than this (about 24.8 days). */
const MAX_DELAY_MS = 2 ** 31 - 1;

export function useNow(at?: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const wait = at != null ? at - Date.now() : -1;
    const exact = wait > 0 && wait < MAX_DELAY_MS ? setTimeout(() => setNow(Date.now()), wait + 500) : undefined;
    return () => {
      clearInterval(tick);
      if (exact) clearTimeout(exact);
    };
  }, [at]);
  return now;
}
