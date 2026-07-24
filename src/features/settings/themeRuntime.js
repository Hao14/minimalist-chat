export const DEFAULT_ACCENT_COLOR = '#FFD700';

export const THEME_REGISTRY = {
  light: { bodyClass: '', themeColor: '#FFD700', colorScheme: 'light' },
  dark: { bodyClass: 'dark-mode', themeColor: '#0B1020', colorScheme: 'dark' },
  gray: { bodyClass: 'gray-mode', themeColor: '#2D2D2D', colorScheme: 'dark' },
  modern: { bodyClass: 'modern-mode', themeColor: '#F59E0B', colorScheme: 'light dark' },
  codex: { bodyClass: 'codex-mode', themeColor: '#0B0F14', colorScheme: 'dark' },
};

export const THEME_CLASSES = Object.values(THEME_REGISTRY).map((theme) => theme.bodyClass).filter(Boolean);
const themeStylesheetPromises = new Map();

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Some embedded/private browser contexts block localStorage.
  }
}

function relativeLuminance(hexColor) {
  const value = String(hexColor || '').trim().replace(/^#/, '');
  const expanded = value.length === 3
    ? value.split('').map((character) => `${character}${character}`).join('')
    : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;

  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

export function readableAccentForeground(color = DEFAULT_ACCENT_COLOR) {
  const accentLuminance = relativeLuminance(color);
  if (accentLuminance === null) return '#111317';

  // Pure black and white guarantee that at least one option meets the WCAG AA
  // 4.5:1 contrast threshold for every valid sRGB background color.
  const darkContrast = (accentLuminance + 0.05) / 0.05;
  const lightContrast = 1.05 / (accentLuminance + 0.05);
  return darkContrast >= lightContrast ? '#000000' : '#FFFFFF';
}

export function readCustomAccent() {
  return storageGet('customAccentColor');
}

export function normalizeThemeName(themeName = 'light') {
  return THEME_REGISTRY[themeName] ? themeName : 'light';
}

export function ensureThemeStylesheet(themeName = 'light') {
  const normalized = normalizeThemeName(themeName);
  const path = `/themes/${normalized}.css`;
  const loaded = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .find((link) => new URL(link.href, window.location.origin).pathname === path);
  if (loaded) return Promise.resolve();
  if (themeStylesheetPromises.has(normalized)) return themeStylesheetPromises.get(normalized);

  const placeholder = Array.from(document.querySelectorAll('[data-css-lazy="theme"]'))
    .find((link) => String(link.getAttribute('data-href') || '').startsWith(path));
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = placeholder?.getAttribute('data-href') || path;

  const ready = new Promise((resolve, reject) => {
    stylesheet.addEventListener('load', resolve, { once: true });
    stylesheet.addEventListener('error', () => {
      stylesheet.remove();
      reject(new Error(`Could not load the ${normalized} theme.`));
    }, { once: true });
  }).finally(() => themeStylesheetPromises.delete(normalized));

  placeholder?.parentNode?.insertBefore(stylesheet, placeholder.nextSibling);
  placeholder?.remove();
  if (!stylesheet.isConnected) document.head.appendChild(stylesheet);
  themeStylesheetPromises.set(normalized, ready);
  return ready;
}

export function readStoredTheme() {
  return normalizeThemeName(storageGet('theme') || 'light');
}

export function setCustomAccent(color) {
  const foreground = readableAccentForeground(color);
  document.documentElement.style.setProperty('--accent-color', color);
  document.documentElement.style.setProperty('--accent-contrast-color', foreground);
  document.body.style.setProperty('--accent-color', color);
  document.body.style.setProperty('--accent-contrast-color', foreground);
}

export function clearCustomAccent() {
  document.documentElement.style.removeProperty('--accent-color');
  document.documentElement.style.removeProperty('--accent-contrast-color');
  document.body.style.removeProperty('--accent-color');
  document.body.style.removeProperty('--accent-contrast-color');
}

export function themeEntry(themeName) {
  return THEME_REGISTRY[themeName] || THEME_REGISTRY.light;
}

export function updateThemeBrowserChrome(themeName, customAccent = readCustomAccent()) {
  const theme = themeEntry(themeName);
  const themeColor = customAccent || theme.themeColor || DEFAULT_ACCENT_COLOR;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme.colorScheme || 'light dark');
  document.documentElement.dataset.theme = themeName;
  document.documentElement.style.colorScheme = theme.colorScheme || 'light dark';
}

export function updateThemeSelectionUI(themeName = readStoredTheme()) {
  const activeTheme = normalizeThemeName(themeName);
  document.querySelectorAll('.theme-selection-row').forEach((row) => {
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Theme selection');
  });
  document.querySelectorAll('.theme-select-btn').forEach((button) => {
    const isActive = button.getAttribute('data-theme') === activeTheme;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    button.setAttribute('role', 'radio');
    button.setAttribute('type', 'button');
    button.setAttribute('tabindex', isActive ? '0' : '-1');
  });
}

export function applyTheme(themeName = readStoredTheme(), options = {}) {
  const { persist = true, updateSelection = true } = options;
  const savedTheme = normalizeThemeName(themeName);
  const theme = themeEntry(savedTheme);
  document.body.classList.remove(...THEME_CLASSES);
  if (theme.bodyClass) document.body.classList.add(theme.bodyClass);
  if (persist) storageSet('theme', savedTheme);
  const customAccent = readCustomAccent();
  clearCustomAccent();
  if (customAccent) setCustomAccent(customAccent);
  updateThemeBrowserChrome(savedTheme, customAccent);
  if (updateSelection) updateThemeSelectionUI(savedTheme);
  return savedTheme;
}

export function applySavedTheme(options = {}) {
  return applyTheme(readStoredTheme(), { persist: false, ...options });
}
