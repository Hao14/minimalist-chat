import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  normalizedAiQueueCapacityState,
  releaseAiQueueCapacityState,
  reserveAiQueueCapacityState,
} = require('../functions/ai-queue-capacity.js');

function ids(index, ownerUid = 'owner-a') {
  return {
    jobId: crypto.createHash('sha256').update(`job-${index}`).digest('hex'),
    ownerUid,
    reservationId: `reservation-${index}`,
    payloadHash: crypto.createHash('sha256').update(`payload-${index}`).digest('hex'),
    now: 1000 + index,
  };
}

test('500 outstanding requests fit under the protected queue limits', () => {
  let state = null;
  for (let index = 0; index < 500; index += 1) {
    const transition = reserveAiQueueCapacityState(state, {
      ...ids(index),
      globalLimit: 10000,
      perOwnerLimit: 1000,
    });
    assert.equal(transition.accepted, true);
    state = transition.state;
  }
  assert.equal(state.activeCount, 500);
  assert.equal(state.ownerCounts['owner-a'], 500);
});

test('global and per-owner limits reject only new reservations', () => {
  let state = null;
  for (let index = 0; index < 3; index += 1) {
    const transition = reserveAiQueueCapacityState(state, {
      ...ids(index, index < 2 ? 'owner-a' : 'owner-b'),
      globalLimit: 3,
      perOwnerLimit: 2,
    });
    assert.equal(transition.accepted, true);
    state = transition.state;
  }
  assert.equal(reserveAiQueueCapacityState(state, {
    ...ids(10, 'owner-c'),
    globalLimit: 3,
    perOwnerLimit: 2,
  }).reason, 'global_full');

  let ownerState = null;
  for (let index = 0; index < 2; index += 1) {
    ownerState = reserveAiQueueCapacityState(ownerState, {
      ...ids(index, 'owner-a'),
      globalLimit: 10,
      perOwnerLimit: 2,
    }).state;
  }
  assert.equal(reserveAiQueueCapacityState(ownerState, {
    ...ids(20, 'owner-a'),
    globalLimit: 10,
    perOwnerLimit: 2,
  }).reason, 'owner_full');
});

test('same token is idempotent while owner, token, and payload conflicts fail closed', () => {
  const reservation = ids(1);
  const first = reserveAiQueueCapacityState(null, reservation);
  const duplicate = reserveAiQueueCapacityState(first.state, reservation);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.state.activeCount, 1);

  for (const override of [
    { ownerUid: 'owner-b' },
    { reservationId: 'different-token' },
    { payloadHash: 'b'.repeat(64) },
  ]) {
    const conflict = reserveAiQueueCapacityState(first.state, { ...reservation, ...override });
    assert.equal(conflict.accepted, false);
    assert.equal(conflict.reason, 'conflict');
    assert.equal(conflict.state.activeCount, 1);
  }
});

test('release is idempotent and an old ABA token cannot release a replacement', () => {
  const oldReservation = ids(1);
  const reserved = reserveAiQueueCapacityState(null, oldReservation).state;
  const released = releaseAiQueueCapacityState(reserved, oldReservation);
  assert.equal(released.released, true);
  assert.equal(released.state.activeCount, 0);
  const repeated = releaseAiQueueCapacityState(released.state, oldReservation);
  assert.equal(repeated.released, false);
  assert.equal(repeated.conflict, false);

  const replacement = { ...oldReservation, reservationId: 'replacement-token', now: 5000 };
  const replaced = reserveAiQueueCapacityState(released.state, replacement).state;
  const staleRelease = releaseAiQueueCapacityState(replaced, oldReservation);
  assert.equal(staleRelease.released, false);
  assert.equal(staleRelease.conflict, true);
  assert.equal(staleRelease.state.activeCount, 1);
  assert.equal(staleRelease.state.reservations[oldReservation.jobId].reservationId, 'replacement-token');
});

test('normalization repairs derived counters but fails closed on malformed reservations', () => {
  const valid = ids(1);
  const state = normalizedAiQueueCapacityState({
    activeCount: 999,
    ownerCounts: { attacker: 999 },
    reservations: {
      [valid.jobId]: {
        ownerUid: valid.ownerUid,
        reservationId: valid.reservationId,
        payloadHash: valid.payloadHash,
        createdAt: valid.now,
      },
    },
  });
  assert.equal(state.activeCount, 1);
  assert.deepEqual(state.ownerCounts, { 'owner-a': 1 });
  assert.deepEqual(Object.keys(state.reservations), [valid.jobId]);
  assert.throws(() => normalizedAiQueueCapacityState({
    reservations: { invalid: { ownerUid: 'attacker', createdAt: 1 } },
  }), (error) => error?.code === 'AI_QUEUE_CAPACITY_CORRUPT');
});

test('charged recovery may exceed both caps without evicting accepted work', () => {
  const first = ids(1, 'owner-a');
  const full = reserveAiQueueCapacityState(null, {
    ...first,
    globalLimit: 1,
    perOwnerLimit: 1,
  }).state;
  const recovered = reserveAiQueueCapacityState(full, {
    ...ids(2, 'owner-a'),
    globalLimit: 1,
    perOwnerLimit: 1,
    allowOverLimit: true,
  });
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.state.activeCount, 2);
  assert.equal(recovered.state.ownerCounts['owner-a'], 2);
});
