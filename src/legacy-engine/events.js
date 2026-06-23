import { mountEvents } from '../features/events/mountEvents.js';

window.loadRoomEvents = function loadRoomEvents() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountEvents({
    roomId: window.activeRoomId,
    user: { uid: window.currentUser.uid },
    adminUid: window.MY_ADMIN_UID,
  });
};
