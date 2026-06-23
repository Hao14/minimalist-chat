import { mountTasks } from '../features/tasks/mountTasks.js';

window.loadRoomTasks = function loadRoomTasks() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountTasks({
    roomId: window.activeRoomId,
    user: {
      uid: window.currentUser.uid,
      displayName: window.userProfileName || 'Anonymous',
    },
  });
};
