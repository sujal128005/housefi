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

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/v1/admin${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(method === 'POST' ? { 'content-type': 'application/json', 'x-housefi-admin': '1' } : method === 'DELETE' ? { 'x-housefi-admin': '1' } : {}) },
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
  readonly discount?: number;
  readonly couponCode?: string | null;
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
    readonly warrantyOf?: string | null;
    readonly warrantyClaim?: { readonly id: string; readonly code: string } | null;
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
  /** What the Aadhaar check found that needs a person: the name or the gender differs from the profile. */
  readonly aadhaarProblems?: readonly ('NAME' | 'GENDER')[];
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

/** The week's bulk-transfer files for the bank (payout kit, built with IBM Bob). */
export interface BankFiles {
  readonly weekEnding: string | null;
  readonly files: readonly { readonly filename: string; readonly rail: 'BANK' | 'UPI'; readonly count: number; readonly amount: number; readonly content: string }[];
  readonly skipped: readonly { readonly payoutId: string; readonly technicianName: string; readonly problems: readonly string[] }[];
  readonly warnings: readonly string[];
  readonly summary: string;
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

export interface Spot {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
  readonly at: number | null;
  readonly source: 'PHONE' | 'LIVE' | 'ADDRESS';
}

export interface Ticket {
  readonly id: string;
  readonly kind: string;
  readonly priority: 'URGENT' | 'HIGH' | 'NORMAL';
  readonly state: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  readonly note: string;
  readonly createdAt: number;
  readonly person: { readonly id: string; readonly role: string; readonly name: string; readonly phone: string };
  readonly booking: { readonly id: string; readonly code: string; readonly status: BookingStatus; readonly area: string; readonly otherName: string | null; readonly otherPhone: string | null } | null;
  readonly spots: readonly Spot[];
  readonly handledBy: string | null;
  readonly handledAt: number | null;
  readonly resolvedAt: number | null;
  readonly resolution: string | null;
}

export interface Alerts {
  readonly sos: number;
  readonly newestSosAt: number | null;
  readonly reports: number;
  readonly queries: number;
  readonly conversations: number;
  /** Skill checks waiting for HQ (a video, a certificate, or no trade verified). */
  readonly skills: number;
}

export interface AdminCourse {
  readonly id: string;
  readonly categoryId: CategoryId | null;
  readonly level: 'BASIC' | 'SAFETY' | 'ADVANCED';
  readonly title: { readonly en: string; readonly te: string };
  readonly published: boolean;
  readonly lessons: readonly { readonly id: string; readonly title: { readonly en: string; readonly te: string }; readonly video: { readonly durationSec: number; readonly bytes: number; readonly uploadedAt: number; readonly url: string } | null }[];
  readonly quizQuestions: number;
  readonly stats: { readonly enrolled: number; readonly completed: number; readonly paid: number; readonly revenue: number };
}

/** A lesson video, sent as the request body with upload progress (0..1). At most 100 MB (Cloudflare's limit). */
export function uploadLessonVideo(courseId: string, lessonId: string, file: File, onProgress: (share: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/v1/admin/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/video`);
    xhr.setRequestHeader('content-type', file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4');
    xhr.setRequestHeader('x-housefi-admin', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status === 204) return resolve();
      if (xhr.status === 401) window.dispatchEvent(new Event('hq:signed-out'));
      let message = `HTTP ${xhr.status}`;
      try {
        message = (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        // not JSON (e.g. the proxy refused a file that is too large)
      }
      reject(new ApiError(xhr.status, 'ERROR', xhr.status === 413 ? 'the file is larger than 100 MB' : message));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'the upload did not reach the server'));
    xhr.send(file);
  });
}

export interface SkillQueueRow {
  readonly technicianId: string;
  readonly name: string;
  readonly techCode: string | null;
  readonly verification: string;
  readonly level: string | null;
  readonly submittedAt: number | null;
  readonly demo: boolean;
  readonly trades: readonly { readonly categoryId: CategoryId; readonly verifiedVia: string | null }[];
  readonly exams: readonly { readonly categoryId: CategoryId; readonly points: number; readonly passed: boolean }[];
  readonly videoWaiting: boolean;
  readonly certificatesWaiting: number;
}

export interface SkillDetail extends SkillQueueRow {
  readonly attempts: readonly {
    readonly id: string;
    readonly categoryId: CategoryId;
    readonly level: string;
    readonly startedAt: number;
    readonly submittedAt: number | null;
    readonly autoSubmitted: boolean;
    readonly leftApp: number;
    readonly points: number | null;
    readonly maxPoints: number;
    readonly passed: boolean | null;
    readonly questions: readonly {
      readonly id: string;
      readonly section: number;
      readonly type: string;
      readonly text: string;
      readonly art: string | null;
      readonly chosen: string | null;
      readonly right: string;
      readonly correct: boolean;
      readonly fast: boolean;
      readonly points: number;
      readonly secondsTaken: number | null;
      readonly changes: number;
    }[];
  }[];
  readonly videos: readonly { readonly id: string; readonly source: string; readonly status: string; readonly durationSec: number | null; readonly url: string | null; readonly categoryIds: readonly CategoryId[]; readonly reviewNote: string | null; readonly createdAt: number; readonly reviewedAt: number | null }[];
  readonly certificates: readonly { readonly id: string; readonly kind: string; readonly title: string; readonly status: string; readonly sample: boolean; readonly url: string | null; readonly contentType: string | null; readonly reviewNote: string | null; readonly createdAt: number }[];
}

export interface ConversationRow {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly name: string;
  readonly topic: string;
  readonly bookingId: string | null;
  readonly unread: number;
  readonly lastMessageAt: number;
  readonly createdAt: number;
  readonly preview: string;
}

export interface Conversation {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly topic: string;
  readonly bookingCode: string | null;
  readonly createdAt: number;
  readonly messages: readonly { readonly id: string; readonly from: 'PERSON' | 'HQ' | 'SYSTEM'; readonly text: string; readonly at: number }[];
}

export interface ChatRow {
  readonly bookingId: string;
  readonly code: string;
  readonly status: BookingStatus;
  readonly messages: number;
  readonly lastAt: number;
  readonly customer: string;
  readonly technician: string;
}

export interface BookingChat {
  readonly code: string;
  readonly messages: readonly { readonly id: string; readonly from: 'CUSTOMER' | 'TECHNICIAN'; readonly text: string; readonly photo: string | null; readonly at: number }[];
}

export interface Analytics {
  readonly days: number;
  readonly daily: readonly { readonly date: string; readonly created: number; readonly completed: number; readonly cancelled: number; readonly revenue: number; readonly newCustomers: number }[];
  readonly byCategory: readonly { readonly categoryId: string; readonly bookings: number; readonly completed: number; readonly revenue: number }[];
  readonly funnel: { readonly created: number; readonly paid: number; readonly assigned: number; readonly completed: number };
  readonly cancelReasons: readonly { readonly reason: string; readonly count: number }[];
  readonly heatmap: readonly { readonly dow: number; readonly hour: number; readonly count: number }[];
  readonly topAreas: readonly { readonly area: string; readonly bookings: number }[];
  readonly topTechnicians: readonly { readonly id: string; readonly name: string; readonly jobs: number; readonly rating: number | null }[];
  readonly ratings: readonly { readonly stars: number; readonly count: number }[];
  readonly paymentMethods: readonly { readonly method: string; readonly count: number; readonly amount: number }[];
  readonly timing: { readonly avgMinToAssign: number | null; readonly avgMinToComplete: number | null };
  readonly totals: { readonly bookings: number; readonly completed: number; readonly revenue: number; readonly avgTicket: number; readonly completionRate: number; readonly cancelRate: number };
}

export interface AuditRow {
  readonly id: string;
  readonly at: number;
  readonly actorType: string;
  readonly actor: string;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly ip: string | null;
  readonly details: string;
}

export type Risk = 'LOW' | 'HIGH' | 'CRITICAL';

export interface Proposal {
  readonly id: string;
  readonly tool: string;
  readonly summary: string;
  readonly risk: Risk;
  readonly phrase: string | null;
  readonly state: 'PROPOSED' | 'DONE' | 'REJECTED' | 'FAILED' | 'EXPIRED';
  readonly expiresAt: number;
  readonly result: string | null;
}

export interface GuideReply {
  readonly reply: string;
  readonly proposals: readonly Proposal[];
  readonly used: readonly string[];
  readonly mode: 'full' | 'basic';
}

export interface GuideConversation {
  readonly messages: readonly { readonly role: 'admin' | 'guide'; readonly text: string; readonly at: number }[];
  readonly pending: readonly Proposal[];
  readonly mode: 'full' | 'basic';
}

export interface LeaderRow {
  readonly name: string;
  readonly score: number;
  readonly detail: string;
  readonly at: number;
}

export type CategoryId = 'PLUMBING' | 'ELECTRICAL' | 'AC' | 'APPLIANCE' | 'CLEANING' | 'CARPENTRY';
export const CATEGORY_IDS: readonly CategoryId[] = ['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY'];

export interface Bi {
  readonly en: string;
  readonly te: string;
}

export interface AdminService {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly name: Bi;
  readonly description: Bi;
  readonly visitFee: number;
  readonly repairFrom: number;
  readonly repairTypicalMax: number;
  readonly durationMin: number;
  readonly durationMax: number;
  readonly popular: boolean;
  readonly active: boolean;
  readonly sort: number;
  readonly keywords: readonly string[];
  readonly issues: readonly { readonly id?: string; readonly name: Bi }[];
  readonly bookings: number;
  readonly editedInHq: boolean;
}

export type ServiceInput = Omit<AdminService, 'id' | 'sort' | 'bookings' | 'editedInHq'>;

export interface AdminPart {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly serviceId: string | null;
  readonly name: Bi;
  readonly unit: string;
  readonly price: number;
  readonly active: boolean;
  readonly sort: number;
  readonly used: number;
}

export type PartInput = Omit<AdminPart, 'id' | 'used'>;

export interface Coupon {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly kind: 'FLAT' | 'PERCENT';
  readonly value: number;
  readonly maxDiscount: number | null;
  readonly minBill: number;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly maxUses: number | null;
  readonly perCustomer: number;
  readonly firstBookingOnly: boolean;
  readonly active: boolean;
  readonly uses: number;
  readonly discountGiven: number;
  readonly createdAt: number;
}

export type CouponInput = Omit<Coupon, 'id' | 'uses' | 'discountGiven' | 'createdAt'>;

export interface Announcement {
  readonly id: string;
  readonly audience: 'CUSTOMERS' | 'TECHNICIANS' | 'ALL' | 'DEMO';
  readonly title: string;
  readonly body: string;
  readonly recipients: number;
  readonly by: string;
  readonly at: number;
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
  courses: () => call<AdminCourse[]>('GET', '/courses'),
  publishCourse: (id: string, published: boolean) => call<void>('POST', `/courses/${id}/publish`, { published }),
  removeLessonVideo: (courseId: string, lessonId: string) => call<void>('DELETE', `/courses/${courseId}/lessons/${lessonId}/video`),
  skillQueue: (state: 'WAITING' | 'ALL') => call<SkillQueueRow[]>('GET', `/skills?state=${state}`),
  skillDetail: (technicianId: string) => call<SkillDetail>('GET', `/skills/${technicianId}`),
  decideVideo: (id: string, decision: 'APPROVE' | 'REJECT', categoryIds: readonly CategoryId[], note: string) => call<void>('POST', `/skills/videos/${id}`, { decision, categoryIds, note }),
  decideCertificate: (id: string, decision: 'APPROVE' | 'REJECT', note: string) => call<void>('POST', `/skills/certificates/${id}`, { decision, note }),
  decideTrade: (technicianId: string, categoryId: CategoryId, verified: boolean, note: string) => call<void>('POST', `/skills/${technicianId}/trades`, { categoryId, verified, note }),
  preparePayouts: () => call<PayoutRow[]>('POST', '/payouts/prepare'),
  payoutPaid: (id: string, reference: string) => call<PayoutRow>('POST', `/payouts/${id}/paid`, { reference }),
  payoutFailed: (id: string) => call<PayoutRow>('POST', `/payouts/${id}/failed`),
  bankFiles: () => call<BankFiles>('POST', '/payouts/bank-files'),
  alerts: () => call<Alerts>('GET', '/alerts'),
  tickets: (group: 'sos' | 'reports' | 'queries', state: 'OPEN' | 'RESOLVED') => call<Ticket[]>('GET', `/tickets/${group}?state=${state}`),
  ticket: (id: string) => call<Ticket>('GET', `/tickets/${id}`),
  takeTicket: (id: string) => call<void>('POST', `/tickets/${id}/take`),
  resolveTicket: (id: string, note: string) => call<void>('POST', `/tickets/${id}/resolve`, { note }),
  unlockStart: (code: string) => call<{ code: string; ticketsResolved: number }>('POST', '/start-code/unlock', { code }),
  conversations: (state: 'OPEN' | 'CLOSED') => call<ConversationRow[]>('GET', `/conversations?state=${state}`),
  conversation: (id: string) => call<Conversation>('GET', `/conversations/${id}`),
  reply: (id: string, text: string) => call<void>('POST', `/conversations/${id}/reply`, { text }),
  closeConversation: (id: string) => call<void>('POST', `/conversations/${id}/close`),
  deleteConversation: (id: string) => call<void>('POST', `/conversations/${id}/delete`),
  cleanupConversations: (days: number) => call<{ deleted: number }>('POST', '/conversations/cleanup', { days }),
  chats: () => call<ChatRow[]>('GET', '/chats'),
  chat: (bookingId: string) => call<BookingChat>('GET', `/chats/${bookingId}`),
  deleteChat: (bookingId: string) => call<void>('POST', `/chats/${bookingId}/delete`),
  analytics: (days: number, demo: boolean) => call<Analytics>('GET', `/analytics?days=${days}&demo=${demo ? 1 : 0}`),
  audit: (q: { search?: string; actor?: string; before?: number }) => call<AuditRow[]>('GET', `/audit${qs(q)}`),
  saveScore: (game: string, score: number, detail: string) => call<{ best: number; rank: number }>('POST', '/arcade/scores', { game, score, detail }),
  leaderboard: (game: string) => call<LeaderRow[]>('GET', `/arcade/scores/${game}`),
  guide: () => call<GuideConversation>('GET', '/guide'),
  ask: (message: string, photo: string | null) => call<GuideReply>('POST', '/guide/messages', { message, photo }),
  clearGuide: () => call<void>('POST', '/guide/clear'),
  stepUp: (id: string) => call<{ options: unknown }>('POST', `/guide/actions/${id}/step-up`),
  approve: (id: string, input: { typed?: string; typedAgain?: string; passkey?: unknown }) => call<Proposal>('POST', `/guide/actions/${id}/approve`, input),
  reject: (id: string) => call<Proposal>('POST', `/guide/actions/${id}/reject`),
  services: () => call<AdminService[]>('GET', '/services'),
  saveService: (id: string | null, input: ServiceInput) => call<AdminService>('POST', id ? `/services/${id}` : '/services', input),
  parts: () => call<AdminPart[]>('GET', '/parts'),
  savePart: (id: string | null, input: PartInput) => call<void>('POST', id ? `/parts/${id}` : '/parts', input),
  coupons: () => call<Coupon[]>('GET', '/coupons'),
  saveCoupon: (id: string | null, input: CouponInput) => call<void>('POST', id ? `/coupons/${id}` : '/coupons', input),
  announcements: () => call<Announcement[]>('GET', '/announcements'),
  announce: (input: { audience: Announcement['audience']; title: Bi; body: Bi }) => call<{ recipients: number }>('POST', '/announcements', input),
  /** Opens in a new tab (the session cookie goes with it). */
  invoiceUrl: (bookingId: string) => `/v1/admin/bookings/${bookingId}/invoice`,
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
