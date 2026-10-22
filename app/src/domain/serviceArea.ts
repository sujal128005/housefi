// A technician's service area: the PIN code must belong to one of the chosen localities. The server checks the same
// rule (backend places.service.ts serviceArea).
import type { Locality } from './types';

/** Most localities a technician can choose. */
export const MAX_LOCALITIES = 10;

/** The PIN codes a choice of localities allows: theirs, or any in the district when one was typed in (not listed). */
export function allowedPincodes(list: readonly Locality[], chosen: readonly string[]): ReadonlySet<string> {
  const known = list.filter((p) => chosen.some((c) => c.toLowerCase() === p.name.toLowerCase()));
  const pool = known.length < chosen.length ? list : known;
  return new Set(pool.flatMap((p) => p.pincodes));
}
