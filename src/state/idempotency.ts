// Idempotency keys for "create a booking" and "pay". A request can time out in the app (or lose its connection) and
// still succeed on the server, so a retry must not create a second booking or charge twice: every retry of one
// attempt sends the same key, and the backend answers a key it has seen with its first result. A new key is made
// only for a new attempt: when the input changes, or once the backend has given a definite answer.
import { isApiError } from '../services/api';

/**
 * True when a failed call may still have gone through on the server (no answer, time limit, server error, unreadable
 * answer). Only then is the same key kept for the retry.
 */
export function outcomeUnknown(e: unknown): boolean {
  return isApiError(e, 'NETWORK') || isApiError(e, 'TIMEOUT') || isApiError(e, 'SERVER_ERROR') || isApiError(e, 'BAD_RESPONSE');
}

export interface IdempotencyKeys {
  /** The key for this input: the same one again until the input changes or the attempt is settled. */
  keyFor(input: string): string;
  /** The backend answered (success, or a failure that did not go through): the next call is a new attempt. */
  settle(): void;
}

export function idempotencyKeys(newKey: () => string): IdempotencyKeys {
  let current: { readonly input: string; readonly key: string } | null = null;
  return {
    keyFor(input) {
      if (!current || current.input !== input) current = { input, key: newKey() };
      return current.key;
    },
    settle() {
      current = null;
    },
  };
}
