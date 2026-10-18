import { z } from 'zod';

/** openapi.yaml AddressInput, trimmed like the app does. lat and lng come together or not at all. */
export const AddressInput = z
  .object({
    label: z.enum(['HOME', 'WORK', 'OTHER']),
    house: z.string().trim().min(2).max(120),
    street: z.string().trim().min(3).max(160),
    landmark: z.string().trim().max(120),
    city: z.string().trim().min(2).max(60),
    pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.lat !== undefined && a.lng === undefined) ctx.addIssue({ code: 'custom', path: ['lng'], message: 'lat and lng go together' });
    if (a.lng !== undefined && a.lat === undefined) ctx.addIssue({ code: 'custom', path: ['lat'], message: 'lat and lng go together' });
  });

export type AddressInput = z.infer<typeof AddressInput>;

/**
 * The coarse area shown to technicians before they accept a job: the last part of the street after a comma
 * ("Road No. 12, Banjara Hills" -> "Banjara Hills"), or the city when the street has no such part.
 * Until the app sends a locality of its own (docs/QUESTIONS.md #9).
 */
export function deriveLocality(street: string, city: string): string {
  const parts = street.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  // Letters and combining marks: Telugu vowel signs are marks, so "బంజారా" is letter, mark, letter, ...
  const usable = last && /[\p{L}\p{M}]{3,}/u.test(last) && last.toLowerCase() !== city.trim().toLowerCase();
  return (usable ? last : city.trim()).slice(0, 60);
}
