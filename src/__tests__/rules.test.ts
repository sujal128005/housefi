import { CATEGORIES, SERVICES } from '../data/catalog';
import {
  bookableDates, canCancel, cancelRefundsVisitFee, DEMO_TIMING, earningFor, etaMinutes, finalAmount, nextPayoutDate, priceCheck, quoteProblem, isInstantAvailable, isoDate, isValidName, isValidPincode,
  matchingStatusAt, matchingStep, normalizePhone, progressIndex, search, slotsFor, validateAddress,
} from '../domain/rules';
import { languageForPlace } from '../domain/language';
import type { Quote } from '../domain/types';
import { formatRupees, formatWindow } from '../i18n/format';

describe('validation', () => {
  it('accepts Indian mobile numbers with spaces and rejects others', () => {
    expect(normalizePhone('98765 43210')).toBe('9876543210');
    expect(normalizePhone('5876543210')).toBeNull();
    expect(normalizePhone('987654321')).toBeNull();
  });

  it('checks names in English and Telugu', () => {
    expect(isValidName('Priya')).toBe(true);
    expect(isValidName('ప్రియ')).toBe(true);
    expect(isValidName(' a ')).toBe(false);
    expect(isValidName('12')).toBe(false);
  });

  it('accepts any valid Indian PIN code', () => {
    expect(isValidPincode('500034')).toBe(true);
    expect(isValidPincode('518001')).toBe(true);
    expect(isValidPincode('5000')).toBe(false);
    expect(isValidPincode('012345')).toBe(false);
  });

  it('reports every missing address field', () => {
    expect(validateAddress({ label: 'HOME', house: '', street: '', landmark: '', city: '', pincode: '' }))
      .toEqual({ house: 'REQUIRED', street: 'REQUIRED', city: 'REQUIRED', pincode: 'REQUIRED' });
    expect(validateAddress({ label: 'HOME', house: '12-3', street: 'Road No. 2, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '5000' }))
      .toEqual({ pincode: 'INVALID' });
    expect(validateAddress({ label: 'HOME', house: '12-3', street: 'Road No. 2, Banjara Hills', landmark: '', city: 'Hyderabad', pincode: '500034' })).toEqual({});
  });
});

describe('visit rules', () => {
  it('offers instant visits only in working hours', () => {
    expect(isInstantAvailable(new Date(2026, 9, 15, 6, 59))).toBe(false);
    expect(isInstantAvailable(new Date(2026, 9, 15, 7, 0))).toBe(true);
    expect(isInstantAvailable(new Date(2026, 9, 15, 20, 59))).toBe(true);
    expect(isInstantAvailable(new Date(2026, 9, 15, 21, 0))).toBe(false);
  });

  it('refunds the visit fee only before the technician travels', () => {
    expect(cancelRefundsVisitFee('ASSIGNED')).toBe(true);
    expect(cancelRefundsVisitFee('EN_ROUTE')).toBe(false);
    expect(canCancel('EN_ROUTE')).toBe(true);
    expect(canCancel('ARRIVED')).toBe(false);
  });

  it('bills only approved quotes', () => {
    const q = (total: number, decision: 'PENDING' | 'APPROVED' | 'REJECTED'): Quote => ({
      id: 'q', version: 1, lines: [], labourTotal: total, materialTotal: 0, total, diagnosis: { en: '', te: '' },
      review: { state: 'FAIR', typicalMin: 100, typicalMax: 400 }, decision, at: 0,
    });
    expect(finalAmount(q(300, 'APPROVED'), q(340, 'APPROVED'))).toBe(640);
    expect(finalAmount(q(300, 'APPROVED'), q(340, 'REJECTED'))).toBe(300);
    expect(finalAmount(q(300, 'REJECTED'), null)).toBe(0);
  });

  it('counts the ETA down while travelling', () => {
    expect(etaMinutes(DEMO_TIMING.travelSec)).toBe(DEMO_TIMING.travelShownMin);
    expect(etaMinutes(0)).toBe(1);
  });

  it('maps every status onto the five progress steps', () => {
    expect(progressIndex('MATCHING')).toBe(0);
    expect(progressIndex('ASSIGNED')).toBe(1);
    expect(progressIndex('EN_ROUTE')).toBe(2);
    expect(progressIndex('IN_PROGRESS')).toBe(3);
    expect(progressIndex('COMPLETED')).toBe(4);
  });
});

describe('slots', () => {
  const now = new Date(2026, 9, 15, 11, 30);

  it('closes slots that start within an hour or have passed', () => {
    const today = slotsFor(isoDate(now), 'plumb-tap', now);
    expect(today.find((s) => s.startHour === 8)?.state).toBe('CLOSED');
    expect(today.find((s) => s.startHour === 12)?.state).toBe('CLOSED');
    expect(today.find((s) => s.startHour === 14)?.state).not.toBe('CLOSED');
  });

  it('is stable for the same day and service', () => {
    const d = isoDate(bookableDates(now)[2] as Date);
    expect(slotsFor(d, 'ac-service', now)).toEqual(slotsFor(d, 'ac-service', now));
  });

  it('offers seven days starting today', () => {
    const days = bookableDates(now);
    expect(days).toHaveLength(7);
    expect(isoDate(days[0] as Date)).toBe('2026-10-15');
  });
});

describe('matching timeline', () => {
  it('assigns quickly in the QUICK scenario', () => {
    expect(matchingStatusAt('QUICK', 2)).toBe('MATCHING');
    expect(matchingStatusAt('QUICK', 8)).toBe('ASSIGNED');
  });

  it('shows "still searching" before assigning in SLOW', () => {
    expect(matchingStatusAt('SLOW', 8)).toBe('MATCHING_DELAYED');
    expect(matchingStatusAt('SLOW', 21)).toBe('ASSIGNED');
  });

  it('ends unfulfilled in NONE', () => {
    expect(matchingStatusAt('NONE', 30)).toBe('UNFULFILLED');
  });

  it('walks the four progress steps', () => {
    expect([0, 2, 4, 6].map(matchingStep)).toEqual([0, 1, 2, 3]);
  });
});

describe('search', () => {
  it('finds services by English word, Telugu word and issue', () => {
    expect(search('fan').services.map((s) => s.id)).toContain('elec-fan');
    expect(search('కుళాయి').services.map((s) => s.id)).toContain('plumb-tap');
    expect(search('not cooling').services.map((s) => s.id)).toEqual(expect.arrayContaining(['app-fridge', 'ac-service']));
  });

  it('returns nothing for gibberish', () => {
    const r = search('zzqx');
    expect(r.categories).toHaveLength(0);
    expect(r.services).toHaveLength(0);
  });
});

describe('catalog', () => {
  it('has services in every category and unique ids', () => {
    for (const c of CATEGORIES) expect(SERVICES.some((s) => s.categoryId === c.id)).toBe(true);
    expect(new Set(SERVICES.map((s) => s.id)).size).toBe(SERVICES.length);
    const issueIds = SERVICES.flatMap((s) => s.issues.map((i) => i.id));
    expect(new Set(issueIds).size).toBe(issueIds.length);
  });
});

describe('formatting', () => {
  it('groups rupees the Indian way', () => {
    expect(formatRupees(199)).toBe('₹199');
    expect(formatRupees(1250)).toBe('₹1,250');
    expect(formatRupees(125000)).toBe('₹1,25,000');
  });

  it('writes time windows in both languages', () => {
    expect(formatWindow(10, 12, 'en')).toBe('10 AM – 12 PM');
    expect(formatWindow(8, 10, 'te')).toBe('ఉదయం 8 – 10');
    expect(formatWindow(10, 12, 'te')).toBe('ఉదయం 10 – మధ్యాహ్నం 12');
  });
});

describe('technician quotes and earnings', () => {
  const line = (kind: 'LABOUR' | 'MATERIAL', unitPrice: number, qty = 1) => ({ kind, name: 'x', qty, unitPrice });

  it('checks a quote before it is sent', () => {
    expect(quoteProblem('Worn washer', [])).toBe('NO_LINES');
    expect(quoteProblem('Worn washer', [line('MATERIAL', 200)])).toBe('NO_LABOUR');
    expect(quoteProblem('Worn washer', [line('LABOUR', 60)])).toBe('BELOW_MIN');
    expect(quoteProblem('Worn washer', [line('LABOUR', 0)])).toBe('BAD_LINE');
    expect(quoteProblem('', [line('LABOUR', 120), line('MATERIAL', 200)])).toBe('NO_DIAGNOSIS');
    expect(quoteProblem('Worn washer', [line('LABOUR', 120), line('MATERIAL', 200)])).toBeNull();
  });

  it('sends unusually high quotes to a reviewer', () => {
    const ql = (kind: 'LABOUR' | 'MATERIAL', unitPrice: number) => ({ kind, name: { en: 'x', te: 'x' }, qty: 1, unitPrice });
    expect(priceCheck({ repairFrom: 149 }, [ql('LABOUR', 120), ql('MATERIAL', 200)])).toBe('FAIR');
    expect(priceCheck({ repairFrom: 149 }, [ql('LABOUR', 900), ql('MATERIAL', 200)])).toBe('UNDER_REVIEW');
    expect(priceCheck({ repairFrom: 5000 }, [ql('MATERIAL', 6000)])).toBe('UNDER_REVIEW');
  });

  it('pays the visit share plus 80% of approved labour and all approved materials', () => {
    const quote: Quote = {
      id: 'q', version: 1, labourTotal: 120, materialTotal: 200, total: 320, diagnosis: { en: '', te: '' },
      lines: [{ kind: 'LABOUR', name: { en: 'l', te: 'l' }, qty: 1, unitPrice: 120 }, { kind: 'MATERIAL', name: { en: 'm', te: 'm' }, qty: 1, unitPrice: 200 }],
      review: { state: 'FAIR', typicalMin: 149, typicalMax: 596 }, decision: 'APPROVED', at: 0,
    };
    expect(earningFor({ status: 'COMPLETED', visitPayment: { state: 'PAID' }, quote, extraQuote: null })).toBe(30 + 96 + 200);
    expect(earningFor({ status: 'CLOSED_NO_REPAIR', visitPayment: { state: 'PAID' }, quote: { ...quote, decision: 'REJECTED' }, extraQuote: null })).toBe(30);
    expect(earningFor({ status: 'CANCELLED', visitPayment: { state: 'REFUNDED' }, quote: null, extraQuote: null })).toBe(0);
  });

  it('pays out on the next Monday', () => {
    expect(nextPayoutDate(new Date(2026, 9, 16))).toBe('2026-10-19'); // Friday -> Monday
    expect(nextPayoutDate(new Date(2026, 9, 19))).toBe('2026-10-26'); // Monday -> next Monday
  });
});

describe('language from location', () => {
  it('picks Telugu in Andhra Pradesh and Telangana', () => {
    expect(languageForPlace('Kurnool', 'Andhra Pradesh')).toEqual({ language: 'te', supported: true });
    expect(languageForPlace('Hyderabad', 'Telangana')).toEqual({ language: 'te', supported: true });
  });

  it('recognises Hindi in Delhi but it is not in the app yet', () => {
    expect(languageForPlace('New Delhi', 'Delhi')).toEqual({ language: 'hi', supported: false });
  });

  it('falls back to English', () => {
    expect(languageForPlace('', '')).toEqual({ language: 'en', supported: true });
  });
});
