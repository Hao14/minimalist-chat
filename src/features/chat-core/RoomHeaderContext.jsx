import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { buildRoomHeaderDetails } from './roomHeaderModel.js';
import './RoomHeaderContext.css';

function readNotificationMode(roomId) {
  try {
    return localStorage.getItem(`minimalist:notify:${roomId}`) || 'all';
  } catch {
    return 'all';
  }
}

function readDoNotDisturb() {
  try {
    return localStorage.getItem('minimalist:dnd') === 'on';
  } catch {
    return false;
  }
}

export default function RoomHeaderContext({ activeRoom }) {
  const [roomMeta, setRoomMeta] = useState({ ...activeRoom, public: activeRoom.id === 'global' });
  const [presence, setPresence] = useState({});
  const [notification, setNotification] = useState(() => ({
    mode: readNotificationMode(activeRoom.id),
    dnd: readDoNotDisturb(),
  }));

  /* eslint-disable react-hooks/set-state-in-effect -- This component is a realtime projection of the active room. */
  useEffect(() => {
    const roomId = activeRoom.id;
    let nextMeta = {
      ...activeRoom,
      public: roomId === 'global',
      members: roomId === 'global' ? {} : (activeRoom.members || {}),
    };
    setRoomMeta(nextMeta);
    setPresence({});
    const unsubscribers = [];

    if (roomId !== 'global') {
      ['description', 'topic', 'public', 'discovery', 'members'].forEach((field) => {
        unsubscribers.push(onValue(ref(db, `rooms_meta/${roomId}/${field}`), (snapshot) => {
          nextMeta = { ...nextMeta, [field]: snapshot.val() };
          setRoomMeta(nextMeta);
        }, (error) => console.warn('[chat] room header metadata unavailable', {
          roomId,
          field,
          errorCode: error?.code || 'unknown',
        })));
      });
    }

    unsubscribers.push(onValue(ref(db, 'presence'), (snapshot) => {
      setPresence(snapshot.val() || {});
    }, (error) => console.warn('[chat] room presence unavailable', {
      roomId,
      errorCode: error?.code || 'unknown',
    })));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeRoom]);

  useEffect(() => {
    const sync = () => setNotification({
      mode: readNotificationMode(activeRoom.id),
      dnd: readDoNotDisturb(),
    });
    const handleStorage = (event) => {
      if (event.key && event.key !== `minimalist:notify:${activeRoom.id}` && event.key !== 'minimalist:dnd') return;
      sync();
    };
    sync();
    window.addEventListener('minimalist:notification-preferences', sync);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('minimalist:notification-preferences', sync);
      window.removeEventListener('storage', handleStorage);
    };
  }, [activeRoom.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const details = useMemo(() => buildRoomHeaderDetails(
    activeRoom.id,
    roomMeta,
    presence,
    notification.mode,
    notification.dnd,
  ), [activeRoom.id, notification, presence, roomMeta]);
  const privacyIcon = details.privacy === 'Private'
    ? 'ph-lock-key'
    : details.privacy === 'Discoverable' ? 'ph-compass' : 'ph-globe-hemisphere-west';

  return (
    <>
      <span className="room-header-purpose" title={details.purpose}>{details.purpose}</span>
      <span className="room-header-context" role="list" aria-label="Room status">
        <span
          className="room-header-chip room-header-privacy"
          role="listitem"
          data-room-header-status="privacy"
          title={`Privacy: ${details.privacy}`}
        >
          <i className={`ph-bold ${privacyIcon}`} aria-hidden="true" />
          <span className="room-header-chip-label">{details.privacy}</span>
        </span>
        <span
          className="room-header-chip room-header-online"
          role="listitem"
          data-room-header-status="presence"
          title={`${details.onlineCount} room members online`}
        >
          <span className="room-header-online-dot" aria-hidden="true" />
          <span className="room-header-chip-label">{details.onlineCount} online</span>
        </span>
        <span
          className="room-header-chip room-header-notifications"
          role="listitem"
          data-room-header-status="notifications"
          title={`Notifications: ${details.notification}`}
        >
          <i className="ph-bold ph-bell" aria-hidden="true" />
          <span className="room-header-chip-label">{details.notification}</span>
        </span>
      </span>
    </>
  );
}
