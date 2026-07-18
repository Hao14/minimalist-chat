const LEGACY_CONNECTION_KEY = 'gcalConnected';
const CONNECTION_KEY_PREFIX = 'minimalist:gcal-connection:v1:';
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';

export const GOOGLE_CALENDAR_CONNECTION_EVENT = 'minimalist:google-calendar-connection';

let activeSessionUid = '';
let activeSessionToken = null;

function normalizedUid(uid) {
  return String(uid || '').trim();
}

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function loadGoogleIdentityScript() {
  if (typeof document === 'undefined') return Promise.reject(new Error('Google Identity is unavailable.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  const existing = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      const onLoad = () => resolve();
      const onError = () => reject(new Error('Google Identity could not be loaded.'));
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      window.setTimeout(() => {
        if (window.google?.accounts?.oauth2) resolve();
        else reject(new Error('Google Identity did not become ready.'));
      }, 3000);
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Identity could not be loaded.'));
    document.head.appendChild(script);
  });
}

export function activateGoogleCalendarSession(uid) {
  const nextUid = normalizedUid(uid);
  if (nextUid === activeSessionUid) return false;
  activeSessionUid = nextUid;
  activeSessionToken = null;
  return true;
}

export function googleCalendarTokenFor(uid) {
  return activeSessionUid === normalizedUid(uid) ? activeSessionToken : null;
}

export function isGoogleCalendarSessionActive(uid) {
  return activeSessionUid === normalizedUid(uid);
}

export function setGoogleCalendarTokenFor(uid, token) {
  if (activeSessionUid !== normalizedUid(uid)) return false;
  activeSessionToken = token || null;
  return true;
}

export async function revokeGoogleCalendarToken(token) {
  if (!token) return true;
  try {
    await loadGoogleIdentityScript();
    const revoke = window.google?.accounts?.oauth2?.revoke;
    if (typeof revoke !== 'function') return false;
    return await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(result);
      };
      timer = window.setTimeout(() => finish(false), 3000);
      try {
        revoke(token, () => finish(true));
      } catch {
        finish(false);
      }
    });
  } catch {
    return false;
  }
}

export function googleCalendarConnectionStorageKey(uid) {
  const value = normalizedUid(uid);
  return value ? `${CONNECTION_KEY_PREFIX}${encodeURIComponent(value)}` : '';
}

export function clearLegacyGoogleCalendarConnectionState() {
  try {
    browserStorage()?.removeItem(LEGACY_CONNECTION_KEY);
  } catch {
    // Storage can be unavailable in private browsing or locked-down webviews.
  }
}

export function getGoogleCalendarConnectionState(uid) {
  const key = googleCalendarConnectionStorageKey(uid);
  if (!key) return false;
  clearLegacyGoogleCalendarConnectionState();
  try {
    return browserStorage()?.getItem(key) === '1';
  } catch {
    return false;
  }
}

function announceConnectionState(uid, connected) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(GOOGLE_CALENDAR_CONNECTION_EVENT, {
    detail: {
      connected: Boolean(connected),
      uid: normalizedUid(uid),
    },
  }));
}

export function setGoogleCalendarConnectionState(uid, connected) {
  const key = googleCalendarConnectionStorageKey(uid);
  if (!key) return false;
  clearLegacyGoogleCalendarConnectionState();

  let persisted = false;
  try {
    const storage = browserStorage();
    if (storage) {
      if (connected) storage.setItem(key, '1');
      else storage.removeItem(key);
      persisted = true;
    }
  } catch {
    // The in-memory Calendar session still works when persistence is blocked.
  }

  announceConnectionState(uid, connected);
  return persisted;
}

export async function disconnectGoogleCalendarConnection(uid) {
  const connectionUid = normalizedUid(uid);
  if (!connectionUid) {
    return { disconnected: false, hadToken: false, revoked: false };
  }

  const accessToken = googleCalendarTokenFor(connectionUid);
  setGoogleCalendarTokenFor(connectionUid, null);
  setGoogleCalendarConnectionState(connectionUid, false);
  const revoked = await revokeGoogleCalendarToken(accessToken);
  return {
    disconnected: true,
    hadToken: Boolean(accessToken),
    revoked: !accessToken || revoked,
  };
}
