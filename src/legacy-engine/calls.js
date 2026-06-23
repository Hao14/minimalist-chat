import { mountCalls } from '../features/calls/mountCalls.js';

window.loadRoomCalls = function loadRoomCalls() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountCalls({
    roomId: window.activeRoomId,
    adminUid: window.MY_ADMIN_UID,
    user: {
      uid: window.currentUser.uid,
      displayName: window.userProfileName || 'Anonymous',
      photoUrl: window.userPhotoUrl || '',
    },
  });
};
