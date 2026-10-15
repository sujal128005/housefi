// Turns domain values into display text in the current language.
import { parseIsoDate } from '../domain/rules';
import type { Address, VisitWindow } from '../domain/types';
import { formatDate, formatWindow, sameDay, type Locale } from '../i18n/format';
import type { Params, StringKey } from '../i18n/I18n';

type T = (key: StringKey, params?: Params) => string;

/** "today, 10 AM – 12 PM" / "tomorrow, ..." / "on Thu, 16 Oct, ...". */
export function whenText(w: VisitWindow, locale: Locale, t: T, now = new Date()): string {
  const d = parseIsoDate(w.date);
  const window = formatWindow(w.startHour, w.endHour, locale);
  if (sameDay(d, now)) return t('when.today', { window });
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(d, tomorrow)) return t('when.tomorrow', { window });
  return t('when.date', { date: formatDate(d, locale), window });
}

export function addressLine(a: Address): string {
  return [a.house, a.street, a.landmark].filter((x) => x.trim().length > 0).join(', ');
}

export function addressShort(a: Address): string {
  return `${a.street}, ${a.city}`;
}
