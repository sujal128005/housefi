// HTTP plumbing for the live backend client: base URL, auth header, idempotency key, time limit, and turning every
// failure into an ApiError the screens already understand. It knows nothing about endpoints: mapping each Backend
// method to a path waits for the backend team to confirm the contract (docs/backend/INTEGRATION.md).
//
// Error envelope (docs/backend/README.md, "Errors"): { "error": { "code", "message", "attemptsLeft", "retryAfterSec",
// "requestId" } }. The message is for logs only: it never reaches an ApiError shown to people, and neither does the
// response body or the token.
import { ApiError, type ApiErrorCode } from '../api';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TransportOptions {
  /** https://... (http only for a local development host). */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** "en" / "te", sent as Accept-Language. */
  readonly locale?: () => string;
}

export interface RequestOptions<T> {
  readonly method: HttpMethod;
  /** Built with `apiPath`, so every dynamic part is encoded. */
  readonly path: ApiPath;
  readonly token?: string | null;
  readonly body?: unknown;
  /** For creating bookings and payments: the same key for retries of the same action. */
  readonly idempotencyKey?: string;
  /** Checks and converts the JSON body; throwing means the server's answer was not what the contract promised. */
  readonly decode: (json: unknown) => T;
}

/** A request path whose dynamic parts were encoded. */
export type ApiPath = string & { readonly __apiPath: true };

/** apiPath`/bookings/${id}/rating` encodes `id`, so a value can never add path segments or a query. */
export function apiPath(strings: TemplateStringsArray, ...values: readonly (string | number)[]): ApiPath {
  let out = '';
  strings.forEach((part, i) => {
    out += part;
    if (i < values.length) out += encodeURIComponent(String(values[i]));
  });
  if (!out.startsWith('/') || out.includes('//') || /(^|\/)\.\.?(\/|$)/.test(out)) throw new Error('invalid API path');
  return out as ApiPath;
}

const KNOWN_CODES: readonly ApiErrorCode[] = [
  'NETWORK', 'UNAUTHENTICATED', 'NOT_FOUND', 'VALIDATION', 'OTP_INVALID', 'OTP_EXPIRED', 'OTP_LOCKED', 'SLOT_UNAVAILABLE',
  'INSTANT_UNAVAILABLE', 'PAYMENT_FAILED', 'OFFER_EXPIRED', 'NOT_VERIFIED', 'IDENTITY_LOCKED', 'CONFLICT', 'FORBIDDEN',
  'RATE_LIMITED', 'SERVER_ERROR', 'TIMEOUT', 'BAD_RESPONSE',
];

/** The error code for a failed response: the envelope's own code when it is one the app knows, else by status. */
export function codeForStatus(status: number, envelopeCode: unknown): ApiErrorCode {
  if (typeof envelopeCode === 'string' && (KNOWN_CODES as readonly string[]).includes(envelopeCode)) return envelopeCode as ApiErrorCode;
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 400 || status === 422) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'BAD_RESPONSE';
}

function checkBaseUrl(url: string): string {
  const u = url.replace(/\/+$/, '');
  if (/^https:\/\/[^/\s]+(\/[^\s]*)?$/i.test(u)) return u;
  if (/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(:\d+)?(\/[^\s]*)?$/i.test(u)) return u; // local development only
  throw new Error('The API base URL must use https');
}

const asNumber = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function createTransport(opts: TransportOptions) {
  const base = checkBaseUrl(opts.baseUrl);
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 25_000;

  async function request<T>(r: RequestOptions<T>): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (r.body !== undefined) headers['Content-Type'] = 'application/json';
    if (r.token) headers.Authorization = `Bearer ${r.token}`;
    if (r.idempotencyKey) headers['Idempotency-Key'] = r.idempotencyKey;
    const locale = opts.locale?.();
    if (locale) headers['Accept-Language'] = locale;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(base + r.path, {
        method: r.method, headers, body: r.body === undefined ? undefined : JSON.stringify(r.body), signal: abort.signal,
      });
    } catch {
      throw new ApiError(abort.signal.aborted ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
    }

    let text = '';
    try {
      text = await res.text();
    } catch {
      throw new ApiError('NETWORK');
    }
    let json: unknown;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        // Not JSON (a proxy's error page, a truncated body): unreadable whatever the status.
        throw new ApiError(res.ok ? 'BAD_RESPONSE' : codeForStatus(res.status, undefined), { message: `HTTP ${res.status}` });
      }
    }

    if (!res.ok) {
      const env = json && typeof json === 'object' ? (json as { error?: Record<string, unknown> }).error : undefined;
      const retryHeader = Number.parseInt(res.headers.get('Retry-After') ?? '', 10);
      throw new ApiError(codeForStatus(res.status, env?.code), {
        message: `HTTP ${res.status}`,
        attemptsLeft: asNumber(env?.attemptsLeft),
        retryAfterSec: asNumber(env?.retryAfterSec) ?? (Number.isFinite(retryHeader) ? retryHeader : undefined),
      });
    }

    try {
      return r.decode(json);
    } catch {
      throw new ApiError('BAD_RESPONSE', { message: `unexpected body for ${r.method} ${r.path.split('?')[0]}` });
    }
  }

  return { request };
}
