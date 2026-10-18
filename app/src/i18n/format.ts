// Locale-aware formatting without relying on the platform's Intl data (Hermes builds differ in Telugu coverage).
export type Locale = 'en' | 'te';

/** A piece of catalog content in both languages. */
export interface Localized {
  readonly en: string;
  readonly te: string;
}

export function pick(text: Localized, locale: Locale): string {
  return text[locale];
}

const MONTHS: Record<Locale, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  te: ['జన', 'ఫిబ్ర', 'మార్చి', 'ఏప్రి', 'మే', 'జూన్', 'జులై', 'ఆగ', 'సెప్టెం', 'అక్టో', 'నవం', 'డిసెం'],
};

const WEEKDAYS: Record<Locale, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  te: ['ఆది', 'సోమ', 'మంగళ', 'బుధ', 'గురు', 'శుక్ర', 'శని'],
};

export function weekdayShort(d: Date, locale: Locale): string {
  return WEEKDAYS[locale][d.getDay()] ?? '';
}

export function monthShort(d: Date, locale: Locale): string {
  return MONTHS[locale][d.getMonth()] ?? '';
}

/** "Thu, 16 Oct" / "గురు, 16 అక్టో". */
export function formatDate(d: Date, locale: Locale): string {
  return `${weekdayShort(d, locale)}, ${d.getDate()} ${monthShort(d, locale)}`;
}

/** Hour of day (0-23) as "9 AM" / "ఉదయం 9". Telugu names the part of the day instead of AM/PM. */
export function formatHour(hour: number, locale: Locale): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (locale === 'en') return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
  const part = hour < 12 ? 'ఉదయం' : hour < 16 ? 'మధ్యాహ్నం' : hour < 20 ? 'సాయంత్రం' : 'రాత్రి';
  return `${part} ${h12}`;
}

/** A time window, e.g. "9 AM – 11 AM" or "ఉదయం 9 – 11". */
export function formatWindow(startHour: number, endHour: number, locale: Locale): string {
  if (locale === 'te') {
    const sameDayPart = formatHour(startHour, 'te').split(' ')[0] === formatHour(endHour, 'te').split(' ')[0];
    const end = endHour % 12 === 0 ? 12 : endHour % 12;
    return sameDayPart ? `${formatHour(startHour, 'te')} – ${end}` : `${formatHour(startHour, 'te')} – ${formatHour(endHour, 'te')}`;
  }
  return `${formatHour(startHour, 'en')} – ${formatHour(endHour, 'en')}`;
}

/** Whole rupees with Indian digit grouping: 1250 -> "₹1,250", 125000 -> "₹1,25,000". */
export function formatRupees(rupees: number): string {
  const n = Math.round(rupees);
  const s = String(Math.abs(n));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}

/** Seconds as m:ss. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "+91 98765 43210". */
export function formatPhone(tenDigits: string): string {
  return `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
