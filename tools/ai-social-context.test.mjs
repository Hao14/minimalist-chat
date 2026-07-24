import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  WINSTON_EVENT_LOOKUP_MAX_RESULTS,
  selectAuthorizedWinstonEvents,
  winstonEventLookupIntent,
} = require('../functions/ai-social-context.js');

const uid = 'member-user';
const now = Date.parse('2026-07-22T12:00:00Z');

function event(title, date, extra = {}) {
  return {
    title,
    date,
    time: '10:00',
    duration: 30,
    location: 'HQ',
    description: `${title} details`,
    createdAt: 123,
    ...extra,
  };
}

test('event lookup intent is read-only and limited to event-like questions', () => {
  for (const query of ['Upcoming events', 'What is on my calendar?', 'Look up meetings', 'Show my schedule']) {
    assert.equal(winstonEventLookupIntent(query), true, query);
  }
  for (const query of ['Create a room', 'Call Ari', 'Invite Bo', '']) {
    assert.equal(winstonEventLookupIntent(query), false, query);
  }
});

test('Winston event lookup returns only rooms the signed-in user can access', () => {
  const rows = selectAuthorizedWinstonEvents({
    uid,
    now,
    query: 'upcoming events',
    rooms: {
      global: {
        name: 'Global Chat',
        events: { global_event: event('Global town hall', '2026-07-23') },
      },
      created_room: {
        name: 'My room',
        creatorId: uid,
        events: { created_event: event('Creator planning', '2026-07-24') },
      },
      member_room: {
        name: 'Member room',
        creatorId: 'owner-user',
        members: { [uid]: 'Member' },
        events: { member_event: event('Member kickoff', '2026-07-25') },
      },
      outsider_room: {
        name: 'Private outsider room',
        creatorId: 'outsider-user',
        members: { 'outsider-user': 'Outsider' },
        events: { secret_event: event('Secret acquisition', '2026-07-26', { secret: 'must not leak' }) },
      },
    },
  });

  assert.deepEqual(rows.map(({ eventId }) => eventId), [
    'global_event',
    'created_event',
    'member_event',
  ]);
  assert.ok(rows.every((row) => row.roomId !== 'outsider_room'));
  assert.ok(rows.every((row) => !Object.hasOwn(row, 'secret')));
});

test('event lookup filters past versus upcoming, validates dates, sorts, and stays bounded', () => {
  const events = {
    invalid_date: event('Invalid date', 'tomorrow'),
    past_old: event('Older event', '2026-07-10'),
    past_recent: event('Recent event', '2026-07-21'),
    today: event('Today event', '2026-07-22'),
    upcoming: event('Upcoming event', '2026-07-23'),
    ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [
      `future_${String(index).padStart(2, '0')}`,
      event(`Future ${index}`, `2026-08-${String((index % 28) + 1).padStart(2, '0')}`),
    ])),
  };
  const rooms = {
    room_123456: { name: 'Room', members: { [uid]: true }, events },
  };

  const upcoming = selectAuthorizedWinstonEvents({ uid, rooms, now, query: 'upcoming events', maxEvents: 200 });
  assert.ok(upcoming.length <= WINSTON_EVENT_LOOKUP_MAX_RESULTS);
  assert.ok(upcoming.every((row) => row.date >= '2026-07-22'));
  assert.equal(upcoming.some((row) => row.eventId === 'invalid_date'), false);
  assert.deepEqual(upcoming.map((row) => row.date), [...upcoming.map((row) => row.date)].sort());

  const past = selectAuthorizedWinstonEvents({ uid, rooms, now, query: 'past events' });
  assert.deepEqual(past.map(({ eventId }) => eventId), ['past_recent', 'past_old']);

  const all = selectAuthorizedWinstonEvents({ uid, rooms, now, query: 'all events' });
  assert.equal(all.some((row) => row.eventId === 'past_old'), true);
  assert.equal(all.some((row) => row.eventId === 'today'), true);
});
