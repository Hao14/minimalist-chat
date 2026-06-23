import {
  get,
  off,
  onValue,
  ref,
  remove,
  set,
} from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { escapeHtml } from '../../lib/text.js';

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
