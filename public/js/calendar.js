// js/calendar.js
// Continuous day-strip + agenda view. Shows room events (rooms_meta/{roomId}/events)
// merged with the signed-in user's Google Calendar events (read-only import).
//   window.GCAL_CLIENT_ID       — Google OAuth client id (Calendar API enabled)
//   window.AI_CALENDAR_ENDPOINT — Cloud Function URL that runs the vision extraction
import { db } from './firebase-core.js?v=30';
import { ref, get, push, set, remove, onValue, off } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHtml } from './utils.js?v=30';

const EV_ACCENTS = ['#22d3ee', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#60a5fa'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FULLMON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// A distinct color per month for the little month label on each day card.
const MONTH_COLORS = ['#B5742B', '#9B86C4', '#4FB3A1', '#C8443A', '#6FA84B', '#E0A82E', '#F2766B', '#F47A1F', '#4E6FAF', '#8E6FA0', '#9E2A3B', '#1E7A93'];
// 'calendar.events' grants read + write of events, so app-created events can sync back to Google.
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

let calRoomId = null;
let calRef = null;
let calEvents = {};        // room events from Firebase
let googleEvents = [];     // imported Google Calendar events (read-only)
let gcalToken = null;
let selectedKey = null;
let calCanEdit = false;
let weekStart = null;      // Sunday 00:00 of the week currently shown (7-day page)
let gcalSilentTried = false; // only attempt silent re-auth once per page load
let wired = false;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };

function fmtTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ap = h < 12 ? 'AM' : 'PM';
    return `${((h + 11) % 12) + 1}:${pad(m || 0)} ${ap}`;
}
// End time = start + duration, formatted like fmtTime (wraps past midnight).
function endTimeStr(time, duration) {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const total = (h * 60 + (m || 0) + (parseInt(duration, 10) || 0)) % 1440;
    return fmtTime(`${pad(Math.floor(total / 60))}:${pad(total % 60)}`);
}
function fmtDuration(min) {
    min = parseInt(min, 10);
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    if (h && m) return `${h} hr ${m} min`;
    if (h) return `${h} hr`;
    return `${m} min`;
}
function bucketByDay() {
    const b = {};
    Object.entries(calEvents || {}).forEach(([id, ev]) => {
        if (ev.date) (b[ev.date] = b[ev.date] || []).push({ id, ...ev });
    });
    googleEvents.forEach(ev => {
        if (ev.date) (b[ev.date] = b[ev.date] || []).push(ev);
    });
    return b;
}

/* ---------- DAY STRIP (one week per page) ---------- */
function weekLabel() {
    const end = addDays(weekStart, 6);
    const m1 = weekStart.getMonth(), m2 = end.getMonth();
    const y1 = weekStart.getFullYear(), y2 = end.getFullYear();
    if (m1 === m2) return `${FULLMON[m1]} ${y1}`;
    if (y1 === y2) return `${MON[m1]} – ${MON[m2]} ${y2}`;
    return `${MON[m1]} ${y1} – ${MON[m2]} ${y2}`;
}

function renderDayStrip() {
    const strip = $('cal-daystrip');
    if (!strip) return;
    const byDay = bucketByDay();
    const todayKey = keyOf(new Date());
    let html = '';
    for (let i = 0; i < 7; i++) {        // exactly one week — no infinite scroll
        const d = addDays(weekStart, i);
        const key = keyOf(d);
        const hasEv = (byDay[key] || []).length > 0;
        const isToday = key === todayKey;
        html += `
            <button class="cal-day ${key === selectedKey ? 'active' : ''} ${isToday ? 'is-today' : ''}" data-key="${key}">
                <span class="cal-day-mon" style="--mon-color:${MONTH_COLORS[d.getMonth()]}">${MON[d.getMonth()]}</span>
                <span class="cal-day-dow">${DOW[d.getDay()]}</span>
                <span class="cal-day-num">${d.getDate()}</span>
                <span class="cal-day-dot" style="${hasEv ? '' : 'visibility:hidden;'}"></span>
            </button>`;
    }
    strip.innerHTML = html;
    const label = $('cal-nav-label');
    if (label) label.textContent = weekLabel();
}

// Move the visible week and follow it with the selection so the agenda stays in view.
function goToWeek(ref) {
    weekStart = startOfWeek(ref);
    selectedKey = keyOf(weekStart);
    renderDayStrip();
    renderAgenda();
}
function shiftWeek(weeks) { goToWeek(addDays(weekStart, weeks * 7)); }
function shiftMonth(months) {
    const d = new Date(weekStart); d.setDate(1); d.setMonth(d.getMonth() + months);
    goToWeek(d);
}
function goToday() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    weekStart = startOfWeek(t);
    selectedKey = keyOf(t);
    renderDayStrip();
    renderAgenda();
}

function setSelected(key) {
    selectedKey = key;
    $('cal-daystrip')?.querySelectorAll('.cal-day').forEach(b => b.classList.toggle('active', b.dataset.key === key));
    renderAgenda();
}

/* ---------- AGENDA ---------- */
function renderAgenda() {
    const list = $('cal-agenda');
    if (!list) return;
    const evs = (bucketByDay()[selectedKey] || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    if (!evs.length) {
        list.innerHTML = `<div class="cal-empty">No events for this day.</div>`;
        return;
    }

    list.innerHTML = evs.map((ev, i) => {
        const accent = EV_ACCENTS[i % EV_ACCENTS.length];
        const isG = !!ev._google;
        const parts = [];
        if (ev.time) {
            const start = fmtTime(ev.time);
            const end = (parseInt(ev.duration, 10) || 0) ? endTimeStr(ev.time, ev.duration) : '';
            parts.push(`<i class="ph-bold ph-clock"></i> ${escapeHtml(end ? `${start} - ${end}` : start)}`);
        }
        const dur = fmtDuration(ev.duration);
        if (dur) parts.push(escapeHtml(dur));
        let meta = parts.join('<span class="cal-sep">·</span>');
        if (ev.location) meta += `<span class="cal-loc"><i class="ph-bold ph-map-pin"></i> ${escapeHtml(ev.location)}</span>`;
        const gBadge = isG ? ` <i class="ph-bold ph-google-logo" style="font-size:0.8em; color:#888;" title="From your Google Calendar"></i>` : '';
        return `
            <div class="cal-ev-card" style="--ev-accent:${accent};">
                <div class="cal-ev-body">
                    <div class="cal-ev-title">${escapeHtml(ev.title)}${gBadge}</div>
                    <div class="cal-ev-meta">${meta || '&nbsp;'}</div>
                </div>
                ${(calCanEdit && !isG) ? `<button class="cal-ev-del" data-id="${ev.id}" data-gid="${ev.gId || ''}" title="Delete">&times;</button>` : ''}
            </div>`;
    }).join('');

    list.querySelectorAll('.cal-ev-del').forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.gid) await deleteGoogleEvent(b.dataset.gid); // keep Google in sync
        remove(ref(db, `rooms_meta/${calRoomId}/events/${b.dataset.id}`));
    }));
}

/* ---------- ADD EVENT (inline form) ---------- */
function toggleAddForm(show) {
    let form = $('cal-add-form');
    if (!form) {
        form = document.createElement('div');
        form.id = 'cal-add-form';
        form.className = 'cal-add-form hidden';
        form.innerHTML = `
            <input type="text" id="cal-f-title" placeholder="Event title...">
            <div class="cal-form-row">
                <input type="time" id="cal-f-time">
                <input type="number" id="cal-f-dur" min="0" step="5" placeholder="Duration (min)">
            </div>
            <input type="text" id="cal-f-loc" placeholder="Location (optional)">
            <div class="cal-form-actions">
                <button class="rh-save-btn" id="cal-f-save">Add Event</button>
                <button class="rh-add-btn" id="cal-f-cancel">Cancel</button>
            </div>`;
        $('cal-add-row').before(form);
        form.querySelector('#cal-f-save').addEventListener('click', saveEvent);
        form.querySelector('#cal-f-cancel').addEventListener('click', () => toggleAddForm(false));
    }
    const open = show ?? form.classList.contains('hidden');
    form.classList.toggle('hidden', !open);
    if (open) form.querySelector('#cal-f-title').focus();
}

async function saveEvent() {
    const title = ($('cal-f-title')?.value || '').trim();
    if (!title) return window.showToast('Event needs a title.');
    const ev = {
        title,
        date: selectedKey,
        time: $('cal-f-time')?.value || '',
        duration: parseInt($('cal-f-dur')?.value, 10) || 0,
        location: ($('cal-f-loc')?.value || '').trim(),
        by: window.currentUser.uid
    };
    try {
        await saveAndSync(ev);
        ['cal-f-title', 'cal-f-time', 'cal-f-dur', 'cal-f-loc'].forEach(id => { const el = $(id); if (el) el.value = ''; });
        toggleAddForm(false);
    } catch (e) { window.showToast('Could not add event: ' + e.message); }
}

/* ---------- Google Calendar (owner-only sync) ---------- */
function markConnected() { const b = $('cal-connect-banner'); if (b) b.style.display = 'none'; updateImportBtn(); }
function showBannerAgain() { const b = $('cal-connect-banner'); if (b && calCanEdit) b.style.display = ''; localStorage.removeItem('gcalConnected'); updateImportBtn(); }

// Manual import button: only the room owner, with Google configured + connected, sees it.
function updateImportBtn() {
    const btn = $('cal-import-btn');
    if (btn) btn.classList.toggle('hidden', !(calCanEdit && window.GCAL_CLIENT_ID && localStorage.getItem('gcalConnected')));
}

// thenFetch=false grabs/refreshes a token without pulling events (used for silent re-auth on load,
// so importing stays a deliberate, manual action and schedules don't get merged behind your back).
async function runGoogleAuth(silent, thenFetch = true) {
    if (!window.GCAL_CLIENT_ID) {
        return window.showToast('Google Calendar isn\'t set up yet. Set window.GCAL_CLIENT_ID in config.js.');
    }
    try {
        await loadScript('https://accounts.google.com/gsi/client');
        const tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: window.GCAL_CLIENT_ID,
            scope: GCAL_SCOPE,
            callback: async (resp) => {
                if (resp.error) { if (!silent) window.showToast('Google authorization failed.'); return; }
                gcalToken = resp.access_token;
                localStorage.setItem('gcalConnected', '1');
                markConnected();
                if (thenFetch) await fetchGoogleEvents();
            }
        });
        // silent re-auth on load uses prompt:'' (no popup if already granted)
        tokenClient.requestAccessToken(silent ? { prompt: '' } : {});
    } catch (e) { if (!silent) window.showToast('Google Calendar connect failed: ' + e.message); }
}

// Manually pull events from Google (auth first if needed). Owner-triggered only.
async function importFromGoogle() {
    if (!calCanEdit) return;
    if (!gcalToken) return runGoogleAuth(false, true); // auth, then fetch in the callback
    window.showToast('Importing from Google…', false);
    await fetchGoogleEvents();
}

async function fetchGoogleEvents() {
    if (!gcalToken) return;
    const min = new Date(); min.setMonth(min.getMonth() - 1);
    const max = new Date(); max.setFullYear(max.getFullYear() + 1);
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${min.toISOString()}&timeMax=${max.toISOString()}`;
    try {
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + gcalToken } });
        if (!r.ok) {
            if (r.status === 401) { gcalToken = null; showBannerAgain(); }
            return window.showToast(`Could not load Google Calendar (${r.status}).`);
        }
        const data = await r.json();
        // Skip Google events we created from the app (they already live in Firebase), so nothing double-shows.
        const linked = new Set(Object.values(calEvents || {}).map(e => e.gId).filter(Boolean));
        googleEvents = (data.items || []).map(toLocalEvent).filter(Boolean).filter(ev => !linked.has(ev._gid));
        renderDayStrip();
        renderAgenda();
        window.showToast(`Imported ${googleEvents.length} Google event(s).`, false);
    } catch (e) { window.showToast('Could not load Google Calendar: ' + e.message); }
}

function toLocalEvent(it) {
    const s = it.start || {};
    let date, time = '';
    if (s.dateTime) { const d = new Date(s.dateTime); date = keyOf(d); time = pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    else if (s.date) { date = s.date; }
    else return null;
    let duration = 0;
    if (s.dateTime && it.end && it.end.dateTime) {
        duration = Math.max(0, Math.round((new Date(it.end.dateTime) - new Date(s.dateTime)) / 60000));
    }
    return { title: it.summary || '(no title)', date, time, duration, location: it.location || '', _google: true, _gid: it.id };
}

/* ---------- Write events back to Google (two-way sync) ---------- */
function minutesBetween(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let diff = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
    if (diff < 0) diff += 24 * 60; // event runs past midnight
    return diff;
}

// Create the event on the user's primary Google Calendar. Returns the Google event id, or null.
async function pushEventToGoogle(ev) {
    if (!gcalToken) return null;
    const resource = { summary: ev.title, location: ev.location || '' };
    if (ev.time) {
        const start = new Date(`${ev.date}T${ev.time}:00`);
        const ms = (parseInt(ev.duration, 10) || 60) * 60000; // default 1h if no duration
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        resource.start = { dateTime: start.toISOString(), timeZone: tz };
        resource.end = { dateTime: new Date(start.getTime() + ms).toISOString(), timeZone: tz };
    } else {
        const nd = new Date(`${ev.date}T00:00:00`); nd.setDate(nd.getDate() + 1);
        resource.start = { date: ev.date };
        resource.end = { date: keyOf(nd) }; // all-day events end on the next day
    }
    try {
        const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + gcalToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(resource)
        });
        if (!r.ok) return null;
        return (await r.json()).id || null;
    } catch { return null; }
}

async function deleteGoogleEvent(gId) {
    if (!gcalToken || !gId) return;
    try {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${gId}`, {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + gcalToken }
        });
    } catch {}
}

// Save an event to Firebase and, if connected to Google, mirror it there and store the link.
async function saveAndSync(ev) {
    const node = push(ref(db, `rooms_meta/${calRoomId}/events`));
    await set(node, ev);
    if (gcalToken) {
        const gId = await pushEventToGoogle(ev);
        if (gId) await set(ref(db, `rooms_meta/${calRoomId}/events/${node.key}/gId`), gId);
    }
}

/* ---------- AI: extract events from a photo (setup-gated) ---------- */
async function importFromPhoto(file) {
    if (!window.AI_CALENDAR_ENDPOINT) {
        return window.showToast('AI photo import isn\'t set up yet. Deploy the vision function and set window.AI_CALENDAR_ENDPOINT.');
    }
    window.showToast('Reading calendar from photo…', false);
    try {
        const b64 = await fileToBase64(file);
        const r = await fetch(window.AI_CALENDAR_ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: b64, mimeType: file.type })
        });
        if (!r.ok) throw new Error('Extraction service error');
        const { events } = await r.json();
        if (!events?.length) return window.showToast('No events found in that image.');
        let added = 0;
        for (const e of events) {
            if (!e.title || !e.date) continue;
            // Prefer an explicit end time from the image; fall back to a stated duration.
            const duration = (e.time && e.endTime) ? minutesBetween(e.time, e.endTime) : (parseInt(e.duration, 10) || 0);
            await saveAndSync({
                title: e.title, date: e.date, time: e.time || '', duration, location: e.location || '', by: window.currentUser.uid
            });
            added++;
        }
        const synced = gcalToken ? ' and synced to Google Calendar' : '';
        window.showToast(`Added ${added} event(s) from the photo${synced}.`, false);
    } catch (e) { window.showToast('Photo import failed: ' + e.message); }
}

function loadScript(src) {
    return new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) return res();
        const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
}
function fileToBase64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej; r.readAsDataURL(file);
    });
}

function wireOnce() {
    if (wired) return;
    wired = true;
    $('cal-gcal-btn')?.addEventListener('click', () => runGoogleAuth(false));
    $('cal-import-btn')?.addEventListener('click', importFromGoogle);
    $('cal-add-btn')?.addEventListener('click', () => toggleAddForm());
    $('cal-photo-btn')?.addEventListener('click', () => $('cal-photo-input')?.click());
    $('cal-photo-input')?.addEventListener('change', function () { if (this.files[0]) importFromPhoto(this.files[0]); this.value = ''; });

    // Week / month navigation
    $('cal-prev-week')?.addEventListener('click', () => shiftWeek(-1));
    $('cal-next-week')?.addEventListener('click', () => shiftWeek(1));
    $('cal-prev-month')?.addEventListener('click', () => shiftMonth(-1));
    $('cal-next-month')?.addEventListener('click', () => shiftMonth(1));
    $('cal-today')?.addEventListener('click', goToday);

    // Delegated day selection (survives re-renders)
    $('cal-daystrip')?.addEventListener('click', (e) => {
        const b = e.target.closest('.cal-day');
        if (b) setSelected(b.dataset.key);
    });
}

window.loadRoomCalendar = async function() {
    if (!window.currentUser) return;
    wireOnce();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    selectedKey = keyOf(today);
    weekStart = startOfWeek(today);
    toggleAddForm(false);

    const roomId = window.activeRoomId;
    // Add/delete permission matches the Events page (creator/admin).
    calCanEdit = false;
    if (roomId === 'global') calCanEdit = window.currentUser.uid === window.MY_ADMIN_UID;
    else {
        try {
            const d = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {};
            calCanEdit = d.creatorId === window.currentUser.uid || window.currentUser.uid === window.MY_ADMIN_UID;
        } catch {}
    }
    if (roomId !== window.activeRoomId) return;
    // Only the room owner/admin can add, import photos, or sync Google. Everyone else gets a read-only view.
    $('cal-add-row')?.classList.toggle('hidden', !calCanEdit);
    $('cal-photo-btn')?.classList.toggle('hidden', !calCanEdit);

    const banner = $('cal-connect-banner');
    if (!calCanEdit) {
        if (banner) banner.style.display = 'none'; // members never see the Google connect prompt
    } else if (window.GCAL_CLIENT_ID && localStorage.getItem('gcalConnected')) {
        markConnected();
        // Refresh the token silently so the manual Import button works, but DON'T auto-import —
        // the owner imports on demand so room events and Google events never merge unexpectedly.
        if (!gcalToken && !gcalSilentTried) { gcalSilentTried = true; runGoogleAuth(true, false); }
    } else if (banner) {
        banner.style.display = ''; // owner, not yet connected → show Connect
    }
    updateImportBtn();

    if (calRoomId !== roomId || !calRef) {
        if (calRef) off(calRef);
        calRoomId = roomId;
        calRef = ref(db, `rooms_meta/${roomId}/events`);
        onValue(calRef, (snap) => {
            if (calRoomId !== window.activeRoomId) return;
            calEvents = snap.val() || {};
            renderDayStrip();
            renderAgenda();
        });
    } else {
        renderDayStrip();
        renderAgenda();
    }
};
