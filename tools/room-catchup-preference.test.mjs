import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOM_CATCHUP_PREFERENCE_EVENT,
  ROOM_CATCHUP_REVIEW_EVENT,
  loadRoomCatchUpEnabled,
  loadRoomCatchUpReviewedId,
  roomCatchUpReviewedStorageKey,
  roomCatchUpStorageKey,
  saveRoomCatchUpEnabled,
  saveRoomCatchUpReviewedId,
} from '../src/features/chat-core/catchUpPreference.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createEventTarget() {
  const events = [];
  class PreferenceEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  return {
    CustomEvent: PreferenceEvent,
    dispatchEvent(event) {
      events.push(event);
    },
    events,
  };
}

test('Room catch-up defaults on and remains isolated by account', () => {
  const storage = createStorage();
  assert.equal(loadRoomCatchUpEnabled('user-a', storage), true);
  assert.equal(loadRoomCatchUpEnabled('user-b', storage), true);

  saveRoomCatchUpEnabled('user-a', false, storage, createEventTarget());

  assert.equal(loadRoomCatchUpEnabled('user-a', storage), false);
  assert.equal(loadRoomCatchUpEnabled('user-b', storage), true);
  assert.notEqual(roomCatchUpStorageKey('user-a'), roomCatchUpStorageKey('user-b'));
});

test('saving dispatches a same-window preference event', () => {
  const storage = createStorage();
  const eventTarget = createEventTarget();

  const enabled = saveRoomCatchUpEnabled('user-a', false, storage, eventTarget);

  assert.equal(enabled, false);
  assert.equal(eventTarget.events.length, 1);
  assert.equal(eventTarget.events[0].type, ROOM_CATCHUP_PREFERENCE_EVENT);
  assert.deepEqual(eventTarget.events[0].detail, {
    uid: 'user-a',
    enabled: false,
    storageKey: roomCatchUpStorageKey('user-a'),
  });
});

test('blocked storage keeps the live choice and reloads the safe default', () => {
  const blockedStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const eventTarget = createEventTarget();

  assert.equal(saveRoomCatchUpEnabled('user-a', false, blockedStorage, eventTarget), false);
  assert.equal(eventTarget.events[0].detail.enabled, false);
  assert.equal(loadRoomCatchUpEnabled('user-a', blockedStorage), true);
});

test('reviewed batches stay isolated by account, room, and channel', () => {
  const storage = createStorage();
  const events = createEventTarget();

  saveRoomCatchUpReviewedId('user-a', 'room-1::general', 'message-9', storage, events);

  assert.equal(loadRoomCatchUpReviewedId('user-a', 'room-1::general', storage), 'message-9');
  assert.equal(loadRoomCatchUpReviewedId('user-a', 'room-1::design', storage), '');
  assert.equal(loadRoomCatchUpReviewedId('user-b', 'room-1::general', storage), '');
  assert.notEqual(
    roomCatchUpReviewedStorageKey('user-a', 'room-1::general'),
    roomCatchUpReviewedStorageKey('user-a', 'room-1::design'),
  );
  assert.equal(events.events[0].type, ROOM_CATCHUP_REVIEW_EVENT);
  assert.equal(events.events[0].detail.reviewedMessageId, 'message-9');
});

test('clearing a reviewed batch supports Undo semantics', () => {
  const storage = createStorage();
  const events = createEventTarget();

  saveRoomCatchUpReviewedId('user-a', 'room-1::general', 'message-9', storage, events);
  const restored = saveRoomCatchUpReviewedId('user-a', 'room-1::general', '', storage, events);

  assert.equal(restored, '');
  assert.equal(loadRoomCatchUpReviewedId('user-a', 'room-1::general', storage), '');
  assert.equal(events.events.at(-1).detail.reviewedMessageId, '');
});

test('blocked review storage still returns the live marker', () => {
  const blockedStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  const events = createEventTarget();

  assert.equal(
    saveRoomCatchUpReviewedId('user-a', 'room-1::general', 'message-9', blockedStorage, events),
    'message-9',
  );
  assert.equal(loadRoomCatchUpReviewedId('user-a', 'room-1::general', blockedStorage), '');
  assert.equal(events.events[0].detail.reviewedMessageId, 'message-9');
});
