// Quote rows -> openapi.yaml Quote, and which quote each side sees.
import type { Quote, QuoteLine } from '@prisma/client';
import { paiseToRupees } from '../../common/money';

export type QuoteRow = Quote & { lines: QuoteLine[] };

export interface QuoteDto {
  readonly id: string;
  readonly version: number;
  readonly lines: readonly { readonly kind: 'LABOUR' | 'MATERIAL'; readonly name: { readonly en: string; readonly te: string }; readonly qty: number; readonly unitPrice: number }[];
  readonly labourTotal: number;
  readonly materialTotal: number;
  readonly total: number;
  /** Technician-typed text: the same in both languages. */
  readonly diagnosis: { readonly en: string; readonly te: string };
  readonly review: { readonly state: Quote['review']; readonly typicalMin: number; readonly typicalMax: number };
  readonly decision: Quote['decision'];
  readonly at: number;
}

export function toQuoteDto(q: QuoteRow): QuoteDto {
  return {
    id: q.id,
    version: q.version,
    lines: [...q.lines]
      .sort((a, b) => a.sort - b.sort)
      .map((l) => ({ kind: l.kind, name: { en: l.name, te: l.name }, qty: l.qty, unitPrice: paiseToRupees(l.unitPaise) })),
    labourTotal: paiseToRupees(q.labourPaise),
    materialTotal: paiseToRupees(q.materialPaise),
    total: paiseToRupees(q.totalPaise),
    diagnosis: { en: q.diagnosis, te: q.diagnosis },
    review: { state: q.review, typicalMin: paiseToRupees(q.typicalMinPaise), typicalMax: paiseToRupees(q.typicalMaxPaise) },
    decision: q.decision,
    at: q.createdAt.getTime(),
  };
}

/** The customer only sees a quote that passed the price check (FAIR) or a reviewer (CLEARED). */
export const isVisible = (q: Quote) => q.review === 'FAIR' || q.review === 'CLEARED';

/** The latest version of a kind, optionally only among the ones the customer may see. */
export function latestQuote<T extends Quote>(quotes: readonly T[], which: Quote['which'], visibleOnly = false): T | undefined {
  return quotes
    .filter((q) => q.which === which && (!visibleOnly || isVisible(q)))
    .sort((a, b) => b.version - a.version)[0];
}

/** Bill = approved repair quote + approved extra work (latest versions). */
export function approvedQuotes<T extends Quote>(quotes: readonly T[]): T[] {
  return (['MAIN', 'EXTRA'] as const).map((w) => latestQuote(quotes, w)).filter((q): q is T => !!q && q.decision === 'APPROVED');
}
