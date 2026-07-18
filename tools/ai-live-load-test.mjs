import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const CONFIRMATION = 'I_ACCEPT_PROVIDER_USAGE';
const PROJECT_ID = String(process.env.FIREBASE_PROJECT || 'chat-app-356c1').trim();
const REGION = String(process.env.FIREBASE_FUNCTION_REGION || 'us-central1').trim();
const AUTH_HOST = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim();
const DATABASE_HOST = String(process.env.FIREBASE_DATABASE_EMULATOR_HOST || '').trim();
const FUNCTIONS_HOST = String(process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001').trim();
const STAGES = String(process.env.AI_LIVE_LOAD_STAGES || '100,200,400,1000')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isSafeInteger(value) && value > 0);
const SUBMIT_CONCURRENCY = Math.max(1, Math.min(200,
  Number.parseInt(process.env.AI_LIVE_LOAD_SUBMIT_CONCURRENCY || '120', 10) || 120));
const QUEUE_WORKER_CONCURRENCY = Math.max(1, Math.min(8,
  Number.parseInt(process.env.AI_LIVE_LOAD_QUEUE_WORKER_CONCURRENCY || '1', 10) || 1));
const SUBMIT_TIMEOUT_MS = Math.max(30_000,
  Number.parseInt(process.env.AI_LIVE_LOAD_SUBMIT_TIMEOUT_MS || '150000', 10) || 150_000);
const NO_PROGRESS_TIMEOUT_MS = Math.max(60_000,
  Number.parseInt(process.env.AI_LIVE_LOAD_NO_PROGRESS_MS || '300000', 10) || 300_000);
const STAGE_TIMEOUT_OVERRIDE_MS = Math.max(0,
  Number.parseInt(process.env.AI_LIVE_LOAD_STAGE_TIMEOUT_MS || '0', 10) || 0);
const PRO_FIVE_HOUR_BANANAS = 240;
const EXPECTED_BANANA_COST = 9;
const REQUESTS_PER_USER = Math.floor(PRO_FIVE_HOUR_BANANAS / EXPECTED_BANANA_COST);
const TOTAL_REQUESTS = STAGES.reduce((total, value) => total + value, 0);
const USER_COUNT = Math.max(1, Math.ceil(TOTAL_REQUESTS / REQUESTS_PER_USER));
const RUN_NONCE = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const RUN_ID = `live-ai-${RUN_NONCE}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = path.join(REPO_ROOT, 'artifacts', 'ai-live-load');
const REPORT_PATH = path.join(ARTIFACT_DIR, `${RUN_ID}.json`);
const FUNCTION_ORIGIN = String(process.env.AI_LIVE_LOAD_FUNCTION_ORIGIN
  || `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}`).replace(/\/$/, '');
const GATEWAY_URL = `${FUNCTION_ORIGIN}/aiGateway`;
const QUEUE_CONTROL_URL = `${FUNCTION_ORIGIN}/__load-test/queue-drain`;

function assertLocalEndpoint(label, value) {
  const candidate = value.includes('://') ? value : `http://${value}`;
  const url = new URL(candidate);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`${label} must point to a local emulator, received ${url.hostname || 'unknown'}.`);
  }
}

if (process.env.AI_LIVE_LOAD_CONFIRM !== CONFIRMATION) {
  throw new Error(`Live provider usage is disabled. Set AI_LIVE_LOAD_CONFIRM=${CONFIRMATION} explicitly.`);
}
if (!AUTH_HOST || !DATABASE_HOST) {
  throw new Error('Run this harness through the Firebase Auth and Realtime Database emulators together.');
}
if (!STAGES.length || STAGES.some((value) => value > 1_000)) {
  throw new Error('AI_LIVE_LOAD_STAGES must contain positive stage sizes no larger than 1000.');
}
assertLocalEndpoint('FIREBASE_AUTH_EMULATOR_HOST', AUTH_HOST);
assertLocalEndpoint('FIREBASE_DATABASE_EMULATOR_HOST', DATABASE_HOST);
assertLocalEndpoint('AI_LIVE_LOAD_FUNCTION_ORIGIN', FUNCTION_ORIGIN);

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: PROJECT_ID,
    databaseURL: `https://${PROJECT_ID}-default-rtdb.firebaseio.com`,
  });
}
const database = admin.database();

const report = {
  runId: RUN_ID,
  mode: String(process.env.AI_LIVE_LOAD_EXECUTION_MODE || 'local-firebase-emulators-real-ai-providers'),
  productionDataTouched: false,
  startedAt: new Date().toISOString(),
  requestedStages: STAGES,
  totalRequested: TOTAL_REQUESTS,
  userCount: USER_COUNT,
  expectedBananaCost: EXPECTED_BANANA_COST,
  submitConcurrency: SUBMIT_CONCURRENCY,
  queueWorkerConcurrency: QUEUE_WORKER_CONCURRENCY,
  exactProviderTokenUsageAvailable: false,
  stages: [],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function deterministicJobId(uid, requestId) {
  return crypto.createHash('sha256').update(uid).update('\0').update(requestId).digest('hex');
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function latencySummary(values) {
  const safe = values.filter((value) => Number.isFinite(value) && value >= 0);
  return {
    count: safe.length,
    p50Ms: percentile(safe, 0.50),
    p95Ms: percentile(safe, 0.95),
    p99Ms: percentile(safe, 0.99),
    maxMs: safe.length ? Math.max(...safe) : null,
  };
}

function increment(target, key, amount = 1) {
  const safeKey = String(key || 'unknown');
  target[safeKey] = Number(target[safeKey] || 0) + amount;
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        results[index] = { taskError: error?.message || String(error) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function parseResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json, text: text.slice(0, 500) };
}

async function authRequest(method, body) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/${method}?key=emulator-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const parsed = await parseResponse(response);
  if (!parsed.ok || !parsed.json?.idToken || !parsed.json?.localId) {
    throw new Error(`Auth emulator ${method} failed (${parsed.status}): ${parsed.json?.error?.message || parsed.text}`);
  }
  return parsed.json;
}

async function createUsers() {
  const password = `Load-${RUN_NONCE}-Aa1!`;
  const indexes = Array.from({ length: USER_COUNT }, (_, index) => index);
  const users = await mapLimit(indexes, 16, async (index) => {
    const email = `${RUN_ID}-${String(index).padStart(3, '0')}@example.invalid`;
    const auth = await authRequest('accounts:signUp', {
      email,
      password,
      returnSecureToken: true,
    });
    return {
      index,
      email,
      password,
      uid: auth.localId,
      idToken: auth.idToken,
    };
  });
  const failed = users.filter((user) => user?.taskError);
  if (failed.length) throw new Error(`Could not create ${failed.length} Auth emulator users.`);

  const updates = {};
  const now = Date.now();
  users.forEach((user) => {
    updates[`users/${user.uid}`] = {
      displayName: `AI Load ${String(user.index + 1).padStart(2, '0')}`,
      email: user.email,
      tier: 'pro',
      createdAt: now,
      updatedAt: now,
      isBanned: false,
      isMuted: false,
    };
  });
  await database.ref().update(updates);
  return users;
}

async function refreshUserTokens(users) {
  const refreshed = await mapLimit(users, 16, async (user) => {
    const auth = await authRequest('accounts:signInWithPassword', {
      email: user.email,
      password: user.password,
      returnSecureToken: true,
    });
    user.idToken = auth.idToken;
    return user;
  });
  const failed = refreshed.filter((user) => user?.taskError);
  if (failed.length) throw new Error(`Could not refresh ${failed.length} Auth emulator sessions.`);
}

async function postGateway(body, idToken, timeoutMs = SUBMIT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Gateway request timed out.')), timeoutMs);
  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return parseResponse(response);
  } finally {
    clearTimeout(timer);
  }
}

async function setQueueDrainPaused(paused) {
  const response = await fetch(QUEUE_CONTROL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  });
  const parsed = await parseResponse(response);
  if (!parsed.ok || parsed.json?.paused !== paused) {
    throw new Error(`Could not ${paused ? 'pause' : 'resume'} the local queue trigger (${parsed.status}).`);
  }
}

async function assertRouterReady(user) {
  const response = await postGateway({ action: 'status', modelProfile: 'fast' }, user.idToken, 45_000);
  const tiers = response.json?.routing?.tiers;
  const observed = Array.isArray(tiers)
    ? tiers.map(({ provider, capacity }) => ({ provider, capacity }))
    : [];
  const expected = [
    { provider: 'ollama-bridge', capacity: 10 },
    { provider: 'cloudflare-workers-ai', capacity: 40 },
    { provider: 'groq', capacity: 40 },
  ];
  if (!response.ok
    || response.json?.provider !== 'multi-provider-router'
    || response.json?.tier !== 'pro'
    || JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`Router preflight failed (${response.status}): ${JSON.stringify({
      provider: response.json?.provider,
      tier: response.json?.tier,
      routing: response.json?.routing,
      code: response.json?.code,
      error: response.json?.error,
    })}`);
  }
  return { provider: response.json.provider, model: response.json.model, tier: response.json.tier, tiers: observed };
}

function startHighWaterMonitor() {
  const state = {
    maxOutstandingReservations: 0,
    maxQueueDepth: 0,
    maxTotalProviderLeases: 0,
    maxProviderLeases: {
      'ollama-bridge': 0,
      'cloudflare-workers-ai': 0,
      groq: 0,
    },
  };
  const capacityRef = database.ref('ai_runtime/text_request_queue_v1/capacity/activeCount');
  const pendingRef = database.ref('ai_runtime/text_request_queue_v1/pending');
  const leasesRef = database.ref('ai_runtime/text_provider_slots_v1/leases');
  const onCapacity = (snapshot) => {
    state.maxOutstandingReservations = Math.max(state.maxOutstandingReservations, Number(snapshot.val() || 0));
  };
  const onPending = (snapshot) => {
    state.maxQueueDepth = Math.max(state.maxQueueDepth, snapshot.numChildren());
  };
  const onLeases = (snapshot) => {
    const counts = { 'ollama-bridge': 0, 'cloudflare-workers-ai': 0, groq: 0 };
    Object.values(snapshot.val() || {}).forEach((lease) => {
      if (Object.hasOwn(counts, lease?.provider)) counts[lease.provider] += 1;
    });
    Object.entries(counts).forEach(([provider, count]) => {
      state.maxProviderLeases[provider] = Math.max(state.maxProviderLeases[provider], count);
    });
    state.maxTotalProviderLeases = Math.max(state.maxTotalProviderLeases,
      Object.values(counts).reduce((total, count) => total + count, 0));
  };
  capacityRef.on('value', onCapacity);
  pendingRef.on('value', onPending);
  leasesRef.on('value', onLeases);
  return {
    state,
    stop() {
      capacityRef.off('value', onCapacity);
      pendingRef.off('value', onPending);
      leasesRef.off('value', onLeases);
    },
  };
}

async function submitRequest(spec) {
  const submittedAt = Date.now();
  const jobId = deterministicJobId(spec.user.uid, spec.requestId);
  try {
    const response = await postGateway({
      mode: 'room',
      roomId: 'global',
      channelId: 'general',
      messages: [{ role: 'user', content: `Reply only ${spec.expected}.` }],
      modelProfile: 'fast',
      requestId: spec.requestId,
    }, spec.user.idToken);
    const responseAt = Date.now();
    if (response.status === 200 && response.json?.reply) {
      const reply = String(response.json.reply);
      return {
        stage: spec.stage,
        sequence: spec.sequence,
        ownerIndex: spec.user.index,
        requestId: spec.requestId,
        jobId,
        expected: spec.expected,
        httpStatus: response.status,
        admission: 'direct',
        status: 'completed',
        provider: response.json.provider || 'unknown',
        model: response.json.model || '',
        attempts: 1,
        submittedAt,
        responseAt,
        finishedAt: responseAt,
        submissionLatencyMs: responseAt - submittedAt,
        endToEndMs: responseAt - submittedAt,
        replyLength: reply.length,
        replyHash: hashText(reply),
        markerMatched: reply.trim() === spec.expected || reply.includes(spec.expected),
        approximateOutputTokens: Math.ceil(reply.length / 4),
        _uid: spec.user.uid,
      };
    }
    if (response.status === 202 && response.json?.jobId === jobId) {
      return {
        stage: spec.stage,
        sequence: spec.sequence,
        ownerIndex: spec.user.index,
        requestId: spec.requestId,
        jobId,
        expected: spec.expected,
        httpStatus: response.status,
        admission: 'queued',
        status: response.json.status || 'queued',
        attempts: Number(response.json.attempts || 0),
        submittedAt,
        responseAt,
        submissionLatencyMs: responseAt - submittedAt,
        _uid: spec.user.uid,
      };
    }
    return {
      stage: spec.stage,
      sequence: spec.sequence,
      ownerIndex: spec.user.index,
      requestId: spec.requestId,
      jobId,
      expected: spec.expected,
      httpStatus: response.status,
      admission: 'rejected',
      status: 'failed',
      submittedAt,
      responseAt,
      submissionLatencyMs: responseAt - submittedAt,
      errorCode: response.json?.code || `HTTP_${response.status}`,
      errorMessage: String(response.json?.error || response.text || 'Gateway rejected the request.').slice(0, 300),
      _uid: spec.user.uid,
    };
  } catch (error) {
    const responseAt = Date.now();
    return {
      stage: spec.stage,
      sequence: spec.sequence,
      ownerIndex: spec.user.index,
      requestId: spec.requestId,
      jobId,
      expected: spec.expected,
      httpStatus: 0,
      admission: 'uncertain',
      status: 'unknown',
      submittedAt,
      responseAt,
      submissionLatencyMs: responseAt - submittedAt,
      errorCode: error?.name || 'GATEWAY_TRANSPORT_ERROR',
      errorMessage: String(error?.message || error).slice(0, 300),
      _uid: spec.user.uid,
    };
  }
}

function applyTerminalStatus(record, status) {
  record.status = status.status;
  record.attempts = Number(status.attempts || record.attempts || 0);
  record.finishedAt = Number(status.finishedAt || status.updatedAt || Date.now());
  record.endToEndMs = Math.max(0, record.finishedAt - record.submittedAt);
  if (status.status === 'completed') {
    const reply = String(status.reply || '');
    record.provider = status.provider || 'unknown';
    record.model = status.model || '';
    record.replyLength = reply.length;
    record.replyHash = hashText(reply);
    record.markerMatched = reply.trim() === record.expected || reply.includes(record.expected);
    record.approximateOutputTokens = Math.ceil(reply.length / 4);
  } else {
    record.errorCode = status.error?.code || `AI_QUEUE_${String(status.status || 'FAILED').toUpperCase()}`;
    record.errorMessage = String(status.error?.message || 'Queued request did not complete.').slice(0, 300);
  }
}

function stageTimeoutMs(size) {
  if (STAGE_TIMEOUT_OVERRIDE_MS) return STAGE_TIMEOUT_OVERRIDE_MS;
  return Math.max(15 * 60_000, Math.min(60 * 60_000, size * 3_000));
}

async function waitForQueuedRecords(records, size) {
  const pending = new Map(records
    .filter((record) => record.admission === 'queued' || record.admission === 'uncertain')
    .map((record) => [record.jobId, record]));
  if (!pending.size) return { timedOut: false, noProgress: false };
  const deadline = Date.now() + stageTimeoutMs(size);
  let lastProgressAt = Date.now();
  let lastProgressLogAt = 0;
  let lastRemaining = pending.size;
  while (pending.size && Date.now() < deadline) {
    const snapshot = await database.ref('ai_queue_status').once('value');
    const statuses = snapshot.val() || {};
    for (const [jobId, record] of pending) {
      const status = statuses?.[record._uid]?.[jobId];
      if (!status || !['completed', 'failed', 'cancelled'].includes(status.status)) continue;
      applyTerminalStatus(record, status);
      pending.delete(jobId);
    }
    if (pending.size < lastRemaining) {
      lastRemaining = pending.size;
      lastProgressAt = Date.now();
    }
    if (Date.now() - lastProgressLogAt >= 10_000) {
      const completed = records.filter((record) => record.status === 'completed').length;
      const failed = records.filter((record) => ['failed', 'cancelled'].includes(record.status)).length;
      console.log(JSON.stringify({ event: 'stage-progress', stage: size, completed, failed, remaining: pending.size }));
      lastProgressLogAt = Date.now();
    }
    if (pending.size && Date.now() - lastProgressAt >= NO_PROGRESS_TIMEOUT_MS) {
      return { timedOut: false, noProgress: true, remaining: [...pending.keys()] };
    }
    if (pending.size) await sleep(2_000);
  }

  if (pending.size) {
    const canonical = (await database.ref('ai_runtime/text_request_queue_v1/jobs').once('value')).val() || {};
    for (const [jobId, record] of pending) {
      const job = canonical[jobId];
      if (!job || !['completed', 'failed', 'cancelled'].includes(job.status)) continue;
      applyTerminalStatus(record, {
        ...job,
        ...(job.result || {}),
      });
      pending.delete(jobId);
    }
  }
  return { timedOut: pending.size > 0, noProgress: false, remaining: [...pending.keys()] };
}

async function waitForDrain(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let finalState = null;
  while (Date.now() < deadline) {
    const [capacity, pending, leases, wakes] = await Promise.all([
      database.ref('ai_runtime/text_request_queue_v1/capacity/activeCount').once('value'),
      database.ref('ai_runtime/text_request_queue_v1/pending').once('value'),
      database.ref('ai_runtime/text_provider_slots_v1/leases').once('value'),
      database.ref('ai_runtime/text_request_queue_v1/wake').once('value'),
    ]);
    finalState = {
      activeReservations: Number(capacity.val() || 0),
      pendingJobs: pending.numChildren(),
      providerLeases: leases.numChildren(),
      wakeSlots: wakes.numChildren(),
    };
    if (
      !finalState.activeReservations
      && !finalState.pendingJobs
      && !finalState.providerLeases
      && !finalState.wakeSlots
    ) return finalState;
    await sleep(1_000);
  }
  return finalState;
}

function publicRecord(record) {
  return {
    stage: record.stage,
    sequence: record.sequence,
    ownerIndex: record.ownerIndex,
    requestId: record.requestId,
    jobId: record.jobId,
    httpStatus: record.httpStatus,
    admission: record.admission,
    status: record.status,
    provider: record.provider || null,
    model: record.model || null,
    attempts: Number(record.attempts || 0),
    submittedAt: record.submittedAt,
    responseAt: record.responseAt,
    finishedAt: record.finishedAt || null,
    submissionLatencyMs: record.submissionLatencyMs,
    endToEndMs: record.endToEndMs ?? null,
    queueWaitMs: record.queueWaitMs ?? null,
    replyLength: record.replyLength ?? null,
    replyHash: record.replyHash || null,
    markerMatched: record.markerMatched === true,
    approximateOutputTokens: record.approximateOutputTokens ?? null,
    errorCode: record.errorCode || null,
    errorMessage: record.errorMessage || null,
  };
}

async function summarizeStage(size, records, highWater, waitOutcome, finalState, startedAt, finishedAt) {
  const canonical = (await database.ref('ai_runtime/text_request_queue_v1/jobs').once('value')).val() || {};
  records.forEach((record) => {
    const job = canonical[record.jobId];
    const claimedAt = Number(job?.claimedAt || 0);
    const createdAt = Number(job?.createdAt || 0);
    if (claimedAt && createdAt && claimedAt >= createdAt) record.queueWaitMs = claimedAt - createdAt;
  });

  const providers = {};
  const models = {};
  const errors = {};
  const httpStatuses = {};
  const admissions = {};
  records.forEach((record) => {
    increment(httpStatuses, record.httpStatus);
    increment(admissions, record.admission);
    if (record.status === 'completed') {
      increment(providers, record.provider);
      increment(models, record.model);
    } else {
      increment(errors, record.errorCode || record.status);
    }
  });
  const completed = records.filter((record) => record.status === 'completed');
  const failed = records.filter((record) => ['failed', 'cancelled'].includes(record.status));
  const unresolved = records.filter((record) => !['completed', 'failed', 'cancelled'].includes(record.status));
  const accepted = records.filter((record) => ['direct', 'queued'].includes(record.admission));
  const markerMatches = completed.filter((record) => record.markerMatched).length;
  const observedProviders = ['ollama-bridge', 'cloudflare-workers-ai', 'groq']
    .filter((provider) => Number(providers[provider] || 0) > 0);
  const successRate = records.length ? completed.length / records.length : 0;
  const gateReasons = [];
  if (records.length !== size) gateReasons.push(`record_count_${records.length}_of_${size}`);
  if (accepted.length !== size) gateReasons.push(`accepted_${accepted.length}_of_${size}`);
  if (completed.length !== size) gateReasons.push(`completed_${completed.length}_of_${size}`);
  if (failed.length) gateReasons.push(`terminal_failures_${failed.length}`);
  if (unresolved.length) gateReasons.push(`unresolved_${unresolved.length}`);
  if (size > 90 && !records.some((record) => record.admission === 'queued')) gateReasons.push('no_queue_overflow_observed');
  if (size >= 90 && observedProviders.length !== 3) gateReasons.push(`provider_coverage_${observedProviders.join('+') || 'none'}`);
  if (
    finalState?.activeReservations
    || finalState?.pendingJobs
    || finalState?.providerLeases
    || finalState?.wakeSlots
  ) gateReasons.push('runtime_not_drained');
  if (waitOutcome.timedOut) gateReasons.push('stage_timeout');
  if (waitOutcome.noProgress) gateReasons.push('no_progress_watchdog');
  return {
    size,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    throughputPerSecond: Number((completed.length / Math.max(1, (finishedAt - startedAt) / 1000)).toFixed(3)),
    accepted: accepted.length,
    completed: completed.length,
    failed: failed.length,
    unresolved: unresolved.length,
    successRate,
    markerMatches,
    markerMatchRate: completed.length ? markerMatches / completed.length : 0,
    approximateOutputTokens: completed.reduce((total, record) => total + Number(record.approximateOutputTokens || 0), 0),
    providers,
    models,
    errors,
    httpStatuses,
    admissions,
    submissionLatency: latencySummary(records.map((record) => record.submissionLatencyMs)),
    endToEndLatency: latencySummary(completed.map((record) => record.endToEndMs)),
    queueWaitLatency: latencySummary(completed.map((record) => record.queueWaitMs)),
    highWater,
    finalState,
    waitOutcome: {
      timedOut: waitOutcome.timedOut === true,
      noProgress: waitOutcome.noProgress === true,
      remainingCount: waitOutcome.remaining?.length || 0,
    },
    gatePassed: gateReasons.length === 0,
    gateReasons,
    records: records.map(publicRecord),
  };
}

async function checkpoint() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function runStage(size, users, sequenceStart) {
  await refreshUserTokens(users);
  const router = await assertRouterReady(users[0]);
  console.log(JSON.stringify({ event: 'stage-start', stage: size, router, submitConcurrency: SUBMIT_CONCURRENCY }));
  const monitor = startHighWaterMonitor();
  const startedAt = Date.now();
  const specs = Array.from({ length: size }, (_, offset) => {
    const sequence = sequenceStart + offset;
    const expected = `ACK_${RUN_NONCE}_${sequence}`;
    return {
      stage: size,
      sequence,
      expected,
      requestId: `stress_${RUN_NONCE}_s${size}_${sequence}`,
      user: users[(sequence - 1) % users.length],
    };
  });
  await setQueueDrainPaused(true);
  let records;
  try {
    records = await mapLimit(specs, SUBMIT_CONCURRENCY, submitRequest);
  } finally {
    await setQueueDrainPaused(false);
  }
  const waitOutcome = await waitForQueuedRecords(records, size);
  const finalState = await waitForDrain();
  const finishedAt = Date.now();
  monitor.stop();
  const summary = await summarizeStage(
    size,
    records,
    monitor.state,
    waitOutcome,
    finalState,
    startedAt,
    finishedAt,
  );
  console.log(JSON.stringify({
    event: 'stage-complete',
    stage: size,
    gatePassed: summary.gatePassed,
    completed: summary.completed,
    failed: summary.failed,
    unresolved: summary.unresolved,
    providers: summary.providers,
    admissions: summary.admissions,
    highWater: summary.highWater,
    finalState: summary.finalState,
    gateReasons: summary.gateReasons,
  }));
  return summary;
}

async function main() {
  const preexisting = await database.ref('ai_runtime').once('value');
  if (preexisting.exists()) throw new Error('The emulator AI runtime is not empty; refusing to mix test runs.');
  console.log(JSON.stringify({
    event: 'run-start',
    runId: RUN_ID,
    stages: STAGES,
    genuineProviderRequests: true,
    productionDataTouched: false,
    userCount: USER_COUNT,
    totalRequests: TOTAL_REQUESTS,
  }));
  const users = await createUsers();
  let sequence = 1;
  for (const size of STAGES) {
    const stage = await runStage(size, users, sequence);
    report.stages.push(stage);
    sequence += size;
    await checkpoint();
    if (!stage.gatePassed) {
      report.stoppedAfterStage = size;
      report.stopReason = stage.gateReasons;
      break;
    }
    await sleep(5_000);
  }
  report.finishedAt = new Date().toISOString();
  report.completedStages = report.stages.filter((stage) => stage.gatePassed).map((stage) => stage.size);
  report.totalCompleted = report.stages.reduce((total, stage) => total + stage.completed, 0);
  report.gatePassed = report.stages.length === STAGES.length && report.stages.every((stage) => stage.gatePassed);
  await checkpoint();
  console.log(JSON.stringify({
    event: 'run-complete',
    runId: RUN_ID,
    gatePassed: report.gatePassed,
    completedStages: report.completedStages,
    totalCompleted: report.totalCompleted,
    reportPath: REPORT_PATH,
  }));
  await admin.app().delete();
  if (!report.gatePassed) process.exitCode = 1;
}

main().catch(async (error) => {
  report.finishedAt = new Date().toISOString();
  report.gatePassed = false;
  report.fatalError = String(error?.message || error).slice(0, 800);
  await checkpoint().catch(() => {});
  console.error(JSON.stringify({ event: 'run-failed', error: report.fatalError, reportPath: REPORT_PATH }));
  await admin.app().delete().catch(() => {});
  process.exitCode = 1;
});
