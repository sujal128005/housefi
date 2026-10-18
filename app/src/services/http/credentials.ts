// The live backend's sign-in tokens. Screens and app state only ever hold a session *handle* ("live1.customer.<random>"):
// the access token (15 minutes) and refresh token (30 days, rotated on every refresh) live here, in the secret store
// (Keychain / Keystore), under that handle. One refresh at a time per handle: two parallel refreshes would present the
// same refresh token twice, which the backend treats as theft and ends the session.
import { ApiError, isApiError, type KeyValueStore } from '../api';
import type { RandomBytes } from '../../domain/identity';

export type Role = 'customer' | 'technician';

export interface Credentials {
  readonly access: string;
  readonly refresh: string;
  /** Epoch ms when the access token stops working. */
  readonly accessExp: number;
}

/** Refresh this long before the access token expires, so a request never starts with a token about to die. */
const EARLY_MS = 60_000;
const HANDLE = /^live1\.(customer|technician)\.[0-9a-f]{32}$/;

const storeKey = (handle: string) => `housefi.cred.${handle}`;

export function isHandle(token: string): boolean {
  return HANDLE.test(token);
}

export function roleOf(handle: string): Role | null {
  const m = HANDLE.exec(handle);
  return m ? (m[1] as Role) : null;
}

export interface Vault {
  /** A new handle for a fresh sign-in. */
  create(role: Role, creds: Credentials): Promise<string>;
  /** A valid access token for the handle, refreshing first when needed (force: the server refused the current one). */
  access(handle: string, opts?: { readonly force?: boolean }): Promise<string>;
  /** The refresh token, for sign-out. */
  refreshToken(handle: string): Promise<string | null>;
  has(handle: string): Promise<boolean>;
  forget(handle: string): Promise<void>;
}

export function createVault(deps: {
  readonly store: KeyValueStore;
  readonly randomBytes: RandomBytes;
  readonly now: () => number;
  /** POST /auth/refresh. Throws ApiError (UNAUTHENTICATED when the session has ended). */
  readonly refresh: (refreshToken: string) => Promise<Credentials>;
}): Vault {
  const cache = new Map<string, Credentials>();
  const inflight = new Map<string, Promise<string>>();

  async function load(handle: string): Promise<Credentials | null> {
    if (!isHandle(handle)) return null;
    const hit = cache.get(handle);
    if (hit) return hit;
    const raw = await deps.store.get(storeKey(handle));
    if (!raw) return null;
    try {
      const c = JSON.parse(raw) as Credentials;
      if (typeof c.access !== 'string' || typeof c.refresh !== 'string' || typeof c.accessExp !== 'number') return null;
      cache.set(handle, c);
      return c;
    } catch {
      return null;
    }
  }

  async function save(handle: string, c: Credentials): Promise<void> {
    cache.set(handle, c);
    await deps.store.set(storeKey(handle), JSON.stringify(c));
  }

  async function forget(handle: string): Promise<void> {
    cache.delete(handle);
    await deps.store.remove(storeKey(handle)).catch(() => undefined);
  }

  function refreshOnce(handle: string, current: Credentials): Promise<string> {
    const running = inflight.get(handle);
    if (running) return running;
    const p = (async () => {
      try {
        const next = await deps.refresh(current.refresh);
        await save(handle, next);
        return next.access;
      } catch (e) {
        // The session has ended (signed out elsewhere, blocked, token reused): forget it on this phone too. Any other
        // failure (no network) keeps it for the next try.
        if (isApiError(e, 'UNAUTHENTICATED')) await forget(handle);
        throw e;
      } finally {
        inflight.delete(handle);
      }
    })();
    inflight.set(handle, p);
    return p;
  }

  return {
    async create(role, creds) {
      const hex = Array.from(deps.randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
      const handle = `live1.${role}.${hex}`;
      await save(handle, creds);
      return handle;
    },
    async access(handle, opts = {}) {
      const c = await load(handle);
      if (!c) throw new ApiError('UNAUTHENTICATED');
      if (!opts.force && c.accessExp - EARLY_MS > deps.now()) return c.access;
      return refreshOnce(handle, c);
    },
    async refreshToken(handle) {
      return (await load(handle))?.refresh ?? null;
    },
    async has(handle) {
      return (await load(handle)) !== null;
    },
    forget,
  };
}
