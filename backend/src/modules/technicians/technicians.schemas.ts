import { z } from 'zod';

export const CATEGORY_ORDER = ['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY'] as const;

/** openapi.yaml TechProfileInput (without the service-area rule: `withServiceArea`). */
export const TechProfileFields = z.object({
  name: z.string().trim().min(2).max(60).regex(/\p{L}/u),
  gender: z.enum(['M', 'F']),
  experienceYears: z.number().int().min(0).max(50),
  skills: z
    .array(z.enum(CATEGORY_ORDER))
    .min(1)
    .max(6)
    .refine((s) => new Set(s).size === s.length, 'no duplicates'),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/),
  /**
   * The service area from India Post's directory (GET /places/...). The PIN code must belong to one of the localities;
   * city and areas are then filled in from them. Older apps and coordinators send city and areas instead.
   */
  state: z.string().trim().min(2).max(80).optional(),
  district: z.string().trim().min(2).max(80).optional(),
  localities: z
    .array(z.string().trim().min(2).max(80))
    .min(1)
    .max(10)
    .refine((s) => new Set(s.map((x) => x.toLowerCase())).size === s.length, 'no duplicates')
    .optional(),
  city: z.string().trim().min(2).max(60).optional(),
  areas: z.string().trim().min(2).max(200).optional(),
  vehicle: z.string().trim().max(40),
  phoneType: z.enum(['SMARTPHONE', 'KEYPAD', 'NONE']).optional(),
  /** The registration photo (POST /uploads/photos with stage PROFILE). Required on the first submission, ignored after. */
  photoUploadId: z.uuid().optional(),
});

type AreaFields = Pick<z.infer<typeof TechProfileFields>, 'state' | 'district' | 'localities' | 'city' | 'areas'>;

/** Either the directory's state, district and localities, or (older apps, coordinators) city and areas. */
export function withServiceArea<T extends z.ZodType<AreaFields>>(schema: T) {
  return schema.superRefine((v, ctx) => {
    const directory = v.state !== undefined || v.district !== undefined || v.localities !== undefined;
    const needed = directory ? (['state', 'district', 'localities'] as const) : (['city', 'areas'] as const);
    for (const key of needed) if (v[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'Required' });
  });
}

/** openapi.yaml TechProfileInput. `phoneType` is set by coordinators, so a value sent by the app is ignored. */
export const TechProfileInput = withServiceArea(TechProfileFields);

export type TechProfileInput = z.infer<typeof TechProfileInput>;

export const AvailabilityBody = z.object({ online: z.boolean() });

export const LocationBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Metres, as reported by the phone. */
  accuracy: z.number().min(0).max(100_000).optional(),
});
