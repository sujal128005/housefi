import { discountFor } from './coupon-rules';

const rupees = (r: number) => BigInt(r) * 100n;
const percent = (value: number, max: number | null = null, minBill = 0) => ({ kind: 'PERCENT' as const, value, maxDiscountPaise: max === null ? null : rupees(max), minBillPaise: rupees(minBill) });

describe('coupon discount', () => {
  it('is always whole rupees: a percentage is rounded down', () => {
    // DIWALI26 on a ₹580 bill: 26% is ₹150.80, so ₹150 off (₹430 to pay), never paise.
    expect(discountFor(percent(26), rupees(580))).toBe(rupees(150));
    for (let bill = 1; bill <= 5000; bill += 7) {
      for (const value of [5, 13, 26, 32, 50, 99]) expect(discountFor(percent(value), rupees(bill)) % 100n).toBe(0n);
    }
  });

  it('keeps the cap, the minimum bill and at least ₹1 to pay', () => {
    expect(discountFor(percent(50, 100), rupees(580))).toBe(rupees(100));
    expect(discountFor(percent(50, null, 300), rupees(299))).toBe(0n);
    expect(discountFor({ kind: 'FLAT', value: 500, maxDiscountPaise: null, minBillPaise: 0n }, rupees(300))).toBe(rupees(299));
  });
});
