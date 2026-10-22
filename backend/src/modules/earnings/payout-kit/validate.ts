// Payout kit: the checks before money moves (see types.ts).
import { maskAccount, maskUpi } from './format';
import type { BatchResult, KitPayout, ValidationError, ValidationOptions, ValidationResult } from './types';

/** Rs 1 lakh. */
export const DEFAULT_MAX_PAISE = 10_000_000;

/** 4 letters (the bank), a zero, 6 letters or digits (the branch). */
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers: 9 to 18 digits. */
export const ACCOUNT = /^\d{9,18}$/;
/** name@handle: letters, digits, dot, dash or underscore before the @, letters after. */
export const UPI_ID = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;
/** As banks print names: letters, spaces and dots. */
export const HOLDER_NAME = /^[A-Za-z. ]{2,60}$/;

/** The holder name as banks want it: trimmed, single spaces. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Checks one payout and returns it normalised (trimmed name, upper-case IFSC, trimmed fields) when it is fine. */
export function validatePayout(p: KitPayout, options: ValidationOptions = {}): ValidationResult {
  const max = options.maxAmountPaise ?? DEFAULT_MAX_PAISE;
  const errors: ValidationError[] = [];
  const err = (field: string, code: string, message: string) => errors.push({ field, code, message });

  if (!p.id?.trim()) err('id', 'REQUIRED', 'Payout id is missing');
  if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) err('amountPaise', 'INVALID_AMOUNT', 'Amount must be a whole number of paise above 0');
  else if (p.amountPaise > max) err('amountPaise', 'OVER_LIMIT', 'Amount is above the single-transfer limit');

  const holderName = cleanName(p.holderName ?? '');
  if (!HOLDER_NAME.test(holderName)) err('holderName', 'INVALID_NAME', 'Name must be 2-60 letters, spaces or dots, as on the bank account');

  const accountNumber = p.accountNumber?.trim();
  const ifsc = p.ifsc?.trim().toUpperCase();
  const upiId = p.upiId?.trim();
  if (p.rail === 'BANK') {
    if (upiId) err('upiId', 'EXTRA_FIELD', 'A bank payout has no UPI ID');
    if (!accountNumber || !ACCOUNT.test(accountNumber)) err('accountNumber', 'INVALID_ACCOUNT', 'Account number must be 9-18 digits');
    if (!ifsc || !IFSC.test(ifsc)) err('ifsc', 'INVALID_IFSC', 'IFSC must be 4 letters, a zero and 6 letters or digits');
  } else if (p.rail === 'UPI') {
    if (accountNumber || ifsc) err('accountNumber', 'EXTRA_FIELD', 'A UPI payout has no bank account or IFSC');
    if (!upiId || !UPI_ID.test(upiId)) err('upiId', 'INVALID_UPI', 'UPI ID must look like name@bank');
  } else {
    err('rail', 'INVALID_METHOD', 'Payout method must be BANK or UPI');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.weekEnding ?? '') || Number.isNaN(Date.parse(`${p.weekEnding}T00:00:00Z`))) {
    err('weekEnding', 'INVALID_DATE', 'Week ending must be a date like 2026-10-25');
  }

  if (errors.length) return { ok: false, errors, clean: null };
  const clean: KitPayout = p.rail === 'BANK'
    ? { id: p.id.trim(), holderName, amountPaise: p.amountPaise, rail: 'BANK', accountNumber, ifsc, weekEnding: p.weekEnding }
    : { id: p.id.trim(), holderName, amountPaise: p.amountPaise, rail: 'UPI', upiId, weekEnding: p.weekEnding };
  return { ok: true, errors, clean };
}

/**
 * Checks a whole batch: every payout, plus duplicate ids (an error: it would pay twice) and the same account or UPI ID
 * twice (a warning: possible, e.g. a shared family account, but worth a look). Never changes the input.
 */
export function validateBatch(payouts: readonly KitPayout[], options: ValidationOptions = {}): BatchResult {
  const ids = new Set<string>();
  const destinations = new Map<string, number>();
  const warnings: string[] = [];
  let valid = 0;
  let totalPaise = 0;
  let bankPaise = 0;
  let upiPaise = 0;

  const results = payouts.map((payout) => {
    let result = validatePayout(payout, options);
    if (payout.id && ids.has(payout.id)) {
      result = { ok: false, errors: [...result.errors, { field: 'id', code: 'DUPLICATE_ID', message: 'The same payout appears twice' }], clean: null };
    }
    ids.add(payout.id);
    const c = result.clean;
    if (result.ok && c) {
      const key = c.rail === 'BANK' ? `B:${c.ifsc}:${c.accountNumber}` : `U:${c.upiId?.toLowerCase()}`;
      const seen = destinations.get(key) ?? 0;
      if (seen === 1) warnings.push(c.rail === 'BANK' ? `Bank account ${maskAccount(c.accountNumber)} (${c.ifsc}) is used by more than one payout` : `UPI ID ${maskUpi(c.upiId)} is used by more than one payout`);
      destinations.set(key, seen + 1);
      valid += 1;
      totalPaise += c.amountPaise;
      if (c.rail === 'BANK') bankPaise += c.amountPaise;
      else upiPaise += c.amountPaise;
    }
    return { payout, result };
  });

  return { results, warnings, totals: { count: payouts.length, valid, totalPaise, bankPaise, upiPaise } };
}
