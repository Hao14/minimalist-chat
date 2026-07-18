import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { onValue, push, ref, remove, serverTimestamp, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { useRoomTabActivity, useRoomTabDataActivity } from '../shell/roomTabActivity.js';
import './tasks.css';

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
const isArchivedTask = (task) => task.archived === true || task.status === 'archived';
const timestampNow = () => Date.now();
const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

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

function isDueSoon(value) {
  if (!value) return false;
  const due = new Date(`${value}T23:59:59`).getTime();
  const now = Date.now();
  return Number.isFinite(due) && due >= now && due - now <= 3 * 24 * 60 * 60 * 1000;
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
      aria-label={`Open task: ${task.text || 'Untitled task'}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
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

function TaskListRow({ task, onOpen }) {
  const priority = task.priority || 'medium';
  const due = formatDue(task.dueDate);
  const assignee = task.assigneeName;
  const categories = categoriesOf(task);
  return (
    <button type="button" className="kb-list-row" onClick={onOpen}>
      <span className={`kb-list-check ${statusOf(task) === 'done' ? 'is-done' : ''}`} aria-hidden="true">
        {statusOf(task) === 'done' ? <i className="ph-bold ph-check" /> : null}
      </span>
      <span className="kb-list-copy">
        <strong>{task.text || 'Untitled task'}</strong>
        <span>
          <i className={`kb-priority-dot kb-priority-${priority}`} aria-hidden="true" />
          {PRIORITY_LABEL[priority]}
          {categories[0] ? <> · {categories[0]}</> : null}
        </span>
      </span>
      {due ? <span className="kb-list-due"><i className="ph-bold ph-calendar-blank" /> {due}</span> : null}
      {assignee ? <span className="kb-ava" style={{ background: avatarColor(assignee) }} title={assignee}>{initials(assignee)}</span> : null}
      <i className="ph-bold ph-caret-right kb-list-open" aria-hidden="true" />
    </button>
  );
}

function TaskQuickAdd({ inputRef, onCancel, onChange, onSave, value }) {
  return (
    <div className="kb-add-card kb-quick-add">
      <input
        ref={inputRef}
        id="task-input"
        className="kb-add-input"
        value={value}
        placeholder="What needs to get done?"
        aria-label="Task title"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); onSave(); }
          if (event.key === 'Escape') onCancel();
        }}
      />
      <div className="kb-add-actions">
        <button type="button" className="kb-add-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="kb-add-save" onClick={onSave} disabled={!value.trim()}>Add task</button>
      </div>
    </div>
  );
}

function TaskDetail({ active, task, memberNames, onClose, onPatch, onDelete, onAddCategory, onRemoveCategory }) {
  const [catDraft, setCatDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState(task.text || '');
  const [descriptionDraft, setDescriptionDraft] = useState(task.description || '');
  const categories = categoriesOf(task);
  const closeButtonRef = useRef(null);
  const saveTextDrafts = () => {
    const patch = {};
    if (titleDraft !== (task.text || '')) patch.text = titleDraft;
    if (descriptionDraft !== (task.description || '')) patch.description = descriptionDraft;
    if (Object.keys(patch).length) onPatch(patch);
  };
  const closeWithSave = () => { saveTextDrafts(); onClose(); };
  const closeOnEscape = useEffectEvent(() => { saveTextDrafts(); onClose(); });
  useEffect(() => {
    if (!active) return undefined;
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeOnEscape();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
  return (
    <>
      <div className="kb-detail-backdrop" onClick={closeWithSave} />
      <aside className="kb-detail" role="dialog" aria-modal="true" aria-labelledby="kb-detail-title">
        <header className="kb-detail-head">
          <span id="kb-detail-title">Task detail</span>
          <button ref={closeButtonRef} type="button" className="kb-detail-close" onClick={closeWithSave} aria-label="Close task detail"><i className="ph-bold ph-x" /></button>
        </header>
        <div className="kb-detail-body">
          <textarea
            className="kb-detail-title"
            rows={2}
            value={titleDraft}
            placeholder="Task title"
            aria-label="Task title"
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => { if (titleDraft !== (task.text || '')) onPatch({ text: titleDraft }); }}
          />

          <label className="kb-field">
            <span>Status</span>
            <select value={statusOf(task)} onChange={(event) => {
              const status = event.target.value;
              onPatch({ status, done: status === 'done', completedAt: status === 'done' ? (task.completedAt || timestampNow()) : null });
            }}>
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
              value={descriptionDraft}
              placeholder="Add a description…"
              aria-label="Description"
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onBlur={() => { if (descriptionDraft !== (task.description || '')) onPatch({ description: descriptionDraft }); }}
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

function TasksRoom({ roomId, user }) {
  const isRoomTabActive = useRoomTabActivity('tasks');
  const isRoomTabDataActive = useRoomTabDataActivity('tasks');
  const [tasks, setTasks] = useState([]);
  const [archivedTasks, setArchivedTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filterMember, setFilterMember] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveFilter, setArchiveFilter] = useState('days');
  const [addingColumn, setAddingColumn] = useState(null);
  const [addDraft, setAddDraft] = useState('');
  const [viewMode, setViewMode] = useState(() => window.matchMedia?.('(max-width: 720px)').matches ? 'list' : 'board');
  const [listStatus, setListStatus] = useState('todo');
  const [tasksStatus, setTasksStatus] = useState({ roomId: null, loading: true, error: '' });
  const addInputRef = useRef(null);
  const allTasksRef = useRef([]);
  const taskReturnFocusRef = useRef(null);
  const loadingTasks = tasksStatus.roomId !== roomId || tasksStatus.loading;
  const tasksError = tasksStatus.roomId === roomId ? tasksStatus.error : '';

  const archiveDoneTasks = useCallback((taskList = allTasksRef.current) => {
    const cutoff = startOfToday();
    taskList.forEach((task) => {
      if (!task?.id || isArchivedTask(task) || statusOf(task) !== 'done') return;
      const completedAt = Number(task.completedAt || 0);
      if (!completedAt) {
        update(ref(db, `room_tasks/${roomId}/${task.id}`), { completedAt: Date.now() }).catch(() => {});
        return;
      }
      if (completedAt < cutoff) {
        update(ref(db, `room_tasks/${roomId}/${task.id}`), {
          archived: true,
          archivedAt: timestampNow(),
          archivedReason: 'End-of-day Done sweep',
          status: 'archived',
        }).catch(() => {});
        setSelectedId((current) => current === task.id ? null : current);
      }
    });
  }, [roomId]);

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    allTasksRef.current = [];
    return onValue(ref(db, `room_tasks/${roomId}`), (snapshot) => {
      const value = snapshot.val() || {};
      const nextTasks = Object.entries(value).map(([id, task]) => ({ id, ...task }));
      allTasksRef.current = nextTasks;
      setTasks(nextTasks.filter((task) => !isArchivedTask(task)));
      setArchivedTasks(nextTasks.filter(isArchivedTask));
      setTasksStatus({ roomId, loading: false, error: '' });
      archiveDoneTasks(nextTasks);
    }, (error) => {
      allTasksRef.current = [];
      setTasks([]);
      setArchivedTasks([]);
      setTasksStatus({ roomId, loading: false, error: error.message || 'Could not load tasks.' });
    });
  }, [archiveDoneTasks, isRoomTabDataActive, roomId]);

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    const interval = window.setInterval(() => archiveDoneTasks(), 60 * 1000);
    return () => window.clearInterval(interval);
  }, [archiveDoneTasks, isRoomTabDataActive]);

  useEffect(() => {
    if (isRoomTabActive && addingColumn && addInputRef.current) addInputRef.current.focus();
  }, [addingColumn, isRoomTabActive]);

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
  const openTaskDetail = useCallback((id) => {
    taskReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(id);
  }, []);
  const closeTaskDetail = useCallback(() => {
    setSelectedId(null);
    window.requestAnimationFrame(() => taskReturnFocusRef.current?.focus?.());
  }, []);
  const visibleTaskCount = useMemo(() => STATUS_IDS.reduce((sum, status) => sum + byColumn[status].length, 0), [byColumn]);
  const dueSoonCount = useMemo(() => tasks.filter((task) => statusOf(task) !== 'done' && isDueSoon(task.dueDate)).length, [tasks]);
  const visibleArchivedTasks = useMemo(() => {
    const now = timestampNow();
    const windows = {
      hours: 24 * 60 * 60 * 1000,
      days: 7 * 24 * 60 * 60 * 1000,
      weeks: 30 * 24 * 60 * 60 * 1000,
    };
    const windowMs = windows[archiveFilter] || windows.days;
    return [...archivedTasks]
      .filter((task) => now - Number(task.archivedAt || task.completedAt || task.createdAt || 0) <= windowMs)
      .sort((a, b) => Number(b.archivedAt || 0) - Number(a.archivedAt || 0));
  }, [archiveFilter, archivedTasks]);

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
      completedAt: status === 'done' ? timestampNow() : null,
      createdAt: serverTimestamp(),
    });
    setAddDraft('');
    setAddingColumn(null);
    window.awardXP?.(user.uid, 'technical', 2);
  };

  const moveTask = (id, status) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || statusOf(task) === status) return;
    patchTask(id, {
      status,
      done: status === 'done',
      completedAt: status === 'done' ? (task.completedAt || timestampNow()) : null,
    });
    if (status === 'done' && task.by === user.uid) window.awardXP?.(user.uid, 'technical', 3);
  };

  const deleteTask = (id) => {
    const task = tasks.find((item) => item.id === id);
    if (!window.confirm(`Delete “${task?.text || 'this task'}”?`)) return;
    remove(ref(db, `room_tasks/${roomId}/${id}`));
    if (selectedId === id) closeTaskDetail();
  };
  const restoreTask = (id) => patchTask(id, {
    archived: false,
    archivedAt: null,
    archivedReason: null,
    status: 'done',
    done: true,
    completedAt: timestampNow(),
  });

  const addCategory = (id, name) => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
    if (clean) patchTask(id, { [`categories/${clean}`]: true });
  };
  const removeCategory = (id, name) => patchTask(id, { [`categories/${name}`]: null });

  return (
    <div className="kb-root">
      <header className="kb-workspace-head">
        <div className="kb-workspace-title">
          <span className="kb-eyebrow"><i className="ph-bold ph-check-square-offset" /> Room workflow</span>
          <div>
            <h2>Tasks</h2>
            <span>{tasks.length} active · {dueSoonCount} due soon</span>
          </div>
          <p>Move work from idea to done without leaving the room.</p>
        </div>
        <button type="button" className="kb-new-task" onClick={() => { setAddingColumn(viewMode === 'list' ? listStatus : 'todo'); setAddDraft(''); }}>
          <i className="ph-bold ph-plus" /> <span>New task</span>
        </button>
      </header>

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
        <div className="kb-toolbar-actions">
          <div className="kb-view-switch" role="group" aria-label="Task layout">
            <button type="button" className={viewMode === 'board' ? 'active' : ''} aria-pressed={viewMode === 'board'} onClick={() => setViewMode('board')}><i className="ph-bold ph-columns" /><span>Board</span></button>
            <button type="button" className={viewMode === 'list' ? 'active' : ''} aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}><i className="ph-bold ph-list-bullets" /><span>List</span></button>
          </div>
          <button type="button" className={`kb-archive-toggle ${archiveOpen ? 'active' : ''}`} aria-expanded={archiveOpen} aria-controls="kb-archive-panel" onClick={() => setArchiveOpen((value) => !value)}>
            <i className="ph-bold ph-archive-box" /> <span>Archive</span>
            {archivedTasks.length ? <strong>{archivedTasks.length}</strong> : null}
          </button>
        </div>
      </div>

      {archiveOpen ? (
        <section className="kb-archive-panel" id="kb-archive-panel" aria-label="Completed task archive">
          <header>
            <div>
              <span className="kb-archive-kicker">Completed archive</span>
              <h3>Done tasks that aged out</h3>
            </div>
            <div className="kb-archive-filters" role="tablist" aria-label="Archive time range">
              {[
                ['hours', 'Hours'],
                ['days', 'Days'],
                ['weeks', 'Weeks'],
              ].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={archiveFilter === id} className={archiveFilter === id ? 'active' : ''} onClick={() => setArchiveFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </header>
          <div className="kb-archive-list">
            {visibleArchivedTasks.length ? visibleArchivedTasks.map((task) => (
              <article className="kb-archive-item" key={task.id}>
                <div>
                  <strong>{task.text || 'Untitled task'}</strong>
                  <small>
                    Archived {formatDate(task.archivedAt || task.completedAt)} · {task.assigneeName || task.byName || 'Unassigned'}
                  </small>
                </div>
                <button type="button" onClick={() => restoreTask(task.id)}>Restore</button>
              </article>
            )) : (
              <div className="kb-archive-empty">No completed tasks in this range yet.</div>
            )}
          </div>
        </section>
      ) : null}

      {loadingTasks || tasksError || (!tasks.length && !addingColumn) || (tasks.length > 0 && !visibleTaskCount) ? (
        <div className={`kb-state ${tasksError ? 'error' : ''}`} role={loadingTasks ? 'status' : tasksError ? 'alert' : 'note'}>
          {loadingTasks ? 'Loading tasks...' : tasksError || (!tasks.length ? 'No tasks yet. Add one from any column when this room has work to track.' : 'No tasks match the current filters.')}
        </div>
      ) : null}

      {viewMode === 'list' ? (
        <div className="kb-list-view">
          <div className="kb-status-tabs" role="tablist" aria-label="Task status">
            {COLUMNS.map((column) => (
              <button key={column.id} type="button" role="tab" aria-selected={listStatus === column.id} className={listStatus === column.id ? 'active' : ''} onClick={() => setListStatus(column.id)}>
                <span>{column.name}</span><strong>{byColumn[column.id].length}</strong>
              </button>
            ))}
          </div>
          <section className="kb-list-panel" aria-label={`${COLUMNS.find((column) => column.id === listStatus)?.name || 'Selected'} tasks`}>
            <header>
              <div><span className="kb-dot" style={{ background: COLUMNS.find((column) => column.id === listStatus)?.dot }} /><strong>{COLUMNS.find((column) => column.id === listStatus)?.name}</strong><small>{byColumn[listStatus].length} tasks</small></div>
              <button type="button" onClick={() => { setAddingColumn(listStatus); setAddDraft(''); }}><i className="ph-bold ph-plus" /> Add task</button>
            </header>
            {addingColumn === listStatus ? <TaskQuickAdd inputRef={addInputRef} value={addDraft} onChange={setAddDraft} onSave={() => addTask(listStatus)} onCancel={() => setAddingColumn(null)} /> : null}
            <div className="kb-list-rows">
              {byColumn[listStatus].map((task) => <TaskListRow key={task.id} task={task} onOpen={() => openTaskDetail(task.id)} />)}
              {!byColumn[listStatus].length && addingColumn !== listStatus ? <div className="kb-empty">Nothing here yet. Add the first task.</div> : null}
            </div>
          </section>
        </div>
      ) : <div className="kb-board">
        {COLUMNS.map((column) => (
          <section
            key={column.id}
            className="kb-col"
            aria-label={`${column.name} tasks`}
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
                <TaskQuickAdd inputRef={addInputRef} value={addDraft} onChange={setAddDraft} onSave={() => addTask(column.id)} onCancel={() => setAddingColumn(null)} />
              )}
              {byColumn[column.id].map((task) => <TaskCard key={task.id} task={task} onOpen={() => openTaskDetail(task.id)} />)}
              {!byColumn[column.id].length && addingColumn !== column.id && <div className="kb-empty">No tasks</div>}
            </div>
          </section>
        ))}
      </div>}

      {selected && (
        <TaskDetail
          active={isRoomTabActive}
          key={selected.id}
          task={selected}
          memberNames={memberNames}
          onClose={closeTaskDetail}
          onPatch={(patch) => patchTask(selected.id, patch)}
          onDelete={() => deleteTask(selected.id)}
          onAddCategory={(name) => addCategory(selected.id, name)}
          onRemoveCategory={(name) => removeCategory(selected.id, name)}
        />
      )}
    </div>
  );
}

export function Tasks(props) {
  return <TasksRoom key={props.roomId} {...props} />;
}
