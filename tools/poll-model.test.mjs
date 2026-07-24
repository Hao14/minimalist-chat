import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePollResults,
  createPollPayload,
  decodePollVote,
  encodePollVote,
  isPollClosed,
  nextPollVoteValue,
  validatePollDraft,
} from '../src/features/chat-core/pollModel.js';

const NOW = Date.parse('2026-07-22T12:00:00.000Z');

test('poll payload supports multiple choice, anonymous display, and scheduled close', () => {
  const poll = createPollPayload({
    anonymous: true,
    closesAt: NOW + 60_000,
    multipleChoice: true,
    optionsText: 'Red\nBlue\nred\nGreen',
    question: 'Which colors?',
  }, { now: NOW });
  assert.equal(poll.anonymous, true);
  assert.equal(poll.multipleChoice, true);
  assert.equal(poll.closesAt, NOW + 60_000);
  assert.deepEqual(poll.options.map((option) => option.text), ['Red', 'Blue', 'Green']);
});

test('poll validation rejects duplicate-only choices and past closing times', () => {
  const validation = validatePollDraft({
    closesAt: NOW - 1,
    options: ['Same', 'same'],
    question: 'Question',
  }, { now: NOW });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.options, /at least 2/i);
  assert.match(validation.errors.closesAt, /future/i);
});

test('multiple-choice vote values remain RTDB-compatible strings', () => {
  const poll = {
    multipleChoice: true,
    options: [{ id: 'o0' }, { id: 'o1' }, { id: 'o2' }],
  };
  const first = nextPollVoteValue(poll, null, 'o2', { now: NOW });
  const second = nextPollVoteValue(poll, first, 'o0', { now: NOW });
  const toggled = nextPollVoteValue(poll, second, 'o2', { now: NOW });
  assert.equal(first, 'o2');
  assert.equal(second, 'o0|o2');
  assert.equal(toggled, 'o0');
  assert.deepEqual(decodePollVote(second), ['o0', 'o2']);
  assert.equal(encodePollVote([]), null);
});

test('anonymous aggregation exposes counts but not voter identities', () => {
  const results = aggregatePollResults({
    anonymous: true,
    multipleChoice: true,
    options: [
      { id: 'o0', text: 'Red' },
      { id: 'o1', text: 'Blue' },
    ],
    votes: {
      alice: 'o0|o1',
      bob: 'o1',
    },
  }, { now: NOW, viewerUid: 'alice' });
  assert.equal(results.participantCount, 2);
  assert.equal(results.selectionCount, 3);
  assert.deepEqual(results.viewerOptionIds, ['o0', 'o1']);
  assert.equal(results.options[0].count, 1);
  assert.equal(results.options[1].count, 2);
  assert.equal('voterIds' in results.options[0], false);
});

test('non-anonymous aggregation may expose voter ids to the renderer', () => {
  const results = aggregatePollResults({
    options: [{ id: 'o0', text: 'Yes' }, { id: 'o1', text: 'No' }],
    votes: { alice: 'o0', bob: 'o1' },
  }, { now: NOW });
  assert.deepEqual(results.options[0].voterIds, ['alice']);
  assert.deepEqual(results.options[1].voterIds, ['bob']);
});

test('scheduled closure blocks further votes', () => {
  const poll = {
    closesAt: NOW,
    options: [{ id: 'o0' }, { id: 'o1' }],
  };
  assert.equal(isPollClosed(poll, NOW), true);
  assert.throws(() => nextPollVoteValue(poll, null, 'o0', { now: NOW }), /closed/i);
});
