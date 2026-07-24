import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCitationAnswer,
  detectCitationConflicts,
  maybeSynthesizeWithOllama,
} from './gbrain-citation-answer.mjs';

test('returns authority-ranked evidence with a supporting local file path', () => {
  const catalog = new Map([
    ['default::legacy-plan', {
      source_id: 'default',
      slug: 'legacy-plan',
      title: 'Legacy Plan',
      status: 'archived',
      path: 'Archive/Legacy Plan.md',
      absolute_path: 'C:/vault/Archive/Legacy Plan.md',
    }],
    ['default::current-plan', {
      source_id: 'default',
      slug: 'current-plan',
      title: 'Current Project Plan',
      status: 'current',
      canonical: true,
      path: 'Current/Project Plan.md',
      absolute_path: 'C:/vault/Current/Project Plan.md',
    }],
  ]);
  const report = buildCitationAnswer({
    query: 'What is the current project plan?',
    catalog,
    results: [
      {
        source_id: 'default', slug: 'legacy-plan', title: 'Legacy Plan', score: 0.92,
        evidence: 'keyword_exact', chunk_text: 'The old project plan is archived.',
      },
      {
        source_id: 'default', slug: 'current-plan', title: 'Current Project Plan', score: 0.86,
        evidence: 'exact_title_match', chunk_text: 'The current project plan is active.',
      },
    ],
  });
  assert.equal(report.citations[0].slug, 'current-plan');
  assert.equal(report.citations[0].path, 'C:/vault/Current/Project Plan.md');
  assert.equal(report.evidence_strength, 'high');
  assert.equal(report.answer.abstained, false);
  assert.match(report.answer.text, /\[1]/);
});

test('detects contradictory scalar claims and abstains from choosing one', () => {
  const report = buildCitationAnswer({
    query: 'What is the launch date?',
    results: [
      {
        source_id: 'default', slug: 'plan-a', title: 'Launch Plan A', score: 0.9,
        evidence: 'exact_title_match', chunk_text: 'The launch date is 2026-08-01.',
      },
      {
        source_id: 'default', slug: 'plan-b', title: 'Launch Plan B', score: 0.88,
        evidence: 'exact_title_match', chunk_text: 'The launch date is 2026-09-15.',
      },
    ],
  });
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].reason, 'different_dates');
  assert.equal(report.answer.abstained, true);
  assert.match(report.answer.text, /conflicting local evidence/i);
});

test('abstains explicitly when retrieval contains only weak unrelated evidence', () => {
  const report = buildCitationAnswer({
    query: 'Which database engine does GBrain use?',
    results: [{
      source_id: 'default', slug: 'recipe', title: 'Bread Recipe', score: 0.01,
      evidence: 'weak_semantic', chunk_text: 'Bread uses flour and water.',
    }],
  });
  assert.equal(report.evidence_strength, 'low');
  assert.equal(report.answer.abstained, true);
  assert.match(report.answer.text, /don't have enough reliable local evidence/i);
});

test('conflict detector ignores complementary non-scalar statements', () => {
  const conflicts = detectCitationConflicts([
    { citation: '[1]', evidence_strength: 'strong', snippet: 'The project uses React and Node.' },
    { citation: '[2]', evidence_strength: 'strong', snippet: 'The project uses PostgreSQL.' },
  ]);
  assert.deepEqual(conflicts, []);
});

test('does not call Ollama when deterministic evidence requires abstention', async () => {
  const report = buildCitationAnswer({ query: 'unknown thing', results: [] });
  let called = false;
  const synthesized = await maybeSynthesizeWithOllama(report, {
    enabled: true,
    fetchImpl: async () => {
      called = true;
      throw new Error('must not run');
    },
  });
  assert.equal(called, false);
  assert.equal(synthesized.synthesis.status, 'skipped_for_abstention');
  assert.equal(synthesized.answer.mode, 'deterministic-evidence');
});

test('rejects every synthesis endpoint except the tray Ollama loopback port', async () => {
  const report = buildCitationAnswer({
    query: 'What is the current plan?',
    results: [{
      source_id: 'default', slug: 'plan', title: 'Current Plan', score: 0.9,
      evidence: 'exact_title_match', chunk_text: 'The current plan is active.',
    }],
  });
  let called = false;
  const synthesized = await maybeSynthesizeWithOllama(report, {
    enabled: true,
    endpoint: 'http://localhost:11434/api/chat',
    fetchImpl: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(synthesized.synthesis.reason, 'loopback_endpoint_required');
});

test('accepts an explicitly enabled tray Ollama answer only when citations are valid', async () => {
  const report = buildCitationAnswer({
    query: 'What is the current plan?',
    results: [{
      source_id: 'default', slug: 'plan', title: 'Current Plan', score: 0.9,
      evidence: 'exact_title_match', chunk_text: 'The current plan is active.',
    }],
  });
  const synthesized = await maybeSynthesizeWithOllama(report, {
    enabled: true,
    model: 'test-local-model',
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false);
      assert.equal(body.model, 'test-local-model');
      return {
        ok: true,
        json: async () => ({ message: { content: 'The current plan is active. [1]' } }),
      };
    },
  });
  assert.equal(synthesized.synthesis.status, 'completed');
  assert.equal(synthesized.answer.mode, 'ollama-cited-synthesis');
});

test('rejects an Ollama answer containing any uncited factual sentence', async () => {
  const report = buildCitationAnswer({
    query: 'What is the current plan?',
    results: [{
      source_id: 'default', slug: 'plan', title: 'Current Plan', score: 0.9,
      evidence: 'exact_title_match', chunk_text: 'The current plan is active.',
    }],
  });
  const synthesized = await maybeSynthesizeWithOllama(report, {
    enabled: true,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        message: { content: 'The current plan is active. [1] Every message is public on a blockchain.' },
      }),
    }),
  });
  assert.equal(synthesized.synthesis.status, 'rejected');
  assert.equal(synthesized.answer.mode, 'deterministic-evidence');
});
