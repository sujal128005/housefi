import { priceCheck, totals } from './price-check';

const labour = (unitPrice: number, qty = 1) => ({ kind: 'LABOUR' as const, qty, unitPrice });
const material = (unitPrice: number, qty = 1) => ({ kind: 'MATERIAL' as const, qty, unitPrice });

// plumb-tap: repairFrom ₹149, typical max 4x = ₹596, review above 1.5x = ₹894.
const TYPICAL_MAX = 59_600n;

describe('quote totals', () => {
  it('adds labour and materials in paise', () => {
    expect(totals([labour(120), material(45, 2), material(110)])).toEqual({ labourPaise: 12_000n, materialPaise: 20_000n, totalPaise: 32_000n });
  });
});

describe('price check (README §10)', () => {
  it('is FAIR within the usual range, and below it', () => {
    expect(priceCheck([labour(120), material(200)], TYPICAL_MAX)).toBe('FAIR');
    expect(priceCheck([labour(100)], TYPICAL_MAX)).toBe('FAIR');
  });

  it('sends totals above 1.5x the typical maximum to review (exactly 1.5x is still fair)', () => {
    expect(priceCheck([labour(894)], TYPICAL_MAX)).toBe('FAIR');
    expect(priceCheck([labour(895)], TYPICAL_MAX)).toBe('UNDER_REVIEW');
  });

  it('sends any single line above ₹5,000 to review, even when the service range is high', () => {
    expect(priceCheck([material(5000)], 1_000_000n)).toBe('FAIR');
    expect(priceCheck([material(2501, 2)], 1_000_000n)).toBe('UNDER_REVIEW');
  });
});
