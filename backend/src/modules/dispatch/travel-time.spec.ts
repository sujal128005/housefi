import { bookingEstimate, citySpeedKmh, travelMinutes } from './travel-time';

/** ms for a time in India on 16 Oct 2026. */
const ist = (h: number) => Date.UTC(2026, 9, 16, h) - 5.5 * 3_600_000;

describe('travel time in Hyderabad', () => {
  it('is slower at the morning and evening peaks and quicker late at night', () => {
    expect([ist(9), ist(18), ist(13), ist(23), ist(4)].map(citySpeedKmh)).toEqual([14, 14, 20, 28, 28]);
  });

  it('turns distance into minutes on the road (roads are 1.4x the straight line), at least 1', () => {
    expect(travelMinutes(5000, ist(13))).toBe(21); // 7 km at 20 km/h
    expect(travelMinutes(5000, ist(18))).toBe(30); // the same at the evening peak
    expect(travelMinutes(50, ist(13))).toBe(1);
  });

  it('promises a 10-minute range before booking, rounded up to 5 minutes, matching and getting ready included', () => {
    expect(bookingEstimate(5000, ist(13))).toEqual([40, 50]); // 10 + 5 + 21 = 36 -> 40
    expect(bookingEstimate(500, ist(23))).toEqual([20, 30]); // 10 + 5 + 1 = 16 -> 20
  });
});
