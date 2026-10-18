// The app talks to the live Housefi API only. The address comes from the build (EXPO_PUBLIC_HOUSEFI_API_URL), defaulting
// to production; a local development server can be used with http://localhost (or 10.0.2.2 from the Android emulator).
// There is no demo mode: the team's demo accounts are real accounts on the server (DEMO_PHONES), with simulated payments.
import type { Backend, KeyValueStore } from './api';
import type { RandomBytes } from '../domain/identity';
import type { CheckoutOrder, CheckoutOutcome } from './http/HttpBackend';
import { createHttpBackend } from './http/HttpBackend';
import { withTimeouts } from './timeouts';

export const DEFAULT_API_URL = 'https://api.housefi.tech/v1';

export class BackendConfigError extends Error {}

/** The API address from the build settings. */
export function apiUrlFromEnv(env: Record<string, string | undefined>): string {
  const url = (env.EXPO_PUBLIC_HOUSEFI_API_URL ?? '').trim() || DEFAULT_API_URL;
  const ok = /^https:\/\/[^/\s]+(\/[^\s]*)?$/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(:\d+)?(\/[^\s]*)?$/i.test(url);
  if (!ok) throw new BackendConfigError('EXPO_PUBLIC_HOUSEFI_API_URL must be an https:// address (or a local http://localhost one)');
  return url.replace(/\/+$/, '');
}

export function createBackend(apiUrl: string, deps: {
  readonly secrets: KeyValueStore;
  readonly randomBytes: RandomBytes;
  readonly openCheckout: (order: CheckoutOrder) => Promise<CheckoutOutcome>;
  readonly locale?: () => string;
}): Backend {
  return withTimeouts(createHttpBackend({ baseUrl: apiUrl, secrets: deps.secrets, randomBytes: deps.randomBytes, openCheckout: deps.openCheckout, locale: deps.locale }));
}
