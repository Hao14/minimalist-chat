import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nextMarkedUnreadState,
  nextReadState,
  readStatePath,
  unreadSummary,
} from '../src/features/chat-core/readState.js';
import {
  buildThreadSummaries,
  messagesForThread,
} from '../src/features/chat-core/threadModel.js';
import {
  canPostToChannel,
  normalizeChannelMode,
} from '../src/features/chat-core/channelModel.js';
import {
  sanitizeScheduledMessage,
  scheduledMessageStatusLabel,
} from '../src/features/chat-core/scheduledMessageModel.js';
import { serializableOutboxAttempt } from '../src/features/chat-core/outboxStore.js';

test('read cursors identify incoming unread messages and explicit unread anchors', () => {
  const messages = [
    { id: 'a', uid: 'other', timestamp: 10 },
    { id: 'b', uid: 'me', timestamp: 20 },
    { id: 'c', uid: 'other', timestamp: 30 },
  ];
  const read = nextReadState(messages[0], 10);
  assert.deepEqual(unreadSummary(messages, read, 'me'), {
    count: 1,
    firstMessageId: 'c',
    latestMessageId: 'c',
  });
  const marked = nextMarkedUnreadState(messages[0], read, 40);
  assert.equal(unreadSummary(messages, marked, 'me').count, 2);
  assert.equal(readStatePath('u', 'r', 'support'), 'user_room_state/u/r/channels/support');
});

test('thread summaries include followed roots and per-thread unread counts', () => {
  const messages = [
    { id: 'root', uid: 'me', text: 'Root', timestamp: 10 },
    { id: 'reply-1', uid: 'other', threadRootId: 'root', timestamp: 20 },
    { id: 'reply-2', uid: 'me', threadRootId: 'root', timestamp: 30 },
  ];
  assert.equal(messagesForThread(messages, 'root').length, 3);
  const [summary] = buildThreadSummaries(messages, { root: true }, { root: 15 }, 'me');
  assert.equal(summary.replyCount, 2);
  assert.equal(summary.unreadCount, 1);
  assert.equal(summary.followed, true);
});

test('channel modes enforce announcement posting roles', () => {
  assert.equal(normalizeChannelMode('unknown'), 'chat');
  assert.equal(canPostToChannel({ id: 'news', mode: 'announcements' }, { uid: 'member' }), false);
  assert.equal(canPostToChannel({ id: 'news', mode: 'announcements' }, { uid: 'owner', creatorId: 'owner' }), true);
  assert.equal(canPostToChannel({ id: 'news', mode: 'announcements' }, { uid: 'mod', role: 'moderator' }), true);
});

test('scheduled messages require a future time and expose useful status labels', () => {
  assert.throws(() => sanitizeScheduledMessage({ text: 'Soon', roomId: 'r', deliverAt: 10 }, 0));
  const scheduled = sanitizeScheduledMessage({ text: ' Later ', roomId: 'r', deliverAt: 61_000 }, 0);
  assert.equal(scheduled.text, 'Later');
  assert.equal(scheduledMessageStatusLabel(scheduled, 100), 'Scheduled');
  assert.equal(scheduledMessageStatusLabel(scheduled, 70_000), 'Sending soon');
});

test('outbox serialization retains retry-safe data including File-compatible values', () => {
  const fileLike = { name: 'notes.txt', size: 4 };
  const record = serializableOutboxAttempt({
    id: 'm1',
    requesterUid: 'u1',
    roomId: 'global',
    file: fileLike,
    readTextPreview() {},
  });
  assert.equal(record.id, 'm1');
  assert.equal(record.file, fileLike);
  assert.equal('readTextPreview' in record, false);
});
