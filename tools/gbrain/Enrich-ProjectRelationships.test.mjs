import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MANAGED_BY,
  assertRelationshipQualityNotRegressed,
  buildEnrichedGraph,
  graphStats,
} from './Enrich-ProjectRelationships.mjs';

const TEST_FILE = fileURLToPath(import.meta.url);
const SCRIPT_FILE = path.join(path.dirname(TEST_FILE), 'Enrich-ProjectRelationships.mjs');
const temporaryRoots = [];

function writeFixtureFile(root, relativePath, content = '') {
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gbrain-relationship-test-'));
  temporaryRoots.push(root);
  const vault = path.join(root, 'Minimalist-chat-vault');
  mkdirSync(path.join(vault, 'graphify-out'), { recursive: true });

  writeFixtureFile(root, 'src/features/chat/Chat.jsx', 'export function Chat() {}\n');
  writeFixtureFile(root, 'src/features/chat/chatService.js', 'export const chatService = {};\n');
  writeFixtureFile(root, 'tools/chat.test.mjs', '// chat test\n');
  writeFixtureFile(root, 'tools/ai-analysis-app/ModernForm.cs', 'class ModernForm {}\n');
  writeFixtureFile(root, 'android/app/build.gradle', '// android\n');
  writeFixtureFile(root, 'functions/.env', 'DO_NOT_INDEX=this-is-not-a-real-secret\n');

  writeFixtureFile(vault, '90 Memory/Project Memory.md', [
    '---',
    'title: Project Memory',
    '---',
    '# Project Memory',
    '',
    '## Durable decisions',
    '',
    '- 2026-07-21 — Keep chat bounded. Canonical sources: `src/features/chat/Chat.jsx`, `src/features/chat/chatService.js`, `tools/chat.test.mjs`, `tools/ai-analysis-app/ModernForm.cs`, `android/app/build.gradle`, and `functions/.env`. See [[10 Product/Current/Current Product Overview|overview]].',
    '',
  ].join('\n'));
  writeFixtureFile(vault, '10 Product/Current/Current Product Overview.md', [
    '---',
    'title: Current Product Overview',
    '---',
    '# Current Product Overview',
    '',
    'The current product is source-grounded.',
    '',
  ].join('\n'));
  writeFixtureFile(vault, '11 Product/Legacy/Legacy - Download.md', [
    '# Legacy - Download',
    '',
    '## Use Minimalist anywhere.',
    '',
    '### Web App',
    '### Windows',
    '### Android',
    '',
  ].join('\n'));
  writeFixtureFile(vault, '90 Memory/Project Timeline.md', [
    '---',
    'title: Project Timeline',
    '---',
    '# Project Timeline',
    '',
    '## 2026-07-21',
    '',
    '![[assets/project-timeline/2026-07-21-health.png|420]]',
    '![[assets/project-timeline/missing.png|420]]',
    '',
  ].join('\n'));
  writeFixtureFile(vault, '90 Memory/assets/project-timeline/2026-07-21-health.png', 'fixture image bytes');
  writeFixtureFile(vault, 'graphify-out/memory/query_20260721_health_dashboard.md', [
    '# query_20260721_health_dashboard.md',
    '',
    '## Q: Is GBrain healthy?',
    '',
    '## Answer',
    '',
  ].join('\n'));
  writeFixtureFile(vault, 'graphify-out/memory/not_a_query.md', '# Not query memory\n\n## Answer\n');
  writeFixtureFile(vault, 'graphify-out/wiki/query_20260721_wrong_directory.md', '# Wrong directory\n\n## Answer\n');

  const graph = {
    directed: false,
    multigraph: false,
    graph: { hyperedges: [] },
    nodes: [
      { id: 'project_memory', label: 'Project Memory', source_file: '90 Memory/Project Memory.md' },
      { id: 'project_memory_section', label: 'Durable decisions', source_file: '90 Memory/Project Memory.md', source_location: 'L6' },
      { id: 'project_memory_leaf', label: 'Bounded chat decision', source_file: '90 Memory/Project Memory.md', source_location: 'L8' },
      { id: 'project_memory_prefixed_leaf', label: 'Prefixed AST heading', source_file: 'Minimalist-chat-vault/90 Memory/Project Memory.md', source_location: 'L9' },
      { id: 'current_product', label: 'Current Product Overview', source_file: '10 Product/Current/Current Product Overview.md' },
      { id: 'download', label: 'Legacy - Download.md', source_file: '11 Product/Legacy/Legacy - Download.md', source_location: 'L1' },
      { id: 'web_app', label: 'Web App', source_file: '11 Product/Legacy/Legacy - Download.md', source_location: 'L5' },
      { id: 'windows', label: 'Windows', source_file: '11 Product/Legacy/Legacy - Download.md', source_location: 'L6' },
      { id: 'android', label: 'Android', source_file: '11 Product/Legacy/Legacy - Download.md', source_location: 'L7' },
      { id: 'project_timeline', label: 'Project Timeline', source_file: '90 Memory/Project Timeline.md', source_location: 'L1' },
      { id: 'project_timeline_date', label: '2026-07-21', source_file: '90 Memory/Project Timeline.md', source_location: 'L6' },
      { id: 'timeline_image_root', label: 'GBrain Health Dashboard', source_file: '90 Memory/assets/project-timeline/2026-07-21-health.png' },
      { id: 'timeline_image_detail', label: 'Health status panel', source_file: '90 Memory/assets/project-timeline/2026-07-21-health.png' },
      { id: 'query_memory_root', label: 'query_20260721_health_dashboard.md', source_file: 'graphify-out/memory/query_20260721_health_dashboard.md', source_location: 'L1' },
      { id: 'query_memory_question', label: 'Q: Is GBrain healthy?', source_file: 'graphify-out/memory/query_20260721_health_dashboard.md', source_location: 'L3' },
      { id: 'query_memory_answer', label: 'Answer', source_file: 'graphify-out/memory/query_20260721_health_dashboard.md', source_location: 'L5' },
      { id: 'ignored_memory_root', label: 'Not query memory', source_file: 'graphify-out/memory/not_a_query.md', source_location: 'L1' },
      { id: 'ignored_memory_answer', label: 'Answer', source_file: 'graphify-out/memory/not_a_query.md', source_location: 'L3' },
      { id: 'ignored_generated_root', label: 'Wrong directory', source_file: 'graphify-out/wiki/query_20260721_wrong_directory.md', source_location: 'L1' },
      { id: 'ignored_generated_answer', label: 'Answer', source_file: 'graphify-out/wiki/query_20260721_wrong_directory.md', source_location: 'L3' },
    ],
    links: [
      { source: 'project_memory', target: 'project_memory_section', relation: 'contains' },
      { source: 'project_memory_section', target: 'project_memory_leaf', relation: 'contains' },
      { source: 'download', target: 'web_app', relation: 'contains' },
      { source: 'web_app', target: 'windows', relation: 'contains' },
      { source: 'web_app', target: 'android', relation: 'contains' },
      { source: 'timeline_image_root', target: 'timeline_image_detail', relation: 'contains' },
    ],
    hyperedges: [],
  };
  const graphPath = path.join(vault, 'graphify-out', 'graph.json');
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  return { graph, graphPath, root, vault };
}

test.afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root);
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(expectedPrefix), `refusing unsafe test cleanup: ${resolved}`);
    rmSync(resolved, { recursive: true, force: true });
  }
});

test('adds only evidence-backed structural edges and reduces weak nodes', () => {
  const { graph, root, vault } = fixture();
  const result = buildEnrichedGraph({ graph, repoRoot: root, vaultRoot: vault });
  const relations = new Set(result.artifact.links.map((edge) => edge.relation));
  assert.ok(relations.has('member_of_source_document'));
  assert.ok(relations.has('member_of_media_source_file'));
  assert.ok(relations.has('embeds_timeline_media'));
  assert.ok(relations.has('references_document'));
  assert.ok(relations.has('references_code_path'));
  assert.ok(relations.has('records_durable_decision'));
  assert.ok(relations.has('cites_canonical_path'));
  assert.ok(relations.has('verification_co_listed_with'));
  assert.ok(relations.has('contains_code_path'));
  assert.ok(relations.has('located_in_platform_tree'));

  assert.ok(result.artifact.nodes.some((node) => node.label === 'src/features/chat/Chat.jsx'));
  assert.ok(result.artifact.nodes.some((node) => node.label === 'Feature directory: chat'));
  assert.ok(result.artifact.nodes.some((node) => (
    node.node_type === 'media_source_file'
    && node.source_file === '90 Memory/assets/project-timeline/2026-07-21-health.png'
  )));
  assert.ok(!result.artifact.nodes.some((node) => node.label.includes('.env')));
  assert.ok(result.artifact.nodes.every((node) => node.managed_by === MANAGED_BY));
  assert.ok(result.artifact.links.every((edge) => (
    edge.managed_by === MANAGED_BY
    && edge.confidence === 'EXTRACTED'
    && edge.confidence_score === 1
    && edge.evidence_type
    && edge.evidence
  )));

  const before = graphStats(graph);
  const after = graphStats(result.candidateGraph);
  assert.ok(after.low_degree_nodes < before.low_degree_nodes);
  const degrees = new Map(result.candidateGraph.nodes.map((node) => [node.id, 0]));
  for (const edge of result.candidateGraph.links) {
    degrees.set(edge.source, degrees.get(edge.source) + 1);
    degrees.set(edge.target, degrees.get(edge.target) + 1);
  }
  assert.ok(result.artifact.nodes.every((node) => degrees.get(node.id) >= 2));
  assert.ok(result.artifact.links.some((edge) => (
    edge.source === 'project_memory'
    && edge.target === 'project_memory_prefixed_leaf'
    && edge.relation === 'member_of_source_document'
  )));
  assert.equal(
    result.candidateGraph.nodes.find((node) => node.id === 'project_memory_prefixed_leaf').source_file,
    '90 Memory/Project Memory.md',
  );
});

test('quality guard rejects relationship replacements that create weaker or isolated nodes', () => {
  const original = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    links: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
  };
  const regressed = {
    nodes: original.nodes,
    links: [{ source: 'a', target: 'b' }],
  };
  assert.throws(
    () => assertRelationshipQualityNotRegressed(original, regressed),
    /isolated nodes would increase/,
  );
});

test('repairs only safe query memory and exact local Project Timeline media groups', () => {
  const { graph, root, vault } = fixture();
  const result = buildEnrichedGraph({ graph, repoRoot: root, vaultRoot: vault });
  const managedPairs = new Set(result.artifact.links.map((edge) => `${edge.source}\u0000${edge.target}`));
  assert.ok(managedPairs.has('query_memory_root\u0000query_memory_question'));
  assert.ok(managedPairs.has('query_memory_root\u0000query_memory_answer'));
  assert.equal(result.categories.query_memory_membership, 2);

  const ignoredIds = new Set([
    'ignored_memory_root',
    'ignored_memory_answer',
    'ignored_generated_root',
    'ignored_generated_answer',
  ]);
  assert.ok(result.artifact.links.every((edge) => (
    !ignoredIds.has(edge.source) && !ignoredIds.has(edge.target)
  )));

  const mediaRoot = result.artifact.nodes.find((node) => (
    node.node_type === 'media_source_file'
    && node.source_file === '90 Memory/assets/project-timeline/2026-07-21-health.png'
  ));
  assert.ok(mediaRoot);
  assert.ok(result.artifact.links.some((edge) => (
    edge.source === mediaRoot.id
    && edge.target === 'timeline_image_root'
    && edge.relation === 'member_of_media_source_file'
  )));
  assert.ok(result.artifact.links.some((edge) => (
    edge.source === mediaRoot.id
    && edge.target === 'timeline_image_detail'
    && edge.relation === 'member_of_media_source_file'
  )));
  const embedEdge = result.artifact.links.find((edge) => (
    edge.source === 'project_timeline'
    && edge.target === mediaRoot.id
    && edge.relation === 'embeds_timeline_media'
  ));
  assert.ok(embedEdge);
  assert.equal(embedEdge.source_file, '90 Memory/Project Timeline.md');
  assert.match(embedEdge.evidence, /2026-07-21-health\.png/);
  assert.doesNotMatch(embedEdge.evidence, /missing\.png/);
  assert.equal(result.categories.media_source_membership, 2);
  assert.equal(result.categories.timeline_media_embeds, 1);
});

test('is idempotent after managed nodes and edges are already present', () => {
  const { graph, root, vault } = fixture();
  const first = buildEnrichedGraph({ graph, repoRoot: root, vaultRoot: vault });
  const second = buildEnrichedGraph({ graph: first.candidateGraph, repoRoot: root, vaultRoot: vault });
  assert.deepEqual(second.artifact, first.artifact);
  assert.equal(second.candidateGraph.nodes.length, first.candidateGraph.nodes.length);
  assert.equal(second.candidateGraph.links.length, first.candidateGraph.links.length);
});

test('--dry-run --json emits one parseable document and writes nothing', () => {
  const { graphPath, root, vault } = fixture();
  const artifactPath = path.join(vault, 'graphify-out', 'deterministic-relationships.json');
  const execution = spawnSync(process.execPath, [
    SCRIPT_FILE,
    '--dry-run',
    '--json',
    '--repo', root,
    '--vault', vault,
    '--graph', graphPath,
    '--artifact', artifactPath,
  ], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(execution.status, 0, execution.stderr);
  const summary = JSON.parse(execution.stdout);
  assert.equal(execution.stdout.trim().split(/\r?\n/).length, 1);
  assert.equal(summary.mode, 'dry-run');
  assert.equal(summary.backup_path, null);
  assert.equal(summary.outputs_regenerated, false);
  assert.ok(summary.edges_added > 0);
  assert.ok(summary.after.edges > summary.before.edges);
  assert.ok(summary.after.low_degree_nodes < summary.before.low_degree_nodes);
  assert.equal(existsSync(artifactPath), false);
});
