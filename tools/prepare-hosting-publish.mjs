import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { createPublishBuildNumber } from './publish-build-number.mjs';
import {
  normalizeReleaseValue,
  resolveRumReleaseId,
  resolveSourceBuildNumber,
} from './source-release-id.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST_DIR = path.join(REPO_ROOT, 'dist');
const DEFAULT_LOCK_DIR = path.join(REPO_ROOT, '.deploy-tools', 'hosting-publish.lock');
const BUILD_INFO_FILE = 'build-info.json';
const MANIFEST_FILE = path.join('.vite', 'manifest.json');
const LOCK_STATE_FILE = 'state.json';
const REQUIRED_BOOTSTRAP_URLS = Object.freeze([
  '/load-css.js?v=8',
  '/config.js?v=localai7',
]);
const REQUIRED_COMPILED_ENTRIES = Object.freeze([
  'src/main.jsx',
  'src/features/settings/LanguageHelpSettings.jsx',
]);
const FIREBASE_DEPLOY_PATTERN = /(?:firebase(?:\.js|\.cmd|\.exe)?|firebase-tools|firebase-node22\.ps1).*\bdeploy\b/i;

function normalizedBuildNumber(value) {
  return String(value ?? '').trim();
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${error?.message || error}`);
  }
}

function safeLockState(lockDir) {
  const statePath = path.join(lockDir, LOCK_STATE_FILE);
  try {
    const state = readJson(statePath, 'Hosting publish lock state');
    return state
      && typeof state === 'object'
      && typeof state.ownerToken === 'string'
      && typeof state.buildNumber === 'string'
      && normalizedBuildNumber(state.ownerToken)
      && normalizedBuildNumber(state.buildNumber)
      ? state
      : null;
  } catch {
    return null;
  }
}

function systemProcessSnapshot({
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  try {
    if (platform === 'win32') {
      const command = [
        'Get-CimInstance Win32_Process',
        'Select-Object ProcessId,ParentProcessId,CommandLine',
        'ConvertTo-Json -Compress',
      ].join(' | ');
      const result = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { encoding: 'utf8', windowsHide: true },
      );
      if (result.status !== 0 || !String(result.stdout || '').trim()) return [];
      const parsed = JSON.parse(result.stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
        pid: Number(entry.ProcessId),
        parentPid: Number(entry.ParentProcessId),
        commandLine: String(entry.CommandLine || ''),
      }));
    }

    const result = spawn('ps', ['-eo', 'pid=,ppid=,args='], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) return [];
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
      .filter(Boolean)
      .map((match) => ({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        commandLine: match[3],
      }));
  } catch {
    return [];
  }
}

export function resolveFirebaseDeployInvocation({
  environment = process.env,
  currentPid = process.pid,
  processes,
} = {}) {
  const explicitDryRun = /^(?:1|true|yes)$/i.test(
    String(environment.MINIMALIST_FIREBASE_DRY_RUN || '').trim(),
  );
  const snapshot = processes || systemProcessSnapshot();
  const byPid = new Map(snapshot.map((entry) => [Number(entry.pid), entry]));
  let cursor = Number(currentPid);
  const visited = new Set();

  while (cursor > 0 && !visited.has(cursor)) {
    visited.add(cursor);
    const entry = byPid.get(cursor);
    if (!entry) break;
    if (FIREBASE_DEPLOY_PATTERN.test(entry.commandLine)) {
      return {
        processId: entry.pid,
        dryRun: explicitDryRun || /(?:^|\s)--dry-run(?:\s|$)/i.test(entry.commandLine),
      };
    }
    cursor = Number(entry.parentPid);
  }

  return {
    processId: null,
    dryRun: explicitDryRun,
  };
}

export function acquireHostingPublishLock({
  lockDir = DEFAULT_LOCK_DIR,
  state,
} = {}) {
  if (!state?.ownerToken || !state?.buildNumber) {
    throw new Error('Hosting publish lock requires an owner token and build number.');
  }
  mkdirSync(path.dirname(lockDir), { recursive: true });

  const candidateDir = `${lockDir}.candidate-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    mkdirSync(candidateDir);
    writeFileSync(
      path.join(candidateDir, LOCK_STATE_FILE),
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8',
    );
    renameSync(candidateDir, lockDir);
    return state;
  } catch (error) {
    rmSync(candidateDir, { recursive: true, force: true });
    if (!existsSync(lockDir)) throw error;
    const existing = safeLockState(lockDir);
    const activeBuild = existing?.buildNumber || 'unknown';
    const recovery = existing
      ? `node tools/prepare-hosting-publish.mjs --cleanup-build ${activeBuild}`
      : 'node tools/prepare-hosting-publish.mjs --cleanup-corrupt-lock';
    throw new Error(
      `Hosting publish ${activeBuild} already owns ${lockDir}. `
      + 'Wait for it to finish. After a failed direct Firebase command has ended, run '
      + `${recovery}.`,
    );
  }
}

export function releaseCorruptHostingPublishLock({
  lockDir = DEFAULT_LOCK_DIR,
} = {}) {
  if (!existsSync(lockDir)) return false;
  if (safeLockState(lockDir)) {
    throw new Error('Refusing corrupt-lock recovery because the Hosting publish state is valid.');
  }
  rmSync(lockDir, { recursive: true, force: true });
  return true;
}

export function readHostingPublishState({
  lockDir = DEFAULT_LOCK_DIR,
} = {}) {
  const state = safeLockState(lockDir);
  if (!state?.ownerToken || !state?.buildNumber) {
    throw new Error(`No valid active Hosting publish state exists at ${lockDir}.`);
  }
  return state;
}

export function releaseHostingPublishLock({
  lockDir = DEFAULT_LOCK_DIR,
  ownerToken,
  buildNumber,
  allowMissing = false,
} = {}) {
  if (!existsSync(lockDir)) {
    if (allowMissing) return false;
    throw new Error(`Hosting publish lock does not exist at ${lockDir}.`);
  }
  const state = readHostingPublishState({ lockDir });
  if (ownerToken && state.ownerToken !== ownerToken) {
    throw new Error('Refusing to release a Hosting publish lock owned by another process.');
  }
  if (buildNumber && state.buildNumber !== buildNumber) {
    throw new Error('Refusing to release a Hosting publish lock for another build.');
  }
  rmSync(lockDir, { recursive: true, force: true });
  return true;
}

export function embeddedBootstrapBuildNumbers(html) {
  return REQUIRED_BOOTSTRAP_URLS.map((bootstrapUrl) => {
    const escaped = bootstrapUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...String(html || '').matchAll(
      new RegExp(`${escaped}&build=([^"'&\\s>]+)`, 'g'),
    )];
    if (matches.length !== 1) {
      throw new Error(`Built Hosting index must contain exactly one ${bootstrapUrl} build URL.`);
    }
    return decodeURIComponent(matches[0][1]);
  });
}

function verifyCompiledBuildIdentity({ distDir, manifest, buildNumber }) {
  for (const entryName of REQUIRED_COMPILED_ENTRIES) {
    const entry = manifest[entryName];
    if (!entry?.file) {
      throw new Error(`Built Hosting manifest is missing ${entryName}.`);
    }
    const assetPath = path.join(distDir, entry.file);
    if (!existsSync(assetPath)) {
      throw new Error(`Built Hosting manifest asset is missing: ${entry.file}.`);
    }
    if (!readFileSync(assetPath, 'utf8').includes(buildNumber)) {
      throw new Error(`Compiled Hosting asset ${entry.file} does not contain build ${buildNumber}.`);
    }
  }
}

export function verifyBuiltPublish({
  distDir = DEFAULT_DIST_DIR,
  buildNumber,
  sourceRelease,
  appVersion,
} = {}) {
  const expected = normalizedBuildNumber(buildNumber);
  const expectedSourceRelease = normalizedBuildNumber(sourceRelease);
  if (!expected) throw new Error('A publish build number is required.');
  if (!expectedSourceRelease) throw new Error('A stable source release is required.');

  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Hosting publish is missing ${indexPath}.`);
  }
  const embedded = embeddedBootstrapBuildNumbers(readFileSync(indexPath, 'utf8'));
  if (embedded.some((value) => value !== expected)) {
    throw new Error(
      `Built Hosting bootstrap does not consistently contain publish build ${expected}.`,
    );
  }

  const buildInfo = readJson(
    path.join(distDir, BUILD_INFO_FILE),
    'Vite Hosting build identity',
  );
  if (buildInfo.schemaVersion !== 1
      || buildInfo.buildNumber !== expected
      || buildInfo.sourceRelease !== expectedSourceRelease
      || (appVersion && buildInfo.version !== appVersion)
      || Number.isNaN(new Date(buildInfo.publishedAt).getTime())) {
    throw new Error(`Vite Hosting build identity does not match publish build ${expected}.`);
  }

  const manifest = readJson(
    path.join(distDir, MANIFEST_FILE),
    'Vite Hosting manifest',
  );
  if (!manifest['index.html']?.isEntry) {
    throw new Error('Vite Hosting manifest is missing the index entry.');
  }
  verifyCompiledBuildIdentity({ distDir, manifest, buildNumber: expected });
  return buildInfo;
}

export function resolveNpmInvocation({
  args,
  environment = process.env,
  platform = process.platform,
} = {}) {
  if (platform === 'win32') {
    return {
      command: environment.ComSpec || environment.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', ...args],
    };
  }
  return { command: 'npm', args };
}

export function runNpmCommand({
  args,
  environment,
  cwd = REPO_ROOT,
  platform = process.platform,
  spawn = spawnSync,
  stdio = 'inherit',
} = {}) {
  const invocation = resolveNpmInvocation({ args, environment, platform });
  const result = spawn(invocation.command, invocation.args, {
    cwd,
    env: environment,
    stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}.`);
  }
  return result;
}

function runProductionBuild({ environment, cwd = REPO_ROOT } = {}) {
  runNpmCommand({ args: ['run', 'build'], environment, cwd });
}

function runRumGate({ environment, cwd = REPO_ROOT } = {}) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'rum-performance-gate.mjs')], {
    cwd,
    env: {
      ...environment,
      REQUIRE_RUM_PERFORMANCE_GATE: 'true',
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`RUM performance gate failed with exit code ${result.status}.`);
  }
}

function configuredAppVersion(environment) {
  const packageJson = readJson(path.join(REPO_ROOT, 'package.json'), 'package.json');
  return normalizeReleaseValue(
    environment.MINIMALIST_APP_VERSION
      || environment.VITE_APP_VERSION
      || packageJson.version
      || '0.0.0',
  );
}

export function prepareHostingPublish({
  environment = process.env,
  distDir = DEFAULT_DIST_DIR,
  lockDir = DEFAULT_LOCK_DIR,
  build = runProductionBuild,
  gate = runRumGate,
  now = new Date(),
  nonce,
  firebaseInvocation,
} = {}) {
  const sourceBuildNumber = resolveSourceBuildNumber({
    environment,
    cwd: REPO_ROOT,
  }) || 'source';
  const appVersion = configuredAppVersion(environment);
  const sourceRelease = resolveRumReleaseId({
    environment,
    appVersion,
    sourceBuildNumber,
    cwd: REPO_ROOT,
  });
  const buildNumber = createPublishBuildNumber({
    sourceRevision: sourceBuildNumber,
    now,
    ...(nonce ? { nonce } : {}),
  });
  const ownerToken = normalizedBuildNumber(environment.MINIMALIST_HOSTING_PUBLISH_OWNER)
    || randomBytes(16).toString('hex');
  const verifyOrigin = normalizedBuildNumber(environment.MINIMALIST_HOSTING_VERIFY_ORIGIN)
    || 'https://chat-app-356c1.web.app';
  const invocation = firebaseInvocation || resolveFirebaseDeployInvocation({ environment });
  const state = {
    schemaVersion: 1,
    ownerToken,
    buildNumber,
    sourceRelease,
    appVersion,
    startedAt: now.toISOString(),
    verifyOrigin,
    firebaseProcessId: invocation.processId,
    dryRun: invocation.dryRun,
  };

  acquireHostingPublishLock({ lockDir, state });
  try {
    const publishEnvironment = {
      ...environment,
      MINIMALIST_BUILD_NUMBER: buildNumber,
      MINIMALIST_RUM_RELEASE_ID: sourceRelease,
      MINIMALIST_PUBLISH_STARTED_AT: now.toISOString(),
    };
    gate({ cwd: REPO_ROOT, environment: publishEnvironment });
    build({ cwd: REPO_ROOT, environment: publishEnvironment });
    const buildInfo = verifyBuiltPublish({
      distDir,
      buildNumber,
      sourceRelease,
      appVersion,
    });
    process.stdout.write(`Hosting publish build: ${buildNumber}\n`);
    process.stdout.write(`Hosting performance release: ${sourceRelease}\n`);
    if (state.dryRun) {
      releaseHostingPublishLock({
        lockDir,
        ownerToken,
        buildNumber,
      });
      process.stdout.write('Firebase dry run detected; released the Hosting publish lock.\n');
    }
    return { ...buildInfo, ownerToken };
  } catch (error) {
    releaseHostingPublishLock({
      lockDir,
      ownerToken,
      buildNumber,
      allowMissing: true,
    });
    throw error;
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  const cleanupBuildIndex = process.argv.indexOf('--cleanup-build');
  if (process.argv.includes('--cleanup-corrupt-lock')) {
    const released = releaseCorruptHostingPublishLock();
    process.stdout.write(
      released ? 'Released the corrupt Hosting publish lock.\n' : 'No Hosting publish lock was active.\n',
    );
  } else if (cleanupBuildIndex >= 0) {
    const buildNumber = normalizedBuildNumber(process.argv[cleanupBuildIndex + 1]);
    if (!buildNumber) {
      throw new Error('--cleanup-build requires the exact failed publish build number.');
    }
    const released = releaseHostingPublishLock({
      buildNumber,
      allowMissing: true,
    });
    process.stdout.write(
      released ? 'Released the failed Hosting publish lock.\n' : 'No Hosting publish lock was active.\n',
    );
  } else if (process.argv.includes('--cleanup')) {
    const ownerToken = normalizedBuildNumber(process.env.MINIMALIST_HOSTING_PUBLISH_OWNER);
    if (!ownerToken) {
      process.stdout.write('No owned Hosting publish lock was available for cleanup.\n');
      process.exit(0);
    }
    const released = releaseHostingPublishLock({
      ownerToken,
      allowMissing: true,
    });
    process.stdout.write(
      released ? 'Released the Hosting publish lock.\n' : 'No Hosting publish lock was active.\n',
    );
  } else {
    prepareHostingPublish();
  }
}
