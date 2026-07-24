import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildWinstonRouteReceipt,
  classifyWinstonSensitivity,
  resolveAdaptiveWinstonModelProfile,
  resolveServerWinstonRoute,
} = require('../functions/ai-winston-privacy.js');

test('server classification scans sanitized messages and returns no matched text', () => {
  const input = {
    messages: [
      { role: 'system', content: 'Only use approved context.' },
      { role: 'user', content: 'My password is server-secret-42 and SSN is 123-45-6789.' },
    ],
  };
  const result = classifyWinstonSensitivity(input);
  assert.equal(result.severity, 'critical');
  assert.equal(result.localOnly, true);
  assert.deepEqual(result.categories.map(({ id }) => id), ['credentials', 'government_id']);
  assert.doesNotMatch(JSON.stringify(result), /server-secret|123-45-6789|password is/i);
  assert.deepEqual(classifyWinstonSensitivity(input), result);
});

test('server classification recognizes declared context and attachment metadata only', () => {
  const classified = classifyWinstonSensitivity({
    messages: [{ role: 'user', content: 'Summarize the attachment.' }],
    attachment: {
      name: 'Patient lab results.pdf',
      mimeType: 'application/pdf',
      image: 'base64-content-that-must-not-be-inspected-or-returned',
    },
    context: {
      dataClasses: ['confidential'],
      unrelatedPrivateValue: 'must-not-appear',
    },
  });
  assert.equal(classified.localOnly, true);
  assert.deepEqual(
    classified.categories.map(({ id }) => id),
    ['health', 'private_document'],
  );
  assert.doesNotMatch(JSON.stringify(classified), /base64-content|must-not-appear|Patient lab/i);
});

test('high-sensitivity server requests can only use local inference', () => {
  const route = resolveServerWinstonRoute({
    messages: [{ role: 'user', content: 'My medical record diagnosis: migraine.' }],
    providerHealth: {
      local: { available: true, latencyMs: 20_000 },
      cloudflare: { available: true, latencyMs: 20 },
      groq: { available: true, latencyMs: 10 },
    },
    localMetrics: { ttftMs: 10_000, tokensPerSecond: 1 },
  });
  assert.equal(route.localOnly, true);
  assert.equal(route.provider, 'local');
  assert.deepEqual(route.fallbackProviders, []);
  assert.ok(route.excludedProviders.every(({ reason }) => reason === 'local_only'));
  assert.doesNotMatch(JSON.stringify(route), /migraine|medical record/i);
});

test('server fails closed when sensitive input cannot run locally', () => {
  const route = resolveServerWinstonRoute({
    messages: [{ role: 'user', content: 'api_key: sk-live-server-secret-1234567890' }],
    attachment: { mimeType: 'audio/webm' },
    providerHealth: {
      local: { available: true, supports: ['text'] },
      groq: { available: true, supports: ['text', 'audio'] },
    },
  });
  assert.equal(route.routeBlocked, true);
  assert.equal(route.provider, null);
  assert.ok(route.reasons.includes('no_healthy_capable_provider'));
});

test('healthy low-sensitivity requests adapt to queue, attachment, and feedback signals', () => {
  const route = resolveServerWinstonRoute({
    messages: [{ role: 'user', content: 'Transcribe this recording.' }],
    attachment: { mimeType: 'audio/webm' },
    providerHealth: {
      local: { supports: ['text', 'audio'] },
      cloudflare: { healthy: false, supports: ['text', 'audio'] },
      groq: { supports: ['text', 'audio'], latencyMs: 200 },
    },
    queue: {
      local: { depth: 19, capacity: 10 },
      groq: { depth: 1, capacity: 40 },
    },
    feedback: {
      providers: {
        local: { helpful: 2, total: 10 },
        groq: { helpful: 9, total: 10 },
      },
    },
  });
  assert.equal(route.provider, 'groq');
  assert.ok(route.reasons.includes('audio_specialist'));
  assert.equal(route.providerScores.cloudflare, undefined);
});

test('adaptive server profile is deterministic, bounded, and honors explicit choices', () => {
  assert.deepEqual(
    resolveAdaptiveWinstonModelProfile('What time is the meeting?'),
    {
      requestedProfile: 'auto',
      modelProfile: 'fast',
      automatic: true,
      reason: 'short_request',
      complexityScore: 0,
    },
  );
  const complex = resolveAdaptiveWinstonModelProfile({
    requestedProfile: 'auto',
    messages: [{
      role: 'user',
      content: 'Analyze the trade-offs and create a comprehensive architecture plan.',
    }],
    attachment: { mimeType: 'application/pdf' },
  });
  assert.equal(complex.modelProfile, 'smart');
  assert.ok(complex.complexityScore >= 4 && complex.complexityScore <= 10);
  assert.equal(
    resolveAdaptiveWinstonModelProfile('anything', { requestedProfile: 'smart' }).modelProfile,
    'smart',
  );
});

test('server route receipt hashes request identity and contains no message content', () => {
  const classification = classifyWinstonSensitivity({
    messages: [{ role: 'user', content: 'password: receipt-secret' }],
  });
  const routeDecision = resolveServerWinstonRoute({
    messages: [{ role: 'user', content: 'password: receipt-secret' }],
    providerHealth: { local: { available: false } },
  });
  const receipt = buildWinstonRouteReceipt({
    requestId: 'request_private_123',
    classification,
    routeDecision,
    createdAt: 500,
  });
  assert.match(receipt.requestHash, /^[a-f0-9]{64}$/);
  assert.notEqual(receipt.requestHash, 'request_private_123');
  assert.equal(receipt.provider, 'blocked');
  assert.equal(receipt.localOnly, true);
  assert.doesNotMatch(JSON.stringify(receipt), /receipt-secret|password:|request_private_123/i);
});

test('server privacy module never logs and decision contracts omit raw prompt fields', () => {
  const source = fs.readFileSync(
    new URL('../functions/ai-winston-privacy.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\bconsole\.(?:log|warn|error|info|debug)\b/);

  const decision = resolveServerWinstonRoute({
    messages: [{ role: 'user', content: 'private-runtime-sentinel' }],
  });
  const receipt = buildWinstonRouteReceipt({
    classification: classifyWinstonSensitivity('private-runtime-sentinel'),
    routeDecision: decision,
  });
  for (const result of [decision, receipt]) {
    assert.doesNotMatch(JSON.stringify(result), /private-runtime-sentinel/);
    assert.equal('prompt' in result, false);
    assert.equal('messages' in result, false);
    assert.equal('content' in result, false);
    assert.equal('text' in result, false);
  }
});
