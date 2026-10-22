// Payout kit: turns the week's technician payouts into bulk-transfer files for the bank, and catches mistakes before
// any money moves. First built with IBM Bob as a stand-alone library ("payout-kit", see docs/IBM-BOB.md), then
// reviewed and adapted for Housefi: pure functions only, no I/O, money in integer paise.

/** How a technician is paid. */
export type PayoutRail = 'BANK' | 'UPI';

/** One payout to send, with the technician's payout details already decrypted. */
export interface KitPayout {
  /** Our payout id (uuid). */
  readonly id: string;
  /** The account holder's name as on the bank account. */
  readonly holderName: string;
  /** Integer paise, more than 0. */
  readonly amountPaise: number;
  readonly rail: PayoutRail;
  /** BANK only. */
  readonly accountNumber?: string;
  /** BANK only. */
  readonly ifsc?: string;
  /** UPI only, e.g. name@okicici. */
  readonly upiId?: string;
  /** The Sunday the paid week ended on, "YYYY-MM-DD" (Housefi payouts run Monday to Sunday). */
  readonly weekEnding: string;
}

export interface ValidationOptions {
  /** Largest single transfer, in paise. Default 1,00,00,000 paise = Rs 1 lakh. */
  readonly maxAmountPaise?: number;
}

export interface ValidationError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/** A payout checked: its problems, and the same payout normalised (trimmed name, upper-case IFSC) when it is fine. */
export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly ValidationError[];
  readonly clean: KitPayout | null;
}

export interface BatchTotals {
  readonly count: number;
  readonly valid: number;
  readonly totalPaise: number;
  readonly bankPaise: number;
  readonly upiPaise: number;
}

export interface BatchResult {
  /** Results in the order of the input. */
  readonly results: readonly { readonly payout: KitPayout; readonly result: ValidationResult }[];
  /** Things to look at before paying, already masked (no full account numbers or UPI IDs). */
  readonly warnings: readonly string[];
  readonly totals: BatchTotals;
}
