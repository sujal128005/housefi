// Quote money and the rule-based price check (README §10). Pure functions in paise, so they are easy to test and
// the AI model that replaces the rules later can be compared against them.

export interface LineInput {
  readonly kind: 'LABOUR' | 'MATERIAL';
  readonly qty: number;
  /** Whole rupees, as the technician typed. */
  readonly unitPrice: number;
}

export interface Totals {
  readonly labourPaise: bigint;
  readonly materialPaise: bigint;
  readonly totalPaise: bigint;
}

export function totals(lines: readonly LineInput[]): Totals {
  let labourPaise = 0n;
  let materialPaise = 0n;
  for (const l of lines) {
    const amount = BigInt(l.qty) * BigInt(l.unitPrice) * 100n;
    if (l.kind === 'LABOUR') labourPaise += amount;
    else materialPaise += amount;
  }
  return { labourPaise, materialPaise, totalPaise: labourPaise + materialPaise };
}

/** A single line above this goes to review. */
export const LINE_REVIEW_PAISE = 500_000n; // ₹5,000
/** A total above this multiple of the service's typical maximum goes to review. */
export const OVER_TYPICAL_FACTOR = { num: 3n, den: 2n } as const; // 1.5x

/**
 * FAIR: shared with the customer at once. UNDER_REVIEW: a reviewer looks first (auto-cleared after 2 minutes until
 * reviewers exist). Within the usual range is fair; so is anything below it (the minimum charge is checked
 * separately when the quote is sent).
 */
export function priceCheck(lines: readonly LineInput[], typicalMaxPaise: bigint): 'FAIR' | 'UNDER_REVIEW' {
  const { totalPaise } = totals(lines);
  if (totalPaise * OVER_TYPICAL_FACTOR.den > typicalMaxPaise * OVER_TYPICAL_FACTOR.num) return 'UNDER_REVIEW';
  if (lines.some((l) => BigInt(l.qty) * BigInt(l.unitPrice) * 100n > LINE_REVIEW_PAISE)) return 'UNDER_REVIEW';
  return 'FAIR';
}

/**
 * What a job earns the technician (README §10): the visit share, plus a share of approved labour, plus approved
 * materials in full (reimbursement). Rupees, rounded to the nearest rupee.
 */
export function technicianEarning(visitShareRupees: number, labourPercent: number, approved: readonly { labourPaise: bigint; materialPaise: bigint }[]): number {
  let paise = BigInt(visitShareRupees) * 100n;
  for (const q of approved) paise += (q.labourPaise * BigInt(labourPercent)) / 100n + q.materialPaise;
  return Math.round(Number(paise) / 100);
}
