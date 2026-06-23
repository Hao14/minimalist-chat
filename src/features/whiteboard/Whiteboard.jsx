import { useCallback, useEffect, useRef, useState } from 'react';
import { get, onValue, push, ref, remove, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';

const BOARD_WIDTH = 3200;
const BOARD_HEIGHT = 2200;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

const colors = ['#5967C9', '#42CE91', '#FFAD7A', '#FF7479', '#C668EF', '#FFDA73', '#85827D'];
const tools = [
  ['select', 'ph-cursor', 'Select'],
  ['rect', 'ph-square', 'Rectangle'],
  ['ellipse', 'ph-circle', 'Circle'],
  ['text', 'ph-text-t', 'Text'],
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeItem(id, raw = {}) {
  const type = raw.type || 'note';
  const fallbackWidth = type === 'note' ? 190 : type === 'text' ? 220 : 180;
  const fallbackHeight = type === 'note' ? 130 : type === 'text' ? 72 : 130;
  return {
    id,
    type,
    text: raw.text || '',
    x: raw.x ?? 40,
    y: raw.y ?? 40,
    w: raw.w ?? fallbackWidth,
    h: raw.h ?? fallbackHeight,
    color: raw.color || colors[0],
    by: raw.by || '',
    byName: raw.byName || '',
    createdAt: raw.createdAt || 0,
    updatedAt: raw.updatedAt || 0,
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

function WhiteboardItem({
  item,
  selected,
  activeTool,
  zoom,
  onSelect,
  onDelete,
  onMove,
  onSaveText,
}) {
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const canMove = activeTool === 'select' && !editing;

  const beginDrag = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, textarea')) return;
    onSelect(item.id);
    if (!canMove) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.x || 0,
      originY: item.y || 0,
      lastX: item.x || 0,
      lastY: item.y || 0,
    };
    setDragging(true);
  };

  const moveDrag = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const x = clamp(drag.current.originX + (event.clientX - drag.current.startX) / zoom, 0, BOARD_WIDTH - item.w);
    const y = clamp(drag.current.originY + (event.clientY - drag.current.startY) / zoom, 0, BOARD_HEIGHT - item.h);
    drag.current.lastX = x;
    drag.current.lastY = y;
    onMove(item.id, x, y, false);
  };

  const endDrag = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const { originX, originY, lastX, lastY } = drag.current;
    drag.current = null;
    setDragging(false);
    onMove(item.id, lastX, lastY, true, { x: originX, y: originY });
  };

  const commonStyle = {
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.type === 'note' ? undefined : item.h,
    '--item-color': item.color,
  };

  return (
    <article
      className={`wb-item wb-${item.type} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      style={commonStyle}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        if (isTextItem(item)) setEditing(true);
      }}
    >
      <button type="button" className="wb-item-del" title="Delete" aria-label="Delete item" onClick={() => onDelete(item.id)}>
        &times;
      </button>

      {item.type === 'rect' || item.type === 'ellipse' ? (
        <div className="wb-shape-surface" />
      ) : null}

      {isTextItem(item) && editing ? (
        <textarea
          className="wb-text-editor"
          defaultValue={item.text}
          autoFocus
          onPointerDown={(event) => event.stopPropagation()}
          onBlur={(event) => {
            onSaveText(item.id, event.target.value);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
      ) : null}

      {item.type === 'note' && !editing ? (
        <>
          <div className="wb-note-text">{item.text || 'Double-click to write…'}</div>
          <div className="wb-note-meta">{item.byName ? `— ${item.byName}` : ''}</div>
        </>
      ) : null}

      {item.type === 'text' && !editing ? (
        <div className="wb-free-text">{item.text || 'Double-click to type…'}</div>
      ) : null}
    </article>
  );
}

export function Whiteboard({ roomId, user }) {
  const [items, setItems] = useState([]);
  const [color, setColor] = useState(colors[0]);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedId, setSelectedId] = useState('');
  const [zoom, setZoom] = useState(1);
  const [draftShape, setDraftShape] = useState(null);
  const canvasRef = useRef(null);
  const worldRef = useRef(null);
  const zoomRef = useRef(1);
  const spawnOffset = useRef(0);
  const actionStack = useRef([]);
  const shapeDrag = useRef(null);
  const pan = useRef(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const notesRef = ref(db, `whiteboards/${roomId}/notes`);
    return onValue(notesRef, (snapshot) => {
      const value = snapshot.val() || {};
      setItems(Object.entries(value)
        .map(([id, item]) => normalizeItem(id, item))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
    });
  }, [roomId]);

  const pushAction = useCallback((action) => {
    actionStack.current.push(action);
    if (actionStack.current.length > 80) actionStack.current.shift();
  }, []);

  const itemRef = useCallback((id) => ref(db, `whiteboards/${roomId}/notes/${id}`), [roomId]);

  const whiteboardAllowed = useCallback(async () => {
    if (roomId === 'global') return true;
    const snap = await get(ref(db, `rooms_meta/${roomId}/permissions/whiteboard`)).catch(() => null);
    if (snap?.exists() && snap.val() === false) {
      window.showToast?.('Whiteboard editing is disabled in this room.');
      return false;
    }
    return true;
  }, [roomId]);

  const addItem = async (payload) => {
    if (!(await whiteboardAllowed())) return;
    const nextRef = push(ref(db, `whiteboards/${roomId}/notes`));
    const nextItem = {
      ...payload,
      by: user.uid,
      byName: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await set(nextRef, nextItem);
    pushAction({ type: 'add', id: nextRef.key });
    setSelectedId(nextRef.key || '');
    window.awardXP?.(user.uid, 'creativity', payload.type === 'note' ? 3 : 2);
  };

  const visibleSpawnPoint = () => {
    const canvas = canvasRef.current;
    spawnOffset.current = (spawnOffset.current + 36) % 216;
    const x = ((canvas?.scrollLeft || 0) + 44) / zoomRef.current + spawnOffset.current;
    const y = ((canvas?.scrollTop || 0) + 44) / zoomRef.current + spawnOffset.current;
    return {
      x: clamp(x, 0, BOARD_WIDTH - 220),
      y: clamp(y, 0, BOARD_HEIGHT - 150),
    };
  };

  const addNoteFromToolbar = () => {
    const point = visibleSpawnPoint();
    addItem({
      type: 'note',
      text: '',
      color,
      x: point.x,
      y: point.y,
      w: 190,
      h: 130,
    });
    setActiveTool('select');
  };

  const canvasPoint = (event) => {
    const world = worldRef.current;
    if (!world) return { x: 0, y: 0 };
    const rect = world.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / zoomRef.current, 0, BOARD_WIDTH),
      y: clamp((event.clientY - rect.top) / zoomRef.current, 0, BOARD_HEIGHT),
    };
  };

  const moveItem = (id, x, y, persist, before) => {
    const nextX = Math.round(clamp(x, 0, BOARD_WIDTH));
    const nextY = Math.round(clamp(y, 0, BOARD_HEIGHT));
    setItems((current) => current.map((item) => item.id === id ? { ...item, x: nextX, y: nextY } : item));
    if (persist) {
      whiteboardAllowed().then((allowed) => {
        if (!allowed) return;
        if (before && (Math.round(before.x) !== nextX || Math.round(before.y) !== nextY)) {
          pushAction({ type: 'move', id, before: { x: Math.round(before.x), y: Math.round(before.y) }, after: { x: nextX, y: nextY } });
        }
        update(itemRef(id), { x: nextX, y: nextY, updatedAt: Date.now() });
      });
      return;
    }
  };

  const saveText = async (id, text) => {
    if (!(await whiteboardAllowed())) return;
    const current = items.find((item) => item.id === id);
    const nextText = text.trim();
    if (current && current.text !== nextText) {
      pushAction({ type: 'edit', id, before: current.text || '', after: nextText });
    }
    update(itemRef(id), { text: nextText, updatedAt: Date.now() });
  };

  const deleteItem = useCallback(async (id) => {
    if (!(await whiteboardAllowed())) return;
    const item = items.find((entry) => entry.id === id);
    if (item) pushAction({ type: 'delete', item });
    await remove(itemRef(id));
    setSelectedId((current) => (current === id ? '' : current));
  }, [itemRef, items, pushAction, whiteboardAllowed]);

  const undo = async () => {
    const action = actionStack.current.pop();
    if (!action) {
      window.showToast?.('Nothing to undo yet.');
      return;
    }

    if (action.type === 'add') {
      await remove(itemRef(action.id));
      if (selectedId === action.id) setSelectedId('');
    }
    if (action.type === 'delete') {
      await set(itemRef(action.item.id), itemPayload(action.item));
      setSelectedId(action.item.id);
    }
    if (action.type === 'move') {
      await update(itemRef(action.id), { ...action.before, updatedAt: Date.now() });
      setSelectedId(action.id);
    }
    if (action.type === 'edit') {
      await update(itemRef(action.id), { text: action.before, updatedAt: Date.now() });
      setSelectedId(action.id);
    }
  };

  const clearBoard = () => {
    if (window.confirm('Clear the entire whiteboard for everyone?')) {
      actionStack.current = [];
      remove(ref(db, `whiteboards/${roomId}/notes`));
    }
  };

  const normalizeShape = (start, current, type) => ({
    type,
    color,
    x: Math.round(Math.min(start.x, current.x)),
    y: Math.round(Math.min(start.y, current.y)),
    w: Math.round(Math.abs(current.x - start.x)),
    h: Math.round(Math.abs(current.y - start.y)),
  });

  const handleWorldPointerDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.wb-item')) return;

    const point = canvasPoint(event);
    setSelectedId('');

    if (activeTool === 'note') {
      addItem({ type: 'note', text: '', color, x: point.x, y: point.y, w: 190, h: 130 });
      setActiveTool('select');
      return;
    }

    if (activeTool === 'text') {
      addItem({ type: 'text', text: 'Text', color, x: point.x, y: point.y, w: 230, h: 78 });
      setActiveTool('select');
      return;
    }

    if (activeTool === 'rect' || activeTool === 'ellipse') {
      event.currentTarget.setPointerCapture(event.pointerId);
      shapeDrag.current = { pointerId: event.pointerId, start: point, type: activeTool };
      setDraftShape({ ...normalizeShape(point, point, activeTool), w: 1, h: 1 });
    }
  };

  const handleWorldPointerMove = (event) => {
    if (!shapeDrag.current || shapeDrag.current.pointerId !== event.pointerId) return;
    const current = canvasPoint(event);
    setDraftShape(normalizeShape(shapeDrag.current.start, current, shapeDrag.current.type));
  };

  const handleWorldPointerUp = (event) => {
    if (!shapeDrag.current || shapeDrag.current.pointerId !== event.pointerId) return;
    const shape = normalizeShape(shapeDrag.current.start, canvasPoint(event), shapeDrag.current.type);
    shapeDrag.current = null;
    setDraftShape(null);
    if (shape.w > 10 && shape.h > 10) addItem(shape);
  };

  const applyZoom = useCallback((requestedZoom, clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const currentZoom = zoomRef.current;
    const nextZoom = Math.round(clamp(requestedZoom, MIN_ZOOM, MAX_ZOOM) * 100) / 100;
    const rect = canvas.getBoundingClientRect();
    const anchorClientX = clientX ?? rect.left + canvas.clientWidth / 2;
    const anchorClientY = clientY ?? rect.top + canvas.clientHeight / 2;
    const boardX = (canvas.scrollLeft + anchorClientX - rect.left) / currentZoom;
    const boardY = (canvas.scrollTop + anchorClientY - rect.top) / currentZoom;

    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      canvas.scrollLeft = boardX * nextZoom - (anchorClientX - rect.left);
      canvas.scrollTop = boardY * nextZoom - (anchorClientY - rect.top);
    });
  }, []);

  useEffect(() => {
    const handleKey = (event) => {
      if (!selectedId) return;
      if (event.target?.closest?.('input, textarea')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteItem(selectedId);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [deleteItem, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      applyZoom(zoomRef.current + direction * ZOOM_STEP, event.clientX, event.clientY);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [applyZoom]);

  const beginPan = (event) => {
    if (event.button !== 1) return;
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

  return (
    <>
      <div id="wb-toolbar">
        <div className="wb-tool-group" aria-label="Whiteboard tools">
          <button type="button" className={`wb-tool-btn ${activeTool === 'select' ? 'active' : ''}`} title="Select and move" aria-label="Select and move" aria-pressed={activeTool === 'select'} onClick={() => setActiveTool('select')}>
            <i className="ph-bold ph-cursor" />
          </button>
          <button type="button" className="wb-tool-btn" id="wb-add-note" title="Add note" aria-label="Add note" onClick={addNoteFromToolbar}>
            <i className="ph-bold ph-file" />
          </button>
          {tools.slice(1).map(([tool, icon, label]) => (
            <button key={tool} type="button" className={`wb-tool-btn ${activeTool === tool ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={activeTool === tool} onClick={() => setActiveTool(tool)}>
              <i className={`ph-bold ${icon}`} />
            </button>
          ))}
        </div>

        <div id="wb-colors" aria-label="Whiteboard color">
          {colors.map((option) => (
            <button
              key={option}
              type="button"
              className={`wb-swatch ${option === color ? 'active' : ''}`}
              style={{ background: option }}
              aria-label={`Use ${option}`}
              onClick={() => setColor(option)}
            />
          ))}
        </div>

        <div className="wb-zoom-controls" aria-label="Whiteboard zoom">
          <button type="button" className="wb-zoom-btn" title="Zoom out" aria-label="Zoom out" onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}>
            <i className="ph-bold ph-magnifying-glass-minus" />
          </button>
          <button type="button" className="wb-zoom-readout" title="Reset zoom to 100%" onClick={() => applyZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="wb-zoom-btn" title="Zoom in" aria-label="Zoom in" onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}>
            <i className="ph-bold ph-magnifying-glass-plus" />
          </button>
          <button type="button" className="wb-zoom-btn" title="Undo" aria-label="Undo" onClick={undo}>
            <i className="ph-bold ph-arrow-counter-clockwise" />
          </button>
        </div>

        <span id="wb-hint">Middle-click to pan · Scroll to zoom</span>
        <button type="button" id="wb-clear" onClick={clearBoard}>Clear</button>
      </div>

      <div
        id="wb-canvas"
        ref={canvasRef}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
      >
        <div id="wb-stage" style={{ width: BOARD_WIDTH * zoom, height: BOARD_HEIGHT * zoom }}>
          <div
            id="wb-world"
            ref={worldRef}
            style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `scale(${zoom})` }}
            onPointerDown={handleWorldPointerDown}
            onPointerMove={handleWorldPointerMove}
            onPointerUp={handleWorldPointerUp}
            onPointerCancel={handleWorldPointerUp}
          >
            {items.map((item) => (
              <WhiteboardItem
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                activeTool={activeTool}
                zoom={zoom}
                onSelect={setSelectedId}
                onDelete={deleteItem}
                onMove={moveItem}
                onSaveText={saveText}
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
              >
                <div className="wb-shape-surface" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
