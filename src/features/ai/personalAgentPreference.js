export const PERSONAL_AGENT_ENABLED_STORAGE_KEY = 'minimalist.ai.personal-agent-enabled.v1';
export const PERSONAL_AGENT_DESKTOP_ENABLED_STORAGE_KEY = 'minimalist.ai.personal-agent-desktop-enabled.v1';
export const PERSONAL_AGENT_MOBILE_ENABLED_STORAGE_KEY = 'minimalist.ai.personal-agent-mobile-enabled.v1';
export const PERSONAL_AGENT_PREFERENCE_EVENT = 'minimalist:personal-agent-preference';
export const PERSONAL_AGENT_PREFERENCE_STORAGE_KEYS = Object.freeze([
  PERSONAL_AGENT_ENABLED_STORAGE_KEY,
  PERSONAL_AGENT_DESKTOP_ENABLED_STORAGE_KEY,
  PERSONAL_AGENT_MOBILE_ENABLED_STORAGE_KEY,
]);
export const PERSONAL_AGENT_DISABLED_BODY_CLASSES = Object.freeze({
  desktop: 'personal-ai-desktop-disabled',
  mobile: 'personal-ai-mobile-disabled',
});

const DEFAULT_PERSONAL_AGENT_PREFERENCES = Object.freeze({
  desktop: true,
  mobile: true,
});

const PERSONAL_AGENT_SURFACE_UI = Object.freeze({
  desktop: {
    triggerId: 'open-personal-agent-btn',
    toggleId: 'personal-ai-desktop-enabled-toggle',
  },
  mobile: {
    triggerId: 'open-personal-agent-btn-mobile',
    toggleId: 'personal-ai-mobile-enabled-toggle',
  },
});

function personalAgentPreferenceStatus(preferences) {
  if (preferences.desktop && preferences.mobile) return 'Shown in desktop and mobile navigation';
  if (preferences.desktop) return 'Shown in desktop navigation only';
  if (preferences.mobile) return 'Shown in mobile navigation only';
  return 'Hidden from desktop and mobile navigation';
}

export function normalizePersonalAgentEnabled(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return !['false', '0', 'off', 'disabled'].includes(normalized);
}

export function resolvePersonalAgentSurface(viewTarget = globalThis.window) {
  try {
    if (viewTarget?.matchMedia?.('(max-width: 768px)').matches) return 'mobile';
    if (Number.isFinite(viewTarget?.innerWidth) && viewTarget.innerWidth <= 768) return 'mobile';
  } catch {
    // Viewport inspection can be unavailable in non-browser environments.
  }
  return 'desktop';
}

function normalizePersonalAgentSurface(surface, viewTarget) {
  if (surface === 'desktop' || surface === 'mobile') return surface;
  return resolvePersonalAgentSurface(viewTarget);
}

function readStoredPreference(storageTarget, key) {
  const storedValue = storageTarget?.getItem?.(key);
  return storedValue === null || storedValue === undefined
    ? null
    : normalizePersonalAgentEnabled(storedValue);
}

export function normalizePersonalAgentPreferences(value) {
  if (!value || typeof value !== 'object') {
    const enabled = normalizePersonalAgentEnabled(value);
    return { desktop: enabled, mobile: enabled };
  }
  return {
    desktop: normalizePersonalAgentEnabled(value.desktop),
    mobile: normalizePersonalAgentEnabled(value.mobile),
  };
}

export function loadPersonalAgentPreferences(storage) {
  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    const legacyPreference = readStoredPreference(storageTarget, PERSONAL_AGENT_ENABLED_STORAGE_KEY);
    return {
      desktop: readStoredPreference(storageTarget, PERSONAL_AGENT_DESKTOP_ENABLED_STORAGE_KEY)
        ?? legacyPreference
        ?? DEFAULT_PERSONAL_AGENT_PREFERENCES.desktop,
      mobile: readStoredPreference(storageTarget, PERSONAL_AGENT_MOBILE_ENABLED_STORAGE_KEY)
        ?? legacyPreference
        ?? DEFAULT_PERSONAL_AGENT_PREFERENCES.mobile,
    };
  } catch {
    return { ...DEFAULT_PERSONAL_AGENT_PREFERENCES };
  }
}

export function loadPersonalAgentEnabled(surface, storage) {
  const resolvedSurface = normalizePersonalAgentSurface(surface);
  return loadPersonalAgentPreferences(storage)[resolvedSurface];
}

export function applyPersonalAgentPreferences(value, documentTarget = globalThis.document) {
  const preferences = normalizePersonalAgentPreferences(value);

  Object.entries(PERSONAL_AGENT_SURFACE_UI).forEach(([surface, ui]) => {
    const enabled = preferences[surface];
    documentTarget?.body?.classList?.toggle(PERSONAL_AGENT_DISABLED_BODY_CLASSES[surface], !enabled);

    const trigger = documentTarget?.getElementById?.(ui.triggerId);
    if (trigger) {
      trigger.classList.toggle('personal-ai-nav-hidden', !enabled);
      trigger.toggleAttribute('hidden', !enabled);
      if (enabled) trigger.removeAttribute('aria-hidden');
      else {
        trigger.setAttribute('aria-hidden', 'true');
        trigger.setAttribute('aria-expanded', 'false');
      }
    }

    const toggle = documentTarget?.getElementById?.(ui.toggleId);
    if (toggle) {
      toggle.checked = enabled;
      toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    }
  });

  const status = documentTarget?.getElementById?.('personal-ai-preference-status');
  if (status) status.textContent = personalAgentPreferenceStatus(preferences);

  const panel = documentTarget?.getElementById?.('personal-ai-agent-panel');
  const openSurface = normalizePersonalAgentSurface(
    panel?.dataset?.personalAgentSurface,
    documentTarget?.defaultView,
  );
  const allDisabled = !preferences.desktop && !preferences.mobile;
  const openSurfaceDisabled = panel?.classList?.contains('open') && !preferences[openSurface];

  if (allDisabled || openSurfaceDisabled) {
    const closePersonalAgent = documentTarget?.defaultView?.closePersonalAgent
      || globalThis.window?.closePersonalAgent;
    if (typeof closePersonalAgent === 'function') closePersonalAgent({ unmount: allDisabled });
    else {
      panel?.classList.remove('open');
      panel?.setAttribute('aria-hidden', 'true');
      Object.values(PERSONAL_AGENT_SURFACE_UI).forEach((ui) => {
        documentTarget?.getElementById?.(ui.triggerId)?.setAttribute('aria-expanded', 'false');
      });
    }
  }

  return preferences;
}

export function savePersonalAgentEnabled(
  surface,
  value,
  storage,
  eventTarget = globalThis.window,
) {
  const resolvedSurface = normalizePersonalAgentSurface(surface, eventTarget);
  const preferences = loadPersonalAgentPreferences(storage);
  const enabled = normalizePersonalAgentEnabled(value);
  preferences[resolvedSurface] = enabled;

  try {
    const storageTarget = storage === undefined ? globalThis.localStorage : storage;
    const storageKey = resolvedSurface === 'mobile'
      ? PERSONAL_AGENT_MOBILE_ENABLED_STORAGE_KEY
      : PERSONAL_AGENT_DESKTOP_ENABLED_STORAGE_KEY;
    storageTarget?.setItem?.(storageKey, String(enabled));
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
  try {
    const PreferenceEvent = eventTarget?.CustomEvent || globalThis.CustomEvent;
    if (typeof PreferenceEvent === 'function') {
      eventTarget?.dispatchEvent?.(new PreferenceEvent(PERSONAL_AGENT_PREFERENCE_EVENT, {
        detail: { surface: resolvedSurface, enabled, preferences },
      }));
    }
  } catch {
    // CustomEvent is unavailable in non-browser test environments.
  }
  return preferences;
}
