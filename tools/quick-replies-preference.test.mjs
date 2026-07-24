import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadQuickRepliesCollapsed,
  quickRepliesCollapseStorageKey,
  saveQuickRepliesCollapsed,
} from '../src/features/chat-core/quickRepliesPreference.js';

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

test('Quick Replies defaults expanded and keeps collapse state isolated by account', () => {
  const storage = createStorage();

  assert.equal(loadQuickRepliesCollapsed('user-a', storage), false);
  assert.equal(loadQuickRepliesCollapsed('user-b', storage), false);
  assert.equal(saveQuickRepliesCollapsed('user-a', true, storage), true);
  assert.equal(loadQuickRepliesCollapsed('user-a', storage), true);
  assert.equal(loadQuickRepliesCollapsed('user-b', storage), false);
  assert.notEqual(
    quickRepliesCollapseStorageKey('user-a'),
    quickRepliesCollapseStorageKey('user-b'),
  );
});

test('expanding clears the saved collapse marker', () => {
  const storage = createStorage();

  saveQuickRepliesCollapsed('user-a', true, storage);
  assert.equal(loadQuickRepliesCollapsed('user-a', storage), true);
  assert.equal(saveQuickRepliesCollapsed('user-a', false, storage), false);
  assert.equal(loadQuickRepliesCollapsed('user-a', storage), false);
});

test('blocked storage keeps the live choice and reloads expanded', () => {
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

  assert.equal(saveQuickRepliesCollapsed('user-a', true, blockedStorage), true);
  assert.equal(loadQuickRepliesCollapsed('user-a', blockedStorage), false);
});
