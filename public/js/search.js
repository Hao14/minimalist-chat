// js/search.js
// Global omni-search: rooms, people, and messages in one box.
// Messages are searched across Global + the currently open room (recent history).
import { db } from './firebase-core.js?v=19';
import { ref, get, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHtml } from './utils.js?v=19';

const $ = (id) => document.getElementById(id);
let wired = false;
let searchTimer = null;

function openSearch() {
    const m = $('search-modal');
    if (!m) return;
    m.classList.remove('hidden');
    const input = $('global-search-input');
    if (input) { input.value = ''; input.focus(); }
    $('search-results').innerHTML = `<div class="search-hint">Type to search rooms, people and messages…</div>`;
}
function closeSearch() { $('search-modal')?.classList.add('hidden'); }

function section(title) { return `<div class="search-section">${title}</div>`; }

async function runSearch(raw) {
    const q = (raw || '').trim().toLowerCase();
    const box = $('search-results');
    if (!box) return;
    if (q.length < 2) { box.innerHTML = `<div class="search-hint">Type at least 2 characters…</div>`; return; }
    box.innerHTML = `<div class="search-hint">Searching…</div>`;
    const uid = window.currentUser?.uid;

    try {
        const [roomsSnap, usersSnap] = await Promise.all([get(ref(db, 'rooms_meta')), get(ref(db, 'users'))]);

        // Rooms the user is in (+ Global), matched by name
        const rooms = [];
        roomsSnap.forEach(c => {
            const d = c.val();
            const mine = (d.members && d.members[uid]) || d.creatorId === uid;
            if ((mine || c.key === 'global') && (d.name || '').toLowerCase().includes(q)) {
                rooms.push({ id: c.key, name: d.name || 'Room', shortId: d.shortId || '' });
            }
        });
        if ('global chat'.includes(q) && !rooms.find(r => r.id === 'global')) {
            rooms.unshift({ id: 'global', name: 'Global Chat', shortId: 'GLOBAL' });
        }

        // People, matched by display name or short id
        const people = [];
        const users = usersSnap.val() || {};
        for (const id in users) {
            if (id === uid) continue;
            const u = users[id];
            if ((u.displayName || '').toLowerCase().includes(q) || (u.shortId || '').toLowerCase().includes(q)) {
                people.push({ id, name: u.displayName, photo: u.photoUrl, shortId: u.shortId });
            }
        }

        // Messages — Global + current room (recent), matched by text
        const sources = [{ ref: ref(db, 'messages'), room: 'global', name: 'Global Chat', shortId: 'GLOBAL' }];
        if (window.activeRoomId && window.activeRoomId !== 'global') {
            sources.push({
                ref: ref(db, `rooms_data/${window.activeRoomId}/messages`),
                room: window.activeRoomId,
                name: $('active-room-name-display')?.textContent || 'Room',
                shortId: window.activeRoomShortId || ''
            });
        }
        const snaps = await Promise.all(sources.map(s => get(query(s.ref, limitToLast(300)))));
        const msgs = [];
        snaps.forEach((snap, i) => {
            const s = sources[i];
            snap.forEach(ch => {
                const m = ch.val();
                if ((m.text || '').toLowerCase().includes(q)) {
                    msgs.push({ text: m.text, name: m.name, room: s.room, roomName: s.name, shortId: s.shortId });
                }
            });
        });

        render(rooms, people, msgs.reverse().slice(0, 50));
    } catch (e) {
        box.innerHTML = `<div class="search-hint">Search failed: ${escapeHtml(e.message)}</div>`;
    }
}

function render(rooms, people, msgs) {
    const box = $('search-results');
    let html = '';
    if (rooms.length) {
        html += section('Rooms') + rooms.map(r =>
            `<div class="search-item" data-go="room" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name)}" data-shortid="${escapeHtml(r.shortId)}">
                <i class="ph-bold ph-chats"></i>
                <div class="search-item-body"><div class="search-item-title">${escapeHtml(r.name)}</div><div class="search-item-sub">Room</div></div>
            </div>`).join('');
    }
    if (people.length) {
        html += section('People') + people.map(p =>
            `<div class="search-item" data-go="person" data-id="${escapeHtml(p.id)}">
                <img class="search-item-avatar" src="${escapeHtml(window.getAvatarUrl(p.name, p.photo))}" alt="">
                <div class="search-item-body"><div class="search-item-title">${escapeHtml(p.name || 'Unknown')}</div><div class="search-item-sub">#${escapeHtml(p.shortId || '')}</div></div>
            </div>`).join('');
    }
    if (msgs.length) {
        html += section('Messages') + msgs.map(m =>
            `<div class="search-item" data-go="msg" data-id="${escapeHtml(m.room)}" data-name="${escapeHtml(m.roomName)}" data-shortid="${escapeHtml(m.shortId)}">
                <i class="ph-bold ph-chat-text"></i>
                <div class="search-item-body"><div class="search-item-title">${escapeHtml((m.text || '').slice(0, 80))}</div><div class="search-item-sub">${escapeHtml(m.name || '')} · in ${escapeHtml(m.roomName)}</div></div>
            </div>`).join('');
    }
    box.innerHTML = html || `<div class="search-hint">No results.</div>`;
    box.querySelectorAll('.search-item').forEach(el => el.addEventListener('click', () => onResult(el.dataset)));
}

function onResult(d) {
    closeSearch();
    if (d.go === 'room' || d.go === 'msg') {
        window.switchRoom?.(d.id, d.name, d.shortid);
        if (d.go === 'msg') setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 400);
    } else if (d.go === 'person') {
        window.viewUserProfile?.(d.id);
    }
}

function wireOnce() {
    if (wired) return;
    wired = true;
    $('open-search-btn')?.addEventListener('click', openSearch);
    $('close-search-btn')?.addEventListener('click', closeSearch);
    $('search-modal')?.addEventListener('click', (e) => { if (e.target.id === 'search-modal') closeSearch(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
    $('global-search-input')?.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        const v = e.target.value;
        searchTimer = setTimeout(() => runSearch(v), 250);
    });
}
wireOnce();
