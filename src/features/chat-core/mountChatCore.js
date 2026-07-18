import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { ChatCore } from './ChatCore.jsx';

let chatCoreApi = {};
let pendingRoomSwitch = null;

const chatCoreRoot = createHostAwareRoot({
  onAttach: () => document.getElementById('room-list')?.replaceChildren(),
  onDetach: () => {
    chatCoreApi = {};
  },
});

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

  chatCoreRoot.render(host, createElement(ChatCore, { user, registerApi: registerChatCoreApi }));
}
