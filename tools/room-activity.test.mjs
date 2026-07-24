import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRoomActivity,
  formatRoomActivity,
  getRoomActivityIcon,
} from '../src/features/rooms/roomActivity.js';

test('room activity stores a versioned code, safe arguments, and legacy fallback text', () => {
  const activity = createRoomActivity('member_joined', { actor: 'Ari', ignored: 'nope' }, 'Ari joined the room.', 42);
  assert.deepEqual(activity, {
    eventCode: 'member_joined',
    eventVersion: 1,
    eventArgs: { actor: 'Ari' },
    text: 'Ari joined the room.',
    timestamp: 42,
  });
});

test('one activity record renders per viewer locale', () => {
  const activity = createRoomActivity('member_joined', { actor: 'Ari' }, 'Ari joined the room.', 42);
  assert.equal(formatRoomActivity(activity, 'en'), 'Ari joined the room.');
  assert.equal(formatRoomActivity(activity, 'es'), 'Ari se unió a la sala.');
  assert.equal(formatRoomActivity(activity, 'zh-Hans'), 'Ari 加入了房间。');
});

test('event codes determine icons without parsing translated text', () => {
  const activity = createRoomActivity('member_left', { actor: '小林' }, '小林离开了房间。', 42);
  assert.equal(getRoomActivityIcon(activity), 'ph-sign-out');
});

test('legacy records remain readable', () => {
  const legacy = { text: 'Ari joined the room.', timestamp: 42 };
  assert.equal(formatRoomActivity(legacy, 'es'), legacy.text);
  assert.equal(getRoomActivityIcon(legacy), 'ph-sign-in');
});

test('unknown event codes cannot be created accidentally', () => {
  assert.throws(() => createRoomActivity('not_real', { actor: 'Ari' }, 'Nope', 42), /Unknown room activity event/);
});
