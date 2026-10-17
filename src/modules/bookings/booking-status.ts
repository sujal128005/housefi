// The booking state machine from docs/STATE-MACHINE.md, in one place. Every status change in the code goes through
// `canTransition`; anything not listed here is CONFLICT.
import type { BookingStatus } from '@prisma/client';

export const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  AWAITING_PAYMENT: ['PAYMENT_PENDING', 'MATCHING', 'CANCELLED'],
  PAYMENT_PENDING: ['MATCHING', 'AWAITING_PAYMENT'],
  MATCHING: ['ASSIGNED', 'MATCHING_DELAYED', 'CANCELLED'],
  MATCHING_DELAYED: ['ASSIGNED', 'UNFULFILLED', 'MATCHING', 'CANCELLED'],
  UNFULFILLED: ['MATCHING', 'CANCELLED'],
  ASSIGNED: ['MATCHING', 'EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['INSPECTING', 'CLOSED_NO_REPAIR'],
  INSPECTING: ['QUOTE_SHARED', 'CLOSED_NO_REPAIR'],
  QUOTE_SHARED: ['QUOTE_SHARED', 'IN_PROGRESS', 'CLOSED_NO_REPAIR'],
  IN_PROGRESS: ['EXTRA_WORK', 'PAYMENT_DUE', 'CLOSED_NO_REPAIR'],
  EXTRA_WORK: ['IN_PROGRESS'],
  PAYMENT_DUE: ['COMPLETED'],
  COMPLETED: [],
  CLOSED_NO_REPAIR: [],
  CANCELLED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Still in progress: listed under "Active" (types.ts ACTIVE_STATUSES). */
export const ACTIVE_STATUSES: readonly BookingStatus[] = [
  'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED',
  'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE',
];

/** The customer may cancel until the technician is at the door ("Who may do what"). */
export const CANCELLABLE: readonly BookingStatus[] = ['AWAITING_PAYMENT', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED', 'EN_ROUTE'];

/** Cancelling here refunds the ₹49 visit fee: paid, and the technician has not started travelling. */
export const REFUND_ON_CANCEL: readonly BookingStatus[] = ['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED'];

/** Rescheduling goes back to MATCHING from these ("Who may do what"). */
export const RESCHEDULABLE: readonly BookingStatus[] = ['MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED'];

/** A scheduled booking in these statuses holds its time window (counts against slot capacity). */
export const HOLDS_SLOT: readonly BookingStatus[] = ACTIVE_STATUSES.filter((s) => s !== 'UNFULFILLED');
