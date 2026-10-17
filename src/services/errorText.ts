// One place that decides how any failure is shown: which words, whether Retry can help, whether the session has
// ended. Screens never show an error's own message (it may hold internals); they show these texts. Codes specific to
// one flow (wrong OTP, slot taken, payment failed, offer expired...) are handled on their screens and fall back
// here to the general text.
import type { StringKey } from '../i18n/I18n';
import { isApiError } from './api';

export interface ErrorPresentation {
  readonly title: StringKey;
  readonly body: StringKey | null;
  readonly params?: Readonly<Record<string, string | number>>;
  /** Trying the same request again can help. */
  readonly retryable: boolean;
  /** The person has to sign in again. */
  readonly sessionEnded: boolean;
  readonly icon: 'cloud-offline' | 'time' | 'alert-circle' | 'lock-closed' | 'hourglass';
}

export function presentError(e: unknown): ErrorPresentation {
  const p = (title: StringKey, body: StringKey | null, retryable: boolean, icon: ErrorPresentation['icon'], params?: Record<string, string | number>): ErrorPresentation =>
    ({ title, body, retryable, sessionEnded: false, icon, params });
  if (!isApiError(e)) return p('error.generic', null, true, 'alert-circle');
  switch (e.code) {
    case 'NETWORK': return p('error.network.title', 'error.network.body', true, 'cloud-offline');
    case 'TIMEOUT': return p('error.timeout.title', 'error.timeout.body', true, 'time');
    case 'UNAUTHENTICATED': return { title: 'error.session.body', body: null, retryable: false, sessionEnded: true, icon: 'lock-closed' };
    case 'FORBIDDEN': return p('error.forbidden', null, false, 'lock-closed');
    case 'NOT_FOUND': return p('error.notFound', null, false, 'alert-circle');
    case 'VALIDATION': return p('error.validation', null, false, 'alert-circle');
    case 'CONFLICT': return p('error.conflict', null, true, 'alert-circle');
    case 'RATE_LIMITED':
      return e.retryAfterSec && e.retryAfterSec > 0
        ? p('error.rateLimited', null, true, 'hourglass', { sec: Math.ceil(e.retryAfterSec) })
        : p('error.rateLimitedSoon', null, true, 'hourglass');
    case 'SERVER_ERROR':
    case 'BAD_RESPONSE': return p('error.server', null, true, 'alert-circle');
    case 'IDENTITY_LOCKED': return p('error.identityLocked', null, false, 'lock-closed');
    default: return p('error.generic', null, true, 'alert-circle');
  }
}
