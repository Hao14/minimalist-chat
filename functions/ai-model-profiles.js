'use strict';

const catalog = require('./ai-model-profiles.json');

const AI_MODEL_PROFILES = Object.freeze(
    Object.fromEntries(catalog.profiles.map((profile) => [profile.id, Object.freeze({ ...profile })]))
);
const DEFAULT_AI_MODEL_PROFILE = catalog.defaultProfile;
const AI_MODEL_PROFILE_IDS = Object.freeze(Object.keys(AI_MODEL_PROFILES));
const MIN_AI_CONTEXT_WINDOW = 2048;
const MAX_AI_CONTEXT_WINDOW = 8192;

function isAiModelProfile(value) {
    return typeof value === 'string' && AI_MODEL_PROFILE_IDS.includes(value.trim().toLowerCase());
}

function normalizeAiModelProfile(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return isAiModelProfile(normalized) ? normalized : DEFAULT_AI_MODEL_PROFILE;
}

function requireAiModelProfile(value) {
    if (value == null || String(value).trim() === '') return DEFAULT_AI_MODEL_PROFILE;
    if (typeof value !== 'string' || !isAiModelProfile(value)) {
        const error = new Error('AI model profile must be "fast" or "smart".');
        error.status = 400;
        error.code = 'INVALID_AI_MODEL_PROFILE';
        throw error;
    }
    return value.trim().toLowerCase();
}

function configuredAiModel(profileId, env = process.env) {
    const id = normalizeAiModelProfile(profileId);
    const profile = AI_MODEL_PROFILES[id];
    const configured = id === 'fast'
        ? env.OLLAMA_FAST_MODEL || env.OLLAMA_MODEL
        : env.OLLAMA_SMART_MODEL;
    return String(configured || profile.model).trim() || profile.model;
}

function configuredAiModelProfile(profileId, env = process.env) {
    const id = normalizeAiModelProfile(profileId);
    return {
        ...AI_MODEL_PROFILES[id],
        id,
        model: configuredAiModel(id, env),
    };
}

function aiModelContextWindow(profile) {
    return Math.max(
        MIN_AI_CONTEXT_WINDOW,
        Math.min(MAX_AI_CONTEXT_WINDOW, Number(profile?.contextWindow) || MAX_AI_CONTEXT_WINDOW)
    );
}

function publicAiModelProfiles(env = process.env, installedModels = null) {
    const installed = Array.isArray(installedModels)
        ? new Set(installedModels.map((model) => String(model?.name || model?.model || model || '').trim()).filter(Boolean))
        : null;
    return AI_MODEL_PROFILE_IDS.map((id) => {
        const profile = configuredAiModelProfile(id, env);
        return {
            id: profile.id,
            label: profile.label,
            description: profile.description,
            model: profile.model,
            ...(installed ? { installed: installed.has(profile.model) } : {}),
        };
    });
}

module.exports = {
    AI_MODEL_PROFILES,
    AI_MODEL_PROFILE_IDS,
    DEFAULT_AI_MODEL_PROFILE,
    MAX_AI_CONTEXT_WINDOW,
    VISION_MODEL: catalog.visionModel,
    aiModelContextWindow,
    configuredAiModel,
    configuredAiModelProfile,
    isAiModelProfile,
    normalizeAiModelProfile,
    publicAiModelProfiles,
    requireAiModelProfile,
};
