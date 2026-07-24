import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyEventDraft,
  eventForGoogleCalendar,
  eventPayloadFromDraft,
  eventReminderDueAt,
  eventRsvpCounts,
  eventRsvpNames,
  eventRsvpStatus,
  eventState,
  eventTimestamp,
  isIanaTimeZone,
  recurrenceLabel,
  validateEventDraft,
  zonedDateTimeTimestamp,
} from '../src/features/events/eventModel.js';

test('zoned event timestamps preserve the event wall clock across zones', () => {
  const summer = zonedDateTimeTimestamp('2026-07-22', '12:00', 'America/Los_Angeles');
  const winter = zonedDateTimeTimestamp('2026-01-22', '12:00', 'America/Los_Angeles');
  assert.equal(new Date(summer).toISOString(), '2026-07-22T19:00:00.000Z');
  assert.equal(new Date(winter).toISOString(), '2026-01-22T20:00:00.000Z');
  assert.equal(zonedDateTimeTimestamp('2026-03-08', '02:30', 'America/Los_Angeles'), 0);
  assert.equal(isIanaTimeZone('Not/A_Zone'), false);
});

test('event payload includes recurrence, timezone, reminder, and room-call metadata', () => {
  const draft = {
    ...createEmptyEventDraft('America/New_York'),
    date: '2026-08-03',
    desc: 'Bring the launch checklist.',
    recurrenceFrequency: 'weekly',
    recurrenceUntil: '2026-09-07',
    reminderMinutes: '30',
    roomCall: true,
    time: '09:30',
    title: 'Launch review',
  };
  const payload = eventPayloadFromDraft(draft);
  assert.deepEqual(payload.recurrence, {
    frequency: 'weekly',
    interval: 1,
    until: '2026-09-07',
  });
  assert.equal(payload.timeZone, 'America/New_York');
  assert.equal(payload.reminderMinutes, 30);
  assert.equal(payload.roomCall, true);
  assert.equal(recurrenceLabel(payload.recurrence), 'Every week until 2026-09-07');
});

test('event validation requires valid schedule metadata', () => {
  const invalid = validateEventDraft({
    ...createEmptyEventDraft(),
    date: '2026-02-30',
    reminderMinutes: '30',
    timeZone: 'Mars/Olympus',
    title: 'Invalid schedule',
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.date, /valid event date/i);
  assert.match(invalid.errors.timeZone, /IANA/i);
  assert.match(invalid.errors.reminderMinutes, /start time/i);
});

test('RSVP aggregation supports canonical and legacy entries', () => {
  const event = {
    rsvps: {
      a: { name: 'Ari', status: 'going', updatedAt: 1 },
      b: { name: 'Bea', status: 'maybe', updatedAt: 2 },
      c: 'going',
      d: { name: 'Dee', status: 'declined', updatedAt: 3 },
      ignored: { status: 'unknown' },
    },
  };
  assert.deepEqual(eventRsvpCounts(event), { going: 2, maybe: 1, declined: 1, total: 4 });
  assert.equal(eventRsvpStatus(event, 'b'), 'maybe');
  assert.deepEqual(eventRsvpNames(event, 'going'), ['Ari']);
});

test('event reminders resolve before the zoned event start', () => {
  const event = {
    date: '2026-07-22',
    duration: 60,
    reminderMinutes: 30,
    time: '12:00',
    timeZone: 'America/Los_Angeles',
  };
  assert.equal(eventReminderDueAt(event), eventTimestamp(event) - 30 * 60_000);
  assert.equal(eventState(event, Date.parse('2026-07-22T19:15:00.000Z')), 'live');
});

test('Google Calendar adapter preserves the event instant in the browser zone', () => {
  const event = {
    date: '2026-07-22',
    desc: 'Agenda',
    duration: 60,
    recurrence: { frequency: 'weekly', interval: 1 },
    roomCall: true,
    time: '12:00',
    timeZone: 'America/Los_Angeles',
    title: 'Review',
  };
  const exported = eventForGoogleCalendar(event);
  assert.equal(eventTimestamp(exported), eventTimestamp(event));
  assert.match(exported.desc, /Scheduled in America\/Los_Angeles/);
  assert.match(exported.desc, /Calls tab/);
});
