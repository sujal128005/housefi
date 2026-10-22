// Payout details: the same checks the server's payout kit makes (backend/src/modules/earnings/payout-kit/validate.ts),
// so the technician sees what to fix before sending.
import type { PayoutAccountInput } from './types';

export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT = /^\d{9,18}$/;
export const UPI_ID = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;
export const HOLDER_NAME = /^[A-Za-z. ]{2,60}$/;

export type PayoutField = 'holderName' | 'accountNumber' | 'confirmAccount' | 'ifsc' | 'upiId';

/** The details as they will be sent: trimmed, single spaces in the name, IFSC in capitals, no spaces in the number. */
export function tidyPayout(input: PayoutAccountInput): PayoutAccountInput {
  const holderName = input.holderName.trim().replace(/\s+/g, ' ');
  return input.rail === 'BANK'
    ? { rail: 'BANK', holderName, accountNumber: (input.accountNumber ?? '').replace(/\s+/g, ''), ifsc: (input.ifsc ?? '').trim().toUpperCase() }
    : { rail: 'UPI', holderName, upiId: (input.upiId ?? '').trim() };
}

/** The fields that are wrong (none: ready to save). `confirm` is the account number typed a second time. */
export function payoutProblems(input: PayoutAccountInput, confirm = ''): PayoutField[] {
  const p = tidyPayout(input);
  const bad: PayoutField[] = [];
  if (!HOLDER_NAME.test(p.holderName)) bad.push('holderName');
  if (p.rail === 'BANK') {
    if (!ACCOUNT.test(p.accountNumber ?? '')) bad.push('accountNumber');
    else if (confirm.replace(/\s+/g, '') !== p.accountNumber) bad.push('confirmAccount');
    if (!IFSC.test(p.ifsc ?? '')) bad.push('ifsc');
  } else if (!UPI_ID.test(p.upiId ?? '')) {
    bad.push('upiId');
  }
  return bad;
}

/** The masked form the server shows back (for the test double). */
export function payoutHint(p: PayoutAccountInput): string {
  if (p.rail === 'BANK') {
    const n = p.accountNumber ?? '';
    return `${n.length > 4 ? 'X'.repeat(n.length - 4) + n.slice(-4) : 'XXXX'} · ${p.ifsc ?? ''}`;
  }
  const id = p.upiId ?? '';
  const at = id.lastIndexOf('@');
  if (at < 1) return '****@****';
  return `${at <= 2 ? '***' : id[0] + '*'.repeat(at - 1)}${id.slice(at)}`;
}
