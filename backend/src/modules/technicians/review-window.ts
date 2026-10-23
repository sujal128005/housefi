// When a technician is told their profile will be confirmed. Set from the time they submitted (India time): during the
// day within 2 hours, in the evening within 4, and at night by the same time the next day; the team's own demo
// accounts (DEMO_PHONES) wait only DEMO_REVIEW_MS, so the team can try the whole flow quickly. The
// technician sees the approval only from then on (also its notification), even when it was given earlier; a request
// to correct something is shown at once.
import { istHour } from '../slots/slot-rules';

const HOUR_MS = 3_600_000;
/** The team's demo technicians see their approval this soon after submitting. */
export const DEMO_REVIEW_MS = 10_000;

/** Hours the check is promised to take for a profile submitted at `submittedAt` (ms). */
export function reviewHours(submittedAt: number): 2 | 4 | 24 {
  const h = istHour(submittedAt);
  if (h >= 9 && h < 18) return 2;
  if (h >= 18 && h < 22) return 4;
  return 24;
}

/**
 * When the review starts: the profile's submission, or the skill check's when that came later (a new technician sends
 * the skill check last, after the Aadhaar scan).
 */
export function reviewStart(t: { readonly submittedAt: Date; readonly skillSubmittedAt: Date | null }): number {
  return Math.max(t.submittedAt.getTime(), t.skillSubmittedAt?.getTime() ?? 0);
}

/** When the technician is told they will hear back (ms since epoch). */
export function reviewBy(submittedAt: number, demo = false): number {
  return submittedAt + (demo ? DEMO_REVIEW_MS : reviewHours(submittedAt) * HOUR_MS);
}
