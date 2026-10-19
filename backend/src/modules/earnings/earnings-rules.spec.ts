import { jobCloseLines, jobCredits, nextPayoutOn, payoutCutoff, rupees, weeklySummary } from './earnings-rules';

const SHARES = { visitShareRupees: 30, labourSharePercent: 80 };
// examples/earnings.json: ₹120 labour + ₹200 materials.
const QUOTE = { labourPaise: 12_000n, materialPaise: 20_000n };
const total = (lines: { amountPaise: bigint }[]) => lines.reduce((s, l) => s + l.amountPaise, 0n);
/** An instant given as IST wall-clock time. */
const ist = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 60 * 60_000;

describe("technician's earning (README §10)", () => {
  it('is the ₹30 visit share plus 80% of labour plus all materials', () => {
    expect(jobCredits(SHARES, [QUOTE])).toEqual([
      { type: 'VISIT_SHARE', amountPaise: 3_000n },
      { type: 'LABOUR_SHARE', amountPaise: 9_600n },
      { type: 'MATERIAL_REIMBURSE', amountPaise: 20_000n },
    ]);
    expect(rupees(total(jobCredits(SHARES, [QUOTE])))).toBe(326);
  });

  it('adds approved extra work, and is just the visit share without a repair', () => {
    expect(rupees(total(jobCredits(SHARES, [QUOTE, { labourPaise: 0n, materialPaise: 34_000n }])))).toBe(666);
    expect(jobCredits(SHARES, [])).toEqual([{ type: 'VISIT_SHARE', amountPaise: 3_000n }]);
  });

  it('keeps paise in the ledger and rounds only for display', () => {
    expect(jobCredits(SHARES, [{ labourPaise: 14_900n, materialPaise: 0n }])[1]).toEqual({ type: 'LABOUR_SHARE', amountPaise: 11_920n });
    expect(rupees(14_920n)).toBe(149);
    expect(rupees(14_950n)).toBe(150);
    expect(rupees(-32_000n)).toBe(-320);
  });

  it('writes no zero lines (a share configured as 0)', () => {
    expect(jobCredits({ visitShareRupees: 0, labourSharePercent: 80 }, [])).toEqual([]);
  });
});

describe('ledger lines when a job closes', () => {
  it('completed and paid online: credits only', () => {
    expect(jobCloseLines(SHARES, { from: 'PAYMENT_DUE', to: 'COMPLETED', approved: [QUOTE], cashCollectedPaise: null }).map((l) => l.type)).toEqual([
      'VISIT_SHARE', 'LABOUR_SHARE', 'MATERIAL_REIMBURSE',
    ]);
  });

  it('completed with cash: the bill the technician collected is a debit', () => {
    const lines = jobCloseLines(SHARES, { from: 'PAYMENT_DUE', to: 'COMPLETED', approved: [QUOTE], cashCollectedPaise: 32_000n });
    expect(lines.at(-1)).toEqual({ type: 'CASH_COLLECTED', amountPaise: -32_000n });
    expect(total(lines)).toBe(600n); // ₹326 earned - ₹320 kept in cash = ₹6 to pay out
  });

  it('closed without repair, or cancelled while travelling: the visit share', () => {
    expect(jobCloseLines(SHARES, { from: 'QUOTE_SHARED', to: 'CLOSED_NO_REPAIR', approved: [QUOTE], cashCollectedPaise: null })).toEqual([{ type: 'VISIT_SHARE', amountPaise: 3_000n }]);
    expect(jobCloseLines(SHARES, { from: 'EN_ROUTE', to: 'CANCELLED', approved: [], cashCollectedPaise: null })).toEqual([{ type: 'VISIT_SHARE', amountPaise: 3_000n }]);
  });

  it('cancelled before the trip, or any other change: nothing', () => {
    expect(jobCloseLines(SHARES, { from: 'ASSIGNED', to: 'CANCELLED', approved: [], cashCollectedPaise: null })).toEqual([]);
    expect(jobCloseLines(SHARES, { from: 'ARRIVED', to: 'INSPECTING', approved: [], cashCollectedPaise: null })).toEqual([]);
  });
});

describe('weekly payout calendar (Mondays, IST)', () => {
  it('next payout: the coming Monday, or today on a Monday', () => {
    expect(nextPayoutOn(ist(2026, 10, 16, 12))).toBe('2026-10-19'); // Friday
    expect(nextPayoutOn(ist(2026, 10, 18, 23, 59))).toBe('2026-10-19'); // Sunday night
    expect(nextPayoutOn(ist(2026, 10, 19, 0, 0))).toBe('2026-10-19'); // Monday
    expect(nextPayoutOn(ist(2026, 10, 20, 0, 1))).toBe('2026-10-26'); // Tuesday
    expect(nextPayoutOn(ist(2026, 10, 26, 0, 30))).toBe('2026-10-26'); // Monday 00:30 IST is still Sunday in UTC
  });

  it('a payout settles everything before 00:00 IST on the latest Monday', () => {
    expect(payoutCutoff(ist(2026, 10, 16, 12))).toEqual({ cutoffMs: ist(2026, 10, 12), periodEnd: '2026-10-11' });
    expect(payoutCutoff(ist(2026, 10, 19, 9))).toEqual({ cutoffMs: ist(2026, 10, 19), periodEnd: '2026-10-18' });
    expect(payoutCutoff(ist(2026, 10, 18, 23, 59))).toEqual({ cutoffMs: ist(2026, 10, 12), periodEnd: '2026-10-11' });
  });
});

describe('weekly summary (paid each Monday for the week before)', () => {
  // Wednesday 22 Oct 2026, 15:00 IST: this week is 19–25 Oct.
  const now = ist(2026, 10, 22, 15);
  const totals = [
    { week: '2026-10-19', earnedPaise: 23_000n, cashPaise: 0n, jobs: 2 },
    { week: '2026-10-12', earnedPaise: 124_000n, cashPaise: 50_000n, jobs: 5 },
    { week: '2026-10-05', earnedPaise: 6_000n, cashPaise: 40_000n, jobs: 1 },
  ];
  const payouts = [{ periodEnd: '2026-10-18', state: 'PAID' as const, amountPaise: 74_000n, paidAt: ist(2026, 10, 20, 11), providerRef: 'UTR123' }];

  it('lists this week and the 7 before it, Monday to Sunday, newest first', () => {
    const weeks = weeklySummary(now, totals, payouts);
    expect(weeks).toHaveLength(8);
    expect(weeks.map((w) => `${w.start}..${w.end}`).slice(0, 3)).toEqual(['2026-10-19..2026-10-25', '2026-10-12..2026-10-18', '2026-10-05..2026-10-11']);
  });

  it('says when each week is paid: coming Monday, paid (with the day and reference), or added to a later payout', () => {
    const [thisWeek, lastWeek, before, empty] = weeklySummary(now, totals, payouts);
    expect(thisWeek).toEqual({ start: '2026-10-19', end: '2026-10-25', earned: 230, cash: 0, jobs: 2, payout: { state: 'UPCOMING', on: '2026-10-26', amount: null, ref: null } });
    expect(lastWeek?.payout).toEqual({ state: 'PAID', on: '2026-10-20', amount: 740, ref: 'UTR123' });
    expect(lastWeek).toMatchObject({ earned: 1240, cash: 500 });
    // More cash collected than earned: no payout of its own; it was netted into a later one.
    expect(before?.payout).toEqual({ state: 'CARRIED', on: null, amount: null, ref: null });
    expect(empty?.payout.state).toBe('NONE');
  });

  it('on a Monday, last week is still to be paid today until the payout is made', () => {
    const monday = ist(2026, 10, 26, 9);
    const [, lastWeek] = weeklySummary(monday, [{ week: '2026-10-19', earnedPaise: 23_000n, cashPaise: 0n, jobs: 2 }], []);
    expect(lastWeek?.payout).toEqual({ state: 'UPCOMING', on: '2026-10-26', amount: null, ref: null });
  });
});
