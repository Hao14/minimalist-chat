import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createScheduledMessage,
  scheduledMessageId,
  scheduledMessagePath,
  scheduledProjectionPath,
  scheduledQueuePath,
} = require('../functions/room-scheduling.js');

class FakeSnapshot {
  constructor(value) {
    this.value = value;
  }

  exists() {
    return this.value !== undefined && this.value !== null;
  }

  val() {
    return this.value;
  }
}

class FakeDatabase {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
    this.updates = [];
  }

  ref(path = '') {
    return {
      once: async () => new FakeSnapshot(this.values.get(path)),
      update: async (value) => {
        this.updates.push(value);
      },
    };
  }
}

test('scheduled message IDs are deterministic without exposing idempotency keys', () => {
  const first = scheduledMessageId('user', 'request_key_123');
  const second = scheduledMessageId('user', 'request_key_123');
  assert.equal(first, second);
  assert.match(first, /^schedule_[a-f0-9]{40}$/);
  assert.equal(first.includes('request'), false);
});

test('scheduled storage separates server records, user projections, and due queues', () => {
  const id = scheduledMessageId('user', 'request_key_123');
  const message = {
    uid: 'user',
    roomId: 'room',
    channelId: 'general',
    deliverAt: Date.parse('2026-07-22T12:34:00Z'),
  };
  assert.equal(scheduledMessagePath('user', id), `scheduled_room_messages/user/${id}`);
  assert.equal(scheduledProjectionPath('user', id), `user_scheduled_messages/user/${id}`);
  assert.match(scheduledQueuePath(message, id), /^scheduled_message_queue\/202607221234\/user_schedule_/);
});

test('global scheduling rejects banned accounts before creating private queue records', async () => {
  const database = new FakeDatabase({
    'users/banned-user': { isBanned: true, isMuted: false },
  });
  await assert.rejects(
    createScheduledMessage(database, { uid: 'banned-user', name: 'Banned' }, {
      idempotencyKey: 'schedule_request_001',
      message: {
        roomId: 'global',
        channelId: 'general',
        text: 'This must not reach the queue.',
        deliverAt: Date.now() + 60_000,
      },
    }),
    (error) => error?.code === 'MODERATION_ACCOUNT_BANNED',
  );
  assert.equal(database.updates.length, 0);
});
