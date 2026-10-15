import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { en, type StringKey } from './en';
import type { Locale, Localized } from './format';
import { te } from './te';

const TABLES: Record<Locale, Record<StringKey, string>> = { en, te };

export type Params = Readonly<Record<string, string | number>>;

export function translate(locale: Locale, key: StringKey, params?: Params): string {
  const raw = TABLES[locale][key] ?? en[key];
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

interface I18nValue {
  readonly locale: Locale;
  readonly t: (key: StringKey, params?: Params) => string;
  /** Picks the current language from catalog content. */
  readonly l: (text: Localized) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
  const t = useCallback((key: StringKey, params?: Params) => translate(locale, key, params), [locale]);
  const l = useCallback((text: Localized) => text[locale], [locale]);
  const value = useMemo(() => ({ locale, t, l }), [locale, t, l]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}

export type { StringKey };
