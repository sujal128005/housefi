import { z } from 'zod';

/** openapi.yaml QuoteInput. Money in whole rupees. */
export const QuoteInput = z.object({
  which: z.enum(['MAIN', 'EXTRA']),
  diagnosis: z.string().trim().min(3).max(500),
  lines: z
    .array(
      z.object({
        kind: z.enum(['LABOUR', 'MATERIAL']),
        name: z.string().trim().min(1).max(80),
        qty: z.number().int().min(1).max(99),
        unitPrice: z.number().int().min(1).max(100_000),
      }),
    )
    .min(1)
    .max(20),
});

export type QuoteInput = z.infer<typeof QuoteInput>;

export const StartCodeBody = z.object({ code: z.string().regex(/^[0-9]{4}$/) });

export const ReportBody = z.object({
  issue: z.enum(['CUSTOMER_UNAVAILABLE', 'WRONG_ADDRESS', 'UNSAFE', 'CANNOT_COMPLETE', 'PAYMENT_PROBLEM', 'OTHER']),
  note: z.string().trim().max(500).default(''),
});

export const AnswerBody = z.object({ answer: z.enum(['APPROVE', 'REVISION', 'DECLINE']) });

export const QuoteWhichParam = z.enum(['MAIN', 'EXTRA']);
