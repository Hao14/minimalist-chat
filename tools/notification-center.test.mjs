import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyActivity,
  filterActivityNotifications,
  filterRealtimeAlerts,
  groupNotifications,
  isQuietScheduleActive,
  notificationCount,
} from '../src/features/notifications/notificationModel.js';

test('groups repeated messages, keeps the newest destination, and sorts newest first', () => {
  const groups = groupNotifications({
    oldMessage: {
      type: 'message',
      from: 'Mina',
      text: 'First note',
      timestamp: 100,
      roomId: 'room-a',
    },
    latestMessage: {
      type: 'message',
      from: 'Mina',
      text: 'Latest note',
      timestamp: 300,
      roomId: 'room-b',
      count: 2,
    },
    announcement: {
      type: 'announcement',
      text: 'Release ready',
      timestamp: 200,
    },
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].text, 'Latest note');
  assert.equal(groups[0].roomId, 'room-b');
  assert.equal(groups[0].count, 3);
  assert.deepEqual(groups[0].ids, ['oldMessage', 'latestMessage']);
  assert.equal(notificationCount(groups), 4);
});

test('classifies and filters activity without hiding history for delivery preferences', () => {
  const groups = [
    { type: 'mention', ids: ['a'] },
    { type: 'reply', ids: ['b'] },
    { type: 'friend', ids: ['c'] },
    { type: 'badge', ids: ['d'] },
    { type: 'announcement', ids: ['e'] },
  ];

  assert.equal(classifyActivity(groups[3]), 'updates');
  assert.deepEqual(filterActivityNotifications(groups, 'mentions'), [groups[0]]);
  assert.deepEqual(filterActivityNotifications(groups, 'announcements'), [groups[4]]);
  assert.deepEqual(filterActivityNotifications(groups, 'all'), groups);
});

test('quiet hours support overnight schedules and exact full-day schedules', () => {
  const overnight = { enabled: true, start: '22:00', end: '07:00' };
  assert.equal(isQuietScheduleActive(overnight, new Date(2026, 0, 1, 23, 30)), true);
  assert.equal(isQuietScheduleActive(overnight, new Date(2026, 0, 2, 6, 59)), true);
  assert.equal(isQuietScheduleActive(overnight, new Date(2026, 0, 2, 7, 0)), false);
  assert.equal(isQuietScheduleActive({ enabled: true, start: '08:00', end: '08:00' }, new Date()), true);
  assert.equal(isQuietScheduleActive({ enabled: false, start: '00:00', end: '23:59' }, new Date()), false);
});

test('delivery policy suppresses realtime alerts while leaving history filtering independent', () => {
  const groups = [
    { type: 'mention', roomId: 'alpha', ids: ['a'] },
    { type: 'message', roomId: 'beta', ids: ['b'] },
    { type: 'friend', ids: ['c'] },
  ];

  assert.deepEqual(filterRealtimeAlerts(groups, { dnd: true }, 'alpha'), []);
  assert.deepEqual(
    filterRealtimeAlerts(groups, { mode: 'mentions', schedule: { enabled: false } }, 'alpha'),
    [groups[0]],
  );
  assert.deepEqual(
    filterRealtimeAlerts(
      [...groups, { type: 'message', text: 'Ship the banana release', ids: ['d'] }],
      { mode: 'mentions', keywords: ['banana'], schedule: { enabled: false } },
      'alpha',
    ).map((group) => group.ids[0]),
    ['a', 'd'],
  );
  assert.deepEqual(
    filterRealtimeAlerts(groups, { mode: 'muted', schedule: { enabled: false } }, 'alpha'),
    [groups[1], groups[2]],
  );
  assert.deepEqual(filterActivityNotifications(groups, 'all'), groups);
});
