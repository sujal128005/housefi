import { z } from 'zod';

export const CATEGORY_ORDER = ['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY'] as const;

/** openapi.yaml TechProfileInput. `phoneType` is set by coordinators, so a value sent by the app is ignored. */
export const TechProfileInput = z.object({
  name: z.string().trim().min(2).max(60).regex(/\p{L}/u),
  gender: z.enum(['M', 'F']),
  experienceYears: z.number().int().min(0).max(50),
  skills: z
    .array(z.enum(CATEGORY_ORDER))
    .min(1)
    .max(6)
    .refine((s) => new Set(s).size === s.length, 'no duplicates'),
  city: z.string().trim().min(2).max(60),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/),
  areas: z.string().trim().min(2).max(200),
  vehicle: z.string().trim().max(40),
  phoneType: z.enum(['SMARTPHONE', 'KEYPAD', 'NONE']).optional(),
  /** The registration photo (POST /uploads/photos with stage PROFILE). Required on the first submission, ignored after. */
  photoUploadId: z.uuid().optional(),
});

export type TechProfileInput = z.infer<typeof TechProfileInput>;

export const AvailabilityBody = z.object({ online: z.boolean() });

export const LocationBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Metres, as reported by the phone. */
  accuracy: z.number().min(0).max(100_000).optional(),
});
