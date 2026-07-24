import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUICK_REPLY_MESSAGE_LIMIT,
  QUICK_REPLY_PAGE_SIZE,
  buildQuickReplyModel,
} from '../src/features/chat-core/quickReplyModel.js';

const viewer = {
  viewerId: 'viewer-1',
  viewerName: 'Hao',
  viewerShortId: 'HAO7',
};

test('latest inbound question produces bounded contextual reply ideas', () => {
  const model = buildQuickReplyModel([
    { id: 'm1', uid: 'other-1', name: 'Maya', text: 'Can you review the launch copy?' },
  ], viewer);

  assert.equal(model.source.id, 'm1');
  assert.equal(model.source.name, 'Maya');
  assert.equal(model.source.kind, 'question');
  assert.equal(model.sets[0].length, QUICK_REPLY_PAGE_SIZE);
  assert.deepEqual(model.sets[0].map((item) => item.text), [
    'Yes, that works for me.',
    'I’ll check and get back to you.',
    'Can you clarify one detail?',
  ]);
});

test('a latest viewer message suppresses stale replies to older messages', () => {
  const model = buildQuickReplyModel([
    { id: 'm1', uid: 'other-1', name: 'Maya', text: 'Can you review this?' },
    { id: 'm2', uid: viewer.viewerId, name: viewer.viewerName, text: 'Yes, I’ll review it.' },
  ], viewer);

  assert.equal(model, null);
});

test('mentions require a real @handle boundary', () => {
  const substring = buildQuickReplyModel([
    { id: 'm1', uid: 'other-1', name: 'Maya', text: 'The chao7s test is ready.' },
  ], viewer);
  const mention = buildQuickReplyModel([
    { id: 'm2', uid: 'other-1', name: 'Maya', text: 'Could @HAO7 check the build?' },
  ], viewer);

  assert.equal(substring.source.kind, 'message');
  assert.equal(mention.source.kind, 'mention');
  assert.equal(mention.sets[0][0].text, 'I’m on it.');
});

test('automation errors beat generic bot language even when requested by the viewer', () => {
  const model = buildQuickReplyModel([
    {
      id: 'bot-1',
      uid: viewer.viewerId,
      name: 'Stock Price Bot',
      bot: true,
      automation: true,
      requestedBy: viewer.viewerId,
      text: "I couldn't fetch APPL: Stooq quote failed (404)",
    },
  ], viewer);

  assert.equal(model.source.kind, 'automation-error');
  assert.deepEqual(model.sets[0].map((item) => item.text), [
    'I’ll try another source.',
    'Can someone verify this?',
    'What failed?',
  ]);
  assert.equal(model.sets.length, 2);
});

test('an explicit reply target overrides the latest unrelated room message', () => {
  const model = buildQuickReplyModel([
    { id: 'm1', uid: 'other-1', name: 'Maya', text: 'What time should we meet?' },
    { id: 'm2', uid: 'other-2', name: 'Noah', text: 'The file is uploaded.' },
  ], {
    ...viewer,
    replyTarget: { id: 'm1', name: 'Maya', text: 'What time should we meet?' },
  });

  assert.equal(model.source.id, 'm1');
  assert.equal(model.source.mode, 'reply');
  assert.equal(model.source.name, 'Maya');
  assert.deepEqual(model.sets[0].map((item) => item.text), [
    'That time works for me.',
    'Can we confirm the time?',
    'I’ll plan for it.',
  ]);
});

test('attachments, polls, and reminders avoid claiming an action already happened', () => {
  const attachment = buildQuickReplyModel([
    { id: 'file-1', uid: 'other-1', name: 'Maya', attachedFile: { name: 'brief.pdf' } },
  ], viewer);
  const poll = buildQuickReplyModel([
    { id: 'poll-1', uid: 'other-1', name: 'Maya', poll: { question: 'Which option?' } },
  ], viewer);
  const reminder = buildQuickReplyModel([
    { id: 'reminder-1', uid: 'other-1', name: 'Maya', reminder: { text: 'Join the call' } },
  ], viewer);

  assert.equal(attachment.source.kind, 'attachment');
  assert.equal(poll.source.kind, 'poll');
  assert.equal(reminder.source.kind, 'reminder');
  assert.ok(!poll.sets.flat().some((item) => /I voted/i.test(item.text)));
  assert.ok(!reminder.sets.flat().some((item) => /I added/i.test(item.text)));
});

test('the model is bounded, non-mutating, and each visible set is unique', () => {
  const messages = Array.from({ length: QUICK_REPLY_MESSAGE_LIMIT + 8 }, (_, index) => ({
    id: `m${index}`,
    uid: index === QUICK_REPLY_MESSAGE_LIMIT + 7 ? 'other-1' : 'other-2',
    name: 'Maya',
    text: index === QUICK_REPLY_MESSAGE_LIMIT + 7 ? 'The fix looks good. What should we do next?' : `Old message ${index}`,
  }));
  const before = structuredClone(messages);
  const model = buildQuickReplyModel(messages, viewer);

  assert.deepEqual(messages, before);
  assert.ok(model.sets.length <= 2);
  model.sets.forEach((set) => {
    assert.ok(set.length <= QUICK_REPLY_PAGE_SIZE);
    assert.equal(new Set(set.map((item) => item.text.toLowerCase())).size, set.length);
  });
});
