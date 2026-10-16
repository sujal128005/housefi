import { en } from '../i18n/en';
import { translate } from '../i18n/I18n';
import { te } from '../i18n/te';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('strings', () => {
  it('Telugu has every English key, none empty, with the same placeholders', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(te[key]).toBeTruthy();
      expect([key, placeholders(te[key])]).toEqual([key, placeholders(en[key])]);
    }
    expect(Object.keys(te).sort()).toEqual(Object.keys(en).sort());
  });

  it('Telugu strings are actually Telugu (not copied English)', () => {
    // Only strings that are all brand names, codes or symbols may stay in Latin script.
    const allowed = ['pay.m.UPI', 'pay.ms.CARD', 'safety.sos'];
    const latinOnly = Object.entries(te).filter(([k, v]) => !/[ఀ-౿]/.test(v) && !allowed.includes(k));
    expect(latinOnly.map(([k]) => k)).toEqual([]);
  });

  it('fills placeholders', () => {
    expect(translate('en', 'auth.otp.invalid', { left: 2 })).toBe('That code is not right. 2 attempts left.');
    expect(translate('te', 'catalog.visitFee', { fee: '₹199' })).toBe('విజిట్ ఫీజు ₹199');
  });
});
