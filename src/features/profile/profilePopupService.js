import { get, ref, remove } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { escapeHtml } from '../../lib/text.js';

const contextMenu = document.getElementById('custom-context-menu');

window.renderSettingsCardPreview = async function renderSettingsCardPreview() {
  const el = document.getElementById('settings-card-inline-preview');
  if (!el) return;

  const uid = window.currentUser.uid;
  let user = {};
  try {
    user = (await get(ref(db, `users/${uid}`))).val() || {};
  } catch {
    // Keep the settings panel usable if the preview fetch fails.
  }

  const avatar = user.photoUrl || window.getAvatarUrl(user.displayName, '');
  const bannerStyle = user.bannerUrl
    ? `background-image:url("${encodeURI(user.bannerUrl)}");background-size:cover;background-position:center;`
    : `background:${user.themeColor || 'var(--accent-color)'};`;

  el.innerHTML = `
    <div class="scp-card">
      <div class="scp-banner" style="${bannerStyle}"><img class="scp-avatar" src="${escapeHtml(avatar)}" alt=""></div>
      <div class="scp-body">
        <div class="scp-name-row">
          <span class="profile-display-name">${escapeHtml(user.displayName || 'You')}</span>
          ${user.pronouns ? `<span class="profile-pronouns">${escapeHtml(user.pronouns)}</span>` : ''}
          ${user.flair ? `<span class="profile-flair">${escapeHtml(user.flair)}</span>` : ''}
        </div>
        <div><span class="profile-short-id">#${escapeHtml(user.shortId || '')}</span></div>
        ${user.status ? `<div class="profile-status">${escapeHtml(user.status)}</div>` : ''}
        <div class="profile-bio">${escapeHtml(user.bio || 'No bio yet.')}</div>
        <div class="profile-links">${window.renderProfileLinks ? window.renderProfileLinks(user.links) : ''}</div>
        <div class="profile-section-label">Skill Trees</div>
        ${window.renderSkillTree ? window.renderSkillTree(user) : ''}
        <div class="profile-badges">${window.renderBadges ? window.renderBadges(user.badges) : ''}</div>
        <div class="profile-rep"><i class="ph-bold ph-trophy"></i> ${window.computeRep ? window.computeRep(user) : 0} reputation</div>
      </div>
    </div>`;
};

window.viewUserProfile = async function viewUserProfile(targetUid) {
  try {
    const snapshot = await get(ref(db, `users/${targetUid}`));
    if (!snapshot.exists()) return;

    const user = snapshot.val();
    const avatar = user.photoUrl || window.getAvatarUrl(user.displayName, '');
    const tier = (user.tier || '').toLowerCase();
    let badgeHtml = '';

    if (tier.includes('pro')) badgeHtml = '<span class="tier-badge pro">PRO</span>';
    else if (tier.includes('advanced')) badgeHtml = '<span class="tier-badge advanced">ADVANCED</span>';

    document.getElementById('up-avatar').src = avatar;
    document.getElementById('up-name').innerHTML = `${escapeHtml(user.displayName)} ${badgeHtml}`;

    const displayId = user.shortId || window.generateShortId();
    document.getElementById('up-pronouns').textContent = user.pronouns || '';
    document.getElementById('up-shortid').textContent = `#${displayId}`;
    const upStatus = document.getElementById('up-status');
    if (upStatus) {
      upStatus.textContent = user.status || '';
      upStatus.style.display = user.status ? '' : 'none';
    }
    document.getElementById('up-bio').textContent = user.bio || 'No bio yet.';
    const upLinks = document.getElementById('up-links');
    if (upLinks) upLinks.innerHTML = window.renderProfileLinks ? window.renderProfileLinks(user.links) : '';
    const upFlair = document.getElementById('up-flair');
    if (upFlair) {
      upFlair.textContent = user.flair || '';
      upFlair.style.display = user.flair ? '' : 'none';
    }

    const upSkills = document.getElementById('up-skills');
    if (upSkills && window.renderSkills) {
      upSkills.innerHTML = window.renderSkills(user.skills);
      const selfSkills = targetUid === window.currentUser.uid;
      upSkills.querySelectorAll('.skill-endorse').forEach((button) => {
        button.disabled = selfSkills;
        if (!selfSkills) {
          button.onclick = async () => {
            button.disabled = true;
            const res = await window.endorseSkill(targetUid, button.dataset.skill);
            if (res.ok) button.textContent = `+${res.count}`;
            else {
              button.disabled = res.reason === 'already';
              if (res.reason === 'already') window.showToast('Already endorsed.');
            }
          };
        }
      });
    }

    const upTree = document.getElementById('up-skilltree');
    if (upTree && window.renderSkillTree) upTree.innerHTML = window.renderSkillTree(user);
    const upBadges = document.getElementById('up-badges');
    if (upBadges) upBadges.innerHTML = window.renderBadges ? window.renderBadges(user.badges) : '';
    const upJoined = document.getElementById('up-joined');
    if (upJoined) {
      upJoined.textContent = `Joined: ${
        user.createdAt
          ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : 'Unknown'
      }`;
    }
    const upRep = document.getElementById('up-rep');
    if (upRep && window.computeRep) upRep.innerHTML = `<i class="ph-bold ph-trophy"></i> ${window.computeRep(user)} reputation`;
    const upHeat = document.getElementById('up-heatmap');
    if (upHeat && window.renderHeatmap) upHeat.innerHTML = window.renderHeatmap(user.activityByDay);
    const upAct = document.getElementById('up-activity');
    if (upAct && window.buildActivityFeed) {
      const feed = window.buildActivityFeed(user);
      upAct.innerHTML = feed || '<li class="act-empty">No activity yet.</li>';
    }

    const isMe = targetUid === window.currentUser.uid;
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
        if (rooms.length) {
          upMutual.innerHTML = `<i class="ph-bold ph-door-open"></i> ${rooms.length} mutual room${rooms.length > 1 ? 's' : ''}: ${escapeHtml(rooms.slice(0, 3).join(', '))}${rooms.length > 3 ? '…' : ''}`;
        }
      }
    }

    const spot = document.getElementById('up-spotlight');
    if (spot) {
      spot.innerHTML = '<button id="up-spotlight-btn" class="ai-btn ai-btn-ghost"><i class="ph-bold ph-sparkle"></i> AI Spotlight</button>';
    }
    document.getElementById('up-spotlight-btn')?.addEventListener('click', () => window.generateSpotlight(targetUid, user));

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
