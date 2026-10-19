// Domain types shared by the screens and the service layer. They describe what the app shows, not how a backend
// stores it; the real API client will map its responses onto these shapes.
import type { Localized } from '../i18n/format';
import type { WashName } from '../theme/tokens';

export type CategoryId = 'PLUMBING' | 'ELECTRICAL' | 'AC' | 'APPLIANCE' | 'CLEANING' | 'CARPENTRY';

/** Which 3D artwork represents a category (keys of the art registry). */
export type CategoryArt = 'tap' | 'bulb' | 'snowflake' | 'tv' | 'sponge' | 'saw';

export interface Category {
  readonly id: CategoryId;
  readonly name: Localized;
  readonly tagline: Localized;
  readonly art: CategoryArt;
  readonly wash: WashName;
}

export interface Issue {
  readonly id: string;
  readonly name: Localized;
}

export interface Service {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly name: Localized;
  readonly description: Localized;
  /** Whole rupees, paid in advance when booking. */
  readonly visitFee: number;
  /** Lowest repair charge (labour + materials) after inspection. */
  readonly repairFrom: number;
  readonly durationMin: readonly [number, number];
  readonly rating: number;
  readonly reviews: number;
  readonly issues: readonly Issue[];
  /** Extra search words (both languages, common spellings). */
  readonly keywords: readonly string[];
  readonly popular?: boolean;
}

export type AddressLabel = 'HOME' | 'WORK' | 'OTHER';

export interface AddressInput {
  readonly label: AddressLabel;
  readonly house: string;
  readonly street: string;
  readonly landmark: string;
  readonly city: string;
  readonly pincode: string;
  /** Present when the address came from the phone's location. Stays on the device in this phase. */
  readonly lat?: number;
  readonly lng?: number;
}

export interface Address extends AddressInput {
  readonly id: string;
}

export type SlotState = 'OPEN' | 'FULL' | 'CLOSED';

export interface Slot {
  /** "2026-10-16@9" */
  readonly id: string;
  /** Local calendar date, "2026-10-16". */
  readonly date: string;
  readonly startHour: number;
  readonly endHour: number;
  readonly state: SlotState;
}

export interface VisitWindow {
  readonly date: string;
  readonly startHour: number;
  readonly endHour: number;
}

export type BookingMode = 'INSTANT' | 'SCHEDULED';

export interface VisitTime {
  readonly mode: BookingMode;
  /** Scheduled visits only. */
  readonly window: VisitWindow | null;
}

export interface VoiceNote {
  readonly durationSec: number;
  /** What the AI understood from the recording; added to the problem description. */
  readonly transcript: string;
  /** The uploaded recording (sent with the booking). */
  readonly audioId?: string | null;
  /** The recording on this phone, before booking. */
  readonly uri?: string;
}

export interface Photo {
  readonly id: string;
  /** A real photo from the camera or gallery (local file, never uploaded in this phase). */
  readonly uri?: string;
  /** Or a bundled sample picture (demo). */
  readonly sample?: number;
}

export interface ProblemDescription {
  readonly issueIds: readonly string[];
  readonly notes: string;
  readonly voiceNote: VoiceNote | null;
  readonly photos: readonly Photo[];
}

export type PaymentMethod = 'UPI' | 'CARD' | 'NETBANKING' | 'CASH';
export type PaymentState = 'DUE' | 'PROCESSING' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export interface Payment {
  readonly kind: 'VISIT' | 'FINAL';
  readonly amount: number;
  readonly state: PaymentState;
  readonly method: PaymentMethod | null;
  /** Demo transaction id once paid. */
  readonly txnId: string | null;
  readonly at: number | null;
}

/**
 * Where a booking is, from the customer's side:
 * pay the visit fee -> find a technician -> (scheduled: wait for the day) -> on the way -> arrived (share OTP) ->
 * inspecting -> quote -> work (maybe extra work) -> pay -> completed.
 */
export type BookingStatus =
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_PENDING'
  | 'MATCHING'
  | 'MATCHING_DELAYED'
  | 'UNFULFILLED'
  | 'ASSIGNED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'INSPECTING'
  | 'QUOTE_SHARED'
  | 'IN_PROGRESS'
  | 'EXTRA_WORK'
  | 'PAYMENT_DUE'
  | 'COMPLETED'
  | 'CLOSED_NO_REPAIR'
  | 'CANCELLED';

export type CancelReason = 'PLANS_CHANGED' | 'FIXED' | 'TOO_LONG' | 'MISTAKE' | 'OTHER';

export type Gender = 'M' | 'F';

export interface Technician {
  readonly id: string;
  readonly name: Localized;
  readonly gender: Gender;
  readonly rating: number;
  readonly jobs: number;
  readonly years: number;
  /** Rated highly by women customers. */
  readonly womenRated: boolean;
  readonly vehicle: string;
  /** Number shown for masked calls (demo). */
  readonly maskedPhone: string;
  /** True when the record comes from the demo backend (fictional technicians); false from the live backend. */
  readonly demo: boolean;
}

/** A technician as the customer of an assigned booking sees them (the booking's snapshot plus their identity). */
export interface AssignedTechnician extends Technician {
  /** Permanent Housefi Technician ID, N9-HF-T-XXXXXX. */
  readonly techCode: string;
  /** The approved profile photo (a URI, or "demo:<illustration>" for the demo's sample photos); null when none is on file. */
  readonly photo: string | null;
  readonly verification: Verification;
  /** The verification came from the demo backend: it is simulated, never a real check. */
  readonly verificationSimulated: boolean;
  readonly skills: readonly CategoryId[];
  /** A fictional technician of the demo (no real person, no real photo). */
  readonly fictional: boolean;
}

export interface QuoteLine {
  readonly kind: 'LABOUR' | 'MATERIAL';
  /** Technician-typed lines carry the same text in both languages. */
  readonly name: Localized;
  readonly qty: number;
  /** Whole rupees. */
  readonly unitPrice: number;
}

/**
 * The (demo) AI price check every technician quote goes through before the customer sees it:
 * CHECKING -> FAIR (shared at once) or UNDER_REVIEW (a Housefi reviewer looks first) -> CLEARED (shared).
 */
export type QuoteReviewState = 'CHECKING' | 'FAIR' | 'UNDER_REVIEW' | 'CLEARED';

export interface QuoteReview {
  readonly state: QuoteReviewState;
  /** Usual price range for this service, whole rupees. */
  readonly typicalMin: number;
  readonly typicalMax: number;
}

export type QuoteDecision = 'PENDING' | 'APPROVED' | 'REVISION_REQUESTED' | 'REJECTED';

export interface Quote {
  readonly id: string;
  /** 1 for the first quote, +1 for each revision. */
  readonly version: number;
  readonly lines: readonly QuoteLine[];
  readonly labourTotal: number;
  readonly materialTotal: number;
  readonly total: number;
  /** What the technician found. */
  readonly diagnosis: Localized;
  readonly review: QuoteReview;
  readonly decision: QuoteDecision;
  readonly at: number;
}

/** True once the AI check (or the reviewer) has passed the quote and the customer can see it. */
export function quoteVisible(q: Quote | null): boolean {
  return !!q && (q.review.state === 'FAIR' || q.review.state === 'CLEARED');
}

export interface Rating {
  /** "Were you satisfied with the work?" Yes / No. */
  readonly satisfied: boolean;
  /** 1-5. */
  readonly stars: number;
  readonly tags: readonly string[];
  readonly comment: string;
  /**
   * Optional, self-declared by the customer ("I'm a woman"). Used only to work out a technician's "Rated highly by
   * women" badge; never shown to anyone or attached to the customer's name.
   */
  readonly byWoman?: boolean;
  readonly at: number;
}

/** Why a visit ended without a repair. */
export type CloseReason = 'CUSTOMER_DECLINED' | 'CUSTOMER_UNAVAILABLE' | 'CANNOT_COMPLETE';

export interface StatusEvent {
  readonly status: BookingStatus;
  readonly at: number;
}

export interface Booking {
  readonly id: string;
  /** Short code shown to people, e.g. "HF-48291". */
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: CategoryId;
  readonly problem: ProblemDescription;
  /** A copy of the address at booking time. */
  readonly address: Address;
  readonly time: VisitTime;
  readonly preferWomenRated: boolean;
  readonly status: BookingStatus;
  readonly technician: AssignedTechnician | null;
  /** 4-digit code the customer tells the technician at the door (starts the visit). */
  readonly arrivalOtp: string;
  /** Live estimate while the technician travels, in minutes. */
  readonly etaMin: number | null;
  /** Where the technician is, only while on the way (EN_ROUTE) and only a recent point. */
  readonly technicianLocation?: { readonly lat: number; readonly lng: number; readonly accuracyM: number | null; readonly at: number } | null;
  readonly visitPayment: Payment;
  readonly quote: Quote | null;
  /** Additional work found during the repair, waiting for approval. */
  readonly extraQuote: Quote | null;
  readonly finalPayment: Payment | null;
  readonly rating: Rating | null;
  readonly createdAt: number;
  readonly history: readonly StatusEvent[];
  readonly cancelReason: CancelReason | null;
  readonly closeReason: CloseReason | null;
  /** The technician has started the repair (after the quote was approved). */
  readonly workStarted: boolean;
  /** Handled by a technician using the technician app (on this device in the demo) rather than the simulator. */
  readonly viaTechApp: boolean;
  /** True when the record comes from the demo backend; false from the live backend. */
  readonly demo: boolean;
}

export interface Customer {
  readonly id: string;
  readonly phone: string;
  readonly name: string;
}

export interface Session {
  readonly token: string;
  readonly customer: Customer;
}

/** Booking states still in progress (shown under "Active"). */
export const ACTIVE_STATUSES: readonly BookingStatus[] = [
  'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED',
  'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE',
];

// ---------- technician side ----------

/**
 * PENDING: submitted, being checked. APPROVED: checked and allowed to work. NEEDS_CORRECTION: sent back with a note.
 * REJECTED: not accepted. SUSPENDED: was approved, access withdrawn later. Only APPROVED technicians get jobs.
 */
export type Verification = 'PENDING' | 'APPROVED' | 'NEEDS_CORRECTION' | 'REJECTED' | 'SUSPENDED';

/**
 * Who the technician is, as Housefi holds it. Set once when the profile is first submitted; after that the technician
 * cannot change it (corrections go through support / admin review).
 */
export interface TechIdentity {
  /** Permanent, unique, non-sequential Housefi Technician ID (N9-HF-T-XXXXXX), assigned by the backend. */
  readonly techCode: string;
  /** Full legal name, as on the identity document. */
  readonly legalName: string;
  /** Profile photo taken or uploaded at registration ("demo:<illustration>" for the demo's sample photo). */
  readonly photo: string;
  /** PENDING until the verification is approved. */
  readonly photoStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** The verification is simulated by the demo backend (never a real check). */
  readonly simulated: boolean;
  /** A correction the technician asked support for (name or photo), if any. */
  readonly correctionRequest: { readonly kind: 'NAME' | 'PHOTO'; readonly note: string; readonly at: number } | null;
}

/** The digital Housefi Technician ID card: only what is needed to confirm who the technician is. */
export interface TechIdCard {
  readonly techCode: string;
  readonly name: string;
  readonly photo: string | null;
  readonly photoStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly gender: Gender;
  readonly skills: readonly CategoryId[];
  readonly verification: Verification;
  readonly simulated: boolean;
  /** Link in the QR code: Housefi's verification page with a random, non-guessable token (no personal data). */
  readonly verifyUrl: string;
  /** The verification page is the demo one inside this app, not a live public page. */
  readonly verifyIsDemo: boolean;
  readonly fictional: boolean;
}

/** What Housefi's verification page shows for a scanned card: the minimum, and the status as of now. */
export interface TechVerifyResult {
  readonly techCode: string;
  /** First name and last initial. */
  readonly displayName: string;
  readonly photo: string | null;
  readonly gender: Gender;
  readonly verification: Verification;
  readonly simulated: boolean;
  /** Allowed to work for Housefi right now. */
  readonly active: boolean;
  readonly checkedAt: number;
  readonly fictional: boolean;
}

export interface TechProfileInput {
  readonly name: string;
  readonly gender: Gender;
  readonly experienceYears: number;
  readonly skills: readonly CategoryId[];
  /** Base city and PIN code; jobs are offered around this area. */
  readonly city: string;
  readonly pincode: string;
  /** Localities they cover, free text ("Banjara Hills, Jubilee Hills"). */
  readonly areas: string;
  /** Optional, e.g. "Scooter · TS 09 AB 1234". */
  readonly vehicle: string;
  /** Required on the first submission (taken or uploaded); ignored afterwards: the photo cannot be replaced by the technician. */
  readonly photo?: string;
}

export interface TechProfile extends TechProfileInput {
  readonly id: string;
  readonly phone: string;
  /** null until the profile is submitted. */
  readonly verification: Verification | null;
  /** null until the profile is first submitted. */
  readonly identity: TechIdentity | null;
  readonly correctionNote: Localized | null;
  /** Available for new jobs. */
  readonly online: boolean;
  /** Average customer stars; null until the first rating. */
  readonly rating: number | null;
  readonly jobsDone: number;
  /** Aadhaar checked offline from the Secure QR on the card (only the last 4 digits are kept); null until then. */
  readonly aadhaar?: { readonly last4: string; readonly nameMatches: boolean; readonly verifiedAt: number } | null;
}

export interface TechSession {
  readonly token: string;
  readonly profile: TechProfile;
}

/** A job offered to one technician. Shows the area, not the exact address, until accepted. */
export interface JobOffer {
  readonly id: string;
  readonly bookingId: string;
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: CategoryId;
  readonly issueIds: readonly string[];
  readonly notes: string;
  readonly photoCount: number;
  /** Street / locality and city only. */
  readonly area: string;
  readonly pincode: string;
  readonly time: VisitTime;
  readonly distanceKm: number;
  /** Visit share the technician earns even if no repair happens. */
  readonly visitEarning: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type OfferRejectReason = 'TOO_FAR' | 'BUSY' | 'NOT_MY_SKILL' | 'OTHER';

export type TechIssue = 'CUSTOMER_UNAVAILABLE' | 'WRONG_ADDRESS' | 'UNSAFE' | 'CANNOT_COMPLETE' | 'PAYMENT_PROBLEM' | 'OTHER';

/** A booking as the assigned technician sees it. */
export interface Job {
  readonly id: string;
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: CategoryId;
  readonly problem: ProblemDescription;
  /** First name only. */
  readonly customerName: string;
  readonly address: Address;
  /** Masked number that forwards to the customer (calls never show the real number). */
  readonly maskedPhone: string;
  readonly time: VisitTime;
  readonly status: BookingStatus;
  readonly quote: Quote | null;
  readonly extraQuote: Quote | null;
  readonly visitPayment: Payment;
  readonly finalPayment: Payment | null;
  readonly workStarted: boolean;
  readonly closeReason: CloseReason | null;
  readonly cancelReason: CancelReason | null;
  /** Wrong start-code attempts left before the visit is locked (then support must help). */
  readonly otpAttemptsLeft: number;
  /** What this job earns the technician so far (whole rupees). */
  readonly earning: number;
  readonly rating: Rating | null;
  readonly history: readonly StatusEvent[];
  readonly acceptedAt: number;
  /** A practice job with a simulated customer (Demo settings), not a real customer's booking. */
  readonly practice: boolean;
  /** True when the record comes from the demo backend; false from the live backend. */
  readonly demo: boolean;
}

export type PayoutState = 'PENDING' | 'PAID';

export interface EarningEntry {
  readonly jobId: string;
  readonly code: string;
  readonly serviceId: string;
  readonly amount: number;
  readonly at: number;
  readonly payout: PayoutState;
}

export interface Earnings {
  readonly today: number;
  readonly jobsToday: number;
  readonly total: number;
  /** Earned, not yet paid out. */
  readonly pendingPayout: number;
  /** Next weekly payout date, "2026-10-19". */
  readonly nextPayoutOn: string;
  readonly entries: readonly EarningEntry[];
  /** This week and the ones before it, newest first (missing on older servers). */
  readonly weeks?: readonly EarningsWeek[];
}

/** One week (Monday to Sunday) of earnings, and what happened to its payout. Paid on the Monday after it. */
export interface EarningsWeek {
  /** Monday, "2026-10-12". */
  readonly start: string;
  /** Sunday. */
  readonly end: string;
  readonly earned: number;
  /** Cash collected from customers that week (deducted in the payout). */
  readonly cash: number;
  readonly jobs: number;
  readonly payout: {
    /** CARRIED: added to a later payout; NONE: nothing earned. */
    readonly state: 'UPCOMING' | 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CARRIED' | 'NONE';
    /** The Monday it is paid on; for PAID the day it was paid. */
    readonly on: string | null;
    readonly amount: number | null;
    /** Bank / UPI reference once paid. */
    readonly ref: string | null;
  };
}
