// js/docs.js
// Collaborative documents (Google Docs-lite), scoped per room.
import { db } from './firebase-core.js?v=19';
import { ref, push, set, update, remove, onValue, off } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const DOC_EMOJIS = ['📄', '📝', '☕', '🧘', '🌅', '📌', '💡', '🚀', '🔬', '📚'];

let docsRoomId = null;     // room the list listener is bound to
let docsRef = null;        // db ref for current room's docs
let docsData = {};         // cached { id: doc }
let activeTag = 'all';
let currentDocId = null;   // doc open in the editor
let currentDocRef = null;  // db ref + listener for the open doc
let saveTimer = null;

const $ = (id) => document.getElementById(id);

function fmtDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function allTags() {
    const set = new Set();
    Object.values(docsData).forEach(d => (d.tags || []).forEach(t => set.add(t)));
    return [...set];
}

function renderTagFilters() {
    const bar = $('docs-tags');
    if (!bar) return;
    const tags = ['all', ...allTags()];
    bar.innerHTML = tags.map(t =>
        `<button class="docs-tag-chip ${t === activeTag ? 'active' : ''}" data-tag="${escapeHtml(t)}">${t === 'all' ? 'All' : escapeHtml(t)}</button>`
    ).join('');
    bar.querySelectorAll('.docs-tag-chip').forEach(chip => {
        chip.addEventListener('click', () => { activeTag = chip.dataset.tag; renderDocsList(); });
    });
}

function renderDocsList() {
    const grid = $('docs-grid');
    if (!grid) return;
    renderTagFilters();

    const q = ($('docs-search')?.value || '').trim().toLowerCase();
    const entries = Object.entries(docsData)
        .filter(([, d]) => activeTag === 'all' || (d.tags || []).includes(activeTag))
        .filter(([, d]) => !q || (d.title || '').toLowerCase().includes(q) || (d.content || '').toLowerCase().includes(q))
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));

    if (!entries.length) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#888; font-weight:bold; padding:3rem 1rem;">No documents yet. Click “New doc” to start one.</div>`;
        return;
    }

    grid.innerHTML = entries.map(([id, d]) => {
        const preview = escapeHtml((d.content || '').replace(/\s+/g, ' ').slice(0, 120)) || 'Empty document.';
        const tags = (d.tags || []).map(t => `<span class="doc-card-tag">${escapeHtml(t)}</span>`).join('');
        return `
            <div class="doc-card" data-id="${id}">
                <div class="doc-card-emoji">${d.emoji || '📄'}</div>
                <div class="doc-card-title">${escapeHtml(d.title) || 'Untitled'}</div>
                <div class="doc-card-preview">${preview}</div>
                <div class="doc-card-tags">${tags}</div>
                <div class="doc-card-meta"><span>🕘 ${fmtDate(d.updatedAt)}</span><span>👤 ${escapeHtml(d.byName) || 'Unknown'}</span></div>
            </div>`;
    }).join('');

    grid.querySelectorAll('.doc-card').forEach(card => {
        card.addEventListener('click', () => openDoc(card.dataset.id));
    });
}

function renderEmojiPicker(selected) {
    const pick = $('doc-emoji-pick');
    if (!pick) return;
    pick.innerHTML = DOC_EMOJIS.map(e =>
        `<span class="${e === selected ? 'active' : ''}" data-emoji="${e}">${e}</span>`
    ).join('');
    pick.querySelectorAll('span').forEach(s => {
        s.addEventListener('click', () => {
            pick.querySelectorAll('span').forEach(x => x.classList.remove('active'));
            s.classList.add('active');
            queueSave();
        });
    });
}

function showEditor(show) {
    $('docs-list-view')?.classList.toggle('hidden', show);
    $('docs-editor-view')?.classList.toggle('hidden', !show);
}

function selectedEmoji() {
    return $('doc-emoji-pick')?.querySelector('span.active')?.dataset.emoji || '📄';
}

function openDoc(id) {
    currentDocId = id;
    const d = docsData[id] || {};
    $('doc-title-input').value = d.title || '';
    $('doc-content-input').value = d.content || '';
    $('doc-tags-input').value = (d.tags || []).join(', ');
    renderEmojiPicker(d.emoji || '📄');
    setSaveStatus('Saved');
    showEditor(true);

    // Live-sync this document so collaborators' edits appear in real time.
    if (currentDocRef) off(currentDocRef);
    currentDocRef = ref(db, `room_docs/${docsRoomId}/${id}`);
    onValue(currentDocRef, (snap) => {
        const remote = snap.val();
        if (!remote || currentDocId !== id) return;
        const active = document.activeElement;
        if (active !== $('doc-title-input') && $('doc-title-input').value !== (remote.title || '')) $('doc-title-input').value = remote.title || '';
        if (active !== $('doc-content-input') && $('doc-content-input').value !== (remote.content || '')) $('doc-content-input').value = remote.content || '';
    });
}

function closeEditor() {
    if (currentDocRef) { off(currentDocRef); currentDocRef = null; }
    currentDocId = null;
    clearTimeout(saveTimer);
    showEditor(false);
}

async function newDoc() {
    if (!window.currentUser || !docsRoomId) return;
    const now = Date.now();
    const docObj = {
        title: '', content: '', emoji: '📄', tags: [],
        by: window.currentUser.uid, byName: window.userProfileName || 'Anonymous',
        createdAt: now, updatedAt: now
    };
    const newRef = push(docsRef);
    await set(newRef, docObj);
    docsData[newRef.key] = docObj;
    openDoc(newRef.key);
    $('doc-title-input').focus();
}

function setSaveStatus(t) {
    const el = $('doc-save-status');
    if (el) el.textContent = t;
}

function queueSave() {
    setSaveStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDoc, 600);
}

async function saveDoc() {
    if (!currentDocId || !docsRoomId) return;
    const tags = $('doc-tags-input').value.split(',').map(t => t.trim()).filter(Boolean);
    try {
        await update(ref(db, `room_docs/${docsRoomId}/${currentDocId}`), {
            title: $('doc-title-input').value,
            content: $('doc-content-input').value,
            emoji: selectedEmoji(),
            tags,
            updatedAt: Date.now()
        });
        setSaveStatus('Saved');
    } catch (e) {
        setSaveStatus('Save failed');
    }
}

async function deleteDoc() {
    if (!currentDocId) return;
    if (!confirm('Delete this document for everyone?')) return;
    const id = currentDocId;
    closeEditor();
    await remove(ref(db, `room_docs/${docsRoomId}/${id}`));
}

let wired = false;
function wireOnce() {
    if (wired) return;
    wired = true;
    $('docs-new-btn')?.addEventListener('click', newDoc);
    $('docs-search')?.addEventListener('input', renderDocsList);
    $('doc-back-btn')?.addEventListener('click', closeEditor);
    $('doc-delete-btn')?.addEventListener('click', deleteDoc);
    ['doc-title-input', 'doc-content-input', 'doc-tags-input'].forEach(id => {
        $(id)?.addEventListener('input', queueSave);
    });
}

window.loadRoomDocs = function() {
    if (!window.currentUser) return;
    wireOnce();
    closeEditor();

    if (docsRoomId === window.activeRoomId && docsRef) { renderDocsList(); return; }

    if (docsRef) off(docsRef);
    docsRoomId = window.activeRoomId;
    docsRef = ref(db, `room_docs/${docsRoomId}`);
    onValue(docsRef, (snap) => {
        docsData = snap.val() || {};
        renderDocsList();
    });
};
