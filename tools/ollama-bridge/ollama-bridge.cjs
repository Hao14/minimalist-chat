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
const MODEL_ALLOWLIST = new Set(
  String(process.env.OLLAMA_BRIDGE_MODEL_ALLOWLIST || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
);

if (MANAGE_UPSTREAM) assertSafeManagedOllamaConfig(MANAGED_OLLAMA);

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
    return Array.isArray(saved) ? saved.slice(-240) : [];
  } catch {
    return [];
  }
}

let activityRows = loadActivityRows();

function saveActivityRows() {
  if (!ACTIVITY_FILE) return;
  mkdirSync(path.dirname(ACTIVITY_FILE), { recursive: true });
  writeFileSync(ACTIVITY_FILE, JSON.stringify(activityRows.slice(-240), null, 2), 'utf8');
}

function activityModel(body) {
  try { return String(JSON.parse(body.toString('utf8')).model || 'Unknown').slice(0, 80); } catch { return 'Unknown'; }
}

function recordActivity({ pathname, model, durationMs, status }) {
  activityRows.push({
    time: Date.now(),
    feature: pathname === '/api/chat' ? 'Chat completion' : 'Text or vision generation',
    model,
    durationMs: Math.max(0, Number(durationMs || 0)),
    result: status >= 200 && status < 400 ? 'success' : 'error',
  });
  activityRows = activityRows.slice(-240);
  try { saveActivityRows(); } catch (error) { console.error(`Could not save bridge activity: ${error.message}`); }
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

function stopOwnedOllama() {
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
    stopOwnedOllama();
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

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Minimalist-Ollama-Bridge': '1',
    'X-Content-Type-Options': 'nosniff',
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
  if (!body.length || !MODEL_ALLOWLIST.size) return;
  if (pathname !== '/api/chat' && pathname !== '/api/generate') return;

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
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
}

function applyKeepAlive(pathname, body) {
  if (!body.length || (pathname !== '/api/chat' && pathname !== '/api/generate')) return body;
  const payload = JSON.parse(body.toString('utf8'));
  if (payload.keep_alive == null) payload.keep_alive = controlState.mode === 'on' ? '-1' : `${controlState.idleMinutes}m`;
  return Buffer.from(JSON.stringify(payload));
}

async function controlPayload() {
  const models = await ollamaModels();
  return {
    ok: true,
    mode: controlState.mode,
    idleMinutes: controlState.idleMinutes,
    ollamaReady: models.length > 0 || await ollamaIsReady(),
    models,
    bridgeOwnedOllama: Boolean(ownedOllamaProcess && ownedOllamaProcess.exitCode === null),
    lastActivityAt,
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
  if (mode === 'off') stopOwnedOllama();
  if (mode === 'on') await ensureOllamaReady();
  if (mode === 'auto') scheduleIdleShutdown();
  return controlPayload();
}

async function proxyToOllama(req, res, pathname, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
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

    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
    res.writeHead(upstreamResponse.status, {
      'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
      'X-Minimalist-Ollama-Bridge': '1',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(responseBody);
    return upstreamResponse.status;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Ollama upstream timed out.');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
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

    if (!['/api/chat', '/api/generate', '/api/tags'].includes(pathname)) {
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

    let body = await readBody(req);
    validatePayload(pathname, body);
    await ensureOllamaReady();
    body = applyKeepAlive(pathname, body);
    lastActivityAt = new Date().toISOString();
    scheduleIdleShutdown();
    const inferenceStartedAt = Date.now();
    const model = activityModel(body);
    try {
      const status = await proxyToOllama(req, res, pathname, body);
      recordActivity({ pathname, model, durationMs: Date.now() - inferenceStartedAt, status });
    } catch (error) {
      recordActivity({ pathname, model, durationMs: Date.now() - inferenceStartedAt, status: Number(error.status || 500) });
      throw error;
    }
  } catch (error) {
    const status = Number(error.status || 502);
    sendJson(res, status, { error: error.message || 'Ollama bridge failed.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Protected Ollama bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`Forwarding to ${UPSTREAM}`);
  if (MODEL_ALLOWLIST.size) console.log(`Allowed models: ${Array.from(MODEL_ALLOWLIST).join(', ')}`);
  if (MANAGE_UPSTREAM) console.log(`AI mode: ${controlState.mode}; auto idle shutdown: ${controlState.idleMinutes} minutes.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearTimeout(idleShutdownTimer);
    stopOwnedOllama();
    server.close(() => process.exit(0));
  });
}
