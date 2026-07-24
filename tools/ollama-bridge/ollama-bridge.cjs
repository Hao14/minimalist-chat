const http = require('node:http');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const {
  assertSafeManagedOllamaConfig,
  managedOllamaEnvironment,
  resolveManagedOllamaConfig,
} = require('./managed-ollama-config.cjs');

const PORT = Number(process.env.BRIDGE_PORT || 8790);
const MANAGED_OLLAMA = resolveManagedOllamaConfig(process.env);
const UPSTREAM = MANAGED_OLLAMA.upstream;
const TOKEN = String(process.env.OLLAMA_BRIDGE_TOKEN || '').trim();
const MAX_BODY_BYTES = Number(process.env.OLLAMA_BRIDGE_MAX_BODY_BYTES || 16 * 1024 * 1024);
const UPSTREAM_TIMEOUT_MS = Number(process.env.OLLAMA_BRIDGE_UPSTREAM_TIMEOUT_MS || 90000);
const MANAGE_UPSTREAM = String(process.env.OLLAMA_BRIDGE_MANAGE_UPSTREAM || 'false').toLowerCase() === 'true';
const DEFAULT_IDLE_SHUTDOWN_MS = Number(process.env.OLLAMA_BRIDGE_IDLE_SHUTDOWN_MS || 2 * 60 * 60 * 1000);
const CONTROL_FILE = String(process.env.OLLAMA_BRIDGE_CONTROL_FILE || '').trim();
const ACTIVITY_FILE = String(process.env.OLLAMA_BRIDGE_ACTIVITY_FILE || '').trim();
const CANONICAL_MODELS = Object.freeze({
  fast: 'qwen3:4b-instruct',
  smart: 'qwen3:14b',
  vision: 'qwen2.5vl:7b',
});
const MODEL_ALLOWLIST = new Set(
  String(process.env.OLLAMA_BRIDGE_MODEL_ALLOWLIST || Object.values(CANONICAL_MODELS).join(','))
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
);
const EMBEDDING_MODEL = String(process.env.OLLAMA_BRIDGE_EMBEDDING_MODEL || 'nomic-embed-text').trim();
const EMBEDDING_MODEL_ALLOWLIST = new Set(
  String(process.env.OLLAMA_BRIDGE_EMBEDDING_MODEL_ALLOWLIST || EMBEDDING_MODEL)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
);
const EMBEDDING_KEEP_ALIVE_MINUTES = positiveIntegerSetting(
  process.env.OLLAMA_BRIDGE_EMBEDDING_KEEP_ALIVE_MINUTES,
  10,
  'Embedding keep-alive minutes',
  120,
);
const EMBEDDING_MAX_BATCH = positiveIntegerSetting(
  process.env.OLLAMA_BRIDGE_EMBEDDING_MAX_BATCH,
  32,
  'Embedding batch size',
  64,
);
const EMBEDDING_MAX_TEXT_CHARS = positiveIntegerSetting(
  process.env.OLLAMA_BRIDGE_EMBEDDING_MAX_TEXT_CHARS,
  8000,
  'Embedding text characters',
  16000,
);
const EMBEDDING_MAX_TOTAL_CHARS = positiveIntegerSetting(
  process.env.OLLAMA_BRIDGE_EMBEDDING_MAX_TOTAL_CHARS,
  128000,
  'Embedding total characters',
  256000,
);
const EXECUTION_UNITS = positiveIntegerSetting(
  process.env.OLLAMA_BRIDGE_EXECUTION_UNITS,
  4,
  'Bridge execution units',
  32,
);
const EXECUTION_MAX_QUEUE = positiveIntegerSetting(
  process.env.OLLAMA_BRIDGE_EXECUTION_MAX_QUEUE,
  100,
  'Bridge execution queue',
  10_000,
);
const MODEL_EXECUTION_WEIGHTS = new Map([
  [CANONICAL_MODELS.fast, positiveIntegerSetting(process.env.OLLAMA_BRIDGE_FAST_WEIGHT, 1, 'Fast model weight', EXECUTION_UNITS)],
  [CANONICAL_MODELS.smart, positiveIntegerSetting(process.env.OLLAMA_BRIDGE_SMART_WEIGHT, 2, 'Smart model weight', EXECUTION_UNITS)],
  [CANONICAL_MODELS.vision, positiveIntegerSetting(process.env.OLLAMA_BRIDGE_VISION_WEIGHT, 4, 'Vision model weight', EXECUTION_UNITS)],
]);
const EMBEDDING_EXECUTION_WEIGHT = positiveIntegerSetting(
  process.env.OLLAMA_BRIDGE_EMBEDDING_WEIGHT,
  1,
  'Embedding model weight',
  EXECUTION_UNITS,
);
for (const model of EMBEDDING_MODEL_ALLOWLIST) MODEL_EXECUTION_WEIGHTS.set(model, EMBEDDING_EXECUTION_WEIGHT);

function positiveIntegerSetting(value, fallback, label, maximum) {
  const raw = String(value ?? '').trim();
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return parsed;
}

function bridgeError(message, status, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

class WeightedExecutionSemaphore {
  constructor(capacityUnits, maxQueuedRequests) {
    this.capacityUnits = capacityUnits;
    this.maxQueuedRequests = maxQueuedRequests;
    this.activeUnits = 0;
    this.activeRequests = 0;
    this.queue = [];
  }

  stats() {
    return {
      capacityUnits: this.capacityUnits,
      activeUnits: this.activeUnits,
      activeRequests: this.activeRequests,
      queuedRequests: this.queue.length,
      maxQueuedRequests: this.maxQueuedRequests,
    };
  }

  acquire(weight, { signal } = {}) {
    if (!Number.isInteger(weight) || weight < 1 || weight > this.capacityUnits) {
      return Promise.reject(bridgeError('Invalid bridge execution weight.', 500));
    }
    if (signal?.aborted) {
      return Promise.reject(bridgeError('AI request was cancelled before execution.', 499, 'BRIDGE_REQUEST_CANCELLED'));
    }
    if (this.queue.length === 0 && this.activeUnits + weight <= this.capacityUnits) {
      return Promise.resolve(this.activate(weight, 0));
    }
    if (this.queue.length >= this.maxQueuedRequests) {
      const error = bridgeError('The protected AI execution queue is full. Please retry shortly.', 429, 'BRIDGE_QUEUE_FULL');
      error.retryAfterSeconds = 1;
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const entry = {
        weight,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        signal,
        onAbort: null,
      };
      entry.onAbort = () => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(bridgeError('AI request was cancelled before execution.', 499, 'BRIDGE_REQUEST_CANCELLED'));
        this.drain();
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      this.queue.push(entry);
      this.drain();
    });
  }

  activate(weight, queueWaitMs) {
    this.activeUnits += weight;
    this.activeRequests += 1;
    let released = false;
    return {
      queueWaitMs: Math.max(0, queueWaitMs),
      release: () => {
        if (released) return;
        released = true;
        this.activeUnits = Math.max(0, this.activeUnits - weight);
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        this.drain();
      },
    };
  }

  drain() {
    while (this.queue.length > 0) {
      const entry = this.queue[0];
      if (this.activeUnits + entry.weight > this.capacityUnits) break;
      this.queue.shift();
      entry.signal?.removeEventListener('abort', entry.onAbort);
      entry.resolve(this.activate(entry.weight, Date.now() - entry.enqueuedAt));
    }
  }

  cancelQueued(error) {
    const queued = this.queue.splice(0);
    for (const entry of queued) {
      entry.signal?.removeEventListener('abort', entry.onAbort);
      entry.reject(error);
    }
  }
}

if (MODEL_ALLOWLIST.size !== Object.keys(CANONICAL_MODELS).length
  || Object.values(CANONICAL_MODELS).some((model) => !MODEL_ALLOWLIST.has(model))) {
  console.error(`OLLAMA_BRIDGE_MODEL_ALLOWLIST must contain exactly: ${Object.values(CANONICAL_MODELS).join(', ')}`);
  process.exit(1);
}
if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(EMBEDDING_MODEL)
  || !EMBEDDING_MODEL_ALLOWLIST.has(EMBEDDING_MODEL)
  || Array.from(EMBEDDING_MODEL_ALLOWLIST).some((model) => (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model) || MODEL_ALLOWLIST.has(model)
  ))) {
  console.error('OLLAMA_BRIDGE_EMBEDDING_MODEL must use a dedicated valid model from OLLAMA_BRIDGE_EMBEDDING_MODEL_ALLOWLIST.');
  process.exit(1);
}

if (MANAGE_UPSTREAM) assertSafeManagedOllamaConfig(MANAGED_OLLAMA);

const executionSemaphore = new WeightedExecutionSemaphore(EXECUTION_UNITS, EXECUTION_MAX_QUEUE);
let ownedOllamaProcess = null;
let ollamaStartPromise = null;
let idleShutdownTimer = null;
let lastActivityAt = null;

function loadControlState() {
  if (!CONTROL_FILE || !existsSync(CONTROL_FILE)) return { mode: 'auto', idleMinutes: Math.round(DEFAULT_IDLE_SHUTDOWN_MS / 60000) };
  try {
    const saved = JSON.parse(readFileSync(CONTROL_FILE, 'utf8'));
    return {
      mode: ['off', 'on', 'auto'].includes(saved.mode) ? saved.mode : 'auto',
      idleMinutes: Math.max(15, Math.min(720, Number(saved.idleMinutes) || Math.round(DEFAULT_IDLE_SHUTDOWN_MS / 60000))),
    };
  } catch {
    return { mode: 'auto', idleMinutes: Math.round(DEFAULT_IDLE_SHUTDOWN_MS / 60000) };
  }
}

let controlState = loadControlState();

function loadActivityRows() {
  if (!ACTIVITY_FILE || !existsSync(ACTIVITY_FILE)) return [];
  try {
    const saved = JSON.parse(readFileSync(ACTIVITY_FILE, 'utf8'));
    return Array.isArray(saved) ? saved.slice(-240).map(sanitizeActivityRow).filter(Boolean) : [];
  } catch {
    return [];
  }
}

let activityRows = [];

function saveActivityRows() {
  if (!ACTIVITY_FILE) return;
  mkdirSync(path.dirname(ACTIVITY_FILE), { recursive: true });
  writeFileSync(ACTIVITY_FILE, JSON.stringify(activityRows.slice(-240), null, 2), 'utf8');
}

function activityModel(payload) {
  return String(payload?.model || 'Unknown').slice(0, 80);
}

const OLLAMA_ACTIVITY_METRIC_KEYS = Object.freeze([
  'ollamaTotalDurationMs',
  'ollamaLoadDurationMs',
  'ollamaPromptEvalCount',
  'ollamaPromptEvalDurationMs',
  'ollamaPromptTokensPerSecond',
  'ollamaEvalCount',
  'ollamaEvalDurationMs',
  'ollamaEvalTokensPerSecond',
]);

const ACTIVITY_FEATURES = new Set(['Chat completion', 'Text or vision generation', 'Model preload', 'Semantic embedding']);
const ACTIVITY_MAX_MILLISECONDS = 24 * 60 * 60 * 1000;
const ACTIVITY_MAX_COUNT = 10_000_000;
const ACTIVITY_MAX_RATE = 1_000_000;

function boundedActivityNumber(value, maximum, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const bounded = Math.min(parsed, maximum);
  return integer ? Math.floor(bounded) : rounded(bounded);
}

function sanitizeActivityRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const status = boundedActivityNumber(row.status, 599, true);
  const sanitized = {
    time: boundedActivityNumber(row.time, Number.MAX_SAFE_INTEGER, true) || Date.now(),
    feature: ACTIVITY_FEATURES.has(row.feature) ? row.feature : 'Text or vision generation',
    model: String(row.model || 'Unknown').slice(0, 80),
    durationMs: boundedActivityNumber(row.durationMs, ACTIVITY_MAX_MILLISECONDS) || 0,
    queueWaitMs: boundedActivityNumber(row.queueWaitMs, ACTIVITY_MAX_MILLISECONDS) || 0,
    result: row.result === 'success' ? 'success' : 'error',
  };
  if (status >= 100) sanitized.status = status;
  for (const key of OLLAMA_ACTIVITY_METRIC_KEYS) {
    const maximum = key.endsWith('Count') ? ACTIVITY_MAX_COUNT
      : key.endsWith('TokensPerSecond') ? ACTIVITY_MAX_RATE
        : ACTIVITY_MAX_MILLISECONDS;
    const value = boundedActivityNumber(row[key], maximum, key.endsWith('Count'));
    if (value != null) sanitized[key] = value;
  }
  return sanitized;
}

activityRows = loadActivityRows();

function recordActivity({ pathname, model, durationMs, queueWaitMs = 0, status, ollamaMetrics = {} }) {
  const feature = pathname === '/api/chat' ? 'Chat completion'
    : pathname === '/api/preload' ? 'Model preload'
      : pathname === '/api/embed' ? 'Semantic embedding'
      : 'Text or vision generation';
  const row = sanitizeActivityRow({
    time: Date.now(),
    feature,
    model,
    durationMs: Math.max(0, Number(durationMs || 0)),
    queueWaitMs: Math.max(0, Number(queueWaitMs || 0)),
    status,
    result: status >= 200 && status < 400 ? 'success' : 'error',
    ...ollamaMetrics,
  });
  activityRows.push(row);
  activityRows = activityRows.slice(-240);
  try { saveActivityRows(); } catch (error) { console.error(`Could not save bridge activity: ${error.message}`); }
}

function rounded(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function ollamaPayloadMetrics(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const metric = {};
  const duration = (field, output) => {
    const nanoseconds = Number(payload[field]);
    if (Number.isFinite(nanoseconds) && nanoseconds >= 0) metric[output] = rounded(nanoseconds / 1_000_000);
  };
  const count = (field, output) => {
    const value = Number(payload[field]);
    if (Number.isFinite(value) && value >= 0) metric[output] = Math.floor(value);
  };

  duration('total_duration', 'ollamaTotalDurationMs');
  duration('load_duration', 'ollamaLoadDurationMs');
  count('prompt_eval_count', 'ollamaPromptEvalCount');
  duration('prompt_eval_duration', 'ollamaPromptEvalDurationMs');
  count('eval_count', 'ollamaEvalCount');
  duration('eval_duration', 'ollamaEvalDurationMs');

  const promptCount = Number(payload.prompt_eval_count);
  const promptDuration = Number(payload.prompt_eval_duration);
  if (Number.isFinite(promptCount) && promptCount >= 0 && Number.isFinite(promptDuration) && promptDuration > 0) {
    metric.ollamaPromptTokensPerSecond = rounded((promptCount * 1_000_000_000) / promptDuration);
  }
  const evalCount = Number(payload.eval_count);
  const evalDuration = Number(payload.eval_duration);
  if (Number.isFinite(evalCount) && evalCount >= 0 && Number.isFinite(evalDuration) && evalDuration > 0) {
    metric.ollamaEvalTokensPerSecond = rounded((evalCount * 1_000_000_000) / evalDuration);
  }
  return metric;
}

function ollamaResponseMetrics(responseBody, enabledForResponse) {
  if (!enabledForResponse || !responseBody.length) return {};
  try {
    return ollamaPayloadMetrics(JSON.parse(responseBody.toString('utf8')));
  } catch {
    return {};
  }
}

class OllamaStreamMetricAccumulator {
  constructor() {
    this.decoder = new TextDecoder();
    this.pending = '';
    this.metrics = {};
  }

  add(chunk) {
    this.pending += this.decoder.decode(chunk, { stream: true });
    this.consumeLines(false);
  }

  finish() {
    this.pending += this.decoder.decode();
    this.consumeLines(true);
    return this.metrics;
  }

  consumeLines(flush) {
    let newline;
    while ((newline = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      this.consumeLine(line);
    }
    if (flush) {
      this.consumeLine(this.pending.trim());
      this.pending = '';
    } else if (this.pending.length > 64 * 1024) {
      // Ollama normally emits small NDJSON events. Drop an anomalous oversized
      // line instead of retaining generated content in bridge memory.
      this.pending = '';
    }
  }

  consumeLine(line) {
    if (!line || line.length > 64 * 1024) return;
    try {
      const payload = JSON.parse(line);
      if (payload?.done === true) this.metrics = ollamaPayloadMetrics(payload);
    } catch {
      // Response bytes are still forwarded exactly; malformed metric events are ignored.
    }
  }
}

function saveControlState() {
  if (!CONTROL_FILE) return;
  mkdirSync(path.dirname(CONTROL_FILE), { recursive: true });
  writeFileSync(CONTROL_FILE, JSON.stringify(controlState, null, 2), 'utf8');
}

function idleShutdownMs() {
  return controlState.idleMinutes * 60 * 1000;
}

async function ollamaIsReady() {
  try {
    const response = await fetch(`${UPSTREAM}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ollamaModels() {
  try {
    const response = await fetch(`${UPSTREAM}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.models) ? payload.models.map((model) => String(model.name || model.model || '')).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function stopOwnedOllama({ force = false } = {}) {
  const scheduler = executionSemaphore.stats();
  if (!force && controlState.mode === 'auto' && (scheduler.activeRequests > 0 || scheduler.queuedRequests > 0)) {
    scheduleIdleShutdown();
    return;
  }
  const child = ownedOllamaProcess;
  ownedOllamaProcess = null;
  if (!child || child.exitCode !== null) return;
  console.log(`Stopping bridge-owned Ollama after ${controlState.idleMinutes} idle minute(s).`);
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    killer.on('error', (error) => console.error(`Could not stop bridge-owned Ollama: ${error.message}`));
  } else {
    try { child.kill('SIGTERM'); } catch (error) { console.error(`Could not stop bridge-owned Ollama: ${error.message}`); }
  }
}

function scheduleIdleShutdown() {
  clearTimeout(idleShutdownTimer);
  if (controlState.mode !== 'auto' || !ownedOllamaProcess || idleShutdownMs() <= 0) return;
  idleShutdownTimer = setTimeout(stopOwnedOllama, idleShutdownMs());
  idleShutdownTimer.unref?.();
}

function ollamaCommand() {
  const configured = String(process.env.OLLAMA_BRIDGE_OLLAMA_COMMAND || '').trim();
  if (configured) return configured;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const installed = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
    if (existsSync(installed)) return installed;
  }
  return 'ollama';
}

async function ensureOllamaReady() {
  if (await ollamaIsReady()) return;
  if (!MANAGE_UPSTREAM) {
    const error = new Error('Ollama is offline and on-demand startup is disabled.');
    error.status = 503;
    throw error;
  }
  if (ollamaStartPromise) return ollamaStartPromise;

  ollamaStartPromise = (async () => {
    console.log('Ollama is offline; starting it for this AI request.');
    const child = spawn(ollamaCommand(), ['serve'], {
      detached: false,
      env: managedOllamaEnvironment(process.env, MANAGED_OLLAMA),
      stdio: 'ignore',
      windowsHide: true,
    });
    ownedOllamaProcess = child;
    child.once('exit', () => {
      if (ownedOllamaProcess === child) ownedOllamaProcess = null;
      clearTimeout(idleShutdownTimer);
    });
    child.once('error', (error) => console.error(`Ollama start failed: ${error.message}`));

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await ollamaIsReady()) {
        scheduleIdleShutdown();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    stopOwnedOllama({ force: true });
    const error = new Error('Ollama did not become ready within 30 seconds.');
    error.status = 503;
    throw error;
  })().finally(() => { ollamaStartPromise = null; });

  return ollamaStartPromise;
}

if (!TOKEN) {
  console.error('Missing OLLAMA_BRIDGE_TOKEN. Refusing to expose the Ollama bridge.');
  process.exit(1);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Minimalist-Ollama-Bridge': '1',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(Object.assign(new Error(`Request too large. Maximum bridge body is ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB.`), { status: 413 }));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

function hasValidAuth(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function validatePayload(pathname, body) {
  if (pathname !== '/api/chat' && pathname !== '/api/generate') return null;

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    const error = new Error('Bridge only accepts valid JSON payloads.');
    error.status = 400;
    throw error;
  }

  const model = String(payload.model || '').trim();
  if (!MODEL_ALLOWLIST.has(model)) {
    const error = new Error(`Model "${model || 'unknown'}" is not allowed on this bridge.`);
    error.status = 403;
    throw error;
  }
  return payload;
}

function validatePreloadPayload(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw bridgeError('Model preload request must be valid JSON.', 400, 'BRIDGE_INVALID_PRELOAD');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw bridgeError('Model preload request must be a JSON object.', 400, 'BRIDGE_INVALID_PRELOAD');
  }
  const keys = Object.keys(payload);
  if (keys.some((key) => key !== 'model')) {
    throw bridgeError('Model preload only accepts the selected model.', 400, 'BRIDGE_INVALID_PRELOAD');
  }
  const model = String(payload.model || '').trim();
  if (!MODEL_ALLOWLIST.has(model)) {
    throw bridgeError(`Model "${model || 'unknown'}" is not allowed on this bridge.`, 403, 'BRIDGE_MODEL_NOT_ALLOWED');
  }
  return { model };
}

function validateEmbeddingPayload(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw bridgeError('Embedding request must be valid JSON.', 400, 'BRIDGE_INVALID_EMBEDDING');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw bridgeError('Embedding request must be a JSON object.', 400, 'BRIDGE_INVALID_EMBEDDING');
  }
  const keys = Object.keys(payload);
  if (keys.some((key) => !['model', 'input', 'truncate'].includes(key))) {
    throw bridgeError('Embedding requests only accept model, input, and truncate.', 400, 'BRIDGE_INVALID_EMBEDDING');
  }
  const model = String(payload.model || '').trim();
  if (!EMBEDDING_MODEL_ALLOWLIST.has(model)) {
    throw bridgeError(`Embedding model "${model || 'unknown'}" is not allowed on this bridge.`, 403, 'BRIDGE_MODEL_NOT_ALLOWED');
  }
  if (!Array.isArray(payload.input) || payload.input.length < 1 || payload.input.length > EMBEDDING_MAX_BATCH) {
    throw bridgeError(`Embedding input must contain 1 through ${EMBEDDING_MAX_BATCH} texts.`, 400, 'BRIDGE_INVALID_EMBEDDING');
  }
  let totalChars = 0;
  const input = payload.input.map((value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > EMBEDDING_MAX_TEXT_CHARS) {
      throw bridgeError(
        `Each embedding text must contain 1 through ${EMBEDDING_MAX_TEXT_CHARS} characters.`,
        400,
        'BRIDGE_INVALID_EMBEDDING',
      );
    }
    totalChars += value.length;
    return value;
  });
  if (totalChars > EMBEDDING_MAX_TOTAL_CHARS) {
    throw bridgeError(
      `Embedding input exceeds the ${EMBEDDING_MAX_TOTAL_CHARS} character batch limit.`,
      400,
      'BRIDGE_INVALID_EMBEDDING',
    );
  }
  if (payload.truncate !== undefined && payload.truncate !== true) {
    throw bridgeError('Embedding requests must allow safe input truncation.', 400, 'BRIDGE_INVALID_EMBEDDING');
  }
  return {
    model,
    input,
    truncate: true,
    keep_alive: `${EMBEDDING_KEEP_ALIVE_MINUTES}m`,
  };
}

function applyKeepAlive(pathname, body, payload = null) {
  if (!body.length || (pathname !== '/api/chat' && pathname !== '/api/generate')) return body;
  const requestPayload = payload || JSON.parse(body.toString('utf8'));
  if (requestPayload.keep_alive == null) requestPayload.keep_alive = keepAliveValue();
  return Buffer.from(JSON.stringify(requestPayload));
}

function executionWeight(model) {
  return MODEL_EXECUTION_WEIGHTS.get(model) || EXECUTION_UNITS;
}

function keepAliveValue() {
  return controlState.mode === 'on' ? '-1' : `${controlState.idleMinutes}m`;
}

async function controlPayload() {
  const models = await ollamaModels();
  const scheduler = executionSemaphore.stats();
  return {
    ok: true,
    mode: controlState.mode,
    idleMinutes: controlState.idleMinutes,
    ollamaReady: models.length > 0 || await ollamaIsReady(),
    models,
    bridgeOwnedOllama: Boolean(ownedOllamaProcess && ownedOllamaProcess.exitCode === null),
    lastActivityAt,
    scheduler: {
      ...scheduler,
      weights: {
        fast: MODEL_EXECUTION_WEIGHTS.get(CANONICAL_MODELS.fast),
        smart: MODEL_EXECUTION_WEIGHTS.get(CANONICAL_MODELS.smart),
        vision: MODEL_EXECUTION_WEIGHTS.get(CANONICAL_MODELS.vision),
      },
    },
    activity: activityRows.slice(-40).reverse(),
  };
}

async function updateControlMode(body) {
  let payload;
  try { payload = JSON.parse(body.toString('utf8') || '{}'); } catch {
    const error = new Error('Control request must be valid JSON.');
    error.status = 400;
    throw error;
  }
  const mode = String(payload.mode || '').toLowerCase();
  if (!['off', 'on', 'auto'].includes(mode)) {
    const error = new Error('AI mode must be off, on, or auto.');
    error.status = 400;
    throw error;
  }
  controlState = {
    mode,
    idleMinutes: Math.max(15, Math.min(720, Number(payload.idleMinutes) || controlState.idleMinutes)),
  };
  saveControlState();
  clearTimeout(idleShutdownTimer);
  if (mode === 'off') {
    executionSemaphore.cancelQueued(bridgeError('AI was switched off while this request was waiting.', 503, 'BRIDGE_AI_OFF'));
    stopOwnedOllama({ force: true });
  }
  if (mode === 'on') await ensureOllamaReady();
  if (mode === 'auto') scheduleIdleShutdown();
  return controlPayload();
}

function writeWithBackpressure(res, chunk, signal) {
  if (res.destroyed || res.writableEnded) {
    return Promise.reject(bridgeError('AI response client disconnected.', 499, 'BRIDGE_CLIENT_DISCONNECTED'));
  }
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onDrain = () => finish(resolve);
    const onClose = () => finish(() => reject(bridgeError('AI response client disconnected.', 499, 'BRIDGE_CLIENT_DISCONNECTED')));
    const onAbort = () => finish(() => reject(signal.reason || bridgeError('AI response was aborted.', 499, 'BRIDGE_REQUEST_CANCELLED')));
    res.once('drain', onDrain);
    res.once('close', onClose);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function proxyToOllama(req, res, pathname, body, { captureMetrics = false, streamResponse = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let clientDisconnected = false;
  const cancelUpstream = () => {
    if (res.writableEnded) return;
    clientDisconnected = true;
    controller.abort();
  };
  res.once('close', cancelUpstream);
  try {
    const upstreamResponse = await fetch(`${UPSTREAM}${pathname}`, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        Accept: req.headers.accept || 'application/json',
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      signal: controller.signal,
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
    res.writeHead(upstreamResponse.status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Minimalist-Ollama-Bridge': '1',
      'X-Content-Type-Options': 'nosniff',
    });

    if (!streamResponse) {
      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
      const metrics = ollamaResponseMetrics(
        responseBody,
        captureMetrics && contentType.toLowerCase().includes('application/json'),
      );
      res.end(responseBody);
      return { status: upstreamResponse.status, ollamaMetrics: metrics };
    }

    const accumulator = new OllamaStreamMetricAccumulator();
    if (upstreamResponse.body) {
      for await (const chunk of upstreamResponse.body) {
        const bytes = Buffer.from(chunk);
        accumulator.add(bytes);
        await writeWithBackpressure(res, bytes, controller.signal);
      }
    }
    res.end();
    return { status: upstreamResponse.status, ollamaMetrics: accumulator.finish() };
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (clientDisconnected) {
        throw bridgeError('AI response client disconnected.', 499, 'BRIDGE_CLIENT_DISCONNECTED');
      }
      throw bridgeError('Ollama upstream timed out.', 504, 'BRIDGE_UPSTREAM_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    res.off('close', cancelUpstream);
  }
}

async function preloadOllamaModel(model, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(`${UPSTREAM}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: '',
        stream: false,
        keep_alive: keepAliveValue(),
      }),
      signal: controller.signal,
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw bridgeError(`Ollama rejected the model preload (${response.status}).`, 502, 'BRIDGE_PRELOAD_REJECTED');
    }
    return {
      status: response.status,
      ollamaMetrics: ollamaResponseMetrics(responseBody, true),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (signal?.aborted) throw bridgeError('Model preload client disconnected.', 499, 'BRIDGE_CLIENT_DISCONNECTED');
      throw bridgeError('Ollama model preload timed out.', 504, 'BRIDGE_UPSTREAM_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

async function handleModelPreload(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Use POST for /api/preload.' });
    return;
  }
  if (controlState.mode === 'off') {
    sendJson(res, 503, { error: 'AI is manually switched off.' });
    return;
  }

  const { model } = validatePreloadPayload(await readBody(req));
  const requestController = new AbortController();
  const cancelRequest = () => {
    if (!res.writableEnded) requestController.abort();
  };
  res.once('close', cancelRequest);
  let lease;
  try {
    lease = await executionSemaphore.acquire(executionWeight(model), { signal: requestController.signal });
  } catch (error) {
    if (Number(error.status) !== 499) {
      recordActivity({ pathname: '/api/preload', model, durationMs: 0, status: Number(error.status || 500) });
    }
    throw error;
  }

  const startedAt = Date.now();
  try {
    if (controlState.mode === 'off') throw bridgeError('AI is manually switched off.', 503, 'BRIDGE_AI_OFF');
    lastActivityAt = new Date().toISOString();
    await ensureOllamaReady();
    if (requestController.signal.aborted) {
      throw bridgeError('Model preload client disconnected.', 499, 'BRIDGE_CLIENT_DISCONNECTED');
    }
    if (controlState.mode === 'off') throw bridgeError('AI is manually switched off.', 503, 'BRIDGE_AI_OFF');
    const result = await preloadOllamaModel(model, requestController.signal);
    recordActivity({
      pathname: '/api/preload',
      model,
      durationMs: Date.now() - startedAt,
      queueWaitMs: lease.queueWaitMs,
      status: result.status,
      ollamaMetrics: result.ollamaMetrics,
    });
    sendJson(res, 200, {
      ok: true,
      model,
      keepAlive: keepAliveValue(),
      route: 'local-preload',
      billable: false,
      loadDurationMs: result.ollamaMetrics.ollamaLoadDurationMs ?? null,
    });
  } catch (error) {
    recordActivity({
      pathname: '/api/preload',
      model,
      durationMs: Date.now() - startedAt,
      queueWaitMs: lease.queueWaitMs,
      status: Number(error.status || 500),
    });
    throw error;
  } finally {
    res.off('close', cancelRequest);
    lease.release();
    lastActivityAt = new Date().toISOString();
    scheduleIdleShutdown();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/health') {
      return sendJson(res, 200, { ok: true, upstream: UPSTREAM, modelsRestricted: MODEL_ALLOWLIST.size > 0 });
    }

    if (!hasValidAuth(req)) {
      return sendJson(res, 401, { error: 'Missing or invalid bridge token.' });
    }

    if (pathname === '/control/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Use GET for control status.' });
      return sendJson(res, 200, await controlPayload());
    }

    if (pathname === '/control/mode') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST to change AI mode.' });
      const body = await readBody(req);
      return sendJson(res, 200, await updateControlMode(body));
    }

    if (pathname === '/api/preload') {
      await handleModelPreload(req, res);
      return;
    }

    if (!['/api/chat', '/api/generate', '/api/embed', '/api/tags'].includes(pathname)) {
      return sendJson(res, 404, { error: 'This bridge only exposes approved Ollama API routes.' });
    }

    if (pathname === '/api/tags' && req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Use GET for /api/tags.' });
    }

    if (pathname !== '/api/tags' && req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Use POST for model requests.' });
    }

    if (controlState.mode === 'off') {
      return sendJson(res, 503, { error: 'AI is manually switched off.' });
    }

    if (pathname === '/api/tags') {
      await ensureOllamaReady();
      await proxyToOllama(req, res, pathname, Buffer.alloc(0));
      return;
    }

    let body = await readBody(req);
    const payload = pathname === '/api/embed'
      ? validateEmbeddingPayload(body)
      : validatePayload(pathname, body);
    if (pathname === '/api/embed') body = Buffer.from(JSON.stringify(payload));
    const model = activityModel(payload);
    const waitingController = new AbortController();
    const cancelWaitingRequest = () => {
      if (!res.writableEnded) waitingController.abort();
    };
    res.once('close', cancelWaitingRequest);
    let lease;
    try {
      lease = await executionSemaphore.acquire(executionWeight(model), { signal: waitingController.signal });
    } catch (error) {
      if (Number(error.status) !== 499) {
        recordActivity({ pathname, model, durationMs: 0, queueWaitMs: 0, status: Number(error.status || 500) });
      }
      throw error;
    } finally {
      res.off('close', cancelWaitingRequest);
    }

    const inferenceStartedAt = Date.now();
    try {
      if (controlState.mode === 'off') throw bridgeError('AI is manually switched off.', 503, 'BRIDGE_AI_OFF');
      lastActivityAt = new Date().toISOString();
      await ensureOllamaReady();
      if (controlState.mode === 'off') throw bridgeError('AI is manually switched off.', 503, 'BRIDGE_AI_OFF');
      body = applyKeepAlive(pathname, body, payload);
      const result = await proxyToOllama(req, res, pathname, body, {
        captureMetrics: pathname === '/api/embed' || payload?.stream === false,
        streamResponse: pathname !== '/api/embed' && payload?.stream !== false,
      });
      recordActivity({
        pathname,
        model,
        durationMs: Date.now() - inferenceStartedAt,
        queueWaitMs: lease.queueWaitMs,
        status: result.status,
        ollamaMetrics: result.ollamaMetrics,
      });
    } catch (error) {
      recordActivity({
        pathname,
        model,
        durationMs: Date.now() - inferenceStartedAt,
        queueWaitMs: lease.queueWaitMs,
        status: Number(error.status || 500),
      });
      throw error;
    } finally {
      lease.release();
      lastActivityAt = new Date().toISOString();
      scheduleIdleShutdown();
    }
  } catch (error) {
    const status = Number(error.status || 502);
    if (!res.headersSent && !res.destroyed) {
      const retryAfter = Math.max(0, Math.floor(Number(error.retryAfterSeconds) || 0));
      sendJson(
        res,
        status,
        { error: error.message || 'Ollama bridge failed.', code: error.code || null },
        retryAfter ? { 'Retry-After': String(retryAfter) } : {},
      );
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Protected Ollama bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`Forwarding to ${UPSTREAM}`);
  if (MODEL_ALLOWLIST.size) console.log(`Allowed models: ${Array.from(MODEL_ALLOWLIST).join(', ')}`);
  console.log(`Embedding model: ${EMBEDDING_MODEL}; keep-alive ${EMBEDDING_KEEP_ALIVE_MINUTES}m.`);
  console.log(`Execution scheduler: ${EXECUTION_UNITS} unit(s), queue limit ${EXECUTION_MAX_QUEUE}; weights Fast/Smart/Vision/Embedding ${MODEL_EXECUTION_WEIGHTS.get(CANONICAL_MODELS.fast)}/${MODEL_EXECUTION_WEIGHTS.get(CANONICAL_MODELS.smart)}/${MODEL_EXECUTION_WEIGHTS.get(CANONICAL_MODELS.vision)}/${EMBEDDING_EXECUTION_WEIGHT}.`);
  if (MANAGE_UPSTREAM) console.log(`AI mode: ${controlState.mode}; auto idle shutdown: ${controlState.idleMinutes} minutes.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearTimeout(idleShutdownTimer);
    executionSemaphore.cancelQueued(bridgeError('The protected AI bridge is shutting down.', 503, 'BRIDGE_SHUTDOWN'));
    stopOwnedOllama({ force: true });
    server.close(() => process.exit(0));
  });
}
