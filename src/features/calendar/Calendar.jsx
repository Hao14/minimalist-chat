import { useEffect, useMemo, useRef, useState } from 'react';
import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import {
  extractCalendarEventsFromGateway,
  extractCalendarEventsFromPhoto,
  getLocalAiConfig,
  getLocalAiStatus,
  getLocalVisionAiConfig,
  localAiStatusMessage,
  shouldUseGatewayAi,
} from '../ai/localAiClient.js';
import { GoogleCalendarLink } from './GoogleCalendarLink.jsx';
import { consumeSelectedCalendarImage } from './calendarPhotoSelection.js';
import {
  addRoomWeekToGoogleCalendar,
  buildGoogleCalendarApiEvent,
  calendarEventTimeZone,
  formatCalendarEventTime,
  googleCalendarWeekResultMessage,
  googleCalendarWeekRoomProperty,
  roomEventsForCalendarWeek,
} from './googleCalendarWeek.js';
import { browserTimeZone, eventForGoogleCalendar } from '../events/eventModel.js';
import { useRoomTabActivity, useRoomTabDataActivity } from '../shell/roomTabActivity.js';
import {
  activateGoogleCalendarSession,
  disconnectGoogleCalendarConnection,
  getGoogleCalendarConnectionState,
  GOOGLE_CALENDAR_CONNECTION_EVENT,
  googleCalendarTokenFor,
  isGoogleCalendarSessionActive,
  revokeGoogleCalendarToken,
  setGoogleCalendarTokenFor,
  setGoogleCalendarConnectionState,
} from './googleCalendarConnectionState.js';
import './calendar.css';

const accents = ['#22d3ee', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#60a5fa'];
const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const fullMon = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthColors = ['#B5742B', '#9B86C4', '#4FB3A1', '#C8443A', '#6FA84B', '#E0A82E', '#F2766B', '#F47A1F', '#4E6FAF', '#8E6FA0', '#9E2A3B', '#1E7A93'];
const gcalScope = 'https://www.googleapis.com/auth/calendar.events';
const photoMaxBase64Chars = 2_160_000;
const photoMaxSide = 1800;
const emptyGoogleEvents = [];

let gcalSilentTried = false;

const pad = (number) => String(number).padStart(2, '0');
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const startOfWeek = (date) => { const next = new Date(date); next.setHours(0, 0, 0, 0); next.setDate(next.getDate() - next.getDay()); return next; };
const makeToday = () => { const today = new Date(); today.setHours(0, 0, 0, 0); return { selectedKey: keyOf(today), weekStart: startOfWeek(today), todayKey: keyOf(today) }; };

function formatDuration(minutes) {
  const value = parseInt(minutes, 10);
  if (!value) return '';
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours && mins) return `${hours} hr ${mins} min`;
  if (hours) return `${hours} hr`;
  return `${mins} min`;
}

function displayUserName(user = {}) {
  const profileName = String(user.displayName || '').trim();
  if (profileName && profileName !== 'Anonymous') return profileName;
  return String(user.email || '').split('@')[0] || 'Room member';
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
    const googleIdentityReady = () => src !== 'https://accounts.google.com/gsi/client' || Boolean(window.google?.accounts?.oauth2);
    if (googleIdentityReady()) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      let settled = false;
      let timeout;
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        callback(value);
      };
      const loaded = finish(resolve);
      const failed = finish(reject);
      existing.addEventListener('load', loaded, { once: true });
      existing.addEventListener('error', () => failed(new Error('Google authorization could not be loaded.')), { once: true });
      timeout = window.setTimeout(() => {
        if (googleIdentityReady()) loaded();
        else failed(new Error('Google authorization did not become ready.'));
      }, 5000);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image file.'));
    };
    image.src = url;
  });
}

function fullDateLabel(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(year, month - 1, day));
}

function canvasBase64(canvas, quality) {
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

function unsupportedMobileImage(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/i.test(name);
}

async function prepareCalendarPhoto(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Choose a screenshot or photo file for calendar import.');
  }
  if (unsupportedMobileImage(file)) {
    throw new Error('This image format is not supported yet. Use a screenshot, JPEG, or PNG.');
  }
  try {
    const source = await loadImage(file);
    let maxSide = photoMaxSide;
    let quality = 0.86;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(1, maxSide / Math.max(source.naturalWidth || source.width, source.naturalHeight || source.height));
      const width = Math.max(1, Math.round((source.naturalWidth || source.width) * scale));
      const height = Math.max(1, Math.round((source.naturalHeight || source.height) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, width, height);
      const image = canvasBase64(canvas, quality);
      if (image.length <= photoMaxBase64Chars) {
        return { image, mimeType: 'image/jpeg' };
      }
      if (attempt === 4) {
        throw new Error('This image is still too large after compression. Crop the schedule area or upload a smaller screenshot.');
      }
      maxSide = Math.max(1200, Math.round(maxSide * 0.84));
      quality = Math.max(0.7, quality - 0.05);
    }
  } catch {
    throw new Error('Could not read this image. Use a screenshot, JPEG, or PNG.');
  }
  throw new Error('Could not prepare this image for calendar import.');
}

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let diff = (endHour * 60 + (endMinute || 0)) - (startHour * 60 + (startMinute || 0));
  if (diff < 0) diff += 1440;
  return diff;
}

function eventFingerprint(event = {}) {
  return [
    String(event.date || '').trim(),
    String(event.time || '').trim(),
    calendarEventTimeZone(event),
    String(event.title || '').trim().toLowerCase().replace(/\s+/g, ' '),
    String(event.location || '').trim().toLowerCase().replace(/\s+/g, ' '),
  ].join('|');
}

function toLocalGoogleEvent(item) {
  const start = item.start || {};
  let date = '';
  let time = '';
  let startAt = 0;
  if (start.dateTime) {
    const parsed = new Date(start.dateTime);
    startAt = parsed.getTime();
    date = keyOf(parsed);
    time = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  } else if (start.date) {
    date = start.date;
  } else return null;
  let duration = 0;
  if (start.dateTime && item.end?.dateTime) duration = Math.max(0, Math.round((new Date(item.end.dateTime) - new Date(start.dateTime)) / 60000));
  return {
    id: `google-${item.id}`,
    title: item.summary || '(no title)',
    date,
    time,
    timeZone: browserTimeZone(),
    duration,
    location: item.location || '',
    _google: true,
    _gid: item.id,
    _startAt: startAt,
  };
}

function CalendarEvent({ canEdit, event, index, onDelete }) {
  const meta = [];
  if (event.time) meta.push(formatCalendarEventTime(event) || event.time);
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
      {!event._google ? (
        <div className="cal-ev-actions">
          <GoogleCalendarLink event={eventForGoogleCalendar(event)} />
          {canEdit ? <button type="button" className="cal-ev-del" title="Delete" aria-label={`Delete ${event.title}`} onClick={() => onDelete(event)}><i className="ph-bold ph-trash" aria-hidden="true" /></button> : null}
        </div>
      ) : null}
    </article>
  );
}

export function Calendar({ adminUid, gcalClientId, localAiConfig, roomId, user }) {
  const tabActive = useRoomTabActivity('calendar');
  const tabDataActive = useRoomTabDataActivity('calendar');
  const connectionUid = String(user.uid || '').trim();
  const [{ selectedKey, todayKey, weekStart }, setPosition] = useState(() => makeToday());
  const [roomEvents, setRoomEvents] = useState([]);
  const [googleEventsState, setGoogleEventsState] = useState(() => ({ events: [], uid: connectionUid }));
  const [canEdit, setCanEdit] = useState(false);
  const [connectionState, setConnectionState] = useState(() => ({
    connected: getGoogleCalendarConnectionState(connectionUid),
    uid: connectionUid,
  }));
  const [disconnectingUid, setDisconnectingUid] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', time: '', duration: '', location: '' });
  const [photoImport, setPhotoImport] = useState({ active: false, progress: 0, label: '' });
  const [scanSourceOpen, setScanSourceOpen] = useState(false);
  const [weekGoogleBusy, setWeekGoogleBusy] = useState(false);
  const [weekGoogleStatus, setWeekGoogleStatus] = useState('');
  const [eventsStatus, setEventsStatus] = useState({ roomId: null, loading: true, error: '' });
  const photoInput = useRef(null);
  const cameraInput = useRef(null);
  const scanActions = useRef(null);
  const scanButton = useRef(null);
  const firstScanSource = useRef(null);
  const weekGoogleToken = useRef({ token: '', uid: connectionUid });
  const aiConfig = useMemo(() => getLocalAiConfig(localAiConfig), [localAiConfig]);
  const visionConfig = useMemo(() => getLocalVisionAiConfig(aiConfig), [aiConfig]);
  const useCalendarGateway = useMemo(() => shouldUseGatewayAi(aiConfig) && Boolean(aiConfig.calendarEndpoint), [aiConfig]);
  const eventsLoading = eventsStatus.roomId !== roomId || eventsStatus.loading;
  const eventsError = eventsStatus.roomId === roomId ? eventsStatus.error : '';
  const googleEvents = googleEventsState.uid === connectionUid ? googleEventsState.events : emptyGoogleEvents;
  const persistedConnectionState = useMemo(() => getGoogleCalendarConnectionState(connectionUid), [connectionUid]);
  const connected = Boolean(gcalClientId && (connectionState.uid === connectionUid ? connectionState.connected : persistedConnectionState));
  const disconnecting = disconnectingUid === connectionUid;
  const setConnected = (value) => setConnectionState({ connected: Boolean(value), uid: connectionUid });
  const setGoogleEvents = (events) => setGoogleEventsState({ events, uid: connectionUid });
  const setDisconnecting = (value) => setDisconnectingUid(value ? connectionUid : '');

  useEffect(() => {
    if (!tabActive) return;
    if (activateGoogleCalendarSession(connectionUid)) gcalSilentTried = false;
  }, [connectionUid, tabActive]);

  useEffect(() => {
    if (weekGoogleToken.current.uid !== connectionUid) {
      weekGoogleToken.current = { token: '', uid: connectionUid };
    }
  }, [connectionUid]);

  useEffect(() => {
    if (!scanSourceOpen) return undefined;

    const closeOnOutsidePress = (event) => {
      if (!scanActions.current?.contains(event.target)) setScanSourceOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setScanSourceOpen(false);
      window.requestAnimationFrame(() => scanButton.current?.focus());
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [scanSourceOpen]);

  useEffect(() => {
    const syncConnectionState = (event) => {
      if (String(event.detail?.uid || '') !== connectionUid) return;
      const nextConnected = event.detail?.connected === true;
      setConnectionState({ connected: nextConnected, uid: connectionUid });
      if (!nextConnected) setGoogleEventsState({ events: [], uid: connectionUid });
    };
    window.addEventListener(GOOGLE_CALENDAR_CONNECTION_EVENT, syncConnectionState);
    return () => window.removeEventListener(GOOGLE_CALENDAR_CONNECTION_EVENT, syncConnectionState);
  }, [connectionUid]);

  useEffect(() => {
    if (!tabDataActive) return undefined;
    return onValue(ref(db, `rooms_meta/${roomId}/events`), (snapshot) => {
      const value = snapshot.val() || {};
      setRoomEvents(Object.entries(value).map(([id, event]) => ({ id, ...event })));
      setEventsStatus({ roomId, loading: false, error: '' });
    }, (error) => {
      setRoomEvents([]);
      setEventsStatus({ roomId, loading: false, error: error.message || 'Could not load events.' });
    });
  }, [roomId, tabDataActive]);

  useEffect(() => {
    if (!tabDataActive) return undefined;
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
    };
    checkPermission();
    return () => { active = false; };
  }, [adminUid, roomId, tabDataActive, user.uid]);

  const linkedGoogleIds = useMemo(() => new Set(roomEvents.map((event) => event.gId).filter(Boolean)), [roomEvents]);
  const buckets = useMemo(() => bucketEvents(roomEvents, googleEvents), [googleEvents, roomEvents]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekRoomEvents = useMemo(() => roomEventsForCalendarWeek(roomEvents, weekStart), [roomEvents, weekStart]);
  const agenda = useMemo(() => [...(buckets[selectedKey] || [])].sort((a, b) => (a.time || '').localeCompare(b.time || '')), [buckets, selectedKey]);
  const selectedDayLabel = fullDateLabel(selectedKey);
  const totalEventCount = roomEvents.length + googleEvents.length;

  const setWeek = (date) => setPosition((current) => ({ ...current, weekStart: startOfWeek(date), selectedKey: keyOf(startOfWeek(date)) }));
  const selectToday = () => setPosition(makeToday());

  const fetchGoogleEvents = async (token = googleCalendarTokenFor(connectionUid)) => {
    if (!token || !isGoogleCalendarSessionActive(connectionUid) || googleCalendarTokenFor(connectionUid) !== token) return;
    const min = new Date();
    min.setMonth(min.getMonth() - 1);
    const max = new Date();
    max.setFullYear(max.getFullYear() + 1);
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${min.toISOString()}&timeMax=${max.toISOString()}`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        if (response.status === 401) {
          if (googleCalendarTokenFor(connectionUid) === token) {
            setGoogleCalendarTokenFor(connectionUid, null);
            setGoogleCalendarConnectionState(connectionUid, false);
            setConnected(false);
            setGoogleEvents([]);
          }
        }
        window.showToast?.(`Could not load Google Calendar (${response.status}).`);
        return;
      }
      const data = await response.json();
      if (!isGoogleCalendarSessionActive(connectionUid) || googleCalendarTokenFor(connectionUid) !== token) return;
      const imported = (data.items || [])
        .filter((item) => item.extendedProperties?.private?.[googleCalendarWeekRoomProperty] !== roomId)
        .map(toLocalGoogleEvent)
        .filter(Boolean)
        .filter((event) => !linkedGoogleIds.has(event._gid));
      setGoogleEvents(imported);
      window.showToast?.(`Imported ${imported.length} Google event(s).`, false);
    } catch (error) {
      if (!isGoogleCalendarSessionActive(connectionUid) || googleCalendarTokenFor(connectionUid) !== token) return;
      window.showToast?.(`Could not load Google Calendar: ${error.message}`);
    }
  };

  const runGoogleAuth = async (silent, thenFetch = true) => {
    if (!gcalClientId) return window.showToast?.("Google Calendar isn't set up yet. Set GCAL_CLIENT_ID in config.js.");
    if (!connectionUid) return window.showToast?.('Sign in before connecting Google Calendar.');
    activateGoogleCalendarSession(connectionUid);
    const authorizationUid = connectionUid;
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      if (!isGoogleCalendarSessionActive(authorizationUid)) return;
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: gcalClientId,
        scope: gcalScope,
        callback: async (response) => {
          if (!isGoogleCalendarSessionActive(authorizationUid)) {
            if (response.access_token) void revokeGoogleCalendarToken(response.access_token);
            return;
          }
          if (response.error) {
            if (!silent) window.showToast?.('Google authorization failed.');
            return;
          }
          const accessToken = String(response.access_token || '').trim();
          if (!accessToken) {
            if (!silent) window.showToast?.('Google authorization did not return an access token.');
            return;
          }
          if (!isGoogleCalendarSessionActive(authorizationUid)) {
            void revokeGoogleCalendarToken(accessToken);
            return;
          }
          setGoogleCalendarTokenFor(authorizationUid, accessToken);
          setGoogleCalendarConnectionState(authorizationUid, true);
          setConnected(true);
          if (thenFetch) await fetchGoogleEvents(accessToken);
        },
      });
      tokenClient.requestAccessToken(silent ? { prompt: '' } : {});
    } catch (error) {
      if (!silent) window.showToast?.(`Google Calendar connect failed: ${error.message}`);
    }
  };

  // Silent OAuth refresh should run once per page session; the auth function closes over fresh state intentionally.
  useEffect(() => {
    if (tabActive && canEdit && connected && gcalClientId && isGoogleCalendarSessionActive(connectionUid) && !googleCalendarTokenFor(connectionUid) && !gcalSilentTried) {
      gcalSilentTried = true;
      runGoogleAuth(true, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, connected, connectionUid, gcalClientId, tabActive]);

  const disconnectGoogleCalendar = async () => {
    if (!connectionUid || disconnecting) return;
    setDisconnecting(true);
    gcalSilentTried = false;
    setConnected(false);
    setGoogleEvents([]);

    const result = await disconnectGoogleCalendarConnection(connectionUid);
    if (result.hadToken && !result.revoked) {
      window.showToast?.('Google Calendar disconnected here, but token revocation could not be confirmed.');
    } else {
      window.showToast?.('Google Calendar disconnected.', false);
    }
    setDisconnecting(false);
  };

  const requestWeekGoogleToken = async () => {
    if (!gcalClientId) throw new Error("Google Calendar isn't set up yet.");
    if (!connectionUid) throw new Error('Sign in before adding this week to Google Calendar.');
    await loadScript('https://accounts.google.com/gsi/client');
    if (!window.google?.accounts?.oauth2) throw new Error('Google authorization did not become ready.');

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: gcalClientId,
        scope: gcalScope,
        callback: (response) => {
          const accessToken = String(response?.access_token || '').trim();
          if (response?.error || !accessToken) {
            rejectOnce(new Error(response?.error_description || 'Google authorization was not completed.'));
            return;
          }
          resolveOnce(accessToken);
        },
        error_callback: (error) => {
          const message = error?.type === 'popup_closed'
            ? 'Google authorization was closed before it finished.'
            : 'Google authorization could not open. Allow pop-ups and try again.';
          rejectOnce(new Error(message));
        },
      });
      tokenClient.requestAccessToken({});
    });
  };

  const addThisWeekToGoogle = async () => {
    if (weekGoogleBusy) return;
    const frozenEvents = weekRoomEvents.map((event) => ({ ...event }));
    if (!frozenEvents.length) {
      const message = 'No room events to add from this week.';
      setWeekGoogleStatus(message);
      window.showToast?.(message);
      return;
    }

    const actionUid = connectionUid;
    const actionRoomId = roomId;
    setWeekGoogleBusy(true);
    setWeekGoogleStatus(`Adding ${frozenEvents.length} event${frozenEvents.length === 1 ? '' : 's'} to Google Calendar…`);

    try {
      let accessToken = googleCalendarTokenFor(actionUid)
        || (weekGoogleToken.current.uid === actionUid ? weekGoogleToken.current.token : '');
      if (!accessToken) {
        accessToken = await requestWeekGoogleToken();
        weekGoogleToken.current = { token: accessToken, uid: actionUid };
      }

      let result;
      try {
        result = await addRoomWeekToGoogleCalendar({ accessToken, events: frozenEvents, roomId: actionRoomId });
      } catch (error) {
        if (error?.status !== 401) throw error;
        if (googleCalendarTokenFor(actionUid) === accessToken) {
          setGoogleCalendarTokenFor(actionUid, null);
          setGoogleCalendarConnectionState(actionUid, false);
          setConnected(false);
          setGoogleEvents([]);
        }
        if (weekGoogleToken.current.token === accessToken) weekGoogleToken.current = { token: '', uid: actionUid };
        accessToken = await requestWeekGoogleToken();
        weekGoogleToken.current = { token: accessToken, uid: actionUid };
        result = await addRoomWeekToGoogleCalendar({ accessToken, events: frozenEvents, roomId: actionRoomId });
      }

      const message = googleCalendarWeekResultMessage(result);
      setWeekGoogleStatus(message);
      window.showToast?.(message, result.failed === 0 ? false : undefined);
    } catch (error) {
      const message = `Could not add this week to Google Calendar: ${error.message}`;
      setWeekGoogleStatus(message);
      window.showToast?.(message);
    } finally {
      setWeekGoogleBusy(false);
    }
  };

  const pushEventToGoogle = async (event) => {
    const accessToken = googleCalendarTokenFor(connectionUid);
    if (!accessToken) return null;
    const resource = buildGoogleCalendarApiEvent(event, { roomId });
    if (!resource) return null;
    try {
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(resource),
      });
      if (googleCalendarTokenFor(connectionUid) !== accessToken) return null;
      if (!response.ok) return null;
      return (await response.json()).id || null;
    } catch {
      return null;
    }
  };

  const saveAndSync = async (event) => {
    const eventRef = push(ref(db, `rooms_meta/${roomId}/events`));
    const eventPayload = {
      ...event,
      by: event.by || user.uid,
      byName: event.byName || displayUserName(user),
      createdAt: event.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await set(eventRef, eventPayload);
    if (googleCalendarTokenFor(connectionUid)) {
      const googleId = await pushEventToGoogle({ ...eventPayload, id: eventRef.key });
      if (googleId) await set(ref(db, `rooms_meta/${roomId}/events/${eventRef.key}/gId`), googleId);
      return Boolean(googleId);
    }
    return false;
  };

  const saveEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!canEdit) return window.showToast?.('Only room managers can add events.');
    const title = draft.title.trim();
    if (!title) return window.showToast?.('Event needs a title.');
    try {
      await saveAndSync({
        title,
        date: selectedKey,
        time: draft.time,
        timeZone: browserTimeZone(),
        duration: parseInt(draft.duration, 10) || 0,
        location: draft.location.trim(),
        by: user.uid,
      });
      setDraft({ title: '', time: '', duration: '', location: '' });
      setAddOpen(false);
    } catch (error) {
      window.showToast?.(`Could not add event: ${error.message}`);
    }
  };

  const deleteGoogleEvent = async (googleId) => {
    const accessToken = googleCalendarTokenFor(connectionUid);
    if (!accessToken || !googleId) return;
    try { await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }); } catch { /* best-effort Google cleanup */ }
  };

  const deleteEvent = async (event) => {
    if (!canEdit) return window.showToast?.('Only room managers can delete events.');
    if (event.gId) await deleteGoogleEvent(event.gId);
    await remove(ref(db, `rooms_meta/${roomId}/events/${event.id}`));
  };

  const importFromPhoto = async (file) => {
    if (!canEdit) return window.showToast?.('Only room managers can import events.');
    if (photoImport.active) return;
    setPhotoImport({ active: true, progress: 10, label: 'Preparing photo…' });
    try {
      setPhotoImport({ active: true, progress: 24, label: 'Optimizing image…' });
      const preparedPhoto = await prepareCalendarPhoto(file);
      const { image, mimeType } = preparedPhoto;
      let data;
      if (useCalendarGateway) {
        setPhotoImport({ active: true, progress: 48, label: 'Checking secure AI gateway…' });
        data = await extractCalendarEventsFromGateway({ image, mimeType, config: localAiConfig });
      } else if (localAiConfig?.provider === 'gateway') {
        throw new Error('Calendar photo import needs AI_CALENDAR_ENDPOINT in public gateway mode.');
      } else {
        setPhotoImport({ active: true, progress: 42, label: 'Checking Ollama vision…' });
        const status = await getLocalAiStatus({ baseUrl: visionConfig.baseUrl, model: visionConfig.model });
        if (status.state !== 'ready') throw new Error(status.message || localAiStatusMessage(status));
        setPhotoImport({ active: true, progress: 58, label: 'Finding events locally…' });
        data = await extractCalendarEventsFromPhoto({ image, mimeType, config: visionConfig });
      }
      setPhotoImport({ active: true, progress: 72, label: 'Checking details…' });
      if (!data.events?.length) return window.showToast?.('No events found in that image.');
      const seen = new Set([...roomEvents, ...googleEvents].map(eventFingerprint));
      let added = 0;
      let skipped = 0;
      let synced = 0;
      for (const event of data.events) {
        if (!event.title || !event.date) continue;
        const duration = event.time && event.endTime ? minutesBetween(event.time, event.endTime) : (parseInt(event.duration, 10) || 0);
        const nextEvent = {
          title: event.title,
          date: event.date,
          time: event.time || '',
          timeZone: calendarEventTimeZone(event),
          duration,
          location: event.location || '',
          by: user.uid,
        };
        const fingerprint = eventFingerprint(nextEvent);
        if (seen.has(fingerprint)) {
          skipped += 1;
          continue;
        }
        seen.add(fingerprint);
        setPhotoImport({ active: true, progress: Math.min(92, 72 + added * 6), label: `Saving event ${added + 1}…` });
        if (await saveAndSync(nextEvent)) synced += 1;
        added += 1;
      }
      if (!added && skipped) return window.showToast?.('Those photo events are already on this calendar.', false);
      setPhotoImport({ active: true, progress: 100, label: 'Import complete' });
      const parts = [`Added ${added} event(s)`];
      if (skipped) parts.push(`skipped ${skipped} duplicate(s)`);
      if (googleCalendarTokenFor(connectionUid)) parts.push(synced ? `synced ${synced} to Google Calendar` : 'Google sync did not confirm');
      window.showToast?.(`${parts.join(' · ')}.`, false);
    } catch (error) {
      window.showToast?.(`Photo import failed: ${error.message}`);
    } finally {
      window.setTimeout(() => {
        setPhotoImport({ active: false, progress: 0, label: '' });
      }, 700);
    }
  };

  const handleSchedulePhotoChange = (event) => {
    const file = consumeSelectedCalendarImage(event.currentTarget);
    setScanSourceOpen(false);
    if (file) void importFromPhoto(file);
  };

  const toggleScanSources = (event) => {
    const opening = !scanSourceOpen;
    setScanSourceOpen(opening);
    if (opening && event.detail === 0) {
      window.requestAnimationFrame(() => firstScanSource.current?.focus());
    }
  };

  return (
    <div className="cal-wrap calendar-redesign">
      <header className="cal-workspace-head">
        <div className="cal-workspace-title">
          <span className="cal-eyebrow"><i className="ph-bold ph-calendar-blank" aria-hidden="true" /> Room schedule</span>
          <div className="cal-title-line">
            <h2>Calendar</h2>
            <span>{totalEventCount} {totalEventCount === 1 ? 'event' : 'events'}</span>
          </div>
          <p>Scan the week, focus a day, and plan time together.</p>
        </div>
        {canEdit ? (
          <div ref={scanActions} className="cal-head-actions" id="cal-add-row">
            <button ref={scanButton} type="button" id="cal-photo-btn" className="cal-photo-btn" title="Scan a schedule from a picture (AI)" aria-label="Scan a schedule from a picture" aria-busy={photoImport.active} aria-expanded={scanSourceOpen} aria-controls="cal-scan-sources" disabled={photoImport.active} onClick={toggleScanSources}><i className="ph-bold ph-camera" aria-hidden="true" /><span>Scan schedule</span><i className={`ph-bold ${scanSourceOpen ? 'ph-caret-up' : 'ph-caret-down'} cal-scan-caret`} aria-hidden="true" /></button>
            <button type="button" id="cal-add-btn" className="cal-add-btn cal-primary-action" aria-expanded={addOpen} aria-controls="cal-add-form" onClick={() => { setScanSourceOpen(false); setAddOpen((open) => !open); }}><i className={`ph-bold ${addOpen ? 'ph-x' : 'ph-plus'}`} aria-hidden="true" /><span>{addOpen ? 'Close form' : 'New event'}</span></button>
            {scanSourceOpen ? (
              <div id="cal-scan-sources" className="cal-scan-sources" role="group" aria-labelledby="cal-scan-sources-label">
                <strong id="cal-scan-sources-label" className="cal-scan-sources-label">Choose a picture source</strong>
                <button ref={firstScanSource} type="button" id="cal-take-photo-btn" className="cal-scan-source" disabled={photoImport.active} onClick={() => cameraInput.current?.click()}>
                  <span className="cal-scan-source-icon"><i className="ph-bold ph-camera" aria-hidden="true" /></span>
                  <span className="cal-scan-source-copy"><strong>Take photo</strong><small>Use the rear camera when available</small></span>
                </button>
                <button type="button" id="cal-import-picture-btn" className="cal-scan-source" disabled={photoImport.active} onClick={() => photoInput.current?.click()}>
                  <span className="cal-scan-source-icon"><i className="ph-bold ph-image" aria-hidden="true" /></span>
                  <span className="cal-scan-source-copy"><strong>Import picture</strong><small>Choose a saved image from this device</small></span>
                </button>
                <span className="cal-scan-sources-hint">JPG, PNG, or a screenshot works best.</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="cal-nav">
        <button type="button" className="cal-nav-btn" title="Previous month" aria-label="Previous month" onClick={() => { const date = new Date(weekStart); date.setDate(1); date.setMonth(date.getMonth() - 1); setWeek(date); }}><i className="ph-bold ph-caret-double-left" /></button>
        <button type="button" className="cal-nav-btn" title="Previous week" aria-label="Previous week" onClick={() => setWeek(addDays(weekStart, -7))}><i className="ph-bold ph-caret-left" /></button>
        <div className="cal-nav-label" id="cal-nav-label">{weekLabel(weekStart)}</div>
        <button type="button" className="cal-nav-btn" title="Next week" aria-label="Next week" onClick={() => setWeek(addDays(weekStart, 7))}><i className="ph-bold ph-caret-right" /></button>
        <button type="button" className="cal-nav-btn" title="Next month" aria-label="Next month" onClick={() => { const date = new Date(weekStart); date.setDate(1); date.setMonth(date.getMonth() + 1); setWeek(date); }}><i className="ph-bold ph-caret-double-right" /></button>
        <div className="cal-nav-actions">
          <button type="button" className="cal-nav-btn cal-today-btn" title="Jump to today" onClick={selectToday}>Today</button>
          <button
            type="button"
            id="cal-add-week-google-btn"
            className="cal-nav-btn cal-week-google-btn"
            title={weekRoomEvents.length ? `Add ${weekRoomEvents.length} room event${weekRoomEvents.length === 1 ? '' : 's'} from this week to Google Calendar` : 'No room events to add from this week'}
            aria-busy={weekGoogleBusy}
            disabled={eventsLoading || weekGoogleBusy || weekRoomEvents.length === 0}
            onClick={addThisWeekToGoogle}
          >
            <i className={`ph-bold ${weekGoogleBusy ? 'ph-circle-notch cal-week-google-spinner' : 'ph-google-logo'}`} aria-hidden="true" />
            <span>{weekGoogleBusy ? 'Adding week…' : 'Add this week to Google'}</span>
          </button>
          <span className="cal-week-google-status" role="status" aria-live="polite">{weekGoogleStatus}</span>
        </div>
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
      </div>

      {photoImport.active ? (
        <div className="cal-import-progress" role="status" aria-live="polite" aria-label={photoImport.label}>
          <div className="cal-import-spinner" />
          <div className="cal-import-copy">
            <strong>{photoImport.label}</strong>
            <span>{useCalendarGateway ? 'Secure AI calendar import' : 'Local Ollama vision import'}</span>
          </div>
          <div className="cal-import-track">
            <span style={{ width: `${Math.max(8, Math.min(100, photoImport.progress))}%` }} />
          </div>
        </div>
      ) : null}

      {gcalClientId && connected ? (
        <div className="cal-connect-banner" id="cal-connect-banner" role="status" aria-live="polite">
          <div className="cal-connect-left"><i className="ph-bold ph-google-logo" /><span>Google Calendar is connected for this Minimalist account.</span></div>
          <div className="cal-connect-actions">
            <button type="button" id="cal-import-btn" className="cal-connect-link cal-connect-primary" onClick={() => (googleCalendarTokenFor(connectionUid) ? fetchGoogleEvents() : runGoogleAuth(false, true))}><i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /> Import events</button>
            <button type="button" id="cal-gcal-disconnect-btn" className="cal-connect-link" disabled={disconnecting} aria-busy={disconnecting} onClick={disconnectGoogleCalendar}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
          </div>
        </div>
      ) : canEdit && gcalClientId ? (
        <div className="cal-connect-banner" id="cal-connect-banner">
          <div className="cal-connect-left"><i className="ph-bold ph-warning-circle" /><span>Connect Google Calendar to sync your real events.</span></div>
          <button type="button" id="cal-gcal-btn" className="cal-connect-link" onClick={() => runGoogleAuth(false)}>Connect</button>
        </div>
      ) : null}

      <section className="cal-agenda-panel" aria-labelledby="cal-agenda-title">
        <header className="cal-agenda-head">
          <div>
            <span>Selected day</span>
            <strong id="cal-agenda-title">{selectedDayLabel}</strong>
          </div>
          <span className="cal-agenda-count">{agenda.length} scheduled</span>
        </header>

        {canEdit && addOpen ? (
          <form className="cal-add-form" id="cal-add-form" onSubmit={saveEvent}>
            <div className="cal-form-heading">
              <div>
                <strong>New event</strong>
                <span>Add it to {selectedDayLabel}.</span>
              </div>
              <i className="ph-bold ph-calendar-plus" aria-hidden="true" />
            </div>
            <label className="cal-field cal-field-wide" htmlFor="cal-f-title">
              <span>Event name</span>
              <input id="cal-f-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="What is happening?" required autoFocus />
            </label>
            <div className="cal-form-row">
              <label className="cal-field" htmlFor="cal-f-time">
                <span>Start time</span>
                <input type="time" id="cal-f-time" value={draft.time} onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))} />
              </label>
              <label className="cal-field" htmlFor="cal-f-dur">
                <span>Duration</span>
                <input type="number" id="cal-f-dur" min="0" step="5" value={draft.duration} onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value }))} placeholder="Minutes" />
              </label>
            </div>
            <label className="cal-field cal-field-wide" htmlFor="cal-f-loc">
              <span>Location</span>
              <input id="cal-f-loc" value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Optional" />
            </label>
            <div className="cal-form-actions">
              <button type="submit" className="rh-save-btn cal-form-save" id="cal-f-save"><i className="ph-bold ph-plus" aria-hidden="true" /> Add event</button>
              <button type="button" className="rh-add-btn cal-form-cancel" id="cal-f-cancel" onClick={() => setAddOpen(false)}>Cancel</button>
            </div>
          </form>
        ) : null}

        <div className="cal-agenda" id="cal-agenda">
          {eventsLoading || eventsError ? (
            <div className={`cal-empty ${eventsError ? 'error' : ''}`} role={eventsLoading ? 'status' : 'alert'}>
              <span className="cal-empty-icon"><i className={`ph-bold ${eventsError ? 'ph-warning' : 'ph-circle-notch'}`} aria-hidden="true" /></span>
              <strong>{eventsLoading ? 'Loading calendar' : 'Calendar unavailable'}</strong>
              <span>{eventsLoading ? 'Getting this room’s latest schedule.' : eventsError}</span>
            </div>
          ) : agenda.length ? agenda.map((event, index) => <CalendarEvent key={event.id} event={event} index={index} canEdit={canEdit} onDelete={deleteEvent} />) : (
            <div className="cal-empty">
              <span className="cal-empty-icon"><i className="ph-bold ph-calendar-blank" aria-hidden="true" /></span>
              <strong>No events this day</strong>
              <span>{canEdit ? 'Choose another date or add something new.' : 'Choose another date to keep looking.'}</span>
            </div>
          )}
        </div>
      </section>
      <input ref={cameraInput} type="file" id="cal-camera-input" accept="image/*" capture="environment" className="hidden" onChange={handleSchedulePhotoChange} />
      <input ref={photoInput} type="file" id="cal-photo-input" accept="image/*" className="hidden" onChange={handleSchedulePhotoChange} />
    </div>
  );
}
