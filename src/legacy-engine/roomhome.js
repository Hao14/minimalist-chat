import { mountRoomHome } from '../features/room-home/mountRoomHome.js';

window.loadRoomHome = function loadRoomHome() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountRoomHome({
    roomId: window.activeRoomId,
    user: { uid: window.currentUser.uid },
    adminUid: window.MY_ADMIN_UID,
    getAvatarUrl: window.getAvatarUrl,
  });
};
