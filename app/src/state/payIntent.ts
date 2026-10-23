// "Pay straight away" may only come from inside the app (Confirm & pay), never from a link: housefi://pay?...&auto=1
// opened by another app or a web page must not start a payment by itself. Confirm & pay marks the booking here (in
// memory only); the payment screen starts automatically only if it can take that mark, once, within a minute.
const TTL_MS = 60_000;
const intents = new Map<string, number>();

export function markPayIntent(bookingId: string, now: number = Date.now()): void {
  intents.set(bookingId, now + TTL_MS);
}

/**
 * Whether a booking has a fresh mark, without using it up: the payment screen checks on opening and uses the mark
 * only when the payment really starts (navigation may open the screen twice in quick succession).
 */
export function hasPayIntent(bookingId: string | undefined, now: number = Date.now()): boolean {
  const until = bookingId ? intents.get(bookingId) : undefined;
  return until !== undefined && now <= until;
}

/** True once for a booking marked in the last minute; the mark is used up either way. */
export function takePayIntent(bookingId: string | undefined, now: number = Date.now()): boolean {
  if (!bookingId) return false;
  const until = intents.get(bookingId);
  intents.delete(bookingId);
  return until !== undefined && now <= until;
}
