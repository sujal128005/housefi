import { z } from 'zod';

/** openapi.yaml PayoutAccountInput: the technician's payout details (bank account or UPI). Checked in full by the payout kit. */
export const PayoutAccountInput = z.object({
  rail: z.enum(['BANK', 'UPI']),
  holderName: z.string().max(100),
  accountNumber: z.string().max(40).optional(),
  ifsc: z.string().max(20).optional(),
  upiId: z.string().max(300).optional(),
});

export type PayoutAccountInput = z.infer<typeof PayoutAccountInput>;
