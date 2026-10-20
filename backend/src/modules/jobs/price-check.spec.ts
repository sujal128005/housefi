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

  it('treats listed parts at their price as fair: not in the range, not against the line limit', () => {
    const listed = new Map([['p-gas', 250_000n], ['p-pump', 120_000n]]);
    const gas = (unitPrice: number, qty = 1) => ({ kind: 'MATERIAL' as const, qty, unitPrice, partId: 'p-gas' });
    // ₹2,500 x 3 of a listed part plus normal labour: fair, although far above the usual range.
    expect(priceCheck([labour(400), gas(2500, 3)], TYPICAL_MAX, listed)).toBe('FAIR');
    // Up to 10% over the listed price is still standard; more is checked like any other line.
    expect(priceCheck([labour(400), gas(2750)], TYPICAL_MAX, listed)).toBe('FAIR');
    expect(priceCheck([labour(400), gas(2760)], TYPICAL_MAX, listed)).toBe('UNDER_REVIEW');
    // A part id that is not listed counts as a normal line.
    expect(priceCheck([labour(400), { kind: 'MATERIAL', qty: 1, unitPrice: 2500, partId: 'other' }], TYPICAL_MAX, listed)).toBe('UNDER_REVIEW');
    // Labour is never "listed".
    expect(priceCheck([{ kind: 'LABOUR', qty: 1, unitPrice: 2500, partId: 'p-gas' }], TYPICAL_MAX, listed)).toBe('UNDER_REVIEW');
  });

  it('sends any single line above ₹5,000 to review, even when the service range is high', () => {
    expect(priceCheck([material(5000)], 1_000_000n)).toBe('FAIR');
    expect(priceCheck([material(2501, 2)], 1_000_000n)).toBe('UNDER_REVIEW');
  });
});
