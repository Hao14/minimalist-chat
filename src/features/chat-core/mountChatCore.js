import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';

let chatCoreApi = {};
let pendingRoomSwitch = null;
let chatCoreComponentPromise = null;

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

function waitForChatCorePaint() {
  return new Promise((resolve) => {
    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 0);

    scheduleFrame(() => scheduleFrame(resolve));
  });
}

function loadChatCoreComponent() {
  if (!chatCoreComponentPromise) {
    chatCoreComponentPromise = import('./ChatCore.jsx')
      .then((module) => module.ChatCore)
      .catch((error) => {
        chatCoreComponentPromise = null;
        throw error;
      });
  }
  return chatCoreComponentPromise;
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
  if (!host || !user) return Promise.resolve(false);

  return loadChatCoreComponent().then((ChatCore) => {
    if (!host.isConnected) return false;
    let readySignaled = false;
    let resolveReady;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const registerMountedApi = (api) => {
      registerChatCoreApi(api);
      if (readySignaled || typeof api?.switchRoom !== 'function') return;
      readySignaled = true;
      waitForChatCorePaint().then(() => resolveReady(true));
    };

    const rendered = chatCoreRoot.render(host, createElement(ChatCore, { user, registerApi: registerMountedApi }));
    return rendered ? ready : false;
  });
}
