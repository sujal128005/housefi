// Domain types shared by the screens and the service layer. They describe what the app shows, not how a backend
// stores it; the real API client will map its responses onto these shapes.
import type { Localized } from '../i18n/format';
import type { WashName } from '../theme/tokens';

export type CategoryId = 'PLUMBING' | 'ELECTRICAL' | 'AC' | 'APPLIANCE' | 'CLEANING' | 'CARPENTRY';

export type CategoryArt = 'faucet' | 'bulb' | 'ac' | 'washer' | 'spray' | 'hammer';

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
  /** Whole rupees, paid after the visit. */
  readonly visitFee: number;
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
  readonly pincode: string;
}

export interface Address extends AddressInput {
  readonly id: string;
  readonly city: string;
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

export interface VoiceNote {
  readonly durationSec: number;
  /** Demo recordings are simulated; a real build stores a local file uri here. */
  readonly simulated: true;
}

export interface Photo {
  readonly id: string;
  /** Which bundled sample picture to show (demo). */
  readonly sample: number;
}

export interface ProblemDescription {
  readonly issueIds: readonly string[];
  readonly notes: string;
  readonly voiceNote: VoiceNote | null;
  readonly photos: readonly Photo[];
}

export type BookingStatus = 'MATCHING' | 'MATCHING_DELAYED' | 'ASSIGNED' | 'UNFULFILLED' | 'CANCELLED';

export const ACTIVE_STATUSES: readonly BookingStatus[] = ['MATCHING', 'MATCHING_DELAYED', 'ASSIGNED', 'UNFULFILLED'];

export type CancelReason = 'PLANS_CHANGED' | 'FIXED' | 'TOO_LONG' | 'MISTAKE' | 'OTHER';

export interface Technician {
  readonly id: string;
  readonly name: Localized;
  readonly rating: number;
  readonly jobs: number;
  readonly years: number;
  /** Always true in this build: every technician shown is fictional. */
  readonly demo: true;
}

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
  readonly window: VisitWindow;
  readonly visitFee: number;
  readonly status: BookingStatus;
  readonly technician: Technician | null;
  readonly createdAt: number;
  /** When the current round of matching started (reset by a reschedule). */
  readonly matchingStartedAt: number;
  readonly history: readonly StatusEvent[];
  readonly cancelReason: CancelReason | null;
  readonly demo: true;
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
