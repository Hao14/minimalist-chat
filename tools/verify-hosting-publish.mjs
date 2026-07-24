import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import {
  readHostingPublishState,
  releaseHostingPublishLock,
  verifyBuiltPublish,
} from './prepare-hosting-publish.mjs';

const HOSTING_ORIGIN = 'https://chat-app-356c1.web.app';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJsonWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`request timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        const body = response.ok ? await response.json() : null;
        return { response, body };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export async function verifyPublishedBuild({
  expectedBuildNumber,
  fetchImpl = globalThis.fetch,
  origin = HOSTING_ORIGIN,
  attempts = 6,
  retryDelayMs = 1000,
  requestTimeoutMs = 5000,
} = {}) {
  const expected = String(expectedBuildNumber ?? '').trim();
  if (!expected) throw new Error('Expected published build number is required.');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error('Hosting verification attempts must be between 1 and 20.');
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new Error('Hosting verification timeout must be positive.');
  }

  let lastFailure = 'no response';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const url = new URL('/build-info.json', origin);
      url.searchParams.set('verify', `${Date.now()}-${attempt}`);
      const { response, body: live } = await fetchJsonWithTimeout(fetchImpl, url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }, requestTimeoutMs);
      if (!response.ok) {
        lastFailure = `HTTP ${response.status}`;
      } else {
        if (live?.buildNumber === expected) return live;
        lastFailure = `received ${live?.buildNumber || '(missing build number)'}`;
      }
    } catch (error) {
      lastFailure = error?.message || String(error);
    }
    if (attempt < attempts) await wait(retryDelayMs);
  }

  throw new Error(
    `Firebase Hosting verification expected ${expected}, but ${lastFailure}.`,
  );
}

export async function verifyActiveHostingPublish({
  lockDir,
  distDir,
  fetchImpl = globalThis.fetch,
  attempts,
  retryDelayMs,
  requestTimeoutMs,
} = {}) {
  const state = readHostingPublishState({ lockDir });
  try {
    const localBuild = verifyBuiltPublish({
      distDir,
      buildNumber: state.buildNumber,
      sourceRelease: state.sourceRelease,
      appVersion: state.appVersion,
    });
    const live = await verifyPublishedBuild({
      expectedBuildNumber: state.buildNumber,
      fetchImpl,
      origin: state.verifyOrigin || HOSTING_ORIGIN,
      attempts,
      retryDelayMs,
      requestTimeoutMs,
    });
    if (live.sourceRelease !== localBuild.sourceRelease
        || live.version !== localBuild.version) {
      throw new Error(
        `Live Hosting metadata does not match build ${state.buildNumber}.`,
      );
    }
    return live;
  } finally {
    releaseHostingPublishLock({
      lockDir,
      ownerToken: state.ownerToken,
      buildNumber: state.buildNumber,
      allowMissing: true,
    });
  }
}

async function main() {
  const live = await verifyActiveHostingPublish();
  process.stdout.write(`Verified live Hosting build: ${live.buildNumber}\n`);
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  await main();
}
