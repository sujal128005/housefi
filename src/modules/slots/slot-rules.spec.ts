import { bookableDates, isIsoDate, istDate, slotsFor, windowStartMs } from './slot-rules';

/** An instant given as IST wall-clock time. */
const ist = (date: string, hh: number, mm = 0, ss = 0) => windowStartMs(date, hh) + mm * 60_000 + ss * 1000;
const none = new Map<number, number>();

describe('slot rules (IST)', () => {
  it('uses the India date, not the server date', () => {
    // 2026-10-16 20:00 UTC is already 01:30 on the 17th in India.
    expect(istDate(Date.UTC(2026, 9, 16, 20, 0))).toBe('2026-10-17');
    expect(windowStartMs('2026-10-17', 8)).toBe(Date.UTC(2026, 9, 17, 2, 30));
  });

  it('offers today and the next six days', () => {
    expect(bookableDates(ist('2026-10-16', 12))).toEqual([
      '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
    ]);
    // Across a month end.
    expect(bookableDates(ist('2026-10-30', 9)).at(-1)).toBe('2026-11-05');
  });

  it('returns six 2-hour windows from 8 to 20 with ids like the app', () => {
    const slots = slotsFor({ date: '2026-10-17', nowMs: ist('2026-10-16', 12), capacity: 10, booked: none });
    expect(slots.map((s) => [s.id, s.startHour, s.endHour, s.state])).toEqual([
      ['2026-10-17@8', 8, 10, 'OPEN'], ['2026-10-17@10', 10, 12, 'OPEN'], ['2026-10-17@12', 12, 14, 'OPEN'],
      ['2026-10-17@14', 14, 16, 'OPEN'], ['2026-10-17@16', 16, 18, 'OPEN'], ['2026-10-17@18', 18, 20, 'OPEN'],
    ]);
  });

  it('closes a window 60 minutes before it starts (exactly 60 is still open)', () => {
    const state = (now: number) => slotsFor({ date: '2026-10-16', nowMs: now, capacity: 10, booked: none }).find((s) => s.startHour === 14)?.state;
    expect(state(ist('2026-10-16', 13, 0, 0))).toBe('OPEN');
    expect(state(ist('2026-10-16', 13, 0, 1))).toBe('CLOSED');
    const today = slotsFor({ date: '2026-10-16', nowMs: ist('2026-10-16', 12), capacity: 10, booked: none });
    expect(today.map((s) => s.state)).toEqual(['CLOSED', 'CLOSED', 'CLOSED', 'OPEN', 'OPEN', 'OPEN']);
  });

  it('closes every window outside the 7 bookable days', () => {
    const now = ist('2026-10-16', 12);
    for (const date of ['2026-10-15', '2026-10-23', '2027-01-01']) {
      expect(slotsFor({ date, nowMs: now, capacity: 10, booked: none }).every((s) => s.state === 'CLOSED')).toBe(true);
    }
  });

  it('marks windows FULL at capacity (closed wins over full)', () => {
    const booked = new Map([[8, 3], [10, 2], [12, 5]]);
    const slots = slotsFor({ date: '2026-10-17', nowMs: ist('2026-10-16', 12), capacity: 3, booked });
    expect(slots.map((s) => s.state)).toEqual(['FULL', 'OPEN', 'FULL', 'OPEN', 'OPEN', 'OPEN']);
    expect(slotsFor({ date: '2026-10-16', nowMs: ist('2026-10-16', 12), capacity: 0, booked: none }).map((s) => s.state))
      .toEqual(['CLOSED', 'CLOSED', 'CLOSED', 'FULL', 'FULL', 'FULL']);
  });

  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2026-10-17')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '17-10-2026', '2026-10-17T00:00', '']) expect(isIsoDate(bad)).toBe(false);
  });
});
