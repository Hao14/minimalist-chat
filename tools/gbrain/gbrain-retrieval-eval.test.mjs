import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import {
  calculateCaseMetrics,
  loadAuthorityCatalog,
  summarizeCases,
  validateQrels,
} from './gbrain-retrieval-eval.mjs';
import {
  loadSourceProvenanceCatalogs,
  resolveResultSourceProvenance,
} from './gbrain-source-provenance.mjs';

const baseEntry = {
  query_id: 'graded',
  category: 'unit',
  query: 'current project overview',
  source_id: 'default',
  relevant: [
    { source_id: 'default', slug: 'current', grade: 3 },
    { source_id: 'default', slug: 'memory', grade: 1 },
  ],
  expected_top1: { source_id: 'default', slug: 'current' },
  forbidden: [{ source_id: 'default', slug: 'legacy' }],
  forbidden_sources: ['minimalist-chat-code'],
  forbidden_top_k: 2,
  has_negative_check: true,
};

test('accepts V1 qrels and upgrades implicit grades without mutating the input', () => {
  const input = {
    schema_version: 1,
    queries: [{
      query_id: 'one',
      query: 'Where is the setup?',
      relevant_slugs: ['90-memory/gbrain-setup'],
      first_relevant_slug: '90-memory/gbrain-setup',
    }],
  };
  const normalized = validateQrels(input);
  assert.equal(normalized.queries[0].relevant[0].grade, 3);
  assert.equal(normalized.queries[0].category, 'uncategorized');
  assert.equal(input.queries[0].relevant, undefined);
});

test('computes graded nDCG and catches forbidden results in the configured window', () => {
  const results = [
    { source_id: 'default', slug: 'current' },
    { source_id: 'default', slug: 'legacy' },
    { source_id: 'default', slug: 'memory' },
  ];
  const metrics = calculateCaseMetrics(baseEntry, results, 3);
  assert.equal(metrics.hit_at_3, true);
  assert.equal(metrics.recall_at_k, 1);
  assert.equal(metrics.expected_top1_hit, true);
  assert.equal(metrics.negative_check_pass, false);
  assert.deepEqual(metrics.forbidden_hits, [{ source_id: 'default', slug: 'legacy' }]);
  assert.ok(metrics.ndcg_at_10 > 0.9 && metrics.ndcg_at_10 < 1);
});

test('deduplicates document identities before rank metrics and keeps nDCG bounded', () => {
  const metrics = calculateCaseMetrics({
    ...baseEntry,
    forbidden: [],
    forbidden_sources: [],
    has_negative_check: false,
  }, [
    { source_id: 'default', slug: 'current' },
    { source_id: 'default', slug: 'current' },
    { source_id: 'default', slug: 'memory' },
  ], 3);

  assert.equal(metrics.unique_result_count, 2);
  assert.equal(metrics.duplicate_result_count, 1);
  assert.equal(metrics.recall_at_k, 1);
  assert.equal(metrics.reciprocal_rank, 1);
  assert.equal(metrics.ndcg_at_10, 1);
  assert.ok(metrics.ndcg_at_10 <= 1);
});

test('duplicate safe results cannot push a forbidden identity outside the negative window', () => {
  const metrics = calculateCaseMetrics({
    ...baseEntry,
    forbidden_sources: [],
    forbidden_top_k: 2,
  }, [
    { source_id: 'default', slug: 'current' },
    { source_id: 'default', slug: 'current' },
    { source_id: 'default', slug: 'legacy' },
  ], 3);

  assert.equal(metrics.duplicate_result_count, 1);
  assert.deepEqual(metrics.forbidden_hits, [{ source_id: 'default', slug: 'legacy' }]);
  assert.equal(metrics.negative_check_pass, false);
});

test('reports p95 latency and isolates negative-only checks from retrieval averages', () => {
  const retrieval = Array.from({ length: 20 }, (_, index) => ({
    category: 'retrieval',
    latency_ms: { total: index + 1 },
    metrics: {
      hit_at_3: true,
      recall_at_k: 1,
      reciprocal_rank: 1,
      ndcg_at_10: 1,
      first_relevant_rank: 1,
      expected_top1_hit: true,
      source_scope_pass: true,
      negative_check_pass: null,
    },
  }));
  const negativeOnly = {
    category: 'negative',
    latency_ms: { total: 100 },
    metrics: {
      hit_at_3: null,
      recall_at_k: null,
      reciprocal_rank: null,
      ndcg_at_10: null,
      first_relevant_rank: null,
      expected_top1_hit: null,
      source_scope_pass: true,
      negative_check_pass: true,
    },
  };
  const summary = summarizeCases([...retrieval, negativeOnly], 10);
  assert.equal(summary.cases, 21);
  assert.equal(summary.retrieval_cases, 20);
  assert.equal(summary.mean_recall_at_k, 1);
  assert.equal(summary.negative_check_pass_rate, 1);
  assert.equal(summary.duplicate_result_count, 0);
  assert.equal(summary.cases_with_duplicate_results, 0);
  assert.equal(summary.p95_latency_ms, 20);
});

test('rejects contradictory and source-ambiguous judgments', () => {
  assert.throws(() => validateQrels({
    schema_version: 2,
    queries: [{
      query_id: 'bad',
      query: 'bad',
      relevant: [{ source_id: 'default', slug: 'same' }],
      forbidden: [{ source_id: 'default', slug: 'same' }],
    }],
  }), /both relevant and forbidden/);
});

function provenanceCatalogs(entries) {
  return new Map(entries.map(([sourceId, slugs]) => [sourceId, {
    source_id: sourceId,
    status: 'ready',
    slugs: new Set(slugs),
    verify_slug: (slug) => slugs.includes(slug),
  }]));
}

test('does not accept a requested source id as verified result provenance', () => {
  const metrics = calculateCaseMetrics({
    ...baseEntry,
    relevant: [],
    forbidden: [],
    check_source_scope: true,
    requires_verified_provenance: true,
  }, [{
    source_id: 'default',
    slug: '90-memory/gbrain-setup',
  }], 10);

  assert.equal(metrics.source_scope_pass, false);
  assert.deepEqual(metrics.source_scope_failures, [{
    slug: '90-memory/gbrain-setup',
    status: 'unverified',
    source_ids: ['default'],
  }]);
});

test('detects a cross-source result even when the CLI row carries the requested source id', () => {
  const results = resolveResultSourceProvenance([{
    source_id: 'default',
    slug: 'src-features-ai-airesponseformatting-js',
  }], provenanceCatalogs([
    ['default', ['90-memory/gbrain-setup']],
    ['minimalist-chat-code', ['src-features-ai-airesponseformatting-js']],
  ]), { requestedSourceId: 'default' });

  const metrics = calculateCaseMetrics({
    ...baseEntry,
    relevant: [],
    forbidden: [],
    check_source_scope: true,
  }, results, 10);

  assert.equal(results[0].requested_source_id, 'default');
  assert.equal(results[0].source_id, 'minimalist-chat-code');
  assert.equal(metrics.source_scope_pass, false);
  assert.deepEqual(metrics.forbidden_source_hits, [{
    source_id: 'minimalist-chat-code',
    slug: 'src-features-ai-airesponseformatting-js',
  }]);
});

test('fails closed when a returned slug cannot be resolved to a trusted source catalog', () => {
  const results = resolveResultSourceProvenance([{
    source_id: 'default',
    slug: 'invented-or-stale-slug',
  }], provenanceCatalogs([
    ['default', ['90-memory/gbrain-setup']],
    ['minimalist-chat-code', ['src-app-jsx']],
  ]), { requestedSourceId: 'default' });

  const metrics = calculateCaseMetrics({
    ...baseEntry,
    relevant: [],
    forbidden: [],
    check_source_scope: true,
  }, results, 10);

  assert.equal(results[0].source_id, null);
  assert.equal(results[0].source_provenance.status, 'unresolved');
  assert.equal(metrics.source_scope_pass, false);
  assert.deepEqual(metrics.source_scope_failures, [{
    slug: 'invented-or-stale-slug',
    status: 'unresolved',
    source_ids: [],
  }]);
});

test('fails closed and flags a forbidden source when a slug exists in multiple source catalogs', () => {
  const results = resolveResultSourceProvenance([{
    source_id: 'default',
    slug: 'shared-slug',
  }], provenanceCatalogs([
    ['default', ['shared-slug']],
    ['minimalist-chat-code', ['shared-slug']],
  ]), { requestedSourceId: 'default' });

  const metrics = calculateCaseMetrics({
    ...baseEntry,
    relevant: [],
    forbidden: [],
    check_source_scope: true,
  }, results, 10);

  assert.equal(results[0].source_id, null);
  assert.equal(results[0].source_provenance.status, 'ambiguous');
  assert.equal(metrics.source_scope_pass, false);
  assert.deepEqual(metrics.forbidden_source_hits, [{
    source_id: 'minimalist-chat-code',
    slug: 'shared-slug',
  }]);
});

test('builds trusted source inventories from manifests matched to declared source roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-provenance-'));
  try {
    const qrelsDirectory = join(root, 'qrels');
    const notesRoot = join(root, 'notes-source');
    const codeRoot = join(root, 'code-source');
    const sourcesRoot = join(root, 'gbrain', 'sources');
    const notesMirror = join(sourcesRoot, 'notes');
    const codeMirror = join(sourcesRoot, 'code');
    mkdirSync(join(notesMirror, '.gbrain-meta'), { recursive: true });
    mkdirSync(join(codeMirror, '.gbrain-meta'), { recursive: true });
    mkdirSync(qrelsDirectory, { recursive: true });
    mkdirSync(notesRoot, { recursive: true });
    mkdirSync(codeRoot, { recursive: true });
    const noteContent = '# Project Plan\n';
    const codeContent = 'export default null;\n';
    writeFileSync(join(notesMirror, 'Project Plan.md'), noteContent, 'utf8');
    writeFileSync(join(notesRoot, 'Project Plan.md'), noteContent, 'utf8');
    mkdirSync(join(codeMirror, 'src'), { recursive: true });
    mkdirSync(join(codeRoot, 'src'), { recursive: true });
    writeFileSync(join(codeMirror, 'src', 'app.jsx'), codeContent, 'utf8');
    writeFileSync(join(codeRoot, 'src', 'app.jsx'), codeContent, 'utf8');
    writeFileSync(join(notesMirror, '.gbrain-meta', 'manifest.json'), JSON.stringify({
      schema_version: 1,
      mirror_kind: 'minimalist-chat-vault',
      source_root: notesRoot,
      files: ['Project Plan.md'],
      file_count: 1,
      total_bytes: Buffer.byteLength(noteContent),
      file_sha256: { 'Project Plan.md': createHash('sha256').update(noteContent).digest('hex') },
    }), 'utf8');
    writeFileSync(join(codeMirror, '.gbrain-meta', 'manifest.json'), JSON.stringify({
      schema_version: 1,
      mirror_kind: 'minimalist-chat-code',
      source_root: codeRoot,
      files: ['src/app.jsx'],
      file_count: 1,
      total_bytes: Buffer.byteLength(codeContent),
      file_sha256: { 'src/app.jsx': createHash('sha256').update(codeContent).digest('hex') },
    }), 'utf8');

    const qrelsPath = join(qrelsDirectory, 'qrels.json');
    const catalogs = loadSourceProvenanceCatalogs({
      sources: {
        default: { kind: 'markdown', root: relative(qrelsDirectory, notesRoot) },
        code: { kind: 'code', root: relative(qrelsDirectory, codeRoot) },
      },
    }, qrelsPath, { sourcesRoot });

    assert.equal(catalogs.get('default').status, 'ready');
    assert.deepEqual([...catalogs.get('default').slugs], ['project-plan']);
    assert.equal(catalogs.get('code').status, 'ready');
    assert.deepEqual([...catalogs.get('code').slugs], ['src-app-jsx']);
    const authorityCatalog = loadAuthorityCatalog({
      sources: {
        default: { kind: 'markdown', root: relative(qrelsDirectory, notesRoot) },
        code: { kind: 'code', root: relative(qrelsDirectory, codeRoot) },
      },
    }, catalogs);
    assert.equal(authorityCatalog.get('code::src-app-jsx').source_kind, 'code');
    assert.equal(authorityCatalog.get('code::src-app-jsx').status, 'current');
    assert.equal(authorityCatalog.get('code::src-app-jsx').canonical, true);

    writeFileSync(join(notesRoot, 'Project Plan.md'), '# Changed after catalog load\n', 'utf8');
    const drifted = resolveResultSourceProvenance([{ slug: 'project-plan' }], catalogs, {
      requestedSourceId: 'default',
    });
    assert.equal(drifted[0].source_provenance.status, 'unresolved');
    const driftedCatalogs = loadSourceProvenanceCatalogs({
      sources: { default: { kind: 'markdown', root: relative(qrelsDirectory, notesRoot) } },
    }, qrelsPath, { sourcesRoot });
    assert.equal(driftedCatalogs.get('default').status, 'unavailable');

    writeFileSync(join(notesRoot, 'Project Plan.md'), noteContent, 'utf8');
    writeFileSync(join(notesMirror, 'undeclared.md'), '# Not owned\n', 'utf8');
    const extraFileCatalogs = loadSourceProvenanceCatalogs({
      sources: { default: { kind: 'markdown', root: relative(qrelsDirectory, notesRoot) } },
    }, qrelsPath, { sourcesRoot });
    assert.equal(extraFileCatalogs.get('default').status, 'unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
