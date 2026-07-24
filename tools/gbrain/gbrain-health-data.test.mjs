import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildHealthSnapshot, __test } from './gbrain-health-data.mjs';

test('summarizes graph integrity and weak nodes deterministically', () => {
  const summary = __test.summarizeGraph({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    links: [{ source: 'a', target: 'b' }],
  });
  assert.deepEqual(summary, {
    nodes: 3,
    relationships: 1,
    weak_nodes: 3,
    isolated_nodes: 1,
    missing_endpoint_edges: 0,
    self_loops: 0,
    duplicate_endpoint_pairs: 0,
    valid: true,
    weak_node_limit: 2,
    quality_passed: false,
  });
});

test('does not consider a missing or empty graph valid', () => {
  assert.equal(__test.summarizeGraph(null).valid, false);
  assert.equal(__test.summarizeGraph({ nodes: [], links: [] }).valid, false);
});

test('recognizes only the exact authority proxy registration', () => {
  const proxyPath = 'C:\\repo\\tools\\gbrain\\gbrain-authority-mcp-proxy.mjs';
  assert.deepEqual(__test.getMcpRegistration(`
[mcp_servers.gbrain]
command = 'node'
args = ['C:\\repo\\tools\\gbrain\\gbrain-authority-mcp-proxy.mjs']
`, proxyPath), { mode: 'authority-proxy', ready: true });
  assert.deepEqual(__test.getMcpRegistration(`
[mcp_servers.gbrain]
command = 'C:\\Users\\test\\gbrain.exe'
args = ["serve"]
`, proxyPath), { mode: 'legacy', ready: false });
  assert.equal(__test.getMcpRegistration('', proxyPath).ready, false);
});

test('mirror inventory requires exact provenance and rejects undeclared files', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'gbrain-mirror-health-'));
  const mirror = path.join(fixture, 'mirror');
  const sourceRoot = path.join(fixture, 'source');
  try {
    await mkdir(path.join(mirror, '.gbrain-meta'), { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    const content = '# note';
    const digest = createHash('sha256').update(content).digest('hex');
    await writeFile(path.join(mirror, 'note.md'), content);
    await writeFile(path.join(sourceRoot, 'note.md'), content);
    const writeManifest = (overrides = {}) => writeFile(
      path.join(mirror, '.gbrain-meta', 'manifest.json'),
      JSON.stringify({
        schema_version: 1,
        mirror_kind: 'minimalist-chat-vault',
        source_root: sourceRoot,
        file_count: 1,
        files: ['note.md'],
        file_sha256: { 'note.md': digest },
        ...overrides,
      }),
    );
    await writeManifest();
    assert.equal((await __test.readOwnedMirrorInventory(mirror, {
      expectedKind: 'minimalist-chat-vault', expectedSourceRoot: sourceRoot,
    })).verified, true);
    await writeFile(path.join(sourceRoot, 'note.md'), '# source changed after export');
    assert.equal((await __test.readOwnedMirrorInventory(mirror, {
      expectedKind: 'minimalist-chat-vault', expectedSourceRoot: sourceRoot,
    })).verified, false);
    await writeFile(path.join(sourceRoot, 'note.md'), content);
    await writeFile(path.join(mirror, 'note.md'), '# mirror changed after export');
    assert.equal((await __test.readOwnedMirrorInventory(mirror, {
      expectedKind: 'minimalist-chat-vault', expectedSourceRoot: sourceRoot,
    })).verified, false);
    await writeFile(path.join(mirror, 'note.md'), content);
    await writeManifest({ file_sha256: undefined });
    assert.equal((await __test.readOwnedMirrorInventory(mirror, {
      expectedKind: 'minimalist-chat-vault', expectedSourceRoot: sourceRoot,
    })).verified, false);
    await writeManifest();
    await writeFile(path.join(mirror, 'extra.md'), '# undeclared');
    assert.equal((await __test.readOwnedMirrorInventory(mirror, {
      expectedKind: 'minimalist-chat-vault', expectedSourceRoot: sourceRoot,
    })).verified, false);
    await rm(path.join(mirror, 'extra.md'));
    await writeManifest({ mirror_kind: 'wrong-kind' });
    assert.equal((await __test.readOwnedMirrorInventory(mirror, {
      expectedKind: 'minimalist-chat-vault', expectedSourceRoot: sourceRoot,
    })).verified, false);
    await writeManifest({ source_root: path.join(fixture, 'wrong-source') });
    assert.equal((await __test.readOwnedMirrorInventory(mirror, {
      expectedKind: 'minimalist-chat-vault', expectedSourceRoot: sourceRoot,
    })).verified, false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('owned exporters record and verify per-file SHA-256 without changing path arrays', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'gbrain-export-hashes-'));
  const userProfile = path.join(fixture, 'user');
  const codeRoot = path.join(fixture, 'code-source');
  const vaultRoot = path.join(fixture, 'vault-source');
  const codeDestination = path.join(userProfile, '.gbrain', 'sources', 'test-code');
  const vaultDestination = path.join(userProfile, '.gbrain', 'sources', 'test-vault');
  const codeContent = 'export const fixture = true;\n';
  const noteContent = '# Fixture note\n';
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
    assert.equal(result.status, 0, `${command} failed:\n${result.stderr || result.stdout}`);
    return result;
  };
  try {
    await mkdir(path.join(codeRoot, 'tools'), { recursive: true });
    await mkdir(path.join(vaultRoot, '90 Memory'), { recursive: true });
    await writeFile(path.join(codeRoot, 'tools', 'fixture.mjs'), codeContent);
    await writeFile(path.join(vaultRoot, '90 Memory', 'Fixture.md'), noteContent);
    run('git', ['init', '--initial-branch', 'main', codeRoot]);

    const environment = { ...process.env, USERPROFILE: userProfile };
    run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./Export-GBrainCodeSource.ps1', import.meta.url)),
      '-SourceRoot', codeRoot, '-Destination', codeDestination,
    ], { env: environment });
    run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./Export-GBrainVaultSource.ps1', import.meta.url)),
      '-SourceRoot', vaultRoot, '-Destination', vaultDestination,
    ], { env: environment });

    for (const [destination, relativePath, content] of [
      [codeDestination, 'tools/fixture.mjs', codeContent],
      [vaultDestination, '90 Memory/Fixture.md', noteContent],
    ]) {
      const manifest = JSON.parse(
        (await readFile(path.join(destination, '.gbrain-meta', 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''),
      );
      const digest = createHash('sha256').update(content).digest('hex');
      assert.deepEqual(manifest.files, [relativePath]);
      assert.deepEqual(manifest.file_sha256, { [relativePath]: digest });
      assert.equal(
        createHash('sha256').update(await readFile(path.join(destination, ...relativePath.split('/')))).digest('hex'),
        digest,
      );
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('builds one local-only snapshot from independent health artifacts', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'gbrain-health-'));
  const repoRoot = path.join(fixture, 'repo');
  const userProfile = path.join(fixture, 'user');
  const gbrainHome = path.join(userProfile, '.gbrain');
  try {
    const assetContent = Buffer.from('owned fixture timeline image');
    const assetSha256 = createHash('sha256').update(assetContent).digest('hex');
    const noteContent = '# note';
    const noteSha256 = createHash('sha256').update(noteContent).digest('hex');
    const codeContent = 'export {};';
    const codeSha256 = createHash('sha256').update(codeContent).digest('hex');
    const visionEntries = Array.from({ length: 6 }, (_, index) => ({
      source_image: `90 Memory/assets/project-timeline/2026-07-${String(index + 1).padStart(2, '0')}-fixture.png`,
      asset_sha256: assetSha256,
      note: `90 Memory/Timeline Vision/2026-07-${String(index + 1).padStart(2, '0')}-fixture.vision.md`,
      title: `Fixture vision ${index + 1}`,
      evidence_class: 'unknown',
    }));
    const visionMetadata = Buffer.from(JSON.stringify({
      schema_version: 1,
      image_count: 6,
      model: 'fixture-vision',
      model_digest: 'a'.repeat(64),
      entries: visionEntries,
    })).toString('base64url');
    const renderVisionSidecar = (entry) => {
      const sidecarMetadata = Buffer.from(JSON.stringify({
        schema_version: 1,
        prompt_version: 1,
        source_image: entry.source_image,
        asset_sha256: entry.asset_sha256,
        model: 'fixture-vision',
        model_digest: 'a'.repeat(64),
        vision_capability_verified: true,
      })).toString('base64url');
      const analysis = Buffer.from(JSON.stringify({
        schema_version: 1,
        title: entry.title,
        summary: 'A fixture description grounded in the local image.',
        visible_text: [],
        ui_elements: ['Fixture interface'],
        notable_details: ['Fixture detail'],
        uncertainty: [],
        evidence_class: entry.evidence_class,
      })).toString('base64url');
      return `<!-- gbrain-timeline-vision-meta ${sidecarMetadata} -->\n<!-- gbrain-timeline-vision-analysis ${analysis} -->`;
    };
    const maintenanceRecord = {
      success: true,
      mcp_restored: true,
      started_at: '2026-07-21T11:00:00.000Z',
      finished_at: '2026-07-21T12:00:00.000Z',
      backup: { verified: true, restore_drill_passed: true, page_count: 2, embedded_count: 3 },
      steps_performed: {
        backup: true,
        restore_drill: true,
        note_refresh: true,
        code_refresh: true,
        evaluation: true,
        relationships: true,
        vision: true,
      },
      relationships: {
        ok: true,
        outputs_regenerated: true,
        low_degree_reduction: 0,
        after: { nodes: 2, edges: 1, zero_degree_nodes: 0 },
      },
    };
    const evaluationRecord = {
      schema_version: 2,
      generated_at: '2026-07-21T12:00:00.000Z',
      qrels_schema_version: 2,
      qrels_path: path.join(repoRoot, 'gbrain-evals', 'qrels', 'minimalist-chat-v3.qrels.json'),
      summary: {
        cases: 100,
        hit_at_3_rate: 0.94,
        mean_recall_at_k: 0.95,
        mean_reciprocal_rank: 0.86,
        mean_ndcg_at_10: 0.87,
        expected_top1_hit_rate: 0.8,
        source_scope_pass_rate: 1,
        negative_check_pass_rate: 1,
        p95_latency_ms: 1400,
      },
      gate: {
        requested: true,
        passed: true,
        thresholds: {
          hit_at_3_rate: 0.8,
          mean_recall_at_k: 0.85,
          mean_reciprocal_rank: 0.72,
          mean_ndcg_at_10: 0.75,
          expected_top1_hit_rate: 0.6,
          source_scope_pass_rate: 1,
          negative_check_pass_rate: 0.85,
        },
        failures: [],
      },
    };
    await Promise.all([
      mkdir(path.join(gbrainHome, 'maintenance'), { recursive: true }),
      mkdir(path.join(gbrainHome, 'evals'), { recursive: true }),
      mkdir(path.join(gbrainHome, 'sources', 'minimalist-chat-vault'), { recursive: true }),
      mkdir(path.join(gbrainHome, 'sources', 'minimalist-chat-code'), { recursive: true }),
      mkdir(path.join(gbrainHome, 'sources', 'minimalist-chat-vault', '.gbrain-meta'), { recursive: true }),
      mkdir(path.join(gbrainHome, 'sources', 'minimalist-chat-code', '.gbrain-meta'), { recursive: true }),
      mkdir(path.join(repoRoot, 'Minimalist-chat-vault', 'graphify-out'), { recursive: true }),
      mkdir(path.join(repoRoot, 'Minimalist-chat-vault', '90 Memory', 'Timeline Vision'), { recursive: true }),
      mkdir(path.join(repoRoot, 'Minimalist-chat-vault', '90 Memory', 'assets', 'project-timeline'), { recursive: true }),
      mkdir(path.join(repoRoot, 'tools', 'gbrain'), { recursive: true }),
      mkdir(path.join(userProfile, '.codex'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(gbrainHome, 'maintenance', 'minimalist-chat-latest.json'), JSON.stringify(maintenanceRecord)),
      writeFile(path.join(gbrainHome, 'evals', 'minimalist-chat-latest.json'), JSON.stringify(evaluationRecord)),
      writeFile(path.join(repoRoot, 'Minimalist-chat-vault', 'graphify-out', 'graph.json'), JSON.stringify({
        nodes: [{ id: 'a' }, { id: 'b' }],
        links: [{ source: 'a', target: 'b' }],
      })),
      writeFile(path.join(gbrainHome, 'sources', 'minimalist-chat-vault', 'note.md'), noteContent),
      writeFile(path.join(gbrainHome, 'sources', 'minimalist-chat-code', 'code.js'), codeContent),
      writeFile(path.join(repoRoot, 'Minimalist-chat-vault', 'note.md'), noteContent),
      writeFile(path.join(repoRoot, 'code.js'), codeContent),
      writeFile(path.join(gbrainHome, 'sources', 'minimalist-chat-vault', '.gbrain-meta', 'manifest.json'), JSON.stringify({
        schema_version: 1,
        mirror_kind: 'minimalist-chat-vault',
        source_root: path.join(repoRoot, 'Minimalist-chat-vault'),
        generated_at: '2026-07-21T12:00:00.000Z',
        file_count: 1,
        files: ['note.md'],
        file_sha256: { 'note.md': noteSha256 },
      })),
      writeFile(path.join(gbrainHome, 'sources', 'minimalist-chat-code', '.gbrain-meta', 'manifest.json'), JSON.stringify({
        schema_version: 1,
        mirror_kind: 'minimalist-chat-code',
        source_root: repoRoot,
        generated_at: '2026-07-21T12:00:00.000Z',
        file_count: 1,
        files: ['code.js'],
        file_sha256: { 'code.js': codeSha256 },
      })),
      writeFile(path.join(repoRoot, 'tools', 'gbrain', 'gbrain-authority-mcp-proxy.mjs'), 'export {};'),
      writeFile(path.join(gbrainHome, 'config.json'), JSON.stringify({
        schema_pack: 'gbrain-base-v2',
        provider_base_urls: { ollama: 'http://127.0.0.1:11434/v1' },
      })),
      writeFile(path.join(userProfile, '.codex', 'config.toml'), `
[mcp_servers.gbrain]
command = 'node'
args = ['${path.join(repoRoot, 'tools', 'gbrain', 'gbrain-authority-mcp-proxy.mjs').replaceAll('\\', '\\\\')}']
`),
      writeFile(
        path.join(repoRoot, 'Minimalist-chat-vault', '90 Memory', 'Timeline Vision', 'Index.md'),
        `<!-- gbrain-timeline-vision-meta ${visionMetadata} -->`,
      ),
      ...visionEntries.map((entry) => writeFile(
        path.join(repoRoot, 'Minimalist-chat-vault', ...entry.note.split('/')),
        renderVisionSidecar(entry),
      )),
      ...visionEntries.map((entry) => writeFile(
        path.join(repoRoot, 'Minimalist-chat-vault', ...entry.source_image.split('/')),
        assetContent,
      )),
      writeFile(path.join(gbrainHome, 'evals', 'minimalist-chat-pack-v2-trial.json'), JSON.stringify({
        success: true,
        status: 'accepted',
        decision: { accepted: true },
        pack: { verification: { active: true } },
        safety: {
          active_config_unchanged: true,
          ollama_endpoint: 'http://127.0.0.1:11434/v1',
          endpoint_contract_verified: true,
          protected_ollama_port_absent_from_configuration: true,
        },
      })),
    ]);

    const snapshot = await buildHealthSnapshot({
      repoRoot,
      userProfile,
      now: new Date('2026-07-22T12:00:00.000Z'),
      scheduleProbe: async () => ({
        installed: true,
        live_verified: true,
        day_of_week: 'Sunday',
        at: '03:00',
        checked_at: '2026-07-22T12:00:00.000Z',
      }),
    });
    assert.equal(snapshot.status, 'healthy');
    assert.equal(snapshot.local_only, true);
    assert.equal(snapshot.metrics.pages, 2);
    assert.equal(snapshot.evaluation.cases, 100);
    assert.equal(snapshot.sources[0].count, 1);
    assert.equal(snapshot.sources[1].count, 1);
    assert.equal(snapshot.attention[0].status, 'ready');
    assert.equal(snapshot.attention[1].status, 'ready');
    assert.equal(snapshot.attention[2].status, 'passed');
    assert.equal(snapshot.maintenance.steps.every((step) => step.passed), true);
    assert.equal(snapshot.schedule.live_verified, true);

    const invalidEvaluations = [
      { ...evaluationRecord, schema_version: 999 },
      { ...evaluationRecord, gate: { ...evaluationRecord.gate, passed: 'true' } },
      {
        ...evaluationRecord,
        summary: { ...evaluationRecord.summary, expected_top1_hit_rate: 0.59 },
      },
      {
        ...evaluationRecord,
        qrels_path: path.join(repoRoot, 'elsewhere', 'minimalist-chat-v3.qrels.json'),
      },
      { ...evaluationRecord, gate: undefined },
    ];
    for (const invalidEvaluation of invalidEvaluations) {
      await writeFile(
        path.join(gbrainHome, 'evals', 'minimalist-chat-latest.json'),
        JSON.stringify(invalidEvaluation),
      );
      const invalidSnapshot = await buildHealthSnapshot({
        repoRoot,
        userProfile,
        now: new Date('2026-07-22T12:00:00.000Z'),
        scheduleProbe: async () => ({ installed: true, live_verified: true }),
      });
      assert.equal(invalidSnapshot.status, 'attention');
      assert.equal(invalidSnapshot.evaluation.ready, false);
    }
    await writeFile(
      path.join(gbrainHome, 'evals', 'minimalist-chat-latest.json'),
      JSON.stringify(evaluationRecord),
    );

    const firstVisionEntry = visionEntries[0];
    await writeFile(
      path.join(repoRoot, 'Minimalist-chat-vault', ...firstVisionEntry.note.split('/')),
      '<!-- gbrain-timeline-vision-meta e30 -->\n<!-- gbrain-timeline-vision-analysis e30 -->',
    );
    const corruptVisionSnapshot = await buildHealthSnapshot({
      repoRoot,
      userProfile,
      now: new Date('2026-07-22T12:00:00.000Z'),
      scheduleProbe: async () => ({ installed: true, live_verified: true }),
    });
    assert.equal(corruptVisionSnapshot.status, 'attention');
    assert.equal(corruptVisionSnapshot.attention[1].status, 'pending');

    await writeFile(
      path.join(repoRoot, 'Minimalist-chat-vault', ...firstVisionEntry.note.split('/')),
      renderVisionSidecar(firstVisionEntry),
    );
    await writeFile(
      path.join(gbrainHome, 'maintenance', 'minimalist-chat-latest.json'),
      JSON.stringify({ ...maintenanceRecord, steps_performed: { ...maintenanceRecord.steps_performed, vision: false } }),
    );
    const partialMaintenanceSnapshot = await buildHealthSnapshot({
      repoRoot,
      userProfile,
      now: new Date('2026-07-22T12:00:00.000Z'),
      scheduleProbe: async () => ({ installed: true, live_verified: true }),
    });
    assert.equal(partialMaintenanceSnapshot.status, 'attention');

    await writeFile(
      path.join(gbrainHome, 'maintenance', 'minimalist-chat-latest.json'),
      JSON.stringify(maintenanceRecord),
    );
    await writeFile(
      path.join(gbrainHome, 'evals', 'minimalist-chat-latest.json'),
      JSON.stringify({ ...evaluationRecord, qrels_schema_version: 1 }),
    );
    const legacySchemaSnapshot = await buildHealthSnapshot({
      repoRoot,
      userProfile,
      now: new Date('2026-07-22T12:00:00.000Z'),
      scheduleProbe: async () => ({ installed: true, live_verified: true }),
    });
    assert.equal(legacySchemaSnapshot.status, 'attention');
    assert.equal(legacySchemaSnapshot.evaluation.v3_complete, false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
