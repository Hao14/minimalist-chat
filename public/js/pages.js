// js/pages.js
// Per-room optional pages. Each room stores rooms_meta/{roomId}/pages = { docs:true, ... }.
// The room creator/admin can toggle pages on/off via the "+" menu in the sub-nav.
import { db } from './firebase-core.js?v=30';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Order here = order tabs appear in the sub-nav.
const PAGE_DEFS = {
    docs:       { label: 'Docs',       icon: 'ph-file-text' },
    whiteboard: { label: 'Whiteboard', icon: 'ph-palette' },
    tasks:      { label: 'Tasks',      icon: 'ph-check-square' },
    events:     { label: 'Events',     icon: 'ph-calendar-dots' },
    calendar:   { label: 'Calendar',   icon: 'ph-calendar' },
    ai:         { label: 'AI',         icon: 'ph-sparkle' },
};
// Rooms created before this feature have no `pages` config — keep their existing tabs.
const DEFAULT_PAGES = { docs: true, whiteboard: true };

let pagesData = {};
let pagesCanEdit = false;
let pagesRoomId = null;

window.renderRoomPages = async function() {
    const dyn = document.getElementById('room-pages-dynamic');
    const addBtn = document.getElementById('room-add-page-btn');
    if (!dyn) return;
    const roomId = window.activeRoomId;
    pagesRoomId = roomId;

    let config = null, canEdit = false;
    try {
        if (roomId === 'global') {
            canEdit = window.currentUser?.uid === window.MY_ADMIN_UID;
            config = (await get(ref(db, 'rooms_meta/global/pages'))).val();
        } else {
            const d = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {};
            config = d.pages || null;
            canEdit = d.creatorId === window.currentUser?.uid || window.currentUser?.uid === window.MY_ADMIN_UID;
        }
    } catch {}
    if (roomId !== window.activeRoomId) return; // room switched while fetching

    pagesData = config || { ...DEFAULT_PAGES };
    pagesCanEdit = canEdit;

    dyn.innerHTML = Object.keys(PAGE_DEFS)
        .filter(k => pagesData[k])
        .map(k => `<button class="room-tab" data-target="${k}"><i class="ph-bold ${PAGE_DEFS[k].icon}" style="margin-right:5px;"></i>${PAGE_DEFS[k].label}</button>`)
        .join('');

    if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
    buildAddMenu();
};

function buildAddMenu() {
    const menu = document.getElementById('room-add-page-menu');
    if (!menu) return;
    menu.innerHTML =
        `<div style="padding:0.6rem 1rem 0.3rem; font-size:0.7rem; font-weight:800; color:#888; text-transform:uppercase; letter-spacing:1px;">Pages</div>` +
        Object.entries(PAGE_DEFS).map(([k, def]) => `
            <button class="page-toggle" data-page="${k}" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                <span><i class="ph-bold ${def.icon}" style="margin-right:8px;"></i>${def.label}</span>
                <span style="color: var(--accent-color); font-weight:900;">${pagesData[k] ? '✓' : '+'}</span>
            </button>`).join('');
    menu.querySelectorAll('.page-toggle').forEach(b =>
        b.addEventListener('click', (e) => { e.stopPropagation(); togglePage(b.dataset.page); }));
}

async function togglePage(key) {
    if (!pagesCanEdit || !pagesRoomId) return;
    const enabled = !pagesData[key];
    pagesData[key] = enabled;
    const wasActive = document.querySelector('.room-tab.active')?.getAttribute('data-target') === key;
    // Write the full effective set (not just this key) so a room's first toggle still
    // persists the defaults — otherwise docs/whiteboard would silently vanish.
    try { await set(ref(db, `rooms_meta/${pagesRoomId}/pages`), pagesData); }
    catch (e) { if (window.showToast) window.showToast('Could not update pages: ' + e.message); return; }
    await window.renderRoomPages();
    // If we just removed the page the user was viewing, fall back to Home.
    if (!enabled && wasActive) document.querySelector('.room-tab[data-target="home"]')?.click();
}

// "+" menu open/close
document.getElementById('room-add-page-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('room-add-page-menu')?.classList.toggle('hidden');
});
document.addEventListener('click', () => document.getElementById('room-add-page-menu')?.classList.add('hidden'));
