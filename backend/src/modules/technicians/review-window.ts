// When a technician is told their profile will be confirmed. Set from the time they submitted (India time): during the
// day the team checks within 2 hours, in the evening within 4, and at night by the same time the next day. The
// technician sees the approval only from then on (also its notification), even when it was given earlier; a request
// to correct something is shown at once.
import { istHour } from '../slots/slot-rules';

const HOUR_MS = 3_600_000;

/** Hours the check is promised to take for a profile submitted at `submittedAt` (ms). */
export function reviewHours(submittedAt: number): 2 | 4 | 24 {
  const h = istHour(submittedAt);
  if (h >= 9 && h < 18) return 2;
  if (h >= 18 && h < 22) return 4;
  return 24;
}

/** When the technician is told they will hear back (ms since epoch). */
export function reviewBy(submittedAt: number): number {
  return submittedAt + reviewHours(submittedAt) * HOUR_MS;
}
