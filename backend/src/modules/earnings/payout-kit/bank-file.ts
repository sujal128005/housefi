// Payout kit: the bulk-transfer files for the bank (see types.ts). Banks lay their bulk-upload sheets out differently,
// so a layout is configuration, not code. The two built-in layouts are generic: before the first real payment, check
// them against the bank's own bulk-upload template and add a layout for that bank here.
import { csvField, isoWeek, plainRupees } from './format';
import type { BatchResult, KitPayout, PayoutRail, ValidationError } from './types';

export interface BankFileLayout {
  readonly name: string;
  readonly rail: PayoutRail;
  readonly columns: readonly { readonly header: string; readonly value: (p: KitPayout) => string }[];
  readonly delimiter: string;
  readonly includeHeader: boolean;
  /** CRLF by default: what bank portals and spreadsheets on Windows expect. */
  readonly lineEnding: '\r\n' | '\n';
}

/** Our transfer reference: letters and digits of the payout id, at most 20 characters; the same id always gives the same reference. */
export function transferReference(payoutId: string): string {
  return payoutId.replace(/[^A-Za-z0-9]/g, '').slice(0, 20).toUpperCase();
}

/** What the technician sees on their bank statement, e.g. "HOUSEFI WK43" (at most 30 characters). */
export function narration(weekEnding: string): string {
  return `HOUSEFI WK${isoWeek(weekEnding)}`.slice(0, 30);
}

export const LAYOUTS: Readonly<Record<string, BankFileLayout>> = {
  'generic-neft': {
    name: 'generic-neft',
    rail: 'BANK',
    delimiter: ',',
    includeHeader: true,
    lineEnding: '\r\n',
    columns: [
      { header: 'Beneficiary Name', value: (p) => p.holderName },
      { header: 'Account Number', value: (p) => p.accountNumber ?? '' },
      { header: 'IFSC', value: (p) => p.ifsc ?? '' },
      { header: 'Amount (Rs)', value: (p) => plainRupees(p.amountPaise) },
      { header: 'Reference', value: (p) => transferReference(p.id) },
      { header: 'Narration', value: (p) => narration(p.weekEnding) },
    ],
  },
  'generic-upi': {
    name: 'generic-upi',
    rail: 'UPI',
    delimiter: ',',
    includeHeader: true,
    lineEnding: '\r\n',
    columns: [
      { header: 'Beneficiary Name', value: (p) => p.holderName },
      { header: 'UPI ID', value: (p) => p.upiId ?? '' },
      { header: 'Amount (Rs)', value: (p) => plainRupees(p.amountPaise) },
      { header: 'Reference', value: (p) => transferReference(p.id) },
      { header: 'Narration', value: (p) => narration(p.weekEnding) },
    ],
  },
};

export interface BankFile {
  readonly rail: PayoutRail;
  readonly layout: string;
  readonly filename: string;
  readonly content: string;
  readonly count: number;
  readonly totalPaise: number;
}

export interface BankFiles {
  readonly files: readonly BankFile[];
  /** Payouts left out, with why. */
  readonly skipped: readonly { readonly id: string; readonly errors: readonly ValidationError[] }[];
}

/** Writes one layout's file for the given (already checked) payouts. */
export function renderBankFile(layout: BankFileLayout, payouts: readonly KitPayout[]): string {
  const row = (cells: readonly string[]) => cells.map((c) => csvField(c, layout.delimiter)).join(layout.delimiter);
  const lines = payouts.map((p) => row(layout.columns.map((col) => col.value(p))));
  if (layout.includeHeader) lines.unshift(row(layout.columns.map((col) => col.header)));
  return lines.join(layout.lineEnding) + layout.lineEnding;
}

/**
 * One file per method (bank transfer, UPI) with only the payouts that passed the checks, named after the week, e.g.
 * housefi-payouts-2026-10-25-neft.csv. Payouts that failed are listed in `skipped`.
 */
export function buildBankFiles(
  batch: BatchResult,
  weekEnding: string,
  layouts: { readonly bank?: string; readonly upi?: string } = {},
): BankFiles {
  const pick = (name: string, rail: PayoutRail) => {
    const layout = LAYOUTS[name];
    if (!layout || layout.rail !== rail) throw new Error(`unknown ${rail} layout "${name}"`);
    return layout;
  };
  const bank = pick(layouts.bank ?? 'generic-neft', 'BANK');
  const upi = pick(layouts.upi ?? 'generic-upi', 'UPI');
  const skipped = batch.results.filter((r) => !r.result.ok).map((r) => ({ id: r.payout.id, errors: r.result.errors }));
  const ready = batch.results.flatMap((r) => (r.result.ok && r.result.clean ? [r.result.clean] : []));

  const files: BankFile[] = [];
  for (const [layout, suffix] of [[bank, 'neft'], [upi, 'upi']] as const) {
    const these = ready.filter((p) => p.rail === layout.rail);
    if (these.length === 0) continue;
    files.push({
      rail: layout.rail,
      layout: layout.name,
      filename: `housefi-payouts-${weekEnding}-${suffix}.csv`,
      content: renderBankFile(layout, these),
      count: these.length,
      totalPaise: these.reduce((sum, p) => sum + p.amountPaise, 0),
    });
  }
  return { files, skipped };
}
