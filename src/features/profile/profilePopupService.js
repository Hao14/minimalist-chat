import { get, ref, remove } from 'firebase/database';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';
import { ProfileCardPreview } from '../settings/SettingsWidgets.jsx';
import {
  ActivityFeed,
  ActivityHeatmap,
  EarnedBadges,
  MutualRooms,
  ProfileLinks,
  ProfileNameLine,
  ProfileSpotlight,
  ProfileSkills,
  ProfileSkillTree,
  Reputation,
} from './ProfilePopupSections.jsx';

const contextMenu = document.getElementById('custom-context-menu');
let settingsCardPreviewRoot = null;
const profileSectionRoots = new Map();

function renderProfileSection(id, element) {
  const target = document.getElementById(id);
  if (!target) return;
  let root = profileSectionRoots.get(id);
  if (!root) {
    root = createRoot(target);
    profileSectionRoots.set(id, root);
  }
  root.render(element);
}

window.renderProfileSpotlight = function renderProfileSpotlight(payload = {}) {
  renderProfileSection('up-spotlight', createElement(ProfileSpotlight, payload));
};

window.renderSettingsCardPreview = async function renderSettingsCardPreview() {
  const el = document.getElementById('settings-card-inline-preview');
  if (!el || !window.currentUser?.uid) return;

  const uid = window.currentUser.uid;
  let user = {};
  try {
    user = (await get(ref(db, `users/${uid}`))).val() || {};
  } catch {
    // Keep the settings panel usable if the preview fetch fails.
  }

  const avatar = user.photoUrl || window.getAvatarUrl(user.displayName, '');
  const bannerStyle = user.bannerUrl
    ? { backgroundImage: `url("${encodeURI(user.bannerUrl)}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: user.themeColor || 'var(--accent-color)' };

  if (!settingsCardPreviewRoot) settingsCardPreviewRoot = createRoot(el);
  settingsCardPreviewRoot.render(createElement(ProfileCardPreview, {
    user,
    avatar,
    bannerStyle,
    reputation: window.computeRep ? window.computeRep(user) : 0,
  }));
};

window.viewUserProfile = async function viewUserProfile(targetUid) {
  try {
    const snapshot = await get(ref(db, `users/${targetUid}`));
    if (!snapshot.exists()) return;

    const user = snapshot.val();
    const avatar = user.photoUrl || window.getAvatarUrl(user.displayName, '');
    const tier = (user.tier || '').toLowerCase();

    document.getElementById('up-avatar').src = avatar;
    renderProfileSection('up-name', createElement(ProfileNameLine, { name: user.displayName, tier }));

    const displayId = user.shortId || window.generateShortId();
    document.getElementById('up-pronouns').textContent = user.pronouns || '';
    document.getElementById('up-shortid').textContent = `#${displayId}`;
    const upStatus = document.getElementById('up-status');
    if (upStatus) {
      upStatus.textContent = user.status || '';
      upStatus.style.display = user.status ? '' : 'none';
    }
    document.getElementById('up-bio').textContent = user.bio || 'No bio yet.';
    renderProfileSection('up-links', createElement(ProfileLinks, { links: user.links }));
    const upFlair = document.getElementById('up-flair');
    if (upFlair) {
      upFlair.textContent = user.flair || '';
      upFlair.style.display = user.flair ? '' : 'none';
    }

    const isMe = targetUid === window.currentUser.uid;
    renderProfileSection('up-skills', createElement(ProfileSkills, {
      skills: user.skills,
      targetUid,
      isSelf: isMe,
      onEndorse: async (uid, skillKey) => {
        const result = await window.endorseSkill?.(uid, skillKey);
        if (result?.reason === 'already') window.showToast('Already endorsed.');
        return result;
      },
    }));
    renderProfileSection('up-skilltree', createElement(ProfileSkillTree, { user }));
    renderProfileSection('up-badges', createElement(EarnedBadges, { badges: user.badges }));
    const upJoined = document.getElementById('up-joined');
    if (upJoined) {
      upJoined.textContent = `Joined: ${
        user.createdAt
          ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : 'Unknown'
      }`;
    }
    renderProfileSection('up-rep', createElement(Reputation, { value: window.computeRep ? window.computeRep(user) : 0 }));
    renderProfileSection('up-heatmap', createElement(ActivityHeatmap, { activityByDay: user.activityByDay }));
    renderProfileSection('up-activity', createElement(ActivityFeed, { user }));

    const followBtn = document.getElementById('up-follow-btn');
    if (followBtn) {
      followBtn.style.display = isMe ? 'none' : '';
      if (!isMe && window.isFollowing) {
        const following = await window.isFollowing(targetUid);
        followBtn.textContent = following ? 'Following' : 'Follow';
        followBtn.classList.toggle('is-following', following);
        followBtn.onclick = async () => {
          followBtn.disabled = true;
          const now = await window.toggleFollow(targetUid);
          followBtn.textContent = now ? 'Following' : 'Follow';
          followBtn.classList.toggle('is-following', !!now);
          followBtn.disabled = false;
          if (window.getFollowCounts) {
            const c = await window.getFollowCounts(targetUid);
            document.getElementById('up-follow-stats').textContent = `${c.followers} followers · ${c.following} following`;
          }
        };
      }
    }

    if (window.getFollowCounts) {
      const c = await window.getFollowCounts(targetUid);
      document.getElementById('up-follow-stats').textContent = `${c.followers} followers · ${c.following} following`;
    }

    const upMutual = document.getElementById('up-mutual');
    if (upMutual) {
      if (isMe) {
        upMutual.style.display = 'none';
      } else if (window.getMutualRooms) {
        const rooms = await window.getMutualRooms(targetUid);
        upMutual.style.display = rooms.length ? '' : 'none';
        renderProfileSection('up-mutual', createElement(MutualRooms, { rooms }));
      }
    }

    window.renderProfileSpotlight({
      status: 'idle',
      onRetry: () => window.generateSpotlight(targetUid, user),
    });

    const shareBtn = document.getElementById('up-share-btn');
    if (shareBtn) {
      shareBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(window.profileShareLink(targetUid));
          window.showToast('Profile link copied!', false);
        } catch {
          window.showToast(`Link: ${window.profileShareLink(targetUid)}`);
        }
      };
    }

    const upBanner = document.getElementById('up-banner');
    upBanner.style.backgroundColor = user.themeColor || 'var(--accent-color)';
    if (user.bannerUrl) {
      upBanner.style.backgroundImage = `url("${encodeURI(user.bannerUrl)}")`;
      upBanner.style.backgroundSize = 'cover';
      upBanner.style.backgroundPosition = 'center';
    } else {
      upBanner.style.backgroundImage = 'none';
    }

    document.getElementById('up-kudos-count').textContent = user.kudos || 0;
    const kudosBtn = document.getElementById('up-kudos-btn');
    if (kudosBtn) {
      kudosBtn.style.display = isMe ? 'none' : '';
      const alreadyGave = !isMe && user.kudosFrom && user.kudosFrom[window.currentUser.uid];
      kudosBtn.disabled = !!alreadyGave;
      kudosBtn.onclick = async () => {
        kudosBtn.disabled = true;
        const res = await window.giveKudos(targetUid);
        if (res.ok) {
          document.getElementById('up-kudos-count').textContent = res.count;
          window.showToast('Kudos sent! 👏', false);
        } else {
          kudosBtn.disabled = res.reason === 'already';
          if (res.reason === 'already') window.showToast('You already gave kudos.');
        }
      };
    }

    try {
      const pSnap = await get(ref(db, `presence/${targetUid}`));
      const online = pSnap.exists() && pSnap.val().state === 'online';
      const dot = document.getElementById('up-presence');
      if (dot) {
        dot.className = `up-presence status-dot ${online ? 'online' : 'offline'}`;
        dot.title = online ? 'Online' : 'Offline';
      }
    } catch {
      // Presence is optional.
    }

    const msgBtn = document.getElementById('up-message-btn');
    if (msgBtn) {
      msgBtn.onclick = () => {
        document.getElementById('user-profile-popup').classList.add('hidden');
        document.getElementById('modal-overlay').classList.add('hidden');
        document.getElementById('contacts-panel').classList.remove('open');
        window.openPrivateChat(targetUid, user.displayName);
      };
    }

    document.getElementById('user-profile-popup').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('profile-more-dropdown')?.classList.add('hidden');
  } catch (error) {
    window.showToast(`Failed to load user profile: ${error.message}`);
  }
};

window.showContextMenu = async function showContextMenu(x, y, uid, name) {
  if (uid === window.currentUser.uid) return;

  window.contextTargetUid = uid;
  window.contextTargetName = name;

  const friendSnap = await get(ref(db, `friends/${window.currentUser.uid}/${uid}`));
  const ctxFriendBtn = document.getElementById('ctx-friend-btn');
  if (ctxFriendBtn) {
    if (friendSnap.exists() && friendSnap.val() === 'accepted') {
      ctxFriendBtn.textContent = 'Remove Friend';
      ctxFriendBtn.style.color = 'red';
    } else {
      ctxFriendBtn.textContent = 'Add Friend';
      ctxFriendBtn.style.color = 'inherit';
    }
  }

  const ctxMuteBtn = document.getElementById('ctx-mute-btn');
  if (ctxMuteBtn) {
    let isCreator = false;
    if (window.activeRoomId !== 'global') {
      const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}/creatorId`));
      if (roomSnap.exists() && roomSnap.val() === window.currentUser.uid) isCreator = true;
    }

    if (isCreator || (window.currentUser.uid === window.MY_ADMIN_UID && window.activeRoomId === 'global')) {
      ctxMuteBtn.style.display = 'block';
      const muteSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}/muted/${uid}`));
      const isMuted = muteSnap.exists() && muteSnap.val() > Date.now();
      ctxMuteBtn.textContent = isMuted ? 'Unmute User' : 'Mute User';
      ctxMuteBtn.style.color = isMuted ? 'red' : 'inherit';
    } else {
      ctxMuteBtn.style.display = 'none';
    }
  }

  if (contextMenu) {
    let posX = x;
    let posY = y;
    if (posX + 160 > window.innerWidth) posX -= 160;
    if (posY + 160 > window.innerHeight) posY -= 160;
    contextMenu.style.left = `${posX}px`;
    contextMenu.style.top = `${posY}px`;
    contextMenu.classList.remove('hidden');
  }
};

document.addEventListener('click', () => contextMenu?.classList.add('hidden'));

document.getElementById('ctx-copy-btn')?.addEventListener('click', () => {
  if (!window.contextTargetUid) return;
  navigator.clipboard.writeText(window.contextTargetUid);
  window.showToast('User ID copied!', false);
});

document.getElementById('ctx-friend-btn')?.addEventListener('click', async () => {
  if (!window.contextTargetUid) return;

  if (document.getElementById('ctx-friend-btn').textContent === 'Remove Friend') {
    await window.removeFriend(window.contextTargetUid);
    window.showToast(`${window.contextTargetName} removed from friends.`, false);
  } else {
    await window.sendRequest(window.contextTargetUid);
    window.showToast(`Friend request sent to ${window.contextTargetName}!`, false);
  }
});

document.getElementById('ctx-mute-btn')?.addEventListener('click', async () => {
  if (!window.contextTargetUid) return;

  const muteRef = ref(db, `rooms_meta/${window.activeRoomId}/muted/${window.contextTargetUid}`);
  const muteSnap = await get(muteRef);

  if (muteSnap.exists() && muteSnap.val() > Date.now()) {
    await remove(muteRef);
    window.showToast(`Unmuted ${window.contextTargetName} in this room.`, false);
  } else {
    window.muteTargetUid = window.contextTargetUid;
    window.muteTargetName = window.contextTargetName;
    const modalTargetName = document.getElementById('mute-target-name');
    if (modalTargetName) modalTargetName.textContent = window.contextTargetName;
    document.getElementById('mute-user-modal')?.classList.remove('hidden');
  }

  contextMenu?.classList.add('hidden');
});
