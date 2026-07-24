import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PINNED_ROOM_TOOLS,
  defaultRoomToolPins,
  loadRoomToolPins,
  normalizeRoomToolPins,
  roomToolPinsStorageKey,
  toggleRoomToolPin,
} from '../src/features/room-pages/roomToolPins.js';

const enabled = ['docs', 'whiteboard', 'tasks', 'events', 'calendar', 'ai', 'calls'];

test('room pin preferences are scoped per user and room and capped at three', () => {
  assert.notEqual(roomToolPinsStorageKey('one', 'room'), roomToolPinsStorageKey('two', 'room'));
  assert.notEqual(roomToolPinsStorageKey('one', 'room-a'), roomToolPinsStorageKey('one', 'room-b'));
  assert.deepEqual(normalizeRoomToolPins(['docs', 'docs', 'tasks', 'events', 'ai'], enabled), ['docs', 'tasks', 'events']);
  assert.equal(MAX_PINNED_ROOM_TOOLS, 3);
});

test('defaults favor action-oriented tools and stored unavailable pins are removed', () => {
  assert.deepEqual(defaultRoomToolPins(enabled), ['docs', 'tasks', 'events']);
  const storage = { getItem: () => JSON.stringify(['docs', 'calendar', 'disabled']) };
  assert.deepEqual(loadRoomToolPins(storage, 'user', 'room', ['docs', 'tasks']), ['docs']);
});

test('pin toggles enforce the limit and support unpinning', () => {
  assert.deepEqual(toggleRoomToolPin(['docs'], 'tasks', enabled), { pins: ['docs', 'tasks'], error: '' });
  assert.deepEqual(toggleRoomToolPin(['docs', 'tasks', 'events'], 'ai', enabled), {
    pins: ['docs', 'tasks', 'events'], error: 'limit',
  });
  assert.deepEqual(toggleRoomToolPin(['docs', 'tasks'], 'docs', enabled), { pins: ['tasks'], error: '' });
});
