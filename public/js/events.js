// js/events.js
// Full Events page. Shares data with the room Home + Calendar: rooms_meta/{roomId}/events.
import { db } from './firebase-core.js?v=19';
import { ref, get, push, set, remove, onValue, off } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHtml } from './utils.js?v=19';

let evRoomId = null;
let evRef = null;
let evCanEdit = false;
let wired = false;

function fmtFull(ev) {
    if (!ev.date) return '';
    const d = new Date(ev.date + 'T' + (ev.time || '00:00'));
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    let s = d.toLocaleDateString('en-US', opts);
    if (ev.time) s += ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return s;
}

function render(data) {
    const list = document.getElementById('events-page-list');
    if (!list) return;
    const now = Date.now();
    const entries = Object.entries(data || {})
        .map(([id, ev]) => [id, ev, new Date((ev.date || '') + 'T' + (ev.time || '00:00')).getTime() || 0])
        .sort((a, b) => a[2] - b[2]);

    if (!entries.length) { list.innerHTML = `<div class="rh-muted" style="padding:1rem;">No events yet.</div>`; return; }

    list.innerHTML = entries.map(([id, ev, ts]) => {
        const past = ts && ts < now;
        const d = ev.date ? new Date(ev.date + 'T00:00:00') : null;
        return `
            <div class="rh-event" style="${past ? 'opacity:0.55;' : ''}">
                <div class="rh-event-date">
                    <span class="rh-d">${d ? d.getDate() : '?'}</span>
                    <span class="rh-m">${d ? d.toLocaleDateString('en-US', { month: 'short' }) : ''}</span>
                </div>
                <div class="rh-event-body">
                    <div class="rh-event-title">${escapeHtml(ev.title)}</div>
                    <div class="rh-event-desc">${escapeHtml(fmtFull(ev))}${ev.desc ? ' — ' + escapeHtml(ev.desc) : ''}</div>
                </div>
                ${evCanEdit ? `<button class="rh-del" data-id="${id}" title="Delete">&times;</button>` : ''}
            </div>`;
    }).join('');

    list.querySelectorAll('.rh-del').forEach(b => b.addEventListener('click', () =>
        remove(ref(db, `rooms_meta/${evRoomId}/events/${b.dataset.id}`))));
}

function addEvent() {
    const title = (document.getElementById('ev-page-title')?.value || '').trim();
    const date = document.getElementById('ev-page-date')?.value;
    const time = document.getElementById('ev-page-time')?.value || '';
    const desc = (document.getElementById('ev-page-desc')?.value || '').trim();
    if (!title || !date) return window.showToast('Event needs a title and date.');
    const r = push(ref(db, `rooms_meta/${evRoomId}/events`));
    set(r, { title, date, time, desc, by: window.currentUser.uid });
    ['ev-page-title', 'ev-page-date', 'ev-page-time', 'ev-page-desc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('ev-page-form')?.classList.add('hidden');
}

function wireOnce() {
    if (wired) return;
    wired = true;
    document.getElementById('ev-page-add-btn')?.addEventListener('click', () =>
        document.getElementById('ev-page-form')?.classList.toggle('hidden'));
    document.getElementById('ev-page-save')?.addEventListener('click', addEvent);
}

window.loadRoomEvents = async function() {
    if (!window.currentUser) return;
    wireOnce();
    const roomId = window.activeRoomId;

    // Permission: creator/admin can add & delete (matches the Home tab).
    evCanEdit = false;
    if (roomId === 'global') evCanEdit = window.currentUser.uid === window.MY_ADMIN_UID;
    else {
        try {
            const d = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {};
            evCanEdit = d.creatorId === window.currentUser.uid || window.currentUser.uid === window.MY_ADMIN_UID;
        } catch {}
    }
    if (roomId !== window.activeRoomId) return;
    document.getElementById('ev-page-add-btn')?.classList.toggle('hidden', !evCanEdit);

    if (evRoomId === roomId && evRef) return;
    if (evRef) off(evRef);
    evRoomId = roomId;
    evRef = ref(db, `rooms_meta/${roomId}/events`);
    onValue(evRef, (snap) => { if (evRoomId === window.activeRoomId) render(snap.val()); });
};
