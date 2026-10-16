// App-level state: the chosen language and interface, whether the welcome was seen, sounds & vibration, and the
// signed-in sessions (customer and technician are separate accounts, each with its own token). Preferences persist on
// the device; session tokens are re-checked with the backend at start.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Customer, Session, TechProfile, TechSession } from '../domain/types';
import type { Locale } from '../i18n/format';
import type { Backend, KeyValueStore } from '../services/api';
import { setFeedbackEnabled } from '../services/feedback';

export type Role = 'CUSTOMER' | 'TECHNICIAN';

export interface Prefs {
  readonly locale: Locale | null;
  readonly role: Role | null;
  readonly welcomeSeen: boolean;
  readonly token: string | null;
  /** Technician-app session token (separate account). */
  readonly techToken: string | null;
  /** Sounds and vibration for key moments. */
  readonly feedback: boolean;
}

const PREFS_KEY = 'housefi.prefs.v1';
const EMPTY: Prefs = { locale: null, role: null, welcomeSeen: false, token: null, techToken: null, feedback: true };

interface AppStateValue {
  readonly ready: boolean;
  /** Startup could not complete (storage or session check failed); the shell shows the recovery screen. */
  readonly failed: boolean;
  readonly retryStartup: () => void;
  readonly prefs: Prefs;
  readonly session: Session | null;
  readonly techSession: TechSession | null;
  /** Language used before one is chosen (follows the phone). */
  readonly deviceLocale: Locale;
  readonly setLocale: (l: Locale) => void;
  readonly setRole: (r: Role | null) => void;
  readonly setFeedback: (on: boolean) => void;
  readonly markWelcomeSeen: () => void;
  readonly signIn: (s: Session) => void;
  readonly updateCustomer: (c: Customer) => void;
  readonly signOut: () => Promise<void>;
  readonly techSignIn: (s: TechSession) => void;
  readonly updateTech: (p: TechProfile) => void;
  readonly techSignOut: () => Promise<void>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ store, backend, deviceLocale, children }: {
  readonly store: KeyValueStore;
  readonly backend: Backend;
  readonly deviceLocale: Locale;
  readonly children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(EMPTY);
  const [session, setSession] = useState<Session | null>(null);
  const [techSession, setTechSession] = useState<TechSession | null>(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    void (async () => {
      try {
        let p = EMPTY;
        try {
          const raw = await store.get(PREFS_KEY);
          if (raw) p = { ...EMPTY, ...(JSON.parse(raw) as Partial<Prefs>) };
        } catch {
          // Unreadable preferences: start from defaults rather than failing.
          p = EMPTY;
        }
        // restore() answers null for a session that has ended (sign in again). If the check itself fails (no network),
        // the saved sign-in is kept and startup shows Retry instead of signing the person out.
        const [s, ts] = await Promise.all([
          p.token ? backend.auth.restore(p.token) : Promise.resolve(null),
          p.techToken ? backend.tech.auth.restore(p.techToken) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setPrefs({ ...p, token: s ? p.token : null, techToken: ts ? p.techToken : null });
        setSession(s);
        setTechSession(ts);
        setReady(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, backend, attempt]);

  useEffect(() => {
    setFeedbackEnabled(prefs.feedback);
  }, [prefs.feedback]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void store.set(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, [store]);

  const value = useMemo<AppStateValue>(() => ({
    ready,
    failed,
    retryStartup: () => setAttempt((a) => a + 1),
    prefs,
    session,
    techSession,
    deviceLocale,
    setLocale: (locale) => update({ locale }),
    setRole: (role) => update({ role }),
    setFeedback: (feedback) => update({ feedback }),
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
    techSignIn: (s) => {
      setTechSession(s);
      update({ techToken: s.token });
    },
    updateTech: (profile) => setTechSession((prev) => (prev ? { ...prev, profile } : prev)),
    techSignOut: async () => {
      const token = techSession?.token;
      setTechSession(null);
      update({ techToken: null });
      if (token) await backend.tech.auth.signOut(token).catch(() => undefined);
    },
  }), [ready, failed, prefs, session, techSession, deviceLocale, update, backend]);

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

const TECH_SIGNED_OUT: TechSession = {
  token: '',
  profile: {
    id: '', phone: '', name: '', gender: 'M', experienceYears: 0, skills: [], city: '', pincode: '', areas: '', vehicle: '', verification: null,
    correctionNote: null, online: false, rating: null, jobsDone: 0,
  },
};

/** Same as useSession, for technician screens. */
export function useTechSession(): TechSession {
  const { techSession } = useAppState();
  return techSession ?? TECH_SIGNED_OUT;
}
