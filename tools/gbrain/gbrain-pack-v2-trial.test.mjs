import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  buildIsolatedEnvironment,
  compareEvaluations,
  inventoryTree,
  isDirectChild,
  isWithin,
  parseArgs,
  parseFollowResult,
  runPackTrial,
} from './gbrain-pack-v2-trial.mjs';
import {
  describeSourceProvenanceCatalogs,
  loadSourceProvenanceCatalogs,
  SOURCE_PROVENANCE_METHOD,
} from './gbrain-source-provenance.mjs';

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

test('database inventory excludes only explicitly named runtime entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-pack-inventory-'));
  try {
    writeFileSync(join(root, 'stable.bin'), 'stable');
    writeFileSync(join(root, '.gbrain-resolve.sock'), 'runtime');
    const inventory = inventoryTree(root, { excludeRelativePaths: ['.gbrain-resolve.sock'] });
    assert.deepEqual(inventory.files.map((entry) => entry.relative_path), ['stable.bin']);
    assert.throws(
      () => inventoryTree(root, { excludeRelativePaths: ['../outside'] }),
      /unsafe database inventory exclusion/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function evaluation({
  recall = 0.9,
  mrr = 0.8,
  ndcg = 0.82,
  rank = 1,
  gate = true,
  sourceProvenance = { mode: SOURCE_PROVENANCE_METHOD, catalogs: {} },
} = {}) {
  return {
    schema_version: 2,
    generated_at: '2026-07-22T00:00:00.000Z',
    qrels_path: 'qrels.json',
    k: 10,
    ranking: { mode: 'deterministic-authority-v1' },
    source_provenance: sourceProvenance,
    summary: {
      hit_at_3_rate: 0.9,
      mean_recall_at_k: recall,
      mean_reciprocal_rank: mrr,
      mean_ndcg_at_10: ndcg,
      expected_top1_hit_rate: 0.7,
      source_scope_pass_rate: 1,
      negative_check_pass_rate: 1,
      p95_latency_ms: 100,
    },
    per_category: {},
    gate: { passed: gate, thresholds: {}, failures: gate ? [] : [{ metric: 'mean_recall_at_k' }] },
    cases: [{
      query_id: 'one',
      metrics: { first_relevant_rank: rank },
      results: [{ source_provenance: { method: SOURCE_PROVENANCE_METHOD, status: 'verified', source_ids: ['default'] } }],
    }],
  };
}

function writeSourceMirror({ mirrorRoot, sourceRoot, mirrorKind, files }) {
  mkdirSync(join(mirrorRoot, '.gbrain-meta'), { recursive: true });
  const hashes = {};
  let totalBytes = 0;
  for (const [relativePath, content] of Object.entries(files)) {
    const sourceFile = join(sourceRoot, ...relativePath.split('/'));
    const mirrorFile = join(mirrorRoot, ...relativePath.split('/'));
    mkdirSync(dirname(sourceFile), { recursive: true });
    mkdirSync(dirname(mirrorFile), { recursive: true });
    writeFileSync(sourceFile, content);
    writeFileSync(mirrorFile, content);
    hashes[relativePath] = sha256(mirrorFile);
    totalBytes += statSync(mirrorFile).size;
  }
  writeFileSync(join(mirrorRoot, '.gbrain-meta', 'manifest.json'), `${JSON.stringify({
    schema_version: 1,
    mirror_kind: mirrorKind,
    source_root: sourceRoot,
    generated_at: '2026-07-22T00:00:00.000Z',
    file_count: Object.keys(files).length,
    total_bytes: totalBytes,
    files: Object.keys(files),
    file_sha256: hashes,
  }, null, 2)}\n`);
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-pack-v2-test-'));
  const activeHome = join(root, 'active', '.gbrain');
  const activeDatabase = join(activeHome, 'brain.pglite');
  const backups = join(activeHome, 'backups');
  const snapshot = join(backups, 'gbrain-pglite-20260721T233915576Z-02b044f8');
  const snapshotDatabase = join(snapshot, 'brain.pglite');
  const temporaryRoot = join(root, 'temp');
  mkdirSync(activeDatabase, { recursive: true });
  mkdirSync(backups);
  mkdirSync(snapshot);
  mkdirSync(temporaryRoot);
  writeFileSync(join(activeDatabase, 'state.bin'), 'active-database-state');
  const configPath = join(activeHome, 'config.json');
  writeFileSync(configPath, `${JSON.stringify({
    engine: 'pglite',
    database_path: activeDatabase,
    schema_pack: 'gbrain-base-v2',
    embedding_model: 'ollama:mxbai-embed-large',
    embedding_dimensions: 1024,
  }, null, 2)}\n`);
  cpSync(activeDatabase, snapshotDatabase, { recursive: true });
  const inventory = inventoryTree(snapshotDatabase);
  const rootId = '84aec0a7-17bd-4cae-8a16-c60ebe5be729';
  writeFileSync(join(backups, '.gbrain-backup-root.json'), JSON.stringify({
    schema_version: 1,
    kind: 'gbrain-pglite-backup-root',
    root_id: rootId,
    gbrain_home: activeHome,
    active_database: activeDatabase,
    created_at: '2026-07-21T22:55:32.582Z',
  }));
  writeFileSync(join(snapshot, 'manifest.json'), JSON.stringify({
    schema_version: 1,
    kind: 'gbrain-pglite-snapshot',
    backup_root_id: rootId,
    created_at: '2026-07-21T23:39:15.576Z',
    source_database: activeDatabase,
    source_config_path: configPath,
    source_config_sha256: sha256(configPath),
    verified: true,
    restore_drill_passed: true,
    database: { relative_path: 'brain.pglite', ...inventory },
  }, null, 2));
  const vaultSource = join(root, 'vault-source');
  const codeSource = join(root, 'code-source');
  const liveSourcesRoot = join(activeHome, 'sources');
  const vaultMirror = join(liveSourcesRoot, 'minimalist-chat-vault');
  const codeMirror = join(liveSourcesRoot, 'minimalist-chat-code');
  writeSourceMirror({
    mirrorRoot: vaultMirror,
    sourceRoot: vaultSource,
    mirrorKind: 'minimalist-chat-vault',
    files: { '10 Product/Overview.md': '# Trusted product overview\n' },
  });
  writeSourceMirror({
    mirrorRoot: codeMirror,
    sourceRoot: codeSource,
    mirrorKind: 'minimalist-chat-code',
    files: { 'src/main.js': 'export const trusted = true;\n' },
  });
  const qrelsPath = join(root, 'qrels.json');
  const evaluatorPath = join(root, 'evaluator.mjs');
  writeFileSync(qrelsPath, JSON.stringify({
    schema_version: 2,
    sources: {
      default: { kind: 'markdown', root: 'vault-source' },
      'minimalist-chat-code': { kind: 'code', root: 'code-source' },
    },
  }));
  writeFileSync(evaluatorPath, '// mock evaluator\n');
  return {
    root,
    activeHome,
    activeDatabase,
    configPath,
    snapshot,
    vaultSource,
    codeSource,
    liveSourcesRoot,
    vaultMirror,
    codeMirror,
    temporaryRoot,
    qrelsPath,
    evaluatorPath,
    reportPath: join(activeHome, 'evals', 'minimalist-chat-pack-v2-trial.json'),
  };
}

function mockRunner(calls, {
  failApply = false,
  untrustedTrial = false,
  afterBaselineEvaluation = null,
} = {}) {
  let pack = 'gbrain-base';
  let evaluationCount = 0;
  return (command, args, options) => {
    const isolatedConfigPath = join(options.env.GBRAIN_HOME, '.gbrain', 'config.json');
    const call = {
      command,
      args: [...args],
      options: { ...options, env: { ...options.env } },
      isolatedConfig: existsSync(isolatedConfigPath)
        ? JSON.parse(readFileSync(isolatedConfigPath, 'utf8'))
        : null,
      sourceProvenance: null,
      sourceCatalogModes: null,
    };
    calls.push(call);
    if (command === 'node-mock') {
      const output = args[args.indexOf('--output') + 1];
      const qrelsPath = args[args.indexOf('--qrels') + 1];
      const qrels = JSON.parse(readFileSync(qrelsPath, 'utf8'));
      const sourcesRoot = join(options.env.GBRAIN_HOME, '.gbrain', 'sources');
      const catalogs = loadSourceProvenanceCatalogs(qrels, qrelsPath, {
        sourcesRoot,
        verifyCurrentSources: !args.includes('--frozen-provenance'),
      });
      const sourceProvenance = {
        mode: SOURCE_PROVENANCE_METHOD,
        catalogs: describeSourceProvenanceCatalogs(catalogs),
      };
      const unavailableCatalog = Object.values(sourceProvenance.catalogs)
        .find((catalog) => catalog.status !== 'ready');
      if (unavailableCatalog) {
        throw new Error(unavailableCatalog.reason || 'source provenance catalog was unavailable');
      }
      if (untrustedTrial && evaluationCount === 1) {
        sourceProvenance.catalogs.default = {
          ...sourceProvenance.catalogs.default,
          status: 'unavailable',
          reason: 'synthetic catalog drift',
        };
      }
      call.sourceProvenance = sourceProvenance;
      call.sourceCatalogModes = Object.values(sourceProvenance.catalogs).map((catalog) => ({
        manifestPath: catalog.manifest_path,
        mode: statSync(catalog.manifest_path).mode & 0o777,
      }));
      const isBaseline = evaluationCount === 0;
      const metrics = isBaseline ? {} : { recall: 0.91, mrr: 0.81, ndcg: 0.83 };
      evaluationCount += 1;
      const report = evaluation({ ...metrics, sourceProvenance });
      writeFileSync(output, JSON.stringify(report));
      if (isBaseline && afterBaselineEvaluation) afterBaselineEvaluation({ args, options });
      return { stdout: '', stderr: '', status: 0 };
    }
    if (args[0] === 'schema' && args[1] === 'active') {
      return { stdout: `Active pack: ${pack} v1.0.0\n`, stderr: '', status: 0 };
    }
    if (args[0] === 'schema' && args[1] === 'use') {
      pack = args[2];
      return { stdout: '', stderr: '', status: 0 };
    }
    if (args[0] === 'jobs') {
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      if (params.apply && failApply) throw new Error('synthetic isolated apply failure');
      if (params.apply) pack = 'gbrain-base-v2';
      const result = {
        schema_version: 1,
        apply: params.apply,
        target_pack: params.target_pack,
        active_pack_flipped: params.apply,
        pack_identity_before: 'gbrain-base@1.0.0',
        pack_identity_after: params.apply ? 'gbrain-base-v2@1.0.0' : 'gbrain-base@1.0.0',
        stats_before: { total_pages: 1, distinct_types: 1 },
        stats_after: { total_pages: 1, distinct_types: 1 },
        per_phase: {},
        warnings: [],
      };
      return { stdout: `Job #1 completed in 0.1s\nResult: ${JSON.stringify(result)}\n`, stderr: '', status: 0 };
    }
    return { stdout: '{}\n', stderr: '', status: 0 };
  };
}

test('argument and structured-result parsing fail closed', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--timeout-ms', '10000']), {
    dryRun: true,
    snapshotPath: null,
    timeoutMs: 10000,
  });
  assert.throws(() => parseArgs(['--snapshot']), /requires a path/);
  assert.throws(() => parseArgs(['--timeout-ms', '9']), /10000/);
  assert.deepEqual(parseFollowResult('Result: {"apply":false}\n'), { apply: false });
  assert.throws(() => parseFollowResult('done'), /structured Result/);
});

test('isolated environment strips database overrides and pins tray Ollama', () => {
  const workspace = join(tmpdir(), 'workspace-example');
  const environment = buildIsolatedEnvironment({
    DATABASE_URL: 'postgres://wrong',
    GBRAIN_DATABASE_URL: 'postgres://wrong',
    GBRAIN_SCHEMA_PACK: 'wrong-pack',
    OLLAMA_HOST: '127.0.0.1:11435',
    PATH: 'safe',
  }, workspace);
  assert.equal(environment.GBRAIN_HOME, workspace);
  assert.equal(environment.OLLAMA_BASE_URL, 'http://127.0.0.1:11434/v1');
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.GBRAIN_DATABASE_URL, undefined);
  assert.equal(environment.GBRAIN_SCHEMA_PACK, undefined);
  assert.equal(environment.OLLAMA_HOST, undefined);
});

test('evaluation comparison rejects a per-query first-relevant-rank regression', () => {
  const baseline = evaluation({ rank: 1 });
  const trial = evaluation({ rank: 2 });
  const comparison = compareEvaluations(baseline, trial);
  assert.equal(comparison.regressions.length, 0);
  assert.equal(comparison.case_rank_regressions.length, 1);
  assert.equal(comparison.passed, false);
});

test('evaluation comparison enforces gates and explicit no-regression tolerances', () => {
  assert.equal(compareEvaluations(evaluation(), evaluation({ recall: 0.91, mrr: 0.795 })).passed, true);
  const failed = compareEvaluations(evaluation(), evaluation({ recall: 0.89, mrr: 0.78, rank: 2 }));
  assert.equal(failed.passed, false);
  assert.ok(failed.regressions.some((entry) => entry.metric === 'mean_recall_at_k'));
  assert.deepEqual(failed.case_rank_regressions, [{ query_id: 'one', before_rank: 1, after_rank: 2 }]);
});

test('dry run verifies the snapshot without creating a workspace or report', () => {
  const fixture = makeFixture();
  try {
    const report = runPackTrial({
      dryRun: true,
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: () => { throw new Error('dry run must not invoke commands'); },
    });
    assert.equal(report.status, 'validated');
    assert.equal(report.success, true);
    assert.equal(report.safety.live_source_catalogs_verified_before, true);
    assert.equal(report.safety.live_source_catalogs_verified_after, true);
    assert.equal(report.safety.live_source_catalogs_unchanged, true);
    assert.equal(report.safety.current_source_roots_match_frozen_catalog_after, true);
    assert.deepEqual(report.safety.current_source_root_drift, []);
    assert.equal(report.safety.active_database_unchanged, true);
    assert.equal(report.safety.source_catalog_count, 2);
    assert.equal(existsSync(fixture.reportPath), false);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('real trial runs every command inside a disposable clone and cleans it', () => {
  const fixture = makeFixture();
  const calls = [];
  const activeConfigBefore = sha256(fixture.configPath);
  const activeDatabaseBefore = sha256(join(fixture.activeDatabase, 'state.bin'));
  const liveVaultBefore = sha256(join(fixture.vaultMirror, '10 Product', 'Overview.md'));
  const liveCodeBefore = sha256(join(fixture.codeMirror, 'src', 'main.js'));
  const sourceVaultBefore = sha256(join(fixture.vaultSource, '10 Product', 'Overview.md'));
  const sourceCodeBefore = sha256(join(fixture.codeSource, 'src', 'main.js'));
  try {
    const report = runPackTrial({
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: mockRunner(calls),
      gbrainCommand: 'gbrain-mock',
      nodeCommand: 'node-mock',
      environment: { PATH: 'safe' },
    });
    assert.equal(report.status, 'accepted');
    assert.equal(report.decision.accepted, true);
    assert.equal(report.pack.baseline_reconstructed_in_clone, true);
    assert.equal(report.safety.disposable_workspace_deleted, true);
    assert.equal(report.safety.snapshot_inventory_verified_after, true);
    assert.equal(report.safety.active_config_unchanged, true);
    assert.equal(report.safety.active_database_unchanged, true);
    assert.equal(report.safety.live_source_catalogs_verified_before, true);
    assert.equal(report.safety.live_source_catalogs_verified_after, true);
    assert.equal(report.safety.live_source_catalogs_unchanged, true);
    assert.equal(report.safety.current_source_roots_match_frozen_catalog_after, true);
    assert.deepEqual(report.safety.current_source_root_drift, []);
    assert.equal(report.safety.isolated_source_catalogs_verified_before, true);
    assert.equal(report.safety.isolated_source_catalogs_verified_after, true);
    assert.equal(report.safety.isolated_source_catalogs_read_only, true);
    assert.equal(existsSync(fixture.reportPath), true);
    assert.equal(sha256(fixture.configPath), activeConfigBefore);
    assert.equal(sha256(join(fixture.activeDatabase, 'state.bin')), activeDatabaseBefore);
    assert.equal(sha256(join(fixture.vaultMirror, '10 Product', 'Overview.md')), liveVaultBefore);
    assert.equal(sha256(join(fixture.codeMirror, 'src', 'main.js')), liveCodeBefore);
    assert.equal(sha256(join(fixture.vaultSource, '10 Product', 'Overview.md')), sourceVaultBefore);
    assert.equal(sha256(join(fixture.codeSource, 'src', 'main.js')), sourceCodeBefore);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
    assert.ok(calls.length >= 7);
    for (const call of calls) {
      assert.equal(isDirectChild(fixture.temporaryRoot, call.options.env.GBRAIN_HOME), true);
      assert.equal(call.options.cwd, call.options.env.GBRAIN_HOME);
      assert.equal(call.options.env.OLLAMA_BASE_URL, 'http://127.0.0.1:11434/v1');
      assert.equal(JSON.stringify(call).includes('11435'), false);
      assert.equal(call.args.join(' ').includes(fixture.activeDatabase), false);
    }
    assert.equal(calls.some((call) => (
      call.args[0] === 'config' && call.args[1] === 'set' && call.args[2] === 'schema_pack'
    )), false);
    const baselineCalls = calls.filter((call) => call.options.env.GBRAIN_SCHEMA_PACK === 'gbrain-base');
    assert.ok(baselineCalls.some((call) => call.args[0] === 'schema' && call.args[1] === 'active'));
    assert.ok(baselineCalls.some((call) => call.command === 'node-mock'));
    assert.ok(baselineCalls.some((call) => call.args[0] === 'jobs'));
    const evaluationCalls = calls.filter((call) => call.command === 'node-mock');
    assert.equal(evaluationCalls.length, 2);
    for (const call of evaluationCalls) {
      assert.deepEqual(Object.keys(call.sourceProvenance.catalogs).sort(), ['default', 'minimalist-chat-code']);
      for (const catalog of Object.values(call.sourceProvenance.catalogs)) {
        assert.equal(catalog.status, 'ready');
        assert.equal(catalog.method, SOURCE_PROVENANCE_METHOD);
        assert.equal(isWithin(join(call.options.env.GBRAIN_HOME, '.gbrain', 'sources'), catalog.manifest_path), true);
      }
      assert.ok(call.sourceCatalogModes.every(({ mode }) => (mode & 0o222) === 0));
    }
    assert.deepEqual(
      report.evaluations.baseline.source_provenance,
      report.evaluations.trial.source_provenance,
    );
    const isolatedConfigCall = calls.find((call) => call.isolatedConfig);
    assert.equal(isolatedConfigCall.isolatedConfig.database_path.includes(fixture.activeDatabase), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('source-only drift after cloning is accepted and reported separately', () => {
  const fixture = makeFixture();
  const calls = [];
  try {
    const report = runPackTrial({
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: mockRunner(calls, {
        afterBaselineEvaluation: () => {
          writeFileSync(join(fixture.codeSource, 'src', 'main.js'), 'export const trusted = "edited during trial";\n');
        },
      }),
      gbrainCommand: 'gbrain-mock',
      nodeCommand: 'node-mock',
      environment: { PATH: 'safe' },
    });
    assert.equal(report.status, 'accepted');
    assert.equal(report.decision.accepted, true);
    assert.equal(report.safety.current_source_roots_match_frozen_catalog_before, true);
    assert.equal(report.safety.current_source_roots_match_frozen_catalog_after, false);
    assert.deepEqual(report.safety.current_source_root_drift, [{
      source_id: 'minimalist-chat-code',
      relative_path: 'src/main.js',
      reason: 'sha256_mismatch',
    }]);
    assert.equal(report.safety.live_source_catalogs_unchanged, true);
    assert.equal(report.safety.isolated_source_catalogs_verified_after, true);
    assert.equal(report.safety.active_database_unchanged, true);
    assert.equal(report.safety.disposable_workspace_deleted, true);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('live mirror drift after cloning rejects an otherwise green trial', () => {
  const fixture = makeFixture();
  const calls = [];
  try {
    const report = runPackTrial({
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: mockRunner(calls, {
        afterBaselineEvaluation: () => {
          writeFileSync(join(fixture.codeMirror, 'src', 'main.js'), 'export const mirrorWasMutated = true;\n');
        },
      }),
      gbrainCommand: 'gbrain-mock',
      nodeCommand: 'node-mock',
      environment: { PATH: 'safe' },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.decision.accepted, false);
    assert.match(report.error, /source provenance hash mismatch/);
    assert.equal(report.safety.live_source_catalogs_verified_after, false);
    assert.equal(report.safety.live_source_catalogs_unchanged, false);
    assert.equal(report.safety.isolated_source_catalogs_verified_after, true);
    assert.equal(report.safety.disposable_workspace_deleted, true);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('isolated clone drift after cloning rejects an otherwise green trial', () => {
  const fixture = makeFixture();
  const calls = [];
  try {
    const report = runPackTrial({
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: mockRunner(calls, {
        afterBaselineEvaluation: ({ options }) => {
          const clonedFile = join(
            options.env.GBRAIN_HOME,
            '.gbrain',
            'sources',
            'minimalist-chat-code',
            'src',
            'main.js',
          );
          chmodSync(clonedFile, 0o600);
          writeFileSync(clonedFile, 'export const cloneWasMutated = true;\n');
        },
      }),
      gbrainCommand: 'gbrain-mock',
      nodeCommand: 'node-mock',
      environment: { PATH: 'safe' },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.decision.accepted, false);
    assert.match(report.error, /source provenance hash mismatch/);
    assert.equal(report.safety.isolated_source_catalogs_verified_after, false);
    assert.equal(report.safety.isolated_source_catalogs_read_only, false);
    assert.equal(report.safety.live_source_catalogs_unchanged, true);
    assert.equal(report.safety.disposable_workspace_deleted, true);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('trial fails closed before child execution when trusted provenance cannot be cloned', () => {
  const fixture = makeFixture();
  const calls = [];
  try {
    writeFileSync(join(fixture.vaultMirror, '10 Product', 'Overview.md'), '# Tampered mirror\n');
    const report = runPackTrial({
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: mockRunner(calls),
      gbrainCommand: 'gbrain-mock',
      nodeCommand: 'node-mock',
      environment: { PATH: 'safe' },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.decision.accepted, false);
    assert.match(report.error, /provenance hash mismatch/);
    assert.equal(report.safety.live_source_catalogs_verified_before, false);
    assert.equal(report.safety.disposable_workspace_deleted, true);
    assert.equal(calls.length, 0);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('green trial metrics cannot bypass a non-ready isolated provenance catalog', () => {
  const fixture = makeFixture();
  const calls = [];
  try {
    const report = runPackTrial({
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: mockRunner(calls, { untrustedTrial: true }),
      gbrainCommand: 'gbrain-mock',
      nodeCommand: 'node-mock',
      environment: { PATH: 'safe' },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.decision.accepted, false);
    assert.match(report.error, /source-provenance catalog default was not ready/);
    assert.equal(report.safety.isolated_source_catalogs_verified_after, true);
    assert.equal(report.safety.live_source_catalogs_unchanged, true);
    assert.equal(report.safety.disposable_workspace_deleted, true);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('apply failure is reported, rejected, and still cleans the clone', () => {
  const fixture = makeFixture();
  const calls = [];
  try {
    const report = runPackTrial({
      activeHome: fixture.activeHome,
      temporaryRoot: fixture.temporaryRoot,
      qrelsPath: fixture.qrelsPath,
      evaluatorPath: fixture.evaluatorPath,
      reportPath: fixture.reportPath,
      commandRunner: mockRunner(calls, { failApply: true }),
      gbrainCommand: 'gbrain-mock',
      nodeCommand: 'node-mock',
      environment: { PATH: 'safe' },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.decision.accepted, false);
    assert.match(report.error, /synthetic isolated apply failure/);
    assert.equal(report.safety.disposable_workspace_deleted, true);
    assert.deepEqual(readdirSync(fixture.temporaryRoot), []);
    assert.equal(JSON.parse(readFileSync(fixture.reportPath, 'utf8')).status, 'failed');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
