import { getAuthedJsonHeaders } from '../../lib/authToken.js';
import { normalizeAiSources, newAiUiId } from './aiAgentUi.js';
import {
  buildWinstonPlanCommandPayload,
  normalizeWinstonContextSelection,
  normalizeWinstonPlan,
} from './winstonAdvancedServices.js';
import { createWinstonEncryptedVault } from './winstonEncryptedVault.js';

const CONVERSATION_STORAGE_VERSION = 2;
const CONVERSATION_STORAGE_PREFIX = 'minimalist.winston.conversations.v2';
const CONVERSATION_TOMBSTONE_STORAGE_PREFIX = 'minimalist.winston.conversation-deletes.v1';
const SCHEDULE_STORAGE_PREFIX = 'minimalist.winston.proactive.v1';
const FEEDBACK_STORAGE_PREFIX = 'minimalist.winston.feedback.v1';
const SAVED_RESPONSE_STORAGE_PREFIX = 'minimalist.winston.saved-responses.v1';
const MODEL_MODE_STORAGE_KEY = 'minimalist.winston.model-mode.v1';
const MAX_CONVERSATIONS = 50;
const MAX_CONVERSATION_MESSAGES = 36;
const MAX_LOCAL_CONVERSATION_CHARS = 700_000;
const MAX_SAVED_RESPONSES = 40;
const MAX_FEEDBACK_ITEMS = 50;
const SERVICE_TIMEOUT_MS = 15_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,180}$/;
const PRIVATE_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;
const winstonEncryptedVault = createWinstonEncryptedVault();

export const WINSTON_MODEL_MODES = Object.freeze([
  Object.freeze({ id: 'auto', label: 'Auto', description: 'Winston chooses Fast or Smart for each request.' }),
  Object.freeze({ id: 'fast', label: 'Fast', description: 'Quick everyday answers and summaries.' }),
  Object.freeze({ id: 'smart', label: 'Smart', description: 'Deeper reasoning for complex work.' }),
]);

function cleanText(value, limit = 6000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function safeId(value, fallback = '') {
  const text = String(value || '').trim();
  return SAFE_ID.test(text) ? text : fallback;
}

function storageOwner() {
  return safeId(globalThis.window?.currentUser?.uid, 'local');
}

function storageKey(prefix) {
  return `${prefix}:${storageOwner()}`;
}

function readStorage(key, fallback) {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem?.(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    globalThis.localStorage?.setItem?.(key, JSON.stringify(value));
  } catch {
    // In-memory state remains usable when storage is disabled or full.
  }
  return value;
}

function normalizeWinstonRouteReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const provider = ['local', 'cloudflare', 'groq', 'blocked', 'unknown'].includes(value.provider)
    ? value.provider
    : 'unknown';
  return {
    provider,
    modelProfile: ['fast', 'smart', 'vision'].includes(value.modelProfile) ? value.modelProfile : 'fast',
    localOnly: value.localOnly === true,
    sensitivity: ['none', 'low', 'medium', 'high', 'critical'].includes(value.sensitivity)
      ? value.sensitivity
      : 'none',
    categories: [...new Set((Array.isArray(value.categories) ? value.categories : [])
      .map((category) => cleanText(category, 40))
      .filter(Boolean))].slice(0, 12),
    routeBlocked: value.routeBlocked === true,
  };
}

function normalizeWinstonContextReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    includeFullHistory: value.includeFullHistory === true,
    includeMemories: value.includeMemories !== false,
    indexedHistoryUsed: value.indexedHistoryUsed === true,
    sourceCount: Math.max(0, Math.min(500, Math.floor(Number(value.sourceCount) || 0))),
  };
}

function normalizeWinstonVerification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const claims = (Array.isArray(value.claims) ? value.claims : []).slice(0, 24).map((claim, index) => ({
    id: safeId(claim?.id, `claim_${index + 1}`),
    text: cleanText(claim?.text, 800),
    status: ['supported', 'unsupported', 'uncertain'].includes(claim?.status)
      ? claim.status
      : 'uncertain',
    evidenceIds: [...new Set((Array.isArray(claim?.evidenceIds) ? claim.evidenceIds : [])
      .map((id) => safeId(id))
      .filter(Boolean))].slice(0, 12),
  })).filter((claim) => claim.text);
  const coverage = value.coverage && typeof value.coverage === 'object'
    ? {
      supported: Math.max(0, Math.floor(Number(value.coverage.supported) || 0)),
      total: Math.max(0, Math.floor(Number(value.coverage.total) || 0)),
      complete: value.coverage.complete === true,
      ratio: Number.isFinite(Number(value.coverage.ratio)) ? Number(value.coverage.ratio) : null,
      percent: Number.isFinite(Number(value.coverage.percent)) ? Number(value.coverage.percent) : null,
    }
    : null;
  return {
    status: ['verified', 'issues_found', 'review_needed', 'no_claims'].includes(value.status)
      ? value.status
      : 'review_needed',
    fullySupported: value.fullySupported === true,
    claims,
    ...(coverage ? { coverage } : {}),
  };
}

function normalizeConversationMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const role = value.role === 'assistant' ? 'assistant' : value.role === 'user' ? 'user' : '';
  const content = cleanText(value.content);
  if (!role || !content) return null;
  const status = ['complete', 'error', 'stopped'].includes(value.status) ? value.status : 'complete';
  const attachmentNames = [...new Set([
    ...(Array.isArray(value.attachmentNames) ? value.attachmentNames : []),
    value.attachmentName,
  ].map((name) => cleanText(name, 120)).filter(Boolean))].slice(0, 6);
  const contextSelection = value.contextSelection && typeof value.contextSelection === 'object'
    ? normalizeWinstonContextSelection(value.contextSelection)
    : null;
  const plan = normalizeWinstonPlan(value.plan);
  const routeReceipt = normalizeWinstonRouteReceipt(value.routeReceipt);
  const contextReceipt = normalizeWinstonContextReceipt(value.contextReceipt);
  const verification = normalizeWinstonVerification(value.verification);
  return {
    id: safeId(value.id, newAiUiId(role === 'assistant' ? 'reply' : 'prompt')),
    role,
    content,
    status,
    createdAt: Math.max(0, Number(value.createdAt) || Date.now()),
    ...(attachmentNames.length ? { attachmentName: attachmentNames[0], attachmentNames } : {}),
    ...(contextSelection ? { contextSelection } : {}),
    ...(value.planMode === true ? { planMode: true } : {}),
    ...(safeId(value.originPromptId) ? { originPromptId: safeId(value.originPromptId) } : {}),
    ...(value.requestMode === 'briefing' ? { requestMode: 'briefing' } : {}),
    ...(Array.isArray(value.selectedRoomIds) ? {
      selectedRoomIds: [...new Set(value.selectedRoomIds.map((id) => safeId(id)).filter(Boolean))].slice(0, 8),
    } : {}),
    ...(cleanText(value.provider, 80) ? { provider: cleanText(value.provider, 80) } : {}),
    ...(cleanText(value.model, 120) ? { model: cleanText(value.model, 120) } : {}),
    ...(cleanText(value.modelProfile, 20) ? { modelProfile: cleanText(value.modelProfile, 20) } : {}),
    ...(cleanText(value.requestedModelMode, 20) ? { requestedModelMode: cleanText(value.requestedModelMode, 20) } : {}),
    ...(Array.isArray(value.sources) ? { sources: value.sources.slice(0, 32) } : {}),
    ...(Array.isArray(value.actions) ? { actions: value.actions.slice(0, 6) } : {}),
    ...(plan ? { plan } : {}),
    ...(routeReceipt ? { routeReceipt } : {}),
    ...(contextReceipt ? { contextReceipt } : {}),
    ...(verification ? { verification } : {}),
    ...(value.interaction && typeof value.interaction === 'object' ? { interaction: value.interaction } : {}),
    ...(Array.isArray(value.memorySuggestions) ? {
      memorySuggestions: value.memorySuggestions.slice(0, 3).map((entry) => ({
        id: safeId(entry?.id, newAiUiId('memory-suggestion')),
        text: cleanText(entry?.text || entry, 600),
        scope: entry?.scope === 'room' ? 'room' : 'personal',
        ...(entry?.scope === 'room' ? { roomId: safeId(entry?.roomId, 'global') || 'global' } : {}),
        expiresAt: Math.max(0, Number(entry?.expiresAt) || 0),
      })).filter((entry) => entry.text),
    } : {}),
  };
}

export function normalizeWinstonConversation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const messages = (Array.isArray(value.messages) ? value.messages : Array.isArray(value.turns) ? value.turns : [])
    .map(normalizeConversationMessage)
    .filter(Boolean)
    .slice(-MAX_CONVERSATION_MESSAGES);
  const id = safeId(value.id, '');
  if (!id) return null;
  const firstPrompt = messages.find((message) => message.role === 'user')?.content || '';
  return {
    id,
    serverId: safeId(value.serverId || (value.turns || Object.hasOwn(value, 'turnCount') ? value.id : ''), ''),
    title: cleanText(value.title || firstPrompt || 'New conversation', 80),
    summary: cleanText(value.summary, 420),
    roomId: safeId(value.roomId, 'global') || 'global',
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    createdAt: Math.max(0, Number(value.createdAt) || Date.now()),
    updatedAt: Math.max(0, Number(value.updatedAt) || Date.now()),
    messages,
  };
}

export function createWinstonConversation(title = 'New conversation') {
  const now = Date.now();
  return {
    id: newAiUiId('conversation'),
    serverId: '',
    title: cleanText(title, 80) || 'New conversation',
    summary: '',
    roomId: safeId(globalThis.window?.activeRoomId, 'global') || 'global',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function normalizeWinstonConversations(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    const conversation = normalizeWinstonConversation(entry);
    if (!conversation || seen.has(conversation.id)) return [];
    seen.add(conversation.id);
    return [conversation];
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
}

function winstonConversationVaultKey() {
  return `winston-conversations:${storageOwner()}`;
}

function secureConversationManifest(conversations) {
  return conversations.map((conversation) => ({
    id: conversation.id,
    serverId: conversation.serverId,
    title: 'Secure conversation',
    summary: '',
    roomId: 'global',
    revision: conversation.revision,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: [],
  }));
}

function persistEncryptedWinstonConversations(conversations) {
  if (!winstonEncryptedVault.supported) return Promise.resolve({ ok: false });
  return winstonEncryptedVault.set(winstonConversationVaultKey(), conversations);
}

export async function loadSecureWinstonConversations() {
  if (!winstonEncryptedVault.supported) return [];
  const value = await winstonEncryptedVault.get(winstonConversationVaultKey());
  return normalizeWinstonConversations(value);
}

export function loadLocalWinstonConversations() {
  const stored = readStorage(storageKey(CONVERSATION_STORAGE_PREFIX), null);
  const conversations = normalizeWinstonConversations(
    stored?.version === CONVERSATION_STORAGE_VERSION ? stored.conversations : [],
  );
  if (
    winstonEncryptedVault.supported
    && stored?.encrypted !== true
    && conversations.some((conversation) => conversation.messages.length)
  ) {
    void persistEncryptedWinstonConversations(conversations).then((result) => {
      if (!result?.ok) return;
      writeStorage(storageKey(CONVERSATION_STORAGE_PREFIX), {
        version: CONVERSATION_STORAGE_VERSION,
        encrypted: true,
        savedAt: Date.now(),
        conversations: secureConversationManifest(conversations),
      });
    });
  }
  return conversations.length ? conversations : [createWinstonConversation()];
}

export function saveLocalWinstonConversations(conversations) {
  const normalized = normalizeWinstonConversations(conversations);
  const source = normalized.length ? normalized : [createWinstonConversation()];
  let remainingChars = MAX_LOCAL_CONVERSATION_CHARS;
  const safeConversations = source.map((conversation) => {
    const metadataChars = JSON.stringify({ ...conversation, messages: [] }).length;
    remainingChars = Math.max(0, remainingChars - metadataChars);
    const messages = [];
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      const messageChars = JSON.stringify(message).length;
      if (messageChars > remainingChars) break;
      messages.unshift(message);
      remainingChars -= messageChars;
    }
    return { ...conversation, messages };
  });
  if (winstonEncryptedVault.supported) {
    void persistEncryptedWinstonConversations(safeConversations).then((result) => {
      if (!result?.ok) return;
      writeStorage(storageKey(CONVERSATION_STORAGE_PREFIX), {
        version: CONVERSATION_STORAGE_VERSION,
        encrypted: true,
        savedAt: Date.now(),
        conversations: secureConversationManifest(safeConversations),
      });
    });
  } else {
    writeStorage(storageKey(CONVERSATION_STORAGE_PREFIX), {
      version: CONVERSATION_STORAGE_VERSION,
      savedAt: Date.now(),
      conversations: safeConversations,
    });
  }
  return safeConversations;
}

export function loadWinstonConversationDeleteTombstones() {
  const value = readStorage(storageKey(CONVERSATION_TOMBSTONE_STORAGE_PREFIX), []);
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    const localId = safeId(entry?.localId, '');
    const serverId = safeId(entry?.serverId, '');
    const identity = serverId || localId;
    if (!identity || seen.has(identity)) return [];
    seen.add(identity);
    return [{
      localId,
      serverId,
      createdAt: Math.max(0, Number(entry?.createdAt) || Date.now()),
    }];
  }).slice(0, 50);
}

export function saveWinstonConversationDeleteTombstone({ localId, serverId = '' } = {}) {
  const safeLocalId = safeId(localId, '');
  const safeServerId = safeId(serverId, '');
  if (!safeLocalId && !safeServerId) return loadWinstonConversationDeleteTombstones();
  const current = loadWinstonConversationDeleteTombstones().filter((entry) => (
    !(safeLocalId && entry.localId === safeLocalId)
    && !(safeServerId && entry.serverId === safeServerId)
  ));
  return writeStorage(storageKey(CONVERSATION_TOMBSTONE_STORAGE_PREFIX), [{
    localId: safeLocalId,
    serverId: safeServerId,
    createdAt: Date.now(),
  }, ...current].slice(0, 50));
}

export function removeWinstonConversationDeleteTombstone({ localId, serverId = '' } = {}) {
  const safeLocalId = safeId(localId, '');
  const safeServerId = safeId(serverId, '');
  const next = loadWinstonConversationDeleteTombstones().filter((entry) => (
    !(safeLocalId && entry.localId === safeLocalId)
    && !(safeServerId && entry.serverId === safeServerId)
  ));
  writeStorage(storageKey(CONVERSATION_TOMBSTONE_STORAGE_PREFIX), next);
  return next;
}

export function mergeWinstonConversations(localValue, remoteValue) {
  const merged = new Map();
  [...normalizeWinstonConversations(localValue), ...normalizeWinstonConversations(remoteValue)]
    .forEach((conversation) => {
      const identity = conversation.serverId || conversation.id;
      const current = merged.get(identity);
      if (!current) {
        merged.set(identity, conversation);
        return;
      }
      if (!conversation.messages.length && current.messages.length) {
        const localIsNewer = current.updatedAt > conversation.updatedAt;
        merged.set(identity, {
          ...(localIsNewer ? conversation : current),
          ...(localIsNewer ? current : conversation),
          id: current.id,
          serverId: conversation.serverId || current.serverId,
          messages: current.messages,
        });
        return;
      }
      if (conversation.updatedAt >= current.updatedAt) merged.set(identity, conversation);
    });
  return normalizeWinstonConversations([...merged.values()]);
}

export function winstonConversationTurnsFingerprint(conversation) {
  return JSON.stringify((conversation?.messages || []).map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || 0,
    attachmentNames: message.attachmentNames || [],
    contextSelection: message.contextSelection || null,
    plan: message.plan || null,
  })));
}

export function winstonConversationSyncFingerprint(conversation) {
  if (!conversation) return '';
  return JSON.stringify({
    serverId: conversation.serverId || '',
    title: conversation.title || '',
    roomId: conversation.roomId || 'global',
    turns: (conversation.messages || []).map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || 0,
      attachmentNames: message.attachmentNames || [],
      contextSelection: message.contextSelection || null,
      plan: message.plan || null,
    })),
  });
}

function mergeHydratedConversationMessages(remoteMessages, currentMessages) {
  const seen = new Set();
  return [...(remoteMessages || []), ...(currentMessages || [])].filter((message) => {
    const identity = JSON.stringify([
      message?.role || '',
      message?.content || '',
      message?.createdAt || 0,
    ]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(-MAX_CONVERSATION_MESSAGES);
}

/**
 * Reconcile a full server load against the conversation as it exists when the
 * request resolves. `baselineValue` is the snapshot from when hydration began,
 * so prompts and renames made while the request is in flight are never lost.
 */
export function reconcileHydratedWinstonConversation(currentValue, remoteValue, baselineValue = currentValue) {
  const current = normalizeWinstonConversation(currentValue);
  const remote = normalizeWinstonConversation(remoteValue);
  const baseline = normalizeWinstonConversation(baselineValue);
  if (!current) return { conversation: remote, clean: Boolean(remote) };
  if (!remote) return { conversation: current, clean: false };

  const serverId = remote.serverId || current.serverId;
  const hydrated = { ...remote, id: current.id, serverId };
  const baselineConversation = baseline || current;
  const titleChanged = current.title !== baselineConversation.title;
  const roomChanged = current.roomId !== baselineConversation.roomId;
  const summaryChanged = current.summary !== baselineConversation.summary;
  const turnsChanged = winstonConversationTurnsFingerprint(current)
    !== winstonConversationTurnsFingerprint(baselineConversation);
  const locallyMutated = titleChanged || roomChanged || summaryChanged || turnsChanged;

  if (!locallyMutated) {
    return { conversation: hydrated, clean: true };
  }

  const messages = turnsChanged && !(baselineConversation.messages || []).length
    ? mergeHydratedConversationMessages(remote.messages, current.messages)
    : turnsChanged ? current.messages : remote.messages;

  return {
    conversation: {
      ...hydrated,
      title: titleChanged ? current.title : hydrated.title,
      summary: summaryChanged ? current.summary : hydrated.summary,
      roomId: roomChanged ? current.roomId : hydrated.roomId,
      revision: remote.revision,
      messages,
      createdAt: remote.createdAt || current.createdAt,
      updatedAt: Math.max(current.updatedAt || 0, remote.updatedAt || 0),
    },
    clean: false,
  };
}

export function reconcileConflictedWinstonConversation(currentValue, remoteValue) {
  const current = normalizeWinstonConversation(currentValue);
  const remote = normalizeWinstonConversation(remoteValue);
  if (!current) return remote;
  if (!remote) return current;
  return {
    ...remote,
    id: current.id,
    serverId: remote.serverId || current.serverId,
    title: current.title,
    roomId: current.roomId,
    messages: mergeHydratedConversationMessages(remote.messages, current.messages),
    revision: remote.revision,
    createdAt: remote.createdAt || current.createdAt,
    updatedAt: Math.max(Date.now(), current.updatedAt || 0, remote.updatedAt || 0),
  };
}

/**
 * Apply server identity/metadata from an acknowledged save without replacing
 * edits that were made after the sent snapshot was captured.
 */
export function mergeSavedWinstonConversation(currentValue, sentValue, savedValue) {
  const current = normalizeWinstonConversation(currentValue);
  const sent = normalizeWinstonConversation(sentValue);
  const saved = normalizeWinstonConversation(savedValue);
  if (!current) return saved;
  if (!saved) return current;

  const changedWhileSaving = winstonConversationSyncFingerprint(current)
    !== winstonConversationSyncFingerprint(sent);
  return {
    ...current,
    serverId: saved.serverId || current.serverId || sent?.serverId || '',
    title: changedWhileSaving ? current.title : saved.title || current.title,
    summary: saved.summary || current.summary,
    revision: saved.revision,
    createdAt: saved.createdAt || current.createdAt,
    updatedAt: changedWhileSaving
      ? current.updatedAt
      : saved.updatedAt || current.updatedAt,
  };
}

export function loadWinstonModelMode(storage = globalThis.localStorage) {
  try {
    const value = String(storage?.getItem?.(MODEL_MODE_STORAGE_KEY) || '').toLowerCase();
    return WINSTON_MODEL_MODES.some((mode) => mode.id === value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveWinstonModelMode(value, storage = globalThis.localStorage) {
  const mode = WINSTON_MODEL_MODES.some((entry) => entry.id === value) ? value : 'auto';
  try {
    storage?.setItem?.(MODEL_MODE_STORAGE_KEY, mode);
  } catch {
    // The current session can still use the selected mode.
  }
  return mode;
}

export function resolveWinstonModelProfile(prompt, {
  attachment = null,
  mode = 'auto',
  requestMode = 'chat',
} = {}) {
  if (mode === 'fast' || mode === 'smart') return mode;
  const text = String(prompt || '');
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const complexIntent = /\b(?:analy[sz]e|compare|strategy|research|reason|trade-?offs?|plan|investigate|explain why|root cause|across (?:all|multiple)|decision|proposal|write|draft)\b/i.test(text);
  const structuredIntent = /\b(?:step[- ]by[- ]step|table|report|briefing|citations?|sources?|document|spreadsheet|code)\b/i.test(text);
  return attachment || requestMode === 'briefing' || wordCount > 90 || complexIntent || structuredIntent
    ? 'smart'
    : 'fast';
}

export class WinstonServiceError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'WinstonServiceError';
    this.status = Number(status) || 0;
    this.code = String(code || '');
  }
}

async function postAuthed(url, body, { signal, timeoutMs = SERVICE_TIMEOUT_MS } = {}) {
  if (!url) throw new WinstonServiceError('This Winston service is not configured.', 0, 'NOT_CONFIGURED');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener?.('abort', abort, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: await getAuthedJsonHeaders('Please sign in again before using Winston.'),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new WinstonServiceError(
        cleanText(data?.error || data?.message || `Winston service failed (${response.status}).`, 400),
        response.status,
        data?.code,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof WinstonServiceError) throw error;
    if (error?.name === 'AbortError') throw new WinstonServiceError('Winston stopped waiting for this service.', 0, 'ABORTED');
    throw new WinstonServiceError(error?.message || 'Winston could not reach this service.', 0, 'OFFLINE');
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
  }
}

function profileEndpoint(config) {
  return String(config?.profileEndpoint || '').trim();
}

function gatewayEndpoint(config) {
  return String(config?.gatewayEndpoint || '').trim();
}

export async function loadWinstonConversationsFromServer({ config, signal } = {}) {
  const data = await postAuthed(profileEndpoint(config), { action: 'conversation-list', limit: MAX_CONVERSATIONS }, { signal });
  return normalizeWinstonConversations((data?.conversations || []).map((conversation) => ({
    ...conversation,
    serverId: conversation?.id,
  })));
}

export async function loadWinstonConversationFromServer({ config, conversationId, signal } = {}) {
  const data = await postAuthed(profileEndpoint(config), {
    action: 'conversation-load',
    conversationId: safeId(conversationId),
  }, { signal });
  return normalizeWinstonConversation(data?.conversation ? {
    ...data.conversation,
    serverId: data.conversation.id,
  } : null);
}

export async function saveWinstonConversationToServer({ config, conversation, signal } = {}) {
  const safeConversation = normalizeWinstonConversation(conversation);
  if (!safeConversation) throw new WinstonServiceError('That conversation is invalid.', 0, 'INVALID_CONVERSATION');
  const data = await postAuthed(profileEndpoint(config), {
    action: 'conversation-save',
    ...(safeConversation.serverId ? { conversationId: safeConversation.serverId } : {}),
    conversation: {
      baseRevision: safeConversation.revision,
      title: safeConversation.title,
      roomId: safeConversation.roomId || 'global',
      turns: safeConversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        ...(message.attachmentNames?.length ? { attachmentNames: message.attachmentNames } : {}),
        ...(message.contextSelection ? { contextSelection: message.contextSelection } : {}),
        ...(message.plan ? { plan: message.plan } : {}),
      })),
    },
  }, { signal });
  const saved = normalizeWinstonConversation(data?.conversation ? {
    ...data.conversation,
    serverId: data.conversation.id,
  } : null);
  return saved ? { ...saved, id: safeConversation.id, serverId: saved.serverId } : safeConversation;
}

export async function deleteWinstonConversationFromServer({ config, conversationId, signal } = {}) {
  return postAuthed(profileEndpoint(config), {
    action: 'conversation-delete',
    conversationId: safeId(conversationId),
  }, { signal });
}

export async function sendWinstonPlanCommand({
  command,
  config,
  planId,
  signal,
  stepId,
} = {}) {
  const payload = buildWinstonPlanCommandPayload(planId, stepId, command);
  const data = await postAuthed(
    profileEndpoint(config) || gatewayEndpoint(config),
    payload,
    { signal },
  );
  return {
    ...data,
    ...(data?.plan ? { plan: normalizeWinstonPlan(data.plan) } : {}),
  };
}

function normalizeWinstonKnowledgeIndexStatus(value) {
  const source = value && typeof value === 'object' ? value : {};
  const last = source.lastCompletedSync && typeof source.lastCompletedSync === 'object'
    ? source.lastCompletedSync
    : null;
  return {
    indexed: Math.max(0, Math.min(10_000, Math.floor(Number(source.indexed) || 0))),
    activeSyncId: safeId(source.activeSyncId || source.syncId, ''),
    lastCompletedSync: last ? {
      id: safeId(last.id, ''),
      roomIds: [...new Set((Array.isArray(last.roomIds) ? last.roomIds : []).map((id) => safeId(id)).filter(Boolean))].slice(0, 8),
      processed: Math.max(0, Math.floor(Number(last.processed) || 0)),
      upserted: Math.max(0, Math.floor(Number(last.upserted) || 0)),
      deleted: Math.max(0, Math.floor(Number(last.deleted) || 0)),
      completedAt: Math.max(0, Number(last.completedAt) || 0),
    } : null,
  };
}

export async function getWinstonKnowledgeIndexStatus({ config, signal } = {}) {
  const data = await postAuthed(
    gatewayEndpoint(config) || profileEndpoint(config),
    { action: 'knowledge-index-status' },
    { signal, timeoutMs: 30_000 },
  );
  return normalizeWinstonKnowledgeIndexStatus(data);
}

export async function syncWinstonKnowledgeIndex({
  config,
  onProgress,
  selectedRoomIds = [],
  signal,
} = {}) {
  const roomIds = [...new Set((Array.isArray(selectedRoomIds) ? selectedRoomIds : [])
    .map((id) => safeId(id))
    .filter(Boolean))].slice(0, 8);
  if (!roomIds.length) throw new WinstonServiceError('Choose at least one room to index.', 0, 'KNOWLEDGE_ROOMS_REQUIRED');
  let syncId = '';
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const data = await postAuthed(
      gatewayEndpoint(config) || profileEndpoint(config),
      {
        action: 'knowledge-index-sync',
        selectedRoomIds: roomIds,
        ...(syncId ? { syncId } : {}),
      },
      { signal, timeoutMs: 30_000 },
    );
    syncId = safeId(data?.syncId, syncId);
    const progress = {
      syncId,
      status: data?.complete === true || data?.status === 'completed' ? 'completed' : 'running',
      complete: data?.complete === true || data?.status === 'completed',
      processed: Math.max(0, Math.floor(Number(data?.processed) || 0)),
      upserted: Math.max(0, Math.floor(Number(data?.upserted) || 0)),
      indexed: Math.max(0, Math.floor(Number(data?.indexed) || 0)),
      progress: Math.max(0, Math.min(1, Number(data?.progress) || 0)),
      roomIds,
    };
    onProgress?.(progress);
    if (progress.complete) return progress;
    if (!syncId) throw new WinstonServiceError('Winston did not return a resumable index sync.', 0, 'KNOWLEDGE_SYNC_INVALID');
  }
  throw new WinstonServiceError('Winston’s index needs another sync pass.', 0, 'KNOWLEDGE_SYNC_INCOMPLETE');
}

export async function approveWinstonMemorySuggestion({ config, suggestionId, signal } = {}) {
  const id = String(suggestionId || '').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new WinstonServiceError('That memory suggestion is invalid.', 0, 'INVALID_SUGGESTION');
  return postAuthed(profileEndpoint(config), { action: 'memory-approve', suggestionId: id }, { signal });
}

export async function dismissWinstonMemorySuggestion({ config, suggestionId, signal } = {}) {
  const id = String(suggestionId || '').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) return { dismissed: true, localOnly: true };
  return postAuthed(profileEndpoint(config), { action: 'memory-dismiss', suggestionId: id }, { signal });
}

export async function loadWinstonMemorySuggestions({ config, signal } = {}) {
  const data = await postAuthed(
    profileEndpoint(config),
    { action: 'memory-suggestion-list' },
    { signal },
  );
  return (Array.isArray(data?.memorySuggestions) ? data.memorySuggestions : []).flatMap((entry) => {
    const id = String(entry?.id || '').trim();
    const text = cleanText(entry?.text, 600);
    if (!/^[a-f0-9]{64}$/.test(id) || !text || entry?.status !== 'pending') return [];
    return [{
      id,
      text,
      scope: entry?.scope === 'room' ? 'room' : 'personal',
      ...(entry?.scope === 'room' ? { roomId: safeId(entry?.roomId, 'global') } : {}),
      expiresAt: Math.max(0, Number(entry?.expiresAt) || 0),
    }];
  }).slice(0, 20);
}

export function defaultWinstonSchedule(roomId = 'global') {
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // UTC remains a safe fallback.
  }
  return {
    id: '',
    enabled: false,
    localTime: '08:00',
    timeZone: cleanText(timezone, 80),
    days: [0, 1, 2, 3, 4, 5, 6],
    selectedRoomIds: [safeId(roomId, 'global') || 'global'],
    kind: 'daily_digest',
    lookAheadHours: 24,
  };
}

export function normalizeWinstonSchedule(value, roomId = 'global') {
  const fallback = defaultWinstonSchedule(roomId);
  const schedule = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const localTime = /^\d{2}:\d{2}$/.test(String(schedule.localTime || schedule.time || ''))
    ? String(schedule.localTime || schedule.time)
    : fallback.localTime;
  const selectedRoomIds = [...new Set((Array.isArray(schedule.selectedRoomIds)
    ? schedule.selectedRoomIds
    : Array.isArray(schedule.roomIds) ? schedule.roomIds : fallback.selectedRoomIds)
    .map((id) => safeId(id))
    .filter(Boolean))].slice(0, 8);
  const days = [...new Set((Array.isArray(schedule.days) ? schedule.days : fallback.days)
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return {
    ...fallback,
    id: safeId(schedule.id, ''),
    kind: ['daily_digest', 'upcoming_events', 'due_tasks'].includes(schedule.kind) ? schedule.kind : fallback.kind,
    enabled: schedule.enabled === true,
    localTime,
    timeZone: cleanText(schedule.timeZone || schedule.timezone || fallback.timeZone, 80),
    days: days.length ? days : fallback.days,
    selectedRoomIds: selectedRoomIds.length ? selectedRoomIds : fallback.selectedRoomIds,
    lookAheadHours: Math.max(1, Math.min(168, Math.floor(Number(schedule.lookAheadHours) || 24))),
    nextRunAt: Math.max(0, Number(schedule.nextRunAt) || 0),
  };
}

export function loadLocalWinstonSchedule(roomId = 'global') {
  return normalizeWinstonSchedule(readStorage(storageKey(SCHEDULE_STORAGE_PREFIX), null), roomId);
}

export function saveLocalWinstonSchedule(schedule, roomId = 'global') {
  return writeStorage(storageKey(SCHEDULE_STORAGE_PREFIX), normalizeWinstonSchedule(schedule, roomId));
}

export function deleteLocalWinstonSchedule(roomId = 'global') {
  const next = defaultWinstonSchedule(roomId);
  writeStorage(storageKey(SCHEDULE_STORAGE_PREFIX), next);
  return next;
}

export async function loadWinstonScheduleFromServer({ config, signal } = {}) {
  const data = await postAuthed(profileEndpoint(config), { action: 'schedule-load' }, { signal });
  const schedule = Array.isArray(data?.schedules)
    ? data.schedules.find((entry) => entry?.kind === 'daily_digest') || data.schedules[0]
    : data?.schedule;
  return schedule ? normalizeWinstonSchedule(schedule) : null;
}

export async function saveWinstonScheduleToServer({ config, schedule, signal } = {}) {
  const data = await postAuthed(profileEndpoint(config), {
    action: 'schedule-save',
    ...(safeId(schedule?.id) ? { scheduleId: safeId(schedule.id) } : {}),
    schedule: normalizeWinstonSchedule(schedule),
  }, { signal });
  return normalizeWinstonSchedule(data?.schedule || schedule);
}

export async function deleteWinstonScheduleFromServer({ config, scheduleId, signal } = {}) {
  const id = safeId(scheduleId);
  if (!id) return { deleted: true, localOnly: true };
  return postAuthed(profileEndpoint(config), { action: 'schedule-delete', scheduleId: id }, { signal });
}

function normalizeSearchResult(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = normalizeAiSources([value.source || {
    id: value.id || `S${index + 1}`,
    type: value.type,
    roomId: value.roomId,
    itemId: value.itemId,
    channelId: value.channelId,
    label: value.label || value.title,
    excerpt: value.excerpt || value.text,
    timestamp: value.timestamp,
  }])[0];
  if (!source) return null;
  return {
    id: safeId(value.id, source.id),
    title: cleanText(value.title || source.label, 160),
    excerpt: cleanText(value.excerpt || source.excerpt, 500),
    score: Math.max(0, Math.min(1, Number(value.score) || 0)),
    source,
  };
}

export function normalizeWorkspaceSearchResults(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeSearchResult).filter(Boolean).slice(0, 20);
}

export async function searchWinstonWorkspace({ config, query, roomIds = [], signal } = {}) {
  const data = await postAuthed(gatewayEndpoint(config), {
    action: 'workspace-search',
    query: cleanText(query, 500),
    selectedRoomIds: [...new Set(roomIds.map((id) => safeId(id)).filter(Boolean))].slice(0, 8),
    maxResults: 12,
  }, { signal });
  return {
    results: normalizeWorkspaceSearchResults(data?.results),
    provider: cleanText(data?.provider, 80),
    model: cleanText(data?.model, 120),
  };
}

export function searchLocalWinstonContext(query, context, roomId = 'global') {
  const terms = String(query || '').toLowerCase().match(/[a-z0-9']{2,}/g) || [];
  if (!terms.length) return [];
  const candidates = [
    ...(Array.isArray(context?.messages) ? context.messages : []).map((item, index) => ({
      type: 'message',
      title: item.name || 'Room message',
      text: item.text,
      timestamp: item.at,
      itemId: item.id || `local-message-${index + 1}`,
    })),
    ...(Array.isArray(context?.tasks) ? context.tasks : []).map((item, index) => ({
      type: 'task',
      title: item.text || item.title || 'Task',
      text: [item.text, item.description, item.byName].filter(Boolean).join(' · '),
      timestamp: item.createdAt || item.updatedAt,
      itemId: item.id || `local-task-${index + 1}`,
    })),
    ...(Array.isArray(context?.events) ? context.events : []).map((item, index) => ({
      type: 'event',
      title: item.title || item.name || 'Event',
      text: [item.title, item.name, item.description, item.date, item.time].filter(Boolean).join(' · '),
      timestamp: item.timestamp || item.startAt,
      itemId: item.id || `local-event-${index + 1}`,
    })),
    ...(Array.isArray(context?.docs) ? context.docs : []).map((item, index) => ({
      type: 'document',
      title: item.title || item.name || 'Document',
      text: [item.title, item.name, item.content, item.text].filter(Boolean).join(' · '),
      timestamp: item.updatedAt || item.createdAt,
      itemId: item.id || `local-doc-${index + 1}`,
    })),
  ];
  return candidates.map((candidate, index) => {
    const haystack = `${candidate.title} ${candidate.text || ''}`.toLowerCase();
    const matched = terms.filter((term) => haystack.includes(term)).length;
    if (!matched) return null;
    return normalizeSearchResult({
      id: `S${index + 1}`,
      title: candidate.title,
      excerpt: cleanText(candidate.text, 280),
      score: matched / terms.length,
      source: {
        id: `S${index + 1}`,
        type: candidate.type,
        roomId: safeId(roomId, 'global'),
        itemId: safeId(candidate.itemId, ''),
        label: candidate.title,
        excerpt: cleanText(candidate.text, 280),
        timestamp: candidate.timestamp,
      },
    }, index);
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12);
}

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) return '';
    if (PRIVATE_HOST_PATTERN.test(url.hostname) || url.hostname.endsWith('.local')) return '';
    url.hash = '';
    return url.href.slice(0, 2048);
  } catch {
    return '';
  }
}

export function detectWinstonLiveTool(prompt) {
  const text = String(prompt || '').trim();
  const weatherCommand = text.match(/^\/weather(?:\s+|:)(.+)$/i);
  const weatherIntent = text.match(/\bweather\s+(?:in|for|at)\s+([^?.!\n]{2,120})/i);
  const location = cleanText(weatherCommand?.[1] || weatherIntent?.[1], 120);
  if (location) return { tool: 'weather', input: { location } };

  const urlMatch = text.match(/https:\/\/[^\s<>"']+/i);
  const url = safePublicUrl(urlMatch?.[0]?.replace(/[),.;!?]+$/, ''));
  if (url && (/^\/preview(?:\s+|:)/i.test(text) || /\b(?:link|page|website)\s+preview\b/i.test(text))) {
    return { tool: 'webpage', input: { mode: 'preview', url } };
  }

  const search = text.match(/^\/search(?:\s+|:)(.+)$/i);
  if (search?.[1]) return null;
  return null;
}

export function winstonLiveToolFailureMessage(request) {
  return request?.tool === 'weather'
    ? 'I could not retrieve live weather right now. No live result was used, so I will not guess.'
    : 'I could not retrieve that link preview right now. No page content or live result was used.';
}

export async function runWinstonLiveTool({ config, request, signal } = {}) {
  if (!request?.tool) return null;
  const data = await postAuthed(gatewayEndpoint(config), {
    action: 'live-tool',
    tool: request.tool,
    input: request.input,
  }, { signal, timeoutMs: 25_000 });
  const reply = cleanText(data?.reply, 12_000);
  if (!reply) return null;
  return {
    reply,
    provider: cleanText(data?.provider || `${request.tool}-tool`, 80),
    model: cleanText(data?.model, 120),
    sources: normalizeAiSources(data?.sources),
  };
}

export function suggestWinstonMemory(prompt, memories = []) {
  const source = String(prompt || '').trim();
  if (/\b(?:password|passcode|api\s*key|secret\s*key|access\s*token|refresh\s*token|private\s*key|seed\s*phrase|social\s*security|ssn|credit\s*card|cvv)\b/i.test(source)) {
    return null;
  }
  const durable = source.match(/\b(?:please remember(?: that)?|remember(?: that)?|from now on[,:\s]+|i (?:usually )?prefer|my preference is)\s+(.{4,500})/i)
    || source.match(/\b(?:always|never)\s+(?:reply|respond|format|write|summari[sz]e|remind|address|call|use|include|show|send)\s+(.{4,500})/i);
  if (!durable) return null;
  const text = cleanText(
    /^i (?:usually )?prefer\b/i.test(source) || /^my preference is\b/i.test(source)
      ? source
      : durable[1],
    600,
  ).replace(/[.!?]+$/, '');
  const key = text.toLocaleLowerCase().replace(/\s+/g, ' ');
  const duplicate = (Array.isArray(memories) ? memories : []).some((memory) => (
    String(memory?.text || '').toLocaleLowerCase().replace(/\s+/g, ' ') === key
  ));
  if (!text || duplicate) return null;
  return {
    id: newAiUiId('memory-suggestion'),
    text,
    scope: 'personal',
    expiresAt: 0,
  };
}

export function loadWinstonSavedResponses() {
  const value = readStorage(storageKey(SAVED_RESPONSE_STORAGE_PREFIX), []);
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const id = safeId(entry?.id);
    const content = cleanText(entry?.content, 6000);
    if (!id || !content) return [];
    return [{
      id,
      content,
      provider: cleanText(entry?.provider, 80),
      model: cleanText(entry?.model, 120),
      savedAt: Math.max(0, Number(entry?.savedAt) || 0),
    }];
  }).slice(0, MAX_SAVED_RESPONSES);
}

export function isWinstonResponseSaved(messageId) {
  const id = safeId(messageId);
  return Boolean(id && loadWinstonSavedResponses().some((entry) => entry.id === id));
}

export function toggleWinstonSavedResponse(message) {
  const id = safeId(message?.id);
  if (!id) return { saved: false };
  const current = loadWinstonSavedResponses();
  const exists = current.some((entry) => entry.id === id);
  const next = exists
    ? current.filter((entry) => entry.id !== id)
    : [{
      id,
      content: cleanText(message?.content, 6000),
      provider: cleanText(message?.provider, 80),
      model: cleanText(message?.model, 120),
      savedAt: Date.now(),
    }, ...current].slice(0, MAX_SAVED_RESPONSES);
  writeStorage(storageKey(SAVED_RESPONSE_STORAGE_PREFIX), next);
  return { saved: !exists };
}

export async function createWinstonFeedback({ config, feedback, signal } = {}) {
  const rawReason = cleanText(feedback?.reason, 500).toLocaleLowerCase();
  const category = ['accuracy', 'relevance', 'formatting', 'speed', 'tool_result', 'citation']
    .find((value) => rawReason.includes(value.replace('_', ' '))) || 'general';
  const provider = String(feedback?.provider || '').toLocaleLowerCase();
  const route = provider.includes('groq')
    ? 'groq'
    : provider.includes('cloudflare')
      ? 'cloudflare'
      : provider.includes('ollama') || provider === 'local'
        ? 'local'
        : 'unknown';
  const safeFeedback = {
    requestId: safeId(feedback?.messageId, newAiUiId('feedback')),
    rating: feedback?.rating === 'helpful' ? 'helpful' : 'not_helpful',
    category,
    modelProfile: ['fast', 'smart'].includes(feedback?.modelProfile) ? feedback.modelProfile : '',
    route,
  };
  const localFeedback = {
    rating: safeFeedback.rating,
    category: safeFeedback.category,
    modelProfile: safeFeedback.modelProfile,
    route: safeFeedback.route,
    createdAt: Date.now(),
  };
  const current = readStorage(storageKey(FEEDBACK_STORAGE_PREFIX), []);
  writeStorage(
    storageKey(FEEDBACK_STORAGE_PREFIX),
    [localFeedback, ...(Array.isArray(current) ? current : [])].slice(0, MAX_FEEDBACK_ITEMS),
  );
  if (profileEndpoint(config)) {
    try {
      return await postAuthed(profileEndpoint(config), { action: 'feedback-create', feedback: safeFeedback }, { signal });
    } catch (error) {
      if (![0, 404, 501].includes(error.status)) throw error;
    }
  }
  return { feedback: safeFeedback, localOnly: true };
}
