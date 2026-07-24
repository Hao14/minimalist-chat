import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { slugFromCodePath, slugFromRelativePath } from './gbrain-authority-ranker.mjs';
import { validateQrels } from './gbrain-retrieval-eval.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..', '..');
const V2_QRELS_PATH = resolve(REPOSITORY_ROOT, 'gbrain-evals', 'qrels', 'minimalist-chat-v2.qrels.json');
const V3_QRELS_PATH = resolve(REPOSITORY_ROOT, 'gbrain-evals', 'qrels', 'minimalist-chat-v3.qrels.json');
const v2Qrels = validateQrels(JSON.parse(readFileSync(V2_QRELS_PATH, 'utf8')));
const v3Qrels = validateQrels(JSON.parse(readFileSync(V3_QRELS_PATH, 'utf8')));

const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.gbrain', '.obsidian', 'dist', 'graphify-out', 'node_modules', 'skills',
]);

function sourceSlugs(sourceDefinition, qrelsPath) {
  const qrelsDirectory = dirname(qrelsPath);
  const root = resolve(qrelsDirectory, sourceDefinition.root);
  const roots = sourceDefinition.include?.length
    ? sourceDefinition.include.map((entry) => resolve(root, entry))
    : ['functions', 'src', 'public', 'tools'].map((entry) => resolve(root, entry));
  const slugs = new Set();
  const visit = (directory) => {
    let entries = [];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (sourceDefinition.kind === 'markdown' && extension !== '.md') continue;
        const relativePath = relative(root, absolutePath);
        slugs.add(sourceDefinition.kind === 'code'
          ? slugFromCodePath(relativePath)
          : slugFromRelativePath(relativePath));
      }
    }
  };
  roots.forEach(visit);
  return slugs;
}

test('V2 has exactly 50 unique, source-aware cases in every required category', () => {
  assert.equal(v2Qrels.queries.length, 50);
  assert.equal(new Set(v2Qrels.queries.map((entry) => entry.query_id)).size, 50);
  assert.deepEqual(
    new Set(v2Qrels.queries.map((entry) => entry.category)),
    new Set([
      'current-notes',
      'authored-code',
      'aliases-and-typos',
      'archived-vs-current',
      'timeline-and-visuals',
      'negative-and-source-scope',
    ]),
  );
  assert.ok(v2Qrels.queries.filter((entry) => entry.has_negative_check).length >= 8);
});

test('V3 preserves V2 and has exactly 100 unique questions with balanced coverage', () => {
  assert.equal(v3Qrels.queries.length, 100);
  assert.equal(new Set(v3Qrels.queries.map((entry) => entry.query_id)).size, 100);
  assert.equal(new Set(v3Qrels.queries.map((entry) => entry.query.trim().toLowerCase())).size, 100);
  assert.deepEqual(v3Qrels.queries.slice(0, v2Qrels.queries.length), v2Qrels.queries);

  const categoryCounts = Object.fromEntries(
    [...new Set(v3Qrels.queries.map((entry) => entry.category))]
      .sort()
      .map((category) => [category, v3Qrels.queries.filter((entry) => entry.category === category).length]),
  );
  assert.deepEqual(categoryCounts, {
    'aliases-and-typos': 15,
    'archived-vs-current': 14,
    'authored-code': 20,
    'current-notes': 25,
    'negative-and-source-scope': 13,
    'timeline-and-visuals': 13,
  });

  const sourceCounts = Object.fromEntries(
    Object.keys(v3Qrels.sources).map((sourceId) => [
      sourceId,
      v3Qrels.queries.filter((entry) => entry.source_id === sourceId).length,
    ]),
  );
  assert.deepEqual(sourceCounts, { default: 77, 'minimalist-chat-code': 23 });
  assert.ok(v3Qrels.queries.filter((entry) => entry.has_negative_check).length >= 25);
  assert.ok(
    v3Qrels.queries.filter((entry) => /\b(?:cite|citation|evidence|proof|source of truth|authoritative|provenance)\b/i.test(entry.query)).length >= 15,
    'V3 should include citation- and evidence-oriented user phrasing.',
  );
});

test('V3 declares reasoned gates without weakening the V2 baseline', () => {
  assert.deepEqual(v3Qrels.gate_thresholds, v2Qrels.gate_thresholds);
  assert.ok(v3Qrels.gate_thresholds && Object.keys(v3Qrels.gate_thresholds).length >= 7);
  assert.match(v3Qrels._gate_rationale, /100 cases/i);
  assert.match(v3Qrels._gate_rationale, /V2 baseline/i);
});

test('V3 contradiction checks reject a relevant result marked forbidden', () => {
  const contradictory = structuredClone(v3Qrels);
  contradictory.queries[0].forbidden = [{ ...contradictory.queries[0].relevant[0] }];
  assert.throws(() => validateQrels(contradictory), /both relevant and forbidden/);
});

test('every V2 and V3 judged slug resolves to a declared local source file', () => {
  for (const [version, qrelsPath, qrels] of [
    ['V2', V2_QRELS_PATH, v2Qrels],
    ['V3', V3_QRELS_PATH, v3Qrels],
  ]) {
    const slugsBySource = new Map(
      Object.entries(qrels.sources).map(([sourceId, definition]) => [
        sourceId,
        sourceSlugs(definition, qrelsPath),
      ]),
    );
    for (const entry of qrels.queries) {
      assert.ok(slugsBySource.has(entry.source_id), `${version} ${entry.query_id}: undeclared source ${entry.source_id}`);
      for (const reference of [...entry.relevant, ...entry.forbidden]) {
        assert.ok(
          slugsBySource.get(reference.source_id)?.has(reference.slug),
          `${version} ${entry.query_id}: missing ${reference.source_id}::${reference.slug}`,
        );
      }
      for (const sourceId of entry.forbidden_sources) {
        assert.ok(slugsBySource.has(sourceId), `${version} ${entry.query_id}: undeclared forbidden source ${sourceId}`);
      }
    }
  }
});
