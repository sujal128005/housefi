// Which backend the app talks to, chosen in one place. The demo backend is the default (this phase). The live
// backend is chosen explicitly at build time (EXPO_PUBLIC_HOUSEFI_BACKEND=live, EXPO_PUBLIC_HOUSEFI_API_URL=https://...)
// and is never replaced by the demo silently: until the HTTP client is written against the confirmed contract,
// asking for "live" fails at start (the branded error screen), so simulated data can never pass for real data.
import type { Backend, KeyValueStore } from './api';
import type { RandomBytes } from '../domain/identity';
import { createMockBackend } from './mock/MockBackend';
import { withTimeouts } from './timeouts';

export type BackendChoice = { readonly kind: 'demo' } | { readonly kind: 'live'; readonly baseUrl: string };

export class BackendConfigError extends Error {}

/** Reads the build-time choice. Anything other than an explicit, complete "live" setting is the demo backend. */
export function backendChoiceFromEnv(env: Record<string, string | undefined>): BackendChoice {
  const kind = (env.EXPO_PUBLIC_HOUSEFI_BACKEND ?? 'demo').trim().toLowerCase();
  if (kind === 'demo' || kind === '') return { kind: 'demo' };
  if (kind === 'live') {
    const baseUrl = (env.EXPO_PUBLIC_HOUSEFI_API_URL ?? '').trim();
    if (!baseUrl) throw new BackendConfigError('EXPO_PUBLIC_HOUSEFI_API_URL is required for the live backend');
    return { kind: 'live', baseUrl };
  }
  throw new BackendConfigError(`Unknown EXPO_PUBLIC_HOUSEFI_BACKEND "${kind}" (use demo or live)`);
}

export function createBackend(choice: BackendChoice, deps: { readonly store: KeyValueStore; readonly randomBytes: RandomBytes }): Backend {
  if (choice.kind === 'demo') return withTimeouts(createMockBackend({ store: deps.store, randomBytes: deps.randomBytes }));
  // The HTTP client (services/http) maps each Backend method once the backend team confirms the endpoints;
  // see docs/backend/INTEGRATION.md.
  throw new BackendConfigError('The live backend client is not connected yet');
}
