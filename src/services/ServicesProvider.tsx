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

export interface QueryState<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  readonly reload: () => void;
}

/** Runs an async read and tracks loading / error / data, with a reload for "Try again". */
export function useQuery<T>(fn: () => Promise<T>, deps: DependencyList): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fnRef.current().then(
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
  return { data, error, loading, reload };
}

/** Reloads a query when the screen comes back into focus (not on first show: the query already loads then). */
export function useRefetchOnReturn(reload: () => void): void {
  const seen = useRef(false);
  useFocusEffect(useCallback(() => {
    if (seen.current) reload();
    seen.current = true;
  }, [reload]));
}
