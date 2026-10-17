// Request shapes for /bookings, mirroring openapi.yaml and README §5.
import { z } from 'zod';
import { isIsoDate, SLOT_HOURS } from '../slots/slot-rules';

const START_HOURS = SLOT_HOURS.map(([s]) => s);

export const VisitWindow = z
  .object({
    date: z.string().refine(isIsoDate),
    startHour: z.number().int(),
    endHour: z.number().int(),
  })
  .superRefine((w, ctx) => {
    if (!START_HOURS.includes(w.startHour)) ctx.addIssue({ code: 'custom', path: ['startHour'], message: 'not a window start' });
    else if (w.endHour !== w.startHour + 2) ctx.addIssue({ code: 'custom', path: ['endHour'], message: 'windows are 2 hours' });
  });

export const VisitTime = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('INSTANT'), window: z.null() }),
  z.object({ mode: z.literal('SCHEDULED'), window: VisitWindow }),
]);

export type VisitTime = z.infer<typeof VisitTime>;

export const NewBooking = z
  .object({
    serviceId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    problem: z.object({
      issueIds: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(10),
      notes: z.string().trim().max(500),
      voiceNote: z
        .object({
          durationSec: z.number().int().min(1).max(60),
          transcript: z.string().trim().max(1000),
          audioId: z.string().max(64).optional(),
        })
        .nullable(),
      photos: z.array(z.object({ id: z.string().max(64) })).max(4),
    }),
    addressId: z.string().max(64),
    time: VisitTime,
    preferWomenRated: z.boolean(),
  })
  .superRefine((b, ctx) => {
    const p = b.problem;
    if (p.issueIds.length === 0 && p.notes === '' && !p.voiceNote && p.photos.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['problem'], message: 'describe the problem: issues, a note, a voice note or photos' });
    }
  });

export type NewBooking = z.infer<typeof NewBooking>;

/** `Idempotency-Key` header: required on create, any client-chosen id (a UUID is typical). */
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_.:-]{8,64}$/);

export const CancelBody = z
  .object({ reason: z.enum(['PLANS_CHANGED', 'FIXED', 'TOO_LONG', 'MISTAKE', 'OTHER']).nullable().optional() })
  .optional()
  .transform((b) => b?.reason ?? null);

export const RescheduleBody = z.object({ time: VisitTime });

export const ListQuery = z.object({ scope: z.enum(['active', 'past', 'all']).default('all') });
