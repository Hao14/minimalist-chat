import modelCatalog from '../../../functions/ai-model-profiles.json' with { type: 'json' };

export const AI_MODEL_PROFILE_STORAGE_KEY = 'minimalist.ai.model-profile.v1';
export const AI_MODEL_PROFILE_EVENT = 'minimalist-ai-model-profile-change';
export const DEFAULT_AI_MODEL_PROFILE = modelCatalog.defaultProfile;
export const AI_MODEL_PROFILES = Object.freeze(modelCatalog.profiles.map((profile) => Object.freeze({ ...profile })));

const PROFILE_IDS = new Set(AI_MODEL_PROFILES.map((profile) => profile.id));

export function isAiModelProfile(value) {
  return typeof value === 'string' && PROFILE_IDS.has(value.trim().toLowerCase());
}

export function normalizeAiModelProfile(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PROFILE_IDS.has(normalized) ? normalized : DEFAULT_AI_MODEL_PROFILE;
}

export function aiModelProfileDetails(value) {
  const id = normalizeAiModelProfile(value);
  return AI_MODEL_PROFILES.find((profile) => profile.id === id) || AI_MODEL_PROFILES[0];
}

export function loadAiModelProfile(storage = globalThis.localStorage) {
  try {
    return normalizeAiModelProfile(storage?.getItem?.(AI_MODEL_PROFILE_STORAGE_KEY));
  } catch {
    return DEFAULT_AI_MODEL_PROFILE;
  }
}

export function saveAiModelProfile(value, storage = globalThis.localStorage, eventTarget = globalThis.window) {
  const profile = normalizeAiModelProfile(value);
  try {
    storage?.setItem?.(AI_MODEL_PROFILE_STORAGE_KEY, profile);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
  try {
    eventTarget?.dispatchEvent?.(new CustomEvent(AI_MODEL_PROFILE_EVENT, { detail: { profile } }));
  } catch {
    // CustomEvent is unavailable in non-browser test environments.
  }
  return profile;
}
