import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { get, ref, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import {
  MAX_PINNED_ROOM_TOOLS,
  loadRoomToolPins,
  normalizeRoomToolPins,
  saveRoomToolPins,
  toggleRoomToolPin,
} from './roomToolPins.js';

const pageDefinitions = {
  docs: { label: 'Docs', icon: 'ph-file-text' },
  whiteboard: { label: 'Whiteboard', icon: 'ph-palette' },
  tasks: { label: 'Tasks', icon: 'ph-check-square' },
  events: { label: 'Events', icon: 'ph-calendar-dots' },
  calendar: { label: 'Calendar', icon: 'ph-calendar' },
  ai: { label: 'AI', icon: 'ph-sparkle' },
  calls: { label: 'Calls', icon: 'ph-phone-call' },
};

const defaultPages = { docs: true, whiteboard: true, events: true, calls: true };
const corePages = { docs: true };

export function RoomPages({ adminUid, menuHost, roomId, userId }) {
  const [pages, setPagesState] = useState(defaultPages);
  const [pins, setPins] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const enabledKeys = useMemo(() => Object.keys(pageDefinitions).filter((key) => pages[key]), [pages]);

  useEffect(() => {
    let active = true;
    const loadPages = async () => {
      let config = null;
      let editable = false;
      try {
        if (roomId === 'global') {
          editable = Boolean(userId && userId === adminUid);
          config = (await get(ref(db, 'rooms_meta/global/pages'))).val();
        } else {
          const room = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {};
          config = room.pages || null;
          editable = Boolean(userId && (room.creatorId === userId || userId === adminUid));
        }
      } catch {
        config = null;
      }
      if (!active) return;
      const nextPages = { ...defaultPages, ...(config || {}), ...corePages };
      const nextEnabledKeys = Object.keys(pageDefinitions).filter((key) => nextPages[key]);
      setPagesState(nextPages);
      setPins(loadRoomToolPins(window.localStorage, userId, roomId, nextEnabledKeys));
      setCanEdit(editable);
      setMenuOpen(false);
    };
    loadPages();
    return () => { active = false; };
  }, [adminUid, roomId, userId]);

  useEffect(() => {
    const addButton = document.getElementById('room-add-page-btn');
    if (!addButton) return undefined;
    addButton.classList.remove('hidden');
    addButton.title = 'Room tools';
    addButton.setAttribute('aria-label', 'Open room tools');
    addButton.setAttribute('aria-haspopup', 'menu');
    addButton.setAttribute('aria-controls', 'room-add-page-menu');
    addButton.setAttribute('aria-expanded', String(menuOpen));

    const toggle = (event) => {
      event.stopPropagation();
      setMenuOpen((open) => !open);
    };
    const close = (event) => {
      if (menuHost?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      addButton.focus();
    };
    addButton.addEventListener('click', toggle);
    document.addEventListener('click', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      addButton.removeEventListener('click', toggle);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuHost, menuOpen]);

  useEffect(() => {
    if (!menuHost) return;
    menuHost.classList.toggle('hidden', !menuOpen);
    menuHost.setAttribute('role', 'menu');
    menuHost.setAttribute('aria-label', 'Room tools');
    menuHost.setAttribute('aria-hidden', String(!menuOpen));
    if (menuOpen) window.requestAnimationFrame(() => menuHost.querySelector('button:not(:disabled)')?.focus());
  }, [menuHost, menuOpen]);

  const openTool = (key) => {
    window.activateRoomView?.(key);
    setMenuOpen(false);
  };

  const togglePin = (key) => {
    const result = toggleRoomToolPin(pins, key, enabledKeys);
    if (result.error === 'limit') {
      window.showToast?.(`You can pin up to ${MAX_PINNED_ROOM_TOOLS} room tools. Unpin one first.`);
      return;
    }
    if (result.error) return;
    setPins(result.pins);
    saveRoomToolPins(window.localStorage, userId, roomId, result.pins);
  };

  const togglePage = async (key) => {
    if (!canEdit) return;
    if (corePages[key]) {
      window.showToast?.(`${pageDefinitions[key].label} stays on for every room.`);
      return;
    }
    const nextPages = { ...pages, [key]: !pages[key] };
    const activeView = document.querySelector('.room-view.active')?.id.replace('room-view-', '');
    try {
      await set(ref(db, `rooms_meta/${roomId}/pages`), nextPages);
      setPagesState(nextPages);
      const nextEnabledKeys = Object.keys(pageDefinitions).filter((pageKey) => nextPages[pageKey]);
      const nextPins = normalizeRoomToolPins(pins, nextEnabledKeys);
      if (nextPins.length !== pins.length) {
        setPins(nextPins);
        saveRoomToolPins(window.localStorage, userId, roomId, nextPins);
      }
      if (!nextPages[key] && activeView === key) window.activateRoomView?.('home');
    } catch (error) {
      window.showToast?.(`Could not update room tools: ${error.message}`);
    }
  };

  const pinnedButtons = pins.map((key) => {
    const page = pageDefinitions[key];
    if (!page || !pages[key]) return null;
    return (
      <button
        key={key}
        id={`room-tab-${key}`}
        type="button"
        className="room-tab room-tab-pinned"
        data-target={key}
        role="tab"
        aria-controls={`room-view-${key}`}
        aria-selected="false"
        aria-label={`${page.label} room tab, pinned`}
        tabIndex={-1}
      >
        <i className={`ph-bold ${page.icon}`} aria-hidden="true" /><span>{page.label}</span>
      </button>
    );
  });

  const menu = menuHost ? createPortal((
    <>
      <div className="page-menu-title">
        <span>Room tools</span>
        <small>{pins.length}/{MAX_PINNED_ROOM_TOOLS} pinned</small>
      </div>
      <div className="room-tool-menu-list">
        {enabledKeys.map((key) => {
          const page = pageDefinitions[key];
          const pinned = pins.includes(key);
          return (
            <div className="room-tool-menu-item" key={key}>
              <button
                type="button"
                className="room-tool-open"
                role="menuitem"
                onClick={(event) => { event.stopPropagation(); openTool(key); }}
              >
                <i className={`ph-bold ${page.icon}`} aria-hidden="true" />
                <span>{page.label}</span>
              </button>
              <button
                type="button"
                className={`room-tool-pin ${pinned ? 'is-pinned' : ''}`}
                aria-label={`${pinned ? 'Unpin' : 'Pin'} ${page.label}`}
                aria-pressed={pinned}
                title={`${pinned ? 'Unpin' : 'Pin'} ${page.label}`}
                onClick={(event) => { event.stopPropagation(); togglePin(key); }}
              >
                <i className="ph-bold ph-push-pin" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {canEdit ? (
        <div className="room-tool-availability">
          <div className="page-menu-subtitle">Available in this room</div>
          {Object.entries(pageDefinitions).map(([key, page]) => {
            const enabled = Boolean(pages[key]);
            const required = Boolean(corePages[key]);
            return (
              <button
                key={key}
                type="button"
                className="page-toggle"
                data-page={key}
                aria-pressed={enabled}
                aria-disabled={required || undefined}
                onClick={(event) => { event.stopPropagation(); togglePage(key); }}
              >
                <span><i className={`ph-bold ${page.icon}`} aria-hidden="true" />{page.label}</span>
                <span className="page-toggle-state" aria-hidden="true">{required ? 'Required' : enabled ? 'On' : 'Off'}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  ), menuHost) : null;

  return <>{pinnedButtons}{menu}</>;
}
