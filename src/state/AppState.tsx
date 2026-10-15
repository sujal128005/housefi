// App-level state: the chosen language and interface, whether the welcome was seen, and the signed-in session.
// Preferences persist on the device; the session token is re-checked with the backend at start.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Customer, Session } from '../domain/types';
import type { Locale } from '../i18n/format';
import type { Backend, KeyValueStore } from '../services/api';

export type Role = 'CUSTOMER' | 'TECHNICIAN';

export interface Prefs {
  readonly locale: Locale | null;
  readonly role: Role | null;
  readonly welcomeSeen: boolean;
  readonly token: string | null;
}

const PREFS_KEY = 'housefi.prefs.v1';
const EMPTY: Prefs = { locale: null, role: null, welcomeSeen: false, token: null };

interface AppStateValue {
  readonly ready: boolean;
  readonly prefs: Prefs;
  readonly session: Session | null;
  /** Language used before one is chosen (follows the phone). */
  readonly deviceLocale: Locale;
  readonly setLocale: (l: Locale) => void;
  readonly setRole: (r: Role | null) => void;
  readonly markWelcomeSeen: () => void;
  readonly signIn: (s: Session) => void;
  readonly updateCustomer: (c: Customer) => void;
  readonly signOut: () => Promise<void>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ store, backend, deviceLocale, children }: {
  readonly store: KeyValueStore;
  readonly backend: Backend;
  readonly deviceLocale: Locale;
  readonly children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(EMPTY);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let p = EMPTY;
      try {
        const raw = await store.get(PREFS_KEY);
        if (raw) p = { ...EMPTY, ...(JSON.parse(raw) as Partial<Prefs>) };
      } catch {
        p = EMPTY;
      }
      const s = p.token ? await backend.auth.restore(p.token) : null;
      if (!alive) return;
      setPrefs(s ? p : { ...p, token: null });
      setSession(s);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [store, backend]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void store.set(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, [store]);

  const value = useMemo<AppStateValue>(() => ({
    ready,
    prefs,
    session,
    deviceLocale,
    setLocale: (locale) => update({ locale }),
    setRole: (role) => update({ role }),
    markWelcomeSeen: () => update({ welcomeSeen: true }),
    signIn: (s) => {
      setSession(s);
      update({ token: s.token });
    },
    updateCustomer: (customer) => setSession((prev) => (prev ? { ...prev, customer } : prev)),
    signOut: async () => {
      const token = session?.token;
      setSession(null);
      update({ token: null });
      if (token) await backend.auth.signOut(token).catch(() => undefined);
    },
  }), [ready, prefs, session, deviceLocale, update, backend]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppStateProvider missing');
  return v;
}

const SIGNED_OUT: Session = { token: '', customer: { id: '', phone: '', name: '' } };

/**
 * The signed-in session for screens behind sign-in. During sign-out such a screen can render once more before the
 * navigator removes it; it then gets an empty session (requests fail as unauthenticated) instead of crashing.
 */
export function useSession(): Session {
  const { session } = useAppState();
  return session ?? SIGNED_OUT;
}
