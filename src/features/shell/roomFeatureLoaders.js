import { mountAI } from '../ai/mountAI.js';
import { mountPersonalAgent } from '../ai/mountPersonalAgent.js';
import { mountCalendar } from '../calendar/mountCalendar.js';
import { mountCalls } from '../calls/mountCalls.js';
import { mountDocs } from '../docs/mountDocs.js';
import { mountEvents } from '../events/mountEvents.js';
import { mountRoomHome } from '../room-home/mountRoomHome.js';
import { mountRoomPages } from '../room-pages/mountRoomPages.js';
import { mountSearch } from '../search/mountSearch.js';
import { mountTasks } from '../tasks/mountTasks.js';
import { mountWhiteboard } from '../whiteboard/mountWhiteboard.js';

function currentRoomContext() {
  if (!window.currentUser || !window.activeRoomId) return null;
  return {
    roomId: window.activeRoomId,
    user: {
      uid: window.currentUser.uid,
      displayName: window.userProfileName || 'Anonymous',
      photoUrl: window.userPhotoUrl || '',
    },
    adminUid: window.MY_ADMIN_UID,
  };
}

window.loadRoomHome = function loadRoomHome() {
  const context = currentRoomContext();
  if (!context) return;
  mountRoomHome({
    roomId: context.roomId,
    user: { uid: context.user.uid },
    adminUid: context.adminUid,
    getAvatarUrl: window.getAvatarUrl,
  });
};

window.loadRoomDocs = function loadRoomDocs() {
  const context = currentRoomContext();
  if (!context) return;
  mountDocs({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
    },
  });
};

window.loadRoomWhiteboard = function loadRoomWhiteboard() {
  const context = currentRoomContext();
  if (!context) return;
  mountWhiteboard({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
    },
  });
};

window.loadRoomTasks = function loadRoomTasks() {
  const context = currentRoomContext();
  if (!context) return;
  mountTasks({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
    },
  });
};

window.loadRoomEvents = function loadRoomEvents() {
  const context = currentRoomContext();
  if (!context) return;
  mountEvents({
    roomId: context.roomId,
    user: { uid: context.user.uid },
    adminUid: context.adminUid,
  });
};

window.loadRoomCalendar = function loadRoomCalendar() {
  const context = currentRoomContext();
  if (!context) return;
  mountCalendar({
    roomId: context.roomId,
    user: { uid: context.user.uid },
    adminUid: context.adminUid,
    gcalClientId: window.GCAL_CLIENT_ID || '',
    aiCalendarEndpoint: window.AI_CALENDAR_ENDPOINT || '',
  });
};

window.loadRoomAI = function loadRoomAI() {
  const context = currentRoomContext();
  if (!context) return;
  mountAI({
    roomId: context.roomId,
    aiChatEndpoint: window.AI_CHAT_ENDPOINT || '',
  });
};

window.loadRoomCalls = function loadRoomCalls() {
  const context = currentRoomContext();
  if (!context) return;
  mountCalls({
    roomId: context.roomId,
    adminUid: context.adminUid,
    user: context.user,
  });
};

window.renderRoomPages = function renderRoomPages() {
  if (!window.activeRoomId) return;
  mountRoomPages({
    roomId: window.activeRoomId,
    userId: window.currentUser?.uid || null,
    adminUid: window.MY_ADMIN_UID,
  });
};

window.openPersonalAgent = function openPersonalAgent() {
  if (!window.currentUser) return;
  document.getElementById('contacts-panel')?.classList.remove('open');
  document.getElementById('updates-panel')?.classList.remove('open');
  const panel = document.getElementById('personal-ai-agent-panel');
  if (!panel) return;
  panel.classList.add('open');
  mountPersonalAgent({
    roomId: window.activeRoomId || 'global',
    personalAiAgentEndpoint: window.PERSONAL_AI_AGENT_ENDPOINT || '',
  });
};

mountSearch({ getAvatarUrl: window.getAvatarUrl });
