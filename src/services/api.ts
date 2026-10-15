// The contract between the screens and "the backend". Today the only implementation is the in-app mock
// (services/mock); the real backend will be a second implementation of these same interfaces (an HTTP client), so
// screens never change when it arrives.
import type {
  Address, AddressInput, Booking, CancelReason, Category, Customer, ProblemDescription, Service, Session, Slot, VisitWindow,
} from '../domain/types';
import type { MatchingScenario } from '../domain/rules';

export type ApiErrorCode =
  | 'NETWORK'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'SLOT_UNAVAILABLE'
  | 'CONFLICT';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** True when demo settings forced this error, so the UI can say so. */
  readonly simulated: boolean;
  readonly attemptsLeft: number | undefined;

  constructor(code: ApiErrorCode, opts: { simulated?: boolean; attemptsLeft?: number; message?: string } = {}) {
    super(opts.message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.simulated = opts.simulated ?? false;
    this.attemptsLeft = opts.attemptsLeft;
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
  readonly window: VisitWindow;
}

export interface BookingApi {
  slots(serviceId: string, date: string): Promise<readonly Slot[]>;
  create(token: string, input: NewBooking): Promise<Booking>;
  get(token: string, id: string): Promise<Booking>;
  list(token: string): Promise<readonly Booking[]>;
  cancel(token: string, id: string, reason: CancelReason | null): Promise<Booking>;
  reschedule(token: string, id: string, window: VisitWindow): Promise<Booking>;
  /** Live updates for one booking (polling today; a socket later). Returns an unsubscribe function. */
  watch(token: string, id: string, onChange: (b: Booking) => void, onError?: (e: unknown) => void): () => void;
}

export type FailNext = 'OFF' | 'NETWORK' | 'SLOT_TAKEN';

export interface DemoSettings {
  readonly matching: MatchingScenario;
  readonly failNext: FailNext;
}

export type DemoOutcome = 'ASSIGN' | 'DELAY' | 'NONE';

/** Controls that exist only in demo mode. */
export interface DemoControls {
  settings(): Promise<DemoSettings>;
  updateSettings(patch: Partial<DemoSettings>): Promise<DemoSettings>;
  simulate(token: string, bookingId: string, outcome: DemoOutcome): Promise<Booking>;
  reset(): Promise<void>;
}

export interface Backend {
  readonly mode: 'DEMO' | 'LIVE';
  readonly auth: AuthApi;
  readonly catalog: CatalogApi;
  readonly addresses: AddressApi;
  readonly bookings: BookingApi;
  readonly demo: DemoControls | null;
}

/** Where the app keeps small values (AsyncStorage in the app, memory in tests). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
