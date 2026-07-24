import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  claimScheduledMessage,
  messagePath,
  releaseExpiredScheduleClaim,
  sanitizeScheduledMessage,
  scheduleBucket,
  scheduleQueueKey,
} = require('../functions/scheduled-message-contracts.js');

test('scheduled messages are bounded and normalized', () => {
  const value = sanitizeScheduledMessage({
    text: ' Later ',
    roomId: 'room',
    channelId: '',
    deliverAt: 70_000,
  }, { now: 0, uid: 'user' });
  assert.equal(value.text, 'Later');
  assert.equal(value.channelId, 'general');
  assert.throws(
    () => sanitizeScheduledMessage({ text: 'Now', roomId: 'room', deliverAt: 1 }, { now: 0, uid: 'user' }),
    /one minute/i,
  );
});

test('minute buckets and queue keys are deterministic and RTDB safe', () => {
  assert.equal(scheduleBucket(Date.parse('2026-07-22T12:34:50Z')), '202607221234');
  assert.equal(scheduleQueueKey('user/unsafe', 'id.unsafe'), 'user_unsafe_id_unsafe');
});

test('due messages can be claimed once and stale claims can recover', () => {
  const pending = { status: 'pending', deliverAt: 10, text: 'Hi' };
  const claim = claimScheduledMessage(pending, { claimId: 'worker', now: 20 });
  assert.equal(claim.status, 'sending');
  assert.equal(claimScheduledMessage(claim, { claimId: 'other', now: 21 }), undefined);
  assert.equal(releaseExpiredScheduleClaim(claim, { now: 20 + 5 * 60_000 + 1 }).status, 'pending');
});

test('message paths preserve global, general, and channel layouts', () => {
  assert.equal(messagePath('global', 'general', 'm'), 'messages/m');
  assert.equal(messagePath('r', 'general', 'm'), 'rooms_data/r/messages/m');
  assert.equal(messagePath('r', 'help', 'm'), 'rooms_data/r/channels/help/messages/m');
});
