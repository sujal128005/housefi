// The payout kit's tests: IBM Bob's original cases (adapted to Housefi's field names) plus the cases for what the
// review fixed (docs/IBM-BOB.md).
import { buildBankFiles, LAYOUTS, narration, renderBankFile, transferReference } from './bank-file';
import { csvField, formatRupees, isoWeek, maskAccount, maskUpi, plainRupees } from './format';
import { payoutSummary } from './summary';
import type { KitPayout } from './types';
import { validateBatch, validatePayout } from './validate';

const bank: KitPayout = { id: 'p1', holderName: 'Ravi Kumar', amountPaise: 450050, rail: 'BANK', accountNumber: '98765432101', ifsc: 'SBIN0001234', weekEnding: '2026-10-25' };
const upi: KitPayout = { id: 'p2', holderName: 'Swathi Naidu', amountPaise: 320000, rail: 'UPI', upiId: 'swathi.n@okicici', weekEnding: '2026-10-25' };
const codes = (p: KitPayout) => validatePayout(p).errors.map((e) => e.code);

describe('masking', () => {
  it('shows only the last 4 digits of an account', () => expect(maskAccount('1234567890')).toBe('XXXXXX7890'));
  it('hides a short or missing account completely', () => {
    expect(maskAccount('1234')).toBe('XXXX');
    expect(maskAccount(undefined)).toBe('XXXX');
  });
  it('hides a UPI name except its first letter', () => expect(maskUpi('ramesh@okicici')).toBe('r*****@okicici'));
  it('never shows a short UPI name (review fix)', () => expect(maskUpi('r@upi')).toBe('***@upi'));
  it('hides a broken UPI ID completely', () => expect(maskUpi('nohandle')).toBe('****@****'));
  it('hides a 2-letter UPI name completely', () => expect(maskUpi('ab@ybl')).toBe('***@ybl'));
});

describe('money', () => {
  it.each([
    [1, 'Rs 0.01'],
    [99, 'Rs 0.99'],
    [450050, 'Rs 4,500.50'],
    [10_000_000, 'Rs 1,00,000.00'],
    [1_000_000_000, 'Rs 1,00,00,000.00'],
    [12_345_678_901, 'Rs 12,34,56,789.01'],
  ])('formats %i paise as %s', (paise, text) => expect(formatRupees(paise)).toBe(text));
  it('writes plain amounts for the bank file', () => {
    expect(plainRupees(450050)).toBe('4500.50');
    expect(plainRupees(5)).toBe('0.05');
  });
});

describe('ISO weeks', () => {
  it('week 43 in late October 2026', () => expect(isoWeek('2026-10-25')).toBe(43));
  it('1 January 2027 still belongs to week 53 of 2026', () => expect(isoWeek('2027-01-01')).toBe(53));
  it('4 January 2027 is week 1', () => expect(isoWeek('2027-01-04')).toBe(1));
  it('29 December 2025 is week 1 of 2026', () => expect(isoWeek('2025-12-29')).toBe(1));
});

describe('CSV fields', () => {
  it('stops spreadsheet formulas', () => {
    expect(csvField('=A1+B1')).toBe("'=A1+B1");
    expect(csvField('+91')).toBe("'+91");
    expect(csvField('@cmd')).toBe("'@cmd");
  });
  it('quotes commas and doubles quotes', () => expect(csvField('Hello, "World"')).toBe('"Hello, ""World"""'));
  it('quotes line breaks', () => expect(csvField('a\nb')).toBe('"a\nb"'));
  it('leaves ordinary values alone', () => expect(csvField('Ravi Kumar')).toBe('Ravi Kumar'));
});

describe('one payout', () => {
  it('accepts a good bank payout', () => expect(validatePayout(bank).ok).toBe(true));
  it('accepts a good UPI payout', () => expect(validatePayout(upi).ok).toBe(true));
  it('needs an id', () => expect(codes({ ...bank, id: ' ' })).toContain('REQUIRED'));
  it('refuses 0, negative and fractional amounts', () => {
    expect(codes({ ...bank, amountPaise: 0 })).toContain('INVALID_AMOUNT');
    expect(codes({ ...bank, amountPaise: -5 })).toContain('INVALID_AMOUNT');
    expect(codes({ ...bank, amountPaise: 50.5 })).toContain('INVALID_AMOUNT');
  });
  it('refuses more than the single-transfer limit, which can be changed', () => {
    expect(codes({ ...bank, amountPaise: 10_000_001 })).toContain('OVER_LIMIT');
    expect(validatePayout({ ...bank, amountPaise: 10_000_001 }, { maxAmountPaise: 20_000_000 }).ok).toBe(true);
  });
  it('tidies the name', () => expect(validatePayout({ ...bank, holderName: '  Ravi   Kumar ' }).clean?.holderName).toBe('Ravi Kumar'));
  it('refuses digits or symbols in the name', () => {
    expect(codes({ ...bank, holderName: 'Ravi123' })).toContain('INVALID_NAME');
    expect(codes({ ...bank, holderName: 'R' })).toContain('INVALID_NAME');
  });
  it('refuses a UPI ID on a bank payout', () => expect(codes({ ...bank, upiId: 'a@b' })).toContain('EXTRA_FIELD'));
  it('refuses bank fields on a UPI payout', () => expect(codes({ ...upi, accountNumber: '123456789' })).toContain('EXTRA_FIELD'));
  it('checks the account number', () => {
    expect(codes({ ...bank, accountNumber: '12345678' })).toContain('INVALID_ACCOUNT');
    expect(codes({ ...bank, accountNumber: '1234567890123456789' })).toContain('INVALID_ACCOUNT');
    expect(codes({ ...bank, accountNumber: '12345678A' })).toContain('INVALID_ACCOUNT');
  });
  it('checks the IFSC', () => {
    expect(codes({ ...bank, ifsc: 'SBI0001234' })).toContain('INVALID_IFSC');
    expect(codes({ ...bank, ifsc: 'SBIN1001234' })).toContain('INVALID_IFSC');
  });
  it('accepts a lower-case IFSC and upper-cases it (review fix)', () => expect(validatePayout({ ...bank, ifsc: 'sbin0001234' }).clean?.ifsc).toBe('SBIN0001234'));
  it('checks the UPI ID', () => {
    expect(codes({ ...upi, upiId: 'swathi@123' })).toContain('INVALID_UPI');
    expect(codes({ ...upi, upiId: 'swathi n@okicici' })).toContain('INVALID_UPI'); // review fix: no spaces
    expect(codes({ ...upi, upiId: 'swathi' })).toContain('INVALID_UPI');
  });
  it('refuses an unknown method', () => expect(codes({ ...bank, rail: 'CHEQUE' as never })).toContain('INVALID_METHOD'));
  it('checks the week ending date', () => expect(codes({ ...bank, weekEnding: '25-10-2026' })).toContain('INVALID_DATE'));
  it('never changes the payout it was given (review fix)', () => {
    const p = { ...bank, ifsc: 'sbin0001234' };
    validateBatch([p]);
    expect(p.ifsc).toBe('sbin0001234');
  });
});

describe('a batch', () => {
  it('marks a repeated payout id as an error', () => {
    const r = validateBatch([bank, bank]);
    expect(r.results[1]?.result.ok).toBe(false);
    expect(r.totals.valid).toBe(1);
  });
  it('warns, masked, when two payouts go to one account (review fix: no full number in the warning)', () => {
    const r = validateBatch([bank, { ...bank, id: 'p3' }]);
    expect(r.warnings).toEqual(['Bank account XXXXXXX2101 (SBIN0001234) is used by more than one payout']);
    expect(r.warnings.join()).not.toContain('98765432101');
  });
  it('warns once for a UPI ID used three times', () => {
    const r = validateBatch([upi, { ...upi, id: 'a' }, { ...upi, id: 'b', upiId: 'SWATHI.N@okicici' }]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('s*******@okicici');
  });
  it('adds up the totals per method', () => {
    expect(validateBatch([bank, upi]).totals).toEqual({ count: 2, valid: 2, totalPaise: 770050, bankPaise: 450050, upiPaise: 320000 });
  });
});

describe('bank files', () => {
  it('makes a stable reference from the payout id', () => {
    expect(transferReference('3f2a1b4c-5d6e-7f80-9a0b-1c2d3e4f5a6b')).toBe('3F2A1B4C5D6E7F809A0B');
    expect(transferReference('3f2a1b4c-5d6e-7f80-9a0b-1c2d3e4f5a6b')).toBe(transferReference('3f2a1b4c-5d6e-7f80-9a0b-1c2d3e4f5a6b'));
  });
  it('names the week on the statement', () => expect(narration('2026-10-25')).toBe('HOUSEFI WK43'));
  it('writes the NEFT layout with a header and Windows line endings', () => {
    expect(renderBankFile(LAYOUTS['generic-neft']!, [bank])).toBe(
      'Beneficiary Name,Account Number,IFSC,Amount (Rs),Reference,Narration\r\nRavi Kumar,98765432101,SBIN0001234,4500.50,P1,HOUSEFI WK43\r\n',
    );
  });
  it('writes the UPI layout', () => {
    expect(renderBankFile(LAYOUTS['generic-upi']!, [upi])).toBe('Beneficiary Name,UPI ID,Amount (Rs),Reference,Narration\r\nSwathi Naidu,swathi.n@okicici,3200.00,P2,HOUSEFI WK43\r\n');
  });
  it('refuses a layout for the wrong method', () => expect(() => buildBankFiles(validateBatch([bank]), '2026-10-25', { bank: 'generic-upi' })).toThrow('unknown BANK layout'));
  it('only puts payouts that passed into the files, one file per method', () => {
    const files = buildBankFiles(validateBatch([bank, upi, { ...bank, id: 'bad', ifsc: 'NOPE' }]), '2026-10-25');
    expect(files.files.map((f) => [f.filename, f.count, f.totalPaise])).toEqual([
      ['housefi-payouts-2026-10-25-neft.csv', 1, 450050],
      ['housefi-payouts-2026-10-25-upi.csv', 1, 320000],
    ]);
    expect(files.skipped).toEqual([{ id: 'bad', errors: [expect.objectContaining({ code: 'INVALID_IFSC' })] }]);
  });
  it('makes no file for a method nobody uses', () => expect(buildBankFiles(validateBatch([upi]), '2026-10-25').files.map((f) => f.rail)).toEqual(['UPI']));
});

describe('end to end: a mixed batch of 10', () => {
  const batch: KitPayout[] = [
    bank,
    upi,
    { ...bank, id: 'p3', holderName: 'Anita Desai', accountNumber: '112233445566', ifsc: 'hdfc0000555', amountPaise: 780000 },
    { ...upi, id: 'p4', holderName: 'Vikram Singh', upiId: 'vikram99@okhdfcbank', amountPaise: 150000 },
    { ...bank, id: 'p5', holderName: 'Priya Patel', accountNumber: '998877665544', ifsc: 'ICIC0000123', amountPaise: 540000 },
    { ...bank, id: 'p6', holderName: 'Rahul Gupta', amountPaise: 400000 }, // same account as p1: a warning
    { ...upi, id: 'p7', holderName: '=HYPERLINK("x")', upiId: 'x@ybl' }, // bad name
    { ...bank, id: 'p8', holderName: 'Kiran Rao', accountNumber: '12' }, // bad account
    { ...upi, id: 'p9', holderName: 'Sneha Reddy', upiId: 'sneha@okaxis', amountPaise: 20_000_000 }, // over the limit
    { ...bank, id: 'p1', holderName: 'Ravi Kumar' }, // the same payout again
  ];
  const result = validateBatch(batch);
  const files = buildBankFiles(result, '2026-10-25');
  const summary = payoutSummary(result, files, new Map(batch.map((p) => [p.id, p.holderName])));

  it('counts what is ready', () => expect(result.totals).toMatchObject({ count: 10, valid: 6 }));
  it('leaves out the four bad ones', () => expect(files.skipped.map((s) => s.id)).toEqual(['p7', 'p8', 'p9', 'p1']));
  it('puts 4 bank and 2 UPI payouts in the files', () => expect(files.files.map((f) => f.count)).toEqual([4, 2]));
  it('writes a summary without full account numbers or UPI IDs', () => {
    expect(summary).toContain('Payouts: 10 (ready 6, left out 4)');
    expect(summary).toContain('Total ready to pay: Rs 26,400.50');
    expect(summary).toContain('Bank account XXXXXXX2101 (SBIN0001234) is used by more than one payout');
    expect(summary).toContain('Kiran Rao: Account number must be 9-18 digits');
    expect(summary).not.toMatch(/98765432101|112233445566|swathi\.n@/);
  });
});
