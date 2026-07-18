// Per-message actions: Forward, Bookmark (+ Collections), Importance flag, Impact.
// Kept behind the existing window.openMsgMenu/window.openBookmarks APIs while the UI is React-rendered.
import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';
import { ref, get, set, update, push, remove, onValue, serverTimestamp } from 'firebase/database';
import {
  BookmarkCollectionDialog,
  BookmarksPanel,
  ForwardModal,
  MessageMenu,
} from './MessageToolsUI.jsx';

const $ = (id) => document.getElementById(id);

const state = {
  menu: null,
  forward: null,
  bookmarks: {},
  bookmarksOpen: false,
  bookmarkPrompt: null,
};

let toolsRoot = null;
let documentClickBound = false;

function messagePath(id) {
  if (window.activeRoomId === 'global') return `messages/${id}`;
  const channelId = window.activeChannelId || 'general';
  if (!channelId || channelId === 'general') return `rooms_data/${window.activeRoomId}/messages/${id}`;
  return `rooms_data/${window.activeRoomId}/channels/${channelId}/messages/${id}`;
}

function messageRef(id) {
  return ref(db, messagePath(id));
}

function roomMessagesRef(roomId) {
  return roomId === 'global' ? ref(db, 'messages') : ref(db, `rooms_data/${roomId}/messages`);
}

function ensureToolsRoot() {
  let host = $('message-tools-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'message-tools-root';
    document.body.appendChild(host);
  }

  if (!toolsRoot) toolsRoot = createRoot(host);

  if (!documentClickBound) {
    documentClickBound = true;
    document.addEventListener('click', () => {
      if (!state.menu?.open) return;
      closeMenu();
    });
    document.addEventListener('scroll', (event) => {
      if (!state.menu?.open) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.('#msg-menu')) return;
      closeMenu();
    }, true);
    window.addEventListener('resize', () => closeMenu());
  }

  return toolsRoot;
}

function setToolState(patch) {
  Object.assign(state, patch);
  renderMessageTools();
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!state.menu) return;
  const trigger = state.menu.trigger;
  trigger?.setAttribute?.('aria-expanded', 'false');
  setToolState({ menu: null });
  if (restoreFocus && trigger?.isConnected) {
    window.requestAnimationFrame(() => trigger.focus());
  }
}

function closeForward() {
  if (!state.forward) return;
  setToolState({ forward: null });
}

function closeBookmarkPrompt() {
  if (!state.bookmarkPrompt) return;
  setToolState({ bookmarkPrompt: null });
}

function closeBookmarksPanel() {
  setToolState({ bookmarksOpen: false });
}

function renderMessageTools() {
  ensureToolsRoot().render(createElement(Fragment, null,
    createElement(MessageMenu, {
      menu: state.menu,
      onAction: handleMenuAction,
      onClose: closeMenu,
    }),
    createElement(ForwardModal, {
      forward: state.forward,
      onClose: closeForward,
      onForward: (roomId) => forwardToSelectedRoom(roomId),
    }),
    createElement(BookmarkCollectionDialog, {
      bookmarkPrompt: state.bookmarkPrompt,
      onClose: closeBookmarkPrompt,
      onSubmit: saveBookmarkFromPrompt,
    }),
    createElement(BookmarksPanel, {
      bookmarks: state.bookmarks,
      open: state.bookmarksOpen,
      onClose: closeBookmarksPanel,
      onOpenBookmark: openBookmark,
      onRemoveBookmark: removeBookmark,
    }),
  ));
}

window.closeBookmarksPanel = closeBookmarksPanel;

window.openMsgMenu = function openMsgMenu(event, id) {
  event.stopPropagation();
  const message = window.msgCache?.[id];
  if (!message) return;

  const uid = window.currentUser?.uid;
  const mine = message.uid === uid;
  const canFlag = mine || uid === window.MY_ADMIN_UID;
  const canDelete = mine || uid === window.MY_ADMIN_UID;
  const saved = !!(window.__bookmarkIds && window.__bookmarkIds[id]);
  const trigger = event.currentTarget instanceof Element ? event.currentTarget : null;
  if (state.menu?.open && state.menu.trigger === trigger) {
    closeMenu({ restoreFocus: true });
    return;
  }

  state.menu?.trigger?.setAttribute?.('aria-expanded', 'false');
  trigger?.setAttribute?.('aria-expanded', 'true');
  const margin = 12;
  const rootStyle = getComputedStyle(document.documentElement);
  const safeLeft = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-left')) || 0;
  const safeRight = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-right')) || 0;
  const safeTop = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-top')) || 0;
  const safeBottom = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-bottom')) || 0;
  const minLeft = margin + safeLeft;
  const maxRight = margin + safeRight;
  const minTop = margin + safeTop;
  const maxBottom = margin + safeBottom;
  const menuWidth = Math.min(280, Math.max(220, window.innerWidth - minLeft - maxRight));
  const menuItemCount = 3 + (mine ? 1 : 0) + (canFlag ? 1 : 0) + (canDelete ? 1 : 0);
  const menuHeight = Math.min(360, (menuItemCount * 44) + 16);
  const triggerRect = trigger?.getBoundingClientRect?.();
  let x = triggerRect ? triggerRect.left : (event.clientX || minLeft);
  let y = triggerRect ? triggerRect.bottom + 8 : (event.clientY || minTop);

  x = Math.min(Math.max(minLeft, x), Math.max(minLeft, window.innerWidth - menuWidth - maxRight));
  if (y + menuHeight > window.innerHeight - maxBottom) {
    y = triggerRect ? triggerRect.top - menuHeight - 8 : y - menuHeight;
  }
  y = Math.min(Math.max(minTop, y), Math.max(minTop, window.innerHeight - menuHeight - maxBottom));

  setToolState({
    menu: {
      open: true,
      messageId: id,
      x,
      y,
      saved,
      canFlag,
      canEdit: mine,
      canDelete,
      important: !!message.important,
      roomId: window.activeRoomId,
      channelId: window.activeChannelId || 'general',
      trigger,
    },
  });
};

async function handleMenuAction(action) {
  const menu = state.menu;
  const id = menu?.messageId;
  closeMenu();
  if (!id) return;

  if (action === 'edit' || action === 'delete') {
    const currentChannelId = window.activeChannelId || 'general';
    if (menu.roomId !== window.activeRoomId || menu.channelId !== currentChannelId) {
      window.showToast?.('That message belongs to a different room. Open its menu again.');
      return;
    }

    const message = window.msgCache?.[id];
    const uid = window.currentUser?.uid;
    const isMine = message?.uid === uid;
    const isAdmin = uid === window.MY_ADMIN_UID;
    if (action === 'edit') {
      if (!isMine) {
        window.showToast?.('Only the author can edit this message.');
        return;
      }
      await window.editMessage?.(id);
      return;
    }

    if (!(isMine || isAdmin)) {
      window.showToast?.('You do not have permission to delete this message.');
      return;
    }
    await window.deleteMessage?.(id);
    return;
  }

  if (action === 'forward') await openForward(id);
  else if (action === 'bookmark') await toggleBookmark(id);
  else if (action === 'flag') await toggleImportant(id);
  else if (action === 'impact') await showImpact(id);
}

async function toggleImportant(id) {
  const message = window.msgCache?.[id];
  if (!message) return;
  if (!(message.uid === window.currentUser.uid || window.currentUser.uid === window.MY_ADMIN_UID)) {
    window.showToast?.('Only the author can flag this message.');
    return;
  }

  try {
    await update(messageRef(id), { important: !message.important });
  } catch (error) {
    window.showToast?.(`Could not update flag: ${error.message}`);
  }
}

async function showImpact(id) {
  let reactions = 0;
  try {
    const snapshot = await get(ref(db, `${messagePath(id)}/reactions`));
    if (snapshot.exists()) reactions = Object.keys(snapshot.val()).length;
  } catch {
    reactions = Object.keys(window.msgCache?.[id]?.reactions || {}).length;
  }

  let replies = 0;
  Object.values(window.msgCache || {}).forEach((message) => {
    if (message?.replyTo?.id === id) replies += 1;
  });

  window.showToast?.(`🔥 Impact — ${reactions} reaction${reactions === 1 ? '' : 's'} · ${replies} repl${replies === 1 ? 'y' : 'ies'}`, false);
}

async function openForward(id) {
  const message = window.msgCache?.[id];
  if (!message) return;

  let rooms = [{ id: 'global', name: 'Global Chat' }];
  try {
    const snapshot = await get(ref(db, `user_rooms/${window.currentUser.uid}`));
    snapshot.forEach((child) => {
      const room = child.val() || {};
      rooms.push({ id: child.key, name: room.name || 'Room' });
    });
  } catch {
    rooms = [{ id: 'global', name: 'Global Chat' }];
  }

  setToolState({ forward: { open: true, messageId: id, rooms } });
}

async function forwardToSelectedRoom(roomId) {
  const id = state.forward?.messageId;
  closeForward();
  if (!id) return;
  await forwardTo(id, roomId);
}

async function forwardTo(id, roomId) {
  const message = window.msgCache?.[id];
  if (!message) return;

  try {
    const senderName = window.userProfileName || window.currentUser?.displayName || 'Anonymous';
    await set(push(roomMessagesRef(roomId)), {
      uid: window.currentUser.uid,
      name: senderName,
      photoUrl: window.userPhotoUrl,
      text: message.text || '',
      attachedImage: message.attachedImage || null,
      attachedFile: message.attachedFile || null,
      timestamp: serverTimestamp(),
      tier: window.userTier,
      forwardedFrom: message.name || '',
    });

    if (roomId !== 'global') {
      const preview = message.text
        ? `${senderName}: ${message.text}`
        : `${senderName} sent ${message.attachedImage ? 'an image' : 'a file'}`;
      await set(
        ref(db, `rooms_meta/${roomId}/lastMessage`),
        preview.length > 30 ? `${preview.substring(0, 30)}...` : preview,
      );
    }

    window.showToast?.('Message forwarded.', false);
  } catch (error) {
    window.showToast?.(`Forward failed: ${error.message}`);
  }
}

async function toggleBookmark(id) {
  const message = window.msgCache?.[id];
  if (!message) return;

  const bookmarkRef = ref(db, `users/${window.currentUser.uid}/bookmarks/${id}`);
  try {
    const snapshot = await get(bookmarkRef);
    if (snapshot.exists()) {
      await remove(bookmarkRef);
      window.showToast?.('Removed from saved.', false);
      return;
    }

    setToolState({ bookmarkPrompt: { open: true, messageId: id } });
  } catch (error) {
    window.showToast?.(`Could not save: ${error.message}`);
  }
}

async function saveBookmarkFromPrompt(collectionInput) {
  const id = state.bookmarkPrompt?.messageId;
  const message = window.msgCache?.[id];
  if (!id || !message) {
    closeBookmarkPrompt();
    return;
  }

  const collection = String(collectionInput || 'Saved').trim() || 'Saved';
  const bookmarkRef = ref(db, `users/${window.currentUser.uid}/bookmarks/${id}`);

  try {
    await set(bookmarkRef, {
      text: (message.text || '(attachment)').slice(0, 200),
      name: message.name || '',
      roomId: window.activeRoomId,
      roomName: $('active-room-name-display')?.textContent || '',
      shortId: window.activeRoomShortId || '',
      channelId: window.activeChannelId || 'general',
      collection,
      ts: Date.now(),
    });
    closeBookmarkPrompt();
    window.showToast?.(`Saved to “${collection}”.`, false);
  } catch (error) {
    window.showToast?.(`Could not save: ${error.message}`);
  }
}

function openBookmark(bookmark) {
  if (!bookmark?.roomId) return;
  const channelId = bookmark.channelId || 'general';
  const jump = {
    messageId: bookmark.id,
    roomId: bookmark.roomId,
    roomName: bookmark.roomName || '',
    shortId: bookmark.shortId || '',
    channelId,
    source: 'saved',
    messageText: bookmark.text || '',
  };

  window.pendingMessageJump = jump;
  window.switchRoom?.(bookmark.roomId, bookmark.roomName, bookmark.shortId, { channelId });
  window.dispatchEvent(new CustomEvent('minimalist:message-jump', { detail: jump }));
  setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 400);
  closeBookmarksPanel();
}

async function removeBookmark(id) {
  if (!id || !window.currentUser?.uid) return;
  await remove(ref(db, `users/${window.currentUser.uid}/bookmarks/${id}`));
}

window.openBookmarks = function openBookmarks() {
  if (typeof window.openVault === 'function') {
    window.openVault('saved');
    return;
  }

  if (typeof window.closeFloatingUI === 'function') {
    window.closeFloatingUI({ keep: 'bookmarks-panel' });
  } else {
    if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel();
    else document.getElementById('updates-panel')?.classList.remove('open');
    const contactsPanel = document.getElementById('contacts-panel');
    if (contactsPanel?.classList.contains('open')) {
      if (typeof window.closeContactsPanel === 'function') window.closeContactsPanel();
      else contactsPanel.classList.remove('open');
    }
    if (typeof window.closePersonalAgent === 'function') {
      window.closePersonalAgent({ restoreFocus: false });
    } else {
      const personalAgentPanel = document.getElementById('personal-ai-agent-panel');
      personalAgentPanel?.classList.remove('open');
      personalAgentPanel?.setAttribute('aria-hidden', 'true');
      personalAgentPanel?.setAttribute('aria-modal', 'false');
      document.getElementById('open-personal-agent-btn')?.setAttribute('aria-expanded', 'false');
      document.getElementById('open-personal-agent-btn-mobile')?.setAttribute('aria-expanded', 'false');
    }
  }
  setToolState({ bookmarksOpen: true });
};

window.initMessageTools = function initMessageTools() {
  if (!window.currentUser) return;
  renderMessageTools();
  onValue(ref(db, `users/${window.currentUser.uid}/bookmarks`), (snapshot) => {
    const data = snapshot.val() || {};
    window.__bookmarkIds = data;
    window.dispatchEvent(new CustomEvent('minimalist:bookmarks-updated', { detail: data }));
    setToolState({ bookmarks: data });
  });
};

$('open-bookmarks-btn')?.addEventListener('click', () => window.openVault?.('saved') || window.openBookmarks());
