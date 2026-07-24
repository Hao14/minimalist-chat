import {
  browserTimeZone,
  isIanaTimeZone,
  zonedDateTimeTimestamp,
} from '../events/eventModel.js';

const googleCalendarEventsUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export const googleCalendarWeekRoomProperty = 'minimalistChatRoom';
export const googleCalendarWeekEventProperty = 'minimalistChatEvent';

const pad = (value) => String(value).padStart(2, '0');
const eventTimeFormatterCache = new Map();

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, day, month, year };
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function normalizedWeekStart(weekStart) {
  const date = new Date(weekStart);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export function calendarEventTimeZone(event = {}, fallbackTimeZone = '') {
  const declaredTimeZone = String(event.timeZone || event.timezone || '').trim();
  if (isIanaTimeZone(declaredTimeZone)) return declaredTimeZone;
  const fallback = String(fallbackTimeZone || '').trim();
  return isIanaTimeZone(fallback) ? fallback : browserTimeZone();
}

function eventTimeFormatter(locale, timeZone) {
  const localeKey = Array.isArray(locale) ? locale.join(',') : String(locale || '');
  const key = `${localeKey}\u0000${timeZone}`;
  if (!eventTimeFormatterCache.has(key)) {
    eventTimeFormatterCache.set(key, new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }));
  }
  return eventTimeFormatterCache.get(key);
}

export function formatCalendarEventTime(event = {}, locale) {
  if (!parseTime(event.time)) return '';
  const timeZone = calendarEventTimeZone(event);
  const importedStartAt = Number(event._google ? event._startAt : 0);
  const startAt = Number.isFinite(importedStartAt) && importedStartAt > 0
    ? importedStartAt
    : zonedDateTimeTimestamp(event.date, event.time, timeZone);
  if (!startAt) return '';
  const formatter = eventTimeFormatter(locale, timeZone);
  const startLabel = formatter.format(startAt);
  const parsedDuration = Number.parseInt(event.duration, 10);
  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return startLabel;
  return `${startLabel} – ${formatter.format(startAt + parsedDuration * 60_000)}`;
}

export function roomEventsForCalendarWeek(events = [], weekStart) {
  const start = normalizedWeekStart(weekStart);
  if (!start) return [];
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const startKey = localDateKey(start);
  const endKey = localDateKey(end);
  const seenIds = new Set();

  return events
    .filter((event) => {
      const id = String(event?.id || '').trim();
      const date = String(event?.date || '').trim();
      if (!id || event?._google || seenIds.has(id) || !parseDateKey(date)) return false;
      if (date < startKey || date >= endKey) return false;
      seenIds.add(id);
      return true;
    })
    .sort((left, right) => (
      String(left.date).localeCompare(String(right.date))
      || String(left.time || '').localeCompare(String(right.time || ''))
      || String(left.title || '').localeCompare(String(right.title || ''))
      || String(left.id).localeCompare(String(right.id))
    ));
}

export function buildGoogleCalendarApiEvent(event = {}, { roomId = '', timeZone = '' } = {}) {
  const eventDate = parseDateKey(event.date);
  if (!eventDate) return null;
  const resource = {
    summary: String(event.title || '').trim() || 'Minimalist Chat event',
    location: String(event.location || '').trim(),
    description: String(event.desc || event.description || '').trim()
      ? `${String(event.desc || event.description).trim()}\n\nShared from Minimalist Chat.`
      : 'Shared from Minimalist Chat.',
    extendedProperties: {
      private: {
        [googleCalendarWeekRoomProperty]: String(roomId),
        [googleCalendarWeekEventProperty]: String(event.id || ''),
      },
    },
  };
  const eventTime = parseTime(event.time);

  if (eventTime) {
    const parsedDuration = Number.parseInt(event.duration, 10);
    const durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 60;
    const resolvedTimeZone = calendarEventTimeZone(event, timeZone);
    const startAt = zonedDateTimeTimestamp(event.date, event.time, resolvedTimeZone);
    if (!startAt) return null;
    resource.start = { dateTime: new Date(startAt).toISOString(), timeZone: resolvedTimeZone };
    resource.end = { dateTime: new Date(startAt + durationMinutes * 60_000).toISOString(), timeZone: resolvedTimeZone };
  } else {
    const end = new Date(eventDate.year, eventDate.month - 1, eventDate.day + 1);
    resource.start = { date: String(event.date) };
    resource.end = { date: localDateKey(end) };
  }

  return resource;
}

function googleCalendarApiError(status, message, partial) {
  return Object.assign(new Error(message), { status, partial });
}

async function existingGoogleWeekEventIds({ accessToken, fetchImpl, roomId }) {
  const existingIds = new Set();
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      maxResults: '2500',
      privateExtendedProperty: `${googleCalendarWeekRoomProperty}=${String(roomId)}`,
      singleEvents: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetchImpl(`${googleCalendarEventsUrl}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw googleCalendarApiError(response.status, `Google Calendar lookup failed (${response.status}).`);
    }
    const data = await response.json();
    (data.items || []).forEach((item) => {
      const eventId = item.extendedProperties?.private?.[googleCalendarWeekEventProperty];
      if (eventId) existingIds.add(String(eventId));
    });
    pageToken = String(data.nextPageToken || '');
  } while (pageToken);

  return existingIds;
}

async function legacyGoogleEventExists({ accessToken, eventId, fetchImpl }) {
  if (!eventId) return false;
  const response = await fetchImpl(`${googleCalendarEventsUrl}/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) {
    throw googleCalendarApiError(401, 'Google Calendar authorization expired.');
  }
  return response.ok;
}

export async function addRoomWeekToGoogleCalendar({
  accessToken,
  events = [],
  fetchImpl = globalThis.fetch,
  roomId,
  timeZone = '',
} = {}) {
  if (!accessToken) throw googleCalendarApiError(401, 'Google Calendar authorization is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');

  const result = { added: 0, already: 0, failed: 0, total: events.length };
  const existingIds = await existingGoogleWeekEventIds({ accessToken, fetchImpl, roomId });

  for (const event of events) {
    const eventId = String(event?.id || '');
    if (existingIds.has(eventId)) {
      result.already += 1;
      continue;
    }
    if (event.gId && await legacyGoogleEventExists({ accessToken, eventId: event.gId, fetchImpl })) {
      result.already += 1;
      existingIds.add(eventId);
      continue;
    }
    const resource = buildGoogleCalendarApiEvent(event, { roomId, timeZone });
    if (!resource) {
      result.failed += 1;
      continue;
    }
    try {
      const response = await fetchImpl(googleCalendarEventsUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(resource),
      });
      if (response.status === 401) {
        throw googleCalendarApiError(401, 'Google Calendar authorization expired.', { ...result });
      }
      if (response.ok || response.status === 409) {
        if (response.ok) result.added += 1;
        else result.already += 1;
        existingIds.add(eventId);
      } else {
        result.failed += 1;
      }
    } catch (error) {
      if (error?.status === 401) throw error;
      result.failed += 1;
    }
  }

  return result;
}

export function googleCalendarWeekResultMessage(result = {}) {
  const parts = [];
  if (result.added) parts.push(`Added ${result.added}`);
  if (result.already) parts.push(`${result.already} already there`);
  if (result.failed) parts.push(`${result.failed} failed`);
  return parts.length ? `${parts.join(' · ')}.` : 'This week is already on Google Calendar.';
}
