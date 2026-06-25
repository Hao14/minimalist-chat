import { useEffect, useMemo, useState } from 'react';
import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';

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

function EventRow({ canEdit, event, isPast, onDelete }) {
  const date = formatShortDate(event);
  return (
    <article className={`rh-event ${isPast ? 'event-past' : ''}`}>
      <div className="rh-event-date">
        <span className="rh-w">{date.weekday}</span>
        <span className="rh-d">{date.day}</span>
        <span className="rh-m">{date.month}</span>
      </div>
      <div className="rh-event-body">
        <div className="rh-event-title-row">
          <div className="rh-event-title">{event.title}</div>
          <span className="rh-event-pill">{isPast ? 'Past' : 'Upcoming'}</span>
        </div>
        <div className="rh-event-desc"><i className="ph-bold ph-clock" /> {formatEvent(event)}</div>
        {event.desc ? <p className="rh-event-notes">{event.desc}</p> : null}
        <div className="rh-event-owner"><i className="ph-bold ph-user-circle" /> {event.byName || 'Room event'}</div>
      </div>
      {canEdit ? <button type="button" className="rh-del" title="Delete event" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event.id)}><i className="ph-bold ph-trash" /></button> : null}
    </article>
  );
}

export function Events({ adminUid, roomId, user }) {
  const [events, setEvents] = useState([]);
  const [openedAt] = useState(() => Date.now());
  const [canEdit, setCanEdit] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', date: '', time: '', desc: '' });

  useEffect(() => onValue(ref(db, `rooms_meta/${roomId}/events`), (snapshot) => {
    const value = snapshot.val() || {};
    setEvents(Object.entries(value).map(([id, event]) => ({ id, ...event })));
  }), [roomId]);

  useEffect(() => {
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
  }, [adminUid, roomId, user.uid]);

  const sortedEvents = useMemo(() => [...events].sort((a, b) => eventTimestamp(a) - eventTimestamp(b)), [events]);
  const now = openedAt;
  const upcomingEvents = useMemo(() => sortedEvents.filter((event) => !eventTimestamp(event) || eventTimestamp(event) >= now), [now, sortedEvents]);
  const pastEvents = useMemo(() => sortedEvents.filter((event) => eventTimestamp(event) && eventTimestamp(event) < now).reverse(), [now, sortedEvents]);
  const nextEvent = upcomingEvents[0];

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const addEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    const title = draft.title.trim();
    if (!title || !draft.date) {
      window.showToast?.('Event needs a title and date.');
      return;
    }
    const eventRef = push(ref(db, `rooms_meta/${roomId}/events`));
    await set(eventRef, {
      title,
      date: draft.date,
      time: draft.time,
      desc: draft.desc.trim(),
      by: user.uid,
      byName: displayUserName(user),
      createdAt: Date.now(),
    });
    setDraft({ title: '', date: '', time: '', desc: '' });
    setFormOpen(false);
    window.showToast?.('Event added.', false);
  };

  const deleteEvent = (id) => remove(ref(db, `rooms_meta/${roomId}/events/${id}`));

  return (
    <div className="events-page-scroll events-redesign">
      <header className="events-head events-hero">
        <div>
          <span className="events-kicker"><i className="ph-bold ph-calendar-dots" /> Room calendar</span>
          <h3>Events</h3>
          <p>Plan meetups, deadlines, launches, reminders, and room rituals without digging through chat.</p>
        </div>
        {canEdit ? <button type="button" id="ev-page-add-btn" className="rh-add-btn" onClick={() => setFormOpen((open) => !open)}><i className={`ph-bold ${formOpen ? 'ph-x' : 'ph-plus'}`} /> {formOpen ? 'Close' : 'New event'}</button> : null}
      </header>

      <section className="events-metrics" aria-label="Event summary">
        <div>
          <span>Upcoming</span>
          <strong>{upcomingEvents.length}</strong>
        </div>
        <div>
          <span>Past</span>
          <strong>{pastEvents.length}</strong>
        </div>
        <div className="events-next-card">
          <span>Next</span>
          <strong>{nextEvent ? nextEvent.title : 'Nothing scheduled'}</strong>
          <small>{nextEvent ? formatEvent(nextEvent) : 'Create an event when the room has plans.'}</small>
        </div>
      </section>

      {formOpen ? (
        <form id="ev-page-form" className="rh-add-form events-compose" onSubmit={addEvent}>
          <div className="events-compose-head">
            <span>New event</span>
            <strong>Schedule something for this room</strong>
          </div>
          <input id="ev-page-title" value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="Event title..." aria-label="Event title" />
          <div className="rh-form-row">
            <input type="date" id="ev-page-date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} aria-label="Event date" />
            <input type="time" id="ev-page-time" value={draft.time} onChange={(event) => updateDraft('time', event.target.value)} aria-label="Event time" />
          </div>
          <input id="ev-page-desc" value={draft.desc} onChange={(event) => updateDraft('desc', event.target.value)} placeholder="Details (optional)" aria-label="Event details" />
          <button type="submit" className="rh-save-btn" id="ev-page-save"><i className="ph-bold ph-calendar-plus" /> Add event</button>
        </form>
      ) : null}

      <section className="events-section">
        <div className="events-section-title">
          <span>Upcoming</span>
          <small>{upcomingEvents.length} scheduled</small>
        </div>
        <div id="events-page-list">
          {upcomingEvents.length ? upcomingEvents.map((event, index) => (
            <EventRow key={event.id} event={event} canEdit={canEdit} isPast={false} onDelete={deleteEvent} index={index} />
          )) : (
            <div className="rh-muted event-empty">
              <i className="ph-bold ph-calendar-blank" />
              <strong>No events yet.</strong>
              <span>{canEdit ? 'Create the first event for this room.' : 'Nothing has been scheduled in this room yet.'}</span>
            </div>
          )}
        </div>
      </section>

      {pastEvents.length ? (
        <section className="events-section events-past-section">
          <div className="events-section-title">
            <span>Past</span>
            <small>{pastEvents.length} archived</small>
          </div>
          {pastEvents.map((event) => (
            <EventRow key={event.id} event={event} canEdit={canEdit} isPast onDelete={deleteEvent} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
