import { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, push, ref, remove, serverTimestamp, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';

const COLUMNS = [
  { id: 'backlog', name: 'Backlog', dot: '#9ca3af' },
  { id: 'todo', name: 'To Do', dot: '#6366f1' },
  { id: 'inprogress', name: 'In Progress', dot: '#f59e0b' },
  { id: 'done', name: 'Done', dot: '#22c55e' },
];
const STATUS_IDS = COLUMNS.map((column) => column.id);
const PRIORITIES = ['low', 'medium', 'high'];
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

// Soft [background, foreground] pairs; a category name hashes to a stable colour.
const CATEGORY_COLORS = [
  ['#ede9fe', '#6d28d9'],
  ['#dcfce7', '#15803d'],
  ['#dbeafe', '#1d4ed8'],
  ['#ffedd5', '#c2410c'],
  ['#fce7f3', '#be185d'],
  ['#ccfbf1', '#0f766e'],
  ['#fef9c3', '#a16207'],
  ['#e0e7ff', '#4338ca'],
];
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6'];

function hashIndex(value, mod) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash % mod;
}
const categoryColor = (name) => CATEGORY_COLORS[hashIndex(name.toLowerCase(), CATEGORY_COLORS.length)];
const avatarColor = (name) => AVATAR_COLORS[hashIndex((name || '?').toLowerCase(), AVATAR_COLORS.length)];
const initials = (name) => (name || '?').trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();

const statusOf = (task) => (task.status && STATUS_IDS.includes(task.status) ? task.status : (task.done ? 'done' : 'todo'));
const categoriesOf = (task) => (task.categories ? Object.keys(task.categories).filter((key) => task.categories[key]) : []);

function formatDue(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TaskCard({ task, onOpen }) {
  const categories = categoriesOf(task);
  const priority = task.priority || 'medium';
  const due = formatDue(task.dueDate);
  const assignee = task.assigneeName;
  return (
    <article
      className="kb-card"
      draggable
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }}
      onDragStart={(event) => { event.dataTransfer.setData('text/taskId', task.id); event.dataTransfer.effectAllowed = 'move'; }}
    >
      <div className="kb-card-title">{task.text}</div>
      <div className="kb-card-tags">
        <span className={`kb-prio kb-prio-${priority}`}>{PRIORITY_LABEL[priority]}</span>
        {categories.map((name) => {
          const [bg, fg] = categoryColor(name);
          return <span key={name} className="kb-cat" style={{ background: bg, color: fg }}>{name}</span>;
        })}
      </div>
      {(due || assignee) && (
        <div className="kb-card-foot">
          {due && <span className="kb-due"><i className="ph-bold ph-calendar-blank" />{due}</span>}
          {assignee && <span className="kb-ava" style={{ background: avatarColor(assignee) }} title={assignee}>{initials(assignee)}</span>}
        </div>
      )}
    </article>
  );
}

function TaskDetail({ task, memberNames, onClose, onPatch, onDelete, onAddCategory, onRemoveCategory }) {
  const [catDraft, setCatDraft] = useState('');
  const categories = categoriesOf(task);
  return (
    <>
      <div className="kb-detail-backdrop" onClick={onClose} />
      <aside className="kb-detail" role="dialog" aria-label="Task detail">
        <header className="kb-detail-head">
          <span>Task detail</span>
          <button type="button" className="kb-detail-close" onClick={onClose} aria-label="Close"><i className="ph-bold ph-x" /></button>
        </header>
        <div className="kb-detail-body">
          <textarea
            className="kb-detail-title"
            rows={2}
            value={task.text || ''}
            placeholder="Task title"
            aria-label="Task title"
            onChange={(event) => onPatch({ text: event.target.value })}
          />

          <label className="kb-field">
            <span>Status</span>
            <select value={statusOf(task)} onChange={(event) => onPatch({ status: event.target.value, done: event.target.value === 'done' })}>
              {COLUMNS.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
            </select>
          </label>

          <label className="kb-field">
            <span>Priority</span>
            <select value={task.priority || 'medium'} onChange={(event) => onPatch({ priority: event.target.value })}>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
            </select>
          </label>

          <label className="kb-field">
            <span>Assignee</span>
            <select value={task.assigneeName || ''} onChange={(event) => onPatch({ assigneeName: event.target.value })}>
              <option value="">Unassigned</option>
              {memberNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <label className="kb-field">
            <span>Due date</span>
            <input type="date" value={task.dueDate || ''} onChange={(event) => onPatch({ dueDate: event.target.value })} />
          </label>

          <div className="kb-field kb-field-col">
            <span>Categories</span>
            <div className="kb-cat-row">
              {categories.map((name) => {
                const [bg, fg] = categoryColor(name);
                return (
                  <span key={name} className="kb-cat kb-cat-removable" style={{ background: bg, color: fg }}>
                    {name}
                    <button type="button" onClick={() => onRemoveCategory(name)} aria-label={`Remove ${name}`}>&times;</button>
                  </span>
                );
              })}
              {!categories.length && <span className="kb-cat-empty">No categories yet</span>}
            </div>
            <form className="kb-cat-add" onSubmit={(event) => { event.preventDefault(); onAddCategory(catDraft); setCatDraft(''); }}>
              <input value={catDraft} maxLength={18} placeholder="New category…" aria-label="New category" onChange={(event) => setCatDraft(event.target.value)} />
              <button type="submit" className="kb-cat-add-btn" disabled={!catDraft.trim()}><i className="ph-bold ph-plus" /> Add category</button>
            </form>
          </div>

          <div className="kb-field kb-field-col">
            <span>Description</span>
            <textarea
              className="kb-detail-desc"
              rows={4}
              value={task.description || ''}
              placeholder="Add a description…"
              aria-label="Description"
              onChange={(event) => onPatch({ description: event.target.value })}
            />
          </div>
        </div>
        <footer className="kb-detail-foot">
          <span>Created by {task.byName || 'Anonymous'} · {formatDate(task.createdAt)}</span>
          <button type="button" className="kb-detail-del" onClick={onDelete}><i className="ph-bold ph-trash" /> Delete</button>
        </footer>
      </aside>
    </>
  );
}

export function Tasks({ roomId, user }) {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filterMember, setFilterMember] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [addingColumn, setAddingColumn] = useState(null);
  const [addDraft, setAddDraft] = useState('');
  const addInputRef = useRef(null);

  useEffect(() => onValue(ref(db, `room_tasks/${roomId}`), (snapshot) => {
    const value = snapshot.val() || {};
    setTasks(Object.entries(value).map(([id, task]) => ({ id, ...task })));
  }), [roomId]);

  useEffect(() => { if (addingColumn && addInputRef.current) addInputRef.current.focus(); }, [addingColumn]);

  const memberNames = useMemo(() => {
    const names = new Set();
    if (user?.displayName) names.add(user.displayName);
    tasks.forEach((task) => { if (task.assigneeName) names.add(task.assigneeName); });
    return [...names];
  }, [tasks, user]);

  const byColumn = useMemo(() => {
    const groups = Object.fromEntries(STATUS_IDS.map((id) => [id, []]));
    [...tasks]
      .filter((task) => filterMember === 'all' || task.assigneeName === filterMember)
      .filter((task) => filterPriority === 'all' || (task.priority || 'medium') === filterPriority)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach((task) => groups[statusOf(task)].push(task));
    return groups;
  }, [tasks, filterMember, filterPriority]);

  const selected = tasks.find((task) => task.id === selectedId) || null;

  const patchTask = (id, patch) => update(ref(db, `room_tasks/${roomId}/${id}`), patch);

  const addTask = async (status) => {
    const text = addDraft.trim();
    if (!text) { setAddingColumn(null); return; }
    await push(ref(db, `room_tasks/${roomId}`), {
      text,
      status,
      done: status === 'done',
      priority: 'medium',
      by: user.uid,
      byName: user.displayName,
      assignee: user.uid,
      assigneeName: user.displayName,
      createdAt: serverTimestamp(),
    });
    setAddDraft('');
    setAddingColumn(null);
    window.awardXP?.(user.uid, 'technical', 2);
  };

  const moveTask = (id, status) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || statusOf(task) === status) return;
    patchTask(id, { status, done: status === 'done' });
    if (status === 'done' && task.by === user.uid) window.awardXP?.(user.uid, 'technical', 3);
  };

  const deleteTask = (id) => { remove(ref(db, `room_tasks/${roomId}/${id}`)); if (selectedId === id) setSelectedId(null); };

  const addCategory = (id, name) => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
    if (clean) patchTask(id, { [`categories/${clean}`]: true });
  };
  const removeCategory = (id, name) => patchTask(id, { [`categories/${name}`]: null });

  return (
    <div className="kb-root">
      <div className="kb-topbar">
        <div className="kb-filters">
          <select className="kb-filter" value={filterMember} aria-label="Filter by member" onChange={(event) => setFilterMember(event.target.value)}>
            <option value="all">All members</option>
            {memberNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="kb-filter" value={filterPriority} aria-label="Filter by priority" onChange={(event) => setFilterPriority(event.target.value)}>
            <option value="all">All priorities</option>
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
          </select>
        </div>
      </div>

      <div className="kb-board">
        {COLUMNS.map((column) => (
          <section
            key={column.id}
            className="kb-col"
            onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('kb-col-over'); }}
            onDragLeave={(event) => event.currentTarget.classList.remove('kb-col-over')}
            onDrop={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove('kb-col-over');
              const id = event.dataTransfer.getData('text/taskId');
              if (id) moveTask(id, column.id);
            }}
          >
            <header className="kb-col-head">
              <span className="kb-dot" style={{ background: column.dot }} />
              <span className="kb-col-name">{column.name}</span>
              <span className="kb-col-count">{byColumn[column.id].length}</span>
              <button type="button" className="kb-add" title={`Add to ${column.name}`} aria-label={`Add to ${column.name}`} onClick={() => { setAddingColumn(column.id); setAddDraft(''); }}>
                <i className="ph-bold ph-plus" />
              </button>
            </header>
            <div className="kb-col-body">
              {addingColumn === column.id && (
                <div className="kb-add-card">
                  <textarea
                    ref={addInputRef}
                    className="kb-add-input"
                    rows={2}
                    value={addDraft}
                    placeholder="Task title…"
                    onChange={(event) => setAddDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); addTask(column.id); }
                      if (event.key === 'Escape') setAddingColumn(null);
                    }}
                  />
                  <div className="kb-add-actions">
                    <button type="button" className="kb-add-save" onClick={() => addTask(column.id)} disabled={!addDraft.trim()}>Add</button>
                    <button type="button" className="kb-add-cancel" onClick={() => setAddingColumn(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {byColumn[column.id].map((task) => <TaskCard key={task.id} task={task} onOpen={() => setSelectedId(task.id)} />)}
              {!byColumn[column.id].length && addingColumn !== column.id && <div className="kb-empty">No tasks</div>}
            </div>
          </section>
        ))}
      </div>

      {selected && (
        <TaskDetail
          task={selected}
          memberNames={memberNames}
          onClose={() => setSelectedId(null)}
          onPatch={(patch) => patchTask(selected.id, patch)}
          onDelete={() => deleteTask(selected.id)}
          onAddCategory={(name) => addCategory(selected.id, name)}
          onRemoveCategory={(name) => removeCategory(selected.id, name)}
        />
      )}
    </div>
  );
}
