import {
  get,
  limitToLast,
  off,
  onChildAdded,
  onValue,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
} from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { escapeHtml, renderMessageText } from '../../lib/text.js';

const pmE2eKeys = new Map();

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derivePmKey(roomId, passphrase) {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`minimalist-pm:${roomId}`),
      iterations: 120000,
      hash: 'SHA-256',
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptPmText(roomId, text) {
  const key = pmE2eKeys.get(roomId);
  if (!key) return { text };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return {
    encrypted: true,
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

async function decryptPmText(roomId, msg) {
  if (!msg.encrypted) return msg.text || '';
  const key = pmE2eKeys.get(roomId);
  if (!key) return '🔒 Encrypted message — tap the lock and enter the shared passphrase.';
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(msg.iv) },
      key,
      base64ToBytes(msg.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return '🔒 Could not decrypt — wrong passphrase for this chat.';
  }
}

function updatePmE2eStatus() {
  const status = document.getElementById('pm-e2e-status');
  const button = document.getElementById('pm-e2e-btn');
  const enabled = window.currentPmRoomId && pmE2eKeys.has(window.currentPmRoomId);
  if (status) status.textContent = enabled ? 'Encrypted on · messages are protected before upload' : 'Standard PM · tap 🔒 to enable encrypted messages';
  button?.classList.toggle('active', !!enabled);
}

window.toggleContacts = function toggleContacts() {
  const panel = document.getElementById('contacts-panel');
  if (!panel) return;

  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    onValue(ref(db, `friends/${window.currentUser.uid}`), window.renderContactsUI);
    onValue(ref(db, 'presence'), window.renderContactsUI);
  }
};

document.getElementById('close-contacts-btn')?.addEventListener('click', () => {
  document.getElementById('contacts-panel')?.classList.remove('open');
  off(ref(db, `friends/${window.currentUser.uid}`));
  off(ref(db, 'presence'));
});

window.sendRequest = async (targetUid) => {
  await set(ref(db, `friends/${window.currentUser.uid}/${targetUid}`), 'pending_sent');
  await set(ref(db, `friends/${targetUid}/${window.currentUser.uid}`), 'pending_received');

  if (window.createNotification) {
    window.createNotification(
      targetUid,
      'friend',
      `${window.userProfileName || 'Someone'} sent you a friend request!`,
      { groupId: window.currentUser.uid, from: window.userProfileName || 'Someone' },
    );
  }
};

window.acceptRequest = async (targetUid) => {
  await set(ref(db, `friends/${window.currentUser.uid}/${targetUid}`), 'accepted');
  await set(ref(db, `friends/${targetUid}/${window.currentUser.uid}`), 'accepted');

  if (window.awardBadge) {
    window.awardBadge(window.currentUser.uid, 'first_friend');
    window.awardBadge(targetUid, 'first_friend');
    window.awardXP?.(window.currentUser.uid, 'support', 5);
    window.awardXP?.(targetUid, 'support', 5);
    window.trackQuest?.('friend');

    try {
      const mine = Object.values((await get(ref(db, `friends/${window.currentUser.uid}`))).val() || {})
        .filter((status) => status === 'accepted').length;
      if (mine >= 10) window.awardBadge(window.currentUser.uid, 'social');
    } catch {
      // Badge progress is best effort.
    }
  }
};

window.removeFriend = async (targetUid) => {
  await remove(ref(db, `friends/${window.currentUser.uid}/${targetUid}`));
  await remove(ref(db, `friends/${targetUid}/${window.currentUser.uid}`));
};

window.renderContactsUI = async function renderContactsUI() {
  try {
    const list = document.getElementById('contacts-list');
    if (!list) return;

    const searchInput = document.getElementById('contact-search-input');
    const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const usersSnap = await get(ref(db, 'users'));
    const friendsSnap = await get(ref(db, `friends/${window.currentUser.uid}`));
    const presenceSnap = await get(ref(db, 'presence'));

    let currentRoomMembers = {};
    if (window.activeRoomId !== 'global') {
      const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}/members`));
      if (roomSnap.exists()) currentRoomMembers = roomSnap.val();
    }

    const allUsers = usersSnap.val() || {};
    const myFriends = friendsSnap.val() || {};
    const presenceData = presenceSnap.val() || {};
    const mutualUids = new Set();

    try {
      const meta = (await get(ref(db, 'rooms_meta'))).val() || {};
      Object.values(meta).forEach((room) => {
        const members = room.members || {};
        if (members[window.currentUser.uid]) {
          Object.keys(members).forEach((uid) => {
            if (uid !== window.currentUser.uid) mutualUids.add(uid);
          });
        }
      });
    } catch {
      // Suggestions are optional; the core contacts list still renders.
    }

    let htmlRequests = '';
    let htmlOnline = '';
    let htmlOffline = '';
    let htmlRoom = '';
    let htmlSearch = '';
    let htmlSuggest = '';

    Object.entries(allUsers).forEach(([uid, user]) => {
      if (uid === window.currentUser.uid) return;

      const status = myFriends[uid];
      const isOnline = presenceData[uid]?.state === 'online';
      const statusClass = isOnline ? 'online' : 'offline';
      const displayName = user.displayName || 'Unknown';
      const avatar = user.photoUrl || window.getAvatarUrl(displayName, '');
      const nameLower = displayName.toLowerCase();
      const shortIdLower = (user.shortId || '').toLowerCase();

      const baseItem = `<li class="contact-item"><div class="contact-info"><div class="avatar-wrapper" onclick="viewUserProfile('${uid}')" style="cursor: pointer;" title="View Profile"><img src="${escapeHtml(avatar)}" class="contact-avatar"><div class="status-dot ${statusClass}"></div></div><span style="font-weight:600;">${escapeHtml(displayName)}</span><span class="unread-indicator" id="dot-${uid}"></span></div><div class="contact-actions">`;
      let actionHtml = '';

      if (status === 'accepted') {
        actionHtml = `<button class="contact-icon-btn pm-open-btn" data-uid="${uid}" data-name="${escapeHtml(displayName)}" title="Message"><i class="ph-bold ph-chat-circle-text"></i></button><button class="contact-icon-btn" onclick="viewUserProfile('${uid}')" title="More Options"><i class="ph-bold ph-dots-three-vertical"></i></button></div></li>`;
      } else if (status === 'pending_received') {
        actionHtml = `<button class="mini-btn" onclick="acceptRequest('${uid}')">Accept</button><button class="mini-btn danger" onclick="removeFriend('${uid}')">Decline</button></div></li>`;
      } else if (status === 'pending_sent') {
        actionHtml = '<span style="font-size:0.8rem; color:#888; font-weight: bold; margin-top: 5px;">Requested</span></div></li>';
      } else {
        actionHtml = `<button class="mini-btn outline" onclick="sendRequest('${uid}')">ADD</button></div></li>`;
      }

      const fullItem = baseItem + actionHtml;

      if (searchQuery) {
        if (nameLower.includes(searchQuery) || shortIdLower.includes(searchQuery)) htmlSearch += fullItem;
      } else if (status === 'accepted') {
        if (isOnline) htmlOnline += fullItem;
        else htmlOffline += fullItem;
      } else if (status === 'pending_received' || status === 'pending_sent') {
        htmlRequests += fullItem;
      } else if (currentRoomMembers[uid]) {
        htmlRoom += fullItem;
      } else if (mutualUids.has(uid)) {
        htmlSuggest += fullItem;
      }
    });

    list.innerHTML = '';

    if (searchQuery) {
      list.innerHTML += `<li class="section-title">Search Results</li>${
        htmlSearch || '<li style="padding: 1rem 1.5rem; color: #888; font-size: 0.85rem; font-weight: bold;">No users found.</li>'
      }`;
    } else {
      if (htmlOnline) list.innerHTML += `<li class="section-title">Online Friends</li>${htmlOnline}`;
      if (htmlOffline) list.innerHTML += `<li class="section-title" style="opacity: 0.6;">Offline Friends</li>${htmlOffline}`;
      if (htmlRoom) list.innerHTML += `<li class="section-title">People in Room</li>${htmlRoom}`;
      if (htmlSuggest) list.innerHTML += `<li class="section-title">People you may know</li>${htmlSuggest}`;
      if (htmlRequests) list.innerHTML += `<li class="section-title">Requests</li>${htmlRequests}`;
    }

    list.querySelectorAll('.pm-open-btn').forEach((button) => {
      button.addEventListener('click', () => window.openPrivateChat(button.dataset.uid, button.dataset.name));
    });
  } catch (error) {
    console.error('Contacts render failed', error);
  }
};

window.openPrivateChat = function openPrivateChat(targetUid, targetName) {
  window.currentPmTargetUid = targetUid;
  document.getElementById('pm-target-name').textContent = targetName;
  document.getElementById('pm-messages').innerHTML = '';
  window.currentPmRoomId = window.currentUser.uid < targetUid
    ? `${window.currentUser.uid}_${targetUid}`
    : `${targetUid}_${window.currentUser.uid}`;

  if (window.pmQueryRef) off(window.pmQueryRef);
  set(ref(db, `inbox/${window.currentUser.uid}/${targetUid}/read`), true);
  remove(ref(db, `notifications/${window.currentUser.uid}/message_${targetUid}`));

  window.pmQueryRef = query(ref(db, `private_messages/${window.currentPmRoomId}`), limitToLast(30));
  updatePmE2eStatus();
  onChildAdded(window.pmQueryRef, async (snapshot) => {
    const msg = snapshot.val();
    const pmList = document.getElementById('pm-messages');
    const item = document.createElement('li');
    item.classList.add(msg.uid === window.currentUser.uid ? 'my-pm' : 'their-pm');
    if (msg.encrypted) item.classList.add('encrypted-pm');
    item.innerHTML = renderMessageText(await decryptPmText(window.currentPmRoomId, msg));
    pmList.appendChild(item);
    pmList.scrollTo(0, pmList.scrollHeight);
  });

  document.getElementById('pm-popup')?.classList.remove('hidden');
};

document.getElementById('pm-close-btn')?.addEventListener('click', () => {
  document.getElementById('pm-popup')?.classList.add('hidden');
  if (window.pmQueryRef) off(window.pmQueryRef);
  window.currentPmRoomId = null;
  window.currentPmTargetUid = null;
  updatePmE2eStatus();
});

document.getElementById('pm-e2e-btn')?.addEventListener('click', async () => {
  if (!window.currentPmRoomId) return;
  if (pmE2eKeys.has(window.currentPmRoomId)) {
    const targetUid = window.currentPmTargetUid;
    const targetName = document.getElementById('pm-target-name')?.textContent || 'User';
    pmE2eKeys.delete(window.currentPmRoomId);
    updatePmE2eStatus();
    window.showToast?.('Encrypted messages disabled for this PM window.', false);
    if (targetUid) window.openPrivateChat(targetUid, targetName);
    return;
  }

  const passphrase = window.prompt('Enter the shared encryption passphrase for this PM. The other person must enter the same passphrase.');
  if (!passphrase) return;
  try {
    pmE2eKeys.set(window.currentPmRoomId, await derivePmKey(window.currentPmRoomId, passphrase));
    updatePmE2eStatus();
    window.showToast?.('Encrypted messages enabled for this PM window.', false);
    if (window.currentPmTargetUid) window.openPrivateChat(window.currentPmTargetUid, document.getElementById('pm-target-name')?.textContent || 'User');
  } catch (error) {
    window.showToast?.(`Could not enable encrypted messages: ${error.message}`);
  }
});

document.getElementById('pm-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const pmInput = document.getElementById('pm-input');
  const text = pmInput.value.trim();
  if (!text || !window.currentPmRoomId) return;

  const messagePayload = await encryptPmText(window.currentPmRoomId, text);
  await push(ref(db, `private_messages/${window.currentPmRoomId}`), {
    uid: window.currentUser.uid,
    ...messagePayload,
    timestamp: serverTimestamp(),
  });
  await set(ref(db, `inbox/${window.currentPmTargetUid}/${window.currentUser.uid}`), {
    fromName: window.userProfileName,
    timestamp: Date.now(),
    read: false,
  });

  if (window.createNotification) {
    window.createNotification(
      window.currentPmTargetUid,
      'message',
      `New message from ${window.userProfileName || 'Someone'}.`,
      { groupId: window.currentUser.uid, from: window.userProfileName || 'Someone' },
    );
  }

  pmInput.value = '';
});
