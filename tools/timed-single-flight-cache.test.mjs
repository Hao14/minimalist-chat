import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimedSingleFlightCache } from '../src/features/community/timedSingleFlightCache.js';

test('coalesces concurrent loads and reuses cached false values until the TTL expires', async () => {
  let timestamp = 1_000;
  let loadCount = 0;
  let finishLoad;
  const cache = createTimedSingleFlightCache({
    ttlMs: 30_000,
    maxEntries: 4,
    now: () => timestamp,
  });
  const loader = () => {
    loadCount += 1;
    return new Promise((resolve) => {
      finishLoad = resolve;
    });
  };

  const first = cache.load('viewer:target', loader);
  const second = cache.load('viewer:target', loader);
  assert.strictEqual(first, second);
  await Promise.resolve();
  finishLoad(false);
  assert.equal(await first, false);
  assert.equal(loadCount, 1);

  assert.equal(await cache.load('viewer:target', loader), false);
  assert.equal(loadCount, 1);

  timestamp += 30_001;
  const expired = cache.load('viewer:target', loader);
  await Promise.resolve();
  finishLoad(true);
  assert.equal(await expired, true);
  assert.equal(loadCount, 2);
});

test('keeps resolved entries bounded with least-recently-used eviction', async () => {
  const cache = createTimedSingleFlightCache({ ttlMs: 30_000, maxEntries: 2 });
  let loadCount = 0;
  const load = (value) => cache.load(value, () => {
    loadCount += 1;
    return value;
  });

  await load('a');
  await load('b');
  await load('c');
  assert.deepEqual(cache.stats(), { resolved: 2, inFlight: 0 });

  await load('a');
  assert.equal(loadCount, 4);
  assert.deepEqual(cache.stats(), { resolved: 2, inFlight: 0 });
});

test('invalidation prevents an older in-flight result from repopulating the cache', async () => {
  let loadCount = 0;
  let finishOldLoad;
  const cache = createTimedSingleFlightCache({ ttlMs: 30_000, maxEntries: 4 });
  const oldLoad = cache.load('target', () => {
    loadCount += 1;
    return new Promise((resolve) => {
      finishOldLoad = resolve;
    });
  });

  await Promise.resolve();
  cache.invalidate('target');
  finishOldLoad({ followers: 1, following: 2 });
  await oldLoad;
  assert.deepEqual(cache.stats(), { resolved: 0, inFlight: 0 });

  const fresh = await cache.load('target', () => {
    loadCount += 1;
    return { followers: 2, following: 2 };
  });
  assert.deepEqual(fresh, { followers: 2, following: 2 });
  assert.equal(loadCount, 2);
});
