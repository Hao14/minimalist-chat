import { mountDocs } from '../features/docs/mountDocs.js';

window.loadRoomDocs = function loadRoomDocs() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountDocs({
    roomId: window.activeRoomId,
    user: {
      uid: window.currentUser.uid,
      displayName: window.userProfileName || 'Anonymous',
    },
  });
};
