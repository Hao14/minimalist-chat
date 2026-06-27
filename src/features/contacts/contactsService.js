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
let contactsUnsubscribers = [];

function getCurrentUid() {
  return window.currentUser?.uid || null;
}

function ensureContactsRoot(list) {
  if (!contactsRoot) contactsRoot = createRoot(list);
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

function mountContactsList(list, sections) {
  ensureContactsRoot(list).render(createElement(ContactsList, {
    sections,
    onAcceptRequest: (uid) => runContactAction(() => window.acceptRequest(uid)),
    onOpenPrivateChat: (uid, name) => window.openPrivateChat(uid, name),
    onOpenProfile: (uid) => window.viewUserProfile(uid),
    onRemoveFriend: (uid) => runContactAction(() => window.removeFriend(uid)),
    onSendRequest: (uid) => runContactAction(() => window.sendRequest(uid)),
  }));
  requestAnimationFrame(() => window.refreshContactUnreadDots?.());
}

function renderContactsStatus(message, options = {}) {
  const list = document.getElementById('contacts-list');
  if (!list) return;

  mountContactsList(list, [{
    id: options.id || 'status',
    title: options.title || 'Contacts',
    items: [],
    empty: message,
    subdued: options.subdued ?? true,
  }]);
}

async function runContactAction(action) {
  try {
    if (!getCurrentUid()) throw new Error('Please sign in first.');
    await action();
    window.renderContactsUI?.();
  } catch (error) {
    window.showToast?.(`Contact action failed: ${error.message}`);
  }
}

function normalizeUserRecord(user = {}) {
  const displayName = (user.displayName || user.name || user.username || 'Unknown').trim();
  return {
    displayName,
    shortId: user.shortId || '',
    photoUrl: user.photoUrl || user.photoURL || '',
    themeColor: user.themeColor || '',
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

function stopContactSubscriptions() {
  contactsUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
  contactsUnsubscribers = [];
}

function startContactSubscriptions(uid) {
  stopContactSubscriptions();
  contactsUnsubscribers = [
    onValue(ref(db, `friends/${uid}`), () => window.renderContactsUI?.()),
    onValue(ref(db, 'presence'), () => window.renderContactsUI?.()),
    onValue(ref(db, `inbox/${uid}`), () => window.renderContactsUI?.()),
  ];
}

function openContactsPanel() {
  const panel = document.getElementById('contacts-panel');
  if (!panel) return;

  panel.classList.add('open');
  renderContactsStatus('Loading contacts…');

  const uid = getCurrentUid();
  if (!uid) {
    stopContactSubscriptions();
    renderContactsStatus('Sign in to view contacts.');
    return;
  }

  startContactSubscriptions(uid);
  window.renderContactsUI?.();
}

function closeContactsPanel() {
  document.getElementById('contacts-panel')?.classList.remove('open');
  stopContactSubscriptions();
}

window.openContactsPanel = openContactsPanel;
window.closeContactsPanel = closeContactsPanel;

window.toggleContacts = function toggleContacts() {
  const panel = document.getElementById('contacts-panel');
  if (!panel) return;

  if (panel.classList.contains('open')) closeContactsPanel();
  else openContactsPanel();
};

document.addEventListener('click', (event) => {
  if (event.target.closest('#close-contacts-btn')) closeContactsPanel();
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
  if (!window.activeRoomId || window.activeRoomId === 'global') return {};
  return safeGetValue(`rooms_meta/${window.activeRoomId}/members`, {}, { quiet: true });
}

async function readMutualRoomUids(uid) {
  const mutualUids = new Set();
  const meta = await safeGetValue('rooms_meta', {}, { quiet: true });

  Object.values(meta || {}).forEach((room) => {
    const members = room?.members || {};
    if (members[uid]) {
      Object.keys(members).forEach((memberUid) => {
        if (memberUid !== uid) mutualUids.add(memberUid);
      });
    }
  });

  return mutualUids;
}

async function loadContactUsers(candidateUids, directoryData, currentUid) {
  const entries = await Promise.all([...candidateUids].map(async (uid) => {
    if (!uid || uid === currentUid) return null;

    const directoryRecord = directoryData?.[uid];
    if (directoryRecord) return [uid, normalizeUserRecord(directoryRecord)];

    const privateRecord = await safeGetValue(`users/${uid}`, null, { quiet: true });
    if (!privateRecord) return null;

    return [uid, normalizeUserRecord(privateRecord)];
  }));

  return Object.fromEntries(entries.filter(Boolean));
}

window.renderContactsUI = async function renderContactsUI() {
  const list = document.getElementById('contacts-list');
  if (!list) return;

  const uid = getCurrentUid();
  if (!uid) {
    renderContactsStatus('Sign in to view contacts.');
    return;
  }

  try {
    const searchInput = document.getElementById('contact-search-input');
    const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const [directoryData, myFriends, presenceData, currentRoomMembers, mutualUids, myInbox] = await Promise.all([
      safeGetValue('user_directory', {}, { quiet: true }),
      safeGetValue(`friends/${uid}`, {}, { quiet: true }),
      safeGetValue('presence', {}, { quiet: true }),
      readCurrentRoomMembers(),
      readMutualRoomUids(uid),
      safeGetValue(`inbox/${uid}`, {}, { quiet: true }),
    ]);

    const candidateUids = new Set(Object.keys(directoryData || {}));
    Object.keys(myFriends || {}).forEach((friendUid) => candidateUids.add(friendUid));
    Object.keys(currentRoomMembers || {}).forEach((memberUid) => candidateUids.add(memberUid));
    Object.keys(myInbox || {}).forEach((inboxUid) => candidateUids.add(inboxUid));
    mutualUids.forEach((memberUid) => candidateUids.add(memberUid));

    const allUsers = await loadContactUsers(candidateUids, directoryData || {}, uid);
    const requests = [];
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
        const contact = toContact(contactUid, user, status, presenceData || {}, myInbox?.[contactUid]);

        if (searchQuery) {
          if (nameLower.includes(searchQuery) || shortIdLower.includes(searchQuery)) searchResults.push(contact);
        } else if (contact.unread) {
          unreadPm.push(contact);
        } else if (status === 'accepted') {
          if (contact.isOnline) online.push(contact);
          else offline.push(contact);
        } else if (status === 'pending_received' || status === 'pending_sent') {
          requests.push(contact);
        } else if (currentRoomMembers?.[contactUid]) {
          roomPeople.push(contact);
        } else if (mutualUids.has(contactUid)) {
          suggestions.push(contact);
        }
      });

    const sections = [];
    if (searchQuery) {
      pushSection(sections, 'search', 'Search Results', searchResults, { empty: 'No users found.' });
    } else {
      pushSection(sections, 'unread-pm', 'New Private Messages', unreadPm);
      pushSection(sections, 'online', 'Online Friends', online);
      pushSection(sections, 'offline', 'Offline Friends', offline, { subdued: true });
      pushSection(sections, 'room', 'People in Room', roomPeople);
      pushSection(sections, 'suggested', 'People you may know', suggestions);
      pushSection(sections, 'requests', 'Requests', requests);
    }

    mountContactsList(list, sections);
  } catch (error) {
    console.error('Contacts render failed', error);
    renderContactsStatus(`Could not load contacts: ${error.message}`, { id: 'error', title: 'Contacts unavailable' });
  }
};
