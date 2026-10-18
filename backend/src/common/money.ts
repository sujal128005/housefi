// Money: the database stores paise (BigInt), the API speaks whole rupees (integers). Convert only at the edges.

export function rupeesToPaise(rupees: number): bigint {
  if (!Number.isSafeInteger(rupees)) throw new Error(`rupees must be a whole number, got ${rupees}`);
  return BigInt(rupees) * 100n;
}

/** Whole rupees for the API. Amounts here are always whole rupees; anything else is a bug, so it throws. */
export function paiseToRupees(paise: bigint): number {
  if (paise % 100n !== 0n) throw new Error(`amount ${paise} paise is not a whole number of rupees`);
  return Number(paise / 100n);
}
