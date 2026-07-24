const BARE_HTTPS_URL_PATTERN = /https:\/\/[^\s<>"'`]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;!?\]}]+$/;

function cleanUrlCandidate(value = '') {
  return String(value || '').trim().replace(TRAILING_URL_PUNCTUATION, '').slice(0, 2048);
}

export function extractFirstPreviewUrl(text = '') {
  const match = String(text || '').match(BARE_HTTPS_URL_PATTERN)?.[0] || '';
  const candidate = cleanUrlCandidate(match);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function messageTextWithoutPreviewUrl(text = '', preview = null) {
  if (!preview?.url) return String(text || '');
  const raw = String(text || '');
  const match = raw.match(BARE_HTTPS_URL_PATTERN)?.[0] || '';
  if (!match) return raw;
  return raw.replace(match, '').replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
}

export function normalizeLinkPreview(value = {}) {
  try {
    const parsed = new URL(String(value.url || '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const domain = String(value.domain || parsed.hostname.replace(/^www\./i, '')).trim().slice(0, 120);
    const title = String(value.title || domain).replace(/\s+/g, ' ').trim().slice(0, 180);
    const description = String(value.description || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    if (!domain || !title) return null;
    return {
      url: parsed.toString(),
      domain,
      title,
      description,
    };
  } catch {
    return null;
  }
}
