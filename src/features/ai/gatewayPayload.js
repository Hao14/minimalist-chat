import { normalizeAiModelProfile } from './modelProfiles.js';

const SAFE_OPAQUE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_TEXT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/webm',
]);
const MAX_GATEWAY_ATTACHMENTS = 6;
const MAX_EXTRACTED_FILE_CHARS = 60_000;
const MAX_ATTACHMENT_SEGMENTS = 40;
const MAX_AUDIO_BASE64_CHARS = 8_000_000;

function opaqueId(value) {
  const id = String(value || '').trim();
  return SAFE_OPAQUE_ID.test(id) ? id : '';
}

function normalizeRoutingPolicy(value) {
  return String(value || '').trim().toLowerCase() === 'local-only' ? 'local-only' : 'balanced';
}

function normalizeGatewayModelProfile(value) {
  return String(value || '').trim().toLowerCase() === 'auto'
    ? 'auto'
    : normalizeAiModelProfile(value);
}

function normalizeGatewayAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const mimeType = String(value.mimeType || '').trim().toLowerCase();
  const image = String(value.image || '').trim();
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType) || !image || image.startsWith('data:')) return null;
  return {
    name: String(value.name || 'image').trim().slice(0, 120),
    mimeType,
    image,
  };
}

function uniqueOpaqueIds(values, limit) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(opaqueId)
    .filter(Boolean))].slice(0, limit);
}

function normalizeIsoDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

export function normalizeGatewayContextSelection(value) {
  if (!value || typeof value !== 'object') return null;
  const roomIds = uniqueOpaqueIds(value.roomIds, 8);
  const documentIds = uniqueOpaqueIds(value.documentIds, 16);
  const personIds = uniqueOpaqueIds(value.personIds, 8);
  const from = normalizeIsoDate(value.dateRange?.from || value.dateRange?.start || value.dateRange?.startAt);
  const to = normalizeIsoDate(value.dateRange?.to || value.dateRange?.end || value.dateRange?.endAt);
  const sourceCaps = value.sourceCaps && typeof value.sourceCaps === 'object' && !Array.isArray(value.sourceCaps)
    ? Object.fromEntries(['message', 'task', 'document', 'event', 'memory'].flatMap((key) => {
      const amount = Number(value.sourceCaps[key]);
      return Number.isInteger(amount) && amount >= 0 ? [[key, Math.min(40, amount)]] : [];
    }))
    : null;
  const scope = ['current', 'selected', 'workspace'].includes(value.scope)
    ? value.scope
    : roomIds.length || documentIds.length || personIds.length || from || to
      ? 'selected'
      : 'current';
  return {
    scope,
    roomIds,
    documentIds,
    personIds,
    includeCurrentRoom: value.includeCurrentRoom !== false,
    includeMemories: value.includeMemories !== false,
    includeFullHistory: value.includeFullHistory === true,
    ...(from || to ? { dateRange: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } : {}),
    ...(sourceCaps && Object.keys(sourceCaps).length ? { sourceCaps } : {}),
  };
}

function normalizeAttachmentSegment(value) {
  if (!value || typeof value !== 'object') return null;
  const text = String(value.text || '').trim().slice(0, 4_000);
  if (!text) return null;
  const page = Number.isInteger(Number(value.page)) && Number(value.page) > 0
    ? Math.min(10_000, Number(value.page))
    : 0;
  const startMs = Number.isFinite(Number(value.startMs)) && Number(value.startMs) >= 0
    ? Math.min(86_400_000, Number(value.startMs))
    : -1;
  const endMs = Number.isFinite(Number(value.endMs)) && Number(value.endMs) >= startMs
    ? Math.min(86_400_000, Number(value.endMs))
    : -1;
  const rowStart = Number.isInteger(Number(value.rowStart)) && Number(value.rowStart) > 0
    ? Math.min(1_000_000, Number(value.rowStart))
    : 0;
  const rowEnd = rowStart && Number.isInteger(Number(value.rowEnd)) && Number(value.rowEnd) >= rowStart
    ? Math.min(1_000_000, Number(value.rowEnd))
    : rowStart;
  const lineStart = Number.isInteger(Number(value.lineStart)) && Number(value.lineStart) > 0
    ? Math.min(1_000_000, Number(value.lineStart))
    : 0;
  const lineEnd = lineStart && Number.isInteger(Number(value.lineEnd)) && Number(value.lineEnd) >= lineStart
    ? Math.min(1_000_000, Number(value.lineEnd))
    : lineStart;
  return {
    text,
    ...(page ? { page } : {}),
    ...(rowStart ? { rowStart, rowEnd } : {}),
    ...(lineStart ? { lineStart, lineEnd } : {}),
    ...(startMs >= 0 ? { startMs } : {}),
    ...(endMs >= 0 ? { endMs } : {}),
  };
}

function normalizeGatewayFileAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const mimeType = String(value.mimeType || '').trim().toLowerCase();
  const image = String(value.image || '').trim();
  const audio = String(value.audio || value.data || '').trim();
  const text = String(value.text || '').trim().slice(0, MAX_EXTRACTED_FILE_CHARS);
  const segments = (Array.isArray(value.extraction?.segments)
    ? value.extraction.segments
    : Array.isArray(value.segments) ? value.segments : [])
    .map(normalizeAttachmentSegment)
    .filter(Boolean)
    .slice(0, MAX_ATTACHMENT_SEGMENTS);
  let kind = '';
  if (SUPPORTED_IMAGE_TYPES.has(mimeType) && image && !image.startsWith('data:')) kind = 'image';
  else if (SUPPORTED_AUDIO_TYPES.has(mimeType) && audio && !audio.startsWith('data:') && audio.length <= MAX_AUDIO_BASE64_CHARS) kind = 'audio';
  else if (SUPPORTED_TEXT_TYPES.has(mimeType) && (text || segments.length)) kind = 'document';
  if (!kind) return null;
  const id = opaqueId(value.id);
  const size = Number.isFinite(Number(value.size))
    ? Math.max(0, Math.min(16 * 1024 * 1024, Math.round(Number(value.size))))
    : 0;
  return {
    ...(id ? { id } : {}),
    name: String(value.name || kind).trim().slice(0, 120),
    mimeType,
    kind,
    ...(size ? { size } : {}),
    ...(kind === 'image' ? { image } : {}),
    ...(kind === 'audio' ? { audio } : {}),
    ...(kind === 'document' && text ? { text } : {}),
    ...(segments.length ? { segments } : {}),
  };
}

export function normalizeGatewayAttachments(values) {
  const attachments = (Array.isArray(values) ? values : [])
    .map(normalizeGatewayFileAttachment)
    .filter(Boolean)
    .slice(0, MAX_GATEWAY_ATTACHMENTS);
  return attachments;
}

function normalizeVerificationMode(value) {
  return ['off', 'auto', 'strict'].includes(value) ? value : 'auto';
}

export function buildWinstonPlanCommandPayload(command, { planId = '', stepId = '' } = {}) {
  const safeCommand = ['pause', 'resume', 'retry', 'cancel', 'undo', 'confirm-step'].includes(command)
    ? command
    : 'resume';
  return {
    action: 'plan-command',
    command: safeCommand,
    planId: opaqueId(planId),
    ...(stepId ? { stepId: opaqueId(stepId) } : {}),
  };
}

export function buildAiGatewayStatusPayload(modelProfile, { wake = false, routingPolicy = 'balanced' } = {}) {
  return {
    action: 'status',
    modelProfile: normalizeGatewayModelProfile(modelProfile),
    routingPolicy: normalizeRoutingPolicy(routingPolicy),
    ...(wake === true ? { wake: true } : {}),
  };
}

export function buildAiGatewayQueueStatusPayload(jobId) {
  return { action: 'queue-status', jobId: String(jobId || '').trim() };
}

export function buildAiGatewayCancelPayload(jobId) {
  return { action: 'cancel-job', jobId: String(jobId || '').trim() };
}

export function buildAiGatewayActionPayload(action, actionId) {
  const safeAction = action === 'dismiss-action' ? 'dismiss-action' : 'confirm-action';
  return { action: safeAction, actionId: opaqueId(actionId) };
}

export function buildPersonalAiMemoryPayload(action, value = {}) {
  if (action === 'memory-list') return { action };
  if (action === 'memory-delete') {
    return { action, memoryId: opaqueId(value.memoryId) };
  }
  const scope = value.memory?.scope === 'room' ? 'room' : 'personal';
  return {
    action: action === 'memory-update' ? 'memory-update' : 'memory-create',
    ...(action === 'memory-update' ? { memoryId: opaqueId(value.memoryId) } : {}),
    memory: {
      text: String(value.memory?.text || '').trim().slice(0, 600),
      scope,
      ...(scope === 'room' ? { roomId: opaqueId(value.memory?.roomId) } : {}),
      provenance: String(value.memory?.provenance || 'Saved explicitly by you').trim().slice(0, 120),
      ...(Number(value.memory?.expiresAt) > 0 ? { expiresAt: Number(value.memory.expiresAt) } : {}),
    },
  };
}

export function buildAiGatewayChatPayload({
  channelId = 'general',
  messages = [],
  mode = 'room',
  modelProfile,
  requestId,
  requestMode = 'chat',
  routingPolicy = 'balanced',
  roomId = 'global',
  selectedRoomIds = [],
  targetUid = '',
  attachment = null,
  attachments = [],
  contextSelection = null,
  verificationMode = 'auto',
  planMode = false,
} = {}) {
  const safeMode = mode === 'personal' || mode === 'spotlight' || mode === 'briefing' ? mode : 'room';
  const safeRequestMode = requestMode === 'briefing' ? 'briefing' : 'chat';
  const safeAttachment = normalizeGatewayAttachment(attachment);
  const safeAttachments = normalizeGatewayAttachments(attachments);
  const safeContextSelection = normalizeGatewayContextSelection(contextSelection);
  const safeRoomIds = [...new Set((Array.isArray(selectedRoomIds) ? selectedRoomIds : [])
    .map(opaqueId)
    .filter(Boolean))].slice(0, 8);
  return {
    mode: safeRequestMode === 'briefing' ? 'briefing' : safeMode,
    roomId,
    channelId,
    messages,
    modelProfile: normalizeGatewayModelProfile(modelProfile),
    ...(safeMode === 'spotlight' && targetUid ? { targetUid } : {}),
    ...(safeRequestMode === 'briefing' ? { requestMode: 'briefing', selectedRoomIds: safeRoomIds } : {}),
    ...(safeAttachment ? { attachment: safeAttachment } : {}),
    ...(safeAttachments.length ? { attachments: safeAttachments } : {}),
    ...(safeContextSelection ? { contextSelection: safeContextSelection } : {}),
    verificationMode: normalizeVerificationMode(verificationMode),
    ...(planMode === true ? { planMode: true } : {}),
    routingPolicy: normalizeRoutingPolicy(routingPolicy),
    requestId,
  };
}
