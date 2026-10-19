// Technician registration, step by step: details → Aadhaar scan → "checking your details" (with the time the check is
// promised by) → verified. An approval is shown only from the promised time (reviewBy from the server, like Apple's
// account recovery), even when it was given earlier; a request to correct something shows at once.
import type { TechProfile } from './types';

export type TechStage =
  /** Fill in the profile (first time). */
  | 'DETAILS'
  /** Scan the Aadhaar Secure QR (required before the check). */
  | 'AADHAAR'
  /** Waiting for the check, until the promised time. */
  | 'CHECKING'
  /** Something to correct. */
  | 'FIX'
  /** Rejected or suspended: no jobs. */
  | 'STOPPED'
  /** Verified and shown: the technician app. */
  | 'READY';

type Reviewable = Pick<TechProfile, 'verification' | 'aadhaar' | 'reviewBy'>;

/** True when an approval may be shown: approved, and the promised time has come. */
export function approvalShown(p: Reviewable, now: number): boolean {
  return p.verification === 'APPROVED' && (p.reviewBy == null || now >= p.reviewBy);
}

export function techStage(p: Reviewable, now: number): TechStage {
  switch (p.verification) {
    case null: return 'DETAILS';
    case 'REJECTED':
    case 'SUSPENDED': return 'STOPPED';
    case 'NEEDS_CORRECTION': return 'FIX';
    case 'APPROVED': return approvalShown(p, now) ? 'READY' : 'CHECKING';
    case 'PENDING': return p.aadhaar ? 'CHECKING' : 'AADHAAR';
  }
}

/** Where the technician app opens for this profile. */
export function techHref(p: Reviewable, now: number): '/tech/setup' | '/tech/aadhaar' | '/tech/verification' | '/tech/home' {
  switch (techStage(p, now)) {
    case 'DETAILS': return '/tech/setup';
    case 'AADHAAR': return '/tech/aadhaar';
    case 'READY': return '/tech/home';
    default: return '/tech/verification';
  }
}
