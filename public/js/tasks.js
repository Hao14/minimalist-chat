// js/tasks.js
// Per-room shared task list. Data: room_tasks/{roomId}/{taskId} = { text, done, by, byName, createdAt }.
import { db } from './firebase-core.js?v=30';
import { ref, push, set, update, remove, onValue, off } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHtml } from './utils.js?v=30';

let tasksRoomId = null;
let tasksRef = null;
let wired = false;

function addTask() {
    const input = document.getElementById('task-input');
    const text = (input?.value || '').trim();
    if (!text || !tasksRoomId || !window.currentUser) return;
    push(tasksRef, {
        text, done: false,
        by: window.currentUser.uid, byName: window.userProfileName || 'Anonymous',
        createdAt: Date.now()
    });
    window.awardXP?.(window.currentUser.uid, 'technical', 2);
    input.value = '';
}

function render(data) {
    const board = document.getElementById('tasks-board');
    if (!board) return;
    const entries = Object.entries(data || {}).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const open = entries.filter(([, t]) => !t.done);
    const done = entries.filter(([, t]) => t.done);

    if (!entries.length) { board.innerHTML = `<div class="rh-muted" style="padding:1rem;">No tasks yet. Add one above.</div>`; return; }

    const row = ([id, t]) => `
        <div class="task-item ${t.done ? 'done' : ''}" data-id="${id}">
            <button class="task-check" data-id="${id}" title="Toggle">${t.done ? '<i class="ph-bold ph-check-circle"></i>' : '<i class="ph-bold ph-circle"></i>'}</button>
            <div class="task-body">
                <div class="task-text">${escapeHtml(t.text)}</div>
                <div class="task-meta">${escapeHtml(t.byName || '')}</div>
            </div>
            <button class="task-del" data-id="${id}" title="Delete">&times;</button>
        </div>`;

    board.innerHTML =
        `<div class="task-col-title">To do · ${open.length}</div>${open.map(row).join('') || '<div class="rh-muted" style="padding:0.5rem 1rem;">Nothing pending 🎉</div>'}` +
        (done.length ? `<div class="task-col-title" style="margin-top:1.5rem;">Done · ${done.length}</div>${done.map(row).join('')}` : '');

    board.querySelectorAll('.task-check').forEach(b => b.addEventListener('click', () => {
        const cur = data[b.dataset.id];
        update(ref(db, `room_tasks/${tasksRoomId}/${b.dataset.id}`), { done: !cur.done });
        if (!cur.done && cur.by === window.currentUser?.uid) window.awardXP?.(window.currentUser.uid, 'technical', 3); // completing your own task
    }));
    board.querySelectorAll('.task-del').forEach(b => b.addEventListener('click', () =>
        remove(ref(db, `room_tasks/${tasksRoomId}/${b.dataset.id}`))));
}

function wireOnce() {
    if (wired) return;
    wired = true;
    document.getElementById('task-add-btn')?.addEventListener('click', addTask);
    document.getElementById('task-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addTask(); }
    });
}

window.loadRoomTasks = function() {
    if (!window.currentUser) return;
    wireOnce();
    if (tasksRoomId === window.activeRoomId && tasksRef) return;
    if (tasksRef) off(tasksRef);
    tasksRoomId = window.activeRoomId;
    tasksRef = ref(db, `room_tasks/${tasksRoomId}`);
    onValue(tasksRef, (snap) => { if (tasksRoomId === window.activeRoomId) render(snap.val()); });
};
