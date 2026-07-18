import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuickSwitchModel } from '../src/features/chat-core/quickSwitcherModel.js';

const rooms = [
  { id: 'global', name: 'Global Chat', shortId: 'GLOBAL' },
  { id: 'alpha', name: 'Alpha', shortId: 'A1', channels: { design: { name: 'design' } } },
  { id: 'beta', name: 'Beta', shortId: 'B2', channels: { roadmap: { name: 'roadmap' } } },
  { id: 'hidden', name: 'Hidden', shortId: 'H3', channels: { secret: { name: 'secret' } } },
];

test('preserves Global-first and favorite room ordering while excluding hidden rooms', () => {
  const model = buildQuickSwitchModel({
    rooms,
    roomPrefs: {
      beta: { favorite: true, favoriteAt: 10 },
      hidden: { hidden: true },
    },
    activeRoomId: 'alpha',
  });
  assert.deepEqual(
    model.results.filter((result) => result.type === 'room').map((result) => result.roomId),
    ['alpha', 'global', 'beta'],
  );
  assert.equal(model.results.some((result) => result.roomId === 'hidden'), false);
});

test('searches channels across every visible room and keeps the parent room', () => {
  const model = buildQuickSwitchModel({ rooms, query: 'road', activeRoomId: 'alpha' });
  assert.equal(model.results.length, 1);
  assert.equal(model.results[0].type, 'channel');
  assert.equal(model.results[0].roomId, 'beta');
  assert.equal(model.results[0].channelId, 'roadmap');
  assert.equal(model.results[0].roomName, 'Beta');
});

test('leading hash selects channels and ranks exact names first', () => {
  const model = buildQuickSwitchModel({
    rooms,
    activeRoomId: 'alpha',
    activeChannelId: 'design',
    query: '#design',
  });
  assert.equal(model.effectiveFilter, 'channels');
  assert.equal(model.results[0].key, 'channel:alpha:design');
  assert.equal(model.results.every((result) => result.type === 'channel'), true);
});

test('adds implicit general destinations and identifies current and favorite semantics', () => {
  const model = buildQuickSwitchModel({
    rooms,
    roomPrefs: { alpha: { favorite: true } },
    activeRoomId: 'alpha',
    activeChannelId: 'general',
    filter: 'channels',
  });
  const current = model.results.find((result) => result.key === 'channel:alpha:general');
  const globalGeneral = model.results.find((result) => result.key === 'channel:global:general');
  assert.equal(current.current, true);
  assert.equal(current.favorite, true);
  assert.ok(globalGeneral);
});
