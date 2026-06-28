export const DEFAULT_ACCENT_COLOR = '#FFD700';

export const THEME_REGISTRY = {
  light: { bodyClass: '', themeColor: '#FFD700', colorScheme: 'light' },
  dark: { bodyClass: 'dark-mode', themeColor: '#0B1020', colorScheme: 'dark' },
  gray: { bodyClass: 'gray-mode', themeColor: '#2D2D2D', colorScheme: 'dark' },
  modern: { bodyClass: 'modern-mode', themeColor: '#F59E0B', colorScheme: 'light dark' },
  codex: { bodyClass: 'codex-mode', themeColor: '#0B0F14', colorScheme: 'dark' },
};

export const THEME_CLASSES = Object.values(THEME_REGISTRY).map((theme) => theme.bodyClass).filter(Boolean);

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

export function readCustomAccent() {
  return storageGet('customAccentColor');
}

export function normalizeThemeName(themeName = 'light') {
  return THEME_REGISTRY[themeName] ? themeName : 'light';
}

export function readStoredTheme() {
  return normalizeThemeName(storageGet('theme') || 'light');
}

export function setCustomAccent(color) {
  document.documentElement.style.setProperty('--accent-color', color);
  document.body.style.setProperty('--accent-color', color);
}

export function clearCustomAccent() {
  document.documentElement.style.removeProperty('--accent-color');
  document.body.style.removeProperty('--accent-color');
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
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    button.setAttribute('role', 'radio');
    button.setAttribute('type', 'button');
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
