import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_LOCALE,
  formatDate,
  formatTime,
  getLocale,
  setLocale,
  subscribeLocale,
  translate,
} from './i18n.js';

export function useLocale() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
  const t = useCallback((key, values) => translate(key, values, locale), [locale]);
  const date = useCallback((value, options) => formatDate(value, options, locale), [locale]);
  const time = useCallback((value, options) => formatTime(value, options, locale), [locale]);

  return { locale, setLocale, t, formatDate: date, formatTime: time };
}
