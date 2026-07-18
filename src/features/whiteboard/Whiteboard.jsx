import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, onValue, push, ref, runTransaction, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { useRoomTabActivity, useRoomTabDataActivity } from '../shell/roomTabActivity.js';
import './whiteboard.css';

const BOARD_WIDTH = 3200;
const BOARD_HEIGHT = 2200;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const MAX_HISTORY = 80;

const colors = ['#5967C9', '#42CE91', '#FFAD7A', '#FF7479', '#C668EF', '#FFDA73', '#85827D'];
const contributorColors = ['#5967C9', '#42B883', '#ED9851', '#D94D63', '#9B62D1'];
const itemTypes = new Set(['note', 'text', 'rect', 'ellipse', 'connector']);
const tools = [
  ['hand', 'wb:hand', 'Hand tool', 'H'],
  ['select', 'ph-cursor', 'Select and move', 'V'],
  ['note', 'wb:note', 'Place a note', 'N'],
  ['text', 'ph-text-t', 'Text', 'T'],
  ['rect', 'ph-square', 'Rectangle', 'R'],
  ['ellipse', 'ph-circle', 'Circle', 'O'],
  ['connector', 'wb:connector', 'Connector', 'L'],
];
const resizeHandles = [
  ['nw', 'top left'], ['n', 'top'], ['ne', 'top right'], ['e', 'right'],
  ['se', 'bottom right'], ['s', 'bottom'], ['sw', 'bottom left'], ['w', 'left'],
];

function isRoomManager(roomData = {}, user) {
  if (!user?.uid) return false;
  if (user.uid === window.MY_ADMIN_UID) return true;
  return roomData.creatorId === user.uid;
}

function permissionAllowed(roomData = {}, key, user) {
  if (!user?.uid || !Object.prototype.hasOwnProperty.call(roomData.members || {}, user.uid)) return false;
  const overrides = roomData.memberPermissions?.[user.uid];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] !== false;
  if (Object.prototype.hasOwnProperty.call(roomData.permissions || {}, key)) return roomData.permissions[key] !== false;
  return true;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function eventTargetElement(event) {
  const target = event.target;
  if (target instanceof Element) return target;
  return target?.parentElement || null;
}

function normalizeItem(id, raw = {}) {
  const type = itemTypes.has(raw.type) ? raw.type : 'note';
  const fallbackWidth = type === 'note' ? 190 : type === 'text' ? 220 : type === 'connector' ? 180 : 180;
  const fallbackHeight = type === 'note' ? 130 : type === 'text' ? 72 : type === 'connector' ? 48 : 130;
  const min = minimumSize(type);
  const width = Math.round(clamp(safeNumber(raw.w, fallbackWidth), min.w, BOARD_WIDTH));
  const height = Math.round(clamp(safeNumber(raw.h, fallbackHeight), min.h, BOARD_HEIGHT));
  const createdAt = safeNumber(raw.createdAt, 0);
  return {
    id,
    type,
    text: typeof raw.text === 'string' ? raw.text : '',
    x: Math.round(clamp(safeNumber(raw.x, 40), 0, BOARD_WIDTH - width)),
    y: Math.round(clamp(safeNumber(raw.y, 40), 0, BOARD_HEIGHT - height)),
    w: width,
    h: height,
    color: typeof raw.color === 'string' ? raw.color : colors[0],
    directionX: [-1, 0, 1].includes(raw.directionX) ? raw.directionX : 1,
    directionY: [-1, 0, 1].includes(raw.directionY) ? raw.directionY : 0,
    by: typeof raw.by === 'string' ? raw.by : '',
    byName: typeof raw.byName === 'string' ? raw.byName : '',
    createdAt,
    updatedAt: safeNumber(raw.updatedAt, 0),
    version: Math.max(0, Math.floor(safeNumber(raw.version, 0))),
    z: safeNumber(raw.z, createdAt),
  };
}

function itemPayload(item) {
  const payload = { ...item };
  delete payload.id;
  return payload;
}

function isTextItem(item) {
  return item.type === 'note' || item.type === 'text';
}

function displayNameFor(user = {}) {
  const profileName = String(user.displayName || '').trim();
  if (profileName && profileName !== 'Anonymous') return profileName;
  const emailName = String(user.email || '').split('@')[0]?.trim();
  return emailName || 'Room member';
}

function initialsFor(name) {
  const parts = String(name || 'Room member').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'RM';
}

function minimumSize(type) {
  if (type === 'note') return { w: 150, h: 100 };
  if (type === 'text') return { w: 110, h: 48 };
  if (type === 'connector') return { w: 40, h: 28 };
  return { w: 60, h: 50 };
}

function resizedGeometry(before, handle, dx, dy, type) {
  const min = minimumSize(type);
  const right = before.x + before.w;
  const bottom = before.y + before.h;
  const next = { ...before };

  if (handle.includes('e')) next.w = clamp(before.w + dx, min.w, BOARD_WIDTH - before.x);
  if (handle.includes('s')) next.h = clamp(before.h + dy, min.h, BOARD_HEIGHT - before.y);
  if (handle.includes('w')) {
    next.x = clamp(before.x + dx, 0, right - min.w);
    next.w = right - next.x;
  }
  if (handle.includes('n')) {
    next.y = clamp(before.y + dy, 0, bottom - min.h);
    next.h = bottom - next.y;
  }

  return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, Math.round(value)]));
}

function historyItemId(action) {
  return action?.id || action?.item?.id || '';
}

function revisionToken(raw) {
  if (!raw || typeof raw !== 'object') return { exists: false, version: 0, updatedAt: 0 };
  return {
    exists: true,
    version: Math.max(0, Math.floor(safeNumber(raw.version, 0))),
    updatedAt: safeNumber(raw.updatedAt, 0),
  };
}

function revisionMatches(raw, expected) {
  const current = revisionToken(raw);
  return current.exists === Boolean(expected?.exists)
    && (!current.exists || (current.version === expected.version && current.updatedAt === expected.updatedAt));
}

function fieldsMatch(raw, expected = {}) {
  return Object.entries(expected).every(([key, value]) => raw?.[key] === value);
}

function elementIsVisible(element) {
  if (!element?.isConnected || document.visibilityState === 'hidden') return false;
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function WhiteboardIcon({ name }) {
  if (name === 'hand') {
    return (
      <svg className="wb-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 11.5V7a1.5 1.5 0 0 1 3 0v3.5-5a1.5 1.5 0 0 1 3 0v5-3.5a1.5 1.5 0 0 1 3 0v4-2a1.5 1.5 0 0 1 3 0v4.2c0 4.3-2.7 6.8-6.7 6.8h-.6a5.6 5.6 0 0 1-5.1-3.3L4.6 11a1.6 1.6 0 0 1 2.9-1.3l1.3 2.7" />
      </svg>
    );
  }
  if (name === 'note') {
    return (
      <svg className="wb-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 3.75h10.5L19 7.3v12.95H5z" />
        <path d="M15.5 3.75V7.5H19M8.25 11h7.5M8.25 14.5h5.5" />
      </svg>
    );
  }
  if (name === 'connector') {
    return (
      <svg className="wb-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="18" r="2" />
        <path d="M7 6h2.5a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3H17" />
      </svg>
    );
  }
  if (name === 'redo') {
    return (
      <svg className="wb-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 8.25 21.5 6 19 3.75M21 6h-8.2A7.8 7.8 0 0 0 5 13.8v1.2" />
      </svg>
    );
  }
  if (name === 'copy') {
    return (
      <svg className="wb-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="11" height="11" rx="1.5" />
        <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-10A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17H8" />
      </svg>
    );
  }
  return (
    <svg className="wb-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}

function ConnectorSurface({ item }) {
  const width = Math.max(1, item.w);
  const height = Math.max(1, item.h);
  const markerId = `wb-arrow-${String(item.id || 'draft').replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const x1 = item.directionX === 0 ? width / 2 : item.directionX > 0 ? 5 : width - 5;
  const x2 = item.directionX === 0 ? width / 2 : item.directionX > 0 ? width - 8 : 8;
  const y1 = item.directionY === 0 ? height / 2 : item.directionY > 0 ? 5 : height - 5;
  const y2 = item.directionY === 0 ? height / 2 : item.directionY > 0 ? height - 8 : 8;

  return (
    <svg className="wb-connector-surface" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <marker id={markerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L7,3 z" fill="currentColor" />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={`url(#${markerId})`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function WhiteboardItem({
  item,
  selected,
  activeTool,
  canEdit,
  zoom,
  editing,
  onSelect,
  onDelete,
  onMove,
  onResize,
  onSaveText,
  onStartEditing,
  onFinishEditing,
}) {
  const [draftText, setDraftText] = useState(item.text || '');
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const resize = useRef(null);
  const suppressEditClickUntil = useRef(0);
  const editorRef = useRef(null);
  const editBase = useRef(null);
  const canMove = canEdit && activeTool === 'select' && !editing;

  useEffect(() => {
    if (!editing) return undefined;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange?.(editorRef.current.value.length, editorRef.current.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing, item.id, item.text]);

  const startEditing = () => {
    if (!canEdit || !isTextItem(item)) return;
    if (Date.now() < suppressEditClickUntil.current) return;
    editBase.current = { ...item };
    setDraftText(item.text || '');
    onStartEditing(item.id);
  };

  const beginDrag = (event) => {
    if (event.button !== 0) return;
    const target = eventTargetElement(event);
    if (target?.closest('textarea, input, .wb-item-action, .wb-resize-handle')) return;
    onSelect(item.id);
    if (!canMove) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.x,
      originY: item.y,
      lastX: item.x,
      lastY: item.y,
      moved: false,
      startedOnEditableText: Boolean(target?.closest('.wb-note-text, .wb-free-text')),
      expectedItem: { ...item },
    };
    setDragging(true);
  };

  const moveDrag = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const movedDistance = Math.hypot(event.clientX - drag.current.startX, event.clientY - drag.current.startY);
    if (movedDistance > 4) drag.current.moved = true;
    const x = clamp(drag.current.originX + (event.clientX - drag.current.startX) / zoom, 0, BOARD_WIDTH - item.w);
    const y = clamp(drag.current.originY + (event.clientY - drag.current.startY) / zoom, 0, BOARD_HEIGHT - item.h);
    drag.current.lastX = x;
    drag.current.lastY = y;
    onMove(item.id, x, y, false);
  };

  const endDrag = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const { originX, originY, lastX, lastY, moved, startedOnEditableText, expectedItem } = drag.current;
    drag.current = null;
    setDragging(false);
    if (moved) suppressEditClickUntil.current = Date.now() + 220;
    onMove(item.id, lastX, lastY, true, { x: originX, y: originY }, expectedItem);
    if (!moved && startedOnEditableText) window.setTimeout(startEditing, 0);
  };

  const cancelDrag = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const { originX, originY } = drag.current;
    drag.current = null;
    setDragging(false);
    onMove(item.id, originX, originY, false);
  };

  const beginResize = (event, handle) => {
    if (!canMove) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      before: { x: item.x, y: item.y, w: item.w, h: item.h },
      last: { x: item.x, y: item.y, w: item.w, h: item.h },
      expectedItem: { ...item },
    };
  };

  const moveResize = (event) => {
    if (!resize.current || resize.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const { handle, startX, startY, before } = resize.current;
    const dx = (event.clientX - startX) / zoom;
    const dy = (event.clientY - startY) / zoom;
    const next = resizedGeometry(before, handle, dx, dy, item.type);
    resize.current.last = next;
    onResize(item.id, next, false);
  };

  const resizeWithKeyboard = (event, handle) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const before = { x: item.x, y: item.y, w: item.w, h: item.h };
    const next = resizedGeometry(before, handle, dx, dy, item.type);
    if (Object.keys(before).every((key) => before[key] === next[key])) return;
    onResize(item.id, next, true, before);
  };

  const endResize = (event) => {
    if (!resize.current || resize.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const { before, last, expectedItem } = resize.current;
    resize.current = null;
    onResize(item.id, last, true, before, expectedItem);
  };

  const cancelResize = (event) => {
    if (!resize.current || resize.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const { before } = resize.current;
    resize.current = null;
    onResize(item.id, before, false);
  };

  const commonStyle = {
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
    zIndex: Math.max(1, Math.round(item.z || 1)),
    '--item-color': item.color,
    '--wb-inverse-zoom': 1 / Math.max(zoom, MIN_ZOOM),
  };
  const ownerName = item.byName || 'Room member';
  const itemLabel = item.type === 'note' ? `Note: ${item.text || 'Empty note'}`
    : item.type === 'text' ? `Text: ${item.text || 'Empty text'}`
      : item.type === 'rect' ? 'Rectangle'
        : item.type === 'ellipse' ? 'Circle'
          : 'Connector';

  return (
    <article
      className={`wb-item wb-${item.type} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      style={commonStyle}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onDoubleClick={startEditing}
      onFocus={() => onSelect(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && isTextItem(item) && !editing) {
          event.preventDefault();
          startEditing();
        }
      }}
      tabIndex={activeTool === 'select' ? 0 : -1}
      aria-label={itemLabel}
    >
      {item.type === 'rect' || item.type === 'ellipse' ? <div className="wb-shape-surface" /> : null}
      {item.type === 'connector' ? <ConnectorSurface item={item} /> : null}

      {isTextItem(item) && editing ? (
        <textarea
          ref={editorRef}
          className="wb-text-editor"
          value={draftText}
          autoFocus
          aria-label={item.type === 'note' ? 'Edit note' : 'Edit text'}
          onChange={(event) => setDraftText(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            onSaveText(item.id, event.target.value, editBase.current || item);
            editBase.current = null;
            onFinishEditing();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraftText(item.text || '');
              editBase.current = null;
              onFinishEditing();
            }
          }}
        />
      ) : null}

      {item.type === 'note' && !editing ? (
        <>
          <button type="button" className="wb-note-text" onClick={startEditing}>
            {item.text || 'Click to write…'}
          </button>
          <div className="wb-note-meta"><i className="ph-bold ph-user-circle" aria-hidden="true" /> {ownerName}</div>
        </>
      ) : null}

      {item.type === 'text' && !editing ? (
        <button type="button" className="wb-free-text" onClick={startEditing}>
          {item.text || 'Click to type…'}
        </button>
      ) : null}

      {selected && canMove ? resizeHandles.map(([handle, label]) => (
        <button
          key={handle}
          type="button"
          className={`wb-resize-handle is-${handle}`}
          aria-label={`Resize ${itemLabel} from ${label}. Use arrow keys; hold Shift for 10 pixels.`}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          title={`Resize from ${label} with pointer or arrow keys`}
          onPointerDown={(event) => beginResize(event, handle)}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
          onKeyDown={(event) => resizeWithKeyboard(event, handle)}
        />
      )) : null}

      {selected && canEdit ? (
        <button
          type="button"
          className="wb-item-action wb-item-delete-quick"
          aria-label={`Delete ${itemLabel}`}
          title="Delete"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDelete(item.id)}
        >
          <i className="ph-bold ph-trash" aria-hidden="true" />
        </button>
      ) : null}
    </article>
  );
}

export function Whiteboard({ roomId, user }) {
  const isRoomTabActive = useRoomTabActivity('whiteboard');
  const isRoomTabDataActive = useRoomTabDataActivity('whiteboard');
  const [items, setItems] = useState([]);
  const [color, setColor] = useState(colors[0]);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedId, setSelectedId] = useState('');
  const [zoom, setZoom] = useState(1);
  const [draftShape, setDraftShape] = useState(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [boardStatus, setBoardStatus] = useState({ roomId: null, loading: true, error: '' });
  const [canEditBoard, setCanEditBoard] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState({ roomId: null, loading: roomId !== 'global' });
  const [syncState, setSyncState] = useState({ status: 'loading', version: 0, savedAt: null, error: '' });
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [viewport, setViewport] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const canvasRef = useRef(null);
  const workspaceRef = useRef(null);
  const worldRef = useRef(null);
  const zoomRef = useRef(1);
  const spawnOffset = useRef(0);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const shapeDrag = useRef(null);
  const pan = useRef(null);
  const clearDialogRef = useRef(null);
  const clearCandidatesRef = useRef([]);
  const helpDialogRef = useRef(null);
  const writeVersionRef = useRef(0);
  const pendingWriteVersionsRef = useRef(new Set());
  const latestSuccessfulWriteRef = useRef(0);
  const latestFailedWriteRef = useRef(0);
  const latestWriteErrorRef = useRef('');
  const lastItemRevisionRef = useRef(0);
  const boardLoading = boardStatus.roomId !== roomId || boardStatus.loading;
  const boardError = boardStatus.roomId === roomId ? boardStatus.error : '';
  const permissionLoading = roomId !== 'global' && (permissionStatus.roomId !== roomId || permissionStatus.loading);
  const boardCanEdit = Boolean(user?.uid) && (roomId === 'global' || (!permissionLoading && canEditBoard));
  const selectedItem = items.find((item) => item.id === selectedId) || null;
  const canUndo = historyCounts.undo > 0;
  const canRedo = historyCounts.redo > 0;

  const contributors = useMemo(() => {
    const people = new Map();
    if (user?.uid) people.set(user.uid, { uid: user.uid, name: displayNameFor(user) });
    for (const item of items) {
      if (!item.by) continue;
      people.set(item.by, { uid: item.by, name: item.byName || 'Room member' });
    }
    return [...people.values()];
  }, [items, user]);

  const updateViewport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const currentZoom = zoomRef.current || 1;
    const next = {
      x: canvas.scrollLeft / currentZoom,
      y: canvas.scrollTop / currentZoom,
      w: canvas.clientWidth / currentZoom,
      h: canvas.clientHeight / currentZoom,
    };
    setViewport((current) => (
      Math.abs(current.x - next.x) < 0.5
      && Math.abs(current.y - next.y) < 0.5
      && Math.abs(current.w - next.w) < 0.5
      && Math.abs(current.h - next.h) < 0.5
    ) ? current : next);
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
    if (!isRoomTabActive) return undefined;
    const frame = window.requestAnimationFrame(updateViewport);
    return () => window.cancelAnimationFrame(frame);
  }, [isRoomTabActive, updateViewport, zoom]);

  useEffect(() => {
    if (!isRoomTabActive) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener('scroll', updateViewport, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateViewport) : null;
    observer?.observe(canvas);
    updateViewport();
    return () => {
      canvas.removeEventListener('scroll', updateViewport);
      observer?.disconnect();
    };
  }, [isRoomTabActive, updateViewport]);

  useEffect(() => {
    if (!isRoomTabDataActive) return undefined;
    const notesRef = ref(db, `whiteboards/${roomId}/notes`);
    return onValue(notesRef, (snapshot) => {
      const value = snapshot.val() || {};
      const loadedItems = Object.entries(value)
        .map(([id, item]) => normalizeItem(id, item))
        .sort((a, b) => (a.z || a.createdAt || 0) - (b.z || b.createdAt || 0));
      lastItemRevisionRef.current = Math.max(
        lastItemRevisionRef.current,
        ...loadedItems.map((item) => item.updatedAt || 0),
      );
      setItems(loadedItems);
      setBoardStatus({ roomId, loading: false, error: '' });
      if (!pendingWriteVersionsRef.current.size) {
        setSyncState((current) => current.status === 'loading'
          ? { ...current, status: 'saved', error: '' }
          : current);
      }
    }, (error) => {
      setItems([]);
      setBoardStatus({ roomId, loading: false, error: error.message || 'Could not load the whiteboard.' });
      setSyncState((current) => ({ ...current, status: 'error', error: error.message || 'Could not load the whiteboard.' }));
    });
  }, [isRoomTabDataActive, roomId]);

  useEffect(() => {
    if (!isRoomTabDataActive || roomId === 'global') {
      return undefined;
    }

    return onValue(ref(db, `rooms_meta/${roomId}`), (snapshot) => {
      const roomData = snapshot.val() || {};
      const allowed = isRoomManager(roomData, user) || permissionAllowed(roomData, 'whiteboard', user);
      setCanEditBoard(allowed);
      setPermissionStatus({ roomId, loading: false });
      if (!allowed) {
        setActiveTool('hand');
        setEditingId('');
      }
    }, () => {
      setCanEditBoard(false);
      setPermissionStatus({ roomId, loading: false });
      setActiveTool('hand');
      setEditingId('');
    });
  }, [isRoomTabDataActive, roomId, user]);

  useEffect(() => {
    if (!isRoomTabActive) return undefined;
    const open = confirmClearOpen ? { ref: clearDialogRef, close: () => setConfirmClearOpen(false) }
      : helpOpen ? { ref: helpDialogRef, close: () => setHelpOpen(false) } : null;
    if (!open) return undefined;
    const previous = document.activeElement;
    const frame = window.requestAnimationFrame(() => open.ref.current?.querySelector('button')?.focus());
    const handleDialogKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        open.close();
        return;
      }
      if (event.key !== 'Tab' || !open.ref.current) return;
      const focusable = [...open.ref.current.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleDialogKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleDialogKey);
      previous?.focus?.();
    };
  }, [confirmClearOpen, helpOpen, isRoomTabActive]);

  const notesRef = useCallback(() => ref(db, `whiteboards/${roomId}/notes`), [roomId]);
  const itemRef = useCallback((id) => ref(db, `whiteboards/${roomId}/notes/${id}`), [roomId]);

  const touchHistory = useCallback(() => {
    setHistoryCounts({ undo: undoStack.current.length, redo: redoStack.current.length });
  }, []);

  const pushAction = useCallback((action) => {
    undoStack.current.push(action);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    touchHistory();
  }, [touchHistory]);

  const nextItemRevision = useCallback(() => {
    const revision = Math.max(Date.now(), lastItemRevisionRef.current + 1);
    lastItemRevisionRef.current = revision;
    return revision;
  }, []);

  const writeChange = useCallback(async (operation, failureMessage) => {
    const writeVersion = writeVersionRef.current + 1;
    writeVersionRef.current = writeVersion;
    pendingWriteVersionsRef.current.add(writeVersion);
    setSyncState((current) => ({ ...current, status: 'saving', version: Math.max(current.version, writeVersion) }));
    try {
      const value = await operation();
      latestSuccessfulWriteRef.current = Math.max(latestSuccessfulWriteRef.current, writeVersion);
      return { ok: true, value };
    } catch (error) {
      latestFailedWriteRef.current = Math.max(latestFailedWriteRef.current, writeVersion);
      latestWriteErrorRef.current = `${failureMessage}: ${error.message || 'Please try again.'}`;
      window.showToast?.(latestWriteErrorRef.current);
      return { ok: false, value: null };
    } finally {
      pendingWriteVersionsRef.current.delete(writeVersion);
      let latestPending = 0;
      for (const version of pendingWriteVersionsRef.current) latestPending = Math.max(latestPending, version);
      if (latestPending) {
        setSyncState((current) => ({ ...current, status: 'saving', version: Math.max(current.version, latestPending) }));
      } else {
        const failedVersion = latestFailedWriteRef.current;
        const successfulVersion = latestSuccessfulWriteRef.current;
        const hasCurrentError = failedVersion > successfulVersion;
        setSyncState({
          status: hasCurrentError ? 'error' : 'saved',
          version: Math.max(writeVersion, failedVersion, successfulVersion),
          savedAt: hasCurrentError ? null : Date.now(),
          error: hasCurrentError ? latestWriteErrorRef.current : '',
        });
      }
    }
  }, []);

  const commitItemPatch = useCallback(async (id, expectedItem, patch) => {
    const updatedAt = nextItemRevision();
    const result = await runTransaction(itemRef(id), (current) => {
      if (!revisionMatches(current, revisionToken(expectedItem))) return undefined;
      const currentRevision = revisionToken(current);
      return {
        ...current,
        ...patch,
        version: currentRevision.version + 1,
        updatedAt,
      };
    }, { applyLocally: false });

    if (!result.committed) throw new Error('This item changed for someone else. Try the action again.');
    const raw = result.snapshot.val();
    return { item: normalizeItem(id, raw), expected: revisionToken(raw) };
  }, [itemRef, nextItemRevision]);

  const commitItemDelete = useCallback(async (id, expectedItem) => {
    let deletedItem = null;
    const result = await runTransaction(itemRef(id), (current) => {
      if (!revisionMatches(current, revisionToken(expectedItem))) return undefined;
      deletedItem = normalizeItem(id, current);
      return null;
    }, { applyLocally: false });

    if (!result.committed) throw new Error('This item changed for someone else. Review it before deleting.');
    return { item: deletedItem, expected: revisionToken(null) };
  }, [itemRef]);

  const restoreItemFromSource = useCallback(async (id, fallbackItem) => {
    try {
      const snapshot = await get(itemRef(id));
      const remoteItem = snapshot.exists() ? normalizeItem(id, snapshot.val()) : null;
      setItems((current) => {
        const withoutItem = current.filter((item) => item.id !== id);
        if (!remoteItem) return withoutItem;
        return [...withoutItem, remoteItem].sort((a, b) => (a.z || a.createdAt || 0) - (b.z || b.createdAt || 0));
      });
    } catch {
      if (!fallbackItem) return;
      setItems((current) => current.map((item) => item.id === id ? fallbackItem : item));
    }
  }, [itemRef]);

  const whiteboardAllowed = useCallback(async () => {
    if (!user?.uid) {
      setCanEditBoard(false);
      setActiveTool('hand');
      window.showToast?.('Sign in to edit this whiteboard.');
      return false;
    }
    if (roomId === 'global') return true;
    let snap;
    try {
      snap = await get(ref(db, `rooms_meta/${roomId}`));
    } catch {
      setCanEditBoard(false);
      setActiveTool('hand');
      window.showToast?.('Could not verify whiteboard permission. Try again in a moment.');
      return false;
    }
    const roomData = snap.exists() ? snap.val() : {};
    if (!isRoomManager(roomData, user) && !permissionAllowed(roomData, 'whiteboard', user)) {
      setCanEditBoard(false);
      setActiveTool('hand');
      window.showToast?.('Whiteboard editing is disabled in this room.');
      return false;
    }
    setCanEditBoard(true);
    return true;
  }, [roomId, user]);

  const addItem = useCallback(async (payload, options = {}) => {
    if (!(await whiteboardAllowed())) return null;
    const nextRef = push(notesRef());
    const now = Date.now();
    const revision = nextItemRevision();
    const nextItem = normalizeItem(nextRef.key, {
      ...payload,
      by: user?.uid || '',
      byName: displayNameFor(user),
      createdAt: now,
      updatedAt: revision,
      version: 1,
      z: Math.max(now, ...items.map((item) => item.z || 0)) + 1,
    });
    const { ok: saved } = await writeChange(() => set(nextRef, itemPayload(nextItem)), 'Could not add this item');
    if (!saved) return null;
    pushAction({ kind: 'add', item: nextItem, expected: revisionToken(nextItem) });
    setSelectedId(nextRef.key || '');
    if (options.edit !== false && isTextItem(nextItem)) setEditingId(nextRef.key || '');
    window.awardXP?.(user?.uid, 'creativity', payload.type === 'note' ? 3 : 2);
    return nextItem;
  }, [items, nextItemRevision, notesRef, pushAction, user, whiteboardAllowed, writeChange]);

  const visibleSpawnPoint = useCallback(() => {
    const canvas = canvasRef.current;
    spawnOffset.current = (spawnOffset.current + 36) % 216;
    const x = ((canvas?.scrollLeft || 0) + 64) / zoomRef.current + spawnOffset.current;
    const y = ((canvas?.scrollTop || 0) + 126) / zoomRef.current + spawnOffset.current;
    return {
      x: clamp(x, 0, BOARD_WIDTH - 220),
      y: clamp(y, 0, BOARD_HEIGHT - 150),
    };
  }, []);

  const addNoteFromToolbar = useCallback(async () => {
    if (!boardCanEdit && !permissionLoading) {
      window.showToast?.('Whiteboard editing is disabled in this room.');
      return;
    }
    const point = visibleSpawnPoint();
    const created = await addItem({ type: 'note', text: '', color, x: point.x, y: point.y, w: 190, h: 130 });
    if (created) setActiveTool('select');
    setCreateMenuOpen(false);
  }, [addItem, boardCanEdit, color, permissionLoading, visibleSpawnPoint]);

  const canvasPoint = (event) => {
    const world = worldRef.current;
    if (!world) return { x: 0, y: 0 };
    const rectValue = world.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rectValue.left) / zoomRef.current, 0, BOARD_WIDTH),
      y: clamp((event.clientY - rectValue.top) / zoomRef.current, 0, BOARD_HEIGHT),
    };
  };

  const moveItem = useCallback((id, x, y, persist, before, expectedItem) => {
    const currentItem = items.find((item) => item.id === id);
    if (!currentItem) return;
    const mutationBase = expectedItem || currentItem;
    const nextX = Math.round(clamp(x, 0, BOARD_WIDTH - (currentItem?.w || 0)));
    const nextY = Math.round(clamp(y, 0, BOARD_HEIGHT - (currentItem?.h || 0)));
    setItems((current) => current.map((item) => item.id === id ? { ...item, x: nextX, y: nextY } : item));
    if (!persist || !before || (Math.round(before.x) === nextX && Math.round(before.y) === nextY)) return;
    void (async () => {
      if (!(await whiteboardAllowed())) {
        await restoreItemFromSource(id, { ...mutationBase, ...before });
        return;
      }
      const after = { x: nextX, y: nextY };
      const { ok: saved, value: outcome } = await writeChange(
        () => commitItemPatch(id, mutationBase, after),
        'Could not move this item',
      );
      if (saved) {
        setItems((current) => current.map((item) => item.id === id ? outcome.item : item));
        pushAction({ kind: 'update', id, before, after, expected: outcome.expected });
      } else {
        await restoreItemFromSource(id, { ...mutationBase, ...before });
      }
    })();
  }, [commitItemPatch, items, pushAction, restoreItemFromSource, whiteboardAllowed, writeChange]);

  const resizeItem = useCallback((id, geometry, persist, before, expectedItem) => {
    const currentItem = items.find((item) => item.id === id);
    if (!currentItem) return;
    const mutationBase = expectedItem || currentItem;
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...geometry } : item));
    if (!persist || !before || Object.keys(before).every((key) => Math.round(before[key]) === Math.round(geometry[key]))) return;
    void (async () => {
      if (!(await whiteboardAllowed())) {
        await restoreItemFromSource(id, { ...mutationBase, ...before });
        return;
      }
      const { ok: saved, value: outcome } = await writeChange(
        () => commitItemPatch(id, mutationBase, geometry),
        'Could not resize this item',
      );
      if (saved) {
        setItems((current) => current.map((item) => item.id === id ? outcome.item : item));
        pushAction({ kind: 'update', id, before, after: geometry, expected: outcome.expected });
      } else {
        await restoreItemFromSource(id, { ...mutationBase, ...before });
      }
    })();
  }, [commitItemPatch, items, pushAction, restoreItemFromSource, whiteboardAllowed, writeChange]);

  const saveText = useCallback(async (id, text, expectedItem) => {
    if (!(await whiteboardAllowed())) return;
    const current = items.find((item) => item.id === id);
    if (!current) return;
    const mutationBase = expectedItem || current;
    const nextText = text.replace(/\s+$/g, '');
    if (mutationBase.text === nextText) return;
    const before = { text: mutationBase.text || '' };
    const after = { text: nextText, byName: current.byName || displayNameFor(user) };
    setItems((value) => value.map((item) => item.id === id ? { ...item, ...after } : item));
    const { ok: saved, value: outcome } = await writeChange(
      () => commitItemPatch(id, mutationBase, after),
      'Could not save this text',
    );
    if (saved) {
      setItems((value) => value.map((item) => item.id === id ? outcome.item : item));
      pushAction({ kind: 'update', id, before, after, expected: outcome.expected });
    } else {
      await restoreItemFromSource(id, mutationBase);
    }
  }, [commitItemPatch, items, pushAction, restoreItemFromSource, user, whiteboardAllowed, writeChange]);

  const deleteItem = useCallback(async (id) => {
    if (!(await whiteboardAllowed())) return;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const { ok: saved, value: outcome } = await writeChange(
      () => commitItemDelete(id, item),
      'Could not delete this item',
    );
    if (!saved) return;
    pushAction({ kind: 'delete', item: outcome.item, expected: outcome.expected });
    setSelectedId((current) => current === id ? '' : current);
    setEditingId((current) => current === id ? '' : current);
  }, [commitItemDelete, items, pushAction, whiteboardAllowed, writeChange]);

  const duplicateSelected = useCallback(async () => {
    if (!selectedItem) return;
    const offsetX = clamp(selectedItem.x + 28, 0, BOARD_WIDTH - selectedItem.w);
    const offsetY = clamp(selectedItem.y + 28, 0, BOARD_HEIGHT - selectedItem.h);
    await addItem({ ...itemPayload(selectedItem), x: offsetX, y: offsetY }, { edit: false });
  }, [addItem, selectedItem]);

  const updateSelected = useCallback(async (after, failureMessage) => {
    if (!selectedItem || !(await whiteboardAllowed())) return;
    const before = Object.fromEntries(Object.keys(after).map((key) => [key, selectedItem[key]]));
    if (Object.keys(after).every((key) => before[key] === after[key])) return;
    setItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, ...after } : item));
    const { ok: saved, value: outcome } = await writeChange(
      () => commitItemPatch(selectedItem.id, selectedItem, after),
      failureMessage,
    );
    if (saved) {
      setItems((current) => current.map((item) => item.id === selectedItem.id ? outcome.item : item));
      pushAction({ kind: 'update', id: selectedItem.id, before, after, expected: outcome.expected });
    } else {
      await restoreItemFromSource(selectedItem.id, selectedItem);
    }
  }, [commitItemPatch, pushAction, restoreItemFromSource, selectedItem, whiteboardAllowed, writeChange]);

  const recolorSelected = useCallback((nextColor) => {
    setColor(nextColor);
    if (selectedItem) void updateSelected({ color: nextColor }, 'Could not recolor this item');
  }, [selectedItem, updateSelected]);

  const bringSelectedForward = useCallback(() => {
    if (!selectedItem) return;
    const nextZ = Math.max(Date.now(), ...items.map((item) => item.z || 0)) + 1;
    void updateSelected({ z: nextZ }, 'Could not bring this item forward');
  }, [items, selectedItem, updateSelected]);

  const applyHistoryAction = useCallback(async (action, forward) => {
    const id = historyItemId(action);
    if (!id) return { committed: false, conflict: true };
    const updatedAt = nextItemRevision();
    const result = await runTransaction(itemRef(id), (current) => {
      if (!revisionMatches(current, action.expected)) return undefined;

      if (action.kind === 'add') {
        if (!forward) return null;
        return { ...itemPayload(action.item), version: (action.item.version || 0) + 1, updatedAt };
      }
      if (action.kind === 'delete') {
        if (forward) return null;
        return { ...itemPayload(action.item), version: (action.item.version || 0) + 1, updatedAt };
      }
      if (action.kind === 'update') {
        const expectedFields = forward ? action.before : action.after;
        if (!fieldsMatch(current, expectedFields)) return undefined;
        return {
          ...current,
          ...(forward ? action.after : action.before),
          version: Math.max(0, Math.floor(safeNumber(current.version, 0))) + 1,
          updatedAt,
        };
      }
      return undefined;
    }, { applyLocally: false });

    if (!result.committed) return { committed: false, conflict: true };
    const raw = result.snapshot.val();
    return {
      committed: true,
      conflict: false,
      expected: revisionToken(raw),
      item: raw ? normalizeItem(id, raw) : null,
    };
  }, [itemRef, nextItemRevision]);

  const travelHistory = useCallback(async (direction) => {
    const source = direction === 'undo' ? undoStack.current : redoStack.current;
    const target = direction === 'undo' ? redoStack.current : undoStack.current;
    const action = source.pop();
    if (!action) {
      window.showToast?.(direction === 'undo' ? 'Nothing to undo yet.' : 'Nothing to redo yet.');
      return;
    }
    touchHistory();
    if (!(await whiteboardAllowed())) {
      source.push(action);
      touchHistory();
      return;
    }
    const { ok: saved, value: outcome } = await writeChange(
      () => applyHistoryAction(action, direction === 'redo'),
      direction === 'undo' ? 'Could not undo that change' : 'Could not redo that change',
    );
    if (saved && outcome?.committed) {
      const id = historyItemId(action);
      action.expected = outcome.expected;
      if (action.item && outcome.item) action.item = outcome.item;
      target.push(action);
      if (outcome.expected.exists) {
        setSelectedId(id);
        for (let index = source.length - 1; index >= 0; index -= 1) {
          if (historyItemId(source[index]) !== id) continue;
          source[index].expected = outcome.expected;
          break;
        }
      } else {
        setSelectedId((current) => current === id ? '' : current);
      }
    } else if (saved && outcome?.conflict) {
      window.showToast?.(`Can't ${direction} because this item changed after the original action.`);
    } else {
      source.push(action);
    }
    touchHistory();
  }, [applyHistoryAction, touchHistory, whiteboardAllowed, writeChange]);

  const clearBoard = () => {
    if (permissionLoading || !boardCanEdit) {
      window.showToast?.('Whiteboard editing is disabled in this room.');
      return;
    }
    if (!items.length) {
      setMoreMenuOpen(false);
      window.showToast?.('The whiteboard is already empty.');
      return;
    }
    clearCandidatesRef.current = items.map((item) => ({ ...item }));
    setMoreMenuOpen(false);
    setConfirmClearOpen(true);
  };

  const confirmClearBoard = async () => {
    if (!(await whiteboardAllowed())) return;
    const candidates = clearCandidatesRef.current;
    const { ok: saved, value: result } = await writeChange(() => runTransaction(notesRef(), (current) => {
      const board = current && typeof current === 'object' ? current : {};
      if (candidates.some((item) => !revisionMatches(board[item.id], revisionToken(item)))) return undefined;
      const next = { ...board };
      for (const item of candidates) delete next[item.id];
      return Object.keys(next).length ? next : null;
    }, { applyLocally: false }), 'Could not clear the board');
    if (!saved) return;
    if (!result?.committed) {
      clearCandidatesRef.current = [];
      setConfirmClearOpen(false);
      window.showToast?.('The board changed while confirmation was open, so nothing was cleared.');
      return;
    }
    undoStack.current = [];
    redoStack.current = [];
    touchHistory();
    clearCandidatesRef.current = [];
    setSelectedId('');
    setConfirmClearOpen(false);
  };

  const normalizeDraw = (start, current, type) => {
    const deltaX = current.x - start.x;
    const deltaY = current.y - start.y;
    const min = minimumSize(type);
    if (type === 'connector') {
      const directionX = Math.abs(deltaX) < 8 ? 0 : deltaX > 0 ? 1 : -1;
      const directionY = Math.abs(deltaY) < 8 ? 0 : deltaY > 0 ? 1 : -1;
      const w = Math.min(BOARD_WIDTH, Math.max(Math.abs(deltaX), min.w));
      const h = Math.min(BOARD_HEIGHT, Math.max(Math.abs(deltaY), min.h));
      const rawX = directionX === 0 ? start.x - w / 2 : Math.min(start.x, current.x);
      const rawY = directionY === 0 ? start.y - h / 2 : Math.min(start.y, current.y);
      return {
        type,
        color,
        x: Math.round(clamp(rawX, 0, BOARD_WIDTH - w)),
        y: Math.round(clamp(rawY, 0, BOARD_HEIGHT - h)),
        w: Math.round(w),
        h: Math.round(h),
        directionX,
        directionY,
      };
    }
    const w = Math.min(BOARD_WIDTH, Math.max(Math.abs(deltaX), min.w));
    const h = Math.min(BOARD_HEIGHT, Math.max(Math.abs(deltaY), min.h));
    return {
      type,
      color,
      x: Math.round(clamp(Math.min(start.x, current.x), 0, BOARD_WIDTH - w)),
      y: Math.round(clamp(Math.min(start.y, current.y), 0, BOARD_HEIGHT - h)),
      w: Math.round(w),
      h: Math.round(h),
    };
  };

  const handleWorldPointerDown = (event) => {
    if (event.button !== 0) return;
    const target = eventTargetElement(event);
    if (target?.closest('.wb-item, .wb-selection-bar')) return;
    const point = canvasPoint(event);
    setSelectedId('');
    setCreateMenuOpen(false);
    setMoreMenuOpen(false);

    if (!boardCanEdit) {
      if (!permissionLoading && !['select', 'hand'].includes(activeTool)) window.showToast?.('Whiteboard editing is disabled in this room.');
      setActiveTool('hand');
      return;
    }
    if (activeTool === 'note') {
      void addItem({ type: 'note', text: '', color, x: point.x, y: point.y, w: 190, h: 130 });
      setActiveTool('select');
      return;
    }
    if (activeTool === 'text') {
      void addItem({ type: 'text', text: 'Text', color, x: point.x, y: point.y, w: 230, h: 78 });
      setActiveTool('select');
      return;
    }
    if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'connector') {
      event.currentTarget.setPointerCapture(event.pointerId);
      shapeDrag.current = { pointerId: event.pointerId, start: point, type: activeTool };
      setDraftShape(normalizeDraw(point, point, activeTool));
    }
  };

  const handleWorldPointerMove = (event) => {
    if (!shapeDrag.current || shapeDrag.current.pointerId !== event.pointerId) return;
    setDraftShape(normalizeDraw(shapeDrag.current.start, canvasPoint(event), shapeDrag.current.type));
  };

  const handleWorldPointerUp = (event) => {
    if (!shapeDrag.current || shapeDrag.current.pointerId !== event.pointerId) return;
    const draw = shapeDrag.current;
    const current = canvasPoint(event);
    const shape = normalizeDraw(draw.start, current, draw.type);
    shapeDrag.current = null;
    setDraftShape(null);
    const largeEnough = draw.type === 'connector'
      ? Math.hypot(current.x - draw.start.x, current.y - draw.start.y) > 14
      : shape.w > 10 && shape.h > 10;
    if (largeEnough) void addItem(shape, { edit: false });
  };

  const handleWorldPointerCancel = (event) => {
    if (!shapeDrag.current || shapeDrag.current.pointerId !== event.pointerId) return;
    shapeDrag.current = null;
    setDraftShape(null);
  };

  const applyZoom = useCallback((requestedZoom, clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const currentZoom = zoomRef.current;
    const nextZoom = Math.round(clamp(requestedZoom, MIN_ZOOM, MAX_ZOOM) * 100) / 100;
    const rectValue = canvas.getBoundingClientRect();
    const anchorClientX = clientX ?? rectValue.left + canvas.clientWidth / 2;
    const anchorClientY = clientY ?? rectValue.top + canvas.clientHeight / 2;
    const boardX = (canvas.scrollLeft + anchorClientX - rectValue.left) / currentZoom;
    const boardY = (canvas.scrollTop + anchorClientY - rectValue.top) / currentZoom;

    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      canvas.scrollLeft = boardX * nextZoom - (anchorClientX - rectValue.left);
      canvas.scrollTop = boardY * nextZoom - (anchorClientY - rectValue.top);
      updateViewport();
    });
  }, [updateViewport]);

  const fitToContent = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!items.length) {
      zoomRef.current = 1;
      setZoom(1);
      window.requestAnimationFrame(() => {
        canvas.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
        updateViewport();
      });
      return;
    }
    const left = Math.min(...items.map((item) => item.x));
    const top = Math.min(...items.map((item) => item.y));
    const right = Math.max(...items.map((item) => item.x + item.w));
    const bottom = Math.max(...items.map((item) => item.y + item.h));
    const contentWidth = Math.max(180, right - left);
    const contentHeight = Math.max(120, bottom - top);
    const nextZoom = Math.round(clamp(Math.min((canvas.clientWidth - 160) / contentWidth, (canvas.clientHeight - 190) / contentHeight), MIN_ZOOM, MAX_ZOOM) * 100) / 100;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      canvas.scrollLeft = ((left + right) / 2) * nextZoom - canvas.clientWidth / 2;
      canvas.scrollTop = ((top + bottom) / 2) * nextZoom - canvas.clientHeight / 2;
      updateViewport();
    });
  }, [items, updateViewport]);

  useEffect(() => {
    if (!isRoomTabActive) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      applyZoom(zoomRef.current + direction * ZOOM_STEP, event.clientX, event.clientY);
    };
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [applyZoom, isRoomTabActive]);

  const beginPan = (event) => {
    const target = eventTargetElement(event);
    const isMiddlePan = event.button === 1;
    const isHandPan = event.button === 0 && activeTool === 'hand';
    const isEmptySelectPan = event.button === 0 && activeTool === 'select' && !target?.closest('.wb-item, .wb-selection-bar, .wb-canvas-overlay');
    if (!isMiddlePan && !isHandPan && !isEmptySelectPan) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    canvas?.setPointerCapture(event.pointerId);
    pan.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: canvas?.scrollLeft || 0,
      scrollTop: canvas?.scrollTop || 0,
    };
    canvas?.classList.add('panning');
  };

  const movePan = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || !pan.current || pan.current.pointerId !== event.pointerId) return;
    canvas.scrollLeft = pan.current.scrollLeft - (event.clientX - pan.current.startX);
    canvas.scrollTop = pan.current.scrollTop - (event.clientY - pan.current.startY);
  };

  const endPan = (event) => {
    if (!pan.current || pan.current.pointerId !== event.pointerId) return;
    pan.current = null;
    canvasRef.current?.classList.remove('panning');
  };

  const navigateMinimap = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rectValue = event.currentTarget.getBoundingClientRect();
    const boardX = ((event.clientX - rectValue.left) / rectValue.width) * BOARD_WIDTH;
    const boardY = ((event.clientY - rectValue.top) / rectValue.height) * BOARD_HEIGHT;
    canvas.scrollTo({
      left: boardX * zoomRef.current - canvas.clientWidth / 2,
      top: boardY * zoomRef.current - canvas.clientHeight / 2,
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    if (!isRoomTabActive) return undefined;
    const handleKey = (event) => {
      if (!elementIsVisible(workspaceRef.current)) return;
      const target = eventTargetElement(event);
      if (confirmClearOpen || helpOpen) return;

      if (createMenuOpen || moreMenuOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setCreateMenuOpen(false);
          setMoreMenuOpen(false);
        }
        return;
      }

      const isInteractive = Boolean(target?.closest('input, textarea, select, button, a, summary, [contenteditable="true"], [role="button"], [role="menuitem"]'));
      if (isInteractive) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        void travelHistory(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') {
        setCreateMenuOpen(false);
        setMoreMenuOpen(false);
        setSelectedId('');
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && boardCanEdit) {
        event.preventDefault();
        void deleteItem(selectedId);
        return;
      }
      if (key === 'v') setActiveTool('select');
      if (key === 'h' || event.code === 'Space') {
        event.preventDefault();
        setActiveTool('hand');
      }
      if (key === 'n' && boardCanEdit) setActiveTool('note');
      if (key === 't' && boardCanEdit) setActiveTool('text');
      if (key === 'r' && boardCanEdit) setActiveTool('rect');
      if (key === 'o' && boardCanEdit) setActiveTool('ellipse');
      if (key === 'l' && boardCanEdit) setActiveTool('connector');
      if (key === 'f') fitToContent();
      if (event.key === '0') applyZoom(1);
      if (event.key === '+' || event.key === '=') applyZoom(zoomRef.current + ZOOM_STEP);
      if (event.key === '-') applyZoom(zoomRef.current - ZOOM_STEP);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [applyZoom, boardCanEdit, confirmClearOpen, createMenuOpen, deleteItem, fitToContent, helpOpen, isRoomTabActive, moreMenuOpen, selectedId, travelHistory]);

  const boardStateCopy = boardLoading ? 'Loading whiteboard…' : boardError || '';
  const collaboratorCount = Math.max(1, contributors.length);
  const syncCopy = syncState.status === 'saving' ? 'Saving changes…'
    : syncState.status === 'error' ? 'Sync needs attention'
      : syncState.status === 'loading' ? 'Connecting…' : 'Autosaved just now';
  const selectionBarPosition = selectedItem ? (() => {
    const inverseZoom = 1 / Math.max(zoom, MIN_ZOOM);
    const edgeGap = 16 * inverseZoom;
    const toolbarWidth = 430 * inverseZoom;
    const toolbarHeight = 62 * inverseZoom;
    const below = selectedItem.y + selectedItem.h + 18 * inverseZoom;
    return {
      left: clamp(selectedItem.x, edgeGap, Math.max(edgeGap, BOARD_WIDTH - toolbarWidth - edgeGap)),
      top: below + toolbarHeight > BOARD_HEIGHT
        ? Math.max(12 * inverseZoom, selectedItem.y - 66 * inverseZoom)
        : below,
      zIndex: Math.max(10000, Math.round(selectedItem.z || 1) + 100),
      '--wb-inverse-zoom': inverseZoom,
    };
  })() : null;

  return (
    <section ref={workspaceRef} className="whiteboard-workspace" aria-label="Shared whiteboard workspace">
      <header className="wb-workspace-header">
        <div className="wb-workspace-title">
          <h2>Whiteboard</h2>
          <div className={`wb-save-state is-${syncState.status}`} role="status" aria-live="polite">
            <span aria-hidden="true" /> {syncCopy}
          </div>
        </div>

        <div className="wb-collaborators" aria-label={`${collaboratorCount} collaborator${collaboratorCount === 1 ? '' : 's'} have contributed`}>
          <div className="wb-avatar-stack" aria-hidden="true">
            {contributors.slice(0, 4).map((person, index) => (
              <span key={person.uid} style={{ '--avatar-color': contributorColors[index % contributorColors.length] }} title={person.name}>
                {initialsFor(person.name)}
              </span>
            ))}
            {contributors.length > 4 ? <span className="wb-avatar-more">+{contributors.length - 4}</span> : null}
          </div>
          <span className="wb-collaborator-copy">{collaboratorCount} collaborator{collaboratorCount === 1 ? '' : 's'}</span>
        </div>

        <div className="wb-header-actions">
          <div className="wb-split-action">
            <button type="button" className="wb-add-note-cta" disabled={!boardCanEdit} onClick={addNoteFromToolbar}>
              <WhiteboardIcon name="note" /> <span>Add note</span>
            </button>
            <button
              type="button"
              className="wb-create-menu-toggle"
              aria-label="More create options"
              aria-expanded={createMenuOpen}
              disabled={!boardCanEdit}
              onClick={() => { setCreateMenuOpen((open) => !open); setMoreMenuOpen(false); }}
            >
              <i className="ph-bold ph-caret-down" aria-hidden="true" />
            </button>
            {createMenuOpen ? (
              <div className="wb-popover wb-create-popover" role="menu">
                <button type="button" role="menuitem" onClick={() => { setActiveTool('note'); setCreateMenuOpen(false); }}><WhiteboardIcon name="note" /> Place a note <kbd>N</kbd></button>
                <button type="button" role="menuitem" onClick={() => { setActiveTool('text'); setCreateMenuOpen(false); }}><i className="ph-bold ph-text-t" /> Add text <kbd>T</kbd></button>
                <button type="button" role="menuitem" onClick={() => { setActiveTool('rect'); setCreateMenuOpen(false); }}><i className="ph-bold ph-square" /> Draw a shape <kbd>R</kbd></button>
                <button type="button" role="menuitem" onClick={() => { setActiveTool('connector'); setCreateMenuOpen(false); }}><WhiteboardIcon name="connector" /> Connect ideas <kbd>L</kbd></button>
              </div>
            ) : null}
          </div>
          <div className="wb-more-wrap">
            <button
              type="button"
              className="wb-more-button"
              aria-label="Whiteboard options"
              aria-expanded={moreMenuOpen}
              onClick={() => { setMoreMenuOpen((open) => !open); setCreateMenuOpen(false); }}
            >
              <i className="ph-bold ph-dots-three" aria-hidden="true" />
            </button>
            {moreMenuOpen ? (
              <div className="wb-popover wb-more-popover" role="menu">
                <button type="button" role="menuitem" onClick={() => { fitToContent(); setMoreMenuOpen(false); }}><WhiteboardIcon name="fit" /> Fit to content</button>
                <button type="button" role="menuitem" onClick={() => { setHelpOpen(true); setMoreMenuOpen(false); }}><i className="ph-bold ph-keyboard" /> Keyboard shortcuts</button>
                <button type="button" role="menuitem" className="is-danger" disabled={!boardCanEdit} onClick={clearBoard}><i className="ph-bold ph-trash" /> Clear board</button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="wb-canvas-shell">
        <div id="wb-toolbar" className="wb-canvas-overlay" role="toolbar" aria-label="Whiteboard tools">
          <div className="wb-tool-group" role="group" aria-label="Drawing tools">
            {tools.map(([tool, icon, label, shortcut], index) => (
              <span className={index === 2 || index === 4 || index === 6 ? 'wb-tool-with-divider' : ''} key={tool}>
                <button
                  type="button"
                  className={`wb-tool-btn ${activeTool === tool ? 'active' : ''}`}
                  title={`${label} (${shortcut})`}
                  aria-label={`${label}. Shortcut ${shortcut}`}
                  aria-pressed={activeTool === tool}
                  disabled={!boardCanEdit && !['hand', 'select'].includes(tool)}
                  onClick={() => setActiveTool(tool)}
                >
                  {icon.startsWith('wb:') ? <WhiteboardIcon name={icon.slice(3)} /> : <i className={`ph-bold ${icon}`} aria-hidden="true" />}
                </button>
              </span>
            ))}
          </div>

          <div id="wb-colors" role="group" aria-label="Creation color">
            {colors.slice(0, 6).map((option) => (
              <button
                key={option}
                type="button"
                className={`wb-swatch ${option === color ? 'active' : ''}`}
                style={{ '--swatch': option }}
                aria-label={`Use ${option} for new items`}
                aria-pressed={option === color}
                disabled={!boardCanEdit}
                onClick={() => setColor(option)}
              />
            ))}
            <label className="wb-color-custom" title="Custom color">
              <i className="ph-bold ph-plus" aria-hidden="true" />
              <span className="sr-only">Choose a custom creation color</span>
              <input type="color" value={color} disabled={!boardCanEdit} aria-label="Custom creation color" onChange={(event) => setColor(event.target.value)} />
            </label>
          </div>

          <div className="wb-object-actions" role="group" aria-label="Selected object actions">
            <button type="button" aria-label="Duplicate selected item" title="Duplicate" disabled={!selectedItem || !boardCanEdit} onClick={duplicateSelected}><WhiteboardIcon name="copy" /></button>
            <button type="button" aria-label="Bring selected item forward" title="Bring forward" disabled={!selectedItem || !boardCanEdit} onClick={bringSelectedForward}><i className="ph-bold ph-stack" /></button>
            <button type="button" aria-label="Delete selected item" title="Delete" disabled={!selectedItem || !boardCanEdit} onClick={() => selectedItem && deleteItem(selectedItem.id)}><i className="ph-bold ph-trash" /></button>
          </div>
        </div>

        <div className="wb-history-controls wb-canvas-overlay" role="group" aria-label="Whiteboard history">
          <button type="button" aria-label="Undo" title="Undo (Ctrl Z)" disabled={!canUndo || !boardCanEdit} onClick={() => travelHistory('undo')}><i className="ph-bold ph-arrow-counter-clockwise" /></button>
          <button type="button" aria-label="Redo" title="Redo (Ctrl Shift Z)" disabled={!canRedo || !boardCanEdit} onClick={() => travelHistory('redo')}><WhiteboardIcon name="redo" /></button>
        </div>

        {!permissionLoading && !boardCanEdit ? (
          <div className="wb-permission-banner wb-canvas-overlay" role="note">
            <i className="ph-bold ph-lock-key" aria-hidden="true" /> Editing is off for you. Hand, zoom, and minimap remain available.
          </div>
        ) : null}

        <div
          id="wb-canvas"
          className={`${activeTool === 'hand' ? 'hand-active' : ''} ${activeTool === 'select' ? 'can-drag' : ''}`}
          ref={canvasRef}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          role="region"
          aria-label="Whiteboard canvas"
          onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
        >
          {boardStateCopy ? <div className={`wb-board-state ${boardError ? 'error' : ''}`} role={boardLoading ? 'status' : 'alert'}>{boardStateCopy}</div> : null}
          <div id="wb-stage" style={{ width: BOARD_WIDTH * zoom, height: BOARD_HEIGHT * zoom }}>
            <div
              id="wb-world"
              ref={worldRef}
              style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `scale(${zoom})` }}
              onPointerDown={handleWorldPointerDown}
              onPointerMove={handleWorldPointerMove}
              onPointerUp={handleWorldPointerUp}
              onPointerCancel={handleWorldPointerCancel}
            >
              {items.map((item) => (
                <WhiteboardItem
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  activeTool={activeTool}
                  canEdit={boardCanEdit}
                  zoom={zoom}
                  editing={item.id === editingId}
                  onSelect={setSelectedId}
                  onDelete={deleteItem}
                  onMove={moveItem}
                  onResize={resizeItem}
                  onSaveText={saveText}
                  onStartEditing={setEditingId}
                  onFinishEditing={() => setEditingId('')}
                />
              ))}

              {draftShape ? (
                <div
                  className={`wb-item wb-${draftShape.type} wb-draft`}
                  style={{
                    left: draftShape.x,
                    top: draftShape.y,
                    width: draftShape.w,
                    height: draftShape.h,
                    '--item-color': draftShape.color,
                  }}
                  aria-hidden="true"
                >
                  {draftShape.type === 'connector' ? <ConnectorSurface item={{ ...draftShape, id: 'draft' }} /> : <div className="wb-shape-surface" />}
                </div>
              ) : null}

              {selectedItem && boardCanEdit && selectionBarPosition ? (
                <div className="wb-selection-bar" style={selectionBarPosition} role="toolbar" aria-label="Selected item controls" onPointerDown={(event) => event.stopPropagation()}>
                  <div role="group" aria-label="Selected item color">
                    {colors.slice(0, 6).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`wb-selection-swatch ${selectedItem.color === option ? 'active' : ''}`}
                        style={{ '--swatch': option }}
                        aria-label={`Change selected item to ${option}`}
                        aria-pressed={selectedItem.color === option}
                        onClick={() => recolorSelected(option)}
                      />
                    ))}
                  </div>
                  <span className="wb-selection-divider" aria-hidden="true" />
                  <button type="button" aria-label="Duplicate selected item" title="Duplicate" onClick={duplicateSelected}><WhiteboardIcon name="copy" /></button>
                  <button type="button" aria-label="Bring selected item forward" title="Bring forward" onClick={bringSelectedForward}><i className="ph-bold ph-stack" /></button>
                  <button type="button" aria-label="Delete selected item" title="Delete" onClick={() => deleteItem(selectedItem.id)}><i className="ph-bold ph-trash" /></button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {!boardLoading && !boardError && items.length < 3 && !guideDismissed ? (
          <aside className="wb-build-card wb-canvas-overlay" aria-label="Whiteboard getting started">
            <button type="button" className="wb-guide-dismiss" aria-label="Dismiss getting started" onClick={() => setGuideDismissed(true)}><i className="ph-bold ph-x" /></button>
            <div className="wb-build-icon"><i className="ph-bold ph-users-three" aria-hidden="true" /></div>
            <h3>Build this room together</h3>
            <p>Add notes, shapes, and connect ideas.</p>
            <button type="button" className="wb-guide-primary" disabled={!boardCanEdit} onClick={addNoteFromToolbar}><WhiteboardIcon name="note" /> Add a note</button>
            <button type="button" className="wb-guide-secondary" disabled={!boardCanEdit} onClick={() => { setActiveTool('rect'); setGuideDismissed(true); }}><i className="ph-bold ph-square" /> Start with a shape</button>
          </aside>
        ) : null}

        <button type="button" className="wb-shortcut-hint wb-canvas-overlay" onClick={() => setHelpOpen(true)}>
          <span>Press</span> <kbd>?</kbd> <span>for keyboard shortcuts</span>
        </button>

        <div className="wb-view-controls wb-canvas-overlay" role="group" aria-label="Canvas view controls">
          <button type="button" aria-label="Fit to content" title="Fit to content (F)" onClick={fitToContent}><WhiteboardIcon name="fit" /></button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}><i className="ph-bold ph-minus" /></button>
          <button type="button" className="wb-zoom-readout" aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to 100 percent`} onClick={() => applyZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}><i className="ph-bold ph-plus" /></button>
          <button type="button" className="wb-minimap" aria-label="Whiteboard minimap. Click to navigate" title="Click to navigate" onClick={navigateMinimap}>
            {items.map((item) => (
              <span
                key={item.id}
                className={`wb-minimap-item is-${item.type}`}
                style={{
                  left: `${(item.x / BOARD_WIDTH) * 100}%`,
                  top: `${(item.y / BOARD_HEIGHT) * 100}%`,
                  width: `${Math.max(1.6, (item.w / BOARD_WIDTH) * 100)}%`,
                  height: `${Math.max(2.2, (item.h / BOARD_HEIGHT) * 100)}%`,
                  '--mini-color': item.color,
                }}
              />
            ))}
            <span
              className="wb-minimap-viewport"
              style={{
                left: `${clamp((viewport.x / BOARD_WIDTH) * 100, 0, 100)}%`,
                top: `${clamp((viewport.y / BOARD_HEIGHT) * 100, 0, 100)}%`,
                width: `${clamp((viewport.w / BOARD_WIDTH) * 100, 3, 100)}%`,
                height: `${clamp((viewport.h / BOARD_HEIGHT) * 100, 4, 100)}%`,
              }}
            />
          </button>
        </div>
      </div>

      {confirmClearOpen ? (
        <div className="wb-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmClearOpen(false); }}>
          <section ref={clearDialogRef} className="wb-dialog-card" role="dialog" aria-modal="true" aria-labelledby="wb-confirm-title">
            <div className="wb-dialog-icon is-danger"><i className="ph-bold ph-trash" aria-hidden="true" /></div>
            <h3 id="wb-confirm-title">Clear the whole board?</h3>
            <p>This removes every item currently shown for everyone in this room. It cannot be undone; newer collaborator changes are protected.</p>
            <div className="wb-dialog-actions">
              <button type="button" onClick={() => setConfirmClearOpen(false)}>Cancel</button>
              <button type="button" className="is-danger" disabled={!boardCanEdit} onClick={confirmClearBoard}>Clear board</button>
            </div>
          </section>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="wb-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <section ref={helpDialogRef} className="wb-dialog-card wb-help-card" role="dialog" aria-modal="true" aria-labelledby="wb-help-title">
            <div className="wb-dialog-heading">
              <div>
                <span>Move faster</span>
                <h3 id="wb-help-title">Keyboard shortcuts</h3>
              </div>
              <button type="button" aria-label="Close keyboard shortcuts" onClick={() => setHelpOpen(false)}><i className="ph-bold ph-x" /></button>
            </div>
            <div className="wb-shortcut-grid">
              <span>Select</span><kbd>V</kbd><span>Hand</span><kbd>H</kbd>
              <span>Note</span><kbd>N</kbd><span>Text</span><kbd>T</kbd>
              <span>Rectangle</span><kbd>R</kbd><span>Circle</span><kbd>O</kbd>
              <span>Connector</span><kbd>L</kbd><span>Fit content</span><kbd>F</kbd>
              <span>Undo</span><kbd>⌘/Ctrl Z</kbd><span>Redo</span><kbd>⇧ ⌘/Ctrl Z</kbd>
              <span>Delete selection</span><kbd>Del</kbd><span>Reset zoom</span><kbd>0</kbd>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
