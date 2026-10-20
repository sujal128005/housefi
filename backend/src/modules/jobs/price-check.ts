// Quote money and the rule-based price check (README §10). Pure functions in paise, so they are easy to test and
// the AI model that replaces the rules later can be compared against them.

export interface LineInput {
  readonly kind: 'LABOUR' | 'MATERIAL';
  readonly qty: number;
  /** Whole rupees, as the technician typed. */
  readonly unitPrice: number;
  /** A part from the price list (materials). */
  readonly partId?: string | undefined;
}

/** A listed part is still standard up to 10% over its list price. */
export const LISTED_TOLERANCE = { num: 11n, den: 10n } as const;

/** A material line that is a listed part at (up to 10% over) its listed price. */
export function isListed(l: LineInput, listed: ReadonlyMap<string, bigint>): boolean {
  if (l.kind !== 'MATERIAL' || !l.partId) return false;
  const price = listed.get(l.partId);
  return price !== undefined && BigInt(l.unitPrice) * 100n * LISTED_TOLERANCE.den <= price * LISTED_TOLERANCE.num;
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
 * separately when the quote is sent). Listed parts at their listed price are fair by definition: they count neither
 * towards the usual range nor against the single-line limit.
 */
export function priceCheck(lines: readonly LineInput[], typicalMaxPaise: bigint, listed: ReadonlyMap<string, bigint> = new Map()): 'FAIR' | 'UNDER_REVIEW' {
  const checked = lines.filter((l) => !isListed(l, listed));
  const { totalPaise } = totals(checked);
  if (totalPaise * OVER_TYPICAL_FACTOR.den > typicalMaxPaise * OVER_TYPICAL_FACTOR.num) return 'UNDER_REVIEW';
  if (checked.some((l) => BigInt(l.qty) * BigInt(l.unitPrice) * 100n > LINE_REVIEW_PAISE)) return 'UNDER_REVIEW';
  return 'FAIR';
}

