import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePort = Math.max(1, Math.min(65535,
  Number.parseInt(process.env.AI_LIVE_LOAD_BRIDGE_PORT || '5002', 10) || 5002));
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;
const bridgePath = path.join(repoRoot, 'tools', 'ai-live-gateway-bridge.cjs');
const harnessPath = path.join(repoRoot, 'tools', 'ai-live-load-test.mjs');

function waitForBridge(child, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('The local gateway bridge did not become ready.')), timeoutMs);
    const onData = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      if (!lines.some((line) => line.includes('"event":"gateway-bridge-ready"'))) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stdout.on('data', (nextChunk) => process.stdout.write(nextChunk));
      resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The local gateway bridge exited before readiness (code ${code ?? 'unknown'}).`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

const bridge = spawn(process.execPath, [bridgePath], {
  cwd: repoRoot,
  env: { ...process.env, AI_LIVE_LOAD_BRIDGE_PORT: String(bridgePort) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let harness;
try {
  await waitForBridge(bridge);
  harness = spawn(process.execPath, [harnessPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AI_LIVE_LOAD_FUNCTION_ORIGIN: bridgeOrigin,
      AI_LIVE_LOAD_EXECUTION_MODE: 'local-emulators-direct-gateway-real-ai-providers',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  const outcome = await waitForExit(harness);
  if (outcome.signal) {
    console.error(`Load harness stopped by ${outcome.signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = outcome.code ?? 1;
  }
} finally {
  if (harness && harness.exitCode === null) harness.kill();
  if (bridge.exitCode === null) {
    bridge.kill();
    await Promise.race([
      waitForExit(bridge),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}
