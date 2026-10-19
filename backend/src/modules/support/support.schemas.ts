import { z } from 'zod';

/** Where the phone was (SOS, reports): sent when the phone gives a position, never required. */
export const Position = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(100_000).nullable().optional(),
  })
  .strict();
export type Position = z.infer<typeof Position>;

/** The ticket columns for a position (nothing when there is none). */
export function positionColumns(p: Position | undefined, at: Date): { lat?: number; lng?: number; accuracyM?: number | null; locatedAt?: Date } {
  return p ? { lat: p.lat, lng: p.lng, accuracyM: p.accuracyM == null ? null : Math.round(p.accuracyM), locatedAt: at } : {};
}

export const TicketBody = z
  .object({
    bookingId: z.string().max(64).optional(),
    kind: z.enum(['UNSAFE', 'PAYMENT_PROBLEM', 'OTHER']),
    note: z.string().max(1000).optional(),
    location: Position.optional(),
  })
  .strict();

/** "Talk to the Housefi team": after the assistant's questions (topic, booking, what happened). */
export const ConversationStartBody = z
  .object({
    topic: z.enum(['BOOKING', 'PAYMENT', 'TECHNICIAN', 'APP', 'OTHER']),
    bookingId: z.string().max(64).nullable().optional(),
    text: z.string().max(1000),
  })
  .strict();

export const ConversationMessageBody = z.object({ text: z.string().max(1000) }).strict();

/** The body is optional in the contract: "call me back" with nothing else is fine. */
export const CallbackBody = z
  .object({ bookingId: z.string().max(64).optional(), reason: z.string().max(300).optional() })
  .strict()
  .optional()
  .transform((b) => b ?? {});
