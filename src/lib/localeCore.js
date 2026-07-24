export const DEFAULT_LOCALE = 'en';
export const LOCALE_STORAGE_KEY = 'minimalist.locale.v1';
export const LOCALE_CHANGE_EVENT = 'minimalist:locale-change';

export const SUPPORTED_LOCALES = Object.freeze([
  Object.freeze({ code: 'en', label: 'English', direction: 'ltr' }),
  Object.freeze({ code: 'es', label: 'Español', direction: 'ltr' }),
  Object.freeze({ code: 'zh-Hans', label: '简体中文', direction: 'ltr' }),
  Object.freeze({ code: 'fr', label: 'Français', direction: 'ltr' }),
  Object.freeze({ code: 'de', label: 'Deutsch', direction: 'ltr' }),
  Object.freeze({ code: 'pt-BR', label: 'Português (Brasil)', direction: 'ltr' }),
  Object.freeze({ code: 'ja', label: '日本語', direction: 'ltr' }),
  Object.freeze({ code: 'ar', label: 'العربية', direction: 'rtl' }),
  Object.freeze({ code: 'hi', label: 'हिन्दी', direction: 'ltr' }),
]);

const supportedLocaleCodes = new Set(SUPPORTED_LOCALES.map(({ code }) => code));
const canonicalLocaleByLowercase = new Map(
  SUPPORTED_LOCALES.map(({ code }) => [code.toLowerCase(), code]),
);

function localeCandidates() {
  if (typeof navigator === 'undefined') return [];
  return Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
}

export function normalizeLocale(value) {
  const candidate = String(value || '').trim().replace(/_/g, '-');
  if (!candidate) return null;
  if (supportedLocaleCodes.has(candidate)) return candidate;
  const lowered = candidate.toLowerCase();
  const exactCanonicalLocale = canonicalLocaleByLowercase.get(lowered);
  if (exactCanonicalLocale) return exactCanonicalLocale;
  if (lowered === 'zh' || lowered.startsWith('zh-cn') || lowered.startsWith('zh-sg') || lowered.startsWith('zh-hans')) return 'zh-Hans';
  if (lowered === 'es' || lowered.startsWith('es-')) return 'es';
  if (lowered === 'en' || lowered.startsWith('en-')) return 'en';
  if (lowered === 'fr' || lowered.startsWith('fr-')) return 'fr';
  if (lowered === 'de' || lowered.startsWith('de-')) return 'de';
  if (lowered === 'pt' || lowered.startsWith('pt-')) return 'pt-BR';
  if (lowered === 'ja' || lowered.startsWith('ja-')) return 'ja';
  if (lowered === 'ar' || lowered.startsWith('ar-')) return 'ar';
  if (lowered === 'hi' || lowered.startsWith('hi-')) return 'hi';
  return null;
}

export function resolveLocale(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}

function readStoredLocale() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage?.getItem(LOCALE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

let currentLocale = resolveLocale([readStoredLocale(), ...localeCandidates()]);
const localeListeners = new Set();

export function getLocale() {
  return currentLocale;
}

export function getLocaleDirection(locale = currentLocale) {
  return SUPPORTED_LOCALES.find(({ code }) => code === normalizeLocale(locale))?.direction || 'ltr';
}

export function applyDocumentLocale(locale = currentLocale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = getLocaleDirection(locale);
}

export function initializeLocale() {
  applyDocumentLocale(currentLocale);
  return currentLocale;
}

export function setLocale(nextLocale) {
  const normalized = normalizeLocale(nextLocale) || DEFAULT_LOCALE;
  if (normalized === currentLocale) {
    applyDocumentLocale(normalized);
    return normalized;
  }

  currentLocale = normalized;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // The language still changes for this session when storage is unavailable.
    }
  }
  applyDocumentLocale(normalized);
  localeListeners.forEach((listener) => listener());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: { locale: normalized } }));
  }
  return normalized;
}

export function subscribeLocale(listener) {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}
