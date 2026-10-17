// Where the two session tokens (customer and technician accounts) live: only in the secret store (Keychain /
// Keystore), never in the plain preferences file. Earlier versions kept them in the preferences; they are moved
// once, and the preferences are rewritten without them.
import type { KeyValueStore } from '../services/api';

export const TOKEN_KEYS = { token: 'housefi.session.customer', techToken: 'housefi.session.technician' } as const;
export type TokenName = keyof typeof TOKEN_KEYS;

/** The preferences as they may be written to the plain store: never with a token in them. */
export function withoutTokens<T extends Record<string, unknown>>(prefs: T): Omit<T, TokenName> {
  const { token: _t, techToken: _tt, ...rest } = prefs;
  return rest;
}

/**
 * Reads both tokens from the secret store. A token still sitting in the parsed preferences (older versions) is moved
 * to the secret store; `migrated` says the preferences must be rewritten without it.
 */
export async function readTokens(parsedPrefs: Record<string, unknown>, secrets: KeyValueStore): Promise<{
  readonly token: string | null;
  readonly techToken: string | null;
  readonly migrated: boolean;
}> {
  let migrated = false;
  const read = async (name: TokenName): Promise<string | null> => {
    const legacy = typeof parsedPrefs[name] === 'string' && (parsedPrefs[name] as string).length > 0 ? (parsedPrefs[name] as string) : null;
    if (name in parsedPrefs) migrated = true;
    const stored = await secrets.get(TOKEN_KEYS[name]);
    if (stored) return stored;
    if (legacy) await secrets.set(TOKEN_KEYS[name], legacy);
    return legacy;
  };
  const token = await read('token');
  const techToken = await read('techToken');
  return { token, techToken, migrated };
}

/** Saves or removes one token in the secret store. */
export async function writeToken(secrets: KeyValueStore, name: TokenName, value: string | null): Promise<void> {
  if (value) await secrets.set(TOKEN_KEYS[name], value);
  else await secrets.remove(TOKEN_KEYS[name]);
}
