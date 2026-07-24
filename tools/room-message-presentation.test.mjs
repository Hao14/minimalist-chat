import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_MESSAGE_KIND,
  isCurrentUserAuthoredMessage,
  roomMessageKind,
} from '../src/features/chat-core/messagePresentation.js';
import {
  extractFirstPreviewUrl,
  messageTextWithoutPreviewUrl,
  normalizeLinkPreview,
} from '../src/features/chat-core/linkPreview.js';

test('automation and AI messages never inherit the current-user bubble', () => {
  assert.equal(roomMessageKind({ uid: 'me', automation: true }), ROOM_MESSAGE_KIND.AUTOMATION);
  assert.equal(roomMessageKind({ uid: 'me', aiAgent: true }), ROOM_MESSAGE_KIND.AI);
  assert.equal(isCurrentUserAuthoredMessage({ uid: 'me', automation: true }, 'me'), false);
  assert.equal(isCurrentUserAuthoredMessage({ uid: 'me', bot: true }, 'me'), false);
  assert.equal(isCurrentUserAuthoredMessage({ uid: 'me' }, 'me'), true);
});

test('link previews replace only the first displayed HTTPS URL', () => {
  const url = extractFirstPreviewUrl('Worth reading: https://example.com/launch?via=chat.');
  assert.equal(url, 'https://example.com/launch?via=chat');
  assert.equal(messageTextWithoutPreviewUrl(`Worth reading: ${url}`, { url }), 'Worth reading:');
  assert.equal(extractFirstPreviewUrl('http://127.0.0.1/private'), '');
});

test('client preview normalization constrains fields and rejects unsafe schemes', () => {
  assert.deepEqual(normalizeLinkPreview({
    url: 'https://www.example.com/story',
    title: ' A useful story ',
    description: ' Clear description ',
  }), {
    url: 'https://www.example.com/story',
    domain: 'example.com',
    title: 'A useful story',
    description: 'Clear description',
  });
  assert.equal(normalizeLinkPreview({ url: 'javascript:alert(1)', title: 'No' }), null);
});
