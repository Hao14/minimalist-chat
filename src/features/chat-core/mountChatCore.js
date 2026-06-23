import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatCore } from './ChatCore.jsx';

let chatCoreRoot = null;
let chatCoreApi = {};
let pendingRoomSwitch = null;

function registerChatCoreApi(api) {
  chatCoreApi = api || {};

  if (pendingRoomSwitch && chatCoreApi.switchRoom) {
    const { roomId, roomName, shortId } = pendingRoomSwitch;
    pendingRoomSwitch = null;
    chatCoreApi.switchRoom(roomId, roomName, shortId);
  }
}

export function switchChatRoom(roomId, roomName, shortId = '') {
  if (chatCoreApi.switchRoom) {
    chatCoreApi.switchRoom(roomId, roomName, shortId);
    return;
  }

  pendingRoomSwitch = { roomId, roomName, shortId };
}

export function mountChatCore({ user }) {
  const host = document.getElementById('room-view-chat');
  if (!host || !user) return;

  if (!chatCoreRoot) {
    document.getElementById('room-list')?.replaceChildren();
    host.replaceChildren();
    chatCoreRoot = createRoot(host);
  }

  chatCoreRoot.render(createElement(ChatCore, { user, registerApi: registerChatCoreApi }));
}
