import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOM_CATCHUP_MODEL_LIMIT,
  buildRoomCatchUp,
} from '../src/features/chat-core/roomCatchUpModel.js';

function message(id, text, overrides = {}) {
  return {
    id,
    name: `Person ${id}`,
    text,
    uid: `user-${id}`,
    ...overrides,
  };
}

test('first use stays truthful and waits for a useful batch', () => {
  assert.equal(buildRoomCatchUp([message('1', 'Hello'), message('2', 'Hi')]), null);

  const insight = buildRoomCatchUp([
    message('1', 'Hello'),
    message('2', 'What changed?'),
    message('3', 'I shared the notes.'),
  ]);

  assert.equal(insight.title, 'Recent activity');
  assert.equal(insight.updateCount, 3);
  assert.deepEqual(insight.reviewMessageIds, ['1', '2', '3']);
});

test('a saved boundary produces a new-activity batch and excludes own messages', () => {
  const insight = buildRoomCatchUp([
    message('1', 'Reviewed already'),
    message('2', 'My own reply', { uid: 'viewer' }),
    message('3', 'Can you review this?'),
    message('4', 'Here is the file', { attachedFile: { name: 'brief.pdf' } }),
  ], { reviewedMessageId: '1', viewerUid: 'viewer' });

  assert.equal(insight.title, '2 new updates');
  assert.deepEqual(insight.reviewMessageIds, ['3', '4']);
  assert.equal(insight.latestId, '4');
  assert.equal(insight.counts.files, 1);
});

test('strict mention matching rejects substrings and prioritizes a real mention', () => {
  const insight = buildRoomCatchUp([
    message('1', 'Planning is nearly done.'),
    message('2', 'Can someone look?'),
    message('3', '@ann can you confirm the copy?', { name: 'Hao' }),
  ], { viewerShortId: 'ann' });

  assert.equal(insight.counts.mentions, 1);
  assert.equal(insight.highlight.id, '3');
  assert.equal(insight.highlight.label, 'Mentioned you');
});

test('human conversation outranks a later automation failure', () => {
  const insight = buildRoomCatchUp([
    message('1', 'Can you confirm the onboarding copy?', { name: 'Hao' }),
    message('2', 'AAPL is up', { automation: true, bot: true, name: 'Stock Price Bot' }),
    message('3', "I couldn't fetch APPL: quote failed (404)", { automation: true, bot: true, name: 'Stock Price Bot' }),
  ]);

  assert.equal(insight.highlight.id, '1');
  assert.equal(insight.highlight.name, 'Hao');
  assert.equal(insight.highlight.label, 'Needs attention');
});

test('contributors use stable IDs and file-only messages get readable previews', () => {
  const insight = buildRoomCatchUp([
    message('1', 'First', { uid: 'same-user', name: 'Old name' }),
    message('2', 'Second', { uid: 'same-user', name: 'New name' }),
    message('3', '', { attachedFile: { name: 'roadmap.pdf' }, uid: 'another-user' }),
  ]);

  assert.equal(insight.signals[0], '2 contributors');
  assert.equal(insight.counts.files, 1);
  assert.ok(insight.reviewMessageIds.includes('3'));
});

test('the model is bounded, non-mutating, and reports a missing old boundary', () => {
  const messages = Array.from({ length: ROOM_CATCHUP_MODEL_LIMIT + 6 }, (_, index) => (
    message(String(index + 1), `Update ${index + 1}`)
  ));
  const snapshot = structuredClone(messages);

  const insight = buildRoomCatchUp(messages, { reviewedMessageId: 'missing-old-message' });

  assert.equal(insight.updateCount, ROOM_CATCHUP_MODEL_LIMIT);
  assert.equal(insight.boundaryMissing, true);
  assert.match(insight.title, /\+ recent updates$/);
  assert.deepEqual(messages, snapshot);
});
