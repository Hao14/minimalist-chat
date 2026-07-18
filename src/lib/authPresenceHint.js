export const AUTH_PRESENCE_HINT_KEY = 'minimalist.auth.present.v1';
export const AUTH_PRESENCE_HINT_EVENT = 'minimalist:auth-presence';

export function readAuthPresenceHint() {
  try {
    if (!window.localStorage) return null;
    return window.localStorage?.getItem(AUTH_PRESENCE_HINT_KEY) === '1';
  } catch {
    return null;
  }
}

export function writeAuthPresenceHint(present) {
  const next = Boolean(present);
  try {
    if (next) window.localStorage?.setItem(AUTH_PRESENCE_HINT_KEY, '1');
    else window.localStorage?.removeItem(AUTH_PRESENCE_HINT_KEY);
  } catch {
    // The hint only controls presentation; Firebase remains authoritative.
  }

  document.documentElement.classList.toggle('auth-session-hint', next);
  window.dispatchEvent(new CustomEvent(AUTH_PRESENCE_HINT_EVENT, { detail: { present: next } }));
}
