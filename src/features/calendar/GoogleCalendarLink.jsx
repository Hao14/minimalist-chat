import { buildGoogleCalendarUrl } from './googleCalendarLink.js';

export function GoogleCalendarLink({ className = '', event }) {
  if (!event || event._google) return null;
  const href = buildGoogleCalendarUrl(event);
  if (!href) return null;
  const title = String(event.title || '').trim() || 'event';

  return (
    <a
      className={`google-calendar-link ${className}`.trim()}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Add to Google Calendar"
      aria-label={`Add ${title} to Google Calendar`}
    >
      <i className="ph-bold ph-google-logo" aria-hidden="true" />
      <span>Add to Google</span>
    </a>
  );
}
