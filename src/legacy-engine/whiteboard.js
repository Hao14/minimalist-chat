import { mountWhiteboard } from '../features/whiteboard/mountWhiteboard.js';

window.loadRoomWhiteboard = function loadRoomWhiteboard() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountWhiteboard({
    roomId: window.activeRoomId,
    user: {
      uid: window.currentUser.uid,
      displayName: window.userProfileName || 'Anonymous',
    },
  });
};
