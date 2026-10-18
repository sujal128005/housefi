// A booking created on "Confirm & pay" waits for its ₹49 visit fee. If the customer leaves that step first (or the
// booking only arrives after they left), it is withdrawn so it does not hold a slot. Best effort: nothing has been
// paid, and a booking that has moved on (paid, pending at the bank) is left alone.
import type { Backend } from '../services/api';

/** Cancels the booking if it is still waiting for the visit fee. Resolves true when it was cancelled. */
export async function withdrawUnpaid(backend: Backend, token: string, bookingId: string): Promise<boolean> {
  try {
    const b = await backend.bookings.get(token, bookingId);
    if (b.status !== 'AWAITING_PAYMENT') return false;
    await backend.bookings.cancel(token, bookingId, null);
    return true;
  } catch {
    return false;
  }
}
