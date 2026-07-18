import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_PROVIDER_TIERS,
  DEFAULT_TOTAL_PROVIDER_CAPACITY,
  allocateProviderLease,
  normalizeProviderRouterState,
  normalizedExcludedProviders,
  releaseProviderLease,
} = require('../functions/ai-provider-routing.js');

function acquire(state, index, now = 1000, ttlMs = 150000) {
  return allocateProviderLease(state, {
    leaseId: `lease-${index}`,
    now,
    ttlMs,
  });
}

test('routes requests 1-10 locally, 11-50 to Cloudflare, and 51-90 to Groq', () => {
  let state = {};
  const providers = [];

  for (let index = 1; index <= DEFAULT_TOTAL_PROVIDER_CAPACITY; index += 1) {
    const allocation = acquire(state, index);
    assert.equal(allocation.full, false);
    providers.push(allocation.lease.provider);
    state = allocation.state;
  }

  assert.deepEqual(providers, [
    ...Array(10).fill('ollama-bridge'),
    ...Array(40).fill('cloudflare-workers-ai'),
    ...Array(40).fill('groq'),
  ]);

  const overflow = acquire(state, 91);
  assert.equal(overflow.full, true);
  assert.equal(overflow.lease, null);
  assert.equal(Object.keys(overflow.state.leases).length, DEFAULT_TOTAL_PROVIDER_CAPACITY);
});

test('releasing a lease reopens the earliest available provider tier', () => {
  let state = {};
  for (let index = 1; index <= DEFAULT_TOTAL_PROVIDER_CAPACITY; index += 1) {
    state = acquire(state, index).state;
  }

  state = releaseProviderLease(state, { leaseId: 'lease-2', now: 2000 });
  const allocation = acquire(state, 'replacement', 2001);

  assert.equal(allocation.lease.provider, 'ollama-bridge');
  assert.equal(Object.keys(allocation.state.leases).length, DEFAULT_TOTAL_PROVIDER_CAPACITY);
});

test('releasing Cloudflare or Groq capacity reopens that same filled tier', () => {
  let fullState = {};
  for (let index = 1; index <= DEFAULT_TOTAL_PROVIDER_CAPACITY; index += 1) {
    fullState = acquire(fullState, index).state;
  }

  for (const [leaseId, expectedProvider] of [
    ['lease-50', 'cloudflare-workers-ai'],
    ['lease-51', 'groq'],
  ]) {
    const released = releaseProviderLease(fullState, { leaseId, now: 2000 });
    const allocation = acquire(released, `replacement-${leaseId}`, 2001);
    assert.equal(allocation.lease.provider, expectedProvider);
    assert.equal(Object.keys(allocation.state.leases).length, DEFAULT_TOTAL_PROVIDER_CAPACITY);
  }
});

test('leases expiring exactly at now are pruned and reusable', () => {
  let state = {};
  for (let index = 1; index <= 3; index += 1) state = acquire(state, index, 1000, 1000).state;

  const allocation = acquire(state, 'fresh', 2000, 1000);

  assert.equal(allocation.lease.provider, 'ollama-bridge');
  assert.deepEqual(Object.keys(allocation.state.leases), ['lease-fresh']);
});

test('normalization removes malformed, expired, and unknown-provider leases', () => {
  const state = normalizeProviderRouterState({
    leases: {
      good: { provider: 'groq', acquiredAt: 100, expiresAt: 5000 },
      expired: { provider: 'ollama-bridge', acquiredAt: 100, expiresAt: 1000 },
      malformed: { provider: 'cloudflare-workers-ai', acquiredAt: 'never', expiresAt: 5000 },
      unknown: { provider: 'another-provider', acquiredAt: 100, expiresAt: 5000 },
    },
  }, 1000);

  assert.deepEqual(state.leases, {
    good: { provider: 'groq', acquiredAt: 100, expiresAt: 5000 },
  });
});

test('re-evaluating one transaction lease id is idempotent', () => {
  const first = acquire({}, 'same');
  const retried = acquire(first.state, 'same', 1001);

  assert.equal(retried.reused, true);
  assert.deepEqual(retried.lease, first.lease);
  assert.equal(Object.keys(retried.state.leases).length, 1);
});

test('re-evaluating the same lease remains idempotent after all slots fill', () => {
  let state = {};
  for (let index = 1; index <= DEFAULT_TOTAL_PROVIDER_CAPACITY; index += 1) {
    state = acquire(state, index).state;
  }

  const retried = acquire(state, DEFAULT_TOTAL_PROVIDER_CAPACITY, 1001);

  assert.equal(retried.reused, true);
  assert.equal(retried.lease.provider, 'groq');
  assert.equal(Object.keys(retried.state.leases).length, DEFAULT_TOTAL_PROVIDER_CAPACITY);
});

test('fails closed when persisted state already exceeds a provider capacity', () => {
  const state = {
    leases: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [
      `unexpected-${index}`,
      { provider: 'ollama-bridge', acquiredAt: 100, expiresAt: 5000 },
    ])),
  };

  const allocation = acquire(state, 'new', 1000);

  assert.equal(allocation.full, true);
  assert.equal(allocation.lease, null);
  assert.equal(Object.keys(allocation.state.leases).length, 11);
});

test('allocation does not mutate transaction input state', () => {
  const state = {
    version: 1,
    leases: {
      existing: { provider: 'ollama-bridge', acquiredAt: 100, expiresAt: 5000 },
    },
    updatedAt: 100,
  };
  const before = structuredClone(state);

  acquire(state, 'new', 1000);

  assert.deepEqual(state, before);
});

test('release is idempotent and provider tiers remain fixed at 10/40/40', () => {
  const initial = acquire({}, 1).state;
  const released = releaseProviderLease(initial, { leaseId: 'lease-1', now: 2000 });
  const releasedAgain = releaseProviderLease(released, { leaseId: 'lease-1', now: 2001 });

  assert.deepEqual(releasedAgain.leases, {});
  assert.deepEqual(DEFAULT_PROVIDER_TIERS.map(({ provider, capacity }) => [provider, capacity]), [
    ['ollama-bridge', 10],
    ['cloudflare-workers-ai', 40],
    ['groq', 40],
  ]);
  assert.equal(DEFAULT_TOTAL_PROVIDER_CAPACITY, 90);
});

test('provider exclusions route a retry to the earliest eligible provider', () => {
  const cloudflare = allocateProviderLease({}, {
    leaseId: 'retry-1',
    now: 1000,
    excludedProviders: ['ollama-bridge'],
  });
  assert.equal(cloudflare.lease.provider, 'cloudflare-workers-ai');

  const groq = allocateProviderLease({}, {
    leaseId: 'retry-2',
    now: 1000,
    excludedProviders: new Set(['ollama-bridge', 'cloudflare-workers-ai']),
  });
  assert.equal(groq.lease.provider, 'groq');
});

test('exclusions fail closed when every eligible provider is excluded or full', () => {
  const allExcluded = allocateProviderLease({}, {
    leaseId: 'none',
    now: 1000,
    excludedProviders: DEFAULT_PROVIDER_TIERS.map(({ provider }) => provider),
  });
  assert.equal(allExcluded.full, true);
  assert.equal(allExcluded.lease, null);

  let state = {};
  for (let index = 1; index <= 40; index += 1) {
    state = allocateProviderLease(state, {
      leaseId: `cloudflare-${index}`,
      now: 1000,
      excludedProviders: ['ollama-bridge'],
    }).state;
  }
  const cloudflareFull = allocateProviderLease(state, {
    leaseId: 'cloudflare-overflow',
    now: 1000,
    excludedProviders: ['ollama-bridge', 'groq'],
  });
  assert.equal(cloudflareFull.full, true);
});

test('transaction retries reuse an existing lease even if it is later excluded', () => {
  const first = allocateProviderLease({}, {
    leaseId: 'same-excluded',
    now: 1000,
  });
  const retried = allocateProviderLease(first.state, {
    leaseId: 'same-excluded',
    now: 1001,
    excludedProviders: ['ollama-bridge'],
  });

  assert.equal(retried.reused, true);
  assert.equal(retried.lease.provider, 'ollama-bridge');
  assert.equal(Object.keys(retried.state.leases).length, 1);
});

test('exclusion normalization keeps only configured unique providers', () => {
  assert.deepEqual(normalizedExcludedProviders([
    ' ollama-bridge ',
    'ollama-bridge',
    'unknown',
    '',
    'groq',
  ]), ['ollama-bridge', 'groq']);
});
