import { useSyncExternalStore } from 'react';
import { english } from './translations';

export type Locale = 'en' | 'pt-BR';
export type TranslationValues = Record<string, string | number>;
export const localeStorageKey = 'onun-space-locale';
const listeners = new Set<() => void>();
const validLocale = (value: string | null): Locale => value === 'pt-BR' ? 'pt-BR' : 'en';
function storedLocale(): Locale {
  try { return validLocale(localStorage.getItem(localeStorageKey)); } catch { return 'en'; }
}
let currentLocale: Locale = storedLocale();
function updateDocument() { if (typeof document !== 'undefined') document.documentElement.lang = currentLocale; }
updateDocument();
export function getLocale(): Locale { return currentLocale; }
export function setLocale(locale: Locale) {
  currentLocale = validLocale(locale);
  try { localStorage.setItem(localeStorageKey, currentLocale); } catch { /* The choice still applies for this session. */ }
  updateDocument();
  listeners.forEach(listener => listener());
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== localeStorageKey && event.key !== null) return;
  currentLocale = storedLocale();
  updateDocument();
  listeners.forEach(listener => listener());
});
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function translate(key: string, locale: Locale, values: TranslationValues = {}): string {
  const message = locale === 'en' ? (english[key] ?? key) : key;
  return message.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}
export function t(key: string, values?: TranslationValues): string { return translate(key, currentLocale, values); }
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, () => 'en' as Locale);
  return { locale, setLocale, t };
}
