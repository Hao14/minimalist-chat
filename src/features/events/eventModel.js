const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const RSVP_STATUSES = new Set(['going', 'maybe', 'declined']);
const RECURRENCE_FREQUENCIES = new Set(['none', 'daily', 'weekly', 'monthly']);
const formatterCache = new Map();

export const EVENT_RSVP_STATUSES = Object.freeze(['going', 'maybe', 'declined']);
export const EVENT_RECURRENCE_FREQUENCIES = Object.freeze(['none', 'daily', 'weekly', 'monthly']);
export const EVENT_REMINDER_OPTIONS = Object.freeze([0, 10, 30, 60, 1440]);

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDate(value) {
  const match = DATE_PATTERN.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) return null;
  return { day, month, year };
}

function parseTime(value) {
  const match = TIME_PATTERN.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isIanaTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function eventTimeZone(event = {}) {
  const candidate = String(event.timeZone || event.timezone || '').trim();
  return isIanaTimeZone(candidate) ? candidate : browserTimeZone();
}

function zoneFormatter(timeZone) {
  const key = String(timeZone);
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-CA-u-hc-h23', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    }));
  }
  return formatterCache.get(key);
}

function zonedParts(timestamp, timeZone) {
  const parts = {};
  zoneFormatter(timeZone).formatToParts(timestamp).forEach(({ type, value }) => {
    if (type !== 'literal') parts[type] = Number(value);
  });
  return parts;
}

/**
 * Converts a date and wall-clock time in an IANA zone to an epoch timestamp.
 * The short fixed-point loop handles offset changes without shipping a timezone
 * database to the client. Invalid dates and times return 0.
 */
export function zonedDateTimeTimestamp(dateValue, timeValue, timeZoneValue) {
  const date = parseDate(dateValue);
  const time = parseTime(timeValue);
  if (!date || !time || !isIanaTimeZone(timeZoneValue)) return 0;

  const desired = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  let candidate = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const rendered = zonedParts(candidate, timeZoneValue);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second || 0,
    );
    candidate = desired - (renderedAsUtc - candidate);
  }
  const finalParts = zonedParts(candidate, timeZoneValue);
  if (
    finalParts.year !== date.year
    || finalParts.month !== date.month
    || finalParts.day !== date.day
    || finalParts.hour !== time.hour
    || finalParts.minute !== time.minute
  ) return 0;
  return Number.isFinite(candidate) ? candidate : 0;
}

export function eventTimestamp(event = {}) {
  if (!parseDate(event.date)) return 0;
  const time = parseTime(event.time) ? event.time : '23:59';
  return zonedDateTimeTimestamp(event.date, time, eventTimeZone(event));
}

export function eventEndTimestamp(event = {}) {
  const start = eventTimestamp(event);
  if (!start) return 0;
  if (!parseTime(event.time)) return start + 59_000;
  const duration = Math.max(1, Number.parseInt(event.duration, 10) || 60);
  return start + duration * 60_000;
}

export function eventState(event, now = Date.now()) {
  const start = eventTimestamp(event);
  const end = eventEndTimestamp(event);
  if (end && end < now) return 'past';
  if (start && start <= now && end >= now) return 'live';
  return 'upcoming';
}

export function formatEvent(event = {}, locale) {
  const date = parseDate(event.date);
  if (!date) return '';
  if (!parseTime(event.time)) {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      weekday: 'short',
    }).format(Date.UTC(date.year, date.month - 1, date.day, 12));
  }
  const timestamp = eventTimestamp(event);
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: eventTimeZone(event),
    timeZoneName: 'short',
    weekday: 'short',
  }).format(timestamp);
}

export function formatShortDate(event = {}, locale) {
  const date = parseDate(event.date);
  if (!date) return { day: '?', month: '', weekday: '' };
  const timestamp = Date.UTC(date.year, date.month - 1, date.day, 12);
  return {
    day: date.day,
    month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(timestamp),
    weekday: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(timestamp),
  };
}

export function recurrenceLabel(recurrence = {}) {
  const frequency = RECURRENCE_FREQUENCIES.has(recurrence?.frequency)
    ? recurrence.frequency
    : 'none';
  if (frequency === 'none') return '';
  const interval = Math.max(1, Number.parseInt(recurrence.interval, 10) || 1);
  const unit = frequency === 'daily' ? 'day' : frequency === 'weekly' ? 'week' : 'month';
  const cadence = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  return recurrence.until ? `${cadence} until ${recurrence.until}` : cadence;
}

export function reminderLabel(minutesValue) {
  const minutes = Number(minutesValue || 0);
  if (!minutes) return 'No reminder';
  if (minutes === 1440) return '1 day before';
  if (minutes === 60) return '1 hour before';
  return `${minutes} minutes before`;
}

function normalizeRsvpEntry(value) {
  const status = typeof value === 'string' ? value : value?.status;
  if (!RSVP_STATUSES.has(status)) return null;
  return {
    name: String(value?.name || '').trim(),
    status,
    updatedAt: Number(value?.updatedAt || 0),
  };
}

export function eventRsvpStatus(event = {}, uid = '') {
  return normalizeRsvpEntry(event.rsvps?.[uid])?.status || '';
}

export function eventRsvpCounts(event = {}) {
  const result = { going: 0, maybe: 0, declined: 0, total: 0 };
  Object.values(event.rsvps || {}).forEach((value) => {
    const entry = normalizeRsvpEntry(value);
    if (!entry) return;
    result[entry.status] += 1;
    result.total += 1;
  });
  return result;
}

export function eventRsvpNames(event = {}, status = 'going') {
  if (!RSVP_STATUSES.has(status)) return [];
  return Object.values(event.rsvps || {})
    .map(normalizeRsvpEntry)
    .filter((entry) => entry?.status === status && entry.name)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => entry.name);
}

export function createEmptyEventDraft(timeZone = browserTimeZone()) {
  return {
    date: '',
    desc: '',
    duration: '60',
    location: '',
    recurrenceFrequency: 'none',
    recurrenceUntil: '',
    reminderMinutes: '0',
    roomCall: false,
    time: '',
    timeZone: isIanaTimeZone(timeZone) ? timeZone : 'UTC',
    title: '',
  };
}

export function eventDraftFromEvent(event = {}) {
  return {
    date: String(event.date || ''),
    desc: String(event.desc || event.description || ''),
    duration: String(Math.max(1, Number.parseInt(event.duration, 10) || 60)),
    location: String(event.location || ''),
    recurrenceFrequency: RECURRENCE_FREQUENCIES.has(event.recurrence?.frequency)
      ? event.recurrence.frequency
      : 'none',
    recurrenceUntil: String(event.recurrence?.until || ''),
    reminderMinutes: String(Math.max(0, Number.parseInt(event.reminderMinutes, 10) || 0)),
    roomCall: event.roomCall === true,
    time: String(event.time || ''),
    timeZone: eventTimeZone(event),
    title: String(event.title || ''),
  };
}

export function validateEventDraft(draft = {}) {
  const errors = {};
  const title = String(draft.title || '').trim();
  const recurrenceFrequency = String(draft.recurrenceFrequency || 'none');
  const duration = Number.parseInt(draft.duration, 10);
  const reminderMinutes = Number.parseInt(draft.reminderMinutes, 10) || 0;

  if (!title) errors.title = 'Add an event title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';
  if (!parseDate(draft.date)) errors.date = 'Choose a valid event date.';
  if (draft.time && !parseTime(draft.time)) errors.time = 'Choose a valid start time.';
  if (!isIanaTimeZone(draft.timeZone)) errors.timeZone = 'Enter a valid IANA time zone, such as America/Los_Angeles.';
  if (
    !errors.date
    && !errors.time
    && !errors.timeZone
    && draft.time
    && !zonedDateTimeTimestamp(draft.date, draft.time, draft.timeZone)
  ) errors.time = 'That local time does not exist in the selected time zone.';
  if (!Number.isFinite(duration) || duration < 5 || duration > 1440) errors.duration = 'Duration must be between 5 minutes and 24 hours.';
  if (String(draft.location || '').trim().length > 160) errors.location = 'Keep the location under 160 characters.';
  if (String(draft.desc || '').trim().length > 2000) errors.desc = 'Keep notes under 2,000 characters.';
  if (!RECURRENCE_FREQUENCIES.has(recurrenceFrequency)) errors.recurrence = 'Choose a valid repeat option.';
  if (recurrenceFrequency !== 'none' && draft.recurrenceUntil) {
    if (!parseDate(draft.recurrenceUntil)) errors.recurrenceUntil = 'Choose a valid repeat end date.';
    else if (parseDate(draft.date) && draft.recurrenceUntil < draft.date) errors.recurrenceUntil = 'Repeat end must be on or after the event date.';
  }
  if (reminderMinutes < 0 || reminderMinutes > 10_080) errors.reminderMinutes = 'Reminder must be within seven days of the event.';
  if (reminderMinutes > 0 && !draft.time) errors.reminderMinutes = 'Add a start time to use a reminder.';

  return { errors, ok: Object.keys(errors).length === 0 };
}

export function eventPayloadFromDraft(draft = {}) {
  const validation = validateEventDraft(draft);
  if (!validation.ok) {
    const error = new Error(Object.values(validation.errors)[0]);
    error.validationErrors = validation.errors;
    throw error;
  }
  const frequency = RECURRENCE_FREQUENCIES.has(draft.recurrenceFrequency)
    ? draft.recurrenceFrequency
    : 'none';
  const recurrence = frequency === 'none'
    ? null
    : {
      frequency,
      interval: 1,
      ...(draft.recurrenceUntil ? { until: draft.recurrenceUntil } : {}),
    };
  return {
    date: String(draft.date),
    desc: String(draft.desc || '').trim(),
    duration: Math.max(5, Number.parseInt(draft.duration, 10) || 60),
    location: String(draft.location || '').trim(),
    recurrence,
    reminderMinutes: Math.max(0, Number.parseInt(draft.reminderMinutes, 10) || 0),
    roomCall: draft.roomCall === true,
    time: String(draft.time || ''),
    timeZone: String(draft.timeZone || '').trim(),
    title: String(draft.title || '').trim(),
  };
}

export function eventReminderDueAt(event = {}) {
  const start = eventTimestamp(event);
  const minutes = Math.max(0, Number.parseInt(event.reminderMinutes, 10) || 0);
  return start && minutes ? start - minutes * 60_000 : 0;
}

/**
 * GoogleCalendarLink currently exports wall-clock values in the browser's
 * zone. Convert the event's zoned instant to local fields before passing it to
 * that component so the exported event still represents the correct moment.
 */
export function eventForGoogleCalendar(event = {}) {
  const recurrence = recurrenceLabel(event.recurrence);
  const notes = [
    String(event.desc || event.description || '').trim(),
    `Scheduled in ${eventTimeZone(event)}.`,
    recurrence ? `Repeats: ${recurrence}.` : '',
    event.roomCall === true ? 'Join from the Calls tab in the Minimalist room.' : '',
  ].filter(Boolean).join('\n');
  if (!parseTime(event.time)) return { ...event, desc: notes };
  const timestamp = eventTimestamp(event);
  if (!timestamp) return { ...event, desc: notes };
  const local = new Date(timestamp);
  return {
    ...event,
    date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    desc: notes,
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    timeZone: browserTimeZone(),
  };
}
