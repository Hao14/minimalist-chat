import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMessageJumpContext,
  filterWorkspaceMessages,
  mergeWorkspaceMessagePages,
  parseWorkspaceSearchQuery,
} from './workspaceSearchModel.js';

function message(id, overrides = {}) {
  return {
    id,
    messageId: id,
    text: `Message ${id}`,
    name: 'Alex',
    uid: 'user-alex',
    timestamp: new Date(2026, 6, 15, 12).getTime(),
    room: 'room-product',
    roomName: 'Product Team',
    shortId: 'PRODUCT',
    channelId: 'general',
    channelName: 'general',
    ...overrides,
  };
}

test('query parser separates quoted text and every supported filter', () => {
  const parsed = parseWorkspaceSearchQuery(
    '"launch plan" room:"Product Team" channel:#roadmap from:@alex '
    + 'after:2026-07-01 before:2026-08-01 has:file has:link mentions:me is:thread',
  );

  assert.deepEqual(parsed.textTerms, ['launch plan']);
  assert.deepEqual(parsed.filters.rooms, ['product team']);
  assert.deepEqual(parsed.filters.channels, ['roadmap']);
  assert.deepEqual(parsed.filters.authors, ['alex']);
  assert.deepEqual(parsed.filters.has, ['attachment', 'link', 'thread']);
  assert.deepEqual(parsed.filters.mentions, ['me']);
  assert.equal(parsed.filters.after, '2026-07-01');
  assert.equal(parsed.filters.before, '2026-08-01');
});

test('invalid filter values remain searchable text instead of broadening to every message', () => {
  const parsed = parseWorkspaceSearchQuery('has:banana after:not-a-date');

  assert.deepEqual(parsed.filters.has, []);
  assert.equal(parsed.filters.after, '');
  assert.deepEqual(parsed.textTerms, ['has:banana', 'after:not-a-date']);
  assert.deepEqual(filterWorkspaceMessages([message('one')], parsed), []);
});

test('message filtering combines room, channel, author, date, and content facets', () => {
  const matches = message('match', {
    text: 'Alex, please review https://example.com/launch',
    channelId: 'roadmap',
    channelName: 'Roadmap',
    attachedFile: { name: 'launch.pdf' },
    linkPreview: { domain: 'example.com', title: 'Launch plan' },
    poll: { question: 'Ship Friday?', options: [{ text: 'Yes' }, { text: 'No' }] },
    replyTo: { id: 'root', name: 'Sam', text: 'Launch plan' },
  });
  const missesDate = message('old', {
    timestamp: new Date(2026, 5, 1, 12).getTime(),
    channelId: 'roadmap',
    attachedFile: { name: 'launch.pdf' },
    linkPreview: { domain: 'example.com' },
    poll: { question: 'Ship?' },
    replyTo: { id: 'root' },
  });
  const parsed = parseWorkspaceSearchQuery(
    'launch room:product channel:roadmap from:alex after:2026-07-01 '
    + 'has:attachment has:link has:poll has:thread',
  );

  assert.deepEqual(filterWorkspaceMessages([missesDate, matches], parsed).map((item) => item.id), ['match']);
});

test('mentions:me matches structured or textual mentions without matching unrelated text', () => {
  const parsed = parseWorkspaceSearchQuery('mentions:me');
  const options = { viewer: { uid: 'viewer-1', shortId: 'jay' } };
  const results = filterWorkspaceMessages([
    message('text', { text: 'Hi @jay, take a look' }),
    message('structured', { text: 'Assigned', mentions: { 'viewer-1': true } }),
    message('other', { text: 'Hi @jayson' }),
  ], parsed, options);

  assert.deepEqual(results.map((item) => item.id).sort(), ['structured', 'text']);
});

test('index merge deduplicates by room, channel, and message while preserving cross-channel IDs', () => {
  const current = [
    message('same', { channelId: 'general', text: 'Old edit', timestamp: 20 }),
    message('same', { channelId: 'roadmap', text: 'Roadmap copy', timestamp: 10 }),
  ];
  const incoming = [
    message('same', { channelId: 'general', text: 'Edited', timestamp: 30 }),
    message('older', { channelId: 'general', timestamp: 5 }),
  ];

  const merged = mergeWorkspaceMessagePages(current, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].text, 'Edited');
  assert.ok(merged.some((item) => item.channelId === 'roadmap'));
});

test('message jump context keeps the exact room, channel, message, and timestamp', () => {
  const context = buildMessageJumpContext(message('target', {
    channelId: 'roadmap',
    channelName: 'Roadmap',
    timestamp: 1234,
  }), 'launch');

  assert.deepEqual(context, {
    messageId: 'target',
    roomId: 'room-product',
    roomName: 'Product Team',
    shortId: 'PRODUCT',
    channelId: 'roadmap',
    channelName: 'Roadmap',
    source: 'workspace-search',
    messageText: 'Message target',
    messageTimestamp: 1234,
    searchQuery: 'launch',
  });
});
