import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_PROVIDER_TIERS,
  DEFAULT_TOTAL_PROVIDER_CAPACITY,
  allocateProviderLease,
} = require('../functions/ai-provider-routing.js');
const {
  AI_QUEUE_FAR_FUTURE_MS,
  aiQueueJobReadiness,
  aiQueueJobId,
  aiQueueRetryDelayMs,
  claimAiQueueJob,
  completeAiQueueJob,
  createAiQueueJob,
  failAiQueueJob,
  requeueExpiredAiQueueJob,
  retryAiQueueJob,
} = require('../functions/ai-request-queue.js');

function queuedJob(overrides = {}) {
  return createAiQueueJob({
    jobId: overrides.jobId || aiQueueJobId('user-1', overrides.requestId || 'request-0001'),
    queueKey: overrides.queueKey || '0000000000000001_job',
    ownerUid: 'user-1',
    requestId: overrides.requestId || 'request-0001',
    payloadHash: 'a'.repeat(64),
    payload: { mode: 'room', messages: [{ role: 'user', content: 'hello' }] },
    bananas: { cost: 8, remaining: 22 },
    now: overrides.now || 1000,
  });
}

test('500-request admission simulation retains overflow instead of rejecting request 91+', () => {
  let router = {};
  const active = [];
  const pending = [];

  for (let request = 1; request <= 500; request += 1) {
    const allocation = allocateProviderLease(router, {
      leaseId: `lease-${request}`,
      now: 1000,
      ttlMs: 150000,
    });
    if (allocation.full) {
      pending.push(queuedJob({
        requestId: `request-${String(request).padStart(4, '0')}`,
        queueKey: `${String(request).padStart(16, '0')}_job`,
      }));
    } else {
      router = allocation.state;
      active.push(allocation.lease);
    }
  }

  assert.equal(active.length, DEFAULT_TOTAL_PROVIDER_CAPACITY);
  assert.deepEqual(
    DEFAULT_PROVIDER_TIERS.map(({ provider }) => active.filter((lease) => lease.provider === provider).length),
    [10, 40, 40],
  );
  assert.equal(pending.length, 410);
  assert.equal(pending[0].requestId, 'request-0091');
  assert.equal(pending.at(-1).requestId, 'request-0500');
});

test('job IDs are stable per owner and request without exposing either value', () => {
  const first = aiQueueJobId('user-1', 'request-0001');
  assert.equal(first, aiQueueJobId('user-1', 'request-0001'));
  assert.notEqual(first, aiQueueJobId('user-2', 'request-0001'));
  assert.notEqual(first, aiQueueJobId('user-1', 'request-0002'));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes('user-1'), false);
});

test('claim and completion use a fencing token and remove the private payload', () => {
  const queued = queuedJob();
  assert.equal(queued.expiresAt, AI_QUEUE_FAR_FUTURE_MS);
  assert.equal(queued.pointerPending, true);
  assert.equal(queued.statusProjectionPending, true);
  const running = claimAiQueueJob(queued, {
    claimId: 'claim-1',
    provider: 'ollama-bridge',
    now: 2000,
    claimTtlMs: 180000,
  });

  assert.equal(running.status, 'running');
  assert.equal(running.attempts, 1);
  assert.equal(running.claimExpiresAt, 182000);
  assert.equal(running.pointerPending, false);
  assert.equal(running.statusProjectionPending, true);
  assert.equal(completeAiQueueJob(running, { claimId: 'stale', result: { reply: 'wrong' } }), null);

  const completed = completeAiQueueJob(running, {
    claimId: 'claim-1',
    result: { reply: 'done', provider: 'ollama-bridge' },
    now: 3000,
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.reply, 'done');
  assert.equal(Object.hasOwn(completed, 'payload'), false);
  assert.equal(Object.hasOwn(completed, 'claimId'), false);
  assert.equal(completed.claimExpiresAt, AI_QUEUE_FAR_FUTURE_MS);
});

test('retryable provider failures return the fenced job to the durable queue', () => {
  const running = claimAiQueueJob(queuedJob(), {
    claimId: 'claim-current', provider: 'cloudflare-workers-ai', now: 2000,
  });
  assert.equal(retryAiQueueJob(running, {
    claimId: 'stale', error: { status: 503 }, now: 3000, maxAttempts: 3,
  }), null);

  const retried = retryAiQueueJob(running, {
    claimId: 'claim-current',
    error: { code: 'AI_PROVIDER_UNAVAILABLE', message: 'Try again' },
    now: 3000,
    maxAttempts: 3,
  });
  assert.equal(retried.status, 'queued');
  assert.equal(retried.pointerPending, true);
  assert.equal(retried.statusProjectionPending, true);
  assert.equal(retried.expiresAt, AI_QUEUE_FAR_FUTURE_MS);
  assert.deepEqual(retried.lastError, { code: 'AI_PROVIDER_UNAVAILABLE', message: 'Try again' });
  assert.equal(Object.hasOwn(retried, 'claimId'), false);
});

test('expired claims requeue until the bounded retry count is exhausted', () => {
  let job = claimAiQueueJob(queuedJob(), {
    claimId: 'claim-1',
    provider: 'cloudflare-workers-ai',
    now: 1000,
    claimTtlMs: 30000,
  });
  let recovered = requeueExpiredAiQueueJob(job, { now: 31000, maxAttempts: 3 });
  assert.equal(recovered.action, 'requeued');
  assert.equal(recovered.job.status, 'queued');

  job = claimAiQueueJob(recovered.job, {
    claimId: 'claim-2', provider: 'groq', now: 33000, claimTtlMs: 30000,
  });
  recovered = requeueExpiredAiQueueJob(job, { now: 63000, maxAttempts: 3 });
  assert.equal(recovered.action, 'requeued');

  job = claimAiQueueJob(recovered.job, {
    claimId: 'claim-3', provider: 'ollama-bridge', now: 67000, claimTtlMs: 30000,
  });
  recovered = requeueExpiredAiQueueJob(job, { now: 97000, maxAttempts: 3 });
  assert.equal(recovered.action, 'failed');
  assert.equal(recovered.job.error.code, 'AI_QUEUE_RETRY_EXHAUSTED');
  assert.equal(Object.hasOwn(recovered.job, 'payload'), false);
});

test('provider failures are terminal only for the current claim', () => {
  const running = claimAiQueueJob(queuedJob(), {
    claimId: 'claim-current', provider: 'groq', now: 2000,
  });
  assert.equal(failAiQueueJob(running, {
    claimId: 'claim-stale', error: new Error('stale'), now: 3000,
  }), null);

  const failed = failAiQueueJob(running, {
    claimId: 'claim-current',
    error: { code: 'GROQ_UNAVAILABLE', message: 'Provider unavailable', stack: 'private stack' },
    now: 3000,
  });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.error, { code: 'GROQ_UNAVAILABLE', message: 'Provider unavailable' });
  assert.equal(Object.hasOwn(failed.error, 'stack'), false);
  assert.equal(Object.hasOwn(failed, 'payload'), false);
});

test('retryable failures exclude the failed provider and apply exponential backoff', () => {
  const firstRunning = claimAiQueueJob(queuedJob(), {
    claimId: 'claim-1', provider: 'ollama-bridge', now: 2000,
  });
  const firstRetry = retryAiQueueJob(firstRunning, {
    claimId: 'claim-1',
    error: { code: 'LOCAL_UNAVAILABLE' },
    now: 3000,
    retryBaseDelayMs: 1000,
    retryMaxDelayMs: 10000,
  });
  assert.deepEqual(firstRetry.excludedProviders, ['ollama-bridge']);
  assert.equal(firstRetry.retryDelayMs, 1000);
  assert.equal(firstRetry.retryNotBefore, 4000);
  assert.deepEqual(aiQueueJobReadiness(firstRetry, { now: 3999 }), {
    ready: false,
    reason: 'retry-backoff',
    retryNotBefore: 4000,
    waitMs: 1,
    excludedProviders: ['ollama-bridge'],
  });
  assert.equal(claimAiQueueJob(firstRetry, {
    claimId: 'too-early', provider: 'cloudflare-workers-ai', now: 3999,
  }), null);
  assert.equal(claimAiQueueJob(firstRetry, {
    claimId: 'excluded', provider: 'ollama-bridge', now: 4000,
  }), null);

  const secondRunning = claimAiQueueJob(firstRetry, {
    claimId: 'claim-2', provider: 'cloudflare-workers-ai', now: 4000,
  });
  assert.equal(secondRunning.provider, 'cloudflare-workers-ai');
  assert.equal(Object.hasOwn(secondRunning, 'retryNotBefore'), false);
  const secondRetry = retryAiQueueJob(secondRunning, {
    claimId: 'claim-2',
    error: { code: 'CLOUDFLARE_RATE_LIMITED' },
    now: 5000,
    retryBaseDelayMs: 1000,
    retryMaxDelayMs: 10000,
  });
  assert.deepEqual(secondRetry.excludedProviders, ['ollama-bridge', 'cloudflare-workers-ai']);
  assert.equal(secondRetry.retryDelayMs, 2000);
  assert.equal(secondRetry.retryNotBefore, 7000);
  assert.equal(aiQueueJobReadiness(secondRetry, { now: 7000 }).ready, true);
});

test('provider Retry-After metadata is honored but bounded by the retry cap', () => {
  assert.equal(aiQueueRetryDelayMs({
    attempts: 1,
    error: { retryAfterSeconds: 12 },
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  }), 12000);
  assert.equal(aiQueueRetryDelayMs({
    attempts: 4,
    retryAfterMs: 120000,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  }), 30000);
});

test('expired claims retain FIFO position while becoming temporarily unclaimable', () => {
  const running = claimAiQueueJob(queuedJob(), {
    claimId: 'expired-claim', provider: 'groq', now: 1000, claimTtlMs: 30000,
  });
  const recovered = requeueExpiredAiQueueJob(running, {
    now: 31000,
    maxAttempts: 3,
    retryBaseDelayMs: 2500,
    retryMaxDelayMs: 10000,
  });

  assert.equal(recovered.action, 'requeued');
  assert.equal(recovered.job.queueKey, running.queueKey);
  assert.deepEqual(recovered.job.excludedProviders, ['groq']);
  assert.equal(recovered.job.retryNotBefore, 33500);
  assert.equal(aiQueueJobReadiness(recovered.job, { now: 33499 }).ready, false);
  assert.equal(claimAiQueueJob(recovered.job, {
    claimId: 'premature', provider: 'ollama-bridge', now: 33499,
  }), null);
});
