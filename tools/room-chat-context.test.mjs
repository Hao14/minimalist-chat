import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRoomHeaderDetails,
  countOnlineRoomMembers,
  notificationModeLabel,
  roomPrivacyLabel,
  roomPurpose,
} from '../src/features/chat-core/roomHeaderModel.js';
import {
  activityEventPresentation,
  buildMessageTimeline,
  buildVirtualTimelineLayout,
  buildVirtualTimelineWindow,
  mergeVirtualTimelineRanges,
  messageDateLabel,
} from '../src/features/chat-core/messageTimeline.js';
import {
  MESSAGE_DELIVERY_STATE,
  mergeMessageDeliveries,
} from '../src/features/chat-core/messageDeliveryState.js';

const roomHeaderSource = fs.readFileSync(
  new URL('../src/features/chat-core/RoomHeaderContext.jsx', import.meta.url),
  'utf8',
);
const roomHeaderCss = fs.readFileSync(
  new URL('../src/features/chat-core/RoomHeaderContext.css', import.meta.url),
  'utf8',
);
const messageTimelineSource = fs.readFileSync(
  new URL('../src/features/chat-core/MessageTimeline.jsx', import.meta.url),
  'utf8',
);
const messageTimelineCss = fs.readFileSync(
  new URL('../src/features/chat-core/MessageTimeline.css', import.meta.url),
  'utf8',
);
const chatCoreSource = fs.readFileSync(
  new URL('../src/features/chat-core/ChatCore.jsx', import.meta.url),
  'utf8',
);

test('room header details expose purpose, privacy, online members, and notification mode', () => {
  const room = {
    topic: '  Ship the launch together  ',
    discovery: { enabled: true },
    members: { one: true, two: true },
  };
  const presence = { one: { state: 'online' }, two: { state: 'offline' }, outsider: { state: 'online' } };
  assert.equal(roomPurpose('launch', room), 'Ship the launch together');
  assert.equal(roomPrivacyLabel('launch', room), 'Discoverable');
  assert.equal(countOnlineRoomMembers('launch', room.members, presence), 1);
  assert.equal(notificationModeLabel('mentions'), 'Mentions');
  assert.deepEqual(buildRoomHeaderDetails('launch', room, presence, 'digest'), {
    purpose: 'Ship the launch together',
    privacy: 'Discoverable',
    onlineCount: 1,
    notification: 'Digest',
  });
});

test('room header status stays segmented and ships its foundational layout with the component', () => {
  assert.match(roomHeaderSource, /import '\.\/RoomHeaderContext\.css'/);
  assert.match(roomHeaderSource, /className="room-header-context" role="list" aria-label="Room status"/);
  assert.deepEqual(
    [...roomHeaderSource.matchAll(/data-room-header-status="([^"]+)"/g)].map((match) => match[1]),
    ['privacy', 'presence', 'notifications'],
  );
  assert.equal((roomHeaderSource.match(/role="listitem"/g) || []).length, 3);
  assert.match(roomHeaderCss, /#room-header-meta\.room-header-meta\s*\{[^}]*display:\s*flex/s);
  assert.match(roomHeaderCss, /@container room-shell \(max-width:\s*840px\)/);
});

test('timeline inserts human date labels and renders major activity as separators', () => {
  const now = new Date(2026, 6, 22, 12).getTime();
  const yesterday = new Date(2026, 6, 21, 9).getTime();
  assert.equal(messageDateLabel(now, now), 'Today');
  assert.equal(messageDateLabel(yesterday, now), 'Yesterday');

  const timeline = buildMessageTimeline([
    { id: 'one', timestamp: yesterday, text: 'Earlier' },
    { id: 'two', timestamp: now, activityEvent: { type: 'task_created', detail: 'Write launch notes' } },
  ], now);
  assert.deepEqual(timeline.map((item) => item.type), ['date', 'message', 'date', 'activity']);
  assert.deepEqual(activityEventPresentation({ type: 'poll_closed' }), {
    type: 'poll_closed', icon: 'ph-chart-bar', label: 'Poll closed', detail: '',
  });
});

test('message dates render as compact timeline rules instead of bordered pills', () => {
  assert.match(messageTimelineSource, /import '\.\/MessageTimeline\.css'/);
  assert.match(
    messageTimelineSource,
    /<li className="message-date-separator" data-timeline-key=\{virtualKey\}>[\s\S]*?<span aria-label=\{item\.label\} role="separator">/,
  );
  assert.doesNotMatch(messageTimelineSource, /<li[^>]+role="separator"/);
  assert.match(
    messageTimelineCss,
    /#messages > li\.message-date-separator\s*\{[^}]*grid-template-columns:\s*minmax\(1\.5rem,\s*4rem\)\s+auto\s+minmax\(1\.5rem,\s*4rem\)/s,
  );
  assert.match(
    messageTimelineCss,
    /#messages > li\.message-date-separator::before,[\s\S]*?#messages > li\.message-date-separator::after\s*\{[^}]*height:\s*1px/s,
  );
  const labelRule = messageTimelineCss.match(/#messages > li\.message-date-separator > span\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(labelRule, /border:\s*0\s*!important/);
  assert.match(labelRule, /background:\s*transparent\s*!important/);
  assert.match(labelRule, /box-shadow:\s*none\s*!important/);
  assert.match(labelRule, /font-size:\s*0\.6875rem/);
  assert.doesNotMatch(labelRule, /border-radius:\s*999px/);
});

test('long timelines mount a bounded overscanned window with variable row heights', () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({
    key: `message-${index}`,
    measurementKey: `room:message-${index}`,
    message: { id: `message-${index}`, text: `Message ${index}` },
    type: 'message',
  }));
  const measurements = new Map([
    ['room:message-250', 240],
    ['room:message-251', 48],
  ]);
  const layout = buildVirtualTimelineLayout(rows, measurements, 12);
  const viewport = buildVirtualTimelineWindow(layout, {
    maxRows: 68,
    minRows: 40,
    overscan: 1200,
    scrollTop: layout.offsets[250],
    viewportHeight: 720,
  });

  assert.equal(layout.heights[250], 240);
  assert.equal(layout.heights[251], 48);
  assert.ok(viewport.start < 250);
  assert.ok(viewport.end > 251);
  assert.ok(viewport.end - viewport.start >= 40);
  assert.ok(viewport.end - viewport.start <= 68);
});

test('virtual timeline ranges keep distant anchors mounted without filling the gap', () => {
  assert.deepEqual(
    mergeVirtualTimelineRanges({ start: 280, end: 340 }, [12, 13, 315, 590], 600),
    [
      { start: 12, end: 14 },
      { start: 280, end: 340 },
      { start: 590, end: 591 },
    ],
  );
  assert.match(messageTimelineSource, /const VIRTUALIZE_AFTER_ROWS = 120/);
  assert.match(messageTimelineSource, /const VIRTUAL_MIN_ROWS = 40/);
  assert.match(messageTimelineSource, /const VIRTUAL_MAX_ROWS = 68/);
  assert.match(messageTimelineSource, /aria-posinset/);
  assert.match(messageTimelineSource, /aria-setsize/);
  assert.match(messageTimelineCss, /#messages > li\.message-timeline-spacer\s*\{/);
  assert.match(messageTimelineCss, /overflow-anchor:\s*none/);
});

test('a 601-message hard trim keeps a retained mid-scroll anchor mounted', () => {
  const trimmedRows = Array.from({ length: 480 }, (_, index) => ({
    key: `message-${index + 121}`,
    measurementKey: `room:message-${index + 121}`,
    message: { id: `message-${index + 121}`, text: `Message ${index + 121}` },
    type: 'message',
  }));
  const layout = buildVirtualTimelineLayout(trimmedRows, new Map(), 12);
  const primary = buildVirtualTimelineWindow(layout, {
    maxRows: 68,
    minRows: 40,
    overscan: 1200,
    scrollTop: layout.offsets[200],
    viewportHeight: 720,
  });
  const retainedAnchorIndex = 79;
  const ranges = mergeVirtualTimelineRanges(primary, [retainedAnchorIndex], trimmedRows.length);

  assert.ok(ranges.some(({ start, end }) => (
    start <= retainedAnchorIndex && retainedAnchorIndex < end
  )));
  assert.match(chatCoreSource, /pinnedMessageId=\{/);
  assert.match(messageTimelineSource, /pinnedMessageId/);
});

test('timeline height estimates include the rendered attachment schema', () => {
  const [plain, image, file] = [
    { key: 'plain', type: 'message', message: { id: 'plain', text: 'Hello' } },
    { key: 'image', type: 'message', message: { id: 'image', text: 'Hello', attachedImage: 'blob:image' } },
    { key: 'file', type: 'message', message: { id: 'file', text: 'Hello', attachedFile: { name: 'notes.txt' } } },
  ];
  const layout = buildVirtualTimelineLayout([plain, image, file], new Map(), 0);

  assert.ok(layout.heights[1] > layout.heights[0]);
  assert.ok(layout.heights[2] > layout.heights[0]);
});

test('optimistic deliveries reconcile to authoritative sent messages without duplicates', () => {
  const pending = {
    id: 'message-1',
    scopeKey: 'room::general',
    state: MESSAGE_DELIVERY_STATE.FAILED,
    error: 'Offline',
    message: { id: 'message-1', timestamp: 10, text: 'Hello' },
  };
  assert.deepEqual(mergeMessageDeliveries([], [pending], 'room::general'), [{
    id: 'message-1', timestamp: 10, text: 'Hello', deliveryState: 'failed', deliveryError: 'Offline',
  }]);
  assert.deepEqual(mergeMessageDeliveries([{ id: 'message-1', timestamp: 11, text: 'Hello' }], [pending], 'room::general'), [{
    id: 'message-1', timestamp: 11, text: 'Hello', deliveryState: 'sent', deliveryError: '',
  }]);
});
