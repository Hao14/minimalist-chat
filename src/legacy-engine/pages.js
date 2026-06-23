import { mountRoomPages } from '../features/room-pages/mountRoomPages.js';

window.renderRoomPages = function renderRoomPages() {
  if (!window.activeRoomId) return;
  mountRoomPages({
    roomId: window.activeRoomId,
    userId: window.currentUser?.uid || null,
    adminUid: window.MY_ADMIN_UID,
  });
};
