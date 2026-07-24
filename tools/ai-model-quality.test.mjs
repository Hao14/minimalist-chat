import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_BASELINE_MODEL,
  DEFAULT_BASELINE_URL,
  DEFAULT_CANDIDATE_MODEL,
  DEFAULT_CANDIDATE_URL,
  QUALITY_CASES,
  assertSafeQualityReport,
  evaluateGate,
  normalizeLoopbackOrigin,
  parseArgs,
  runQualityEvaluation,
  scoreCaseResponse,
} from './ai-model-quality-eval.mjs';

test('quality CLI is dry-run by default and keeps baseline and candidate endpoints independent', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.dryRun, true);
  assert.equal(defaults.baselineUrl, DEFAULT_BASELINE_URL);
  assert.equal(defaults.candidateUrl, DEFAULT_CANDIDATE_URL);
  assert.equal(defaults.baselineModel, DEFAULT_BASELINE_MODEL);
  assert.equal(defaults.candidateModel, DEFAULT_CANDIDATE_MODEL);

  const configured = parseArgs([
    '--execute',
    '--baseline-url', 'http://127.0.0.1:11501',
    '--candidate-url', 'http://localhost:11502/',
    '--baseline-model', 'baseline:one',
    '--candidate-model', 'candidate:two',
  ]);
  assert.equal(configured.dryRun, false);
  assert.equal(configured.baselineUrl, 'http://127.0.0.1:11501');
  assert.equal(configured.candidateUrl, 'http://localhost:11502');
  assert.equal(configured.baselineModel, 'baseline:one');
  assert.equal(configured.candidateModel, 'candidate:two');
});

test('quality endpoints are credential-free loopback origins only', () => {
  assert.equal(normalizeLoopbackOrigin('http://127.0.0.1:11436'), 'http://127.0.0.1:11436');
  assert.equal(normalizeLoopbackOrigin('http://[::1]:11436/'), 'http://[::1]:11436');
  for (const unsafe of [
    'https://127.0.0.1:11436',
    'http://192.168.1.20:11436',
    'http://user:pass@127.0.0.1:11436',
    'http://127.0.0.1:11436/api/chat',
    'http://127.0.0.1:11436/?token=private',
  ]) {
    assert.throws(() => normalizeLoopbackOrigin(unsafe));
  }
});

test('deterministic suite covers all five Winston quality categories', () => {
  const categoryCounts = Object.fromEntries(
    [...new Set(QUALITY_CASES.map((entry) => entry.category))]
      .map((category) => [category, QUALITY_CASES.filter((entry) => entry.category === category).length]),
  );
  assert.deepEqual(categoryCounts, {
    grounded_summary: 2,
    task_extraction: 2,
    drafting: 2,
    refusal_injection: 2,
    citations_json: 2,
  });
  assert.equal(new Set(QUALITY_CASES.map((entry) => entry.id)).size, QUALITY_CASES.length);
});

test('case scorer checks JSON shape, grounded citations, and injected canaries deterministically', () => {
  const grounded = QUALITY_CASES.find((entry) => entry.id === 'grounded-summary-facts');
  const perfect = scoreCaseResponse(grounded, JSON.stringify({
    summary: 'Priya owns the September 14, 2026 launch with an approved $12,500 budget cap.',
    citations: ['S1', 'S2'],
    unsupported_claims: [],
  }));
  assert.equal(perfect.score, perfect.maxScore);

  const unsafe = scoreCaseResponse(grounded, JSON.stringify({
    summary: 'The budget is $50,000.',
    citations: ['S3'],
    unsupported_claims: [],
  }));
  assert.ok(unsafe.score < unsafe.maxScore);
  assert.equal(unsafe.checks.find((entry) => entry.id === 'reject-injected-budget').passed, false);
  assert.equal(unsafe.checks.find((entry) => entry.id === 'grounded-citations').passed, false);

  const malformed = scoreCaseResponse(grounded, '**not json**');
  assert.equal(malformed.score, 0);
});

function modelResult({ percentage, p95, errors = 0, casePercentages = [90, 90] }) {
  const cases = [
    {
      id: 'safe',
      guardrail: 'safety',
      percentage: casePercentages[0],
      checks: [{ id: 'critical-safe', critical: true, passed: true }],
    },
    {
      id: 'grounded',
      guardrail: 'grounding',
      percentage: casePercentages[1],
      checks: [{ id: 'critical-grounded', critical: true, passed: true }],
    },
  ];
  while (cases.length < QUALITY_CASES.length) {
    cases.push({ id: `plain-${cases.length}`, guardrail: null, percentage: 80, checks: [] });
  }
  return {
    summary: { percentage, errors, warmLatencyMs: { p95 } },
    cases,
  };
}

test('promotion gate requires gain, no guardrail regression, complete runs, and bounded warm p95', () => {
  const baseline = modelResult({ percentage: 80, p95: 1000 });
  const passingCandidate = modelResult({ percentage: 86, p95: 1190 });
  const passed = evaluateGate(baseline, passingCandidate);
  assert.equal(passed.passed, true);
  assert.equal(passed.qualityGainPp, 6);
  assert.equal(passed.warmP95LatencyRatio, 1.19);

  const regressed = modelResult({ percentage: 90, p95: 900, casePercentages: [89, 95] });
  const failed = evaluateGate(baseline, regressed);
  assert.equal(failed.passed, false);
  assert.equal(failed.requirements.noSafetyOrGroundingRegression, false);
  assert.deepEqual(failed.safetyOrGroundingRegressions, ['safety:safe:score']);
});

test('dry run performs no requests and retains no evaluation prompts or answers', async () => {
  let requests = 0;
  const report = await runQualityEvaluation(parseArgs([]), {
    fetchImpl: async () => {
      requests += 1;
      throw new Error('Dry run must not fetch.');
    },
  });
  assert.equal(requests, 0);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.plan.casesPerModel, 10);
  assert.equal(report.plan.measuredRequests, 20);
  assert.doesNotThrow(() => assertSafeQualityReport(report));
  assert.doesNotMatch(JSON.stringify(report), /ZXCV-SECRET|launch budget cap/i);
});

test('execution is sequential, uses candidate low reasoning, unloads between phases, and drops replies', async () => {
  const calls = [];
  const endpointModels = new Map([
    ['http://127.0.0.1:11437', DEFAULT_BASELINE_MODEL],
    ['http://127.0.0.1:11436', DEFAULT_CANDIDATE_MODEL],
  ]);
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = new URL(url);
    const endpoint = parsedUrl.origin;
    const model = endpointModels.get(endpoint);
    if (parsedUrl.pathname === '/api/tags') {
      calls.push({ endpoint, route: 'tags' });
      return Response.json({ models: [{ name: model }] });
    }
    const payload = JSON.parse(options.body);
    if (parsedUrl.pathname === '/api/generate') {
      calls.push({ endpoint, route: 'residency', keepAlive: payload.keep_alive, model: payload.model });
      return Response.json({ model: payload.model, response: 'DISCARDED_RESIDENCY_OUTPUT', done: true });
    }
    calls.push({
      endpoint,
      route: 'chat',
      model: payload.model,
      reasoningMode: payload.think,
      stream: payload.stream,
    });
    return Response.json({
      model: payload.model,
      message: { role: 'assistant', content: '{"generated":"DISCARDED_MODEL_REPLY"}' },
      thinking: 'DISCARDED_REASONING_TRACE',
      done: true,
    });
  };
  let clock = 0;
  const report = await runQualityEvaluation(parseArgs(['--execute']), {
    fetchImpl,
    now: () => {
      clock += 10;
      return clock;
    },
  });

  assert.equal(report.mode, 'executed');
  assert.equal(report.baseline.cases.length, QUALITY_CASES.length);
  assert.equal(report.candidate.cases.length, QUALITY_CASES.length);
  assert.equal(report.gate.passed, false);
  assert.doesNotThrow(() => assertSafeQualityReport(report));
  assert.doesNotMatch(JSON.stringify(report), /DISCARDED_/);

  const phaseCalls = calls.filter((entry) => entry.route !== 'tags');
  const firstBaselineChat = phaseCalls.findIndex((entry) => entry.route === 'chat' && entry.endpoint.endsWith(':11437'));
  const baselineUnload = phaseCalls.findIndex((entry, index) => index > firstBaselineChat
    && entry.route === 'residency' && entry.endpoint.endsWith(':11437') && entry.keepAlive === 0);
  const firstCandidateChat = phaseCalls.findIndex((entry) => entry.route === 'chat' && entry.endpoint.endsWith(':11436'));
  assert.ok(firstBaselineChat >= 0);
  assert.ok(baselineUnload > firstBaselineChat);
  assert.ok(firstCandidateChat > baselineUnload);
  assert.ok(calls.filter((entry) => entry.route === 'chat' && entry.endpoint.endsWith(':11437'))
    .every((entry) => entry.reasoningMode === false && entry.stream === false));
  assert.ok(calls.filter((entry) => entry.route === 'chat' && entry.endpoint.endsWith(':11436'))
    .every((entry) => entry.reasoningMode === 'low' && entry.stream === false));
  const finalCall = phaseCalls.at(-1);
  assert.deepEqual(finalCall, {
    endpoint: 'http://127.0.0.1:11436',
    route: 'residency',
    keepAlive: 0,
    model: DEFAULT_CANDIDATE_MODEL,
  });
});

test('safe report validator rejects generated-content and credential fields', () => {
  assert.throws(() => assertSafeQualityReport({ response: 'must not persist' }), /Unsafe quality report field/);
  assert.throws(() => assertSafeQualityReport({ nested: { token: 'must not persist' } }), /Unsafe quality report field/);
  assert.throws(() => assertSafeQualityReport({ note: 'ZXCV-SECRET-991' }), /retained evaluation evidence/);
});
