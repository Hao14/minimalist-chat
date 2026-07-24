import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  friendshipPairId,
  friendshipPairFromProjections,
  transitionFriendshipPair,
} = require('../functions/friendship-contracts.js');

const alice = 'alice-user';
const bob = 'bob-user';

test('friendship pair ids are stable regardless of participant order', () => {
  assert.equal(friendshipPairId(alice, bob), friendshipPairId(bob, alice));
  assert.match(friendshipPairId(alice, bob), /^[a-f0-9]{64}$/);
});

test('send creates the canonical pending pair and caller projections', () => {
  const result = transitionFriendshipPair(null, {
    action: 'send', actorUid: alice, targetUid: bob, now: 100,
  });
  assert.deepEqual(result.record, {
    members: [alice, bob],
    requesterUid: alice,
    addresseeUid: bob,
    status: 'pending',
    createdAt: 100,
    updatedAt: 100,
  });
  assert.equal(result.actorStatus, 'pending_sent');
  assert.equal(result.targetStatus, 'pending_received');

  const retried = transitionFriendshipPair(result.record, {
    action: 'send', actorUid: alice, targetUid: bob, now: 200,
  });
  assert.equal(retried.changed, false);
  assert.deepEqual(retried.record, result.record);
});

test('only the addressee can accept a pending friend request', () => {
  const pending = transitionFriendshipPair(null, {
    action: 'send', actorUid: alice, targetUid: bob, now: 100,
  }).record;
  assert.throws(
    () => transitionFriendshipPair(pending, {
      action: 'accept', actorUid: alice, targetUid: bob, now: 200,
    }),
    (error) => error.code === 'FRIENDSHIP_ACCEPT_FORBIDDEN' && error.status === 403,
  );

  const accepted = transitionFriendshipPair(pending, {
    action: 'accept', actorUid: bob, targetUid: alice, now: 200,
  });
  assert.equal(accepted.record.status, 'accepted');
  assert.equal(accepted.record.acceptedAt, 200);
  assert.equal(accepted.actorStatus, 'accepted');
  assert.equal(accepted.targetStatus, 'accepted');

  const retried = transitionFriendshipPair(accepted.record, {
    action: 'accept', actorUid: bob, targetUid: alice, now: 300,
  });
  assert.equal(retried.changed, false);
});

test('crossed send requests cannot silently accept each other', () => {
  const pending = transitionFriendshipPair(null, {
    action: 'send', actorUid: alice, targetUid: bob, now: 100,
  }).record;
  assert.throws(
    () => transitionFriendshipPair(pending, {
      action: 'send', actorUid: bob, targetUid: alice, now: 200,
    }),
    (error) => error.code === 'FRIENDSHIP_REQUEST_ALREADY_RECEIVED' && error.status === 409,
  );
});

test('remove is idempotent and clears either pending or accepted state', () => {
  const pending = transitionFriendshipPair(null, {
    action: 'send', actorUid: alice, targetUid: bob, now: 100,
  }).record;
  const removed = transitionFriendshipPair(pending, {
    action: 'remove', actorUid: bob, targetUid: alice, now: 200,
  });
  assert.equal(removed.record, null);
  assert.equal(removed.actorStatus, null);
  assert.equal(removed.targetStatus, null);
  assert.equal(removed.changed, true);

  const retried = transitionFriendshipPair(null, {
    action: 'remove', actorUid: bob, targetUid: alice, now: 300,
  });
  assert.equal(retried.changed, false);
});

test('invalid, self, and corrupt pair inputs are rejected', () => {
  assert.throws(
    () => transitionFriendshipPair(null, { action: 'send', actorUid: alice, targetUid: alice }),
    (error) => error.code === 'FRIENDSHIP_SELF_INVALID',
  );
  assert.throws(
    () => transitionFriendshipPair(null, { action: 'approve', actorUid: alice, targetUid: bob }),
    (error) => error.code === 'FRIENDSHIP_ACTION_INVALID',
  );
  assert.throws(
    () => transitionFriendshipPair({
      members: [alice, 'mallory-user'], requesterUid: alice, addresseeUid: 'mallory-user', status: 'accepted',
    }, { action: 'send', actorUid: alice, targetUid: bob }),
    (error) => error.code === 'FRIENDSHIP_STATE_INVALID',
  );
});

test('legacy pending projections load before the addressee accepts', () => {
  const migrated = friendshipPairFromProjections({
    firstUid: bob,
    secondUid: alice,
    firstStatus: 'pending_received',
    secondStatus: 'pending_sent',
    now: 100,
  });
  assert.deepEqual(migrated, {
    members: [alice, bob],
    requesterUid: alice,
    addresseeUid: bob,
    status: 'pending',
    createdAt: 100,
    updatedAt: 100,
    migratedFromProjections: true,
  });

  const accepted = transitionFriendshipPair(migrated, {
    action: 'accept', actorUid: bob, targetUid: alice, now: 200,
  });
  assert.equal(accepted.record.status, 'accepted');
  assert.equal(accepted.record.acceptedAt, 200);
  assert.equal(accepted.actorStatus, 'accepted');
  assert.equal(accepted.targetStatus, 'accepted');
});

test('legacy friendship migration rejects one-sided and inconsistent projections', () => {
  assert.throws(
    () => friendshipPairFromProjections({
      firstUid: alice, secondUid: bob, firstStatus: 'accepted', secondStatus: null,
    }),
    (error) => error.code === 'FRIENDSHIP_STATE_INVALID',
  );
  assert.throws(
    () => friendshipPairFromProjections({
      firstUid: alice, secondUid: bob, firstStatus: 'pending_sent', secondStatus: 'accepted',
    }),
    (error) => error.code === 'FRIENDSHIP_STATE_INVALID',
  );
});
