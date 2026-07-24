const SAFE_ID = /^[A-Za-z0-9_-]{1,180}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CONTEXT_STORAGE_PREFIX = 'minimalist.winston.context-selection.v1';
const PLAN_STORAGE_PREFIX = 'minimalist.winston.plans.v1';
const PLAN_STORAGE_VERSION = 1;
const MAX_STORED_PLANS = 12;
const MAX_PLAN_STEPS = 12;
const MAX_PLAN_STORAGE_CHARS = 96_000;
const MAX_ATTACHMENT_COUNT = 6;
const MAX_IMAGE_COUNT = 4;
const MAX_ATTACHMENT_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 60_000;
const MAX_ATTACHMENT_SEGMENTS = 40;

const CONTEXT_LIMITS = Object.freeze({
  rooms: 8,
  documents: 12,
  people: 12,
});

const PLAN_STATUSES = new Set([
  'pending',
  'awaiting_confirmation',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

const PLAN_STEP_STATUSES = new Set([
  'pending',
  'awaiting_confirmation',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'undone',
  'skipped',
]);

export const WINSTON_PLAN_COMMANDS = Object.freeze([
  'confirm-step',
  'complete-step',
  'skip-step',
  'pause',
  'resume',
  'retry',
  'cancel',
  'undo',
]);

const PLAN_COMMAND_SET = new Set(WINSTON_PLAN_COMMANDS);

const MIME_ALIASES = Object.freeze({
  'image/jpg': 'image/jpeg',
  'text/x-markdown': 'text/markdown',
  'text/md': 'text/markdown',
  'audio/x-wav': 'audio/wav',
  'application/x-pdf': 'application/pdf',
});

const FILE_TYPES = Object.freeze({
  'image/jpeg': Object.freeze({ kind: 'image', maxBytes: 20 * 1024 * 1024, citationUnit: 'image' }),
  'image/png': Object.freeze({ kind: 'image', maxBytes: 20 * 1024 * 1024, citationUnit: 'image' }),
  'image/webp': Object.freeze({ kind: 'image', maxBytes: 20 * 1024 * 1024, citationUnit: 'image' }),
  'application/pdf': Object.freeze({ kind: 'document', maxBytes: 8 * 1024 * 1024, citationUnit: 'page' }),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': Object.freeze({
    kind: 'document',
    maxBytes: 8 * 1024 * 1024,
    citationUnit: 'page',
  }),
  'text/plain': Object.freeze({ kind: 'text', maxBytes: 1024 * 1024, citationUnit: 'line' }),
  'text/markdown': Object.freeze({ kind: 'text', maxBytes: 1024 * 1024, citationUnit: 'line' }),
  'text/csv': Object.freeze({ kind: 'text', maxBytes: 1024 * 1024, citationUnit: 'row' }),
  'audio/mpeg': Object.freeze({ kind: 'audio', maxBytes: 6 * 1024 * 1024, citationUnit: 'timestamp' }),
  'audio/wav': Object.freeze({ kind: 'audio', maxBytes: 6 * 1024 * 1024, citationUnit: 'timestamp' }),
  'audio/mp4': Object.freeze({ kind: 'audio', maxBytes: 6 * 1024 * 1024, citationUnit: 'timestamp' }),
  'audio/webm': Object.freeze({ kind: 'audio', maxBytes: 6 * 1024 * 1024, citationUnit: 'timestamp' }),
  'audio/ogg': Object.freeze({ kind: 'audio', maxBytes: 6 * 1024 * 1024, citationUnit: 'timestamp' }),
});

const EXTENSION_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
});

export const WINSTON_ATTACHMENT_ACCEPT = Object.freeze(Object.keys(FILE_TYPES));
export const WINSTON_ATTACHMENT_LIMITS = Object.freeze({
  count: MAX_ATTACHMENT_COUNT,
  images: MAX_IMAGE_COUNT,
  totalBytes: MAX_ATTACHMENT_TOTAL_BYTES,
  extractedTextChars: MAX_EXTRACTED_TEXT_CHARS,
});

function compact(value, limit = 600) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function safeId(value, fallback = '') {
  const text = String(value || '').trim();
  return SAFE_ID.test(text) ? text : fallback;
}

function localId(prefix) {
  try {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Sandboxed webviews can expose crypto without randomUUID access.
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function storageOwner() {
  return safeId(globalThis.window?.currentUser?.uid, 'local');
}

function storageKey(prefix, suffix = '') {
  return `${prefix}:${storageOwner()}${suffix ? `:${safeId(suffix, 'global')}` : ''}`;
}

function readStorage(storage, key, fallback) {
  try {
    const value = JSON.parse(storage?.getItem?.(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(storage, key, value) {
  try {
    storage?.setItem?.(key, JSON.stringify(value));
  } catch {
    // Current in-memory state stays usable when storage is unavailable.
  }
  return value;
}

function uniqueIds(value, limit) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => safeId(entry))
    .filter(Boolean))]
    .slice(0, limit);
}

function validDateOnly(value) {
  const text = String(value || '').trim();
  if (!DATE_ONLY.test(text)) return '';
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text ? text : '';
}

function normalizedDateRange(value) {
  const from = validDateOnly(value?.from);
  const to = validDateOnly(value?.to);
  if (!from || !to || from > to) return null;
  const span = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
  return span <= 730 ? { from, to } : null;
}

export function normalizeWinstonContextSelection(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    roomIds: uniqueIds(source.roomIds, CONTEXT_LIMITS.rooms),
    documentIds: uniqueIds(source.documentIds, CONTEXT_LIMITS.documents),
    personIds: uniqueIds(source.personIds, CONTEXT_LIMITS.people),
    dateRange: normalizedDateRange(source.dateRange),
    includeCurrentRoom: source.includeCurrentRoom !== false,
    includeMemories: source.includeMemories !== false,
    includeFullHistory: source.includeFullHistory === true,
  };
}

export function loadWinstonContextSelection(roomId = 'global', storage = globalThis.localStorage) {
  return normalizeWinstonContextSelection(
    readStorage(storage, storageKey(CONTEXT_STORAGE_PREFIX, roomId), {}),
  );
}

export function saveWinstonContextSelection(value, roomId = 'global', storage = globalThis.localStorage) {
  return writeStorage(
    storage,
    storageKey(CONTEXT_STORAGE_PREFIX, roomId),
    normalizeWinstonContextSelection(value),
  );
}

function normalizeContextOption(entry, fallbackKind) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const id = safeId(source.id || source.uid || source.roomId || source.documentId);
  const label = compact(source.label || source.name || source.title || source.displayName, 120);
  if (!id || !label) return null;
  return {
    id,
    label,
    kind: source.kind || fallbackKind,
    detail: compact(source.detail || source.description || source.email || source.subtitle, 160),
  };
}

export function normalizeWinstonContextOptions({ rooms, documents, people } = {}) {
  const normalizeList = (value, limit, kind) => {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).flatMap((entry) => {
      const option = normalizeContextOption(entry, kind);
      if (!option || seen.has(option.id)) return [];
      seen.add(option.id);
      return [option];
    }).slice(0, limit * 4);
  };
  return {
    rooms: normalizeList(rooms, CONTEXT_LIMITS.rooms, 'room'),
    documents: normalizeList(documents, CONTEXT_LIMITS.documents, 'document'),
    people: normalizeList(people, CONTEXT_LIMITS.people, 'person'),
  };
}

export function winstonContextSelectionPreview(value, optionsValue = {}) {
  const selection = normalizeWinstonContextSelection(value);
  const options = normalizeWinstonContextOptions(optionsValue);
  const labelMap = new Map(
    [...options.rooms, ...options.documents, ...options.people].map((entry) => [entry.id, entry.label]),
  );
  const chips = [];
  if (selection.includeCurrentRoom) chips.push({ id: 'current-room', kind: 'room', label: 'Current room' });
  if (selection.includeMemories) chips.push({ id: 'memories', kind: 'memory', label: 'Approved memories' });
  if (selection.includeFullHistory) chips.push({ id: 'full-history', kind: 'history', label: 'Indexed full history' });
  selection.roomIds.forEach((id) => chips.push({ id: `room-${id}`, kind: 'room', label: labelMap.get(id) || `Room ${id.slice(0, 8)}` }));
  selection.documentIds.forEach((id) => chips.push({ id: `document-${id}`, kind: 'document', label: labelMap.get(id) || `Document ${id.slice(0, 8)}` }));
  selection.personIds.forEach((id) => chips.push({ id: `person-${id}`, kind: 'person', label: labelMap.get(id) || `Person ${id.slice(0, 8)}` }));
  if (selection.dateRange) {
    chips.push({
      id: 'date-range',
      kind: 'date',
      label: `${selection.dateRange.from} to ${selection.dateRange.to}`,
    });
  }
  return chips.slice(0, 36);
}

function normalizePlanStep(value, index) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const title = compact(source.title || source.label || source.description, 180);
  if (!title) return null;
  const status = PLAN_STEP_STATUSES.has(source.status) ? source.status : 'awaiting_confirmation';
  return {
    id: safeId(source.id, `step-${index + 1}`),
    title,
    description: compact(source.description, 500),
    actionType: safeId(source.actionType || source.type, ''),
    actionId: safeId(source.actionId, ''),
    status,
    requiresConfirmation: source.requiresConfirmation === true,
    attempt: Math.max(0, Math.min(10, Math.floor(Number(source.attempt) || 0))),
    canUndo: (source.canUndo === true || source.undoSupported === true) && status === 'completed',
    undoExpiresAt: Math.max(0, Number(source.undoExpiresAt) || 0),
    resultSummary: compact(source.resultSummary || source.result?.summary, 500),
    error: compact(source.error || source.errorMessage, 360),
    createdAt: Math.max(0, Number(source.createdAt) || 0),
    startedAt: Math.max(0, Number(source.startedAt) || 0),
    completedAt: Math.max(0, Number(source.completedAt) || 0),
  };
}

function derivePlanStatus(steps, fallback = 'pending') {
  if (!steps.length) return PLAN_STATUSES.has(fallback) ? fallback : 'pending';
  if (steps.every((step) => ['completed', 'cancelled', 'undone', 'skipped'].includes(step.status))) {
    return steps.some((step) => step.status === 'completed') ? 'completed' : 'cancelled';
  }
  if (steps.some((step) => step.status === 'failed')) return 'failed';
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (steps.some((step) => step.status === 'paused')) return 'paused';
  if (steps.some((step) => step.status === 'awaiting_confirmation')) return 'awaiting_confirmation';
  return fallback === 'active' ? 'pending' : PLAN_STATUSES.has(fallback) ? fallback : 'pending';
}

export function normalizeWinstonPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .map(normalizePlanStep)
    .filter(Boolean)
    .slice(0, MAX_PLAN_STEPS);
  const id = safeId(value.id);
  if (!id || !steps.length) return null;
  return {
    id,
    title: compact(value.title || 'Winston plan', 180),
    summary: compact(value.summary, 600),
    status: derivePlanStatus(steps, value.status),
    currentStepId: safeId(value.currentStepId, ''),
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    createdAt: Math.max(0, Number(value.createdAt) || Date.now()),
    updatedAt: Math.max(0, Number(value.updatedAt) || Date.now()),
    steps,
  };
}

export function createWinstonPlan({ title = 'Winston plan', summary = '', steps = [] } = {}) {
  const now = Date.now();
  return normalizeWinstonPlan({
    id: localId('plan'),
    title,
    summary,
    status: 'awaiting_confirmation',
    createdAt: now,
    updatedAt: now,
    steps: steps.map((step, index) => ({
      id: safeId(step?.id, `step-${index + 1}`),
      ...step,
      status: step?.status || 'awaiting_confirmation',
      requiresConfirmation: step?.requiresConfirmation === true,
    })),
  });
}

export function normalizeWinstonPlans(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const plan = normalizeWinstonPlan(entry);
    if (!plan || seen.has(plan.id)) return [];
    seen.add(plan.id);
    return [plan];
  }).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_STORED_PLANS);
}

export function loadLocalWinstonPlans(storage = globalThis.localStorage) {
  const value = readStorage(storage, storageKey(PLAN_STORAGE_PREFIX), {});
  return normalizeWinstonPlans(value?.version === PLAN_STORAGE_VERSION ? value.plans : []);
}

export function saveLocalWinstonPlans(value, storage = globalThis.localStorage) {
  const plans = [];
  let usedChars = 0;
  normalizeWinstonPlans(value).forEach((plan) => {
    const size = JSON.stringify(plan).length;
    if (size > MAX_PLAN_STORAGE_CHARS || usedChars + size > MAX_PLAN_STORAGE_CHARS) return;
    plans.push(plan);
    usedChars += size;
  });
  writeStorage(storage, storageKey(PLAN_STORAGE_PREFIX), {
    version: PLAN_STORAGE_VERSION,
    savedAt: Date.now(),
    plans,
  });
  return plans;
}

export function saveLocalWinstonPlan(value, storage = globalThis.localStorage) {
  const plan = normalizeWinstonPlan(value);
  if (!plan) return loadLocalWinstonPlans(storage);
  return saveLocalWinstonPlans([
    plan,
    ...loadLocalWinstonPlans(storage).filter((entry) => entry.id !== plan.id),
  ], storage);
}

export function removeLocalWinstonPlan(planId, storage = globalThis.localStorage) {
  const id = safeId(planId);
  return saveLocalWinstonPlans(loadLocalWinstonPlans(storage).filter((plan) => plan.id !== id), storage);
}

export function buildWinstonPlanCommandPayload(planId, stepId, command) {
  const safePlanId = safeId(planId);
  const safeStepId = safeId(stepId);
  const safeCommand = PLAN_COMMAND_SET.has(command) ? command : '';
  if (!safePlanId || !safeStepId || !safeCommand) throw new Error('That Winston plan command is invalid.');
  return {
    action: 'plan-command',
    planId: safePlanId,
    stepId: safeStepId,
    command: safeCommand,
  };
}

export function applyWinstonPlanCommand(value, { stepId, command } = {}) {
  const plan = normalizeWinstonPlan(value);
  const id = safeId(stepId);
  if (!plan || !id || !PLAN_COMMAND_SET.has(command)) return plan;
  const now = Date.now();
  let changed = false;
  const steps = plan.steps.map((step) => {
    if (step.id !== id) return step;
    let status = step.status;
    if (command === 'confirm-step' && ['pending', 'awaiting_confirmation'].includes(status)) status = 'running';
    else if (command === 'complete-step' && !step.requiresConfirmation && ['pending', 'awaiting_confirmation', 'running', 'paused'].includes(status)) status = 'completed';
    else if (command === 'skip-step' && !['completed', 'cancelled', 'undone', 'skipped'].includes(status)) status = 'skipped';
    else if (command === 'pause' && status === 'running') status = 'paused';
    else if (command === 'resume' && status === 'paused') status = 'running';
    else if (command === 'retry' && ['failed', 'cancelled', 'undone'].includes(status)) {
      status = step.requiresConfirmation ? 'awaiting_confirmation' : 'running';
    } else if (command === 'cancel' && !['completed', 'cancelled', 'undone', 'skipped'].includes(status)) status = 'cancelled';
    else if (command === 'undo' && status === 'completed' && !step.requiresConfirmation && step.canUndo && (!step.undoExpiresAt || step.undoExpiresAt > now)) {
      status = step.requiresConfirmation ? 'awaiting_confirmation' : 'pending';
    }
    if (status === step.status) return step;
    changed = true;
    return {
      ...step,
      status,
      error: command === 'retry' ? '' : step.error,
      attempt: command === 'retry' ? Math.min(10, step.attempt + 1) : step.attempt,
      startedAt: status === 'running' ? now : step.startedAt,
      completedAt: ['completed', 'cancelled', 'skipped'].includes(status) ? now : 0,
      canUndo: status === 'completed' ? (!step.requiresConfirmation || step.canUndo) : false,
    };
  });
  if (!changed) return plan;
  return normalizeWinstonPlan({
    ...plan,
    steps,
    currentStepId: steps.find((step) => ['running', 'paused', 'awaiting_confirmation'].includes(step.status))?.id || '',
    updatedAt: now,
  });
}

export function resolveWinstonPlanCommand(value, response, commandInput) {
  const remote = normalizeWinstonPlan(response?.plan);
  if (remote) return remote;
  const plan = normalizeWinstonPlan(value);
  if (!plan) return null;
  const responseStep = response?.step;
  if (responseStep && safeId(responseStep.id) === safeId(commandInput?.stepId)) {
    return normalizeWinstonPlan({
      ...plan,
      revision: Math.max(plan.revision, Number(response?.revision) || 0),
      updatedAt: Date.now(),
      steps: plan.steps.map((step, index) => (
        step.id === responseStep.id ? normalizePlanStep({ ...step, ...responseStep }, index) : step
      )),
    });
  }
  return applyWinstonPlanCommand(plan, commandInput);
}

function normalizedFileName(value) {
  const text = [...String(value || 'attachment')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/[\\/]+/g, '-')
    .trim();
  return compact(text || 'attachment', 120);
}

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function resolveWinstonAttachmentType(file) {
  const declared = String(file?.type || '').split(';')[0].trim().toLowerCase();
  const mimeType = MIME_ALIASES[declared] || declared;
  if (FILE_TYPES[mimeType]) return { mimeType, ...FILE_TYPES[mimeType] };
  if (mimeType && mimeType !== 'application/octet-stream') return null;
  const inferred = EXTENSION_TYPES[fileExtension(file?.name)];
  return inferred ? { mimeType: inferred, ...FILE_TYPES[inferred] } : null;
}

function begins(bytes, values) {
  return values.every((value, index) => bytes[index] === value);
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function validSignature(bytes, mimeType) {
  if (mimeType === 'image/jpeg') return begins(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') return begins(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === 'image/webp') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
  if (mimeType === 'application/pdf') return ascii(bytes, 0, 5) === '%PDF-';
  if (mimeType.includes('wordprocessingml')) {
    return begins(bytes, [0x50, 0x4b, 0x03, 0x04])
      || begins(bytes, [0x50, 0x4b, 0x05, 0x06])
      || begins(bytes, [0x50, 0x4b, 0x07, 0x08]);
  }
  if (mimeType === 'audio/mpeg') {
    return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  if (mimeType === 'audio/wav') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
  if (mimeType === 'audio/ogg') return ascii(bytes, 0, 4) === 'OggS';
  if (mimeType === 'audio/webm') return begins(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (mimeType === 'audio/mp4') return ascii(bytes, 4, 4) === 'ftyp';
  return true;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
}

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Text attachments must use UTF-8 encoding.');
  }
}

function splitCsvRows(text) {
  const rows = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (char === '\n' && !quoted) {
      rows.push(text.slice(start, index));
      start = index + 1;
    }
  }
  rows.push(text.slice(start));
  return rows;
}

function textSegments(text, citationUnit) {
  const units = citationUnit === 'row' ? splitCsvRows(text) : text.split('\n');
  const groupSize = citationUnit === 'row' ? 12 : 20;
  const segments = [];
  for (let index = 0; index < units.length && segments.length < MAX_ATTACHMENT_SEGMENTS; index += groupSize) {
    const excerpt = units.slice(index, index + groupSize).join('\n').trim();
    if (!excerpt) continue;
    const end = Math.min(units.length, index + groupSize);
    const locator = citationUnit === 'row'
      ? { rowStart: index + 1, rowEnd: end }
      : { lineStart: index + 1, lineEnd: end };
    segments.push({
      id: `segment-${segments.length + 1}`,
      text: excerpt.slice(0, 2400),
      ...locator,
      locator,
    });
  }
  return segments;
}

function normalizeSegment(value, index, citationUnit) {
  const text = String(value?.text || '').trim().slice(0, 2400);
  if (!text) return null;
  const locator = {};
  if (citationUnit === 'row') {
    locator.rowStart = Math.max(1, Math.floor(Number(value?.locator?.rowStart) || 1));
    locator.rowEnd = Math.max(locator.rowStart, Math.floor(Number(value?.locator?.rowEnd) || locator.rowStart));
  } else if (citationUnit === 'line') {
    locator.lineStart = Math.max(1, Math.floor(Number(value?.locator?.lineStart) || 1));
    locator.lineEnd = Math.max(locator.lineStart, Math.floor(Number(value?.locator?.lineEnd) || locator.lineStart));
  } else if (citationUnit === 'page') {
    locator.page = Math.max(1, Math.floor(Number(value?.locator?.page) || 1));
  } else if (citationUnit === 'timestamp') {
    locator.startSeconds = Math.max(0, Number(value?.locator?.startSeconds) || 0);
    locator.endSeconds = Math.max(locator.startSeconds, Number(value?.locator?.endSeconds) || locator.startSeconds);
  }
  return {
    id: safeId(value?.id, `segment-${index + 1}`),
    text,
    ...locator,
    ...(Number.isFinite(locator.startSeconds) ? {
      startMs: Math.floor(locator.startSeconds * 1000),
      endMs: Math.floor(locator.endSeconds * 1000),
    } : {}),
    locator,
  };
}

export async function prepareWinstonAttachment(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose a file to attach.');
  const descriptor = resolveWinstonAttachmentType(file);
  if (!descriptor) {
    throw new Error('Winston supports PDF, DOCX, TXT, Markdown, CSV, MP3, WAV, M4A, WebM, OGG, JPEG, PNG, and WebP files.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > descriptor.maxBytes) {
    throw new Error(`${normalizedFileName(file.name)} is empty or exceeds the ${Math.round(descriptor.maxBytes / 1048576)} MB limit.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || !validSignature(bytes, descriptor.mimeType)) {
    throw new Error(`${normalizedFileName(file.name)} does not match its declared file type.`);
  }

  if (descriptor.kind === 'image') {
    const { prepareAiImageAttachment } = await import('./aiAgentUi.js');
    const image = await prepareAiImageAttachment(file);
    return {
      ...image,
      kind: 'image',
      citationUnit: 'image',
      extraction: { status: 'ready', segments: [] },
    };
  }

  const common = {
    id: localId('attachment'),
    name: normalizedFileName(file.name),
    mimeType: descriptor.mimeType,
    kind: descriptor.kind,
    size: bytes.length,
    citationUnit: descriptor.citationUnit,
  };

  if (descriptor.kind === 'text') {
    const decoded = decodeText(bytes).replace(/\r\n?/g, '\n');
    if (decoded.includes('\u0000')) throw new Error(`${common.name} contains binary data and cannot be read as text.`);
    const text = decoded.slice(0, MAX_EXTRACTED_TEXT_CHARS).trim();
    if (!text) throw new Error(`${common.name} does not contain readable text.`);
    return {
      ...common,
      text,
      extraction: {
        status: decoded.length > MAX_EXTRACTED_TEXT_CHARS ? 'truncated' : 'ready',
        segments: textSegments(text, descriptor.citationUnit),
      },
    };
  }

  if (descriptor.kind === 'audio') {
    return {
      ...common,
      data: bytesToBase64(bytes),
      extraction: { status: 'server-pending', segments: [] },
    };
  }

  const { extractWinstonDocumentText } = await import('./winstonDocumentExtractors.js');
  const extracted = await extractWinstonDocumentText(bytes, descriptor.mimeType);
  return {
    ...common,
    citationUnit: extracted.citationUnit,
    text: extracted.text,
    extraction: { status: extracted.status, segments: extracted.segments },
  };
}

export async function prepareWinstonAttachments(files, currentValue = []) {
  const current = serializeWinstonAttachments(currentValue);
  const incoming = Array.from(files || []).filter(Boolean);
  if (current.length + incoming.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Attach up to ${MAX_ATTACHMENT_COUNT} files at a time.`);
  }
  const prepared = [];
  try {
    for (const file of incoming) {
      const attachment = await prepareWinstonAttachment(file);
      const next = [...current, ...prepared, attachment];
      if (next.filter((entry) => entry.kind === 'image').length > MAX_IMAGE_COUNT) {
        throw new Error(`Attach up to ${MAX_IMAGE_COUNT} images at a time.`);
      }
      if (next.reduce((total, entry) => total + entry.size, 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
        throw new Error('Attachments must total 16 MB or less after image optimization.');
      }
      prepared.push(attachment);
    }
    return [...currentValue, ...prepared];
  } catch (error) {
    releaseWinstonAttachments(prepared);
    throw error;
  }
}

export function serializeWinstonAttachments(value) {
  const result = [];
  let totalBytes = 0;
  let imageCount = 0;
  for (const source of Array.isArray(value) ? value : []) {
    const descriptor = resolveWinstonAttachmentType({ name: source?.name, type: source?.mimeType });
    const id = safeId(source?.id);
    const size = Math.max(0, Math.floor(Number(source?.size) || 0));
    if (!descriptor || !id || !size || size > descriptor.maxBytes) continue;
    if (descriptor.kind === 'image') imageCount += 1;
    totalBytes += size;
    if (result.length >= MAX_ATTACHMENT_COUNT || imageCount > MAX_IMAGE_COUNT || totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) break;
    const extractionStatus = ['ready', 'truncated', 'server-pending', 'failed'].includes(source?.extraction?.status)
      ? source.extraction.status
      : descriptor.kind === 'image' ? 'ready' : 'server-pending';
    const segments = (Array.isArray(source?.extraction?.segments) ? source.extraction.segments : [])
      .map((segment, index) => normalizeSegment(segment, index, descriptor.citationUnit))
      .filter(Boolean)
      .slice(0, MAX_ATTACHMENT_SEGMENTS);
    const base = {
      id,
      name: normalizedFileName(source.name),
      mimeType: descriptor.mimeType,
      kind: descriptor.kind,
      size,
      citationUnit: descriptor.citationUnit,
      extraction: { status: extractionStatus, segments },
    };
    if (descriptor.kind === 'image') {
      const image = String(source.image || '').trim();
      if (!image || image.length > Math.ceil(5 * 1024 * 1024 * 4 / 3) + 8) continue;
      result.push({ ...base, image });
    } else if (descriptor.kind === 'text' || descriptor.kind === 'document') {
      const text = String(source.text || '').slice(0, MAX_EXTRACTED_TEXT_CHARS).trim();
      if (!text) continue;
      result.push({ ...base, text });
    } else if (descriptor.kind === 'audio') {
      const data = String(source.data || '').trim();
      if (!data || data.length > Math.ceil(descriptor.maxBytes * 4 / 3) + 8) continue;
      result.push({ ...base, data });
    }
  }
  return result;
}

export function buildWinstonAdvancedRequestFields({
  attachments = [],
  contextSelection = {},
} = {}) {
  const safeAttachments = serializeWinstonAttachments(attachments);
  const legacyImage = safeAttachments.length === 1 && safeAttachments[0].kind === 'image'
    ? safeAttachments[0]
    : null;
  return {
    contextSelection: normalizeWinstonContextSelection(contextSelection),
    ...(safeAttachments.length ? { attachments: safeAttachments } : {}),
    ...(legacyImage ? {
      attachment: {
        name: legacyImage.name,
        mimeType: legacyImage.mimeType,
        image: legacyImage.image,
      },
    } : {}),
  };
}

export function releaseWinstonAttachment(attachment) {
  if (!attachment?.previewUrl || typeof globalThis.URL?.revokeObjectURL !== 'function') return;
  try {
    globalThis.URL.revokeObjectURL(attachment.previewUrl);
  } catch {
    // Object URL cleanup is best effort.
  }
}

export function releaseWinstonAttachments(value) {
  (Array.isArray(value) ? value : []).forEach(releaseWinstonAttachment);
}

export function winstonAttachmentCitationLabel(attachment, locator = {}) {
  const name = normalizedFileName(attachment?.name);
  if (attachment?.citationUnit === 'page' && locator.page) return `${name} · page ${locator.page}`;
  if (attachment?.citationUnit === 'row' && locator.rowStart) {
    return `${name} · ${locator.rowStart === locator.rowEnd ? `row ${locator.rowStart}` : `rows ${locator.rowStart}–${locator.rowEnd}`}`;
  }
  if (attachment?.citationUnit === 'line' && locator.lineStart) {
    return `${name} · ${locator.lineStart === locator.lineEnd ? `line ${locator.lineStart}` : `lines ${locator.lineStart}–${locator.lineEnd}`}`;
  }
  if (attachment?.citationUnit === 'timestamp' && Number.isFinite(Number(locator.startSeconds))) {
    const seconds = Math.max(0, Math.floor(Number(locator.startSeconds)));
    return `${name} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return name;
}
