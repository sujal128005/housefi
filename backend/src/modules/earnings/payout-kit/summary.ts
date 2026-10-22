// Payout kit: the plain-English summary for the person paying (see types.ts). Never shows a full account number or
// UPI ID.
import type { BankFiles } from './bank-file';
import { formatRupees } from './format';
import type { BatchResult } from './types';

export function payoutSummary(batch: BatchResult, files: BankFiles, names: ReadonlyMap<string, string> = new Map()): string {
  const t = batch.totals;
  const lines = [
    'PAYOUT SUMMARY',
    `Payouts: ${t.count} (ready ${t.valid}, left out ${t.count - t.valid})`,
    `Total ready to pay: ${formatRupees(t.totalPaise)}`,
    `  by bank transfer: ${formatRupees(t.bankPaise)}`,
    `  by UPI: ${formatRupees(t.upiPaise)}`,
    ...files.files.map((f) => `File ${f.filename}: ${f.count} payout${f.count === 1 ? '' : 's'}, ${formatRupees(f.totalPaise)}`),
  ];
  if (batch.warnings.length) lines.push('', 'CHECK BEFORE PAYING:', ...batch.warnings.map((w) => `- ${w}`));
  if (files.skipped.length) {
    lines.push('', 'LEFT OUT (fix, then make the files again):');
    for (const s of files.skipped) {
      lines.push(`- ${names.get(s.id) ?? s.id}: ${s.errors.map((e) => e.message).join('; ')}`);
    }
  }
  return lines.join('\n') + '\n';
}
