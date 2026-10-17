// Every backend call gets an upper time limit, so no screen can stay on its loading state for ever when a request
// never answers (dead connection, stuck server). A call that runs out of time fails as NETWORK ("Couldn't connect",
// Retry). Works for any Backend implementation, the demo one today and the HTTP client later. Functions that do not
// return a promise (watch(), which returns an unsubscribe function) are passed through unchanged.
import { ApiError, type Backend } from './api';

export const REQUEST_TIMEOUT_MS = 25_000;

function wrap<T extends object>(target: T, ms: number): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value: unknown = Reflect.get(obj, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const out: unknown = (value as (...a: unknown[]) => unknown).apply(obj, args);
          if (!(out instanceof Promise)) return out;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const limit = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ApiError('NETWORK', { message: 'timeout' })), ms);
          });
          return Promise.race([out, limit]).finally(() => clearTimeout(timer));
        };
      }
      if (value && typeof value === 'object') return wrap(value as object, ms);
      return value;
    },
  });
}

export function withTimeouts(backend: Backend, ms: number = REQUEST_TIMEOUT_MS): Backend {
  return wrap(backend, ms);
}
