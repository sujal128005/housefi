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
  // Signed out elsewhere (session ended, idle, revoked): back to the sign-in page.
  if (res.status === 401 && !path.startsWith('/auth/') && !path.startsWith('/recovery/') && typeof window !== 'undefined') window.dispatchEvent(new Event('hq:signed-out'));
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

export type BookingStatus =
  | 'AWAITING_PAYMENT' | 'MATCHING' | 'MATCHING_DELAYED' | 'UNFULFILLED' | 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'INSPECTING'
  | 'QUOTE_SHARED' | 'IN_PROGRESS' | 'EXTRA_WORK' | 'PAYMENT_DUE' | 'COMPLETED' | 'CLOSED_NO_REPAIR' | 'CANCELLED';

export interface BookingRow {
  readonly id: string;
  readonly code: string;
  readonly status: BookingStatus;
  readonly serviceId: string;
  readonly categoryId: string;
  readonly customer: { readonly id: string; readonly name: string };
  readonly technician: { readonly id: string; readonly name: string } | null;
  readonly area: string;
  readonly createdAt: number;
  readonly time: { readonly mode: 'INSTANT' | 'SCHEDULED'; readonly date: string | null; readonly startHour: number | null };
  readonly visitFee: { readonly amount: number; readonly state: string } | null;
  readonly demo: boolean;
}

export interface Payment {
  readonly kind: string;
  readonly amount: number;
  readonly state: string;
  readonly method: string | null;
  readonly at: number | null;
}

export interface BookingDetail {
  readonly booking: {
    readonly id: string;
    readonly code: string;
    readonly serviceId: string;
    readonly status: BookingStatus;
    readonly problem: {
      readonly issueIds: readonly string[];
      readonly notes: string;
      readonly voiceNote: { readonly transcript: string; readonly durationSec: number } | null;
      readonly photos: readonly { readonly id: string; readonly url?: string }[];
    };
    readonly address: { readonly house: string; readonly street: string; readonly landmark: string; readonly city: string; readonly pincode: string; readonly lat?: number; readonly lng?: number };
    readonly time: { readonly mode: 'INSTANT'; readonly window: null } | { readonly mode: 'SCHEDULED'; readonly window: { readonly date: string; readonly startHour: number; readonly endHour: number } };
    readonly etaMin: number | null;
    readonly visitPayment: Payment;
    readonly finalPayment: Payment | null;
    readonly quote: { readonly total: number } | null;
    readonly rating: { readonly stars: number; readonly comment?: string } | null;
    readonly demo: boolean;
  };
  readonly customer: { readonly id: string; readonly name: string; readonly phone: string };
  readonly technician: { readonly id: string; readonly name: string; readonly phone: string } | null;
  readonly events: readonly { readonly status: BookingStatus; readonly actorType: string; readonly at: number; readonly forced: boolean }[];
  readonly offers: readonly { readonly technicianId: string; readonly state: string; readonly at: number }[];
  readonly tickets: readonly { readonly id: string; readonly kind: string; readonly state: string; readonly note: string; readonly at: number }[];
  readonly chatMessages: number;
  readonly can: { readonly cancel: boolean; readonly sendBack: boolean; readonly assign: boolean; readonly complete: boolean; readonly waiveFee: boolean };
}

export type Verification = 'PENDING' | 'APPROVED' | 'NEEDS_CORRECTION' | 'REJECTED' | 'SUSPENDED';

export interface PersonRow {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  readonly demo: boolean;
  readonly createdAt: number;
  readonly bookings: number;
  readonly verification?: Verification | null;
  readonly online?: boolean;
  readonly trades?: readonly string[];
  readonly rating?: number | null;
  readonly ratingCount?: number;
  readonly jobsDone?: number;
  readonly aadhaarChecked?: boolean;
  readonly techCode?: string | null;
}

export interface PersonDetail {
  readonly person: PersonRow;
  readonly recentBookings: readonly { readonly id: string; readonly code: string; readonly status: BookingStatus; readonly serviceId: string; readonly createdAt: number }[];
  readonly activeBooking: string | null;
  readonly ratings: readonly { readonly stars: number; readonly comment: string; readonly at: number }[];
  readonly tickets: readonly { readonly id: string; readonly kind: string; readonly state: string; readonly at: number }[];
  readonly area: string | null;
  readonly earnings: { readonly today: number; readonly total: number; readonly pending: number } | null;
}

export interface PayoutRow {
  readonly id: string;
  readonly technicianId: string;
  readonly technicianName: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly state: 'PENDING' | 'PAID' | 'FAILED';
  readonly providerRef: string | null;
}

export interface CatalogService {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly visitFee: number;
  readonly issues: readonly { readonly id: string; readonly name: string }[];
}

export interface Address {
  readonly id: string;
  readonly label: string;
  readonly house: string;
  readonly street: string;
  readonly city: string;
  readonly pincode: string;
}

export type TechAction = 'approve' | 'reject' | 'suspend' | 'reinstate' | 'offline';

/** "?a=1&b=x", leaving out empty values. */
export function qs(q: Readonly<Record<string, string | number | undefined>>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
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

  bookings: (q: { status?: string; search?: string; page?: number }) => call<{ rows: BookingRow[]; total: number }>('GET', `/bookings${qs(q)}`),
  booking: (id: string) => call<BookingDetail>('GET', `/bookings/${id}`),
  createBooking: (customerId: string, booking: unknown, waiveFee: boolean) => call<{ id: string; code: string }>('POST', '/bookings', { customerId, booking, waiveFee }),
  cancelBooking: (id: string, refund: boolean, note: string) => call<void>('POST', `/bookings/${id}/cancel`, { refund, note }),
  sendBack: (id: string) => call<void>('POST', `/bookings/${id}/send-back`),
  assign: (id: string, technicianId: string) => call<void>('POST', `/bookings/${id}/assign`, { technicianId }),
  complete: (id: string) => call<void>('POST', `/bookings/${id}/complete`),
  waiveFee: (id: string) => call<void>('POST', `/bookings/${id}/waive-fee`),
  erase: (id: string) => call<void>('POST', `/bookings/${id}/erase`),
  catalog: () => call<CatalogService[]>('GET', '/catalog'),

  people: (role: 'customers' | 'technicians', q: { search?: string; filter?: string; page?: number }) => call<{ rows: PersonRow[]; total: number }>('GET', `/${role}${qs(q)}`),
  person: (id: string) => call<PersonDetail>('GET', `/people/${id}`),
  addresses: (customerId: string) => call<Address[]>('GET', `/customers/${customerId}/addresses`),
  block: (id: string, blocked: boolean, reason: string) => call<void>('POST', `/people/${id}/block`, { blocked, reason }),
  signOutPerson: (id: string) => call<{ sessions: number }>('POST', `/people/${id}/sign-out`),
  deletePerson: (id: string) => call<void>('POST', `/people/${id}/delete`),
  techAction: (id: string, action: TechAction, reason: string) => call<void>('POST', `/technicians/${id}/action`, { action, reason }),

  payouts: (state: 'PENDING' | 'PAID' | 'FAILED') => call<PayoutRow[]>('GET', `/payouts?state=${state}`),
  preparePayouts: () => call<PayoutRow[]>('POST', '/payouts/prepare'),
  payoutPaid: (id: string, reference: string) => call<PayoutRow>('POST', `/payouts/${id}/paid`, { reference }),
  payoutFailed: (id: string) => call<PayoutRow>('POST', `/payouts/${id}/failed`),
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

/** "12 Oct, 4:05 pm", in India time (the team works in it). */
export function when(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** "just now" / "5 min ago" / "3 h ago" / "2 d ago". */
export function ago(ms: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export const STATUS_LABEL: Readonly<Record<BookingStatus, string>> = {
  AWAITING_PAYMENT: 'Waiting for visit fee',
  MATCHING: 'Finding technician',
  MATCHING_DELAYED: 'Still searching',
  UNFULFILLED: 'No technician found',
  ASSIGNED: 'Technician assigned',
  EN_ROUTE: 'On the way',
  ARRIVED: 'Arrived',
  INSPECTING: 'Inspecting',
  QUOTE_SHARED: 'Quote sent',
  IN_PROGRESS: 'Work in progress',
  EXTRA_WORK: 'Extra work asked',
  PAYMENT_DUE: 'Final payment due',
  COMPLETED: 'Completed',
  CLOSED_NO_REPAIR: 'Closed, no repair',
  CANCELLED: 'Cancelled',
};

/** The colour family of a status: waiting, live, done, stopped. */
export function statusTone(s: BookingStatus): 'wait' | 'live' | 'done' | 'stop' {
  if (s === 'COMPLETED' || s === 'CLOSED_NO_REPAIR') return 'done';
  if (s === 'CANCELLED' || s === 'UNFULFILLED') return 'stop';
  if (s === 'AWAITING_PAYMENT' || s === 'MATCHING' || s === 'MATCHING_DELAYED') return 'wait';
  return 'live';
}

export const TRADE_LABEL: Readonly<Record<string, string>> = {
  PLUMBING: 'Plumbing',
  ELECTRICAL: 'Electrical',
  AC: 'AC',
  APPLIANCE: 'Appliances',
  CLEANING: 'Cleaning',
  CARPENTRY: 'Carpentry',
};
