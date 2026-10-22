// Payout kit: masking, rupee formatting, ISO weeks and safe CSV fields (see types.ts).

/** A bank account number with only its last 4 digits shown, e.g. XXXXXX1234. */
export function maskAccount(account: string | undefined): string {
  if (!account || account.length <= 4) return 'XXXX';
  return 'X'.repeat(account.length - 4) + account.slice(-4);
}

/**
 * A UPI ID with the name hidden except its first letter, e.g. r*****@okicici. Never shows the full name: a name of 1
 * or 2 letters is hidden completely.
 */
export function maskUpi(upiId: string | undefined): string {
  const at = upiId?.lastIndexOf('@') ?? -1;
  if (!upiId || at < 1) return '****@****';
  const name = at <= 2 ? '***' : `${upiId[0]}${'*'.repeat(at - 1)}`;
  return `${name}${upiId.slice(at)}`;
}

/** Integer paise as rupees with Indian grouping, e.g. 12345650 -> "Rs 1,23,456.50". Exact (no floating point). */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const p = BigInt(Math.abs(Math.trunc(paise)));
  const whole = (p / 100n).toString();
  const fraction = (p % 100n).toString().padStart(2, '0');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}Rs ${rest ? `${rest},${last3}` : last3}.${fraction}`;
}

/** Integer paise as a plain amount for a bank file, e.g. 450050 -> "4500.50". */
export function plainRupees(paise: number): string {
  const p = BigInt(Math.trunc(paise));
  return `${(p / 100n).toString()}.${(p % 100n).toString().padStart(2, '0')}`;
}

/** The ISO 8601 week number of a "YYYY-MM-DD" date (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeek(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * One CSV field, safe to open in a spreadsheet: a value starting with = + - @ (or a tab / carriage return) gets a
 * leading apostrophe so it is never run as a formula, and fields with the delimiter, quotes or line breaks are quoted.
 */
export function csvField(value: string, delimiter = ','): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
