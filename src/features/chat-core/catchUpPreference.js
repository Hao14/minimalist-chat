export const ROOM_CATCHUP_PREFERENCE_EVENT = 'minimalist:catchup-preference';
export const ROOM_CATCHUP_PREFERENCE_STORAGE_PREFIX = 'minimalist.chat.catchup-enabled.v1';
export const ROOM_CATCHUP_REVIEW_EVENT = 'minimalist:catchup-review';
export const ROOM_CATCHUP_REVIEW_STORAGE_PREFIX = 'minimalist.chat.catchup-reviewed.v1';

const DEFAULT_ROOM_CATCHUP_ENABLED = true;
const FALLBACK_ACCOUNT_SCOPE = 'signed-out';

function normalizeAccountScope(uid) {
  const normalized = String(uid || '').trim();
  return normalized || FALLBACK_ACCOUNT_SCOPE;
}

export function roomCatchUpStorageKey(uid) {
  return `${ROOM_CATCHUP_PREFERENCE_STORAGE_PREFIX}:${encodeURIComponent(normalizeAccountScope(uid))}`;
}

export function roomCatchUpReviewedStorageKey(uid, scopeKey) {
  const normalizedScope = String(scopeKey || 'global::general').trim() || 'global::general';
  return `${ROOM_CATCHUP_REVIEW_STORAGE_PREFIX}:${encodeURIComponent(normalizeAccountScope(uid))}:${encodeURIComponent(normalizedScope)}`;
}

export function loadRoomCatchUpReviewedId(uid, scopeKey, storage) {
  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    return String(storageTarget?.getItem?.(roomCatchUpReviewedStorageKey(uid, scopeKey)) || '').trim();
  } catch {
    return '';
  }
}

export function saveRoomCatchUpReviewedId(
  uid,
  scopeKey,
  messageId,
  storage,
  eventTarget = globalThis.window,
) {
  const accountScope = normalizeAccountScope(uid);
  const storageKey = roomCatchUpReviewedStorageKey(accountScope, scopeKey);
  const reviewedMessageId = String(messageId || '').trim();

  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    if (reviewedMessageId) storageTarget?.setItem?.(storageKey, reviewedMessageId);
    else storageTarget?.removeItem?.(storageKey);
  } catch {
    // The live review state remains usable when browser storage is unavailable.
  }

  try {
    const ReviewEvent = eventTarget?.CustomEvent || globalThis.CustomEvent;
    if (typeof ReviewEvent === 'function') {
      eventTarget?.dispatchEvent?.(new ReviewEvent(ROOM_CATCHUP_REVIEW_EVENT, {
        detail: {
          uid: accountScope,
          scopeKey: String(scopeKey || ''),
          reviewedMessageId,
          storageKey,
        },
      }));
    }
  } catch {
    // CustomEvent is unavailable in some test and embedded browser contexts.
  }

  return reviewedMessageId;
}

export function normalizeRoomCatchUpEnabled(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return DEFAULT_ROOM_CATCHUP_ENABLED;
  return !['false', '0', 'off', 'disabled'].includes(String(value).trim().toLowerCase());
}

export function loadRoomCatchUpEnabled(uid, storage) {
  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    const storedValue = storageTarget?.getItem?.(roomCatchUpStorageKey(uid));
    return storedValue === null || storedValue === undefined
      ? DEFAULT_ROOM_CATCHUP_ENABLED
      : normalizeRoomCatchUpEnabled(storedValue);
  } catch {
    return DEFAULT_ROOM_CATCHUP_ENABLED;
  }
}

export function saveRoomCatchUpEnabled(
  uid,
  value,
  storage,
  eventTarget = globalThis.window,
) {
  const accountScope = normalizeAccountScope(uid);
  const storageKey = roomCatchUpStorageKey(accountScope);
  const enabled = normalizeRoomCatchUpEnabled(value);

  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    storageTarget?.setItem?.(storageKey, String(enabled));
  } catch {
    // Keep the live setting usable when storage is unavailable. It will return
    // to the safe default after a reload in that browser context.
  }

  try {
    const PreferenceEvent = eventTarget?.CustomEvent || globalThis.CustomEvent;
    if (typeof PreferenceEvent === 'function') {
      eventTarget?.dispatchEvent?.(new PreferenceEvent(ROOM_CATCHUP_PREFERENCE_EVENT, {
        detail: { uid: accountScope, enabled, storageKey },
      }));
    }
  } catch {
    // CustomEvent is unavailable in some test and embedded browser contexts.
  }

  return enabled;
}
