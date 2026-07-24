import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCodeAuthorityCatalog,
  normalizeAuthorityText,
  parseAuthorityFrontmatter,
  rankByAuthority,
  slugFromCodePath,
  slugFromRelativePath,
} from './gbrain-authority-ranker.mjs';
import { parseGBrainResults, resolveGBrainInvocation } from './gbrain-authority-query.mjs';

test('uses the true Bun owner for installed Windows GBrain queries', () => {
  const invocation = resolveGBrainInvocation({
    platform: 'win32',
    userProfile: 'C:\\Users\\tester',
    pathExists: () => true,
  });
  assert.equal(invocation.command, 'C:\\Users\\tester\\.bun\\bin\\bun.exe');
  assert.deepEqual(invocation.argumentsPrefix, [
    'C:\\Users\\tester\\.bun\\install\\global\\node_modules\\gbrain\\src\\cli.ts',
  ]);
  assert.deepEqual(resolveGBrainInvocation({
    platform: 'linux',
    command: 'gbrain-mock',
    argumentsPrefix: ['--fixture'],
  }), { command: 'gbrain-mock', argumentsPrefix: ['--fixture'] });
});

test('normalizes camel case, punctuation, and vault paths deterministically', () => {
  assert.equal(normalizeAuthorityText('GBrain—ProjectTimeline'), 'gbrain project timeline');
  assert.equal(
    slugFromRelativePath('90 Memory\\Project Timeline.md'),
    '90-memory/project-timeline',
  );
  assert.equal(
    slugFromRelativePath('90 Memory\\Timeline Vision\\2026-07-18-appearance-settings.vision.md'),
    '90-memory/timeline-vision/2026-07-18-appearance-settings.vision',
  );
  assert.equal(
    slugFromCodePath('src/features/private-messages/pmHistoryModel.js'),
    'src-features-private-messages-pmhistorymodel-js',
  );
});

test('parses the authority fields without requiring a YAML dependency', () => {
  const metadata = parseAuthorityFrontmatter(`---\ntitle: "Current Product Overview"\nstatus: current\ncanonical: true\naliases: [product summary, "what is Minimalist Chat"]\n---\n# Body\n`);
  assert.deepEqual(metadata, {
    title: 'Current Product Overview',
    status: 'current',
    canonical: true,
    aliases: ['product summary', 'what is Minimalist Chat'],
  });
});

test('promotes current canonical material and demotes archived copies', () => {
  const results = [
    { source_id: 'default', slug: '11-product/legacy/legacy-features', score: 0.91, snippet: 'old' },
    { source_id: 'default', slug: '10-product/current/current-product-overview', score: 0.86, snippet: 'new' },
    { source_id: 'default', slug: '90-memory/source-catalog', score: 0.5, snippet: 'catalog' },
  ];
  const catalog = new Map([
    ['default::11-product/legacy/legacy-features', {
      title: 'Legacy Features', status: 'archived', path: '11 Product/Legacy/Legacy - Features.md',
    }],
    ['default::10-product/current/current-product-overview', {
      title: 'Current Product Overview', status: 'current', canonical: true,
      path: '10 Product/Current/Current Product Overview.md',
    }],
  ]);
  const ranked = rankByAuthority('What is in the current product overview?', results, { catalog });
  assert.equal(ranked[0].slug, '10-product/current/current-product-overview');
  assert.equal(ranked.at(-1).slug, '11-product/legacy/legacy-features');
  assert.deepEqual(new Set(ranked.map((item) => item.slug)), new Set(results.map((item) => item.slug)));
});

test('uses aliases while preserving the original order for an unsupported tie', () => {
  const results = [
    { source_id: 'default', slug: 'first', score: 0.5, snippet: '' },
    { source_id: 'default', slug: 'second', score: 0.5, snippet: '' },
  ];
  const unchanged = rankByAuthority('unrelated terms', results);
  assert.deepEqual(unchanged.map((item) => item.slug), ['first', 'second']);

  const catalog = new Map([
    ['default::second', { title: 'Second', aliases: ['brain setup'], status: 'active' }],
  ]);
  const promoted = rankByAuthority('Where is the brain setup?', results, { catalog });
  assert.equal(promoted[0].slug, 'second');
});

test('keeps only the highest-ranked source and slug identity and renumbers ranks', () => {
  const ranked = rankByAuthority('project plan', [
    { source_id: 'default', slug: 'same-plan', score: 0.2, snippet: 'lower-ranked duplicate' },
    { source_id: 'default', slug: 'other-plan', score: 0.8, snippet: 'other evidence' },
    { source_id: 'default', slug: 'same-plan', score: 0.9, snippet: 'highest-ranked duplicate' },
  ]);

  assert.equal(ranked.length, 2);
  assert.equal(ranked.find((result) => result.slug === 'same-plan').snippet, 'highest-ranked duplicate');
  assert.deepEqual(ranked.map((result) => result.authority_rank), [1, 2]);
  assert.equal(new Set(ranked.map((result) => `${result.source_id}::${result.slug}`)).size, ranked.length);
});

test('parses only bounded source-scoped rows from GBrain output', () => {
  const parsed = parseGBrainResults('[0.9] one -- First\nnoise\n[0.8] two -- Second\n', 'default', 1);
  assert.deepEqual(parsed, [{ source_id: 'default', slug: 'one', score: 0.9, snippet: 'First' }]);
});

test('maps curated code mirror slugs back to supporting source file paths', () => {
  const catalog = buildCodeAuthorityCatalog({
    sourceId: 'minimalist-chat-code',
    sourceRoot: 'C:/repo',
    files: ['functions/ai/context.js', '../outside.js'],
  });
  const entry = catalog.get('minimalist-chat-code::functions-ai-context-js');
  assert.equal(entry.path, 'functions/ai/context.js');
  assert.match(entry.absolute_path.replace(/\\/g, '/'), /C:\/repo\/functions\/ai\/context\.js$/i);
  assert.equal(entry.canonical, true);
  assert.equal(catalog.size, 1);
  assert.equal(
    slugFromCodePath('Minimalist Search/Searvia/migrations/meta/0020_snapshot.json'),
    'minimalist-search-searvia-migrations-meta-0020_snapshot-json',
  );
});
