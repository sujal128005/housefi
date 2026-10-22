// The payout details checks in the app: the same rules as the server's payout kit (built with IBM Bob).
import { payoutHint, payoutProblems, tidyPayout } from '../domain/payout';

const bank = { rail: 'BANK', holderName: 'Swathi Naidu', accountNumber: '98765432101', ifsc: 'SBIN0001234' } as const;
const upi = { rail: 'UPI', holderName: 'Ravi Kumar', upiId: 'ravi.k@okicici' } as const;

describe('payout details', () => {
  it('accepts good bank and UPI details', () => {
    expect(payoutProblems(bank, '98765432101')).toEqual([]);
    expect(payoutProblems(upi)).toEqual([]);
  });

  it('tidies before checking: spaces, a lower-case IFSC, spaces in the number', () => {
    expect(tidyPayout({ ...bank, holderName: '  Swathi   Naidu ', ifsc: ' sbin0001234', accountNumber: '9876 5432 101' })).toEqual(bank);
    expect(payoutProblems({ ...bank, ifsc: 'sbin0001234' }, '98765432101')).toEqual([]);
  });

  it('names each wrong field', () => {
    expect(payoutProblems({ ...bank, holderName: 'S1', accountNumber: '123', ifsc: 'SBI0001234' })).toEqual(['holderName', 'accountNumber', 'ifsc']);
    expect(payoutProblems({ ...upi, upiId: 'ravi k@okicici' })).toEqual(['upiId']);
  });

  it('asks for the account number twice', () => {
    expect(payoutProblems(bank, '98765432100')).toEqual(['confirmAccount']);
    expect(payoutProblems(bank, '9876 5432 101')).toEqual([]);
  });

  it('shows details hidden, like the server', () => {
    expect(payoutHint(bank)).toBe('XXXXXXX2101 · SBIN0001234');
    expect(payoutHint(upi)).toBe('r*****@okicici');
    expect(payoutHint({ ...upi, upiId: 'ab@ybl' })).toBe('***@ybl');
  });
});
