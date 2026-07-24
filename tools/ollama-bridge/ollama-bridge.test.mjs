import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPROVED_MODELS = ['qwen3:4b-instruct', 'qwen3:14b', 'qwen2.5vl:7b'];
const require = createRequire(import.meta.url);
const {
  assertSafeManagedOllamaConfig,
  managedOllamaEnvironment,
  resolveManagedOllamaConfig,
} = require('./managed-ollama-config.cjs');

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitForBridge(url, child, logs) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Bridge exited early (${child.exitCode}).\n${logs.join('')}`);
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Startup polling is expected to fail until the child binds its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Bridge did not start in time.\n${logs.join('')}`);
}

async function stopChild(child) {
  if (child.exitCode != null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function waitFor(condition, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

test('managed Ollama configuration isolates the protected runtime from tray settings', () => {
  const ambient = {
    USERPROFILE: 'C:\\Users\\operator',
    OLLAMA_HOST: '127.0.0.1:11434',
    OLLAMA_MODELS: 'S:\\olama',
    OLLAMA_UPSTREAM: '',
    OLLAMA_BRIDGE_OLLAMA_HOST: '',
    OLLAMA_BRIDGE_MODEL_STORE: '',
    OLLAMA_NUM_PARALLEL: '99',
    OLLAMA_MAX_QUEUE: '999',
    OLLAMA_FLASH_ATTENTION: '1',
    OLLAMA_KV_CACHE_TYPE: 'q4_0',
    OLLAMA_DEBUG_LOG_REQUESTS: 'true',
  };
  const config = resolveManagedOllamaConfig(ambient);

  assert.equal(config.upstream, 'http://127.0.0.1:11435');
  assert.equal(config.host, '127.0.0.1:11435');
  assert.equal(config.modelStore, path.resolve('C:\\Users\\operator', '.ollama', 'models'));
  assert.equal(config.numParallel, 4);
  assert.equal(config.maxQueue, 100);
  assert.equal(config.flashAttention, false);
  assert.equal(config.kvCacheType, '');
  assert.doesNotThrow(() => assertSafeManagedOllamaConfig(config));

  const childEnvironment = managedOllamaEnvironment(ambient, config);
  assert.equal(childEnvironment.OLLAMA_HOST, '127.0.0.1:11435');
  assert.equal(childEnvironment.OLLAMA_MODELS, config.modelStore);
  assert.notEqual(childEnvironment.OLLAMA_MODELS, ambient.OLLAMA_MODELS);
  assert.equal(childEnvironment.OLLAMA_NUM_PARALLEL, '4');
  assert.equal(childEnvironment.OLLAMA_MAX_QUEUE, '100');
  assert.equal(childEnvironment.OLLAMA_DEBUG_LOG_REQUESTS, 'false');
  assert.equal(childEnvironment.OLLAMA_FLASH_ATTENTION, undefined);
  assert.equal(childEnvironment.OLLAMA_KV_CACHE_TYPE, undefined);
});

test('managed Ollama enables Flash Attention and q8_0 KV cache only through explicit protected settings', () => {
  const config = resolveManagedOllamaConfig({
    USERPROFILE: 'C:\\Users\\operator',
    OLLAMA_BRIDGE_OLLAMA_NUM_PARALLEL: '4',
    OLLAMA_BRIDGE_OLLAMA_MAX_QUEUE: '100',
    OLLAMA_BRIDGE_OLLAMA_FLASH_ATTENTION: 'true',
    OLLAMA_BRIDGE_OLLAMA_KV_CACHE_TYPE: 'q8_0',
  });
  assert.doesNotThrow(() => assertSafeManagedOllamaConfig(config));
  const childEnvironment = managedOllamaEnvironment({}, config);
  assert.equal(childEnvironment.OLLAMA_FLASH_ATTENTION, '1');
  assert.equal(childEnvironment.OLLAMA_KV_CACHE_TYPE, 'q8_0');

  const unsafe = resolveManagedOllamaConfig({
    USERPROFILE: 'C:\\Users\\operator',
    OLLAMA_BRIDGE_OLLAMA_KV_CACHE_TYPE: 'q8_0',
  });
  assert.throws(() => assertSafeManagedOllamaConfig(unsafe), /requires Flash Attention/);
});

test('managed Ollama refuses the tray app port and mismatched upstreams', () => {
  assert.throws(
    () => assertSafeManagedOllamaConfig({
      upstream: 'http://127.0.0.1:11434',
      host: '127.0.0.1:11434',
      modelStore: path.resolve('models'),
      approvedModelStore: path.resolve('models'),
    }),
    /reserved for the user tray app/,
  );
  assert.throws(
    () => assertSafeManagedOllamaConfig({
      upstream: 'http://127.0.0.1:11435',
      host: '127.0.0.1:11436',
      modelStore: path.resolve('models'),
      approvedModelStore: path.resolve('models'),
    }),
    /exactly match/,
  );
  assert.throws(
    () => assertSafeManagedOllamaConfig({
      upstream: 'http://127.0.0.1:11435',
      host: '127.0.0.1:11435',
      modelStore: 'relative-models',
      approvedModelStore: path.resolve('models'),
    }),
    /absolute model-store path/,
  );
  const trayStoreConfig = resolveManagedOllamaConfig({
    USERPROFILE: 'C:\\Users\\operator',
    OLLAMA_BRIDGE_MODEL_STORE: 'S:\\olama',
  });
  assert.throws(
    () => assertSafeManagedOllamaConfig(trayStoreConfig),
    /approved default user model store/,
  );
});

test('protected bridge forwards only the three canonical model tags', { timeout: 20_000 }, async () => {
  const forwarded = [];
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: APPROVED_MODELS.map((name) => ({ name })) }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    forwarded.push(payload);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ model: payload.model, message: { role: 'assistant', content: 'ok' }, done: true }));
  });

  const upstreamPort = await listen(upstream);
  const bridgePort = await freePort();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'minimalist-bridge-test-'));
  const logs = [];
  const child = spawn(process.execPath, [path.join(HERE, 'ollama-bridge.cjs')], {
    cwd: HERE,
    windowsHide: true,
    env: {
      ...process.env,
      BRIDGE_PORT: String(bridgePort),
      OLLAMA_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      OLLAMA_BRIDGE_TOKEN: 'test-token',
      OLLAMA_BRIDGE_MODEL_ALLOWLIST: APPROVED_MODELS.join(','),
      OLLAMA_BRIDGE_MANAGE_UPSTREAM: 'false',
      OLLAMA_BRIDGE_CONTROL_FILE: path.join(temp, 'control.json'),
      OLLAMA_BRIDGE_ACTIVITY_FILE: path.join(temp, 'activity.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;

  try {
    await waitForBridge(bridgeUrl, child, logs);
    const send = (body) => fetch(`${bridgeUrl}/api/chat`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body,
    });

    const arbitrary = await send(JSON.stringify({ model: 'arbitrary:latest', messages: [] }));
    assert.equal(arbitrary.status, 403);
    assert.equal(forwarded.length, 0);

    const missing = await send(JSON.stringify({ messages: [] }));
    assert.equal(missing.status, 403);
    assert.equal(forwarded.length, 0);

    const malformed = await send('{not json');
    assert.equal(malformed.status, 400);
    assert.equal(forwarded.length, 0);

    for (const model of APPROVED_MODELS) {
      const response = await send(JSON.stringify({ model, stream: false, think: false, options: { num_ctx: 8192 }, messages: [{ role: 'user', content: 'test' }] }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).model, model);
    }
    assert.deepEqual(forwarded.map((payload) => payload.model), APPROVED_MODELS);
    assert.ok(forwarded.every((payload) => payload.think === false && payload.options?.num_ctx === 8192));
  } finally {
    await stopChild(child);
    await close(upstream);
    await rm(temp, { recursive: true, force: true });
  }
});

test('protected bridge schedules weighted FIFO work and records privacy-safe Ollama metrics', { timeout: 30_000 }, async () => {
  const pending = [];
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: APPROVED_MODELS.map((name) => ({ name })) }));
      return;
    }

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const entry = {
      payload,
      responded: false,
      respond() {
        if (this.responded) return;
        this.responded = true;
        const result = {
          model: payload.model,
          message: { role: 'assistant', content: `secret-output-for-${payload.messages?.[0]?.content || 'request'}` },
          done: true,
          total_duration: 2_000_000_000,
          load_duration: 100_000_000,
          prompt_eval_count: 12,
          prompt_eval_duration: 300_000_000,
          eval_count: 20,
          eval_duration: 500_000_000,
        };
        response.writeHead(200, {
          'Content-Type': payload.stream === false ? 'application/json' : 'application/x-ndjson',
        });
        response.end(`${JSON.stringify(result)}${payload.stream === false ? '' : '\n'}`);
      },
    };
    pending.push(entry);
  });

  const upstreamPort = await listen(upstream);
  const bridgePort = await freePort();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'minimalist-bridge-scheduler-test-'));
  const activityFile = path.join(temp, 'activity.json');
  const logs = [];
  const child = spawn(process.execPath, [path.join(HERE, 'ollama-bridge.cjs')], {
    cwd: HERE,
    windowsHide: true,
    env: {
      ...process.env,
      BRIDGE_PORT: String(bridgePort),
      OLLAMA_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      OLLAMA_BRIDGE_TOKEN: 'test-token',
      OLLAMA_BRIDGE_MODEL_ALLOWLIST: APPROVED_MODELS.join(','),
      OLLAMA_BRIDGE_MANAGE_UPSTREAM: 'false',
      OLLAMA_BRIDGE_EXECUTION_UNITS: '4',
      OLLAMA_BRIDGE_EXECUTION_MAX_QUEUE: '2',
      OLLAMA_BRIDGE_CONTROL_FILE: path.join(temp, 'control.json'),
      OLLAMA_BRIDGE_ACTIVITY_FILE: activityFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  const authHeaders = { Authorization: 'Bearer test-token' };
  const inFlightResponses = [];
  const send = (model, marker, stream = false) => {
    const request = fetch(`${bridgeUrl}/api/chat`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream, messages: [{ role: 'user', content: marker }] }),
    });
    inFlightResponses.push(request);
    request.catch(() => undefined);
    return request;
  };
  let latestStatus = null;
  const status = async () => {
    const response = await fetch(`${bridgeUrl}/control/status`, { headers: authHeaders });
    assert.equal(response.status, 200);
    latestStatus = await response.json();
    return latestStatus;
  };

  try {
    await waitForBridge(bridgeUrl, child, logs);

    const smartOne = send(APPROVED_MODELS[1], 'private-smart-one');
    const smartTwo = send(APPROVED_MODELS[1], 'private-smart-two');
    await waitFor(() => pending.length === 2, 'Two Smart requests did not start concurrently.');

    const vision = send(APPROVED_MODELS[2], 'private-vision-head');
    await waitFor(async () => (await status()).scheduler.queuedRequests === 1, 'Vision did not enter the FIFO queue first.');
    const fast = send(APPROVED_MODELS[0], 'private-fast-tail');
    await waitFor(async () => (await status()).scheduler.queuedRequests === 2, 'Vision and Fast requests did not enter the FIFO queue.');

    const overflow = await send(APPROVED_MODELS[0], 'private-overflow');
    assert.equal(overflow.status, 429);
    assert.equal(overflow.headers.get('retry-after'), '1');
    assert.equal((await overflow.json()).code, 'BRIDGE_QUEUE_FULL');
    assert.equal(pending.length, 2);

    let snapshot = await status();
    assert.deepEqual(snapshot.scheduler, {
      capacityUnits: 4,
      activeUnits: 4,
      activeRequests: 2,
      queuedRequests: 2,
      maxQueuedRequests: 2,
      weights: { fast: 1, smart: 2, vision: 4 },
    });

    pending[0].respond();
    await waitFor(async () => {
      const current = await status();
      return current.scheduler.activeRequests === 1 && current.scheduler.queuedRequests === 2;
    }, 'Strict FIFO allowed Fast to bypass the queued Vision request.');
    assert.equal(pending.length, 2);

    pending[1].respond();
    await waitFor(() => pending.length === 3, 'Vision did not start after all four execution units became available.');
    assert.equal(pending[2].payload.model, APPROVED_MODELS[2]);
    snapshot = await status();
    assert.equal(snapshot.scheduler.activeUnits, 4);
    assert.equal(snapshot.scheduler.queuedRequests, 1);

    pending[2].respond();
    await waitFor(() => pending.length === 4, 'Fast did not start after Vision released the execution units.');
    assert.equal(pending[3].payload.model, APPROVED_MODELS[0]);
    pending[3].respond();

    const completed = await Promise.all([smartOne, smartTwo, vision, fast]);
    assert.ok(completed.every((response) => response.status === 200));
    await Promise.all(completed.map((response) => response.json()));

    const streamedSmart = send(APPROVED_MODELS[1], 'private-streaming-smart', true);
    await waitFor(() => pending.length === 5, 'Streaming Smart request did not reach the upstream.');
    pending[4].respond();
    const streamedResponse = await streamedSmart;
    assert.equal(streamedResponse.status, 200);
    await streamedResponse.text();

    await waitFor(async () => {
      const current = await status();
      return current.scheduler.activeRequests === 0 && current.scheduler.queuedRequests === 0;
    }, 'Execution scheduler did not fully drain.');
    snapshot = await status();

    const fastActivity = snapshot.activity.find((row) => row.model === APPROVED_MODELS[0] && row.result === 'success');
    assert.ok(fastActivity.queueWaitMs > 0);
    assert.equal(fastActivity.ollamaTotalDurationMs, 2000);
    assert.equal(fastActivity.ollamaLoadDurationMs, 100);
    assert.equal(fastActivity.ollamaPromptEvalCount, 12);
    assert.equal(fastActivity.ollamaPromptEvalDurationMs, 300);
    assert.equal(fastActivity.ollamaPromptTokensPerSecond, 40);
    assert.equal(fastActivity.ollamaEvalCount, 20);
    assert.equal(fastActivity.ollamaEvalDurationMs, 500);
    assert.equal(fastActivity.ollamaEvalTokensPerSecond, 40);

    const latestSmartActivity = snapshot.activity.find((row) => row.model === APPROVED_MODELS[1]);
    assert.equal(latestSmartActivity.status, 200);
    assert.equal(latestSmartActivity.ollamaTotalDurationMs, 2000);
    assert.equal(latestSmartActivity.ollamaEvalCount, 20);

    const persistedActivity = await readFile(activityFile, 'utf8');
    for (const privateText of [
      'private-smart-one',
      'private-smart-two',
      'private-vision-head',
      'private-fast-tail',
      'private-overflow',
      'private-streaming-smart',
      'secret-output-for',
    ]) {
      assert.equal(persistedActivity.includes(privateText), false);
    }
  } catch (error) {
    const pendingModels = pending.map((entry) => entry.payload.model);
    error.message = `${error.message}\nLatest status: ${JSON.stringify(latestStatus?.scheduler || null)}\nUpstream requests: ${JSON.stringify(pendingModels)}\nBridge logs:\n${logs.join('')}`;
    throw error;
  } finally {
    for (const entry of pending) entry.respond();
    await stopChild(child);
    await Promise.allSettled(inFlightResponses);
    await close(upstream);
    await rm(temp, { recursive: true, force: true });
  }
});

test('streaming responses arrive before completion and release their lease on completion or client abort', { timeout: 30_000 }, async () => {
  const streams = [];
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: APPROVED_MODELS.map((name) => ({ name })) }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const marker = payload.messages?.[0]?.content || 'unknown';
    const entry = {
      marker,
      response,
      closedBeforeEnd: false,
      finish() {
        if (response.writableEnded || response.destroyed) return;
        response.end(`${JSON.stringify({
          model: payload.model,
          message: { role: 'assistant', content: '' },
          done: true,
          total_duration: 1_200_000_000,
          load_duration: 80_000_000,
          prompt_eval_count: 10,
          prompt_eval_duration: 200_000_000,
          eval_count: 15,
          eval_duration: 300_000_000,
        })}\n`);
      },
    };
    response.on('close', () => {
      if (!response.writableEnded) entry.closedBeforeEnd = true;
    });
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write(`${JSON.stringify({
      model: payload.model,
      message: { role: 'assistant', content: `first-${marker}` },
      done: false,
    })}\n`);
    streams.push(entry);
  });

  const upstreamPort = await listen(upstream);
  const bridgePort = await freePort();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'minimalist-bridge-stream-test-'));
  const logs = [];
  const child = spawn(process.execPath, [path.join(HERE, 'ollama-bridge.cjs')], {
    cwd: HERE,
    windowsHide: true,
    env: {
      ...process.env,
      BRIDGE_PORT: String(bridgePort),
      OLLAMA_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      OLLAMA_BRIDGE_TOKEN: 'test-token',
      OLLAMA_BRIDGE_MODEL_ALLOWLIST: APPROVED_MODELS.join(','),
      OLLAMA_BRIDGE_MANAGE_UPSTREAM: 'false',
      OLLAMA_BRIDGE_CONTROL_FILE: path.join(temp, 'control.json'),
      OLLAMA_BRIDGE_ACTIVITY_FILE: path.join(temp, 'activity.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const status = async () => (await fetch(`${bridgeUrl}/control/status`, {
    headers: { Authorization: 'Bearer test-token' },
  })).json();

  try {
    await waitForBridge(bridgeUrl, child, logs);
    const response = await fetch(`${bridgeUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: APPROVED_MODELS[1], stream: true, messages: [{ role: 'user', content: 'progress' }] }),
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.match(new TextDecoder().decode(first.value), /first-progress/);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].response.writableEnded, false);
    assert.equal((await status()).scheduler.activeUnits, 2);

    streams[0].finish();
    while (!(await reader.read()).done) {
      // Drain the remaining final metric event.
    }
    await waitFor(async () => (await status()).scheduler.activeRequests === 0, 'Completed stream did not release its lease.');
    const completedActivity = (await status()).activity.find((row) => row.model === APPROVED_MODELS[1]);
    assert.equal(completedActivity.ollamaTotalDurationMs, 1200);
    assert.equal(completedActivity.ollamaEvalTokensPerSecond, 50);

    const abortController = new AbortController();
    const abortedResponse = await fetch(`${bridgeUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: APPROVED_MODELS[1], stream: true, messages: [{ role: 'user', content: 'cancel' }] }),
      signal: abortController.signal,
    });
    const abortedReader = abortedResponse.body.getReader();
    const abortedFirst = await abortedReader.read();
    assert.match(new TextDecoder().decode(abortedFirst.value), /first-cancel/);
    abortController.abort();
    await assert.rejects(() => abortedReader.read(), /abort/i);
    await waitFor(async () => (await status()).scheduler.activeRequests === 0, 'Cancelled stream did not release its lease.');
    await waitFor(() => streams[1]?.closedBeforeEnd === true, 'Client cancellation did not abort the upstream stream.');
  } catch (error) {
    error.message = `${error.message}\nBridge logs:\n${logs.join('')}`;
    throw error;
  } finally {
    for (const entry of streams) entry.finish();
    await stopChild(child);
    await close(upstream);
    await rm(temp, { recursive: true, force: true });
  }
});

test('authenticated preload is allowlist-bound, non-generative, unbilled, and privacy-safe', { timeout: 20_000 }, async () => {
  const forwarded = [];
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: APPROVED_MODELS.map((name) => ({ name })) }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    forwarded.push({ url: request.url, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      model: forwarded.at(-1).payload.model,
      response: 'PRIVATE_PRELOAD_RESPONSE_MUST_NOT_ESCAPE',
      done: true,
      total_duration: 900_000_000,
      load_duration: 700_000_000,
      eval_count: 0,
    }));
  });

  const upstreamPort = await listen(upstream);
  const bridgePort = await freePort();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'minimalist-bridge-preload-test-'));
  const activityFile = path.join(temp, 'activity.json');
  await writeFile(activityFile, JSON.stringify([{
    time: Date.now(),
    feature: 'unsafe feature',
    model: 'legacy',
    durationMs: 1e20,
    queueWaitMs: -10,
    status: 200,
    result: 'success',
    ollamaEvalCount: 1e20,
    prompt: 'PRIVATE_PERSISTED_PROMPT',
    response: 'PRIVATE_PERSISTED_RESPONSE',
  }]), 'utf8');
  const logs = [];
  const child = spawn(process.execPath, [path.join(HERE, 'ollama-bridge.cjs')], {
    cwd: HERE,
    windowsHide: true,
    env: {
      ...process.env,
      BRIDGE_PORT: String(bridgePort),
      OLLAMA_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      OLLAMA_BRIDGE_TOKEN: 'test-token',
      OLLAMA_BRIDGE_MODEL_ALLOWLIST: APPROVED_MODELS.join(','),
      OLLAMA_BRIDGE_MANAGE_UPSTREAM: 'false',
      OLLAMA_BRIDGE_CONTROL_FILE: path.join(temp, 'control.json'),
      OLLAMA_BRIDGE_ACTIVITY_FILE: activityFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  const send = (payload, token = 'test-token') => fetch(`${bridgeUrl}/api/preload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  try {
    await waitForBridge(bridgeUrl, child, logs);
    assert.equal((await send({ model: APPROVED_MODELS[1] }, 'wrong-token')).status, 401);
    assert.equal((await send({ model: 'gpt-oss:20b' })).status, 403);
    assert.equal((await send({ model: APPROVED_MODELS[1], prompt: 'generate this' })).status, 400);
    assert.equal(forwarded.length, 0);

    const response = await send({ model: APPROVED_MODELS[1] });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, {
      ok: true,
      model: APPROVED_MODELS[1],
      keepAlive: '120m',
      route: 'local-preload',
      billable: false,
      loadDurationMs: 700,
    });
    assert.deepEqual(forwarded, [{
      url: '/api/generate',
      payload: {
        model: APPROVED_MODELS[1],
        prompt: '',
        stream: false,
        keep_alive: '120m',
      },
    }]);

    const statusResponse = await fetch(`${bridgeUrl}/control/status`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const status = await statusResponse.json();
    const preload = status.activity.find((row) => row.feature === 'Model preload');
    assert.equal(preload.model, APPROVED_MODELS[1]);
    assert.equal(preload.result, 'success');
    assert.equal(preload.status, 200);
    assert.equal(preload.ollamaLoadDurationMs, 700);
    const legacy = status.activity.find((row) => row.model === 'legacy');
    assert.equal(legacy.durationMs, 86_400_000);
    assert.equal(legacy.queueWaitMs, 0);
    assert.equal(legacy.ollamaEvalCount, 10_000_000);

    const serializedStatus = JSON.stringify(status);
    assert.doesNotMatch(serializedStatus, /PRIVATE_|prompt|response/i);
    const persisted = await readFile(activityFile, 'utf8');
    assert.doesNotMatch(persisted, /PRIVATE_|prompt|response/i);
  } catch (error) {
    error.message = `${error.message}\nBridge logs:\n${logs.join('')}`;
    throw error;
  } finally {
    await stopChild(child);
    await close(upstream);
    await rm(temp, { recursive: true, force: true });
  }
});
