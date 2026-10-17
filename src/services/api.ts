// The contract between the screens and "the backend". Today the only implementation is the in-app mock
// (services/mock); the real backend will be a second implementation of these same interfaces (an HTTP client), so
// screens never change when it arrives.
import type {
  Address, AddressInput, Booking, CancelReason, Category, Customer, Earnings, Job, JobOffer, OfferRejectReason, PaymentMethod, Photo,
  ProblemDescription, QuoteLine, Rating, Service, Session, Slot, TechIdCard, TechIssue, TechProfile, TechProfileInput, TechSession,
  TechVerifyResult, VisitTime,
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
  /** Only the demo backend returns the code (it stands in for the SMS). Always null from a real backend. */
  readonly demoCode: string | null;
}

export interface AuthApi {
  requestOtp(phone: string): Promise<OtpChallenge>;
  verifyOtp(challengeId: string, code: string): Promise<{ readonly session: Session; readonly isNewCustomer: boolean }>;
  /** Re-validates a stored token at app start; null when it is no longer valid. */
  restore(token: string): Promise<Session | null>;
  updateName(token: string, name: string): Promise<Customer>;
  signOut(token: string): Promise<void>;
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
}

export type QuoteAnswer = 'APPROVE' | 'REVISION' | 'DECLINE';

export interface PaymentResult {
  readonly booking: Booking;
  /** PAID, PENDING (confirms later), or FAILED (nothing charged, try again). */
  readonly state: 'PAID' | 'PENDING' | 'FAILED';
}

export interface BookingApi {
  slots(serviceId: string, date: string): Promise<readonly Slot[]>;
  /** Creates the booking; it waits for the ₹49 visit fee before a technician is searched. */
  create(token: string, input: NewBooking): Promise<Booking>;
  /** Pays the visit fee (kind VISIT) or the final bill (kind FINAL). */
  pay(token: string, bookingId: string, kind: 'VISIT' | 'FINAL', method: PaymentMethod): Promise<PaymentResult>;
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
  /**
   * The digital ID card of the technician assigned to this customer's booking. NOT_FOUND unless the booking is the
   * customer's own and a technician is assigned (the same answer for other people's bookings, so nothing leaks).
   */
  technicianCard(token: string, bookingId: string): Promise<TechIdCard>;
  /** Live updates for one booking (polling today; a socket later). Returns an unsubscribe function. */
  watch(token: string, id: string, onChange: (b: Booking) => void, onError?: (e: unknown) => void): () => void;
}

/** What a notification is about; the app turns it into text in the person's language (key "notif.<kind>"). */
export type NotificationKind =
  // customer
  | 'TECH_ASSIGNED' | 'TECH_ON_THE_WAY' | 'TECH_ARRIVED' | 'QUOTE_READY' | 'EXTRA_QUOTE' | 'PAYMENT_DUE' | 'BOOKING_COMPLETED'
  | 'BOOKING_CANCELLED' | 'NO_TECHNICIAN'
  // technician
  | 'JOB_OFFER' | 'QUOTE_APPROVED' | 'QUOTE_REVISION' | 'QUOTE_DECLINED' | 'EXTRA_APPROVED' | 'EXTRA_DECLINED' | 'PAYMENT_RECEIVED'
  | 'JOB_CANCELLED' | 'PROFILE_APPROVED' | 'PROFILE_NEEDS_CORRECTION';

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

/** AI features. Dummy in this phase (rule-based / canned), real models later. */
export interface AiApi {
  /** The 6 problems most booked around this PIN code right now (AI-ranked). */
  topProblems(pincode: string | null, area: string | null): Promise<LocalTopProblems>;
  classifyPhoto(photo: Photo): Promise<PhotoSuggestion>;
  transcribe(durationSec: number, serviceId: string | null, locale: 'en' | 'te'): Promise<string>;
  chat(token: string, message: string, locale: 'en' | 'te'): Promise<ChatReply>;
}

// ---------- technician ----------

export interface QuoteLineInput {
  readonly kind: QuoteLine['kind'];
  readonly name: string;
  readonly qty: number;
  readonly unitPrice: number;
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
}

/** Everything the technician app does. Technician accounts and tokens are separate from customer ones. */
export interface TechApi {
  readonly auth: TechAuthApi;
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
  startWork(token: string, id: string): Promise<Job>;
  completeWork(token: string, id: string): Promise<Job>;
  /** The customer chose cash; the technician confirms it was received. */
  confirmCash(token: string, id: string): Promise<Job>;
  /** CUSTOMER_UNAVAILABLE and CANNOT_COMPLETE close the visit; the others alert support. */
  report(token: string, id: string, issue: TechIssue, note: string): Promise<Job>;
  earnings(token: string): Promise<Earnings>;
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

/** Housefi's public verification page for a scanned Technician ID card. No sign-in; minimal data. */
export interface VerifyApi {
  /** NOT_FOUND for an unknown or withdrawn token. */
  technician(verifyToken: string): Promise<TechVerifyResult>;
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
  readonly demo: DemoControls | null;
}

/** Where the app keeps small values (AsyncStorage in the app, memory in tests). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
