import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { get, ref, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';

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
  const [canEdit, setCanEdit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
      setPagesState({ ...defaultPages, ...(config || {}), ...corePages });
      setCanEdit(editable);
      setMenuOpen(false);
    };
    loadPages();
    return () => { active = false; };
  }, [adminUid, roomId, userId]);

  useEffect(() => {
    const addButton = document.getElementById('room-add-page-btn');
    if (!addButton) return undefined;
    addButton.classList.toggle('hidden', !canEdit);
    const toggle = (event) => {
      event.stopPropagation();
      setMenuOpen((open) => !open);
    };
    const close = () => setMenuOpen(false);
    addButton.addEventListener('click', toggle);
    document.addEventListener('click', close);
    return () => {
      addButton.removeEventListener('click', toggle);
      document.removeEventListener('click', close);
    };
  }, [canEdit]);

  useEffect(() => {
    menuHost?.classList.toggle('hidden', !menuOpen);
  }, [menuHost, menuOpen]);

  const togglePage = async (key) => {
    if (!canEdit) return;
    if (corePages[key]) {
      window.showToast?.(`${pageDefinitions[key].label} stays on for every room.`);
      return;
    }
    const nextPages = { ...pages, [key]: !pages[key] };
    const wasActive = document.querySelector('.room-tab.active')?.getAttribute('data-target') === key;
    try {
      await set(ref(db, `rooms_meta/${roomId}/pages`), nextPages);
      setPagesState(nextPages);
      if (!nextPages[key] && wasActive) document.querySelector('.room-tab[data-target="home"]')?.click();
    } catch (error) {
      window.showToast?.(`Could not update pages: ${error.message}`);
    }
  };

  const enabledButtons = Object.entries(pageDefinitions)
    .filter(([key]) => pages[key])
    .map(([key, page]) => (
      <button key={key} type="button" className="room-tab" data-target={key}>
        <i className={`ph-bold ${page.icon}`} aria-hidden="true" /><span>{page.label}</span>
      </button>
    ));

  const menu = menuHost ? createPortal((
    <>
      <div className="page-menu-title">Pages</div>
      {Object.entries(pageDefinitions).map(([key, page]) => (
        <button key={key} type="button" className="page-toggle" data-page={key} onClick={(event) => { event.stopPropagation(); togglePage(key); }}>
          <span><i className={`ph-bold ${page.icon}`} aria-hidden="true" />{page.label}</span>
          <span className="page-toggle-state">{pages[key] ? '✓' : '+'}</span>
        </button>
      ))}
    </>
  ), menuHost) : null;

  return <>{enabledButtons}{menu}</>;
}
