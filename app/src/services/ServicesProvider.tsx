import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react';
import type { Backend } from './api';

const BackendContext = createContext<Backend | null>(null);

export function BackendProvider({ backend, children }: { readonly backend: Backend; readonly children: ReactNode }) {
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const b = useContext(BackendContext);
  if (!b) throw new Error('BackendProvider missing');
  return b;
}

/**
 * True with the demo backend. Use it for labels about simulated backend outcomes (payments, codes, prices,
 * earnings, reviews), which must disappear with the live backend. Features the app itself still simulates (voice,
 * the rule-based AI) keep their labels regardless.
 */
export function useIsDemo(): boolean {
  return useBackend().mode === 'DEMO';
}

export interface QueryState<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  readonly reload: () => void;
}

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/** Runs an async read and tracks loading / error / data, with a reload for "Try again". */
export function useQuery<T>(fn: () => Promise<T>, deps: DependencyList): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // New inputs (another booking, another verification token): the previous answer is about something else, so it is
  // dropped in this same render and never shown with them. reload() keeps it, so "Try again" does not flash empty.
  const [dataDeps, setDataDeps] = useState<DependencyList>(deps);
  const changed = !sameDeps(dataDeps, deps);
  if (changed) {
    setDataDeps(deps);
    setData(undefined);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // A request that throws before returning a promise is handled like a failed one (no stuck loading state).
    Promise.resolve().then(() => fnRef.current()).then(
      (d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // React redoes this render with the reset state; even this one returns nothing from the previous inputs.
  return changed ? { data: undefined, error: null, loading: true, reload } : { data, error, loading, reload };
}

/** Reloads a query when the screen comes back into focus (not on first show: the query already loads then). */
export function useRefetchOnReturn(reload: () => void): void {
  const seen = useRef(false);
  useFocusEffect(useCallback(() => {
    if (seen.current) reload();
    seen.current = true;
  }, [reload]));
}
