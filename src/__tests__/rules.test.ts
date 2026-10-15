import { CATEGORIES, SERVICES } from '../data/catalog';
import {
  bookableDates, isoDate, isValidName, matchingStatusAt, matchingStep, normalizePhone, pincodeProblem, search, slotsFor, validateAddress,
} from '../domain/rules';
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

  it('limits PIN codes to the demo service area', () => {
    expect(pincodeProblem('500034')).toBeNull();
    expect(pincodeProblem('518001')).toBe('OUTSIDE');
    expect(pincodeProblem('5000')).toBe('INVALID');
  });

  it('reports every missing address field', () => {
    expect(validateAddress({ label: 'HOME', house: '', street: '', landmark: '', pincode: '' })).toEqual({ house: 'REQUIRED', street: 'REQUIRED', pincode: 'REQUIRED' });
    expect(validateAddress({ label: 'HOME', house: '12-3', street: 'Road No. 2, Banjara Hills', landmark: '', pincode: '500034' })).toEqual({});
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
