import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { GoogleCalendarLink } from '../calendar/GoogleCalendarLink.jsx';
import { useRoomTabActivity, useRoomTabDataActivity } from '../shell/roomTabActivity.js';
import './events.css';

const EMPTY_DRAFT = { title: '', date: '', time: '', duration: '60', location: '', desc: '' };

function formatEvent(event) {
  if (!event.date) return '';
  const date = new Date(`${event.date}T${event.time || '00:00'}`);
  let result = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (event.time) result += ` · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return result;
}

function eventTimestamp(event) {
  if (!event.date) return 0;
  return new Date(`${event.date}T${event.time || '23:59'}`).getTime() || 0;
}

function eventEndTimestamp(event) {
  const start = eventTimestamp(event);
  if (!start) return 0;
  if (!event.time) return new Date(`${event.date}T23:59:59`).getTime();
  const duration = Math.max(1, Number.parseInt(event.duration, 10) || 60);
  return start + duration * 60_000;
}

function eventState(event, now) {
  const start = eventTimestamp(event);
  const end = eventEndTimestamp(event);
  if (end && end < now) return 'past';
  if (start && start <= now && end >= now) return 'live';
  return 'upcoming';
}

function formatShortDate(event) {
  if (!event.date) return { day: '?', month: '', weekday: '' };
  const date = new Date(`${event.date}T00:00:00`);
  return {
    day: date.getDate(),
    month: date.toLocaleDateString('en-US', { month: 'short' }),
    weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
  };
}

function displayUserName(user = {}) {
  const profileName = String(user.displayName || '').trim();
  if (profileName && profileName !== 'Anonymous') return profileName;
  return String(user.email || '').split('@')[0] || 'Room member';
}

function toDateKey(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function DateRail({ now, selectedDate, onSelect }) {
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index);
    return date;
  }), [now]);

  return (
    <div className="events-date-rail" aria-label="Filter events by date">
      <button type="button" className={!selectedDate ? 'active' : ''} onClick={() => onSelect('')}>
        <span>All</span><strong>Upcoming</strong>
      </button>
      {dates.map((date, index) => {
        const key = toDateKey(date);
        return (
          <button key={key} type="button" className={selectedDate === key ? 'active' : ''} aria-pressed={selectedDate === key} onClick={() => onSelect(key)}>
            <span>{index === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
            <strong>{date.getDate()}</strong>
          </button>
        );
      })}
    </div>
  );
}

function EventRow({ event, isSelected, onSelect, state }) {
  const date = formatShortDate(event);
  return (
    <article className={`rh-event event-${state} ${isSelected ? 'is-selected' : ''}`}>
      <button type="button" className="rh-event-main" onClick={() => onSelect(event.id)} aria-pressed={isSelected}>
        <time className="rh-event-date" dateTime={`${event.date}${event.time ? `T${event.time}` : ''}`}>
          <span className="rh-w">{date.weekday}</span>
          <span className="rh-d">{date.day}</span>
          <span className="rh-m">{date.month}</span>
        </time>
        <span className="rh-event-body">
          <span className="rh-event-title-row">
            <strong className="rh-event-title">{event.title || 'Untitled event'}</strong>
            <span className="rh-event-pill">{state === 'live' ? 'Happening now' : state === 'past' ? 'Past' : 'Upcoming'}</span>
          </span>
          <span className="rh-event-desc"><i className="ph-bold ph-clock" /> {formatEvent(event)}</span>
          {event.location ? <span className="rh-event-location"><i className="ph-bold ph-map-pin" /> {event.location}</span> : null}
          {event.desc ? <span className="rh-event-notes">{event.desc}</span> : null}
        </span>
        <i className="ph-bold ph-caret-right rh-event-open" aria-hidden="true" />
      </button>
    </article>
  );
}

function EventDetail({ canEdit, event, onDelete, state }) {
  if (!event) {
    return (
      <aside className="events-detail events-detail-empty">
        <i className="ph-bold ph-calendar-blank" />
        <strong>Nothing selected</strong>
        <span>Choose an event to see its schedule and actions.</span>
      </aside>
    );
  }
  return (
    <aside className="events-detail" aria-label={`${event.title} details`}>
      <div className="events-detail-status"><span className={`event-state-dot event-${state}`} />{state === 'live' ? 'Happening now' : state === 'past' ? 'Past event' : 'Coming up'}</div>
      <h3>{event.title || 'Untitled event'}</h3>
      <div className="events-detail-meta">
        <span><i className="ph-bold ph-calendar-blank" /> {formatEvent(event)}</span>
        {event.duration ? <span><i className="ph-bold ph-timer" /> {event.duration} minutes</span> : null}
        {event.location ? <span><i className="ph-bold ph-map-pin" /> {event.location}</span> : null}
        <span><i className="ph-bold ph-user-circle" /> {event.byName || 'Room event'}</span>
      </div>
      {event.desc ? <div className="events-detail-notes"><span>Notes</span><p>{event.desc}</p></div> : null}
      <div className="events-detail-actions">
        <GoogleCalendarLink event={event} className="events-google-action" />
        {canEdit ? <button type="button" className="rh-del" onClick={() => onDelete(event.id, event.title)} aria-label={`Delete ${event.title}`}><i className="ph-bold ph-trash" /></button> : null}
      </div>
    </aside>
  );
}

function EventComposer({ draft, error, onClose, onSubmit, pending, updateDraft }) {
  const titleRef = useRef(null);
  const formRef = useRef(null);
  const closeOnEscape = useEffectEvent(() => { if (!pending) onClose(); });
  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { closeOnEscape(); return; }
      if (event.key !== 'Tab' || !formRef.current) return;
      const focusable = [...formRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button type="button" className="events-compose-backdrop" onClick={onClose} aria-label="Close event composer" />
      <form ref={formRef} id="ev-page-form" className="events-compose" onSubmit={onSubmit}>
        <header>
          <div><span>Room calendar</span><h3>New event</h3></div>
          <button type="button" onClick={onClose} aria-label="Close"><i className="ph-bold ph-x" /></button>
        </header>
        <div className="events-compose-body">
          <label><span>Title</span><input ref={titleRef} id="ev-page-title" value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="e.g. Design review" maxLength={120} required /></label>
          <div className="events-form-grid">
            <label><span>Date</span><input type="date" id="ev-page-date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} required /></label>
            <label><span>Start time</span><input type="time" id="ev-page-time" value={draft.time} onChange={(event) => updateDraft('time', event.target.value)} /></label>
          </div>
          <div className="events-form-grid">
            <label><span>Duration</span><select value={draft.duration} onChange={(event) => updateDraft('duration', event.target.value)}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></label>
            <label><span>Location</span><input value={draft.location} onChange={(event) => updateDraft('location', event.target.value)} placeholder="Optional" maxLength={160} /></label>
          </div>
          <label><span>Notes</span><textarea id="ev-page-desc" value={draft.desc} onChange={(event) => updateDraft('desc', event.target.value)} placeholder="Add context, an agenda, or a reminder…" maxLength={2000} rows={5} /></label>
          {error ? <div className="events-compose-error" role="alert"><i className="ph-bold ph-warning-circle" /> {error}</div> : null}
        </div>
        <footer>
          <button type="button" className="events-cancel" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="rh-save-btn" id="ev-page-save" disabled={pending}><i className={`ph-bold ${pending ? 'ph-circle-notch events-spin' : 'ph-calendar-plus'}`} /> {pending ? 'Creating…' : 'Create event'}</button>
        </footer>
      </form>
    </>
  );
}

function EventsRoom({ adminUid, roomId, user }) {
  const isRoomTabActive = useRoomTabActivity('events');
  const isRoomTabDataActive = useRoomTabDataActivity('events');
  const [events, setEvents] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [canEdit, setCanEdit] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');
  const [eventsStatus, setEventsStatus] = useState({ roomId: null, loading: true, error: '' });
  const eventsLoading = eventsStatus.roomId !== roomId || eventsStatus.loading;
  const eventsError = eventsStatus.roomId === roomId ? eventsStatus.error : '';

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    const refresh = () => setNow(Date.now());
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [isRoomTabDataActive]);

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    return onValue(ref(db, `rooms_meta/${roomId}/events`), (snapshot) => {
      const value = snapshot.val() || {};
      setEvents(Object.entries(value).map(([id, event]) => ({ id, ...event })));
      setEventsStatus({ roomId, loading: false, error: '' });
    }, (error) => {
      setEvents([]);
      setEventsStatus({ roomId, loading: false, error: error.message || 'Could not load events.' });
    });
  }, [isRoomTabDataActive, roomId]);

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    let active = true;
    const checkPermission = async () => {
      if (user.uid === adminUid) { if (active) setCanEdit(true); return; }
      if (roomId === 'global') { if (active) setCanEdit(false); return; }
      try {
        const room = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {};
        if (active) setCanEdit(room.creatorId === user.uid);
      } catch { if (active) setCanEdit(false); }
    };
    checkPermission();
    return () => { active = false; };
  }, [adminUid, isRoomTabDataActive, roomId, user.uid]);

  const sortedEvents = useMemo(() => [...events].sort((a, b) => eventTimestamp(a) - eventTimestamp(b)), [events]);
  const upcomingEvents = useMemo(() => sortedEvents.filter((event) => eventState(event, now) !== 'past'), [now, sortedEvents]);
  const pastEvents = useMemo(() => sortedEvents.filter((event) => eventState(event, now) === 'past').reverse(), [now, sortedEvents]);
  const visibleUpcomingEvents = useMemo(() => selectedDate ? upcomingEvents.filter((event) => event.date === selectedDate) : upcomingEvents, [selectedDate, upcomingEvents]);
  const selectedEvent = events.find((event) => event.id === selectedId) || upcomingEvents[0] || pastEvents[0] || null;

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const openComposer = () => {
    setFormError('');
    setDraft((current) => ({ ...current, date: current.date || toDateKey(new Date()) }));
    setFormOpen(true);
  };
  const addEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    if (pending) return;
    if (!canEdit) { window.showToast?.('Only room managers can add events.'); return; }
    const title = draft.title.trim();
    if (!title || !draft.date) { setFormError('Add a title and date before creating this event.'); return; }
    setPending(true);
    setFormError('');
    try {
      const eventRef = push(ref(db, `rooms_meta/${roomId}/events`));
      await set(eventRef, {
        title,
        date: draft.date,
        time: draft.time,
        duration: draft.duration,
        location: draft.location.trim(),
        desc: draft.desc.trim(),
        by: user.uid,
        byName: displayUserName(user),
        createdAt: Date.now(),
      });
      setDraft(EMPTY_DRAFT);
      setFormOpen(false);
      setSelectedId(eventRef.key);
      window.showToast?.('Event added.', false);
    } catch (error) {
      setFormError(error.message || 'Could not create this event. Try again.');
    } finally {
      setPending(false);
    }
  };

  const deleteEvent = async (id, title) => {
    if (!canEdit) { window.showToast?.('Only room managers can delete events.'); return; }
    if (!window.confirm(`Delete “${title || 'this event'}”?`)) return;
    try {
      await remove(ref(db, `rooms_meta/${roomId}/events/${id}`));
      setSelectedId((current) => current === id ? null : current);
      window.showToast?.('Event deleted.', false);
    } catch (error) { window.showToast?.(error.message || 'Could not delete this event.'); }
  };

  return (
    <div className="events-page-scroll events-redesign">
      <header className="events-head">
        <div>
          <span className="events-kicker"><i className="ph-bold ph-calendar-dots" /> Room calendar</span>
          <div className="events-title-line"><h2>Events</h2><span>{upcomingEvents.length} upcoming · {pastEvents.length} past</span></div>
          <p>Plan time together and send any event straight to Google Calendar.</p>
        </div>
        {canEdit ? <button type="button" id="ev-page-add-btn" className="rh-add-btn" aria-expanded={formOpen} aria-controls="ev-page-form" onClick={openComposer}><i className="ph-bold ph-plus" /> <span>New event</span></button> : null}
      </header>

      <DateRail now={now} selectedDate={selectedDate} onSelect={setSelectedDate} />

      <div className="events-workspace">
        <section className="events-agenda" aria-label="Event agenda">
          <header><div><span>{selectedDate ? 'Selected day' : 'Upcoming'}</span><strong>{visibleUpcomingEvents.length} scheduled</strong></div>{selectedDate ? <button type="button" onClick={() => setSelectedDate('')}>Clear date</button> : null}</header>
          <div className="events-agenda-list" id="events-page-list">
            {eventsLoading || eventsError ? (
              <div className={`rh-muted event-empty ${eventsError ? 'error' : ''}`} role={eventsLoading ? 'status' : 'alert'}>
                <i className={`ph-bold ${eventsError ? 'ph-warning-circle' : 'ph-spinner-gap events-spin'}`} />
                <strong>{eventsLoading ? 'Loading events…' : 'Could not load events.'}</strong>
                <span>{eventsLoading ? 'Checking this room schedule.' : eventsError}</span>
              </div>
            ) : visibleUpcomingEvents.length ? visibleUpcomingEvents.map((event) => (
              <EventRow key={event.id} event={event} state={eventState(event, now)} isSelected={selectedEvent?.id === event.id} onSelect={setSelectedId} />
            )) : (
              <div className="rh-muted event-empty"><i className="ph-bold ph-calendar-blank" /><strong>{selectedDate ? 'No events on this day.' : 'No events yet.'}</strong><span>{canEdit ? 'Create the first event for this room.' : 'Nothing has been scheduled in this room yet.'}</span></div>
            )}
          </div>

          {pastEvents.length ? (
            <details className="events-past-section">
              <summary><span>Past events</span><strong>{pastEvents.length}</strong><i className="ph-bold ph-caret-down" /></summary>
              <div>{pastEvents.map((event) => <EventRow key={event.id} event={event} state="past" isSelected={selectedEvent?.id === event.id} onSelect={setSelectedId} />)}</div>
            </details>
          ) : null}
        </section>

        <EventDetail event={selectedEvent} state={selectedEvent ? eventState(selectedEvent, now) : 'upcoming'} canEdit={canEdit} onDelete={deleteEvent} />
      </div>

      {formOpen && isRoomTabActive ? <EventComposer draft={draft} error={formError} onClose={() => { if (!pending) setFormOpen(false); }} onSubmit={addEvent} pending={pending} updateDraft={updateDraft} /> : null}
    </div>
  );
}

export function Events(props) {
  return <EventsRoom key={props.roomId} {...props} />;
}
