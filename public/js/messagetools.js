// js/messagetools.js
// Per-message actions: Forward, Bookmark (+ Collections), Importance flag, Impact.
// Hangs off the "⋮" icon added to each message (see chat.js displayMessage).
import { db } from './firebase-core.js?v=30';
import { ref, get, set, update, push, remove, onValue, off, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHtml } from './utils.js?v=30';

const $ = (id) => document.getElementById(id);
const msgRef = (id) => window.activeRoomId === 'global'
    ? ref(db, `messages/${id}`)
    : ref(db, `rooms_data/${window.activeRoomId}/messages/${id}`);

/* ---------- the "⋮" message menu ---------- */
function ensureMenu() {
    let m = $('msg-menu');
    if (!m) {
        m = document.createElement('div');
        m.id = 'msg-menu';
        m.className = 'msg-menu hidden';
        document.body.appendChild(m);
        document.addEventListener('click', () => m.classList.add('hidden'));
    }
    return m;
}

window.openMsgMenu = function(e, id) {
    e.stopPropagation();
    const m = window.msgCache?.[id];
    if (!m) return;
    const menu = ensureMenu();
    const mine = m.uid === window.currentUser.uid;
    const canFlag = mine || window.currentUser.uid === window.MY_ADMIN_UID;
    const saved = !!(window.__bookmarkIds && window.__bookmarkIds[id]);
    menu.innerHTML = `
        <button data-act="forward"><i class="ph-bold ph-share-fat"></i> Forward</button>
        <button data-act="bookmark"><i class="ph-bold ph-bookmark-simple"></i> ${saved ? 'Remove from saved' : 'Save / bookmark'}</button>
        ${canFlag ? `<button data-act="flag"><i class="ph-bold ph-flag"></i> ${m.important ? 'Unflag important' : 'Flag important'}</button>` : ''}
        <button data-act="impact"><i class="ph-bold ph-fire"></i> View impact</button>`;
    menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        menu.classList.add('hidden');
        const act = b.dataset.act;
        if (act === 'forward') openForward(id);
        else if (act === 'bookmark') toggleBookmark(id);
        else if (act === 'flag') toggleImportant(id);
        else if (act === 'impact') showImpact(id);
    }));
    // position near the click, kept on-screen
    let x = e.pageX, y = e.pageY;
    menu.classList.remove('hidden');
    if (x + 200 > window.innerWidth) x -= 200;
    if (y + 180 > window.innerHeight) y -= 180;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
};

/* ---------- Importance flag ---------- */
async function toggleImportant(id) {
    const m = window.msgCache?.[id];
    if (!m) return;
    if (!(m.uid === window.currentUser.uid || window.currentUser.uid === window.MY_ADMIN_UID))
        return window.showToast('Only the author can flag this message.');
    try { await update(msgRef(id), { important: !m.important }); }
    catch (e) { window.showToast('Could not update flag: ' + e.message); }
}

/* ---------- Impact (reactions + replies) ---------- */
async function showImpact(id) {
    let reactions = 0;
    try {
        const path = window.activeRoomId === 'global' ? `messages/${id}/reactions` : `rooms_data/${window.activeRoomId}/messages/${id}/reactions`;
        const s = await get(ref(db, path));
        if (s.exists()) reactions = Object.keys(s.val()).length;
    } catch {}
    let replies = 0;
    for (const k in (window.msgCache || {})) if (window.msgCache[k]?.replyTo?.id === id) replies++;
    window.showToast(`🔥 Impact — ${reactions} reaction${reactions === 1 ? '' : 's'} · ${replies} repl${replies === 1 ? 'y' : 'ies'}`, false);
}

/* ---------- Forwarding ---------- */
async function openForward(id) {
    const m = window.msgCache?.[id];
    if (!m) return;
    let rooms = [{ id: 'global', name: 'Global Chat' }];
    try {
        const snap = await get(ref(db, 'rooms_meta'));
        const uid = window.currentUser.uid;
        snap.forEach(c => { const d = c.val(); if ((d.members && d.members[uid]) || d.creatorId === uid) rooms.push({ id: c.key, name: d.name || 'Room' }); });
    } catch {}

    let modal = $('forward-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'forward-modal';
        modal.className = 'mt-modal hidden';
        modal.innerHTML = `<div class="mt-box"><div class="mt-head"><span>Forward to…</span><button id="forward-close">✖</button></div><div id="forward-list"></div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target.id === 'forward-modal' || e.target.id === 'forward-close') modal.classList.add('hidden'); });
    }
    $('forward-list').innerHTML = rooms.map(r =>
        `<button class="mt-row" data-room="${escapeHtml(r.id)}"><i class="ph-bold ph-chats"></i> ${escapeHtml(r.name)}</button>`).join('');
    $('forward-list').querySelectorAll('.mt-row').forEach(b => b.addEventListener('click', () => { forwardTo(id, b.dataset.room); modal.classList.add('hidden'); }));
    modal.classList.remove('hidden');
}

async function forwardTo(id, roomId) {
    const m = window.msgCache?.[id];
    if (!m) return;
    const msgsRef = roomId === 'global' ? ref(db, 'messages') : ref(db, `rooms_data/${roomId}/messages`);
    try {
        await set(push(msgsRef), {
            uid: window.currentUser.uid, name: window.userProfileName, photoUrl: window.userPhotoUrl,
            text: m.text || '', attachedImage: m.attachedImage || null,
            timestamp: serverTimestamp(), tier: window.userTier, forwardedFrom: m.name || ''
        });
        window.showToast('Message forwarded.', false);
    } catch (e) { window.showToast('Forward failed: ' + e.message); }
}

/* ---------- Bookmarks + Collections ---------- */
async function toggleBookmark(id) {
    const m = window.msgCache?.[id];
    if (!m) return;
    const bRef = ref(db, `users/${window.currentUser.uid}/bookmarks/${id}`);
    try {
        const snap = await get(bRef);
        if (snap.exists()) { await remove(bRef); window.showToast('Removed from saved.', false); return; }
        const collection = (prompt('Save to collection (optional):', 'Saved') || 'Saved').trim() || 'Saved';
        await set(bRef, {
            text: (m.text || '(attachment)').slice(0, 200), name: m.name || '',
            roomId: window.activeRoomId, roomName: $('active-room-name-display')?.textContent || '',
            shortId: window.activeRoomShortId || '', collection, ts: Date.now()
        });
        window.showToast(`Saved to “${collection}”.`, false);
    } catch (e) { window.showToast('Could not save: ' + e.message); }
}

function ensureBookmarksPanel() {
    let p = $('bookmarks-panel');
    if (!p) {
        p = document.createElement('div');
        p.id = 'bookmarks-panel';
        p.className = 'mt-side-panel hidden';
        p.innerHTML = `<div class="mt-side-head"><span><i class="ph-bold ph-bookmark-simple"></i> Saved</span><button id="bookmarks-close">✖</button></div><div id="bookmarks-list"></div>`;
        document.body.appendChild(p);
        $('bookmarks-close').addEventListener('click', () => p.classList.add('hidden'));
    }
    return p;
}

window.openBookmarks = function() {
    const p = ensureBookmarksPanel();
    p.classList.remove('hidden');
};

function renderBookmarks(data) {
    const list = $('bookmarks-list');
    if (!list) return;
    const entries = Object.entries(data || {});
    if (!entries.length) { list.innerHTML = `<div class="mt-empty">Nothing saved yet. Use a message's ⋮ → Save.</div>`; return; }
    // group by collection
    const groups = {};
    entries.forEach(([id, b]) => { (groups[b.collection || 'Saved'] = groups[b.collection || 'Saved'] || []).push({ id, ...b }); });
    list.innerHTML = Object.entries(groups).map(([name, items]) => `
        <div class="mt-coll-title">${escapeHtml(name)} · ${items.length}</div>
        ${items.sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(b => `
            <div class="mt-bookmark" data-room="${escapeHtml(b.roomId)}" data-name="${escapeHtml(b.roomName)}" data-shortid="${escapeHtml(b.shortId || '')}">
                <div class="mt-bookmark-body">
                    <div class="mt-bookmark-text">${escapeHtml(b.text)}</div>
                    <div class="mt-bookmark-sub">${escapeHtml(b.name || '')} · in ${escapeHtml(b.roomName || 'room')}</div>
                </div>
                <button class="mt-bookmark-del" data-id="${escapeHtml(b.id)}" title="Remove">&times;</button>
            </div>`).join('')}`).join('');
    list.querySelectorAll('.mt-bookmark').forEach(el => el.addEventListener('click', (e) => {
        if (e.target.closest('.mt-bookmark-del')) return;
        window.switchRoom?.(el.dataset.room, el.dataset.name, el.dataset.shortid);
        setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 400);
        $('bookmarks-panel')?.classList.add('hidden');
    }));
    list.querySelectorAll('.mt-bookmark-del').forEach(b => b.addEventListener('click', () =>
        remove(ref(db, `users/${window.currentUser.uid}/bookmarks/${b.dataset.id}`))));
}

// Keep a live set of bookmarked ids (for the menu label) + the panel in sync.
window.initMessageTools = function() {
    if (!window.currentUser) return;
    ensureBookmarksPanel();
    onValue(ref(db, `users/${window.currentUser.uid}/bookmarks`), (snap) => {
        const data = snap.val() || {};
        window.__bookmarkIds = data;
        renderBookmarks(data);
    });
};

$('open-bookmarks-btn')?.addEventListener('click', () => window.openBookmarks());
