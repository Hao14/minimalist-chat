import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergePmMessagePages,
  PM_HISTORY_PAGE_SIZE,
  pmHistoryCursor,
  pmHistoryMayHaveOlder,
  roomIdFor,
} from '../src/features/private-messages/pmHistoryModel.js';

test('private message room ids are deterministic for either participant order', () => {
  assert.equal(roomIdFor('user-b', 'user-a'), 'user-a_user-b');
  assert.equal(roomIdFor('user-a', 'user-b'), 'user-a_user-b');
});

test('older and live private message pages merge chronologically without duplicates', () => {
  const merged = mergePmMessagePages(
    [{ id: '-a', text: 'oldest' }, { id: '-b', text: 'older copy' }],
    [{ id: '-b', text: 'newer copy' }, { id: '-c', text: 'newest' }],
  );

  assert.deepEqual(merged.map(({ id }) => id), ['-a', '-b', '-c']);
  assert.equal(merged[1].text, 'newer copy');
  assert.equal(pmHistoryCursor(merged), '-a');
});

test('history pagination remains bounded and only offers an older page at the page limit', () => {
  assert.equal(PM_HISTORY_PAGE_SIZE, 80);
  assert.equal(pmHistoryMayHaveOlder(79), false);
  assert.equal(pmHistoryMayHaveOlder(80), true);
});
