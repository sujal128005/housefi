import type { Booking, Payment, Quote } from '@prisma/client';
import { fairPay } from './fair-pay';

const SHARES = { visitShareRupees: 30, labourSharePercent: 80 };
let n = 0;
const at = () => new Date(Date.UTC(2026, 9, 24) + n++ * 1000);
const pay = (kind: Payment['kind'], rupees: number, state: Payment['state'] = 'PAID', discount = 0) =>
  ({ kind, state, amountPaise: BigInt(rupees * 100), discountPaise: BigInt(discount * 100), createdAt: at() }) as Payment;
// examples/earnings.json: ₹120 labour + ₹200 materials (a ₹320 quote).
const quote = (labour: number, material: number, which: Quote['which'] = 'MAIN', decision: Quote['decision'] = 'APPROVED') =>
  ({ which, version: 1, decision, labourPaise: BigInt(labour * 100), materialPaise: BigInt(material * 100), totalPaise: BigInt((labour + material) * 100), createdAt: at() }) as Quote;
const row = (status: Booking['status'], payments: Payment[], quotes: Quote[] = [], events: Booking['status'][] = []) => ({ status, payments, quotes, events: events.map((s) => ({ status: s })) });

describe('Fair-pay meter', () => {
  it('splits the visit fee before there is a bill: ₹30 technician, ₹19 Housefi', () => {
    expect(fairPay(SHARES, row('ASSIGNED', [pay('VISIT', 49)]))).toEqual({ total: 49, technician: 30, parts: 0, housefi: 19, coupon: 0, labourSharePercent: 80, withBill: false });
  });

  it('adds the bill once it is due: 80% of labour and all parts go to the technician', () => {
    const b = row('PAYMENT_DUE', [pay('VISIT', 49), pay('FINAL', 320, 'DUE')], [quote(120, 200)]);
    // ₹369 in all: technician ₹30 + ₹96, parts ₹200, Housefi ₹19 + ₹24.
    expect(fairPay(SHARES, b)).toEqual({ total: 369, technician: 126, parts: 200, housefi: 43, coupon: 0, labourSharePercent: 80, withBill: true });
  });

  it('takes a coupon from Housefi, never from the technician', () => {
    const b = row('COMPLETED', [pay('VISIT', 49), pay('FINAL', 270, 'PAID', 50)], [quote(120, 200)]);
    expect(fairPay(SHARES, b)).toMatchObject({ total: 319, technician: 126, parts: 200, housefi: -7, coupon: 50 });
  });

  it('counts approved extra work, and leaves out a declined quote', () => {
    const b = row('PAYMENT_DUE', [pay('VISIT', 49), pay('FINAL', 640, 'DUE')], [quote(120, 200), quote(320, 0, 'EXTRA'), { ...quote(500, 0, 'EXTRA', 'REJECTED'), version: 2 }]);
    // The latest EXTRA quote was declined: only the main quote counts towards the technician's share.
    expect(fairPay(SHARES, b)).toMatchObject({ technician: 126, parts: 200 });
  });

  it('is just the visit fee when the job ends without a repair, or is cancelled on the way', () => {
    expect(fairPay(SHARES, row('CLOSED_NO_REPAIR', [pay('VISIT', 49)], [quote(120, 200, 'MAIN', 'REJECTED')]))).toMatchObject({ total: 49, technician: 30, withBill: false });
    expect(fairPay(SHARES, row('CANCELLED', [pay('VISIT', 49)], [], ['MATCHING', 'ASSIGNED', 'EN_ROUTE']))).toMatchObject({ total: 49, technician: 30 });
  });

  it('shows nothing before the visit fee is paid, after a refund, or when cancelled before the trip', () => {
    expect(fairPay(SHARES, row('AWAITING_PAYMENT', [pay('VISIT', 49, 'DUE')]))).toBeNull();
    expect(fairPay(SHARES, row('CANCELLED', [pay('VISIT', 49, 'REFUNDED')]))).toBeNull();
    expect(fairPay(SHARES, row('CANCELLED', [pay('VISIT', 49)], [], ['MATCHING', 'ASSIGNED']))).toBeNull();
  });

  it('adds up exactly in whole rupees when the labour share has paise', () => {
    const b = row('PAYMENT_DUE', [pay('VISIT', 49), pay('FINAL', 149, 'DUE')], [quote(149, 0)]);
    const f = fairPay(SHARES, b)!;
    expect(f.technician + f.parts + f.housefi).toBe(f.total);
    expect(f).toMatchObject({ total: 198, technician: 149 });
  });
});
