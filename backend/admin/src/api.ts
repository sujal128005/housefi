// Talking to the admin API: same origin (the portal's secret host), the session in an HttpOnly cookie the page never
// sees, and the portal's header on every change (the API refuses changes without it).

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | undefined;

  constructor(status: number, code: string, message: string, retryAfterSec?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/v1/admin${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(method === 'POST' ? { 'content-type': 'application/json', 'x-housefi-admin': '1' } : {}) },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; retryAfterSec?: number } };
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? 'ERROR', json.error?.message ?? `HTTP ${res.status}`, json.error?.retryAfterSec);
  return json as T;
}

export interface Me {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly recoveries: readonly { readonly id: string; readonly displayName: string; readonly createdAt: number; readonly readyAt: number }[];
}

export interface Overview {
  readonly today: { readonly bookings: number; readonly completed: number; readonly revenue: number };
  readonly week: { readonly bookings: number; readonly completed: number; readonly revenue: number; readonly newCustomers: number };
  readonly now: { readonly activeBookings: number; readonly searching: number; readonly techniciansOnline: number };
  readonly people: { readonly customers: number; readonly technicians: number; readonly approved: number; readonly waitingReview: number };
  readonly attention: { readonly openSos: number; readonly openReports: number; readonly openQueries: number };
  readonly rating: number | null;
  readonly daily: readonly { readonly date: string; readonly bookings: number; readonly completed: number; readonly revenue: number }[];
}

export const api = {
  password: (username: string, password: string) => call<{ next: 'REGISTER' | 'PASSKEY' }>('POST', '/auth/password', { username, password }),
  passkeyOptions: () => call<{ mode: 'REGISTER' | 'PASSKEY'; options: unknown }>('POST', '/auth/passkey/options'),
  passkeyVerify: (response: unknown, deviceName: string) => call<{ ok: true }>('POST', '/auth/passkey/verify', { response, deviceName }),
  logout: () => call<void>('POST', '/auth/logout'),
  me: () => call<Me>('GET', '/me'),
  overview: () => call<Overview>('GET', '/overview'),
  cancelRecovery: (id: string) => call<void>('POST', `/recoveries/${id}/cancel`),
  recoveryStart: (username: string, phone: string, code: string) => call<{ readyAt: number }>('POST', '/recovery/start', { username, phone, code }),
  recoveryStatus: () => call<{ state: 'WAITING' | 'READY' | 'CANCELLED' | 'DONE'; readyAt: number }>('GET', '/recovery/status'),
  recoveryComplete: (password: string) => call<void>('POST', '/recovery/complete', { password }),
};

/** Phones and tablets, and small windows: the portal is for laptops and big screens only. */
export function isSmallOrMobile(userAgent: string, width: number): boolean {
  return width < 1024 || /android|iphone|ipad|ipod|mobile|silk|kindle|opera mini/i.test(userAgent);
}

/** "₹1,25,000" (Indian grouping). */
export function rupees(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}

/** "in 2 h 15 min" / "now". */
export function timeLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const min = Math.ceil(ms / 60_000);
  const h = Math.floor(min / 60);
  return h > 0 ? `in ${h} h ${min % 60} min` : `in ${min} min`;
}
