import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeReport,
  buildWorkloadPrompt,
  normalizeLoopbackBaseUrl,
  parseArgs,
  percentile,
  runBenchmark,
  runOllamaRequest,
  summarizeScenario,
} from './ai-local-benchmark.mjs';

function ollamaNdjson({ model = 'qwen3:4b-instruct', output = 'Reliability is preserved.' } = {}) {
  return [
    JSON.stringify({ model, message: { role: 'assistant', content: output }, done: false }),
    JSON.stringify({
      model,
      message: { role: 'assistant', content: '' },
      done: true,
      total_duration: 3_500_000_000,
      load_duration: 250_000_000,
      prompt_eval_count: 123,
      prompt_eval_duration: 1_000_000_000,
      eval_count: 50,
      eval_duration: 2_000_000_000,
    }),
    '',
  ].join('\n');
}

function splitNdjsonResponse(payload) {
  const bytes = new TextEncoder().encode(payload);
  const split = Math.max(1, Math.floor(bytes.length / 3));
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split, split * 2));
      controller.enqueue(bytes.slice(split * 2));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

test('CLI defaults are dry-run and cover the canonical Fast/Smart sweep', () => {
  const config = parseArgs([]);
  assert.equal(config.dryRun, true);
  assert.equal(config.baseUrl, 'http://127.0.0.1:11435');
  assert.deepEqual(config.profiles, ['fast', 'smart']);
  assert.deepEqual(config.workloads, ['short', '2k', '8k']);
  assert.deepEqual(config.concurrency, [1, 2, 4, 6, 8, 10]);
});

test('only credential-free loopback origins are accepted', () => {
  assert.equal(normalizeLoopbackBaseUrl('http://localhost:11435/'), 'http://localhost:11435');
  assert.equal(normalizeLoopbackBaseUrl('http://[::1]:11435'), 'http://[::1]:11435');
  for (const unsafe of [
    'http://192.168.1.50:11435',
    'https://example.com',
    'http://user:password@127.0.0.1:11435',
    'http://127.0.0.1:11435/api/chat',
    'http://127.0.0.1:11435/?token=private',
  ]) {
    assert.throws(() => normalizeLoopbackBaseUrl(unsafe));
  }
});

test('fixed workloads are deterministic and materially exercise short, 2K, and 8K inputs', () => {
  const short = buildWorkloadPrompt('short');
  const twoK = buildWorkloadPrompt('2k');
  const eightK = buildWorkloadPrompt('8k');
  assert.equal(twoK, buildWorkloadPrompt('2k'));
  assert.ok(short.length < 1000);
  assert.equal(twoK.length, 2048 * 4);
  assert.equal(eightK.length, 8192 * 4);
  assert.ok(eightK.length > twoK.length * 3);
});

test('streaming requests capture TTFT plus Ollama load, prompt, eval, and token-rate metrics', async () => {
  let capturedUrl = '';
  let capturedOptions = null;
  let clock = 0;
  const result = await runOllamaRequest({
    profileId: 'fast',
    workloadId: 'short',
    timeoutMs: 1000,
    now: () => {
      clock += 10;
      return clock;
    },
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return splitNdjsonResponse(ollamaNdjson());
    },
  });

  assert.equal(capturedUrl, 'http://127.0.0.1:11435/api/chat');
  assert.equal(capturedOptions.headers.Authorization, undefined);
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
  const request = JSON.parse(capturedOptions.body);
  assert.equal(request.model, 'qwen3:4b-instruct');
  assert.equal(request.stream, true);
  assert.equal(request.think, false);
  assert.equal(request.options.num_ctx, 8192);
  assert.equal(result.ok, true);
  assert.ok(result.ttft_ms >= 0);
  assert.equal(result.prompt_eval_count, 123);
  assert.equal(result.eval_count, 50);
  assert.equal(result.generation_tokens_per_second, 25);
  assert.equal(result.ollama_load_ms, 250);
  assert.equal(result.ollama_prompt_eval_ms, 1000);
  assert.equal(result.ollama_eval_ms, 2000);
});

test('dry run performs no inference and reports the exact planned request count', async () => {
  let fetchCalls = 0;
  const report = await runBenchmark({
    dryRun: true,
    profiles: ['fast', 'smart'],
    workloads: ['short'],
    concurrency: [1, 4],
    warmups: 1,
    measuredPerWorker: 2,
    timeoutMs: 5000,
  }, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Dry run must not fetch.');
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.plan.scenarios, 4);
  assert.equal(report.plan.warmup_requests, 4);
  assert.equal(report.plan.measured_requests, 20);
  assert.doesNotThrow(() => assertSafeReport(report));
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /deterministic synthetic inference benchmark/i);
  assert.doesNotMatch(serialized, /Reliability is preserved/i);
  assert.throws(() => assertSafeReport({ response: 'must never be retained' }));
});

test('execution honors the requested worker concurrency and never retains generated text', async () => {
  let active = 0;
  let highWater = 0;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    active += 1;
    highWater = Math.max(highWater, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return splitNdjsonResponse(ollamaNdjson({ output: 'DO_NOT_RETAIN_THIS_REPLY' }));
  };
  const report = await runBenchmark({
    dryRun: false,
    profiles: ['fast'],
    workloads: ['short'],
    concurrency: [4],
    warmups: 0,
    measuredPerWorker: 2,
    timeoutMs: 5000,
  }, { fetchImpl });

  assert.equal(calls, 8);
  assert.equal(highWater, 4);
  assert.equal(report.summary.succeeded, 8);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.scenarios[0].summary.requested, 8);
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_RETAIN_THIS_REPLY/);
  assert.doesNotThrow(() => assertSafeReport(report));
});

test('timeouts and percentile summaries are explicit and stable', async () => {
  const timedOut = await runOllamaRequest({
    profileId: 'fast',
    workloadId: 'short',
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
  });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.timed_out, true);
  assert.equal(timedOut.error_code, 'timeout');

  assert.equal(percentile([10, 20, 30, 40], 0.50), 25);
  const summary = summarizeScenario([
    { ok: true, status: 200, timed_out: false, latency_ms: 10, ttft_ms: 2 },
    { ok: true, status: 200, timed_out: false, latency_ms: 20, ttft_ms: 4 },
    { ok: false, status: null, timed_out: true, error_code: 'timeout' },
  ], 25);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.errors, 1);
  assert.equal(summary.timeouts, 1);
  assert.equal(summary.latency_ms.p50, 15);
  assert.equal(summary.ttft_ms.p95, 3.9);
});
