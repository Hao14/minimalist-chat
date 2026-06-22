// js/roomhome.js
// Dynamic Room Homepage: description, rules, resources, events,
// top contributors, recent activity, and members — all per room.
import { db } from './firebase-core.js?v=30';
import { ref, get, set, update, remove, push, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const $ = (id) => document.getElementById(id);

function esc(s) {
    return (s || '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function safeUrl(u) {
    u = (u || '').trim();
    if (!u) return '#';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

let rhRoomId = null;
let rhData = {};        // rooms_meta snapshot for the active room
let rhCanEdit = false;
let rhIsGlobal = false;

window.loadRoomHome = async function() {
    if (!window.currentUser) return;
    rhRoomId = window.activeRoomId;
    rhIsGlobal = rhRoomId === 'global';

    if (rhIsGlobal) {
        rhData = {};
        rhCanEdit = window.currentUser.uid === window.MY_ADMIN_UID;
    } else {
        try {
            const snap = await get(ref(db, `rooms_meta/${rhRoomId}`));
            rhData = snap.exists() ? snap.val() : {};
        } catch { rhData = {}; }
        rhCanEdit = rhData.creatorId === window.currentUser.uid || window.currentUser.uid === window.MY_ADMIN_UID;
    }

    // Guard against a room switch that happened while we were fetching
    if (rhRoomId !== window.activeRoomId) return;

    renderStats();
    renderDescription();
    renderRules();
    renderResources();
    renderEvents();
    renderMembers();
    renderActivity();
    loadContributors();
};

// Write helper: persist a patch to the room and refresh local cache + section
async function patchRoom(patch) {
    if (rhIsGlobal && !rhCanEdit) return;
    await update(ref(db, `rooms_meta/${rhRoomId}`), patch);
}

/* ---------- STATS ---------- */
function renderStats() {
    if ($('rh-member-count')) $('rh-member-count').textContent = rhIsGlobal ? '∞' : Object.keys(rhData.members || {}).length || 1;
    if ($('rh-created-date')) {
        $('rh-created-date').textContent = rhIsGlobal ? 'Day 1'
            : (rhData.createdAt ? new Date(rhData.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
    }
}

/* ---------- DESCRIPTION ---------- */
const DEFAULT_DESC = 'A dedicated space for communication, sharing resources, and connecting with the group. Everyone is welcome.';
function renderDescription() {
    const wrap = $('rh-description-wrap');
    const head = $('rh-desc-head');
    if (!wrap) return;
    wrap.innerHTML = `<p class="rh-desc-text">${esc(rhData.description || DEFAULT_DESC)}</p>`;
    if (head) {
        head.innerHTML = rhCanEdit ? `<button class="rh-edit-btn" id="rh-desc-edit-btn"><i class="ph-bold ph-pencil-simple"></i> Edit</button>` : '';
        $('rh-desc-edit-btn')?.addEventListener('click', editDescription);
    }
}
function editDescription() {
    const wrap = $('rh-description-wrap');
    wrap.innerHTML = `
        <textarea class="rh-desc-edit" id="rh-desc-textarea">${esc(rhData.description || '')}</textarea>
        <div style="display:flex; gap:0.5rem;">
            <button class="rh-save-btn" id="rh-desc-save">Save</button>
            <button class="rh-add-btn" id="rh-desc-cancel">Cancel</button>
        </div>`;
    $('rh-desc-textarea').focus();
    $('rh-desc-save').addEventListener('click', async () => {
        rhData.description = $('rh-desc-textarea').value.trim();
        await patchRoom({ description: rhData.description });
        renderDescription();
    });
    $('rh-desc-cancel').addEventListener('click', renderDescription);
}

/* ---------- RULES ---------- */
function renderRules() {
    const wrap = $('rh-rules-wrap');
    const head = $('rh-rules-head');
    if (!wrap) return;
    const rules = rhData.rules || {};
    const entries = Object.entries(rules);

    let html = entries.length
        ? entries.map(([key, text], i) => `
            <div class="rh-rule">
                <span class="rh-num">${String(i + 1).padStart(2, '0')}</span>
                <span class="rh-rule-text">${esc(text)}</span>
                ${rhCanEdit ? `<button class="rh-del" data-key="${key}" title="Delete">&times;</button>` : ''}
            </div>`).join('')
        : `<div class="rh-muted">No rules set yet.</div>`;

    if (rhCanEdit) {
        html += `
            <div class="rh-add-form">
                <div class="rh-form-row">
                    <input type="text" id="rh-rule-input" placeholder="Add a rule...">
                    <button class="rh-save-btn" id="rh-rule-add">Add</button>
                </div>
            </div>`;
    }
    wrap.innerHTML = html;

    wrap.querySelectorAll('.rh-del').forEach(btn => btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        delete rhData.rules[key];
        await remove(ref(db, `rooms_meta/${rhRoomId}/rules/${key}`));
        renderRules();
    }));
    $('rh-rule-add')?.addEventListener('click', async () => {
        const val = $('rh-rule-input').value.trim();
        if (!val) return;
        const newRef = push(ref(db, `rooms_meta/${rhRoomId}/rules`));
        await set(newRef, val);
        rhData.rules = rhData.rules || {};
        rhData.rules[newRef.key] = val;
        renderRules();
    });
}

/* ---------- RESOURCES ---------- */
function renderResources() {
    const wrap = $('rh-resources-wrap');
    const head = $('rh-resources-head');
    if (!wrap) return;
    const res = rhData.resources || {};
    const entries = Object.entries(res);

    let html = entries.length
        ? entries.map(([key, r]) => `
            <div style="position:relative;">
                <a class="rh-resource" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">
                    <div class="rh-res-body">
                        <div class="rh-res-title"><i class="ph-bold ph-link"></i> ${esc(r.title)}</div>
                        <div class="rh-res-url">${esc(r.url)}</div>
                    </div>
                    ${rhCanEdit ? `<button class="rh-del" data-key="${key}" title="Delete" onclick="event.preventDefault();">&times;</button>` : ''}
                </a>
            </div>`).join('')
        : `<div class="rh-muted">No resources pinned yet.</div>`;

    if (rhCanEdit) {
        html += `
            <div class="rh-add-form">
                <input type="text" id="rh-res-title" placeholder="Resource title...">
                <div class="rh-form-row">
                    <input type="text" id="rh-res-url" placeholder="https://...">
                    <button class="rh-save-btn" id="rh-res-add">Add</button>
                </div>
            </div>`;
    }
    wrap.innerHTML = html;

    wrap.querySelectorAll('.rh-del').forEach(btn => btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const key = btn.dataset.key;
        delete rhData.resources[key];
        await remove(ref(db, `rooms_meta/${rhRoomId}/resources/${key}`));
        renderResources();
    }));
    $('rh-res-add')?.addEventListener('click', async () => {
        const title = $('rh-res-title').value.trim();
        const url = $('rh-res-url').value.trim();
        if (!title || !url) return;
        const newRef = push(ref(db, `rooms_meta/${rhRoomId}/resources`));
        const obj = { title, url };
        await set(newRef, obj);
        rhData.resources = rhData.resources || {};
        rhData.resources[newRef.key] = obj;
        renderResources();
    });
}

/* ---------- EVENTS ---------- */
function renderEvents() {
    const wrap = $('rh-events-wrap');
    if (!wrap) return;
    const events = rhData.events || {};
    // sort by date ascending; hide ones long past handled by sort only
    const entries = Object.entries(events).sort((a, b) => (a[1].date || '').localeCompare(b[1].date || ''));

    let html = entries.length
        ? entries.map(([key, ev]) => {
            const d = ev.date ? new Date(ev.date + 'T00:00:00') : null;
            const day = d ? d.getDate() : '?';
            const mon = d ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
            return `
            <div class="rh-event">
                <div class="rh-event-date"><span class="rh-d">${day}</span><span class="rh-m">${mon}</span></div>
                <div class="rh-event-body">
                    <div class="rh-event-title">${esc(ev.title)}</div>
                    ${ev.desc ? `<div class="rh-event-desc">${esc(ev.desc)}</div>` : ''}
                </div>
                ${rhCanEdit ? `<button class="rh-del" data-key="${key}" title="Delete">&times;</button>` : ''}
            </div>`;
        }).join('')
        : `<div class="rh-muted">No upcoming events.</div>`;

    if (rhCanEdit) {
        html += `
            <div class="rh-add-form">
                <input type="text" id="rh-ev-title" placeholder="Event title...">
                <div class="rh-form-row">
                    <input type="date" id="rh-ev-date">
                    <input type="text" id="rh-ev-desc" placeholder="Details (optional)">
                </div>
                <button class="rh-save-btn" id="rh-ev-add">Add Event</button>
            </div>`;
    }
    wrap.innerHTML = html;

    wrap.querySelectorAll('.rh-del').forEach(btn => btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        delete rhData.events[key];
        await remove(ref(db, `rooms_meta/${rhRoomId}/events/${key}`));
        renderEvents();
    }));
    $('rh-ev-add')?.addEventListener('click', async () => {
        const title = $('rh-ev-title').value.trim();
        const date = $('rh-ev-date').value;
        const desc = $('rh-ev-desc').value.trim();
        if (!title || !date) return;
        const newRef = push(ref(db, `rooms_meta/${rhRoomId}/events`));
        const obj = { title, date, desc };
        await set(newRef, obj);
        rhData.events = rhData.events || {};
        rhData.events[newRef.key] = obj;
        renderEvents();
    });
}

/* ---------- MEMBERS ---------- */
function renderMembers() {
    const wrap = $('rh-members-list');
    if (!wrap) return;
    if (rhIsGlobal) { wrap.innerHTML = `<span>Everyone</span>`; return; }
    const members = rhData.members || {};
    const names = Object.values(members);
    wrap.innerHTML = names.length
        ? names.map(n => `<span>${esc(n)}</span>`).join('')
        : `<span>No members yet</span>`;
}

/* ---------- RECENT ACTIVITY ---------- */
function renderActivity() {
    const list = $('rh-activity-list');
    if (!list) return;
    if (rhIsGlobal) { list.innerHTML = `<li class="rh-muted">Global activity log is hidden.</li>`; return; }

    const logs = rhData.logs;
    if (!logs) { list.innerHTML = `<li class="rh-muted">No recent activity.</li>`; return; }

    list.innerHTML = Object.values(logs)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 6)
        .map(l => {
            const timeStr = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const icon = l.text.includes('joined') ? 'ph-sign-in' : (l.text.includes('left') || l.text.includes('kicked') ? 'ph-sign-out' : 'ph-check-circle');
            return `
                <li>
                    <i class="ph-bold ${icon}" style="color: var(--text-color); font-size: 1.3rem;"></i>
                    <div style="flex:1; min-width:0;">
                        <div class="rh-act-text" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(l.text)}</div>
                        <div class="rh-act-time">${timeStr}</div>
                    </div>
                </li>`;
        }).join('');
}

/* ---------- TOP CONTRIBUTORS ---------- */
async function loadContributors() {
    const wrap = $('rh-contributors-wrap');
    if (!wrap) return;
    const msgsRef = rhIsGlobal ? ref(db, 'messages') : ref(db, `rooms_data/${rhRoomId}/messages`);
    try {
        const snap = await get(query(msgsRef, limitToLast(300)));
        if (rhRoomId !== window.activeRoomId) return; // room changed mid-fetch

        const tally = {};
        let total = 0;
        snap.forEach(child => {
            const m = child.val(); total++;
            if (!m.uid) return;
            if (!tally[m.uid]) tally[m.uid] = { name: m.name || 'Unknown', photo: m.photoUrl || '', count: 0 };
            tally[m.uid].count++;
        });

        if ($('rh-msg-count')) $('rh-msg-count').textContent = total >= 300 ? '300+' : total;

        const top = Object.values(tally).sort((a, b) => b.count - a.count).slice(0, 5);
        if (!top.length) { wrap.innerHTML = `<div class="rh-muted">No messages yet.</div>`; return; }

        const medals = ['🥇', '🥈', '🥉'];
        wrap.innerHTML = top.map((c, i) => `
            <div class="rh-contributor">
                <span class="rh-rank">${medals[i] || (i + 1)}</span>
                <img src="${esc(window.getAvatarUrl(c.name, c.photo))}" alt="">
                <span class="rh-c-name">${esc(c.name)}</span>
                <span class="rh-c-count">${c.count} msg${c.count === 1 ? '' : 's'}</span>
            </div>`).join('');
    } catch {
        wrap.innerHTML = `<div class="rh-muted">Could not load contributors.</div>`;
    }
}
