export const QUICK_REPLIES_COLLAPSE_STORAGE_PREFIX = 'minimalist.chat.quick-replies-collapsed.v1';

const FALLBACK_ACCOUNT_SCOPE = 'signed-out';

function normalizeAccountScope(uid) {
  const normalized = String(uid || '').trim();
  return normalized || FALLBACK_ACCOUNT_SCOPE;
}

export function quickRepliesCollapseStorageKey(uid) {
  return `${QUICK_REPLIES_COLLAPSE_STORAGE_PREFIX}:${encodeURIComponent(normalizeAccountScope(uid))}`;
}

export function loadQuickRepliesCollapsed(uid, storage) {
  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    return storageTarget?.getItem?.(quickRepliesCollapseStorageKey(uid)) === '1';
  } catch {
    return false;
  }
}

export function saveQuickRepliesCollapsed(uid, value, storage) {
  const collapsed = value === true;
  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    const storageKey = quickRepliesCollapseStorageKey(uid);
    if (collapsed) storageTarget?.setItem?.(storageKey, '1');
    else storageTarget?.removeItem?.(storageKey);
  } catch {
    // Keep the live disclosure state usable when browser storage is unavailable.
  }
  return collapsed;
}
