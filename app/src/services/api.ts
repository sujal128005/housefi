// The contract between the screens and "the backend". The app talks to the live Housefi API through the HTTP client
// (services/http/HttpBackend.ts). The in-memory implementation in services/mock is a test double only: no screen or
// build of the app uses it.
import type {
  Address, AddressInput, Booking, CancelReason, Category, Customer, Earnings, Job, JobOffer, OfferRejectReason, PaymentMethod, Photo, ProblemDescription, QuoteLine, Rating, Service, Session, Slot, TechIdCard, TechIssue, TechProfile, TechProfileInput, TechSession, TechVerifyResult, VisitTime, Part,
} from '../domain/types';
import type { MatchingScenario, PaymentOutcome } from '../domain/rules';

export type ApiErrorCode =
  | 'NETWORK'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'SLOT_UNAVAILABLE'
  | 'INSTANT_UNAVAILABLE'
  | 'PAYMENT_FAILED'
  | 'OFFER_EXPIRED'
  | 'NOT_VERIFIED'
  /** Identity fields (legal name, photo, Technician ID) cannot be changed by the technician. */
  | 'IDENTITY_LOCKED'
  | 'CONFLICT'
  /** Signed in, but not allowed to do this (HTTP 403). */
  | 'FORBIDDEN'
  /** Too many requests; `retryAfterSec` says when to try again (HTTP 429). */
  | 'RATE_LIMITED'
  /** The server failed (HTTP 5xx). */
  | 'SERVER_ERROR'
  /** The request took too long (no answer within the app's time limit). */
  | 'TIMEOUT'
  /** The server answered with something the app cannot read (not JSON, wrong shape). */
  | 'BAD_RESPONSE';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** True when demo settings forced this error, so the UI can say so. */
  readonly simulated: boolean;
  readonly attemptsLeft: number | undefined;
  /** RATE_LIMITED: seconds until a retry may succeed. */
  readonly retryAfterSec: number | undefined;

  constructor(code: ApiErrorCode, opts: { simulated?: boolean; attemptsLeft?: number; retryAfterSec?: number; message?: string } = {}) {
    // The message is for developers only; screens never show it (see services/errorText.ts).
    super(opts.message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.simulated = opts.simulated ?? false;
    this.attemptsLeft = opts.attemptsLeft;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

export function isApiError(e: unknown, code?: ApiErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

export interface OtpChallenge {
  readonly challengeId: string;
  readonly phone: string;
  readonly resendAfterSec: number;
  readonly expiresAt: number;
  /** Only the test double returns the code. Always null from the live backend. */
  readonly demoCode: string | null;
  /** One of the team's demo numbers: no SMS is sent; the team's fixed code signs in. */
  readonly demoAccount: boolean;
}

export interface AuthApi {
  requestOtp(phone: string): Promise<OtpChallenge>;
  verifyOtp(challengeId: string, code: string): Promise<{ readonly session: Session; readonly isNewCustomer: boolean }>;
  /** Re-validates a stored token at app start; null when it is no longer valid. */
  restore(token: string): Promise<Session | null>;
  updateName(token: string, name: string): Promise<Customer>;
  signOut(token: string): Promise<void>;
  /** Deletes the account for good (personal data erased, past bookings anonymised). CONFLICT while a booking is open. */
  deleteAccount(token: string): Promise<void>;
}

export interface CatalogApi {
  categories(): Promise<readonly Category[]>;
  services(categoryId?: string): Promise<readonly Service[]>;
  service(id: string): Promise<Service>;
}

export interface AddressApi {
  list(token: string): Promise<readonly Address[]>;
  create(token: string, input: AddressInput): Promise<Address>;
  update(token: string, id: string, input: AddressInput): Promise<Address>;
  remove(token: string, id: string): Promise<void>;
}

export interface NewBooking {
  readonly serviceId: string;
  readonly problem: ProblemDescription;
  readonly addressId: string;
  readonly time: VisitTime;
  readonly preferWomenRated: boolean;
  /** "Book the same technician again": the customer's earlier finished booking; its technician is asked first. */
  readonly repeatOf?: string;
}

export type QuoteAnswer = 'APPROVE' | 'REVISION' | 'DECLINE';

export interface PaymentResult {
  readonly booking: Booking;
  /** PAID, PENDING (confirms later), or FAILED (nothing charged, try again). */
  readonly state: 'PAID' | 'PENDING' | 'FAILED';
}

export interface BookingApi {
  /** GET /slots: the two-hour windows for a date. Needs the signed-in customer (like every booking call). */
  slots(token: string, serviceId: string, date: string): Promise<readonly Slot[]>;
  /**
   * Creates the booking; it waits for the ₹49 visit fee before a technician is searched. `idempotencyKey` (HTTP
   * header `Idempotency-Key`) is made once per attempt and sent again on every retry of it: the same key from the same
   * customer returns the booking it first created instead of creating another (see state/idempotency.ts).
   */
  create(token: string, input: NewBooking, idempotencyKey: string): Promise<Booking>;
  /**
   * Pays the visit fee (kind VISIT) or the final bill (kind FINAL). `idempotencyKey` works as for create(): a retry
   * with the same key returns the first result and never charges twice.
   */
  pay(token: string, bookingId: string, kind: 'VISIT' | 'FINAL', method: PaymentMethod, idempotencyKey: string): Promise<PaymentResult>;
  get(token: string, id: string): Promise<Booking>;
  list(token: string): Promise<readonly Booking[]>;
  cancel(token: string, id: string, reason: CancelReason | null): Promise<Booking>;
  reschedule(token: string, id: string, time: VisitTime): Promise<Booking>;
  /**
   * Answer the repair quote (MAIN) or the extra work found during the repair (EXTRA). REVISION asks the technician for
   * a lower price (MAIN only); DECLINE ends the visit without repair (MAIN) or skips the extra work (EXTRA).
   */
  decideQuote(token: string, id: string, which: 'MAIN' | 'EXTRA', answer: QuoteAnswer): Promise<Booking>;
  rate(token: string, id: string, rating: Omit<Rating, 'at'>): Promise<Booking>;
  /** A coupon on the final bill (while it is due). A code that cannot be used comes back with why, not as an error. */
  applyCoupon(token: string, id: string, code: string): Promise<CouponResult>;
  removeCoupon(token: string, id: string): Promise<Booking>;
  /** "Not fixed? Free revisit" within 15 days of a completed job: the new booking (or the one already asked for). */
  claimWarranty(token: string, id: string, note: string): Promise<Booking>;
  /** A link (valid 15 minutes) that opens the invoice PDF in the browser. CONFLICT before the job is done. */
  invoiceLink(token: string, id: string): Promise<string>;
  /**
   * The digital ID card of the technician assigned to this customer's booking. NOT_FOUND unless the booking is the
   * customer's own and a technician is assigned (the same answer for other people's bookings, so nothing leaks).
   */
  technicianCard(token: string, bookingId: string): Promise<TechIdCard>;
  /** Live updates for one booking. Returns an unsubscribe function. */
  watch(token: string, id: string, onChange: (b: Booking) => void, onError?: (e: unknown) => void): () => void;
  /**
   * A masked call to the assigned technician: the number to dial (Housefi's number, which connects to the technician
   * without either side seeing the other's number). CONFLICT outside the visit.
   */
  call(token: string, id: string): Promise<{ readonly dialNumber: string }>;
}

/** What a notification is about; the app turns it into text in the person's language (key "notif.<kind>"). */
export type NotificationKind =
  // customer
  | 'TECH_ASSIGNED' | 'TECH_ON_THE_WAY' | 'TECH_ARRIVED' | 'QUOTE_READY' | 'EXTRA_QUOTE' | 'PAYMENT_DUE' | 'BOOKING_COMPLETED'
  | 'BOOKING_CANCELLED' | 'NO_TECHNICIAN'
  // technician
  | 'JOB_OFFER' | 'QUOTE_APPROVED' | 'QUOTE_REVISION' | 'QUOTE_DECLINED' | 'EXTRA_APPROVED' | 'EXTRA_DECLINED' | 'PAYMENT_RECEIVED'
  | 'JOB_CANCELLED' | 'PROFILE_APPROVED' | 'PROFILE_NEEDS_CORRECTION'
  // reminders and account notices
  | 'PAY_REMINDER' | 'BOOKING_REMINDER' | 'JOB_REMINDER' | 'QUOTE_REMINDER' | 'RATE_REMINDER' | 'PROFILE_SUSPENDED'
  | 'PROFILE_REINSTATED' | 'PROFILE_REJECTED'
  // the day's schedule: the evening before a visit (both sides), the technician's morning plan
  | 'BOOKING_TOMORROW' | 'JOB_TOMORROW' | 'JOB_DAY_PLAN'
  // a chat message from the other side (shown by the chat bubble, not in the inbox)
  | 'CHAT_MESSAGE'
  // the Housefi team answered in the person's support conversation
  | 'SUPPORT_REPLY'
  // a message from Housefi HQ to everyone (params: title, body, titleTe, bodyTe)
  | 'ANNOUNCEMENT';

export interface AppNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly bookingId: string | null;
  /** Values for the text, e.g. { code: 'HF-48291', amount: 320 }. */
  readonly params: Readonly<Record<string, string | number>>;
  readonly at: number;
  readonly read: boolean;
}

/** In-app notification inbox. The real backend also sends push notifications; the demo keeps only the inbox. */
export interface NotificationApi {
  list(token: string): Promise<readonly AppNotification[]>;
  markRead(token: string, ids: readonly string[]): Promise<void>;
  /** Stores the device's push token for this account (Expo push / FCM / APNs). No-op in the demo. */
  registerDevice(token: string, device: { readonly pushToken: string; readonly platform: 'ios' | 'android' | 'web' }): Promise<void>;
}

export interface PhotoSuggestion {
  readonly serviceId: string | null;
  /** 0-1. */
  readonly confidence: number;
  /** Other likely services, best first. */
  readonly alternatives: readonly string[];
}

export interface ChatReply {
  readonly text: string;
  readonly suggestions: readonly string[];
  /** The assistant thinks a person should take over. */
  readonly offerHuman: boolean;
  /** Links under the answer (e.g. the founders' profiles). Missing on older servers. */
  readonly links?: readonly { readonly label: string; readonly url: string }[];
  /** Something the customer can confirm (never done by the assistant itself). */
  readonly action?: ChatAction | null;
}

/** "Cancel HF-12345?": shown as a confirm card; only the customer's tap cancels, through the usual endpoint. */
export interface ChatAction {
  readonly kind: 'CANCEL_BOOKING';
  readonly bookingId: string;
  readonly code: string;
  readonly reason: CancelReason;
  /** Rupees refunded. */
  readonly refund: number;
}

export interface LocalProblem {
  readonly serviceId: string;
  readonly issueId: string;
  /** How many bookings for this problem nearby in the last 7 days. */
  readonly recentCount: number;
}

export interface LocalTopProblems {
  /** Locality the list is for ("Banjara Hills, Hyderabad"); null when no address is known (city-wide list). */
  readonly area: string | null;
  /** Always 6, most common first. */
  readonly items: readonly LocalProblem[];
}

/** A recorded voice note on the phone. */
export interface Recording {
  /** Local file of the recording (m4a). */
  readonly uri: string;
  readonly durationSec: number;
}

export interface Transcript {
  /** What was said; empty when it could not be written down (the voice note is still kept as audio). */
  readonly text: string;
  /** The uploaded recording, to attach to the booking. */
  readonly audioId: string | null;
}

/** AI features (customer app): the model answers, with Housefi's rules as the fallback on the server. */
export interface AiApi {
  /** The 6 problems most booked around this PIN code right now. */
  topProblems(token: string, pincode: string | null, area: string | null): Promise<LocalTopProblems>;
  classifyPhoto(token: string, photo: Photo): Promise<PhotoSuggestion>;
  /** Uploads the recording and writes down what was said (Telugu or English; up to 30 s). */
  transcribe(token: string, recording: Recording, serviceId: string | null, locale: 'en' | 'te'): Promise<Transcript>;
  chat(token: string, message: string, locale: 'en' | 'te'): Promise<ChatReply>;
}

// ---------- technician ----------

export interface QuoteLineInput {
  readonly kind: QuoteLine['kind'];
  readonly name: string;
  readonly qty: number;
  readonly unitPrice: number;
  /** A part from Housefi's price list (materials): listed parts at their price pass the price check. */
  readonly partId?: string;
}

export type CouponProblem = 'UNKNOWN' | 'INACTIVE' | 'NOT_YET' | 'EXPIRED' | 'USED_UP' | 'ALREADY_USED' | 'FIRST_BOOKING_ONLY' | 'BILL_TOO_SMALL';

export interface CouponResult {
  readonly applied: boolean;
  readonly problem: CouponProblem | null;
  /** Whole rupees off. */
  readonly discount: number;
  readonly booking: Booking;
}

export interface QuoteInput {
  /** What the technician found. */
  readonly diagnosis: string;
  readonly lines: readonly QuoteLineInput[];
}

export interface TechAuthApi {
  requestOtp(phone: string): Promise<OtpChallenge>;
  verifyOtp(challengeId: string, code: string): Promise<{ readonly session: TechSession; readonly isNew: boolean }>;
  restore(token: string): Promise<TechSession | null>;
  signOut(token: string): Promise<void>;
  /** Deletes the technician account for good. CONFLICT while a job is in progress. */
  deleteAccount(token: string): Promise<void>;
}

/** Everything the technician app does. Technician accounts and tokens are separate from customer ones. */
export interface TechApi {
  readonly auth: TechAuthApi;
  /** The technician's chats with their customers. */
  readonly chat: ChatApi;
  me(token: string): Promise<TechProfile>;
  /**
   * First submission and corrections; puts the profile (back) into verification. The first submission needs a photo
   * and fixes the identity (legal name, photo) and issues the Technician ID. Later submissions may change work details
   * only: a different name is IDENTITY_LOCKED and a photo is ignored.
   */
  submitProfile(token: string, input: TechProfileInput): Promise<TechProfile>;
  /** The signed-in technician's own digital ID card. */
  idCard(token: string): Promise<TechIdCard>;
  /** Asks support to correct the legal name or photo (the technician cannot change them directly). */
  requestIdentityCorrection(token: string, kind: 'NAME' | 'PHOTO', note: string): Promise<TechProfile>;
  /** Online = ready to receive job offers. Only verified technicians can go online. */
  setOnline(token: string, online: boolean): Promise<TechProfile>;
  /** The job currently offered to this technician, if any. */
  offer(token: string): Promise<JobOffer | null>;
  /** OFFER_EXPIRED when too late or the customer cancelled. */
  acceptOffer(token: string, offerId: string): Promise<Job>;
  rejectOffer(token: string, offerId: string, reason: OfferRejectReason | null): Promise<void>;
  jobs(token: string): Promise<readonly Job[]>;
  job(token: string, id: string): Promise<Job>;
  startTrip(token: string, id: string): Promise<Job>;
  arrived(token: string, id: string): Promise<Job>;
  /** The 4-digit code the customer reads out at the door. Wrong code: OTP_INVALID with attemptsLeft, then OTP_LOCKED. */
  verifyStartCode(token: string, id: string, code: string): Promise<Job>;
  /** Sends the repair quote (MAIN) or extra work (EXTRA); it is price-checked before the customer sees it. */
  submitQuote(token: string, id: string, which: 'MAIN' | 'EXTRA', input: QuoteInput): Promise<Job>;
  /** A warranty revisit closed as fixed at no charge (after the start code). */
  warrantyFixed(token: string, id: string): Promise<Job>;
  /** Housefi's parts price list for this job's trade. */
  parts(token: string, id: string): Promise<readonly Part[]>;
  startWork(token: string, id: string): Promise<Job>;
  completeWork(token: string, id: string): Promise<Job>;
  /** The customer chose cash; the technician confirms it was received. */
  confirmCash(token: string, id: string): Promise<Job>;
  /** CUSTOMER_UNAVAILABLE and CANNOT_COMPLETE close the visit; the others alert support (UNSAFE with where the phone was). */
  report(token: string, id: string, issue: TechIssue, note: string, location?: Position | null): Promise<Job>;
  earnings(token: string): Promise<Earnings>;
  /**
   * Verifies the technician's Aadhaar offline from the Secure QR code on the card (the text the camera read). Stores only
   * the last 4 digits and whether the name matches. VALIDATION for a QR that is not a signed Aadhaar Secure QR; CONFLICT
   * when that Aadhaar is already used by another account.
   */
  verifyAadhaar(token: string, qr: string): Promise<{ readonly last4: string; readonly nameMatches: boolean; readonly verifiedAt: number }>;
  /** A masked call to the customer of an assigned job (Housefi's number connects to them). */
  callCustomer(token: string, jobId: string): Promise<{ readonly dialNumber: string }>;
  /** The phone's position while online or on a job (about every minute); the customer sees it only while on the way. */
  sendLocation(token: string, position: { readonly lat: number; readonly lng: number; readonly accuracy?: number }): Promise<void>;
  watchJob(token: string, id: string, onChange: (j: Job) => void, onError?: (e: unknown) => void): () => void;
  readonly notifications: NotificationApi;
}

export type FailNext = 'OFF' | 'NETWORK' | 'SLOT_TAKEN';

export interface DemoSettings {
  readonly matching: MatchingScenario;
  readonly failNext: FailNext;
  readonly payment: PaymentOutcome;
  /** The technician finds extra work during the repair. */
  readonly extraWork: boolean;
  /** How the simulated customer of a practice job answers the first quote. */
  readonly practiceCustomer: 'APPROVE' | 'REVISION' | 'DECLINE';
  /** Outcome of the next technician profile review. */
  readonly verification: 'APPROVE' | 'CORRECTION';
}

export type DemoOutcome = 'ASSIGN' | 'DELAY' | 'NONE' | 'NEXT';

/** Controls that exist only in demo mode. */
export interface DemoControls {
  settings(): Promise<DemoSettings>;
  updateSettings(patch: Partial<DemoSettings>): Promise<DemoSettings>;
  simulate(token: string, bookingId: string, outcome: DemoOutcome): Promise<Booking>;
  /** Technician app: offers this technician a practice job from a simulated customer. */
  practiceJob(techToken: string): Promise<JobOffer>;
  /** Technician app: the code the customer would read out at the door (in the demo, both sides are on one phone). */
  startCode(techToken: string, jobId: string): Promise<string>;
  /** Technician app: withdraws (or restores) this technician's approval, to show a suspended ID card and verification. */
  setSuspended(techToken: string, suspended: boolean): Promise<void>;
  reset(): Promise<void>;
}

/** Where the phone was (SOS and reports): sent when the phone gives a position. */
export interface Position {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
}

export type SupportTopic = 'BOOKING' | 'PAYMENT' | 'TECHNICIAN' | 'APP' | 'OTHER';

/** A live conversation with the Housefi team (after the assistant's questions). */
export interface SupportConversation {
  readonly id: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly topic: SupportTopic;
  readonly bookingCode: string | null;
  readonly createdAt: number;
  readonly messages: readonly { readonly id: string; readonly from: 'ME' | 'HQ' | 'SYSTEM'; readonly text: string; readonly at: number }[];
}

/** Customer care, for customers and technicians alike. */
export interface SupportApi {
  /** Asks Housefi to call this person back (about a booking, when given). */
  callback(token: string, bookingId: string | null, reason?: string): Promise<void>;
  /** Reports a problem to the support team. UNSAFE is urgent: the safety team calls at once, and sees where the phone was. */
  ticket(token: string, kind: 'UNSAFE' | 'PAYMENT_PROBLEM' | 'OTHER', bookingId: string | null, note?: string, location?: Position | null): Promise<void>;
  /** The open conversation with the team (or one closed in the last day), or null. */
  conversation(token: string): Promise<SupportConversation | null>;
  /** Starts it after the intake (or adds to the open one). NOT_FOUND for a booking that is not theirs. */
  startConversation(token: string, input: { topic: SupportTopic; bookingId: string | null; text: string }): Promise<SupportConversation>;
  /** Writes in the open conversation. CONFLICT once the team closed it. */
  sendToTeam(token: string, text: string): Promise<SupportConversation>;
}

/** Housefi's public verification page for a scanned Technician ID card. No sign-in; minimal data. */
export interface VerifyApi {
  /** NOT_FOUND for an unknown or withdrawn token. */
  technician(verifyToken: string): Promise<TechVerifyResult>;
}

/** One chat message: words and/or a photo. */
export interface ChatMessage {
  readonly id: string;
  /** ME: sent from this phone's account; THEM: from the other side. */
  readonly from: 'ME' | 'THEM';
  readonly text: string;
  /** A link to the photo (short-lived; the screen asks again for fresh ones); null for words only. */
  readonly photo: string | null;
  readonly at: number;
}

/** The chat between a customer and the assigned technician, from assignment until the job is done. */
export interface Chat {
  readonly bookingId: string;
  /** Messages can be sent (the job is on). */
  readonly open: boolean;
  /** The job is done: either side can clear it; it clears itself at clearsAt anyway. */
  readonly clearable: boolean;
  readonly clearsAt: number | null;
  /** Oldest first. */
  readonly messages: readonly ChatMessage[];
}

/** A chat in the floating chat bubble: open, or with unread messages. */
export interface ChatSummary {
  readonly bookingId: string;
  readonly code: string;
  readonly open: boolean;
  readonly unread: number;
}

/** The same calls for the customer (their bookings) and the technician (their jobs). */
export interface ChatApi {
  list(token: string): Promise<readonly ChatSummary[]>;
  /** Reading it marks it read. */
  get(token: string, bookingId: string): Promise<Chat>;
  /** Words and/or a photo (a local file; uploaded first). */
  send(token: string, bookingId: string, input: { readonly text: string; readonly photoUri?: string }): Promise<Chat>;
  /** Only once the job is done (CONFLICT before). */
  clear(token: string, bookingId: string): Promise<void>;
}

export interface Backend {
  readonly mode: 'DEMO' | 'LIVE';
  readonly auth: AuthApi;
  readonly catalog: CatalogApi;
  readonly addresses: AddressApi;
  readonly bookings: BookingApi;
  readonly ai: AiApi;
  readonly notifications: NotificationApi;
  readonly tech: TechApi;
  readonly verify: VerifyApi;
  readonly support: SupportApi;
  /** The customer's chats with their technicians. */
  readonly chat: ChatApi;
  readonly demo: DemoControls | null;
}

/** Where the app keeps small values (AsyncStorage in the app, memory in tests). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
