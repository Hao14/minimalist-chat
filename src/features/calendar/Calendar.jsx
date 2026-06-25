import { useEffect, useMemo, useRef, useState } from 'react';
import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { getRequiredIdToken } from '../../lib/authToken.js';

const accents = ['#22d3ee', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#60a5fa'];
const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const fullMon = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthColors = ['#B5742B', '#9B86C4', '#4FB3A1', '#C8443A', '#6FA84B', '#E0A82E', '#F2766B', '#F47A1F', '#4E6FAF', '#8E6FA0', '#9E2A3B', '#1E7A93'];
const gcalScope = 'https://www.googleapis.com/auth/calendar.events';

let gcalToken = null;
let gcalSilentTried = false;

const pad = (number) => String(number).padStart(2, '0');
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const startOfWeek = (date) => { const next = new Date(date); next.setHours(0, 0, 0, 0); next.setDate(next.getDate() - next.getDay()); return next; };
const makeToday = () => { const today = new Date(); today.setHours(0, 0, 0, 0); return { selectedKey: keyOf(today), weekStart: startOfWeek(today), todayKey: keyOf(today) }; };

function formatTime(time) {
  if (!time) return '';
  const [hour, minute] = time.split(':').map(Number);
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${((hour + 11) % 12) + 1}:${pad(minute || 0)} ${ampm}`;
}

function endTime(time, duration) {
  if (!time) return '';
  const [hour, minute] = time.split(':').map(Number);
  const total = (hour * 60 + (minute || 0) + (parseInt(duration, 10) || 0)) % 1440;
  return formatTime(`${pad(Math.floor(total / 60))}:${pad(total % 60)}`);
}

function formatDuration(minutes) {
  const value = parseInt(minutes, 10);
  if (!value) return '';
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours && mins) return `${hours} hr ${mins} min`;
  if (hours) return `${hours} hr`;
  return `${mins} min`;
}

function weekLabel(weekStart) {
  const end = addDays(weekStart, 6);
  if (weekStart.getMonth() === end.getMonth()) return `${fullMon[weekStart.getMonth()]} ${weekStart.getFullYear()}`;
  if (weekStart.getFullYear() === end.getFullYear()) return `${mon[weekStart.getMonth()]} – ${mon[end.getMonth()]} ${end.getFullYear()}`;
  return `${mon[weekStart.getMonth()]} ${weekStart.getFullYear()} – ${mon[end.getMonth()]} ${end.getFullYear()}`;
}

function bucketEvents(roomEvents, googleEvents) {
  const buckets = {};
  roomEvents.forEach((event) => { if (event.date) (buckets[event.date] = buckets[event.date] || []).push(event); });
  googleEvents.forEach((event) => { if (event.date) (buckets[event.date] = buckets[event.date] || []).push(event); });
  return buckets;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let diff = (endHour * 60 + (endMinute || 0)) - (startHour * 60 + (startMinute || 0));
  if (diff < 0) diff += 1440;
  return diff;
}

function toLocalGoogleEvent(item) {
  const start = item.start || {};
  let date = '';
  let time = '';
  if (start.dateTime) {
    const parsed = new Date(start.dateTime);
    date = keyOf(parsed);
    time = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  } else if (start.date) {
    date = start.date;
  } else return null;
  let duration = 0;
  if (start.dateTime && item.end?.dateTime) duration = Math.max(0, Math.round((new Date(item.end.dateTime) - new Date(start.dateTime)) / 60000));
  return { id: `google-${item.id}`, title: item.summary || '(no title)', date, time, duration, location: item.location || '', _google: true, _gid: item.id };
}

function CalendarEvent({ canEdit, event, index, onDelete }) {
  const end = event.duration ? endTime(event.time, event.duration) : '';
  const meta = [];
  if (event.time) meta.push(end ? `${formatTime(event.time)} - ${end}` : formatTime(event.time));
  const duration = formatDuration(event.duration);
  if (duration) meta.push(duration);

  return (
    <article className="cal-ev-card" style={{ '--ev-accent': accents[index % accents.length] }}>
      <div className="cal-ev-body">
        <div className="cal-ev-title">{event.title}{event._google ? <i className="ph-bold ph-google-logo cal-google-badge" title="From your Google Calendar" /> : null}</div>
        <div className="cal-ev-meta">
          {meta.length ? meta.map((part, partIndex) => <span key={part}>{partIndex ? <span className="cal-sep">·</span> : null}{part}</span>) : <span>&nbsp;</span>}
          {event.location ? <span className="cal-loc"><i className="ph-bold ph-map-pin" /> {event.location}</span> : null}
        </div>
      </div>
      {canEdit && !event._google ? <button type="button" className="cal-ev-del" title="Delete" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event)}>&times;</button> : null}
    </article>
  );
}

export function Calendar({ adminUid, aiCalendarEndpoint, gcalClientId, roomId, user }) {
  const [{ selectedKey, todayKey, weekStart }, setPosition] = useState(() => makeToday());
  const [roomEvents, setRoomEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [connected, setConnected] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', time: '', duration: '', location: '' });
  const [photoImport, setPhotoImport] = useState({ active: false, progress: 0, label: '' });
  const photoInput = useRef(null);

  useEffect(() => onValue(ref(db, `rooms_meta/${roomId}/events`), (snapshot) => {
    const value = snapshot.val() || {};
    setRoomEvents(Object.entries(value).map(([id, event]) => ({ id, ...event })));
  }), [roomId]);

  useEffect(() => {
    let active = true;
    const checkPermission = async () => {
      let editable = user.uid === adminUid;
      if (!editable && roomId !== 'global') {
        try {
          const room = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {};
          editable = room.creatorId === user.uid;
        } catch {
          editable = false;
        }
      }
      await Promise.resolve();
      if (!active) return;
      setCanEdit(editable);
      setConnected(Boolean(gcalClientId && localStorage.getItem('gcalConnected')));
    };
    checkPermission();
    return () => { active = false; };
  }, [adminUid, gcalClientId, roomId, user.uid]);

  const linkedGoogleIds = useMemo(() => new Set(roomEvents.map((event) => event.gId).filter(Boolean)), [roomEvents]);
  const buckets = useMemo(() => bucketEvents(roomEvents, googleEvents), [googleEvents, roomEvents]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const agenda = useMemo(() => [...(buckets[selectedKey] || [])].sort((a, b) => (a.time || '').localeCompare(b.time || '')), [buckets, selectedKey]);

  const setWeek = (date) => setPosition((current) => ({ ...current, weekStart: startOfWeek(date), selectedKey: keyOf(startOfWeek(date)) }));
  const selectToday = () => setPosition(makeToday());

  const fetchGoogleEvents = async (token = gcalToken) => {
    if (!token) return;
    const min = new Date();
    min.setMonth(min.getMonth() - 1);
    const max = new Date();
    max.setFullYear(max.getFullYear() + 1);
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${min.toISOString()}&timeMax=${max.toISOString()}`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        if (response.status === 401) {
          gcalToken = null;
          localStorage.removeItem('gcalConnected');
          setConnected(false);
        }
        window.showToast?.(`Could not load Google Calendar (${response.status}).`);
        return;
      }
      const data = await response.json();
      const imported = (data.items || []).map(toLocalGoogleEvent).filter(Boolean).filter((event) => !linkedGoogleIds.has(event._gid));
      setGoogleEvents(imported);
      window.showToast?.(`Imported ${imported.length} Google event(s).`, false);
    } catch (error) {
      window.showToast?.(`Could not load Google Calendar: ${error.message}`);
    }
  };

  const runGoogleAuth = async (silent, thenFetch = true) => {
    if (!gcalClientId) return window.showToast?.("Google Calendar isn't set up yet. Set GCAL_CLIENT_ID in config.js.");
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: gcalClientId,
        scope: gcalScope,
        callback: async (response) => {
          if (response.error) {
            if (!silent) window.showToast?.('Google authorization failed.');
            return;
          }
          gcalToken = response.access_token;
          localStorage.setItem('gcalConnected', '1');
          setConnected(true);
          if (thenFetch) await fetchGoogleEvents(response.access_token);
        },
      });
      tokenClient.requestAccessToken(silent ? { prompt: '' } : {});
    } catch (error) {
      if (!silent) window.showToast?.(`Google Calendar connect failed: ${error.message}`);
    }
  };

  // Silent OAuth refresh should run once per page session; the auth function closes over fresh state intentionally.
  useEffect(() => {
    if (canEdit && connected && gcalClientId && !gcalToken && !gcalSilentTried) {
      gcalSilentTried = true;
      runGoogleAuth(true, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, connected, gcalClientId]);

  const pushEventToGoogle = async (event) => {
    if (!gcalToken) return null;
    const resource = { summary: event.title, location: event.location || '' };
    if (event.time) {
      const start = new Date(`${event.date}T${event.time}:00`);
      const durationMs = (parseInt(event.duration, 10) || 60) * 60000;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      resource.start = { dateTime: start.toISOString(), timeZone };
      resource.end = { dateTime: new Date(start.getTime() + durationMs).toISOString(), timeZone };
    } else {
      const nextDay = new Date(`${event.date}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      resource.start = { date: event.date };
      resource.end = { date: keyOf(nextDay) };
    }
    try {
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gcalToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(resource),
      });
      if (!response.ok) return null;
      return (await response.json()).id || null;
    } catch {
      return null;
    }
  };

  const saveAndSync = async (event) => {
    const eventRef = push(ref(db, `rooms_meta/${roomId}/events`));
    await set(eventRef, event);
    if (gcalToken) {
      const googleId = await pushEventToGoogle(event);
      if (googleId) await set(ref(db, `rooms_meta/${roomId}/events/${eventRef.key}/gId`), googleId);
    }
  };

  const saveEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    const title = draft.title.trim();
    if (!title) return window.showToast?.('Event needs a title.');
    try {
      await saveAndSync({ title, date: selectedKey, time: draft.time, duration: parseInt(draft.duration, 10) || 0, location: draft.location.trim(), by: user.uid });
      setDraft({ title: '', time: '', duration: '', location: '' });
      setAddOpen(false);
    } catch (error) {
      window.showToast?.(`Could not add event: ${error.message}`);
    }
  };

  const deleteGoogleEvent = async (googleId) => {
    if (!gcalToken || !googleId) return;
    try { await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${gcalToken}` } }); } catch { /* best-effort Google cleanup */ }
  };

  const deleteEvent = async (event) => {
    if (event.gId) await deleteGoogleEvent(event.gId);
    await remove(ref(db, `rooms_meta/${roomId}/events/${event.id}`));
  };

  const importFromPhoto = async (file) => {
    if (!aiCalendarEndpoint) return window.showToast?.("AI photo import isn't set up yet. Deploy the vision function and set AI_CALENDAR_ENDPOINT.");
    if (photoImport.active) return;
    setPhotoImport({ active: true, progress: 10, label: 'Preparing photo…' });
    try {
      setPhotoImport({ active: true, progress: 24, label: 'Reading image…' });
      const image = await fileToBase64(file);
      setPhotoImport({ active: true, progress: 46, label: 'Finding events…' });
      const token = await getRequiredIdToken('Please sign in again before importing a calendar photo.');
      const response = await fetch(aiCalendarEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image, mimeType: file.type }),
      });
      if (!response.ok) throw new Error('Extraction service error');
      setPhotoImport({ active: true, progress: 72, label: 'Checking details…' });
      const data = await response.json();
      if (!data.events?.length) return window.showToast?.('No events found in that image.');
      let added = 0;
      for (const event of data.events) {
        if (!event.title || !event.date) continue;
        setPhotoImport({ active: true, progress: Math.min(92, 72 + added * 6), label: `Saving event ${added + 1}…` });
        const duration = event.time && event.endTime ? minutesBetween(event.time, event.endTime) : (parseInt(event.duration, 10) || 0);
        await saveAndSync({ title: event.title, date: event.date, time: event.time || '', duration, location: event.location || '', by: user.uid });
        added += 1;
      }
      setPhotoImport({ active: true, progress: 100, label: 'Import complete' });
      window.showToast?.(`Added ${added} event(s) from the photo${gcalToken ? ' and synced to Google Calendar' : ''}.`, false);
    } catch (error) {
      window.showToast?.(`Photo import failed: ${error.message}`);
    } finally {
      window.setTimeout(() => {
        setPhotoImport({ active: false, progress: 0, label: '' });
      }, 700);
    }
  };

  return (
    <div className="cal-wrap">
      <div className="cal-nav">
        <button type="button" className="cal-nav-btn" title="Previous month" onClick={() => { const date = new Date(weekStart); date.setDate(1); date.setMonth(date.getMonth() - 1); setWeek(date); }}><i className="ph-bold ph-caret-double-left" /></button>
        <button type="button" className="cal-nav-btn" title="Previous week" onClick={() => setWeek(addDays(weekStart, -7))}><i className="ph-bold ph-caret-left" /></button>
        <div className="cal-nav-label" id="cal-nav-label">{weekLabel(weekStart)}</div>
        <button type="button" className="cal-nav-btn" title="Next week" onClick={() => setWeek(addDays(weekStart, 7))}><i className="ph-bold ph-caret-right" /></button>
        <button type="button" className="cal-nav-btn" title="Next month" onClick={() => { const date = new Date(weekStart); date.setDate(1); date.setMonth(date.getMonth() + 1); setWeek(date); }}><i className="ph-bold ph-caret-double-right" /></button>
        <button type="button" className="cal-nav-btn cal-today-btn" title="Jump to today" onClick={selectToday}>Today</button>
      </div>
      <div className="cal-top">
        <div className="cal-daystrip" id="cal-daystrip">
          {weekDays.map((day) => {
            const key = keyOf(day);
            const hasEvents = Boolean(buckets[key]?.length);
            return (
              <button key={key} type="button" className={`cal-day ${key === selectedKey ? 'active' : ''} ${key === todayKey ? 'is-today' : ''}`} onClick={() => setPosition((current) => ({ ...current, selectedKey: key }))}>
                <span className="cal-day-mon" style={{ '--mon-color': monthColors[day.getMonth()] }}>{mon[day.getMonth()]}</span>
                <span className="cal-day-dow">{dow[day.getDay()]}</span>
                <span className="cal-day-num">{day.getDate()}</span>
                <span className="cal-day-dot" style={{ visibility: hasEvents ? 'visible' : 'hidden' }} />
              </button>
            );
          })}
        </div>
        {canEdit ? <button type="button" id="cal-photo-btn" className="cal-photo-btn" title="Import events from a photo (AI)" aria-busy={photoImport.active} disabled={photoImport.active} onClick={() => photoInput.current?.click()}><i className="ph-bold ph-camera" /></button> : null}
      </div>

      {photoImport.active ? (
        <div className="cal-import-progress" role="status" aria-live="polite" aria-label={photoImport.label}>
          <div className="cal-import-spinner" />
          <div className="cal-import-copy">
            <strong>{photoImport.label}</strong>
            <span>Calendar photo import</span>
          </div>
          <div className="cal-import-track">
            <span style={{ width: `${Math.max(8, Math.min(100, photoImport.progress))}%` }} />
          </div>
        </div>
      ) : null}

      {canEdit && gcalClientId && !connected ? (
        <div className="cal-connect-banner" id="cal-connect-banner">
          <div className="cal-connect-left"><i className="ph-bold ph-warning-circle" /><span>Connect Google Calendar to sync your real events.</span></div>
          <button type="button" id="cal-gcal-btn" className="cal-connect-link" onClick={() => runGoogleAuth(false)}>Connect</button>
        </div>
      ) : null}

      <div className="cal-agenda" id="cal-agenda">
        {agenda.length ? agenda.map((event, index) => <CalendarEvent key={event.id} event={event} index={index} canEdit={canEdit} onDelete={deleteEvent} />) : <div className="cal-empty">No events for this day.</div>}
      </div>

      {canEdit && addOpen ? (
        <form className="cal-add-form" id="cal-add-form" onSubmit={saveEvent}>
          <input id="cal-f-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Event title..." />
          <div className="cal-form-row">
            <input type="time" id="cal-f-time" value={draft.time} onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))} />
            <input type="number" id="cal-f-dur" min="0" step="5" value={draft.duration} onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value }))} placeholder="Duration (min)" />
          </div>
          <input id="cal-f-loc" value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Location (optional)" />
          <div className="cal-form-actions">
            <button type="submit" className="rh-save-btn" id="cal-f-save">Add Event</button>
            <button type="button" className="rh-add-btn" id="cal-f-cancel" onClick={() => setAddOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {canEdit ? (
        <div className="cal-add-row" id="cal-add-row">
          <button type="button" id="cal-add-btn" className="cal-add-btn" onClick={() => setAddOpen((open) => !open)}><i className="ph-bold ph-plus" /> Add New Event</button>
          {gcalClientId && connected ? <button type="button" id="cal-import-btn" className="cal-add-btn" onClick={() => (gcalToken ? fetchGoogleEvents() : runGoogleAuth(false, true))}><i className="ph-bold ph-arrows-clockwise" /> Import from Google</button> : null}
        </div>
      ) : null}
      <input ref={photoInput} type="file" id="cal-photo-input" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFromPhoto(file); event.target.value = ''; }} />
    </div>
  );
}
