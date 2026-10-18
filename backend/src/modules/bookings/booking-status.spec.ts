import type { BookingStatus } from '@prisma/client';
import { ACTIVE_STATUSES, CANCELLABLE, canTransition, HOLDS_SLOT, REFUND_ON_CANCEL, RESCHEDULABLE, TRANSITIONS } from './booking-status';

const ALL = Object.keys(TRANSITIONS) as BookingStatus[];

describe('booking state machine (docs/STATE-MACHINE.md)', () => {
  it('covers all 16 statuses', () => {
    expect(ALL).toHaveLength(16);
  });

  it('ends at COMPLETED, CLOSED_NO_REPAIR and CANCELLED', () => {
    for (const s of ['COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED'] as const) expect(TRANSITIONS[s]).toEqual([]);
    expect(ALL.filter((s) => !ACTIVE_STATUSES.includes(s)).sort()).toEqual(['CANCELLED', 'CLOSED_NO_REPAIR', 'COMPLETED']);
  });

  it('follows the main path', () => {
    const path: BookingStatus[] = ['AWAITING_PAYMENT', 'MATCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'PAYMENT_DUE', 'COMPLETED'];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });

  it('lets the customer cancel exactly until the technician is at the door', () => {
    expect([...CANCELLABLE].sort()).toEqual(['ASSIGNED', 'AWAITING_PAYMENT', 'EN_ROUTE', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED']);
    for (const s of ALL) expect(canTransition(s, 'CANCELLED')).toBe(CANCELLABLE.includes(s));
  });

  it('refunds only when paid and before the trip starts', () => {
    expect(REFUND_ON_CANCEL).not.toContain('AWAITING_PAYMENT');
    expect(REFUND_ON_CANCEL).not.toContain('EN_ROUTE');
    for (const s of REFUND_ON_CANCEL) expect(CANCELLABLE).toContain(s);
  });

  it('reschedules back to MATCHING', () => {
    for (const s of RESCHEDULABLE) expect(canTransition(s, 'MATCHING')).toBe(true);
    expect(canTransition('EN_ROUTE', 'MATCHING')).toBe(false);
  });

  it('refuses everything else, e.g. jumping ahead or going back', () => {
    expect(canTransition('AWAITING_PAYMENT', 'ASSIGNED')).toBe(false);
    expect(canTransition('ARRIVED', 'CANCELLED')).toBe(false);
    expect(canTransition('PAYMENT_DUE', 'IN_PROGRESS')).toBe(false);
  });

  it('releases the time window once a booking is cancelled, finished or unfulfilled', () => {
    for (const s of ['CANCELLED', 'COMPLETED', 'CLOSED_NO_REPAIR', 'UNFULFILLED'] as const) expect(HOLDS_SLOT).not.toContain(s);
    expect(HOLDS_SLOT).toContain('AWAITING_PAYMENT');
  });
});
