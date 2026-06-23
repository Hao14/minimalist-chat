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

function EventRow({ canEdit, event, isPast, onDelete }) {
  const date = event.date ? new Date(`${event.date}T00:00:00`) : null;
  return (
    <article className={`rh-event ${isPast ? 'event-past' : ''}`}>
      <div className="rh-event-date">
        <span className="rh-d">{date ? date.getDate() : '?'}</span>
        <span className="rh-m">{date ? date.toLocaleDateString('en-US', { month: 'short' }) : ''}</span>
      </div>
      <div className="rh-event-body">
        <div className="rh-event-title">{event.title}</div>
        <div className="rh-event-desc">{formatEvent(event)}{event.desc ? ` — ${event.desc}` : ''}</div>
      </div>
      {canEdit ? <button type="button" className="rh-del" title="Delete event" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event.id)}>&times;</button> : null}
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

  const sortedEvents = useMemo(() => [...events].sort((a, b) => {
    const aTime = new Date(`${a.date || ''}T${a.time || '00:00'}`).getTime() || 0;
    const bTime = new Date(`${b.date || ''}T${b.time || '00:00'}`).getTime() || 0;
    return aTime - bTime;
  }), [events]);

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const addEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    const title = draft.title.trim();
    if (!title || !draft.date) {
      window.showToast?.('Event needs a title and date.');
      return;
    }
    const eventRef = push(ref(db, `rooms_meta/${roomId}/events`));
    await set(eventRef, { title, date: draft.date, time: draft.time, desc: draft.desc.trim(), by: user.uid });
    setDraft({ title: '', date: '', time: '', desc: '' });
    setFormOpen(false);
  };

  const deleteEvent = (id) => remove(ref(db, `rooms_meta/${roomId}/events/${id}`));

  return (
    <div className="events-page-scroll">
      <div className="events-head">
        <h3><i className="ph-bold ph-calendar-dots" /> Events</h3>
        {canEdit ? <button type="button" id="ev-page-add-btn" className="rh-add-btn" onClick={() => setFormOpen((open) => !open)}><i className="ph-bold ph-plus" /> New event</button> : null}
      </div>
      {formOpen ? (
        <form id="ev-page-form" className="rh-add-form" onSubmit={addEvent}>
          <input id="ev-page-title" value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="Event title..." aria-label="Event title" />
          <div className="rh-form-row">
            <input type="date" id="ev-page-date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} aria-label="Event date" />
            <input type="time" id="ev-page-time" value={draft.time} onChange={(event) => updateDraft('time', event.target.value)} aria-label="Event time" />
          </div>
          <input id="ev-page-desc" value={draft.desc} onChange={(event) => updateDraft('desc', event.target.value)} placeholder="Details (optional)" aria-label="Event details" />
          <button type="submit" className="rh-save-btn" id="ev-page-save">Add Event</button>
        </form>
      ) : null}
      <div id="events-page-list">
        {sortedEvents.length ? sortedEvents.map((event) => {
          const timestamp = new Date(`${event.date || ''}T${event.time || '00:00'}`).getTime() || 0;
          return <EventRow key={event.id} event={event} canEdit={canEdit} isPast={Boolean(timestamp && timestamp < openedAt)} onDelete={deleteEvent} />;
        }) : <div className="rh-muted event-empty">No events yet.</div>}
      </div>
    </div>
  );
}
