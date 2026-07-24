import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { get, onValue, push, ref, remove, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { GoogleCalendarLink } from '../calendar/GoogleCalendarLink.jsx';
import { useRoomTabActivity, useRoomTabDataActivity } from '../shell/roomTabActivity.js';
import {
  browserTimeZone,
  createEmptyEventDraft,
  eventDraftFromEvent,
  eventForGoogleCalendar,
  eventPayloadFromDraft,
  eventReminderDueAt,
  eventRsvpCounts,
  eventRsvpNames,
  eventRsvpStatus,
  eventState,
  eventTimestamp,
  formatEvent,
  formatShortDate,
  recurrenceLabel,
  reminderLabel,
} from './eventModel.js';
import './events.css';

const COMMON_TIME_ZONES = Object.freeze([...new Set([
  browserTimeZone(),
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
])]);

function displayUserName(user = {}) {
  const profileName = String(user.displayName || '').trim();
  if (profileName && profileName !== 'Anonymous') return profileName;
  return String(user.email || '').split('@')[0] || 'Room member';
}

function toDateKey(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function DateRail({ now, onSelect, selectedDate }) {
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index);
    return date;
  }), [now]);

  return (
    <div className="events-date-rail" aria-label="Filter events by date">
      <button
        type="button"
        className={!selectedDate ? 'active' : ''}
        aria-pressed={!selectedDate}
        onClick={() => onSelect('')}
      >
        <span>All</span><strong>Upcoming</strong>
      </button>
      {dates.map((date, index) => {
        const key = toDateKey(date);
        return (
          <button
            key={key}
            type="button"
            className={selectedDate === key ? 'active' : ''}
            aria-pressed={selectedDate === key}
            onClick={() => onSelect(key)}
          >
            <span>{index === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <strong>{date.getDate()}</strong>
          </button>
        );
      })}
    </div>
  );
}

function EventRow({ event, isSelected, onSelect, state }) {
  const date = formatShortDate(event);
  const recurrence = recurrenceLabel(event.recurrence);
  const rsvps = eventRsvpCounts(event);
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
          <span className="rh-event-desc"><i className="ph-bold ph-clock" aria-hidden="true" /> {formatEvent(event)}</span>
          {event.location ? <span className="rh-event-location"><i className="ph-bold ph-map-pin" aria-hidden="true" /> {event.location}</span> : null}
          {recurrence || rsvps.total ? (
            <span className="rh-event-signal">
              {recurrence ? <span><i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /> {recurrence}</span> : null}
              {rsvps.total ? <span><i className="ph-bold ph-users" aria-hidden="true" /> {rsvps.going} going · {rsvps.maybe} maybe</span> : null}
            </span>
          ) : null}
        </span>
        <i className="ph-bold ph-caret-right rh-event-open" aria-hidden="true" />
      </button>
    </article>
  );
}

function RsvpControls({ disabled, event, onRsvp, pending, userId }) {
  const currentStatus = eventRsvpStatus(event, userId);
  const counts = eventRsvpCounts(event);
  const goingNames = eventRsvpNames(event, 'going');
  const maybeNames = eventRsvpNames(event, 'maybe');
  const groupLabel = `RSVP for ${event.title || 'event'}`;

  return (
    <section className="events-rsvp" aria-label={groupLabel}>
      <div className="events-detail-section-head">
        <span>RSVP</span>
        <strong aria-live="polite">{counts.going} going · {counts.maybe} maybe</strong>
      </div>
      <div className="events-rsvp-options" role="group" aria-label={groupLabel}>
        <button type="button" className={currentStatus === 'going' ? 'active' : ''} aria-pressed={currentStatus === 'going'} disabled={disabled || pending} onClick={() => onRsvp(event.id, 'going')}>
          <i className="ph-bold ph-check-circle" aria-hidden="true" /> Going <strong>{counts.going}</strong>
        </button>
        <button type="button" className={currentStatus === 'maybe' ? 'active' : ''} aria-pressed={currentStatus === 'maybe'} disabled={disabled || pending} onClick={() => onRsvp(event.id, 'maybe')}>
          <i className="ph-bold ph-clock-countdown" aria-hidden="true" /> Maybe <strong>{counts.maybe}</strong>
        </button>
        <button type="button" className={currentStatus === 'declined' ? 'active' : ''} aria-pressed={currentStatus === 'declined'} disabled={disabled || pending} onClick={() => onRsvp(event.id, 'declined')}>
          <i className="ph-bold ph-x-circle" aria-hidden="true" /> Can’t go <strong>{counts.declined}</strong>
        </button>
      </div>
      {goingNames.length || maybeNames.length ? (
        <p className="events-attendee-names">
          {goingNames.length ? <span><strong>Going:</strong> {goingNames.slice(0, 6).join(', ')}{goingNames.length > 6 ? ` +${goingNames.length - 6}` : ''}</span> : null}
          {maybeNames.length ? <span><strong>Maybe:</strong> {maybeNames.slice(0, 4).join(', ')}{maybeNames.length > 4 ? ` +${maybeNames.length - 4}` : ''}</span> : null}
        </p>
      ) : null}
    </section>
  );
}

function EventDetail({
  canEdit,
  event,
  now,
  onDelete,
  onEdit,
  onOpenRoomCall,
  onRsvp,
  onSaveReminder,
  pendingReminderId,
  pendingRsvpId,
  state,
  userId,
}) {
  if (!event) {
    return (
      <aside className="events-detail events-detail-empty">
        <i className="ph-bold ph-calendar-blank" aria-hidden="true" />
        <strong>Nothing selected</strong>
        <span>Choose an event to see its schedule and actions.</span>
      </aside>
    );
  }

  const recurrence = recurrenceLabel(event.recurrence);
  const reminderMinutes = Math.max(0, Number.parseInt(event.reminderMinutes, 10) || 0);
  const reminderDueAt = eventReminderDueAt(event);
  const reminderAvailable = reminderMinutes > 0 && reminderDueAt > now;
  const isPast = state === 'past';

  return (
    <aside className="events-detail" aria-label={`${event.title || 'Event'} details`}>
      <div className="events-detail-status"><span className={`event-state-dot event-${state}`} />{state === 'live' ? 'Happening now' : isPast ? 'Past event' : 'Coming up'}</div>
      <div className="events-detail-title">
        <h3>{event.title || 'Untitled event'}</h3>
        {canEdit ? (
          <button type="button" className="events-edit-btn" onClick={() => onEdit(event)} aria-label={`Edit ${event.title || 'event'}`}>
            <i className="ph-bold ph-pencil-simple" aria-hidden="true" /> Edit
          </button>
        ) : null}
      </div>
      <div className="events-detail-meta">
        <span><i className="ph-bold ph-calendar-blank" aria-hidden="true" /> {formatEvent(event)}</span>
        {event.duration ? <span><i className="ph-bold ph-timer" aria-hidden="true" /> {event.duration} minutes</span> : null}
        {event.location ? <span><i className="ph-bold ph-map-pin" aria-hidden="true" /> {event.location}</span> : null}
        {recurrence ? <span><i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /> {recurrence}</span> : null}
        {reminderMinutes ? <span><i className="ph-bold ph-bell" aria-hidden="true" /> Reminder {reminderLabel(reminderMinutes).toLowerCase()}</span> : null}
        {event.roomCall ? <span><i className="ph-bold ph-video-camera" aria-hidden="true" /> Room call attached</span> : null}
        <span><i className="ph-bold ph-user-circle" aria-hidden="true" /> {event.byName || 'Room event'}</span>
      </div>

      <RsvpControls
        disabled={isPast}
        event={event}
        onRsvp={onRsvp}
        pending={pendingRsvpId === event.id}
        userId={userId}
      />

      {event.desc ? <div className="events-detail-notes"><span>Notes</span><p>{event.desc}</p></div> : null}
      <div className="events-detail-actions">
        {event.roomCall ? (
          <button type="button" className="events-call-action" onClick={onOpenRoomCall}>
            <i className="ph-bold ph-video-camera" aria-hidden="true" /> Open room call
          </button>
        ) : null}
        {reminderMinutes ? (
          <button
            type="button"
            className="events-reminder-action"
            disabled={!reminderAvailable || pendingReminderId === event.id}
            onClick={() => onSaveReminder(event)}
            title={reminderAvailable ? `Save a reminder ${reminderLabel(reminderMinutes).toLowerCase()}` : 'The reminder time has passed'}
          >
            <i className={`ph-bold ${pendingReminderId === event.id ? 'ph-circle-notch events-spin' : 'ph-bell'}`} aria-hidden="true" />
            {pendingReminderId === event.id ? 'Saving…' : 'Remind me'}
          </button>
        ) : null}
        <GoogleCalendarLink event={eventForGoogleCalendar(event)} className="events-google-action" />
        {canEdit ? (
          <button type="button" className="rh-del" onClick={() => onDelete(event.id, event.title)} aria-label={`Delete ${event.title || 'event'}`}>
            <i className="ph-bold ph-trash" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function EventComposer({ draft, error, mode, onClose, onSubmit, pending, updateDraft }) {
  const titleRef = useRef(null);
  const formRef = useRef(null);
  const closeOnEscape = useEffectEvent(() => { if (!pending) onClose(); });

  useEffect(() => {
    const previousFocus = document.activeElement;
    titleRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOnEscape();
        return;
      }
      if (event.key !== 'Tab' || !formRef.current) return;
      const focusable = [...formRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const editing = mode === 'edit';
  const dialogTitle = editing ? 'Edit event' : 'New event';

  return (
    <div className="events-compose-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <form
        ref={formRef}
        id="ev-page-form"
        className="events-compose"
        role="dialog"
        aria-modal="true"
        aria-busy={pending}
        aria-labelledby="events-compose-title"
        aria-describedby="events-compose-description"
        onSubmit={onSubmit}
      >
        <header>
          <div>
            <span>Room calendar</span>
            <h3 id="events-compose-title">{dialogTitle}</h3>
            <p id="events-compose-description">{editing ? 'Update the shared event details.' : 'Schedule time for everyone in this room.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label={`Close ${dialogTitle.toLowerCase()}`}><i className="ph-bold ph-x" aria-hidden="true" /></button>
        </header>
        <div className="events-compose-body">
          <label>
            <span>Title</span>
            <input ref={titleRef} id="ev-page-title" value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="e.g. Design review" maxLength={120} required />
          </label>
          <div className="events-form-grid">
            <label><span>Date</span><input type="date" id="ev-page-date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} required /></label>
            <label><span>Start time</span><input type="time" id="ev-page-time" value={draft.time} onChange={(event) => updateDraft('time', event.target.value)} /></label>
          </div>
          <div className="events-form-grid">
            <label>
              <span>Duration</span>
              <select value={draft.duration} onChange={(event) => updateDraft('duration', event.target.value)}>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">1 hour</option>
                <option value="90">1.5 hours</option>
                <option value="120">2 hours</option>
              </select>
            </label>
            <label>
              <span>Time zone</span>
              <input list="events-time-zone-options" value={draft.timeZone} onChange={(event) => updateDraft('timeZone', event.target.value)} placeholder="America/Los_Angeles" maxLength={80} required />
              <datalist id="events-time-zone-options">{COMMON_TIME_ZONES.map((timeZone) => <option value={timeZone} key={timeZone} />)}</datalist>
            </label>
          </div>
          <div className="events-form-grid">
            <label>
              <span>Repeats</span>
              <select value={draft.recurrenceFrequency} onChange={(event) => updateDraft('recurrenceFrequency', event.target.value)}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {draft.recurrenceFrequency !== 'none' ? (
              <label>
                <span>Repeat until</span>
                <input type="date" min={draft.date || undefined} value={draft.recurrenceUntil} onChange={(event) => updateDraft('recurrenceUntil', event.target.value)} />
              </label>
            ) : (
              <label>
                <span>Reminder</span>
                <select value={draft.reminderMinutes} onChange={(event) => updateDraft('reminderMinutes', event.target.value)}>
                  <option value="0">No reminder</option>
                  <option value="10">10 minutes before</option>
                  <option value="30">30 minutes before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
                </select>
              </label>
            )}
          </div>
          {draft.recurrenceFrequency !== 'none' ? (
            <label>
              <span>Reminder</span>
              <select value={draft.reminderMinutes} onChange={(event) => updateDraft('reminderMinutes', event.target.value)}>
                <option value="0">No reminder</option>
                <option value="10">10 minutes before</option>
                <option value="30">30 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="1440">1 day before</option>
              </select>
            </label>
          ) : null}
          <label><span>Location</span><input value={draft.location} onChange={(event) => updateDraft('location', event.target.value)} placeholder="Optional" maxLength={160} /></label>
          <label className="events-check-row">
            <input type="checkbox" checked={draft.roomCall} onChange={(event) => updateDraft('roomCall', event.target.checked)} />
            <span><strong>Attach this room’s call</strong><small>Members can open the Calls tab directly from the event.</small></span>
          </label>
          <label><span>Notes</span><textarea id="ev-page-desc" value={draft.desc} onChange={(event) => updateDraft('desc', event.target.value)} placeholder="Add context or an agenda…" maxLength={2000} rows={4} /></label>
          {error ? <div className="events-compose-error" role="alert"><i className="ph-bold ph-warning-circle" aria-hidden="true" /> {error}</div> : null}
        </div>
        <footer>
          <button type="button" className="events-cancel" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="rh-save-btn" id="ev-page-save" disabled={pending}>
            <i className={`ph-bold ${pending ? 'ph-circle-notch events-spin' : editing ? 'ph-check' : 'ph-calendar-plus'}`} aria-hidden="true" />
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function EventsRoom({ adminUid, roomId, user }) {
  const isRoomTabActive = useRoomTabActivity('events');
  const isRoomTabDataActive = useRoomTabDataActivity('events');
  const [events, setEvents] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [canEdit, setCanEdit] = useState(false);
  const [composerMode, setComposerMode] = useState('');
  const [editingEventId, setEditingEventId] = useState('');
  const [draft, setDraft] = useState(() => createEmptyEventDraft());
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingRsvpId, setPendingRsvpId] = useState('');
  const [pendingReminderId, setPendingReminderId] = useState('');
  const [formError, setFormError] = useState('');
  const [eventsStatus, setEventsStatus] = useState({ roomId: null, loading: true, error: '' });
  const eventsLoading = eventsStatus.roomId !== roomId || eventsStatus.loading;
  const eventsError = eventsStatus.roomId === roomId ? eventsStatus.error : '';

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    const refresh = () => setNow(Date.now());
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
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
      if (user.uid === adminUid) {
        if (active) setCanEdit(true);
        return;
      }
      if (roomId === 'global') {
        if (active) setCanEdit(false);
        return;
      }
      try {
        const room = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {};
        if (active) setCanEdit(room.creatorId === user.uid);
      } catch {
        if (active) setCanEdit(false);
      }
    };
    checkPermission();
    return () => { active = false; };
  }, [adminUid, isRoomTabDataActive, roomId, user.uid]);

  const sortedEvents = useMemo(
    () => [...events].sort((left, right) => eventTimestamp(left) - eventTimestamp(right)),
    [events],
  );
  const upcomingEvents = useMemo(
    () => sortedEvents.filter((event) => eventState(event, now) !== 'past'),
    [now, sortedEvents],
  );
  const pastEvents = useMemo(
    () => sortedEvents.filter((event) => eventState(event, now) === 'past').reverse(),
    [now, sortedEvents],
  );
  const visibleUpcomingEvents = useMemo(
    () => selectedDate ? upcomingEvents.filter((event) => event.date === selectedDate) : upcomingEvents,
    [selectedDate, upcomingEvents],
  );
  const selectedCandidate = events.find((event) => event.id === selectedId);
  const selectedEvent = (
    selectedCandidate && (!selectedDate || selectedCandidate.date === selectedDate)
      ? selectedCandidate
      : visibleUpcomingEvents[0] || (!selectedDate ? pastEvents[0] : null)
  ) || null;

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const closeComposer = () => {
    if (pending) return;
    setComposerMode('');
    setEditingEventId('');
    setFormError('');
  };
  const openCreateComposer = () => {
    setFormError('');
    setEditingEventId('');
    setDraft({
      ...createEmptyEventDraft(),
      date: toDateKey(new Date()),
    });
    setComposerMode('create');
  };
  const openEditComposer = (event) => {
    if (!canEdit) return;
    setFormError('');
    setEditingEventId(event.id);
    setDraft(eventDraftFromEvent(event));
    setComposerMode('edit');
  };

  const saveEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    if (pending) return;
    if (!canEdit) {
      window.showToast?.('Only room managers can manage events.');
      return;
    }
    let payload;
    try {
      payload = eventPayloadFromDraft(draft);
    } catch (error) {
      setFormError(error.message || 'Check the event details.');
      return;
    }

    setPending(true);
    setFormError('');
    try {
      const timestamp = Date.now();
      if (composerMode === 'edit' && editingEventId) {
        await update(ref(db, `rooms_meta/${roomId}/events/${editingEventId}`), {
          ...payload,
          updatedAt: timestamp,
          updatedBy: user.uid,
        });
        setSelectedId(editingEventId);
        window.showToast?.('Event updated.', false);
      } else {
        const eventRef = push(ref(db, `rooms_meta/${roomId}/events`));
        await set(eventRef, {
          ...payload,
          by: user.uid,
          byName: displayUserName(user),
          createdAt: timestamp,
        });
        setSelectedId(eventRef.key);
        window.showToast?.('Event added.', false);
      }
      setDraft(createEmptyEventDraft());
      setComposerMode('');
      setEditingEventId('');
    } catch (error) {
      setFormError(error.message || 'Could not save this event. Try again.');
    } finally {
      setPending(false);
    }
  };

  const deleteEvent = async (id, title) => {
    if (!canEdit) {
      window.showToast?.('Only room managers can delete events.');
      return;
    }
    if (!window.confirm(`Delete “${title || 'this event'}”?`)) return;
    try {
      await remove(ref(db, `rooms_meta/${roomId}/events/${id}`));
      setSelectedId((current) => current === id ? null : current);
      window.showToast?.('Event deleted.', false);
    } catch (error) {
      window.showToast?.(error.message || 'Could not delete this event.');
    }
  };

  const updateRsvp = async (eventId, status) => {
    if (!user.uid || pendingRsvpId) return;
    const event = events.find((candidate) => candidate.id === eventId);
    if (!event || eventState(event, Date.now()) === 'past') return;
    setPendingRsvpId(eventId);
    try {
      await set(ref(db, `rooms_meta/${roomId}/events/${eventId}/rsvps/${user.uid}`), {
        name: displayUserName(user),
        status,
        updatedAt: Date.now(),
      });
      window.showToast?.(`RSVP updated: ${status === 'declined' ? 'can’t go' : status}.`, false);
    } catch (error) {
      window.showToast?.(error.message || 'Could not update your RSVP.');
    } finally {
      setPendingRsvpId('');
    }
  };

  const saveReminder = async (event) => {
    if (!user.uid || pendingReminderId) return;
    const dueAt = eventReminderDueAt(event);
    if (!dueAt || dueAt <= Date.now()) {
      window.showToast?.('The reminder time for this event has passed.');
      return;
    }
    setPendingReminderId(event.id);
    try {
      await set(push(ref(db, `user_reminders/${user.uid}`)), {
        createdAt: Date.now(),
        dueAt,
        roomId,
        source: 'chat',
        text: `Event: ${String(event.title || 'Room event').slice(0, 173)}`,
      });
      window.showToast?.(`Reminder saved for ${reminderLabel(event.reminderMinutes).toLowerCase()}.`, false);
    } catch (error) {
      window.showToast?.(error.message || 'Could not save this reminder.');
    } finally {
      setPendingReminderId('');
    }
  };

  return (
    <div className="events-page-scroll events-redesign">
      <header className="events-head">
        <div>
          <span className="events-kicker"><i className="ph-bold ph-calendar-dots" aria-hidden="true" /> Room calendar</span>
          <div className="events-title-line"><h2>Events</h2><span>{upcomingEvents.length} upcoming · {pastEvents.length} past</span></div>
          <p>Plan time together, collect RSVPs, and keep every time zone clear.</p>
        </div>
        {canEdit ? (
          <button type="button" id="ev-page-add-btn" className="rh-add-btn" aria-expanded={Boolean(composerMode)} aria-controls="ev-page-form" onClick={openCreateComposer}>
            <i className="ph-bold ph-plus" aria-hidden="true" /> <span>New event</span>
          </button>
        ) : null}
      </header>

      <DateRail now={now} selectedDate={selectedDate} onSelect={setSelectedDate} />

      <div className="events-workspace">
        <section className="events-agenda" aria-label="Event agenda">
          <header>
            <div><span>{selectedDate ? 'Selected day' : 'Upcoming'}</span><strong>{visibleUpcomingEvents.length} scheduled</strong></div>
            {selectedDate ? <button type="button" onClick={() => setSelectedDate('')}>Clear date</button> : null}
          </header>
          <div className="events-agenda-list" id="events-page-list">
            {eventsLoading || eventsError ? (
              <div className={`rh-muted event-empty ${eventsError ? 'error' : ''}`} role={eventsLoading ? 'status' : 'alert'}>
                <i className={`ph-bold ${eventsError ? 'ph-warning-circle' : 'ph-spinner-gap events-spin'}`} aria-hidden="true" />
                <strong>{eventsLoading ? 'Loading events…' : 'Could not load events.'}</strong>
                <span>{eventsLoading ? 'Checking this room schedule.' : eventsError}</span>
              </div>
            ) : visibleUpcomingEvents.length ? visibleUpcomingEvents.map((event) => (
              <EventRow key={event.id} event={event} state={eventState(event, now)} isSelected={selectedEvent?.id === event.id} onSelect={setSelectedId} />
            )) : (
              <div className="rh-muted event-empty">
                <i className="ph-bold ph-calendar-blank" aria-hidden="true" />
                <strong>{selectedDate ? 'No events on this day.' : 'No events yet.'}</strong>
                <span>{canEdit ? 'Create the first event for this room.' : 'Nothing has been scheduled in this room yet.'}</span>
              </div>
            )}
          </div>

          {pastEvents.length ? (
            <details className="events-past-section">
              <summary><span>Past events</span><strong>{pastEvents.length}</strong><i className="ph-bold ph-caret-down" aria-hidden="true" /></summary>
              <div>{pastEvents.map((event) => <EventRow key={event.id} event={event} state="past" isSelected={selectedEvent?.id === event.id} onSelect={setSelectedId} />)}</div>
            </details>
          ) : null}
        </section>

        <EventDetail
          event={selectedEvent}
          state={selectedEvent ? eventState(selectedEvent, now) : 'upcoming'}
          canEdit={canEdit}
          now={now}
          onDelete={deleteEvent}
          onEdit={openEditComposer}
          onOpenRoomCall={() => window.activateRoomView?.('calls')}
          onRsvp={updateRsvp}
          onSaveReminder={saveReminder}
          pendingReminderId={pendingReminderId}
          pendingRsvpId={pendingRsvpId}
          userId={user.uid}
        />
      </div>

      {composerMode && isRoomTabActive ? (
        <EventComposer
          draft={draft}
          error={formError}
          mode={composerMode}
          onClose={closeComposer}
          onSubmit={saveEvent}
          pending={pending}
          updateDraft={updateDraft}
        />
      ) : null}
    </div>
  );
}

export function Events(props) {
  return <EventsRoom key={props.roomId} {...props} />;
}
