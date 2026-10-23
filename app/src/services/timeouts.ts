// Every backend call gets an upper time limit, so no screen can stay on its loading state for ever when a request
// never answers (dead connection, stuck server). A call that runs out of time fails as TIMEOUT ("Taking too long",
// Retry). Calls that upload files or wait for the person (paying in Razorpay's checkout) get longer limits. Functions
// that do not return a promise (watch(), which returns an unsubscribe function) are passed through unchanged.
import { ApiError, type Backend } from './api';

export const REQUEST_TIMEOUT_MS = 25_000;

/** Longer limits, by "group.method". */
export const LONG_CALLS: Readonly<Record<string, number>> = {
  // The customer is paying in the checkout (UPI app, bank page): give them time.
  'bookings.pay': 20 * 60_000,
  // Up to 4 photos and a voice note are uploaded first.
  'bookings.create': 3 * 60_000,
  'ai.classifyPhoto': 90_000,
  'ai.transcribe': 90_000,
  'tech.submitProfile': 90_000,
};

function wrap<T extends object>(target: T, ms: number, path = ''): T {
  // The same wrapper on every read, for as long as the property holds the same value: screens keep parts like
  // `backend.chat` in their hook dependencies, and a new copy on every read restarted them on every redraw (the chat
  // with the technician never showed, and its requests ran in a loop).
  const made = new Map<PropertyKey, { readonly source: unknown; readonly wrapped: unknown }>();
  const once = (prop: PropertyKey, source: unknown, make: () => unknown): unknown => {
    const hit = made.get(prop);
    if (hit && hit.source === source) return hit.wrapped;
    const wrapped = make();
    made.set(prop, { source, wrapped });
    return wrapped;
  };
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value: unknown = Reflect.get(obj, prop, receiver);
      const name = path ? `${path}.${String(prop)}` : String(prop);
      if (typeof value === 'function') {
        const limitMs = LONG_CALLS[name] ?? ms;
        return once(prop, value, () => (...args: unknown[]) => {
          const out: unknown = (value as (...a: unknown[]) => unknown).apply(obj, args);
          if (!(out instanceof Promise)) return out;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const limit = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ApiError('TIMEOUT')), limitMs);
          });
          return Promise.race([out, limit]).finally(() => clearTimeout(timer));
        });
      }
      if (value && typeof value === 'object') return once(prop, value, () => wrap(value as object, ms, name));
      return value;
    },
  });
}

export function withTimeouts(backend: Backend, ms: number = REQUEST_TIMEOUT_MS): Backend {
  return wrap(backend, ms);
}
