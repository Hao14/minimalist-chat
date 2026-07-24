function avatarInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return '?';
  const characters = parts.length > 1
    ? [Array.from(parts[0])[0], Array.from(parts.at(-1))[0]]
    : Array.from(parts[0]).slice(0, 2);
  return characters.filter(Boolean).join('').toLocaleUpperCase();
}

function escapeSvgText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function isLegacyRemoteAvatarUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol) && /^(?:www\.)?ui-avatars\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function isGeneratedInitialsAvatarDataUrl(value) {
  const source = String(value || '').trim();
  if (!source.startsWith('data:image/svg+xml;charset=UTF-8,')) return false;
  try {
    const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1));
    return svg.includes('viewBox="0 0 128 128"')
      && svg.includes('font-family="Arial, sans-serif"')
      && svg.includes('dominant-baseline="middle"');
  } catch {
    return false;
  }
}

export function normalizeStoredAvatarUrl(value) {
  const source = String(value || '').trim();
  if (!source || isLegacyRemoteAvatarUrl(source) || isGeneratedInitialsAvatarDataUrl(source)) return '';
  return source;
}

export function createInitialsAvatarDataUrl(
  name,
  { background = '#111111', color = '#FFD400' } = {},
) {
  const initials = escapeSvgText(avatarInitials(name));
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">',
    `<rect width="128" height="128" rx="26" fill="${background}"/>`,
    `<text x="64" y="69" fill="${color}" font-family="Arial, sans-serif" font-size="48" font-weight="700" text-anchor="middle" dominant-baseline="middle">${initials}</text>`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function resolveAvatarSource(name, value) {
  return normalizeStoredAvatarUrl(value) || createInitialsAvatarDataUrl(name);
}
