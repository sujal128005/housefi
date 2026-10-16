import { paiseToRupees, rupeesToPaise } from './money';

describe('money', () => {
  it('converts whole rupees to paise and back', () => {
    expect(rupeesToPaise(49)).toBe(4900n);
    expect(paiseToRupees(4900n)).toBe(49);
    expect(paiseToRupees(rupeesToPaise(100_000))).toBe(100_000);
    expect(paiseToRupees(0n)).toBe(0);
  });

  it('refuses fractions instead of rounding silently', () => {
    expect(() => rupeesToPaise(49.5)).toThrow();
    expect(() => paiseToRupees(4950n)).toThrow();
  });
});
