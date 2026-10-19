import { reviewBy, reviewHours } from './review-window';

/** ms for a time in India (UTC+5:30) on 16 Oct 2026. */
const ist = (h: number, m = 0) => Date.UTC(2026, 9, 16, h, m) - 5.5 * 3_600_000;

describe('review window', () => {
  it('promises 2 hours by day, 4 in the evening and a day at night (India time)', () => {
    expect([ist(9), ist(13), ist(17, 59)].map(reviewHours)).toEqual([2, 2, 2]);
    expect([ist(18), ist(21, 59)].map(reviewHours)).toEqual([4, 4]);
    expect([ist(22), ist(2), ist(8, 59)].map(reviewHours)).toEqual([24, 24, 24]);
  });

  it('is never more than 24 hours after submitting', () => {
    for (let h = 0; h < 24; h++) expect(reviewBy(ist(h)) - ist(h)).toBeLessThanOrEqual(24 * 3_600_000);
    expect(reviewBy(ist(10))).toBe(ist(12));
  });
});
