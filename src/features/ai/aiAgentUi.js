import { optimizeImageForUpload } from '../../lib/imageUploadOptimization.js';

export const AI_SOURCE_OPEN_EVENT = 'minimalist:ai-source-open';
export const AI_ROUTING_POLICY_STORAGE_KEY = 'minimalist.ai.routing-policy.v1';
export const LOCAL_AI_MEMORIES_STORAGE_KEY = 'minimalist.ai.memories.v1';
export const MAX_AI_HISTORY_MESSAGES = 36;
export const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AI_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024;

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SAFE_CALL_THREAD_ID = /^[A-Za-z0-9_-]{1,260}$/;
const SOURCE_TYPES = new Set(['message', 'task', 'document', 'doc', 'event', 'room', 'weather', 'webpage', 'file', 'audio']);
const PRIVATE_SOURCE_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MEMORY_SCOPES = new Set(['personal', 'room']);
const AI_CLARIFICATION_MAX_QUESTION_CHARS = 240;
const AI_CLARIFICATION_MAX_OPTION_CHARS = 80;
const AI_CLARIFICATION_MIN_OPTIONS = 2;
const AI_CLARIFICATION_MAX_OPTIONS = 5;
const AI_ACTION_TYPES = new Set([
  'create_task',
  'create_room',
  'invite_friends',
  'start_friend_call',
  'create_event',
  'update_event',
  'set_reminder',
  'complete_task',
]);
const AI_ACTION_STATUSES = new Set(['proposed', 'confirming', 'confirmed', 'dismissed', 'expired']);
const AI_ACTION_PRESENTATIONS = Object.freeze({
  create_task: Object.freeze({
    icon: 'ph-list-plus',
    kicker: 'Create task · confirmation required',
    pendingMessage: 'Creating task…',
    successMessage: 'Task created.',
    errorMessage: 'The task was not created.',
    openLabel: 'Open task',
  }),
  create_room: Object.freeze({
    icon: 'ph-chats-circle',
    kicker: 'Create room · confirmation required',
    pendingMessage: 'Creating room…',
    successMessage: 'Room created.',
    errorMessage: 'The room was not created.',
    openLabel: 'Open room',
  }),
  invite_friends: Object.freeze({
    icon: 'ph-user-plus',
    kicker: 'Invite friends · confirmation required',
    pendingMessage: 'Inviting friends…',
    successMessage: 'Friend invites sent.',
    errorMessage: 'The friend invites were not sent.',
    openLabel: 'Open room',
    constraint: 'Only accepted friends can be invited.',
  }),
  start_friend_call: Object.freeze({
    icon: 'ph-phone-call',
    kicker: 'Call friend · confirmation required',
    pendingMessage: 'Confirming friend call…',
    successMessage: 'Opening the voice call…',
    errorMessage: 'The friend call could not be started.',
    openLabel: 'Return to call',
    constraint: 'Calls are limited to accepted friends. Microphone access is requested only after you confirm.',
  }),
  create_event: Object.freeze({
    icon: 'ph-calendar-plus',
    kicker: 'Create event · confirmation required',
    pendingMessage: 'Creating event…',
    successMessage: 'Event created.',
    errorMessage: 'The event was not created.',
    openLabel: 'Open calendar',
  }),
  update_event: Object.freeze({
    icon: 'ph-calendar-dots',
    kicker: 'Update event · confirmation required',
    pendingMessage: 'Updating event…',
    successMessage: 'Event updated.',
    errorMessage: 'The event was not updated.',
    openLabel: 'Open calendar',
  }),
  set_reminder: Object.freeze({
    icon: 'ph-bell-ringing',
    kicker: 'Set reminder · confirmation required',
    pendingMessage: 'Saving reminder…',
    successMessage: 'Reminder set.',
    errorMessage: 'The reminder was not set.',
    openLabel: 'Open updates',
  }),
  complete_task: Object.freeze({
    icon: 'ph-check-square',
    kicker: 'Complete task · confirmation required',
    pendingMessage: 'Completing task…',
    successMessage: 'Task completed.',
    errorMessage: 'The task was not completed.',
    openLabel: 'Open tasks',
  }),
});
const SNAPSHOT_STOP_WORDS = new Set('a an the and or but if then is are was were be been being to of in on at for with as by from this that these those it its i you he she we they me him her them my your our their not no yes do does did have has had will would can could should just so about into out up down over under again more most some any all'.split(' '));

function clippedText(value, limit) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function boundedClarificationText(value, limit) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/\[S\d{1,6}\](?:\([^\r\n)]*\))?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([?!.,;:])/g, '$1')
    .trim();
  if (
    !text
    || text.length > limit
    || [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
    || text.includes('[[MINIMALIST_CLARIFICATION]]')
    || text.includes('[[/MINIMALIST_CLARIFICATION]]')
  ) return '';
  return text;
}

function safeOpaqueId(value, fallback = '') {
  const text = String(value || '').trim();
  return SAFE_ID.test(text) ? text : fallback;
}

function safeExternalSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    if (PRIVATE_SOURCE_HOST.test(url.hostname) || url.hostname.endsWith('.local')) return '';
    url.hash = '';
    return url.href.slice(0, 2048);
  } catch {
    return '';
  }
}

function boundedSnapshotSource(value, limit = 4096) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  const side = Math.floor((limit - 3) / 2);
  return `${text.slice(0, side)}\n…\n${text.slice(-side)}`;
}

export function newAiUiId(prefix = 'ai') {
  try {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Locked-down WebViews can expose crypto without randomUUID access.
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function appendBoundedAiHistory(history, ...messages) {
  return [...(Array.isArray(history) ? history : []), ...messages]
    .filter(Boolean)
    .slice(-MAX_AI_HISTORY_MESSAGES);
}

export function buildRoomInstantSnapshot(context, limit = 4) {
  const safeLimit = Math.max(1, Math.min(6, Number(limit) || 4));
  const candidates = (Array.isArray(context?.messages) ? context.messages : [])
    .slice(-120)
    .flatMap((message) => boundedSnapshotSource(message?.text).split(/(?<=[.!?])\s+|\n+/).slice(0, 12))
    .slice(-240)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length > 25)
    .map((sentence) => clippedText(sentence, 220));

  if (candidates.length <= safeLimit) return candidates;

  const frequency = {};
  candidates.forEach((sentence) => sentence.toLowerCase().match(/[a-z']+/g)?.forEach((word) => {
    if (!SNAPSHOT_STOP_WORDS.has(word) && word.length > 2) frequency[word] = (frequency[word] || 0) + 1;
  }));

  return candidates
    .map((sentence, index) => {
      const words = sentence.toLowerCase().match(/[a-z']+/g) || [];
      const score = words.reduce((total, word) => total + (frequency[word] || 0), 0) / (words.length || 1);
      return { sentence, index, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
}

export function upsertAiHistoryMessage(history, message) {
  const source = Array.isArray(history) ? history : [];
  const index = source.findIndex((entry) => entry?.id === message?.id);
  if (index < 0) return appendBoundedAiHistory(source, message);
  const next = source.slice();
  next[index] = { ...next[index], ...message };
  return next.slice(-MAX_AI_HISTORY_MESSAGES);
}

export function normalizeAiRoutingPolicy(value) {
  return String(value || '').trim().toLowerCase() === 'local-only' ? 'local-only' : 'balanced';
}

export function loadAiRoutingPolicy(storage = globalThis.localStorage) {
  try {
    return normalizeAiRoutingPolicy(storage?.getItem?.(AI_ROUTING_POLICY_STORAGE_KEY));
  } catch {
    return 'balanced';
  }
}

export function saveAiRoutingPolicy(value, storage = globalThis.localStorage) {
  const policy = normalizeAiRoutingPolicy(value);
  try {
    storage?.setItem?.(AI_ROUTING_POLICY_STORAGE_KEY, policy);
  } catch {
    // A session can still use the selected policy when storage is unavailable.
  }
  return policy;
}

export function normalizeAiSources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((source, index) => {
    if (!source || typeof source !== 'object') return [];
    const id = safeOpaqueId(String(source.id || '').replace(/^\[|\]$/g, ''), `S${index + 1}`);
    const type = String(source.type || '').trim().toLowerCase();
    const roomId = safeOpaqueId(source.roomId, '');
    const itemId = safeOpaqueId(source.itemId, '');
    const channelId = safeOpaqueId(source.channelId, 'general') || 'general';
    const attachmentId = safeOpaqueId(source.attachmentId, '');
    const externalUrl = type === 'weather' || type === 'webpage' ? safeExternalSourceUrl(source.url) : '';
    if (!SOURCE_TYPES.has(type) || !id || seen.has(id) || ((type === 'weather' || type === 'webpage') && !externalUrl)) return [];
    seen.add(id);
    const locator = {};
    const page = Math.max(0, Math.floor(Number(source.locator?.page ?? source.page) || 0));
    const rowStart = Math.max(0, Math.floor(Number(source.locator?.rowStart ?? source.rowStart) || 0));
    const rowEnd = Math.max(rowStart, Math.floor(Number(source.locator?.rowEnd ?? source.rowEnd) || rowStart));
    const lineStart = Math.max(0, Math.floor(Number(source.locator?.lineStart ?? source.lineStart) || 0));
    const lineEnd = Math.max(lineStart, Math.floor(Number(source.locator?.lineEnd ?? source.lineEnd) || lineStart));
    const startSeconds = Math.max(0, Number(source.locator?.startSeconds ?? source.startSeconds) || 0);
    const endSeconds = Math.max(startSeconds, Number(source.locator?.endSeconds ?? source.endSeconds) || startSeconds);
    if (page) locator.page = Math.min(100_000, page);
    if (rowStart) {
      locator.rowStart = Math.min(10_000_000, rowStart);
      locator.rowEnd = Math.min(10_000_000, rowEnd);
    }
    if (lineStart) {
      locator.lineStart = Math.min(10_000_000, lineStart);
      locator.lineEnd = Math.min(10_000_000, lineEnd);
    }
    if (type === 'audio' && (startSeconds || endSeconds)) {
      locator.startSeconds = Math.min(604_800, startSeconds);
      locator.endSeconds = Math.min(604_800, endSeconds);
    }
    return [{
      id,
      type,
      roomId,
      itemId,
      channelId,
      label: clippedText(source.label || `${type} source`, 120),
      excerpt: clippedText(source.excerpt, 280),
      timestamp: Math.max(0, Number(source.timestamp) || 0),
      ...(attachmentId ? { attachmentId } : {}),
      ...(Object.keys(locator).length ? { locator } : {}),
      ...(externalUrl ? { url: externalUrl } : {}),
    }];
  }).slice(0, 32);
}

export function sourceOpenDetail(source) {
  const normalized = normalizeAiSources([source])[0];
  if (!normalized) return null;
  return {
    id: normalized.id,
    type: normalized.type,
    roomId: normalized.roomId,
    itemId: normalized.itemId,
    channelId: normalized.channelId,
    timestamp: normalized.timestamp,
    ...(normalized.attachmentId ? { attachmentId: normalized.attachmentId } : {}),
    ...(normalized.locator ? { locator: normalized.locator } : {}),
    ...(normalized.url ? { url: normalized.url } : {}),
  };
}

export function dispatchAiSourceOpen(source, eventTarget = globalThis.window) {
  const detail = sourceOpenDetail(source);
  if (!detail || typeof eventTarget?.dispatchEvent !== 'function') return false;
  const EventConstructor = eventTarget.CustomEvent || globalThis.CustomEvent;
  if (typeof EventConstructor !== 'function') return false;
  return eventTarget.dispatchEvent(new EventConstructor(AI_SOURCE_OPEN_EVENT, { detail }));
}

export function openAiSourceContext(source, windowTarget = globalThis.window, documentTarget = globalThis.document) {
  const detail = sourceOpenDetail(source);
  if (!detail) return { opened: false, exact: false };
  dispatchAiSourceOpen(source, windowTarget);

  if ((detail.type === 'weather' || detail.type === 'webpage') && detail.url) {
    const opened = windowTarget?.open?.(detail.url, '_blank', 'noopener,noreferrer');
    try {
      if (opened) opened.opener = null;
    } catch {
      // Cross-origin window handles can reject property access.
    }
    return { opened: Boolean(opened), exact: true, external: true };
  }

  if (detail.type === 'message' && detail.roomId && detail.itemId && typeof windowTarget?.jumpToMessage === 'function') {
    windowTarget.jumpToMessage({
      roomId: detail.roomId,
      channelId: detail.channelId,
      messageId: detail.itemId,
    });
    return { opened: true, exact: true };
  }

  const tabTarget = {
    task: 'tasks',
    document: 'docs',
    doc: 'docs',
    event: 'events',
    room: 'home',
  }[detail.type];
  if (!tabTarget) return { opened: true, exact: false };

  const openKnownTab = () => {
    const selector = `.room-tab[data-target="${tabTarget}"]`;
    documentTarget?.querySelector?.(selector)?.click?.();
  };
  const activeRoomId = safeOpaqueId(windowTarget?.activeRoomId, '');
  if (!detail.roomId || detail.roomId === activeRoomId) {
    openKnownTab();
    return { opened: true, exact: false };
  }
  if (typeof windowTarget?.openAiSource === 'function') {
    windowTarget.openAiSource(detail);
    return { opened: true, exact: false };
  }
  if (typeof windowTarget?.switchRoom === 'function') {
    const fallbackName = detail.roomId === 'global' ? 'Global Chat' : `Room ${detail.roomId.slice(0, 8)}`;
    const fallbackShortId = detail.roomId === 'global' ? 'GLOBAL' : detail.roomId.slice(0, 12);
    try {
      Promise.resolve(windowTarget.switchRoom(detail.roomId, fallbackName, fallbackShortId))
        .catch(() => null)
        .finally(() => windowTarget.setTimeout?.(openKnownTab, 120));
    } catch {
      openKnownTab();
    }
  } else {
    openKnownTab();
  }
  return { opened: true, exact: false };
}

export function normalizeAiActions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((action) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return [];
    const type = String(action.type || '').trim().toLowerCase();
    if (!AI_ACTION_TYPES.has(type)) return [];
    const id = safeOpaqueId(action.id, '');
    const title = clippedText(action.title, 180);
    const roomId = safeOpaqueId(action.roomId, '');
    if (
      !id
      || !title
      || seen.has(id)
      || action.requiresConfirmation !== true
      || (['create_task', 'invite_friends', 'create_event', 'update_event', 'set_reminder', 'complete_task'].includes(type) && !roomId)
    ) return [];
    seen.add(id);
    const status = AI_ACTION_STATUSES.has(action.status) ? action.status : 'proposed';
    const normalized = {
      id,
      type,
      title,
      description: clippedText(action.description, 500),
      expiresAt: Math.max(0, Number(action.expiresAt) || 0),
      requiresConfirmation: true,
      status,
      ...(roomId ? { roomId } : {}),
    };
    const result = normalizeAiActionResult(type, action.result);
    if (status === 'confirmed' && result) normalized.result = result;
    return [normalized];
  }).slice(0, 6);
}

function normalizedInvitedNames(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    const name = clippedText(entry, 80);
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [name];
  }).slice(0, 20);
}

function normalizeAiActionResult(type, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (type === 'create_task') {
    const taskId = safeOpaqueId(value.taskId, '');
    const roomId = safeOpaqueId(value.roomId, '');
    return taskId && roomId ? { taskId, roomId } : null;
  }
  if (type === 'create_room') {
    const roomId = safeOpaqueId(value.roomId, '');
    const roomName = clippedText(value.roomName, 120);
    if (!roomId || !roomName) return null;
    return {
      roomId,
      roomName,
      shortId: safeOpaqueId(value.shortId, ''),
      inviteCode: safeOpaqueId(value.inviteCode, ''),
      invitedCount: Math.max(0, Math.min(20, Math.floor(Number(value.invitedCount) || 0))),
      invitedNames: normalizedInvitedNames(value.invitedNames),
    };
  }
  if (type === 'invite_friends') {
    const roomId = safeOpaqueId(value.roomId, '');
    if (!roomId) return null;
    return {
      roomId,
      roomName: clippedText(value.roomName, 120),
      inviteCode: safeOpaqueId(value.inviteCode, ''),
      invitedCount: Math.max(0, Math.min(20, Math.floor(Number(value.invitedCount) || 0))),
      invitedNames: normalizedInvitedNames(value.invitedNames),
    };
  }
  if (type === 'start_friend_call') {
    const threadId = String(value.threadId || '').trim();
    const targetUid = safeOpaqueId(value.targetUid, '');
    const targetName = clippedText(value.targetName, 120);
    const callIntentExpiresAt = Math.max(0, Math.floor(Number(value.callIntentExpiresAt) || 0));
    return SAFE_CALL_THREAD_ID.test(threadId) && targetUid && targetName && callIntentExpiresAt
      ? { threadId, targetUid, targetName, callIntentExpiresAt }
      : null;
  }
  if (type === 'create_event' || type === 'update_event') {
    const eventId = safeOpaqueId(value.eventId, '');
    const roomId = safeOpaqueId(value.roomId, '');
    if (!eventId || !roomId) return null;
    return {
      eventId,
      roomId,
      title: clippedText(value.title, 120),
      date: clippedText(value.date, 10),
      time: clippedText(value.time, 5),
    };
  }
  if (type === 'set_reminder') {
    const reminderId = safeOpaqueId(value.reminderId, '');
    const roomId = safeOpaqueId(value.roomId, '');
    const dueAt = Math.max(0, Math.floor(Number(value.dueAt) || 0));
    return reminderId && roomId && dueAt ? { reminderId, roomId, dueAt } : null;
  }
  if (type === 'complete_task') {
    const taskId = safeOpaqueId(value.taskId, '');
    const roomId = safeOpaqueId(value.roomId, '');
    const completedAt = Math.max(0, Math.floor(Number(value.completedAt) || 0));
    return taskId && roomId ? { taskId, roomId, completedAt } : null;
  }
  return null;
}

export function aiActionPresentation(value) {
  const type = typeof value === 'string' ? value : value?.type;
  const presentation = AI_ACTION_PRESENTATIONS[type];
  return presentation ? { ...presentation } : null;
}

export function aiActionSuccessMessage(value) {
  const action = normalizeAiActions([value])[0];
  if (!action) return '';
  const fallback = AI_ACTION_PRESENTATIONS[action.type].successMessage;
  if (action.type !== 'invite_friends' && action.type !== 'create_room') return fallback;
  const count = Number(action.result?.invitedCount || 0);
  if (!count) return action.type === 'create_room' ? fallback : 'No new friend invites were needed.';
  const names = action.result?.invitedNames || [];
  const people = names.length ? ` ${names.join(', ')}.` : '';
  const inviteSummary = `${count} friend${count === 1 ? '' : 's'} invited.${people}`;
  return action.type === 'create_room' ? `Room created. ${inviteSummary}` : inviteSummary;
}

export function confirmedAiActionFromResponse(response, expectedAction) {
  const expected = normalizeAiActions([expectedAction])[0];
  if (!expected) return null;
  const candidates = [response?.action, ...(Array.isArray(response?.actions) ? response.actions : [])];
  return normalizeAiActions(candidates).find((action) => (
    action.id === expected.id
    && action.type === expected.type
    && action.status === 'confirmed'
  )) || null;
}

function clickAiActionTab(target, documentTarget) {
  const button = documentTarget?.querySelector?.(`.room-tab[data-target="${target}"]`);
  button?.click?.();
  return Boolean(button);
}

async function openAiActionRoom(action, result, tabTarget, windowTarget, documentTarget) {
  const roomId = safeOpaqueId(result?.roomId || action?.roomId, '');
  if (!roomId) return { opened: false, reason: 'missing-room' };
  const roomName = clippedText(result?.roomName, 120)
    || (roomId === 'global' ? 'Global Chat' : `Room ${roomId.slice(0, 8)}`);
  const shortId = safeOpaqueId(result?.shortId, '') || (roomId === 'global' ? 'GLOBAL' : roomId.slice(0, 12));
  if (roomId !== safeOpaqueId(windowTarget?.activeRoomId, '')) {
    if (typeof windowTarget?.switchRoom !== 'function') {
      return { opened: false, reason: 'room-navigation-unavailable' };
    }
    await Promise.resolve(windowTarget.switchRoom(roomId, roomName, shortId));
  }
  const tabOpened = tabTarget ? clickAiActionTab(tabTarget, documentTarget) : false;
  return { opened: true, roomId, tabOpened };
}

export async function openAiActionContext(actionValue, confirmationResponse = null, {
  documentTarget = globalThis.document,
  now = Date.now(),
  windowTarget = globalThis.window,
} = {}) {
  const action = confirmationResponse
    ? confirmedAiActionFromResponse(confirmationResponse, actionValue)
    : normalizeAiActions([actionValue])[0];
  if (!action || action.status !== 'confirmed' || !action.result) return { opened: false, reason: 'unconfirmed' };

  if (action.type === 'create_task') {
    return openAiActionRoom(action, action.result, 'tasks', windowTarget, documentTarget);
  }
  if (action.type === 'create_room') {
    return openAiActionRoom(action, action.result, '', windowTarget, documentTarget);
  }
  if (action.type === 'invite_friends') {
    return openAiActionRoom(action, action.result, 'chat', windowTarget, documentTarget);
  }
  if (action.type === 'start_friend_call') {
    const expiresAt = Number(action.result.callIntentExpiresAt || 0);
    if (!expiresAt || expiresAt <= Number(now)) return { opened: false, reason: 'expired-call-intent' };
    if (typeof windowTarget?.startPrivateCallWithFriend !== 'function') {
      return { opened: false, reason: 'call-unavailable' };
    }
    const opened = await windowTarget.startPrivateCallWithFriend({
      threadId: action.result.threadId,
      targetUid: action.result.targetUid,
      targetName: action.result.targetName,
      callIntentExpiresAt: expiresAt,
    });
    return { opened: opened !== false, targetUid: action.result.targetUid };
  }
  if (action.type === 'create_event' || action.type === 'update_event') {
    return openAiActionRoom(action, action.result, 'events', windowTarget, documentTarget);
  }
  if (action.type === 'set_reminder') {
    return openAiActionRoom(action, action.result, 'events', windowTarget, documentTarget);
  }
  if (action.type === 'complete_task') {
    return openAiActionRoom(action, action.result, 'tasks', windowTarget, documentTarget);
  }
  return { opened: false, reason: 'unsupported-action' };
}

export function normalizeAiClarification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'clarification') return null;
  const question = boundedClarificationText(value.question, AI_CLARIFICATION_MAX_QUESTION_CHARS);
  if (
    !question
    || !Array.isArray(value.options)
    || value.options.length < AI_CLARIFICATION_MIN_OPTIONS
    || value.options.length > AI_CLARIFICATION_MAX_OPTIONS
  ) return null;

  const seenIds = new Set();
  const seenLabels = new Set();
  const options = [];
  for (let index = 0; index < value.options.length; index += 1) {
    const entry = value.options[index];
    const source = typeof entry === 'string' ? { label: entry } : entry;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const label = boundedClarificationText(source.label, AI_CLARIFICATION_MAX_OPTION_CHARS);
    const normalizedLabel = label.toLocaleLowerCase();
    const id = safeOpaqueId(source.id, `option-${index + 1}`);
    if (!label || seenIds.has(id) || seenLabels.has(normalizedLabel)) return null;
    seenIds.add(id);
    seenLabels.add(normalizedLabel);
    options.push({ id, label });
  }

  const selectedLabel = clippedText(value.selectedLabel, 80);
  const selected = options.find((option) => (
    option.id === safeOpaqueId(value.selectedOptionId, '')
    || option.label === selectedLabel
  ));
  const answered = value.status === 'answered' && Boolean(selected || selectedLabel);
  return {
    id: safeOpaqueId(value.id, '') || newAiUiId('clarification'),
    type: 'clarification',
    question,
    options,
    allowFreeText: true,
    status: answered ? 'answered' : 'pending',
    selectedOptionId: answered && selected ? selected.id : '',
    selectedLabel: answered ? (selected?.label || selectedLabel) : '',
  };
}

export function answerAiClarification(value, selectedValue, { freeText = false } = {}) {
  const clarification = normalizeAiClarification(value);
  if (!clarification || clarification.status === 'answered') return clarification;
  const id = safeOpaqueId(typeof selectedValue === 'object' ? selectedValue?.id : selectedValue, '');
  const label = clippedText(typeof selectedValue === 'object' ? selectedValue?.label : selectedValue, 80);
  const selected = clarification.options.find((option) => option.id === id || option.label === label);
  if (!selected && (!freeText || !clarification.allowFreeText || !label)) return clarification;
  return {
    ...clarification,
    status: 'answered',
    selectedOptionId: selected?.id || '',
    selectedLabel: selected?.label || label,
  };
}

export function latestPendingAiClarification(history) {
  const source = Array.isArray(history) ? history : [];
  let hasLaterUserMessage = false;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (message?.role === 'user') {
      hasLaterUserMessage = true;
      continue;
    }
    const interaction = normalizeAiClarification(message?.interaction);
    if (!hasLaterUserMessage && message?.role === 'assistant' && interaction?.status === 'pending') {
      return { messageId: message.id, message, interaction };
    }
  }
  return null;
}

export function resolveAiHistoryClarification(history, answer, { messageId = '', freeText = false } = {}) {
  const source = Array.isArray(history) ? history : [];
  const active = latestPendingAiClarification(source);
  if (!active || (messageId && active.messageId !== messageId)) return source;
  const interaction = answerAiClarification(active.interaction, answer, { freeText });
  if (interaction?.status !== 'answered') return source;
  return source.map((message) => (
    message.id === active.messageId ? { ...message, interaction } : message
  ));
}

export function normalizeAiMemory(value, fallback = {}) {
  const memory = value && typeof value === 'object' ? value : {};
  const scope = MEMORY_SCOPES.has(memory.scope) ? memory.scope : (fallback.scope || 'personal');
  return {
    id: safeOpaqueId(memory.id || fallback.id, ''),
    text: clippedText(memory.text || fallback.text, 600),
    scope,
    roomId: scope === 'room' ? safeOpaqueId(memory.roomId || fallback.roomId, '') : '',
    provenance: clippedText(memory.provenance || fallback.provenance || 'Saved explicitly by you', 120),
    createdAt: Math.max(0, Number(memory.createdAt || fallback.createdAt) || 0),
    expiresAt: Math.max(0, Number(memory.expiresAt || fallback.expiresAt) || 0),
  };
}

export function normalizeAiMemories(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    const memory = normalizeAiMemory(entry);
    if (!memory.id || !memory.text || (memory.scope === 'room' && !memory.roomId) || seen.has(memory.id)) return [];
    seen.add(memory.id);
    return [memory];
  }).slice(0, 80);
}

export function loadLocalAiMemories(storage = globalThis.localStorage) {
  try {
    return normalizeAiMemories(JSON.parse(storage?.getItem?.(LOCAL_AI_MEMORIES_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function saveLocalAiMemories(memories, storage = globalThis.localStorage) {
  const normalized = normalizeAiMemories(memories);
  try {
    storage?.setItem?.(LOCAL_AI_MEMORIES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Keep the in-memory result usable for this session.
  }
  return normalized;
}

export function createLocalAiMemory(input, storage = globalThis.localStorage) {
  const memory = normalizeAiMemory(input, {
    id: newAiUiId('memory'),
    createdAt: Date.now(),
    provenance: 'Saved explicitly by you',
  });
  if (!memory.text || (memory.scope === 'room' && !memory.roomId)) {
    throw new Error('Memory text and room scope are required.');
  }
  return {
    memory,
    memories: saveLocalAiMemories([memory, ...loadLocalAiMemories(storage)], storage),
  };
}

export function deleteLocalAiMemory(memoryId, storage = globalThis.localStorage) {
  const id = safeOpaqueId(memoryId, '');
  return saveLocalAiMemories(loadLocalAiMemories(storage).filter((memory) => memory.id !== id), storage);
}

export function updateLocalAiMemory(memoryId, input, storage = globalThis.localStorage) {
  const id = safeOpaqueId(memoryId, '');
  const current = loadLocalAiMemories(storage);
  const existing = current.find((memory) => memory.id === id);
  if (!existing) throw new Error('That memory could not be found.');
  const memory = normalizeAiMemory({ ...existing, ...input, id }, existing);
  if (!memory.text || (memory.scope === 'room' && !memory.roomId)) {
    throw new Error('Memory text and room scope are required.');
  }
  const duplicate = current.some((entry) => (
    entry.id !== id
    && entry.text.toLocaleLowerCase().replace(/\s+/g, ' ') === memory.text.toLocaleLowerCase().replace(/\s+/g, ' ')
  ));
  if (duplicate) throw new Error('Winston already has an equivalent approved memory.');
  return {
    memory,
    memories: saveLocalAiMemories(current.map((entry) => entry.id === id ? memory : entry), storage),
  };
}

export function relevantAiMemories(memories, roomId) {
  const safeRoomId = safeOpaqueId(roomId, '');
  const now = Date.now();
  return normalizeAiMemories(memories).filter((memory) => (
    (!memory.expiresAt || memory.expiresAt > now)
    && (memory.scope === 'personal' || memory.roomId === safeRoomId)
  ));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
}

export async function prepareAiImageAttachment(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose an image to attach.');
  const declaredType = String(file.type || '').toLowerCase() === 'image/jpg' ? 'image/jpeg' : String(file.type || '').toLowerCase();
  if (!IMAGE_TYPES.has(declaredType)) throw new Error('Winston supports JPEG, PNG, and WebP images.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_AI_IMAGE_SOURCE_BYTES) {
    throw new Error('Choose an image under 20 MB so it can be optimized safely.');
  }
  const optimized = await optimizeImageForUpload(file, {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.82,
    minBytesToReencode: 32 * 1024,
  });
  const optimizedType = String(optimized.type || declaredType).toLowerCase();
  const mimeType = optimizedType === 'image/jpg' ? 'image/jpeg' : optimizedType;
  if (!IMAGE_TYPES.has(mimeType)) throw new Error('The optimized image format is not supported.');
  if (!Number.isFinite(optimized.size) || optimized.size <= 0 || optimized.size > MAX_AI_IMAGE_BYTES) {
    throw new Error('Keep the image under 5 MB after optimization.');
  }
  const buffer = await optimized.arrayBuffer();
  let previewUrl = '';
  try {
    if (typeof URL?.createObjectURL === 'function') previewUrl = URL.createObjectURL(optimized);
  } catch {
    // A preview is optional; the validated base64 attachment can still be sent.
  }
  return {
    id: newAiUiId('image'),
    name: clippedText(optimized.name || file.name || 'image', 120),
    mimeType,
    image: arrayBufferToBase64(buffer),
    size: optimized.size,
    previewUrl,
  };
}

export function releaseAiImageAttachment(attachment) {
  if (!attachment?.previewUrl || typeof URL?.revokeObjectURL !== 'function') return;
  URL.revokeObjectURL(attachment.previewUrl);
}
