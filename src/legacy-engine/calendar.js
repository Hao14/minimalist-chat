import { mountCalendar } from '../features/calendar/mountCalendar.js';

window.loadRoomCalendar = function loadRoomCalendar() {
  if (!window.currentUser || !window.activeRoomId) return;
  mountCalendar({
    roomId: window.activeRoomId,
    user: { uid: window.currentUser.uid },
    adminUid: window.MY_ADMIN_UID,
    gcalClientId: window.GCAL_CLIENT_ID || '',
    aiCalendarEndpoint: window.AI_CALENDAR_ENDPOINT || '',
  });
};
