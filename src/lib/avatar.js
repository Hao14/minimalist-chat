// Small auth-adjacent helpers ported from the legacy window.* globals.

export function getAvatarUrl(name, url) {
  if (url && url.trim() !== '') return url;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=000&color=FFD700&bold=true`;
}

export function generateShortId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
