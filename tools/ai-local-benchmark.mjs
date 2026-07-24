#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:11435';
export const ALLOWED_CONCURRENCY = Object.freeze([1, 2, 4, 6, 8, 10]);

export const PROFILE_DEFINITIONS = Object.freeze({
  fast: Object.freeze({
    id: 'fast',
    label: 'Fast',
    model: 'qwen3:4b-instruct',
    contextWindow: 8192,
    thinking: false,
  }),
  smart: Object.freeze({
    id: 'smart',
    label: 'Smart',
    model: 'qwen3:14b',
    contextWindow: 8192,
    thinking: false,
  }),
});

export const WORKLOAD_DEFINITIONS = Object.freeze({
  short: Object.freeze({
    id: 'short',
    label: 'Short instruction',
    approximatePromptTokens: 48,
    numPredict: 64,
  }),
  '2k': Object.freeze({
    id: '2k',
    label: '2K prompt',
    approximatePromptTokens: 2048,
    numPredict: 64,
  }),
  '8k': Object.freeze({
    id: '8k',
    label: '8K context saturation',
    approximatePromptTokens: 8192,
    numPredict: 64,
  }),
});

const SYNTHETIC_RECORD = [
  'The Atlas support queue is stable and every accepted task remains queued until completion.',
  'The verified priority is reliability, the release color is amber, and the review owner is Morgan.',
  'Local inference uses an isolated loopback runtime and never includes credentials in diagnostic output.',
  'Operators compare first-token latency, total latency, generated tokens per second, and timeout counts.',
].join(' ');

const HELP = `
Minimalist Chat local Ollama benchmark

Usage:
  node tools/ai-local-benchmark.mjs [options]

The command is a dry run unless --execute is supplied. It talks directly to the
isolated Ollama runtime, not the authenticated bridge or public tunnel.

Options:
  --execute                     Run inference (default: dry run only)
  --dry-run                     Explicitly plan without inference
  --base-url URL                Loopback Ollama origin (default: ${DEFAULT_BASE_URL})
  --profiles LIST               fast,smart or a subset (default: fast,smart)
  --workloads LIST              short,2k,8k or a subset (default: short,2k,8k)
  --concurrency LIST            subset of 1,2,4,6,8,10 (default: all)
  --warmups N                   Serial warmups per scenario (default: 1)
  --measured-per-worker N       Requests per worker per scenario (default: 1)
  --timeout-ms N                Per-request timeout (default: 180000)
  --output PATH                 JSON report destination
  --help                        Show this help

Before --execute, turn the protected runtime On in Minimalist Analysis. Reports
contain metrics and fixed workload identifiers only; prompts, replies, headers,
and credentials are never retained.
`.trim();

function finiteInteger(value, label, { min, max }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} through ${max}.`);
  }
  return number;
}

function csvValues(value, label) {
  const values = String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length) throw new Error(`${label} cannot be empty.`);
  return [...new Set(values)];
}

export function normalizeLoopbackBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('The benchmark base URL must be a valid loopback URL.');
  }

  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost'
    || hostname === '[::1]'
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);

  if (!['http:', 'https:'].includes(url.protocol) || !loopback) {
    throw new Error('The benchmark only permits HTTP(S) loopback URLs.');
  }
  if (url.username || url.password) {
    throw new Error('Credentials are not permitted in the benchmark URL.');
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('The benchmark base URL must be an origin without a path, query, or fragment.');
  }

  url.pathname = '/';
  return url.href.replace(/\/$/, '');
}

export function parseArgs(argv = []) {
  const config = {
    dryRun: true,
    help: false,
    baseUrl: DEFAULT_BASE_URL,
    profiles: ['fast', 'smart'],
    workloads: ['short', '2k', '8k'],
    concurrency: [...ALLOWED_CONCURRENCY],
    warmups: 1,
    measuredPerWorker: 1,
    timeoutMs: 180_000,
    output: '',
  };

  const readValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--execute') config.dryRun = false;
    else if (flag === '--dry-run') config.dryRun = true;
    else if (flag === '--help' || flag === '-h') config.help = true;
    else if (flag === '--base-url') {
      config.baseUrl = readValue(index, flag);
      index += 1;
    } else if (flag === '--profiles') {
      config.profiles = csvValues(readValue(index, flag), flag);
      index += 1;
    } else if (flag === '--workloads') {
      config.workloads = csvValues(readValue(index, flag), flag);
      index += 1;
    } else if (flag === '--concurrency') {
      config.concurrency = csvValues(readValue(index, flag), flag).map(Number);
      index += 1;
    } else if (flag === '--warmups') {
      config.warmups = finiteInteger(readValue(index, flag), flag, { min: 0, max: 20 });
      index += 1;
    } else if (flag === '--measured-per-worker') {
      config.measuredPerWorker = finiteInteger(readValue(index, flag), flag, { min: 1, max: 100 });
      index += 1;
    } else if (flag === '--timeout-ms') {
      config.timeoutMs = finiteInteger(readValue(index, flag), flag, { min: 1000, max: 900_000 });
      index += 1;
    } else if (flag === '--output') {
      config.output = readValue(index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown benchmark option: ${flag}`);
    }
  }

  config.baseUrl = normalizeLoopbackBaseUrl(config.baseUrl);
  for (const profile of config.profiles) {
    if (!PROFILE_DEFINITIONS[profile]) throw new Error(`Unknown profile: ${profile}`);
  }
  for (const workload of config.workloads) {
    if (!WORKLOAD_DEFINITIONS[workload]) throw new Error(`Unknown workload: ${workload}`);
  }
  for (const concurrency of config.concurrency) {
    if (!ALLOWED_CONCURRENCY.includes(concurrency)) {
      throw new Error(`Concurrency must be selected from ${ALLOWED_CONCURRENCY.join(', ')}.`);
    }
  }
  config.concurrency = [...new Set(config.concurrency)];
  return config;
}

function fixedSizePrompt(approximateTokens) {
  const targetCharacters = approximateTokens * 4;
  const prefix = [
    'This is a deterministic synthetic inference benchmark.',
    'Read the operational notes and answer the final question in one concise sentence.',
    '',
  ].join('\n');
  const suffix = [
    '',
    'Question: What are the verified priority, release color, and review owner?',
  ].join('\n');
  const bodyLength = Math.max(0, targetCharacters - prefix.length - suffix.length);
  let body = '';
  let record = 1;
  while (body.length < bodyLength) {
    body += ` Record ${record}: ${SYNTHETIC_RECORD}`;
    record += 1;
  }
  return `${prefix}${body.slice(0, bodyLength)}${suffix}`;
}

export function buildWorkloadPrompt(workloadId) {
  const workload = WORKLOAD_DEFINITIONS[workloadId];
  if (!workload) throw new Error(`Unknown workload: ${workloadId}`);
  if (workloadId === 'short') {
    return [
      'This is a deterministic local inference benchmark.',
      'Reply with one short sentence explaining why queued work should not be discarded when every execution slot is busy.',
    ].join(' ');
  }
  return fixedSizePrompt(workload.approximatePromptTokens);
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function nanosecondsToMilliseconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? rounded(number / 1_000_000) : null;
}

function generationTokensPerSecond(event) {
  const count = Number(event?.eval_count);
  const duration = Number(event?.eval_duration);
  if (!Number.isFinite(count) || count < 0 || !Number.isFinite(duration) || duration <= 0) return null;
  return rounded(count / (duration / 1_000_000_000));
}

function benchmarkFailure({ startedAt, now, status = null, timedOut = false, errorCode }) {
  return {
    ok: false,
    status,
    timed_out: timedOut,
    error_code: errorCode,
    latency_ms: rounded(Math.max(0, now() - startedAt)),
    ttft_ms: null,
    prompt_eval_count: null,
    eval_count: null,
    generation_tokens_per_second: null,
    ollama_total_ms: null,
    ollama_load_ms: null,
    ollama_prompt_eval_ms: null,
    ollama_eval_ms: null,
  };
}

async function consumeNdjson(response, { startedAt, now }) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const error = new Error('Ollama returned no readable NDJSON body.');
    error.code = 'invalid_stream';
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let firstTokenAt = null;
  let finalEvent = null;
  let sawEvent = false;

  const acceptLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      const error = new Error('Ollama returned invalid NDJSON.');
      error.code = 'invalid_stream';
      throw error;
    }
    sawEvent = true;
    if (event?.error) {
      const error = new Error('Ollama reported an inference error.');
      error.code = 'ollama_error';
      throw error;
    }
    const content = typeof event?.message?.content === 'string'
      ? event.message.content
      : typeof event?.response === 'string'
        ? event.response
        : '';
    if (firstTokenAt == null && content.length > 0) firstTokenAt = now();
    if (event?.done === true) finalEvent = event;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) acceptLine(line);
  }
  buffered += decoder.decode();
  if (buffered.trim()) acceptLine(buffered);

  if (!sawEvent || !finalEvent) {
    const error = new Error('Ollama stream ended without a final metrics event.');
    error.code = 'invalid_stream';
    throw error;
  }

  const finishedAt = now();
  return {
    ok: true,
    status: response.status,
    timed_out: false,
    error_code: null,
    latency_ms: rounded(Math.max(0, finishedAt - startedAt)),
    ttft_ms: firstTokenAt == null ? null : rounded(Math.max(0, firstTokenAt - startedAt)),
    prompt_eval_count: Number.isFinite(Number(finalEvent.prompt_eval_count))
      ? Number(finalEvent.prompt_eval_count)
      : null,
    eval_count: Number.isFinite(Number(finalEvent.eval_count)) ? Number(finalEvent.eval_count) : null,
    generation_tokens_per_second: generationTokensPerSecond(finalEvent),
    ollama_total_ms: nanosecondsToMilliseconds(finalEvent.total_duration),
    ollama_load_ms: nanosecondsToMilliseconds(finalEvent.load_duration),
    ollama_prompt_eval_ms: nanosecondsToMilliseconds(finalEvent.prompt_eval_duration),
    ollama_eval_ms: nanosecondsToMilliseconds(finalEvent.eval_duration),
  };
}

export async function runOllamaRequest({
  baseUrl = DEFAULT_BASE_URL,
  profileId,
  workloadId,
  timeoutMs = 180_000,
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
}) {
  const safeBaseUrl = normalizeLoopbackBaseUrl(baseUrl);
  const profile = PROFILE_DEFINITIONS[profileId];
  const workload = WORKLOAD_DEFINITIONS[workloadId];
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  if (!workload) throw new Error(`Unknown workload: ${workloadId}`);
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const startedAt = now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Benchmark request timed out.', 'TimeoutError'));
  }, timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(`${safeBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: profile.model,
        stream: true,
        think: profile.thinking,
        messages: [{ role: 'user', content: buildWorkloadPrompt(workloadId) }],
        options: {
          num_ctx: profile.contextWindow,
          num_predict: workload.numPredict,
          temperature: 0,
          seed: 42,
        },
      }),
      signal: controller.signal,
    });

    if (!response?.ok) {
      await response?.body?.cancel?.().catch(() => {});
      return benchmarkFailure({
        startedAt,
        now,
        status: Number(response?.status) || null,
        errorCode: 'http_error',
      });
    }

    return await consumeNdjson(response, { startedAt, now });
  } catch (error) {
    const errorCode = timedOut
      ? 'timeout'
      : error?.code === 'invalid_stream' || error?.code === 'ollama_error'
        ? error.code
        : 'network_error';
    return benchmarkFailure({
      startedAt,
      now,
      timedOut,
      errorCode,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return rounded(sorted[0]);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return rounded(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

function metricSummary(samples, key) {
  const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: rounded(Math.min(...values)),
    mean: rounded(sum / values.length),
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: rounded(Math.max(...values)),
  };
}

function countBy(samples, key, fallback = 'none') {
  const counts = {};
  for (const sample of samples) {
    const value = String(sample[key] ?? fallback);
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function summarizeScenario(samples, wallDurationMs) {
  const succeeded = samples.filter((sample) => sample.ok);
  const failed = samples.filter((sample) => !sample.ok);
  return {
    requested: samples.length,
    succeeded: succeeded.length,
    errors: failed.length,
    timeouts: failed.filter((sample) => sample.timed_out).length,
    wall_duration_ms: rounded(wallDurationMs),
    throughput_requests_per_second: wallDurationMs > 0
      ? rounded(succeeded.length / (wallDurationMs / 1000))
      : null,
    errors_by_code: countBy(failed, 'error_code'),
    http_statuses: countBy(samples.filter((sample) => sample.status != null), 'status'),
    latency_ms: metricSummary(succeeded, 'latency_ms'),
    ttft_ms: metricSummary(succeeded, 'ttft_ms'),
    prompt_eval_tokens: metricSummary(succeeded, 'prompt_eval_count'),
    generated_tokens: metricSummary(succeeded, 'eval_count'),
    generation_tokens_per_second: metricSummary(succeeded, 'generation_tokens_per_second'),
    ollama_total_ms: metricSummary(succeeded, 'ollama_total_ms'),
    ollama_load_ms: metricSummary(succeeded, 'ollama_load_ms'),
    ollama_prompt_eval_ms: metricSummary(succeeded, 'ollama_prompt_eval_ms'),
    ollama_eval_ms: metricSummary(succeeded, 'ollama_eval_ms'),
  };
}

function retainedSample(sample, sequence) {
  return {
    sequence,
    ok: sample.ok,
    status: sample.status,
    timed_out: sample.timed_out,
    error_code: sample.error_code,
    latency_ms: sample.latency_ms,
    ttft_ms: sample.ttft_ms,
    prompt_eval_count: sample.prompt_eval_count,
    eval_count: sample.eval_count,
    generation_tokens_per_second: sample.generation_tokens_per_second,
    ollama_total_ms: sample.ollama_total_ms,
    ollama_load_ms: sample.ollama_load_ms,
    ollama_prompt_eval_ms: sample.ollama_prompt_eval_ms,
    ollama_eval_ms: sample.ollama_eval_ms,
  };
}

async function runScenario(config, profileId, workloadId, concurrency, dependencies) {
  const runOne = () => runOllamaRequest({
    baseUrl: config.baseUrl,
    profileId,
    workloadId,
    timeoutMs: config.timeoutMs,
    fetchImpl: dependencies.fetchImpl,
    now: dependencies.now,
  });

  const warmupSamples = [];
  for (let index = 0; index < config.warmups; index += 1) warmupSamples.push(await runOne());
  const warmupSummary = {
    requested: warmupSamples.length,
    succeeded: warmupSamples.filter((sample) => sample.ok).length,
    errors: warmupSamples.filter((sample) => !sample.ok).length,
    timeouts: warmupSamples.filter((sample) => sample.timed_out).length,
  };

  if (warmupSamples.length && warmupSummary.succeeded === 0) {
    return {
      profile: profileId,
      model: PROFILE_DEFINITIONS[profileId].model,
      workload: workloadId,
      concurrency,
      warmup: warmupSummary,
      skipped_reason: 'warmup_failed',
      summary: summarizeScenario([], 0),
      samples: [],
    };
  }

  const totalRequests = concurrency * config.measuredPerWorker;
  const samples = new Array(totalRequests);
  let cursor = 0;
  const startedAt = dependencies.now();
  const worker = async () => {
    while (true) {
      const sequence = cursor;
      cursor += 1;
      if (sequence >= totalRequests) return;
      samples[sequence] = await runOne();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wallDurationMs = Math.max(0, dependencies.now() - startedAt);

  return {
    profile: profileId,
    model: PROFILE_DEFINITIONS[profileId].model,
    workload: workloadId,
    concurrency,
    warmup: warmupSummary,
    skipped_reason: null,
    summary: summarizeScenario(samples, wallDurationMs),
    samples: samples.map((sample, index) => retainedSample(sample, index + 1)),
  };
}

function plannedScenarios(config) {
  const scenarios = [];
  for (const profile of config.profiles) {
    for (const workload of config.workloads) {
      for (const concurrency of config.concurrency) {
        scenarios.push({
          profile,
          model: PROFILE_DEFINITIONS[profile].model,
          workload,
          concurrency,
          planned_warmups: config.warmups,
          planned_measured_requests: concurrency * config.measuredPerWorker,
        });
      }
    }
  }
  return scenarios;
}

function baseReport(config) {
  const scenarios = plannedScenarios(config);
  return {
    schema: 'minimalist.local-ai-benchmark.v1',
    benchmark_id: randomUUID(),
    created_at: new Date().toISOString(),
    mode: config.dryRun ? 'dry-run' : 'executed',
    safety: {
      loopback_only: true,
      authentication_used: false,
      prompts_retained: false,
      replies_retained: false,
    },
    runtime: {
      base_url: config.baseUrl,
      api: '/api/chat',
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    configuration: {
      profiles: config.profiles.map((id) => ({
        id,
        model: PROFILE_DEFINITIONS[id].model,
        context_window: PROFILE_DEFINITIONS[id].contextWindow,
        thinking: PROFILE_DEFINITIONS[id].thinking,
      })),
      workloads: config.workloads.map((id) => ({
        id,
        approximate_prompt_tokens: WORKLOAD_DEFINITIONS[id].approximatePromptTokens,
        maximum_generated_tokens: WORKLOAD_DEFINITIONS[id].numPredict,
      })),
      concurrency: config.concurrency,
      warmups_per_scenario: config.warmups,
      measured_requests_per_worker: config.measuredPerWorker,
      timeout_ms: config.timeoutMs,
    },
    plan: {
      scenarios: scenarios.length,
      warmup_requests: scenarios.reduce((sum, scenario) => sum + scenario.planned_warmups, 0),
      measured_requests: scenarios.reduce((sum, scenario) => sum + scenario.planned_measured_requests, 0),
    },
  };
}

export async function runBenchmark(config, {
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
} = {}) {
  const normalized = parseArgs([
    config.dryRun === false ? '--execute' : '--dry-run',
    '--base-url', config.baseUrl || DEFAULT_BASE_URL,
    '--profiles', (config.profiles || ['fast', 'smart']).join(','),
    '--workloads', (config.workloads || ['short', '2k', '8k']).join(','),
    '--concurrency', (config.concurrency || ALLOWED_CONCURRENCY).join(','),
    '--warmups', String(config.warmups ?? 1),
    '--measured-per-worker', String(config.measuredPerWorker ?? 1),
    '--timeout-ms', String(config.timeoutMs ?? 180_000),
  ]);
  const report = baseReport(normalized);
  if (normalized.dryRun) {
    report.scenarios = plannedScenarios(normalized);
    report.summary = {
      requested: 0,
      succeeded: 0,
      errors: 0,
      timeouts: 0,
    };
    return report;
  }

  const scenarios = [];
  for (const profile of normalized.profiles) {
    for (const workload of normalized.workloads) {
      for (const concurrency of normalized.concurrency) {
        scenarios.push(await runScenario(normalized, profile, workload, concurrency, { fetchImpl, now }));
      }
    }
  }
  report.scenarios = scenarios;
  report.summary = scenarios.reduce((summary, scenario) => ({
    requested: summary.requested + scenario.summary.requested + scenario.warmup.requested,
    succeeded: summary.succeeded + scenario.summary.succeeded + scenario.warmup.succeeded,
    errors: summary.errors + scenario.summary.errors + scenario.warmup.errors,
    timeouts: summary.timeouts + scenario.summary.timeouts + scenario.warmup.timeouts,
  }), { requested: 0, succeeded: 0, errors: 0, timeouts: 0 });
  return report;
}

export function assertSafeReport(report) {
  const forbiddenKeys = new Set([
    'authorization',
    'body',
    'content',
    'credential',
    'credentials',
    'headers',
    'messages',
    'prompt',
    'reply',
    'request_body',
    'response',
    'secret',
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) {
        throw new Error(`Unsafe benchmark report field: ${key}`);
      }
      visit(child);
    }
  };
  visit(report);
  return report;
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve('artifacts', 'ai-local-benchmark', `local-ai-benchmark-${stamp}.json`);
}

export async function writeBenchmarkReport(report, outputPath = '') {
  assertSafeReport(report);
  const destination = path.resolve(outputPath || defaultOutputPath());
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return destination;
}

async function main() {
  try {
    const config = parseArgs(process.argv.slice(2));
    if (config.help) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    const report = await runBenchmark(config);
    const destination = await writeBenchmarkReport(report, config.output);
    const action = config.dryRun ? 'Dry-run plan' : 'Benchmark';
    process.stdout.write(`${action} saved to ${destination}\n`);
    process.stdout.write(`Scenarios: ${report.plan.scenarios}; measured requests: ${report.plan.measured_requests}\n`);
    if (!config.dryRun) {
      process.stdout.write(`Succeeded: ${report.summary.succeeded}; errors: ${report.summary.errors}; timeouts: ${report.summary.timeouts}\n`);
      if (report.summary.errors > 0) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`Local AI benchmark failed: ${error?.message || 'Unknown error'}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
