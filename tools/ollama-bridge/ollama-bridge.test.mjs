import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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

test('managed Ollama configuration isolates the protected runtime from tray settings', () => {
  const ambient = {
    USERPROFILE: 'C:\\Users\\operator',
    OLLAMA_HOST: '127.0.0.1:11434',
    OLLAMA_MODELS: 'S:\\olama',
    OLLAMA_UPSTREAM: '',
    OLLAMA_BRIDGE_OLLAMA_HOST: '',
    OLLAMA_BRIDGE_MODEL_STORE: '',
  };
  const config = resolveManagedOllamaConfig(ambient);

  assert.equal(config.upstream, 'http://127.0.0.1:11435');
  assert.equal(config.host, '127.0.0.1:11435');
  assert.equal(config.modelStore, path.resolve('C:\\Users\\operator', '.ollama', 'models'));
  assert.doesNotThrow(() => assertSafeManagedOllamaConfig(config));

  const childEnvironment = managedOllamaEnvironment(ambient, config);
  assert.equal(childEnvironment.OLLAMA_HOST, '127.0.0.1:11435');
  assert.equal(childEnvironment.OLLAMA_MODELS, config.modelStore);
  assert.notEqual(childEnvironment.OLLAMA_MODELS, ambient.OLLAMA_MODELS);
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
