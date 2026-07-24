import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeRumRelease } from '../src/features/performance/realUserPerformance.js';
import {
  MAX_PUBLISH_BUILD_NUMBER_LENGTH,
  createPublishBuildNumber,
} from './publish-build-number.mjs';
import {
  acquireHostingPublishLock,
  prepareHostingPublish,
  releaseCorruptHostingPublishLock,
  releaseHostingPublishLock,
  resolveFirebaseDeployInvocation,
  resolveNpmInvocation,
  runNpmCommand,
  verifyBuiltPublish,
} from './prepare-hosting-publish.mjs';
import { resolveRumReleaseId, resolveSourceBuildNumber } from './source-release-id.mjs';
import {
  verifyActiveHostingPublish,
  verifyPublishedBuild,
} from './verify-hosting-publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_VERSION = '1.0.0';

function builtIndex(buildNumber) {
  return [
    '<!doctype html>',
    `<script src="/load-css.js?v=8&build=${buildNumber}"></script>`,
    `<script src="/config.js?v=localai7&build=${buildNumber}"></script>`,
  ].join('\n');
}

function writeBuiltArtifact(distDir, environment, {
  index = builtIndex(environment.MINIMALIST_BUILD_NUMBER),
  compiledBuild = environment.MINIMALIST_BUILD_NUMBER,
} = {}) {
  const assetsDir = path.join(distDir, 'assets');
  const manifestDir = path.join(distDir, '.vite');
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(path.join(distDir, 'index.html'), index, 'utf8');
  writeFileSync(
    path.join(distDir, 'build-info.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      version: APP_VERSION,
      buildNumber: environment.MINIMALIST_BUILD_NUMBER,
      sourceRelease: environment.MINIMALIST_RUM_RELEASE_ID,
      publishedAt: environment.MINIMALIST_PUBLISH_STARTED_AT,
    })}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(manifestDir, 'manifest.json'),
    JSON.stringify({
      'index.html': {
        file: 'assets/index-test.js',
        src: 'index.html',
        isEntry: true,
      },
      'src/main.jsx': {
        file: 'assets/main-test.js',
        src: 'src/main.jsx',
        isDynamicEntry: true,
      },
      'src/features/settings/LanguageHelpSettings.jsx': {
        file: 'assets/settings-test.js',
        src: 'src/features/settings/LanguageHelpSettings.jsx',
        isDynamicEntry: true,
      },
    }),
    'utf8',
  );
  writeFileSync(path.join(assetsDir, 'index-test.js'), 'export{};', 'utf8');
  writeFileSync(path.join(assetsDir, 'main-test.js'), `"${compiledBuild}";`, 'utf8');
  writeFileSync(path.join(assetsDir, 'settings-test.js'), `"${compiledBuild}";`, 'utf8');
}

function fakeBuildFor(distDir, options) {
  return ({ environment }) => writeBuiltArtifact(distDir, environment, options);
}

function testEnvironment(extra = {}) {
  return {
    MINIMALIST_APP_VERSION: APP_VERSION,
    ...extra,
  };
}

test('identical source publishes receive distinct normalized build numbers', () => {
  const now = new Date('2026-07-24T01:23:45.678Z');
  const first = createPublishBuildNumber({
    sourceRevision: 'abcdef12-dirty-123456789abc',
    now,
    nonce: '00000001',
  });
  const second = createPublishBuildNumber({
    sourceRevision: 'abcdef12-dirty-123456789abc',
    now,
    nonce: '00000002',
  });

  assert.notEqual(first, second);
  assert.match(first, /^p20260724T012345678Z-00000001-abcdef12$/);
  assert.ok(first.length <= MAX_PUBLISH_BUILD_NUMBER_LENGTH);
  assert.notEqual(
    normalizeRumRelease(APP_VERSION, first),
    normalizeRumRelease(APP_VERSION, second),
    'the uniqueness prefix must survive legacy release-label truncation',
  );
});

test('the common predeploy always allocates, gates, builds, and locks one fresh identity', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'minimalist-publish-common-'));
  const distDir = path.join(root, 'dist');
  const lockDir = path.join(root, 'publish.lock');
  t.after(() => rm(root, { recursive: true, force: true }));
  let gateRelease = '';
  const oldBuild = 'p20260723T000000000Z-deadbeef-oldbuild';

  const info = prepareHostingPublish({
    distDir,
    lockDir,
    environment: testEnvironment({
      MINIMALIST_BUILD_NUMBER: oldBuild,
      MINIMALIST_HOSTING_BUILD_READY: 'true',
      MINIMALIST_HOSTING_PUBLISH_OWNER: 'owner-one',
    }),
    gate: ({ environment }) => {
      gateRelease = environment.MINIMALIST_RUM_RELEASE_ID;
    },
    build: fakeBuildFor(distDir),
    now: new Date('2026-07-24T01:24:00.000Z'),
    nonce: '12345678',
    firebaseInvocation: { processId: 100, dryRun: false },
  });

  assert.notEqual(info.buildNumber, oldBuild, 'reusable environment flags cannot reuse a build');
  assert.match(info.buildNumber, /^p20260724T012400000Z-12345678-/);
  assert.equal(info.sourceRelease, gateRelease);
  assert.equal(info.ownerToken, 'owner-one');
  assert.equal(existsSync(lockDir), true);
  verifyBuiltPublish({
    distDir,
    buildNumber: info.buildNumber,
    sourceRelease: info.sourceRelease,
    appVersion: APP_VERSION,
  });
  releaseHostingPublishLock({
    lockDir,
    ownerToken: info.ownerToken,
    buildNumber: info.buildNumber,
  });
});

test('two identical-source predeploys allocate different build IDs', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'minimalist-publish-unique-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = new Date('2026-07-24T02:00:00.000Z');
  const builds = [];

  for (const [name, nonce] of [['first', '11111111'], ['second', '22222222']]) {
    const distDir = path.join(root, name, 'dist');
    const lockDir = path.join(root, name, 'publish.lock');
    const info = prepareHostingPublish({
      distDir,
      lockDir,
      environment: testEnvironment(),
      gate: () => {},
      build: fakeBuildFor(distDir),
      now,
      nonce,
    });
    builds.push(info.buildNumber);
    releaseHostingPublishLock({
      lockDir,
      ownerToken: info.ownerToken,
      buildNumber: info.buildNumber,
    });
  }
  assert.notEqual(builds[0], builds[1]);
});

test('artifact verification requires exact bootstrap URLs, Vite identity, and compiled consumers', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'minimalist-publish-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = {
    MINIMALIST_BUILD_NUMBER: 'publish-new',
    MINIMALIST_RUM_RELEASE_ID: '1.0.0-source',
    MINIMALIST_PUBLISH_STARTED_AT: '2026-07-24T02:00:00.000Z',
  };

  writeBuiltArtifact(root, environment, {
    index: '<script src="/other.js?build=publish-new"></script>\n'
      + '<script src="/again.js?build=publish-new"></script>',
  });
  assert.throws(
    () => verifyBuiltPublish({
      distDir: root,
      buildNumber: 'publish-new',
      sourceRelease: '1.0.0-source',
      appVersion: APP_VERSION,
    }),
    /exactly one \/load-css\.js/,
  );

  writeBuiltArtifact(root, environment, { compiledBuild: 'publish-old' });
  assert.throws(
    () => verifyBuiltPublish({
      distDir: root,
      buildNumber: 'publish-new',
      sourceRelease: '1.0.0-source',
      appVersion: APP_VERSION,
    }),
    /does not contain build publish-new/,
  );
});

test('the common lifecycle lock rejects concurrent publishers and protects ownership', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'minimalist-publish-lock-'));
  const lockDir = path.join(root, 'publish.lock');
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = {
    ownerToken: 'owner-one',
    buildNumber: 'publish-one',
    startedAt: '2026-07-24T02:00:00.000Z',
  };
  acquireHostingPublishLock({
    lockDir,
    state: first,
    now: new Date('2026-07-24T02:00:00.000Z'),
  });
  assert.throws(
    () => acquireHostingPublishLock({
      lockDir,
      state: {
        ownerToken: 'owner-two',
        buildNumber: 'publish-two',
        startedAt: '2026-07-24T02:00:01.000Z',
      },
      now: new Date('2026-07-24T02:00:01.000Z'),
    }),
    /publish-one already owns/,
  );
  assert.throws(
    () => releaseHostingPublishLock({ lockDir, ownerToken: 'owner-two' }),
    /owned by another process/,
  );
  assert.throws(
    () => releaseHostingPublishLock({ lockDir, buildNumber: 'publish-two' }),
    /another build/,
  );
  releaseHostingPublishLock({ lockDir, buildNumber: 'publish-one' });
});

test('lock publication is complete and corrupt legacy locks have an explicit safe recovery', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'minimalist-publish-corrupt-'));
  const lockDir = path.join(root, 'publish.lock');
  t.after(() => rm(root, { recursive: true, force: true }));

  mkdirSync(lockDir);
  writeFileSync(
    path.join(lockDir, 'state.json'),
    '{"ownerToken":1,"buildNumber":2}\n',
    'utf8',
  );
  assert.throws(
    () => acquireHostingPublishLock({
      lockDir,
      state: { ownerToken: 'owner', buildNumber: 'publish-new' },
    }),
    /--cleanup-corrupt-lock/,
  );
  assert.equal(releaseCorruptHostingPublishLock({ lockDir }), true);

  acquireHostingPublishLock({
    lockDir,
    state: { ownerToken: 'owner', buildNumber: 'publish-new' },
  });
  assert.doesNotThrow(() => JSON.parse(
    String(readFileSync(path.join(lockDir, 'state.json'))),
  ));
  assert.throws(
    () => releaseCorruptHostingPublishLock({ lockDir }),
    /state is valid/,
  );
  releaseHostingPublishLock({ lockDir, ownerToken: 'owner' });
});

test('Firebase dry-run ancestry is detected and releases lifecycle state after validation', async (t) => {
  const invocation = resolveFirebaseDeployInvocation({
    currentPid: 30,
    environment: {},
    processes: [
      { pid: 10, parentPid: 1, commandLine: 'node firebase.js deploy --only hosting --dry-run' },
      { pid: 20, parentPid: 10, commandLine: 'node cross-env-shell.js prepare' },
      { pid: 30, parentPid: 20, commandLine: 'node tools/prepare-hosting-publish.mjs' },
    ],
  });
  assert.deepEqual(invocation, { processId: 10, dryRun: true });

  const helperUrl = pathToFileURL(path.join(ROOT, 'tools', 'prepare-hosting-publish.mjs')).href;
  const childCode = `import(${JSON.stringify(helperUrl)}).then((module) => {`
    + 'process.stdout.write(JSON.stringify(module.resolveFirebaseDeployInvocation()));'
    + '});';
  const parentCode = 'const { spawnSync } = require("node:child_process");'
    + `const result = spawnSync(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(childCode)}], `
    + '{ encoding: "utf8" });'
    + 'process.stdout.write(result.stdout || "");'
    + 'process.stderr.write(result.stderr || "");'
    + 'process.exit(result.status ?? 1);';
  const ancestryResult = spawnSync(
    process.execPath,
    ['-e', parentCode, 'firebase.js', 'deploy', '--only', 'hosting', '--dry-run'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(ancestryResult.status, 0, ancestryResult.stderr);
  assert.equal(JSON.parse(ancestryResult.stdout).dryRun, true);

  const root = await mkdtemp(path.join(tmpdir(), 'minimalist-publish-dry-run-'));
  const distDir = path.join(root, 'dist');
  const lockDir = path.join(root, 'publish.lock');
  t.after(() => rm(root, { recursive: true, force: true }));
  prepareHostingPublish({
    distDir,
    lockDir,
    environment: testEnvironment(),
    gate: () => {},
    build: fakeBuildFor(distDir),
    now: new Date('2026-07-24T02:30:00.000Z'),
    nonce: 'd0f0feed',
    firebaseInvocation: invocation,
  });
  assert.equal(existsSync(lockDir), false);
});

test('Windows npm execution goes through cmd.exe and works on the real runtime', () => {
  const invocation = resolveNpmInvocation({
    args: ['--version'],
    environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    platform: 'win32',
  });
  assert.deepEqual(invocation, {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd', '--version'],
  });
  if (process.platform === 'win32') {
    const result = runNpmCommand({
      args: ['--version'],
      environment: process.env,
      cwd: ROOT,
      stdio: 'pipe',
    });
    assert.equal(result.status, 0);
  }
});

test('postdeploy verification retries exact identity and bounds stalled requests', async () => {
  let attempts = 0;
  const live = await verifyPublishedBuild({
    expectedBuildNumber: 'publish-two',
    retryDelayMs: 0,
    requestTimeoutMs: 50,
    fetchImpl: async () => {
      attempts += 1;
      return {
        ok: true,
        async json() {
          return { buildNumber: attempts === 1 ? 'publish-one' : 'publish-two' };
        },
      };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(live.buildNumber, 'publish-two');

  let stalledAttempts = 0;
  await assert.rejects(
    verifyPublishedBuild({
      expectedBuildNumber: 'publish-three',
      attempts: 2,
      retryDelayMs: 0,
      requestTimeoutMs: 5,
      fetchImpl: async () => {
        stalledAttempts += 1;
        return new Promise(() => {});
      },
    }),
    /timed out after 5 ms/,
  );
  assert.equal(stalledAttempts, 2);

  let stalledBodyAttempts = 0;
  await assert.rejects(
    verifyPublishedBuild({
      expectedBuildNumber: 'publish-four',
      attempts: 2,
      retryDelayMs: 0,
      requestTimeoutMs: 5,
      fetchImpl: async () => {
        stalledBodyAttempts += 1;
        return {
          ok: true,
          json: () => new Promise(() => {}),
        };
      },
    }),
    /timed out after 5 ms/,
  );
  assert.equal(stalledBodyAttempts, 2);
});

test('postdeploy reads immutable lock state, matches metadata, and releases the lock', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'minimalist-publish-postdeploy-'));
  const distDir = path.join(root, 'dist');
  const lockDir = path.join(root, 'publish.lock');
  t.after(() => rm(root, { recursive: true, force: true }));
  const info = prepareHostingPublish({
    distDir,
    lockDir,
    environment: testEnvironment({
      MINIMALIST_HOSTING_PUBLISH_OWNER: 'postdeploy-owner',
      MINIMALIST_HOSTING_VERIFY_ORIGIN: 'https://preview.example',
    }),
    gate: () => {},
    build: fakeBuildFor(distDir),
    now: new Date('2026-07-24T03:00:00.000Z'),
    nonce: '87654321',
  });
  const requested = [];
  const live = await verifyActiveHostingPublish({
    distDir,
    lockDir,
    retryDelayMs: 0,
    requestTimeoutMs: 50,
    fetchImpl: async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            version: APP_VERSION,
            buildNumber: info.buildNumber,
            sourceRelease: info.sourceRelease,
          };
        },
      };
    },
  });
  assert.equal(live.buildNumber, info.buildNumber);
  assert.match(requested[0], /^https:\/\/preview\.example\/build-info\.json\?/);
  assert.equal(existsSync(lockDir), false);
});

test('Vite and every publisher share one deterministic source/RUM release implementation', async () => {
  const sourceBuild = resolveSourceBuildNumber({ cwd: ROOT });
  const release = resolveRumReleaseId({
    environment: {},
    appVersion: APP_VERSION,
    sourceBuildNumber: sourceBuild,
    cwd: ROOT,
  });
  const [vite, guardedDeploy, stripeDeploy] = await Promise.all([
    readFile(path.join(ROOT, 'vite.config.js'), 'utf8'),
    readFile(path.join(ROOT, 'tools/deploy-firebase-hourly.ps1'), 'utf8'),
    readFile(path.join(ROOT, 'tools/deploy-stripe-billing.ps1'), 'utf8'),
  ]);
  assert.match(release, /^1\.0\.0-[A-Za-z0-9._-]+$/);
  assert.notEqual(
    resolveRumReleaseId({
      environment: {},
      appVersion: 'v'.repeat(64),
      sourceBuildNumber: 'source-a'.repeat(12),
    }),
    resolveRumReleaseId({
      environment: {},
      appVersion: 'v'.repeat(64),
      sourceBuildNumber: 'source-b'.repeat(12),
    }),
  );
  assert.match(vite, /source-release-id\.mjs/);
  assert.doesNotMatch(guardedDeploy, /Get-DeterministicSourceBuildNumber/);
  assert.doesNotMatch(stripeDeploy, /Remove-Item Env:MINIMALIST_RUM_RELEASE_ID/);
});

test('every repository Hosting path uses the common allocation, gate, lock, and verifier', async () => {
  const [
    firebase,
    vite,
    prepare,
    verify,
    guardedDeploy,
    stripeDeploy,
    packageJson,
  ] = await Promise.all([
    readFile(path.join(ROOT, 'firebase.json'), 'utf8'),
    readFile(path.join(ROOT, 'vite.config.js'), 'utf8'),
    readFile(path.join(ROOT, 'tools/prepare-hosting-publish.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'tools/verify-hosting-publish.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'tools/deploy-firebase-hourly.ps1'), 'utf8'),
    readFile(path.join(ROOT, 'tools/deploy-stripe-billing.ps1'), 'utf8'),
    readFile(path.join(ROOT, 'package.json'), 'utf8'),
  ]);
  const firebaseConfig = JSON.parse(firebase);
  const scripts = JSON.parse(packageJson).scripts;
  assert.deepEqual(firebaseConfig.hosting.predeploy, ['node tools/prepare-hosting-publish.mjs']);
  assert.deepEqual(firebaseConfig.hosting.postdeploy, ['node tools/verify-hosting-publish.mjs']);
  assert.match(prepare, /REQUIRE_RUM_PERFORMANCE_GATE: 'true'/);
  assert.match(prepare, /acquireHostingPublishLock/);
  assert.doesNotMatch(prepare, /MINIMALIST_HOSTING_BUILD_READY/);
  assert.match(verify, /requestTimeoutMs = 5000/);
  assert.match(guardedDeploy, /StartsWith\('hosting:'\)/);
  assert.match(guardedDeploy, /MINIMALIST_HOSTING_PUBLISH_OWNER/);
  assert.match(stripeDeploy, /MINIMALIST_HOSTING_PUBLISH_OWNER/);
  assert.ok(
    stripeDeploy.indexOf('$env:MINIMALIST_HOSTING_PUBLISH_OWNER = [guid]::NewGuid()')
      < stripeDeploy.indexOf('Push-Location $repoRoot'),
    'Stripe must claim a fresh cleanup owner before any fallible setup work',
  );
  assert.doesNotMatch(stripeDeploy, /& node\s+\$hostingPublishGuard/);
  assert.match(vite, /emit-hosting-build-info/);
  assert.match(scripts.test, /npm run audit:release/);
});
