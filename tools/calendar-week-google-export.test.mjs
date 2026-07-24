import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addRoomWeekToGoogleCalendar,
  buildGoogleCalendarApiEvent,
  calendarEventTimeZone,
  formatCalendarEventTime,
  googleCalendarWeekEventProperty,
  googleCalendarWeekResultMessage,
  googleCalendarWeekRoomProperty,
  roomEventsForCalendarWeek,
} from '../src/features/calendar/googleCalendarWeek.js';

test('roomEventsForCalendarWeek keeps the visible Sunday through Saturday in stable order', () => {
  const events = [
    { id: 'next-sunday', date: '2027-01-03', title: 'Next week' },
    { id: 'fri-late', date: '2027-01-01', time: '17:00', title: 'Late' },
    { id: 'sun', date: '2026-12-27', time: '09:00', title: 'Sunday' },
    { id: 'fri-early', date: '2027-01-01', time: '08:00', title: 'Early' },
    { id: 'prior-saturday', date: '2026-12-26', title: 'Prior week' },
    { id: 'google-copy', date: '2026-12-30', title: 'Imported', _google: true },
    { id: 'invalid', date: '2026-02-31', title: 'Invalid' },
    { id: 'sun', date: '2026-12-28', title: 'Duplicate id' },
  ];

  assert.deepEqual(
    roomEventsForCalendarWeek(events, new Date(2026, 11, 27)).map((event) => event.id),
    ['sun', 'fri-early', 'fri-late'],
  );
});

test('buildGoogleCalendarApiEvent creates timed and all-day Google resources with private source markers', () => {
  const timed = buildGoogleCalendarApiEvent({
    id: 'event-1',
    date: '2026-07-18',
    time: '23:30',
    duration: 90,
    title: 'Night shift',
    description: 'Bring notes',
    location: 'Studio',
  }, { roomId: 'room-1', timeZone: 'America/Los_Angeles' });

  assert.equal(timed.summary, 'Night shift');
  assert.equal(timed.location, 'Studio');
  assert.match(timed.description, /Bring notes/);
  assert.equal(timed.start.timeZone, 'America/Los_Angeles');
  assert.equal(new Date(timed.end.dateTime) - new Date(timed.start.dateTime), 90 * 60_000);
  assert.deepEqual(timed.extendedProperties.private, {
    [googleCalendarWeekRoomProperty]: 'room-1',
    [googleCalendarWeekEventProperty]: 'event-1',
  });

  const allDay = buildGoogleCalendarApiEvent({ id: 'event-2', date: '2026-12-31', title: '' }, { roomId: 'room-1' });
  assert.equal(allDay.summary, 'Minimalist Chat event');
  assert.deepEqual(allDay.start, { date: '2026-12-31' });
  assert.deepEqual(allDay.end, { date: '2027-01-01' });
});

test('room event exports honor each declared IANA zone instead of the browser fallback', () => {
  const event = {
    id: 'event-zoned',
    date: '2026-07-18',
    time: '23:30',
    timeZone: 'America/New_York',
    duration: 90,
    title: 'Night shift',
  };
  const resource = buildGoogleCalendarApiEvent(event, {
    roomId: 'room-1',
    timeZone: 'America/Los_Angeles',
  });

  assert.equal(calendarEventTimeZone(event, 'America/Los_Angeles'), 'America/New_York');
  assert.deepEqual(resource.start, {
    dateTime: '2026-07-19T03:30:00.000Z',
    timeZone: 'America/New_York',
  });
  assert.deepEqual(resource.end, {
    dateTime: '2026-07-19T05:00:00.000Z',
    timeZone: 'America/New_York',
  });
  assert.match(formatCalendarEventTime(event, 'en-US'), /^11:30 PM EDT – 1:00 AM EDT$/);
});

test('room event formatting follows daylight-saving changes in the declared zone', () => {
  const event = {
    date: '2026-11-01',
    time: '00:30',
    timeZone: 'America/New_York',
    duration: 120,
  };

  assert.equal(formatCalendarEventTime(event, 'en-US'), '12:30 AM EDT – 1:30 AM EST');
});

test('imported Google event formatting preserves its exact instant through an ambiguous local hour', () => {
  const event = {
    _google: true,
    _startAt: Date.parse('2026-11-01T06:30:00.000Z'),
    date: '2026-11-01',
    time: '01:30',
    timeZone: 'America/New_York',
    duration: 30,
  };

  assert.equal(formatCalendarEventTime(event, 'en-US'), '1:30 AM EST – 2:00 AM EST');
});

test('addRoomWeekToGoogleCalendar skips marked copies and reports partial API failures accurately', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ options, url: String(url) });
    if (!options.method) {
      return {
        ok: true,
        json: async () => ({
          items: [{
            extendedProperties: { private: { [googleCalendarWeekEventProperty]: 'event-2' } },
          }],
        }),
        status: 200,
      };
    }
    const body = JSON.parse(options.body);
    const ok = body.extendedProperties.private[googleCalendarWeekEventProperty] === 'event-1';
    return { ok, status: ok ? 200 : 500 };
  };
  const events = [
    { id: 'event-1', date: '2026-07-18', title: 'Add me' },
    { id: 'event-2', date: '2026-07-19', title: 'Already there' },
    { id: 'event-3', date: '2026-07-20', title: 'Fails' },
  ];

  const result = await addRoomWeekToGoogleCalendar({ accessToken: 'token', events, fetchImpl, roomId: 'room-1' });
  assert.deepEqual(result, { added: 1, already: 1, failed: 1, total: 3 });
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /privateExtendedProperty=minimalistChatRoom%3Droom-1/);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer token');
  assert.equal(googleCalendarWeekResultMessage(result), 'Added 1 · 1 already there · 1 failed.');
});

test('addRoomWeekToGoogleCalendar recognizes a legacy shared Google id only when it exists for this user', async () => {
  const posted = [];
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = String(url);
    if (!options.method && requestUrl.includes('privateExtendedProperty=')) {
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
    if (!options.method && requestUrl.endsWith('/legacy-present')) return { ok: true, status: 200 };
    if (!options.method && requestUrl.endsWith('/legacy-missing')) return { ok: false, status: 404 };
    posted.push(JSON.parse(options.body));
    return { ok: true, status: 200 };
  };
  const result = await addRoomWeekToGoogleCalendar({
    accessToken: 'token',
    events: [
      { id: 'event-1', gId: 'legacy-present', date: '2026-07-18', title: 'Already synced here' },
      { id: 'event-2', gId: 'legacy-missing', date: '2026-07-19', title: 'Belongs to another user' },
    ],
    fetchImpl,
    roomId: 'room-1',
  });

  assert.deepEqual(result, { added: 1, already: 1, failed: 0, total: 2 });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].extendedProperties.private[googleCalendarWeekEventProperty], 'event-2');
});

test('addRoomWeekToGoogleCalendar preserves an authorization failure for re-consent', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });
  await assert.rejects(
    addRoomWeekToGoogleCalendar({
      accessToken: 'expired',
      events: [{ id: 'event-1', date: '2026-07-18', title: 'Event' }],
      fetchImpl,
      roomId: 'room-1',
    }),
    (error) => error.status === 401,
  );
});
