import {
  get,
  onValue,
  ref,
  remove,
  set,
} from 'firebase/database';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';
import ContactsList from './ContactsList.jsx';

let contactsRoot = null;
let contactsRootHost = null;
let contactsUnsubscribers = [];
let contactsSubscribedUid = null;
let contactsPresenceUnsubscribers = new Map();
let contactsRenderTimer = 0;
let contactsRenderVersion = 0;
let contactsOpenWorkVersion = 0;
let contactsRenderPromise = null;
let contactsRenderQueued = false;
let contactSearchInput = null;
let contactSearchHandler = null;
let contactSearchClearButton = null;
let contactSearchClearHandler = null;
let contactsLastFocusedElement = null;
let contactsCachedUid = null;
let contactsFriendsData = null;
let contactsInboxData = null;
let contactsPresenceData = {};
let contactsDirectorySnapshot = null;
let contactsDirectoryLoadedAt = 0;
let contactsDirectoryLoad = null;
let contactsLastSections = null;
let contactsRoomMembersCache = null;
let contactsRoomMembersLoad = null;
let contactsProfilePrewarmHandle = null;
let contactsProfilePrewarmUsesIdle = false;
let contactsProfilePrewarmed = false;
let contactsProfilePrewarmVersion = 0;
const mutualRoomCache = new Map();
const mutualRoomLoads = new Map();
const contactUserCache = new Map();
const contactUserLoads = new Map();
const contactUserMisses = new Map();
const contactsDirectorySearchCache = new Map();
const MUTUAL_ROOM_CACHE_TTL = 5 * 60 * 1000;
const CONTACT_DIRECTORY_CACHE_TTL = 5 * 60 * 1000;
const CONTACT_USER_CACHE_TTL = 10 * 60 * 1000;
const CONTACT_USER_MISS_TTL = 60 * 1000;
const CONTACT_USER_CACHE_LIMIT = 400;
const CONTACT_ROOM_MEMBERS_CACHE_TTL = 30 * 1000;

function getCurrentUid() {
  return window.currentUser?.uid || null;
}

function ensureContactsRoot(list) {
  if (contactsRoot && contactsRootHost !== list) {
    contactsRoot.unmount();
    contactsRoot = null;
    contactsRootHost = null;
  }
  if (!contactsRoot) {
    contactsRoot = createRoot(list);
    contactsRootHost = list;
  }
  return contactsRoot;
}

async function safeGetValue(path, fallback, options = {}) {
  try {
    const snapshot = await get(ref(db, path));
    return snapshot.exists() ? snapshot.val() : fallback;
  } catch (error) {
    if (!options.quiet) console.warn(`Unable to load ${path}`, error);
    return fallback;
  }
}

function mountContactsList(list, sections, options = {}) {
  const status = options.status || null;
  list.setAttribute('aria-busy', status?.mode === 'loading' ? 'true' : 'false');
  ensureContactsRoot(list).render(createElement(ContactsList, {
    sections,
    summary: options.summary || null,
    searchQuery: options.searchQuery || '',
    status,
    onAcceptRequest: (uid) => runContactAction(() => window.acceptRequest(uid)),
    onOpenPrivateChat: (uid, name, chatOptions) => {
      closeContactsPanel({ restoreFocus: false });
      window.openPrivateChat(uid, name, { ...chatOptions, returnTo: 'contacts' });
    },
    onOpenProfile: (uid) => window.viewUserProfile(uid),
    onRemoveFriend: (uid) => runContactAction(() => window.removeFriend(uid)),
    onRetry: () => {
      renderContactsStatus('Refreshing your contacts…', { mode: 'loading', title: 'Loading contacts' });
      scheduleContactsRender({ debounceMs: 0 });
    },
    onSendRequest: (uid) => runContactAction(() => window.sendRequest(uid)),
  }));
  requestAnimationFrame(() => window.refreshContactUnreadDots?.());
}

function renderContactsStatus(message, options = {}) {
  const list = document.getElementById('contacts-list');
  if (!list) return;

  mountContactsList(list, [], {
    status: {
      id: options.id || 'status',
      mode: options.mode || 'info',
      title: options.title || 'Contacts',
      message,
    },
  });
}

async function runContactAction(action) {
  try {
    if (!getCurrentUid()) throw new Error('Please sign in first.');
    await action();
    scheduleContactsRender({ debounceMs: 40 });
  } catch (error) {
    window.showToast?.(`Contact action failed: ${error.message}`);
  }
}

function normalizeUserRecord(user = {}) {
  const displayName = (user.displayName || user.name || user.username || 'Unknown').trim();
  return {
    displayName,
    shortId: user.shortId || '',
    username: user.username || '',
    pronouns: user.pronouns || '',
    bio: user.bio || '',
    status: user.status || '',
    flair: user.flair || '',
    photoUrl: user.photoUrl || user.photoURL || '',
    themeColor: user.themeColor || '',
    updatedAt: user.updatedAt || 0,
  };
}

function toContact(uid, user, status, presenceData, inboxEntry = null) {
  const displayName = user.displayName || 'Unknown';
  const lastText = inboxEntry?.lastText ? String(inboxEntry.lastText).replace(/\s+/g, ' ').trim() : '';
  return {
    uid,
    displayName,
    shortId: user.shortId || '',
    avatar: user.photoUrl || window.getAvatarUrl?.(displayName, '') || '',
    status,
    profileStatus: String(user.status || '').trim(),
    isOnline: presenceData[uid]?.state === 'online',
    unread: inboxEntry?.read === false,
    lastPm: lastText.length > 72 ? `${lastText.slice(0, 69)}...` : lastText,
    lastPmAt: inboxEntry?.timestamp || 0,
  };
}

function pushSection(sections, id, title, items, options = {}) {
  if (!items.length && !options.empty) return;
  sections.push({ id, title, items, ...options });
}

function stopPresenceSubscriptions({ clearData = false } = {}) {
  contactsPresenceUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
  contactsPresenceUnsubscribers = new Map();
  if (clearData) contactsPresenceData = {};
}

function resetContactCaches(uid = null) {
  cancelMutualRoomRefreshes();
  contactsCachedUid = uid;
  contactsFriendsData = null;
  contactsInboxData = null;
  contactsLastSections = null;
  contactsRoomMembersCache = null;
  contactsRoomMembersLoad = null;
  stopPresenceSubscriptions({ clearData: true });
}

function stopContactSubscriptions({ clearPresence = false } = {}) {
  contactsUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
  contactsUnsubscribers = [];
  contactsSubscribedUid = null;
  window.clearTimeout(contactsRenderTimer);
  contactsRenderTimer = 0;
  stopPresenceSubscriptions({ clearData: clearPresence });
}

function startContactSubscriptions(uid) {
  if (contactsCachedUid !== uid) resetContactCaches(uid);
  if (contactsSubscribedUid === uid && contactsUnsubscribers.length) return;
  stopContactSubscriptions();
  contactsSubscribedUid = uid;
  contactsUnsubscribers = [
    onValue(ref(db, `friends/${uid}`), (snapshot) => {
      contactsFriendsData = snapshot.exists() ? snapshot.val() : {};
      scheduleContactsRender({ debounceMs: 120 });
    }),
  ];
}

function scheduleContactsRender({ debounceMs = 140 } = {}) {
  if (!isContactsPanelOpen()) return;
  window.clearTimeout(contactsRenderTimer);
  contactsRenderTimer = window.setTimeout(() => {
    contactsRenderTimer = 0;
    if (isContactsPanelOpen()) void window.renderContactsUI?.();
  }, debounceMs);
}

window.addEventListener('minimalist:pm-inbox', (event) => {
  const uid = getCurrentUid();
  if (!uid || (contactsCachedUid && contactsCachedUid !== uid)) return;
  contactsInboxData = event.detail?.inbox || {};
  scheduleContactsRender({ debounceMs: 80 });
});

function syncContactSearchChrome(queryValue, options = {}) {
  const query = String(queryValue || '').trim();
  const clearButton = document.getElementById('clear-contact-search-btn');
  if (clearButton) {
    clearButton.hidden = !query;
    clearButton.disabled = !query;
  }

  const status = document.getElementById('contacts-search-status');
  if (!status) return;
  if (!query) {
    status.textContent = '';
    return;
  }
  if (options.pending) {
    status.textContent = query.length >= 2 ? 'Searching all people…' : 'Filtering contacts…';
    return;
  }
  const resultCount = Number.isFinite(options.resultCount) ? Number(options.resultCount) : null;
  if (resultCount === null) return;
  const noun = resultCount === 1 ? 'result' : 'results';
  status.textContent = query.length >= 2
    ? `${resultCount} ${noun}`
    : `${resultCount} ${noun} in your contacts`;
}

function bindContactSearchInput() {
  const input = document.getElementById('contact-search-input');
  const clearButton = document.getElementById('clear-contact-search-btn');
  if (
    input === contactSearchInput
    && clearButton === contactSearchClearButton
    && contactSearchHandler
    && contactSearchClearHandler
  ) {
    syncContactSearchChrome(input?.value || '');
    return;
  }
  if (contactSearchInput && contactSearchHandler) {
    contactSearchInput.removeEventListener('input', contactSearchHandler);
  }
  if (contactSearchClearButton && contactSearchClearHandler) {
    contactSearchClearButton.removeEventListener('click', contactSearchClearHandler);
  }
  contactSearchInput = input;
  contactSearchClearButton = clearButton;
  contactSearchHandler = (event) => {
    event.stopPropagation();
    syncContactSearchChrome(event.currentTarget?.value || '', { pending: true });
    scheduleContactsRender({ debounceMs: 170 });
  };
  contactSearchClearHandler = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!contactSearchInput) return;
    contactSearchInput.value = '';
    syncContactSearchChrome('');
    scheduleContactsRender({ debounceMs: 0 });
    contactSearchInput.focus({ preventScroll: true });
  };
  contactSearchInput?.addEventListener('input', contactSearchHandler);
  contactSearchClearButton?.addEventListener('click', contactSearchClearHandler);
  syncContactSearchChrome(contactSearchInput?.value || '');
}

function getCachedContactUser(uid) {
  const cached = contactUserCache.get(uid);
  if (!cached) return null;
  if (Date.now() - cached.loadedAt > CONTACT_USER_CACHE_TTL) {
    contactUserCache.delete(uid);
    return null;
  }
  return cached.record;
}

function cacheContactUser(uid, record) {
  if (!uid || !record) return null;
  const normalized = normalizeUserRecord(record);
  contactUserMisses.delete(uid);
  if (!contactUserCache.has(uid) && contactUserCache.size >= CONTACT_USER_CACHE_LIMIT) {
    contactUserCache.delete(contactUserCache.keys().next().value);
  }
  contactUserCache.set(uid, { record: normalized, loadedAt: Date.now() });
  return normalized;
}

async function loadContactUser(uid) {
  const cached = getCachedContactUser(uid);
  if (cached) return cached;

  const missedAt = contactUserMisses.get(uid) || 0;
  if (Date.now() - missedAt < CONTACT_USER_MISS_TTL) return null;
  if (contactUserLoads.has(uid)) return contactUserLoads.get(uid);

  const load = safeGetValue(`user_directory/${uid}`, null, { quiet: true })
    .then((record) => {
      if (record) return cacheContactUser(uid, record);
      if (!contactUserMisses.has(uid) && contactUserMisses.size >= CONTACT_USER_CACHE_LIMIT) {
        contactUserMisses.delete(contactUserMisses.keys().next().value);
      }
      contactUserMisses.set(uid, Date.now());
      return null;
    })
    .finally(() => {
      if (contactUserLoads.get(uid) === load) contactUserLoads.delete(uid);
    });
  contactUserLoads.set(uid, load);
  return load;
}

window.getCachedContactPublicProfile = function getCachedContactPublicProfile(uid) {
  const record = getCachedContactUser(uid);
  return record ? { ...record } : null;
};

window.getCachedContactPresence = function getCachedContactPresence(uid) {
  const presence = contactsPresenceData?.[uid];
  return presence ? { ...presence } : null;
};

async function getSearchDirectorySnapshot() {
  const freshEnough = contactsDirectorySnapshot && Date.now() - contactsDirectoryLoadedAt < CONTACT_DIRECTORY_CACHE_TTL;
  if (freshEnough) return contactsDirectorySnapshot;
  if (contactsDirectoryLoad) return contactsDirectoryLoad;

  contactsDirectoryLoad = safeGetValue('user_directory', {}, { quiet: true })
    .then((directoryData) => {
      contactsDirectorySnapshot = directoryData || {};
      contactsDirectoryLoadedAt = Date.now();
      contactsDirectorySearchCache.clear();
      return contactsDirectorySnapshot;
    })
    .finally(() => {
      contactsDirectoryLoad = null;
    });

  return contactsDirectoryLoad;
}

function searchContactDirectory(directoryData, searchQuery, limit = 80) {
  const cached = contactsDirectorySearchCache.get(searchQuery);
  if (cached) return cached;

  const matches = [];
  Object.entries(directoryData || {}).some(([candidateUid, record]) => {
    const normalized = normalizeUserRecord(record);
    const haystack = `${normalized.displayName} ${normalized.shortId}`.toLowerCase();
    if (haystack.includes(searchQuery)) matches.push(candidateUid);
    return matches.length >= limit;
  });

  if (contactsDirectorySearchCache.size >= 40) {
    contactsDirectorySearchCache.delete(contactsDirectorySearchCache.keys().next().value);
  }
  contactsDirectorySearchCache.set(searchQuery, matches);
  return matches;
}

function syncPresenceSubscriptions(currentUid, candidateUids) {
  const trackedUids = new Set([...candidateUids].filter((candidateUid) => candidateUid && candidateUid !== currentUid));

  contactsPresenceUnsubscribers.forEach((unsubscribe, candidateUid) => {
    if (trackedUids.has(candidateUid)) return;
    unsubscribe?.();
    contactsPresenceUnsubscribers.delete(candidateUid);
    delete contactsPresenceData[candidateUid];
  });

  trackedUids.forEach((candidateUid) => {
    if (contactsPresenceUnsubscribers.has(candidateUid)) return;
    const presenceRef = ref(db, `presence/${candidateUid}`);
    const unsubscribe = onValue(presenceRef, (snapshot) => {
      const nextValue = snapshot.exists() ? snapshot.val() : null;
      const previousState = contactsPresenceData[candidateUid]?.state || null;
      const nextState = nextValue?.state || null;
      contactsPresenceData = { ...contactsPresenceData, [candidateUid]: nextValue };
      if (previousState !== nextState) scheduleContactsRender({ debounceMs: 90 });
    });
    contactsPresenceUnsubscribers.set(candidateUid, unsubscribe);
  });
}

function cancelContactsProfilePrewarm() {
  if (contactsProfilePrewarmHandle === null) return;
  contactsProfilePrewarmVersion += 1;
  if (contactsProfilePrewarmUsesIdle) window.cancelIdleCallback?.(contactsProfilePrewarmHandle);
  else window.clearTimeout(contactsProfilePrewarmHandle);
  contactsProfilePrewarmHandle = null;
  contactsProfilePrewarmUsesIdle = false;
}

function scheduleContactsProfilePrewarm() {
  if (contactsProfilePrewarmed || contactsProfilePrewarmHandle !== null) return;
  const prewarmVersion = ++contactsProfilePrewarmVersion;
  const run = () => {
    contactsProfilePrewarmHandle = null;
    contactsProfilePrewarmUsesIdle = false;
    if (prewarmVersion !== contactsProfilePrewarmVersion || contactsProfilePrewarmed || !isContactsPanelOpen()) return;
    contactsProfilePrewarmed = true;
    Promise.resolve(window.prefetchProfilePopupService?.()).catch(() => {});
  };

  contactsProfilePrewarmUsesIdle = typeof window.requestIdleCallback === 'function';
  contactsProfilePrewarmHandle = contactsProfilePrewarmUsesIdle
    ? window.requestIdleCallback(run, { timeout: 1600 })
    : window.setTimeout(run, 240);
}

function openContactsPanel() {
  const panel = document.getElementById('contacts-panel');
  if (!panel) return;

  const openWorkVersion = ++contactsOpenWorkVersion;
  const wasOpen = panel.classList.contains('open');
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const shouldMoveFocus = !panel.contains(activeElement);
  if (shouldMoveFocus) contactsLastFocusedElement = activeElement;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  bindContactSearchInput();

  if (shouldMoveFocus) {
    window.requestAnimationFrame(() => {
      if (!isContactsPanelOpen()) return;
      const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
      const focusTarget = coarsePointer
        ? document.getElementById('close-contacts-btn')
        : document.getElementById('contact-search-input');
      focusTarget?.focus?.({ preventScroll: true });
    });
  }

  const uid = getCurrentUid();
  if (!uid) {
    resetContactCaches(null);
    stopContactSubscriptions();
    renderContactsStatus('Sign in to view your contacts and shared-room connections.', {
      mode: 'signed-out',
      title: 'Sign in to see contacts',
    });
    return;
  }

  if (contactsCachedUid !== uid) resetContactCaches(uid);
  if (window.latestPmInboxUid === uid && window.latestPmInbox) {
    contactsInboxData = window.latestPmInbox;
  }
  if (wasOpen && contactsSubscribedUid === uid && contactsUnsubscribers.length) return;

  const hasCachedData = contactsCachedUid === uid && (contactsFriendsData !== null || contactsInboxData !== null);
  const list = document.getElementById('contacts-list');
  if (list && contactsLastSections?.uid === uid) {
    mountContactsList(list, contactsLastSections.sections, contactsLastSections.options);
    syncContactSearchChrome(contactsLastSections.options?.searchQuery || '', {
      resultCount: contactsLastSections.options?.summary?.all || 0,
    });
  } else {
    renderContactsStatus('Finding friends, messages, and people from your rooms.', {
      mode: 'loading',
      title: 'Loading contacts',
    });
  }

  const startContactsWork = () => {
    if (
      openWorkVersion !== contactsOpenWorkVersion
      || !isContactsPanelOpen()
      || getCurrentUid() !== uid
    ) return;

    startContactSubscriptions(uid);
    // Firebase listeners deliver an initial snapshot. A short fallback render
    // avoids a duplicate read/render race while still recovering if a listener is slow.
    scheduleContactsRender({ debounceMs: hasCachedData ? 0 : 180 });

    scheduleContactsProfilePrewarm();
  };

  // Let the drawer and cached rows paint before Firebase listener setup and
  // profile-bundle parsing compete for the main thread.
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(startContactsWork));
  } else {
    window.setTimeout(startContactsWork, 0);
  }
}

function closeContactsPanel() {
  const options = arguments[0] || {};
  const panel = document.getElementById('contacts-panel');
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusWasInside = Boolean(activeElement && panel?.contains(activeElement));
  panel?.classList.remove('open');
  panel?.setAttribute('aria-hidden', 'true');
  contactsOpenWorkVersion += 1;
  contactsRenderVersion += 1;
  contactsRenderQueued = false;
  cancelContactsProfilePrewarm();
  cancelMutualRoomRefreshes();
  stopContactSubscriptions({ clearPresence: true });
  if (focusWasInside) {
    const restoreTarget = options.restoreFocus ? contactsLastFocusedElement : null;
    if (restoreTarget?.isConnected) {
      window.requestAnimationFrame(() => restoreTarget.focus({ preventScroll: true }));
    } else {
      activeElement.blur?.();
    }
  }
  contactsLastFocusedElement = null;
}

function disposeContactsPanel() {
  closeContactsPanel({ restoreFocus: false });
  if (contactSearchInput && contactSearchHandler) {
    contactSearchInput.removeEventListener('input', contactSearchHandler);
  }
  contactSearchInput = null;
  contactSearchHandler = null;
  if (contactSearchClearButton && contactSearchClearHandler) {
    contactSearchClearButton.removeEventListener('click', contactSearchClearHandler);
  }
  contactSearchClearButton = null;
  contactSearchClearHandler = null;
  contactsLastSections = null;
  contactsCachedUid = null;
  if (contactsRoot) contactsRoot.unmount();
  contactsRoot = null;
  contactsRootHost = null;
}

window.openContactsPanel = openContactsPanel;
window.closeContactsPanel = closeContactsPanel;
window.disposeContactsPanel = disposeContactsPanel;

window.toggleContacts = function toggleContacts() {
  const panel = document.getElementById('contacts-panel');
  if (!panel) return;

  if (panel.classList.contains('open')) closeContactsPanel({ restoreFocus: true });
  else openContactsPanel();
};

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (target?.closest('#close-contacts-btn')) closeContactsPanel({ restoreFocus: true });
});

window.sendRequest = async (targetUid) => {
  const uid = getCurrentUid();
  if (!uid) throw new Error('Please sign in first.');

  await set(ref(db, `friends/${uid}/${targetUid}`), 'pending_sent');
  await set(ref(db, `friends/${targetUid}/${uid}`), 'pending_received');

  if (window.createNotification) {
    window.createNotification(
      targetUid,
      'friend',
      `${window.userProfileName || 'Someone'} sent you a friend request!`,
      { groupId: uid, from: window.userProfileName || 'Someone' },
    );
  }
};

window.acceptRequest = async (targetUid) => {
  const uid = getCurrentUid();
  if (!uid) throw new Error('Please sign in first.');

  await set(ref(db, `friends/${uid}/${targetUid}`), 'accepted');
  await set(ref(db, `friends/${targetUid}/${uid}`), 'accepted');

  if (window.awardBadge) {
    window.awardBadge(uid, 'first_friend');
    window.awardBadge(targetUid, 'first_friend');
    window.awardXP?.(uid, 'support', 5);
    window.awardXP?.(targetUid, 'support', 5);
    window.trackQuest?.('friend');

    try {
      const mine = Object.values((await get(ref(db, `friends/${uid}`))).val() || {})
        .filter((status) => status === 'accepted').length;
      if (mine >= 10) window.awardBadge(uid, 'social');
    } catch {
      // Badge progress is best effort.
    }
  }
};

window.removeFriend = async (targetUid) => {
  const uid = getCurrentUid();
  if (!uid) throw new Error('Please sign in first.');

  await remove(ref(db, `friends/${uid}/${targetUid}`));
  await remove(ref(db, `friends/${targetUid}/${uid}`));
};

async function readCurrentRoomMembers() {
  const roomId = window.activeRoomId;
  if (!roomId || roomId === 'global') return {};
  if (contactsRoomMembersCache?.roomId === roomId
      && Date.now() - contactsRoomMembersCache.loadedAt < CONTACT_ROOM_MEMBERS_CACHE_TTL) {
    return contactsRoomMembersCache.members;
  }
  if (contactsRoomMembersLoad?.roomId === roomId) return contactsRoomMembersLoad.promise;

  const promise = safeGetValue(`rooms_meta/${roomId}/members`, {}, { quiet: true })
    .then((members) => {
      contactsRoomMembersCache = { roomId, loadedAt: Date.now(), members: members || {} };
      return members || {};
    });
  contactsRoomMembersLoad = { roomId, promise };
  try {
    return await promise;
  } finally {
    if (contactsRoomMembersLoad?.promise === promise) contactsRoomMembersLoad = null;
  }
}

async function readMutualRoomUids(uid, shouldContinue = () => true) {
  const mutualUids = new Set();
  const myRooms = await safeGetValue(`user_rooms/${uid}`, {}, { quiet: true });
  if (!shouldContinue()) return mutualUids;
  const roomIds = Object.keys(myRooms || {}).filter((roomId) => roomId && roomId !== 'global').slice(0, 80);
  const roomMembers = new Array(roomIds.length).fill(null);
  let cursor = 0;
  const loadNextRoom = async () => {
    while (cursor < roomIds.length && shouldContinue()) {
      const index = cursor;
      cursor += 1;
      roomMembers[index] = await safeGetValue(`rooms_meta/${roomIds[index]}/members`, null, { quiet: true });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, roomIds.length) }, () => loadNextRoom()));

  roomMembers.forEach((members) => {
    const memberMap = members || {};
    if (memberMap[uid]) {
      Object.keys(memberMap).forEach((memberUid) => {
        if (memberUid !== uid) mutualUids.add(memberUid);
      });
    }
  });

  return mutualUids;
}

function getCachedMutualRoomUids(uid) {
  const cached = mutualRoomCache.get(uid);
  if (!cached) return new Set();
  if (Date.now() - cached.loadedAt > MUTUAL_ROOM_CACHE_TTL) return new Set();
  return cached.uids;
}

function cancelMutualRoomRefreshes() {
  mutualRoomLoads.forEach((record, uid) => {
    record.cancelled = true;
    if (!record.started) {
      if (record.usesIdleCallback) window.cancelIdleCallback?.(record.handle);
      else window.clearTimeout(record.handle);
    }
    if (mutualRoomLoads.get(uid) === record) mutualRoomLoads.delete(uid);
  });
}

function isContactsPanelOpen() {
  return Boolean(document.getElementById('contacts-panel')?.classList.contains('open'));
}

function scheduleMutualRoomRefresh(uid) {
  const cached = mutualRoomCache.get(uid);
  if (cached && Date.now() - cached.loadedAt < MUTUAL_ROOM_CACHE_TTL) return;
  if (mutualRoomLoads.has(uid)) return;

  const record = {
    cancelled: false,
    handle: 0,
    started: false,
    usesIdleCallback: typeof window.requestIdleCallback === 'function',
  };
  const shouldContinue = () => !record.cancelled && getCurrentUid() === uid && isContactsPanelOpen();
  const run = async () => {
    record.started = true;
    try {
      if (!shouldContinue()) return;
      const uids = await readMutualRoomUids(uid, shouldContinue);
      if (!shouldContinue()) return;
      mutualRoomCache.set(uid, { uids, loadedAt: Date.now() });
      if (getCurrentUid() === uid && isContactsPanelOpen()) scheduleContactsRender({ debounceMs: 180 });
    } catch (error) {
      if (shouldContinue()) console.warn('Unable to refresh mutual contacts.', error);
    } finally {
      if (mutualRoomLoads.get(uid) === record) mutualRoomLoads.delete(uid);
    }
  };

  if (record.usesIdleCallback) record.handle = window.requestIdleCallback(run, { timeout: 2500 });
  else record.handle = window.setTimeout(run, 600);
  mutualRoomLoads.set(uid, record);
}

async function loadContactUsers(candidateUids, directoryData, currentUid) {
  const candidates = [...candidateUids];
  const entries = new Array(candidates.length).fill(null);
  let cursor = 0;

  const loadNext = async () => {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      const uid = candidates[index];
      if (!uid || uid === currentUid) continue;

      const cachedRecord = directoryData?.[uid] ? cacheContactUser(uid, directoryData[uid]) : getCachedContactUser(uid);
      if (cachedRecord) {
        entries[index] = [uid, cachedRecord];
        continue;
      }

      const directoryRecord = await loadContactUser(uid);
      if (directoryRecord) entries[index] = [uid, directoryRecord];
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, () => loadNext()));

  return Object.fromEntries(entries.filter(Boolean));
}

function withDiscoverySource(contact, discoverySource) {
  return { ...contact, discoverySource };
}

function summarizeContacts(contacts) {
  const uniqueContacts = new Map();
  contacts.forEach((contact) => {
    if (contact?.uid && !uniqueContacts.has(contact.uid)) uniqueContacts.set(contact.uid, contact);
  });
  const values = [...uniqueContacts.values()];
  return {
    all: values.length,
    totalContacts: values.filter((contact) => contact.status === 'accepted').length,
    online: values.filter((contact) => contact.status === 'accepted' && contact.isOnline).length,
    messages: values.filter((contact) => contact.unread || contact.lastPm).length,
    requests: values.filter((contact) => (
      contact.status === 'pending_received' || contact.status === 'pending_sent'
    )).length,
  };
}

async function performContactsRender() {
  const renderVersion = ++contactsRenderVersion;
  const list = document.getElementById('contacts-list');
  if (!list?.isConnected || !isContactsPanelOpen()) return;

  const uid = getCurrentUid();
  if (!uid) {
    resetContactCaches(null);
    renderContactsStatus('Sign in to view your contacts and shared-room connections.', {
      mode: 'signed-out',
      title: 'Sign in to see contacts',
    });
    return;
  }

  if (contactsCachedUid !== uid) resetContactCaches(uid);

  try {
    const searchInput = document.getElementById('contact-search-input');
    const searchValue = searchInput ? searchInput.value.trim() : '';
    const searchQuery = searchValue.toLowerCase();
    syncContactSearchChrome(searchValue, { pending: Boolean(searchValue) });

    const mutualUids = getCachedMutualRoomUids(uid);
    const [myFriends, currentRoomMembers, myInbox] = await Promise.all([
      contactsFriendsData ?? safeGetValue(`friends/${uid}`, {}, { quiet: true }),
      readCurrentRoomMembers(),
      contactsInboxData ?? safeGetValue(`inbox/${uid}`, {}, { quiet: true }),
    ]);
    contactsFriendsData = myFriends || {};
    contactsInboxData = myInbox || {};
    if (renderVersion !== contactsRenderVersion || !isContactsPanelOpen()) return;
    scheduleMutualRoomRefresh(uid);

    let directoryData = {};
    const urgentCandidateUids = new Set();
    const searchCandidateUids = new Set();
    const candidateUids = new Set();
    Object.entries(myInbox || {}).forEach(([inboxUid, entry]) => {
      if (entry?.read === false) urgentCandidateUids.add(inboxUid);
    });
    Object.entries(myFriends || {}).forEach(([friendUid, status]) => {
      if (status === 'pending_received') urgentCandidateUids.add(friendUid);
    });
    Object.keys(myFriends || {}).forEach((friendUid) => candidateUids.add(friendUid));
    Object.keys(currentRoomMembers || {}).forEach((memberUid) => candidateUids.add(memberUid));
    Object.keys(myInbox || {}).forEach((inboxUid) => candidateUids.add(inboxUid));
    mutualUids.forEach((memberUid) => candidateUids.add(memberUid));

    if (searchQuery.length >= 2) {
      directoryData = await getSearchDirectorySnapshot();
      if (renderVersion !== contactsRenderVersion || !isContactsPanelOpen()) return;
      searchContactDirectory(directoryData, searchQuery).forEach((candidateUid) => searchCandidateUids.add(candidateUid));
    }

    const orderedCandidates = new Set([
      ...urgentCandidateUids,
      ...searchCandidateUids,
      ...candidateUids,
    ]);
    const limitedCandidates = new Set([...orderedCandidates].slice(0, searchQuery ? 80 : 90));
    const presenceCandidates = [...limitedCandidates].filter((candidateUid, index) => {
      const friendStatus = myFriends?.[candidateUid];
      return friendStatus === 'accepted'
        || friendStatus === 'pending_received'
        || myInbox?.[candidateUid]?.read === false
        || Boolean(currentRoomMembers?.[candidateUid])
        || (Boolean(searchQuery) && index < 20);
    }).slice(0, 50);
    if (renderVersion !== contactsRenderVersion || !isContactsPanelOpen()) return;
    syncPresenceSubscriptions(uid, new Set(presenceCandidates));
    const allUsers = await loadContactUsers(limitedCandidates, directoryData || {}, uid);
    if (renderVersion !== contactsRenderVersion || !isContactsPanelOpen()) return;
    const incomingRequests = [];
    const pendingRequests = [];
    const unreadPm = [];
    const online = [];
    const offline = [];
    const roomPeople = [];
    const searchResults = [];
    const suggestions = [];

    Object.entries(allUsers)
      .sort(([, a], [, b]) => (a.displayName || '').localeCompare(b.displayName || ''))
      .forEach(([contactUid, user]) => {
        const status = myFriends?.[contactUid];
        const displayName = user.displayName || 'Unknown';
        const nameLower = displayName.toLowerCase();
        const shortIdLower = (user.shortId || '').toLowerCase();
        const contact = toContact(contactUid, user, status, contactsPresenceData || {}, myInbox?.[contactUid]);

        if (searchQuery) {
          if (nameLower.includes(searchQuery) || shortIdLower.includes(searchQuery)) {
            searchResults.push(withDiscoverySource(contact, 'search'));
          }
        } else if (contact.unread) {
          unreadPm.push(withDiscoverySource(contact, 'message'));
        } else if (status === 'pending_received') {
          incomingRequests.push(withDiscoverySource(contact, 'request'));
        } else if (status === 'pending_sent') {
          pendingRequests.push(withDiscoverySource(contact, 'pending'));
        } else if (status === 'accepted') {
          if (contact.isOnline) online.push(withDiscoverySource(contact, 'contact'));
          else offline.push(withDiscoverySource(contact, 'contact'));
        } else if (currentRoomMembers?.[contactUid]) {
          roomPeople.push(withDiscoverySource(contact, 'room'));
        } else if (mutualUids.has(contactUid)) {
          suggestions.push(withDiscoverySource(contact, 'suggested'));
        }
      });

    const sections = [];
    if (searchQuery) {
      pushSection(sections, 'search', 'Search Results', searchResults, { empty: 'No users found.' });
    } else {
      pushSection(sections, 'unread-pm', 'New Private Messages', unreadPm);
      pushSection(sections, 'requests', 'Requests for you', incomingRequests);
      pushSection(sections, 'online', 'Online Friends', online);
      pushSection(sections, 'offline', 'Offline Friends', offline, { subdued: true });
      pushSection(sections, 'room', 'In this room', roomPeople);
      pushSection(sections, 'suggested', 'People you may know', suggestions);
      pushSection(sections, 'pending-requests', 'Pending requests', pendingRequests, { subdued: true });
    }

    const visibleContacts = searchQuery
      ? searchResults
      : [
        ...unreadPm,
        ...incomingRequests,
        ...online,
        ...offline,
        ...roomPeople,
        ...suggestions,
        ...pendingRequests,
      ];
    const options = {
      searchQuery: searchValue,
      summary: summarizeContacts(visibleContacts),
    };

    if (renderVersion !== contactsRenderVersion
        || !isContactsPanelOpen()
        || !list.isConnected
        || document.getElementById('contacts-list') !== list) return;
    contactsLastSections = { uid, sections, options };
    mountContactsList(list, sections, options);
    syncContactSearchChrome(searchValue, {
      resultCount: searchQuery ? searchResults.length : options.summary.all,
    });
  } catch (error) {
    if (renderVersion !== contactsRenderVersion || !isContactsPanelOpen()) return;
    console.error('Contacts render failed', error);
    renderContactsStatus(`Could not load contacts: ${error.message}`, {
      id: 'error',
      mode: 'error',
      title: 'Contacts unavailable',
    });
  }
}

window.renderContactsUI = function renderContactsUI() {
  if (!isContactsPanelOpen()) return Promise.resolve();
  if (contactsRenderPromise) {
    contactsRenderQueued = true;
    return contactsRenderPromise;
  }

  contactsRenderQueued = false;
  contactsRenderPromise = performContactsRender().finally(() => {
    contactsRenderPromise = null;
    if (contactsRenderQueued && isContactsPanelOpen()) {
      contactsRenderQueued = false;
      scheduleContactsRender({ debounceMs: 0 });
    }
  });
  return contactsRenderPromise;
};
