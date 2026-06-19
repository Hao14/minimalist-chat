// js/whiteboard.js
// Real-time shared sticky-note whiteboard, scoped per room.
import { db } from './firebase-core.js';
import { ref, push, update, remove, onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const WB_COLORS = ['#FFE16B', '#A0E8B7', '#A8D4F5', '#F7B0B0', '#D9B3F0', '#F5C98A', '#C9C9C9'];

let wbRoomId = null;       // room the listeners are currently bound to
let wbRef = null;          // db ref for current room's notes
let wbColor = WB_COLORS[0];
let wbHandlers = null;     // { added, changed, removed } so we can detach
let editingId = null;      // note currently being text-edited locally
let draggingId = null;     // note currently being dragged locally
let spawnOffset = 0;       // cascade offset for newly created notes

function canvas() { return document.getElementById('wb-canvas'); }

function buildNoteEl(id, n) {
    const el = document.createElement('div');
    el.className = 'wb-note';
    el.id = `wb-note-${id}`;
    el.dataset.id = id;
    el.innerHTML = `
        <button class="wb-note-del" title="Delete">&times;</button>
        <div class="wb-note-text"></div>
        <div class="wb-note-meta"></div>
    `;
    el.querySelector('.wb-note-del').addEventListener('click', (e) => {
        e.stopPropagation();
        remove(ref(db, `whiteboards/${wbRoomId}/notes/${id}`));
    });

    const textEl = el.querySelector('.wb-note-text');
    el.addEventListener('dblclick', () => {
        editingId = id;
        textEl.setAttribute('contenteditable', 'true');
        textEl.focus();
    });
    textEl.addEventListener('blur', () => {
        textEl.setAttribute('contenteditable', 'false');
        editingId = null;
        update(ref(db, `whiteboards/${wbRoomId}/notes/${id}`), { text: textEl.innerText });
    });

    attachDrag(el);
    return el;
}

function paintNote(el, n) {
    el.style.left = (n.x ?? 40) + 'px';
    el.style.top = (n.y ?? 40) + 'px';
    el.style.background = n.color || WB_COLORS[0];
    if (editingId !== el.dataset.id) el.querySelector('.wb-note-text').innerText = n.text || '';
    el.querySelector('.wb-note-meta').textContent = n.byName ? `— ${n.byName}` : '';
}

function attachDrag(el) {
    let startX, startY, originX, originY;
    el.addEventListener('pointerdown', (e) => {
        // Ignore drags that start on the delete button or while editing text
        if (e.target.closest('.wb-note-del') || el.querySelector('.wb-note-text').getAttribute('contenteditable') === 'true') return;
        draggingId = el.dataset.id;
        el.classList.add('dragging');
        el.setPointerCapture(e.pointerId);
        startX = e.clientX; startY = e.clientY;
        originX = parseFloat(el.style.left) || 0;
        originY = parseFloat(el.style.top) || 0;
    });
    el.addEventListener('pointermove', (e) => {
        if (draggingId !== el.dataset.id) return;
        el.style.left = (originX + (e.clientX - startX)) + 'px';
        el.style.top = (originY + (e.clientY - startY)) + 'px';
    });
    const end = () => {
        if (draggingId !== el.dataset.id) return;
        draggingId = null;
        el.classList.remove('dragging');
        update(ref(db, `whiteboards/${wbRoomId}/notes/${el.dataset.id}`), {
            x: Math.max(0, parseFloat(el.style.left) || 0),
            y: Math.max(0, parseFloat(el.style.top) || 0)
        });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}

function addNote() {
    if (!window.currentUser || !wbRoomId) return;
    const board = canvas();
    const base = board ? board.scrollLeft + 40 : 40;
    spawnOffset = (spawnOffset + 30) % 180;
    const note = {
        text: '', color: wbColor,
        x: base + spawnOffset, y: 40 + spawnOffset,
        by: window.currentUser.uid, byName: window.userProfileName || 'Anonymous'
    };
    push(ref(db, `whiteboards/${wbRoomId}/notes`), note);
}

function renderToolbar() {
    const swatches = document.getElementById('wb-colors');
    if (!swatches || swatches.childElementCount) return; // build once
    WB_COLORS.forEach((c, i) => {
        const s = document.createElement('span');
        s.className = 'wb-swatch' + (i === 0 ? ' active' : '');
        s.style.background = c;
        s.addEventListener('click', () => {
            wbColor = c;
            document.querySelectorAll('.wb-swatch').forEach(x => x.classList.remove('active'));
            s.classList.add('active');
        });
        swatches.appendChild(s);
    });
    document.getElementById('wb-add-note')?.addEventListener('click', addNote);
    document.getElementById('wb-clear')?.addEventListener('click', () => {
        if (confirm('Clear the entire whiteboard for everyone?')) remove(ref(db, `whiteboards/${wbRoomId}/notes`));
    });
}

function detach() {
    if (wbHandlers) {
        // onChild* return unsubscribe functions in the modular SDK
        wbHandlers.added();
        wbHandlers.changed();
        wbHandlers.removed();
    }
    wbHandlers = null;
    editingId = null;
    draggingId = null;
}

window.loadRoomWhiteboard = function() {
    if (!window.currentUser) return;
    renderToolbar();

    const board = canvas();
    if (!board) return;

    // Already bound to this room — nothing to do.
    if (wbRoomId === window.activeRoomId && wbHandlers) return;

    detach();
    wbRoomId = window.activeRoomId;
    board.innerHTML = '';
    wbRef = ref(db, `whiteboards/${wbRoomId}/notes`);

    wbHandlers = {
        added: onChildAdded(wbRef, (snap) => {
            if (document.getElementById(`wb-note-${snap.key}`)) return;
            const el = buildNoteEl(snap.key, snap.val());
            paintNote(el, snap.val());
            board.appendChild(el);
        }),
        changed: onChildChanged(wbRef, (snap) => {
            const el = document.getElementById(`wb-note-${snap.key}`);
            if (!el || draggingId === snap.key) return; // don't fight a local drag
            paintNote(el, snap.val());
        }),
        removed: onChildRemoved(wbRef, (snap) => {
            document.getElementById(`wb-note-${snap.key}`)?.remove();
        })
    };
};
