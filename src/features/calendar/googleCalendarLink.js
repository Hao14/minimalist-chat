const googleCalendarTemplateUrl = 'https://calendar.google.com/calendar/r/eventedit';

const pad = (value) => String(value).padStart(2, '0');
let cachedTimeZone;

function parseEventDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, day, month, year };
}

function parseEventTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function compactDay(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function compactUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function currentTimeZone() {
  if (cachedTimeZone !== undefined) return cachedTimeZone;
  try {
    cachedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    cachedTimeZone = '';
  }
  return cachedTimeZone;
}

export function buildGoogleCalendarUrl(event = {}) {
  const eventDate = parseEventDate(event.date);
  if (!eventDate) return '';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: String(event.title || '').trim() || 'Minimalist Chat event',
  });
  const eventTime = parseEventTime(event.time);

  if (eventTime) {
    const start = new Date(
      eventDate.year,
      eventDate.month - 1,
      eventDate.day,
      eventTime.hour,
      eventTime.minute,
    );
    const parsedDuration = Number.parseInt(event.duration, 10);
    const durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 60;
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    params.set('dates', `${compactUtc(start)}/${compactUtc(end)}`);
    const timeZone = currentTimeZone();
    if (timeZone) {
      params.set('stz', timeZone);
      params.set('etz', timeZone);
    }
  } else {
    const end = new Date(eventDate.year, eventDate.month - 1, eventDate.day + 1);
    params.set('dates', `${compactDay(eventDate.date)}/${compactDay(end)}`);
  }

  const description = String(event.desc || event.description || '').trim();
  params.set('details', description ? `${description}\n\nShared from Minimalist Chat.` : 'Shared from Minimalist Chat.');
  const location = String(event.location || '').trim();
  if (location) params.set('location', location);

  return `${googleCalendarTemplateUrl}?${params.toString()}`;
}
