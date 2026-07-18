import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  AI_MODEL_PROFILES as clientProfiles,
  DEFAULT_AI_MODEL_PROFILE as clientDefault,
  loadAiModelProfile,
  normalizeAiModelProfile as normalizeClientProfile,
  saveAiModelProfile,
} from '../src/features/ai/modelProfiles.js';
import {
  buildAiGatewayCancelPayload,
  buildAiGatewayChatPayload,
  buildAiGatewayQueueStatusPayload,
  buildAiGatewayStatusPayload,
} from '../src/features/ai/gatewayPayload.js';

const require = createRequire(import.meta.url);
const server = require('../functions/ai-model-profiles.js');

test('client and server expose exactly the same two canonical profiles', () => {
  assert.equal(clientDefault, 'fast');
  assert.deepEqual(clientProfiles.map(({ id, model, contextWindow, thinking }) => ({ id, model, contextWindow, thinking })), [
    { id: 'fast', model: 'qwen3:4b-instruct', contextWindow: 8192, thinking: false },
    { id: 'smart', model: 'qwen3:14b', contextWindow: 8192, thinking: false },
  ]);
  assert.deepEqual(server.AI_MODEL_PROFILE_IDS, ['fast', 'smart']);
  assert.deepEqual(
    server.AI_MODEL_PROFILE_IDS.map((id) => ({ id, model: server.AI_MODEL_PROFILES[id].model })),
    clientProfiles.map(({ id, model }) => ({ id, model })),
  );
});

test('server hard-caps every text profile at the efficient 8K context window', () => {
  assert.equal(server.MAX_AI_CONTEXT_WINDOW, 8192);
  assert.equal(server.aiModelContextWindow(server.AI_MODEL_PROFILES.fast), 8192);
  assert.equal(server.aiModelContextWindow(server.AI_MODEL_PROFILES.smart), 8192);
  assert.equal(server.aiModelContextWindow({ contextWindow: 32768 }), 8192);
  assert.equal(server.aiModelContextWindow({ contextWindow: 1024 }), 2048);
});

test('missing and corrupt stored preferences safely fall back to Fast', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(loadAiModelProfile(storage), 'fast');
  values.set('minimalist.ai.model-profile.v1', 'arbitrary:latest');
  assert.equal(loadAiModelProfile(storage), 'fast');
  assert.equal(saveAiModelProfile('SMART', storage, null), 'smart');
  assert.equal(loadAiModelProfile(storage), 'smart');
  assert.equal(normalizeClientProfile({ id: 'smart' }), 'fast');
});

test('server defaults absent profiles and rejects every unknown nonempty shape', () => {
  assert.equal(server.requireAiModelProfile(undefined), 'fast');
  assert.equal(server.requireAiModelProfile(''), 'fast');
  assert.equal(server.requireAiModelProfile(' SMART '), 'smart');
  for (const value of ['qwen3:14b', 'fast;smart', 'turbo', {}, ['fast'], 1]) {
    assert.throws(
      () => server.requireAiModelProfile(value),
      (error) => error.status === 400 && error.code === 'INVALID_AI_MODEL_PROFILE',
    );
  }
});

test('only server environment keys can change the canonical model mapping', () => {
  const env = {
    OLLAMA_MODEL: 'legacy-fast:latest',
    OLLAMA_FAST_MODEL: 'approved-fast:latest',
    OLLAMA_SMART_MODEL: 'approved-smart:latest',
  };
  assert.equal(server.configuredAiModel('fast', env), 'approved-fast:latest');
  assert.equal(server.configuredAiModel('smart', env), 'approved-smart:latest');
  assert.equal(server.configuredAiModel('fast', { OLLAMA_MODEL: 'legacy-fast:latest' }), 'legacy-fast:latest');
  assert.equal(server.configuredAiModel('smart', {}), 'qwen3:14b');
});

test('availability is reported independently for Fast and Smart', () => {
  const profiles = server.publicAiModelProfiles({}, [{ name: 'qwen3:4b-instruct' }]);
  assert.deepEqual(profiles.map(({ id, installed }) => ({ id, installed })), [
    { id: 'fast', installed: true },
    { id: 'smart', installed: false },
  ]);
});

test('gateway payloads contain only a profile ID and ignore raw model injection', () => {
  assert.deepEqual(buildAiGatewayStatusPayload('smart'), { action: 'status', modelProfile: 'smart' });
  assert.deepEqual(buildAiGatewayStatusPayload('smart', { wake: true }), {
    action: 'status',
    modelProfile: 'smart',
    wake: true,
  });
  const payload = buildAiGatewayChatPayload({
    mode: 'room',
    roomId: 'room-1',
    channelId: 'general',
    messages: [{ role: 'user', content: 'Summarize' }],
    modelProfile: 'smart',
    model: 'arbitrary:latest',
    requestId: 'request-123',
  });
  assert.equal(payload.modelProfile, 'smart');
  assert.equal(Object.hasOwn(payload, 'model'), false);
  assert.equal(Object.hasOwn(payload, 'targetUid'), false);
});

test('spotlight payload carries only its exact target UID and selected profile', () => {
  const payload = buildAiGatewayChatPayload({
    mode: 'spotlight',
    modelProfile: 'fast',
    targetUid: 'firebaseUid123',
    requestId: 'request-456',
  });
  assert.equal(payload.mode, 'spotlight');
  assert.equal(payload.modelProfile, 'fast');
  assert.equal(payload.targetUid, 'firebaseUid123');
});

test('queue recovery and cancellation payloads carry only the opaque job ID', () => {
  const jobId = 'a'.repeat(64);
  assert.deepEqual(buildAiGatewayQueueStatusPayload(jobId), {
    action: 'queue-status',
    jobId,
  });
  assert.deepEqual(buildAiGatewayCancelPayload(jobId), {
    action: 'cancel-job',
    jobId,
  });
});
