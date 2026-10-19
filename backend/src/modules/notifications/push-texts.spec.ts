import { NotificationKind } from '@prisma/client';
import { pushText } from './push-texts';

const PARAMS = { code: 'HF-48291', amount: 320, etaMin: 12, earning: 30, version: 1, minutes: 9, startHour: 10, endHour: 12, count: 3 };

describe('push texts', () => {
  it.each(Object.values(NotificationKind))('%s has English and Telugu text with every value filled in', (kind) => {
    for (const locale of ['en', 'te'] as const) {
      const t = pushText(kind, locale, PARAMS);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
      expect(`${t.title} ${t.body}`).not.toMatch(/[{}]/);
    }
  });

  it('uses the values and the language', () => {
    expect(pushText('QUOTE_READY', 'en', PARAMS)).toEqual({ title: 'Repair quote ready', body: '₹320 for HF-48291. Review and approve it in the app.' });
    expect(pushText('QUOTE_READY', 'te', PARAMS).body).toBe('HF-48291 కోసం ₹320. యాప్‌లో చూసి ఆమోదించండి.');
  });

  it('falls back to a text without the ETA when there is none', () => {
    expect(pushText('TECH_ON_THE_WAY', 'en', { code: 'HF-1' }).body).toBe('Your technician has started the trip for HF-1.');
    expect(pushText('TECH_ON_THE_WAY', 'en', { code: 'HF-1', etaMin: 7 }).body).toBe('Arriving in about 7 min for HF-1.');
  });

  it('still gives a title when a value is missing', () => {
    expect(pushText('PAYMENT_DUE', 'en', { code: 'HF-1' })).toEqual({ title: 'Repair done, payment due', body: '' });
  });
});
