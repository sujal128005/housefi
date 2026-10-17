import { z } from 'zod';

export const TicketBody = z
  .object({
    bookingId: z.string().max(64).optional(),
    kind: z.enum(['UNSAFE', 'PAYMENT_PROBLEM', 'OTHER']),
    note: z.string().max(1000).optional(),
  })
  .strict();

/** The body is optional in the contract: "call me back" with nothing else is fine. */
export const CallbackBody = z
  .object({ bookingId: z.string().max(64).optional(), reason: z.string().max(300).optional() })
  .strict()
  .optional()
  .transform((b) => b ?? {});
