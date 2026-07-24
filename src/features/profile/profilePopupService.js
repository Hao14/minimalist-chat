import { get, ref, remove } from 'firebase/database';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';
import { normalizeStoredAvatarUrl } from '../../lib/avatar.js';
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
const profileSectionRoots = new Map();
const publicProfileCache = new Map();
const publicProfileLoads = new Map();
const mutualRoomsCache = new Map();
const mutualRoomsLoads = new Map();
const PUBLIC_PROFILE_CACHE_TTL = 2 * 60 * 1000;
const MUTUAL_ROOMS_CACHE_TTL = 5 * 60 * 1000;
const MAX_PUBLIC_PROFILE_CACHE_ENTRIES = 48;
const MAX_MUTUAL_ROOMS_CACHE_ENTRIES = 64;
const MAX_PROFILE_LOADS_IN_FLIGHT = 24;
let profileRequestVersion = 0;
let profileLastFocus = null;

async function copyTextWithFallback(value) {
  const text = String(value || '');
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older WebViews and permission-restricted contexts can reject here.
    }
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.select();
  input.setSelectionRange(0, input.value.length);
  try {
    return document.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    input.remove();
  }
}

function pruneTimedCache(cache, ttl, now = Date.now()) {
  cache.forEach((entry, key) => {
    if (!entry || now - Number(entry.loadedAt || 0) >= ttl) cache.delete(key);
  });
}

function setBoundedTimedCache(cache, key, entry, ttl, maxEntries) {
  pruneTimedCache(cache, ttl, entry.loadedAt);
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function setBoundedInFlightLoad(cache, key, load) {
  cache.set(key, load);
  while (cache.size > MAX_PROFILE_LOADS_IN_FLIGHT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function formatFollowStats(counts = {}) {
  const followers = Number(counts.followers || 0);
  const following = Number(counts.following || 0);
  return `${followers} follower${followers === 1 ? '' : 's'} · ${following} following`;
}

function setFollowStats(counts) {
  const target = document.getElementById('up-follow-stats');
  if (target) target.textContent = counts ? formatFollowStats(counts) : '';
}

function renderProfileSection(id, element) {
  const target = document.getElementById(id);
  if (!target) return;
  let root = profileSectionRoots.get(id);
  if (!root) {
    target.replaceChildren();
    root = createRoot(target);
    profileSectionRoots.set(id, root);
  }
  root.render(element);
}

window.renderProfileSpotlight = function renderProfileSpotlight(payload = {}) {
  renderProfileSection('up-spotlight', createElement(ProfileSpotlight, payload));
};

function getFreshPublicProfile(targetUid) {
  pruneTimedCache(publicProfileCache, PUBLIC_PROFILE_CACHE_TTL);
  const entry = publicProfileCache.get(targetUid);
  if (!entry) return null;
  publicProfileCache.delete(targetUid);
  publicProfileCache.set(targetUid, entry);
  return entry.user;
}

function loadPublicProfile(targetUid) {
  const cached = getFreshPublicProfile(targetUid);
  if (cached) return Promise.resolve(cached);
  if (publicProfileLoads.has(targetUid)) return publicProfileLoads.get(targetUid);

  const load = get(ref(db, `user_directory/${targetUid}`))
    .then((snapshot) => {
      const user = snapshot.exists() ? snapshot.val() : null;
      if (user) {
        const loadedAt = Date.now();
        setBoundedTimedCache(
          publicProfileCache,
          targetUid,
          { user, loadedAt },
          PUBLIC_PROFILE_CACHE_TTL,
          MAX_PUBLIC_PROFILE_CACHE_ENTRIES,
        );
      }
      return user;
    })
    .catch(() => null)
    .finally(() => {
      if (publicProfileLoads.get(targetUid) === load) publicProfileLoads.delete(targetUid);
    });
  setBoundedInFlightLoad(publicProfileLoads, targetUid, load);
  return load;
}

function loadMutualRooms(targetUid, currentUid) {
  const key = `${currentUid || 'guest'}:${targetUid}`;
  pruneTimedCache(mutualRoomsCache, MUTUAL_ROOMS_CACHE_TTL);
  const cached = mutualRoomsCache.get(key);
  if (cached) {
    mutualRoomsCache.delete(key);
    mutualRoomsCache.set(key, cached);
    return Promise.resolve(cached.rooms);
  }
  if (mutualRoomsLoads.has(key)) return mutualRoomsLoads.get(key);

  const load = Promise.resolve(window.getMutualRooms?.(targetUid) || [])
    .then((rooms) => {
      const safeRooms = Array.isArray(rooms) ? rooms : [];
      const loadedAt = Date.now();
      setBoundedTimedCache(
        mutualRoomsCache,
        key,
        { rooms: safeRooms, loadedAt },
        MUTUAL_ROOMS_CACHE_TTL,
        MAX_MUTUAL_ROOMS_CACHE_ENTRIES,
      );
      return safeRooms;
    })
    .finally(() => {
      if (mutualRoomsLoads.get(key) === load) mutualRoomsLoads.delete(key);
    });
  setBoundedInFlightLoad(mutualRoomsLoads, key, load);
  return load;
}

function isCurrentProfileRequest(requestId, targetUid) {
  const popup = document.getElementById('user-profile-popup');
  return Boolean(
    popup
    && requestId === profileRequestVersion
    && popup.dataset.profileUid === targetUid
    && !popup.classList.contains('hidden')
  );
}

function setProfilePresence(presence) {
  const dot = document.getElementById('up-presence');
  if (!dot) return;
  const online = presence?.state === 'online';
  dot.className = `up-presence status-dot ${online ? 'online' : 'offline'}`;
  dot.title = online ? 'Online' : 'Offline';
}

function renderProfileBase(targetUid, user, { isMe = false, loading = false } = {}) {
  const safeUser = user || {};
  const displayName = safeUser.displayName || safeUser.username || (loading ? 'Loading profile…' : 'User');
  const avatar = window.getAvatarUrl?.(displayName, safeUser.photoUrl || safeUser.photoURL) || '';
  const avatarEl = document.getElementById('up-avatar');
  if (avatarEl) {
    if (avatarEl.getAttribute('src') !== avatar) avatarEl.src = avatar;
    avatarEl.alt = `${displayName} avatar`;
    avatarEl.onerror = () => {
      avatarEl.onerror = null;
      avatarEl.src = window.getAvatarUrl?.(displayName, '') || '';
    };
  }

  renderProfileSection('up-name', createElement(ProfileNameLine, {
    name: displayName,
    tier: (safeUser.tier || '').toLowerCase(),
  }));

  const pronouns = document.getElementById('up-pronouns');
  if (pronouns) {
    pronouns.textContent = safeUser.pronouns || '';
    pronouns.style.display = safeUser.pronouns ? '' : 'none';
  }
  const shortId = document.getElementById('up-shortid');
  if (shortId) {
    shortId.textContent = safeUser.shortId ? `#${safeUser.shortId}` : '';
    shortId.style.display = safeUser.shortId ? '' : 'none';
  }
  const status = document.getElementById('up-status');
  if (status) {
    status.textContent = safeUser.status || '';
    status.style.display = safeUser.status ? '' : 'none';
  }
  const bio = document.getElementById('up-bio');
  if (bio) bio.textContent = safeUser.bio || (loading ? 'Loading public profile…' : 'No bio yet.');
  const flair = document.getElementById('up-flair');
  if (flair) {
    flair.textContent = safeUser.flair || '';
    flair.style.display = safeUser.flair ? '' : 'none';
  }

  renderProfileSection('up-links', createElement(ProfileLinks, { links: safeUser.links }));
  renderProfileSection('up-skills', createElement(ProfileSkills, {
    key: targetUid,
    skills: safeUser.skills,
    targetUid,
    isSelf: isMe,
    onEndorse: async (uid, skillKey) => {
      const result = await window.endorseSkill?.(uid, skillKey);
      if (result?.reason === 'already') window.showToast?.('Already endorsed.');
      return result;
    },
  }));
  renderProfileSection('up-skilltree', createElement(ProfileSkillTree, { user: safeUser }));
  renderProfileSection('up-badges', createElement(EarnedBadges, { badges: safeUser.badges }));
  renderProfileSection('up-rep', createElement(Reputation, { value: window.computeRep ? window.computeRep(safeUser) : 0 }));
  renderProfileSection('up-heatmap', createElement(ActivityHeatmap, { activityByDay: safeUser.activityByDay }));
  renderProfileSection('up-activity', createElement(ActivityFeed, { user: safeUser }));

  const joined = document.getElementById('up-joined');
  if (joined) {
    joined.textContent = loading
      ? 'Joined: Loading…'
      : `Joined: ${safeUser.createdAt
        ? new Date(safeUser.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'Not shared'}`;
  }

  const banner = document.getElementById('up-banner');
  if (banner) {
    banner.style.backgroundColor = safeUser.themeColor || 'var(--accent-color)';
    banner.style.backgroundImage = safeUser.bannerUrl ? `url("${encodeURI(safeUser.bannerUrl)}")` : 'none';
    banner.style.backgroundSize = safeUser.bannerUrl ? 'cover' : '';
    banner.style.backgroundPosition = safeUser.bannerUrl ? 'center' : '';
  }

  const kudosCount = document.getElementById('up-kudos-count');
  if (kudosCount) kudosCount.textContent = safeUser.kudos || 0;
  window.renderProfileSpotlight?.({
    status: 'idle',
    onRetry: () => window.generateSpotlight?.(targetUid, safeUser),
  });
}

function configureProfileActions(targetUid, user, { currentUid, isMe, returnToContacts }) {
  const safeUser = user || {};
  const followBtn = document.getElementById('up-follow-btn');
  if (followBtn) {
    followBtn.style.display = isMe ? 'none' : '';
    followBtn.disabled = false;
    followBtn.onclick = async () => {
      followBtn.disabled = true;
      try {
        const now = await window.toggleFollow?.(targetUid);
        followBtn.textContent = now ? 'Following' : 'Follow';
        followBtn.classList.toggle('is-following', !!now);
        if (window.getFollowCounts) setFollowStats(await window.getFollowCounts(targetUid));
      } finally {
        followBtn.disabled = false;
      }
    };
  }

  const shareBtn = document.getElementById('up-share-btn');
  if (shareBtn) {
    shareBtn.onclick = async () => {
      const link = window.profileShareLink(targetUid);
      if (await copyTextWithFallback(link)) {
        window.showToast?.('Profile link copied!', false);
      } else {
        window.showToast?.(`Link: ${link}`);
      }
    };
  }

  const kudosBtn = document.getElementById('up-kudos-btn');
  if (kudosBtn) {
    kudosBtn.style.display = isMe ? 'none' : '';
    kudosBtn.disabled = Boolean(!isMe && currentUid && safeUser.kudosFrom?.[currentUid]);
    kudosBtn.onclick = async () => {
      kudosBtn.disabled = true;
      const result = await window.giveKudos?.(targetUid);
      if (result?.ok) {
        const count = document.getElementById('up-kudos-count');
        if (count) {
          const nextCount = result.count !== null && result.count !== undefined && Number.isFinite(Number(result.count))
            ? Number(result.count)
            : Number(count.textContent || 0) + 1;
          count.textContent = String(nextCount);
        }
        window.showToast?.('Kudos sent! 👏', false);
      } else {
        kudosBtn.disabled = result?.reason === 'already';
        if (result?.reason === 'already') window.showToast?.('You already gave kudos.');
      }
    };
  }

  const messageBtn = document.getElementById('up-message-btn');
  if (messageBtn) {
    messageBtn.onclick = () => {
      const contactsPanel = document.getElementById('contacts-panel');
      const shouldReturnToContacts = returnToContacts || contactsPanel?.classList.contains('open');
      window.closeUserProfilePopup?.({ restoreFocus: false });
      if (contactsPanel?.classList.contains('open')) {
        if (typeof window.closeContactsPanel === 'function') window.closeContactsPanel();
        else contactsPanel.classList.remove('open');
      }
      window.openPrivateChat?.(targetUid, safeUser.displayName || safeUser.username || 'User', {
        photoUrl: normalizeStoredAvatarUrl(safeUser.photoUrl || safeUser.photoURL),
        returnTo: shouldReturnToContacts ? 'contacts' : undefined,
      });
    };
  }
}

window.closeUserProfilePopup = function closeUserProfilePopup(options = {}) {
  profileRequestVersion += 1;
  window.cancelProfileSpotlightRequest?.();
  const popup = document.getElementById('user-profile-popup');
  popup?.classList.add('hidden');
  popup?.setAttribute('aria-hidden', 'true');
  popup?.setAttribute('aria-busy', 'false');
  document.getElementById('profile-more-dropdown')?.classList.add('hidden');

  const settings = document.getElementById('settings-modal');
  if (!settings || settings.classList.contains('hidden')) {
    document.getElementById('modal-overlay')?.classList.add('hidden');
  }

  const restoreTarget = profileLastFocus;
  profileLastFocus = null;
  if (options.restoreFocus !== false && restoreTarget?.isConnected) {
    window.requestAnimationFrame(() => restoreTarget.focus({ preventScroll: true }));
  }
};

window.viewUserProfile = async function viewUserProfile(targetUid, seedUser = null) {
  if (!targetUid) return;

  window.cancelProfileSpotlightRequest?.();
  const requestId = ++profileRequestVersion;
  const currentUid = window.currentUser?.uid;
  const isMe = targetUid === currentUid;
  const canReadPrivate = isMe || currentUid === window.MY_ADMIN_UID;
  const popup = document.getElementById('user-profile-popup');
  if (!popup) return;

  profileLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const returnToContacts = Boolean(document.getElementById('contacts-panel')?.classList.contains('open'));
  popup.dataset.profileUid = targetUid;
  popup.classList.remove('hidden');
  popup.setAttribute('aria-hidden', 'false');
  popup.setAttribute('aria-busy', 'true');
  document.getElementById('modal-overlay')?.classList.remove('hidden');
  document.getElementById('profile-more-dropdown')?.classList.add('hidden');

  const contactCached = window.getCachedContactPublicProfile?.(targetUid) || null;
  const serviceCached = getFreshPublicProfile(targetUid);
  const safeSeedUser = seedUser && typeof seedUser === 'object'
    ? {
      displayName: String(seedUser.displayName || '').trim(),
      photoUrl: normalizeStoredAvatarUrl(seedUser.photoUrl || seedUser.photoURL),
    }
    : null;
  const contactCacheIsNewer = Number(contactCached?.updatedAt || 0) >= Number(serviceCached?.updatedAt || 0);
  const cachedProfile = contactCached || serviceCached
    ? contactCacheIsNewer
      ? { ...(serviceCached || {}), ...(contactCached || {}) }
      : { ...(contactCached || {}), ...(serviceCached || {}) }
    : null;
  const cachedUser = safeSeedUser || cachedProfile
    ? { ...(safeSeedUser || {}), ...(cachedProfile || {}) }
    : null;
  renderProfileBase(targetUid, cachedUser || {}, { isMe, loading: !cachedUser });
  const initialFollowBtn = document.getElementById('up-follow-btn');
  if (initialFollowBtn && !isMe) {
    initialFollowBtn.textContent = 'Follow';
    initialFollowBtn.classList.remove('is-following');
  }
  configureProfileActions(targetUid, cachedUser || {}, {
    currentUid,
    isMe,
    returnToContacts,
  });
  setFollowStats(null);
  const mutualTarget = document.getElementById('up-mutual');
  if (mutualTarget) mutualTarget.style.display = 'none';

  const cachedPresence = window.getCachedContactPresence?.(targetUid) || null;
  if (cachedPresence) setProfilePresence(cachedPresence);
  else setProfilePresence(null);

  window.requestAnimationFrame(() => {
    if (!isCurrentProfileRequest(requestId, targetUid)) return;
    document.getElementById('close-user-profile-btn')?.focus({ preventScroll: true });
  });

  const publicProfilePromise = loadPublicProfile(targetUid);
  const privateProfilePromise = canReadPrivate
    ? get(ref(db, `users/${targetUid}`)).then((snapshot) => (snapshot.exists() ? snapshot.val() : null)).catch(() => null)
    : Promise.resolve(null);

  const enhancements = [];
  if (!isMe && window.isFollowing) {
    enhancements.push(Promise.resolve(window.isFollowing(targetUid)).then((following) => {
      if (!isCurrentProfileRequest(requestId, targetUid)) return;
      const followBtn = document.getElementById('up-follow-btn');
      if (!followBtn) return;
      followBtn.textContent = following ? 'Following' : 'Follow';
      followBtn.classList.toggle('is-following', !!following);
    }));
  }
  if (window.getFollowCounts) {
    enhancements.push(Promise.resolve(window.getFollowCounts(targetUid)).then((counts) => {
      if (isCurrentProfileRequest(requestId, targetUid)) setFollowStats(counts);
    }));
  }
  if (!isMe && window.getMutualRooms) {
    enhancements.push(loadMutualRooms(targetUid, currentUid).then((rooms) => {
      if (!isCurrentProfileRequest(requestId, targetUid)) return;
      const target = document.getElementById('up-mutual');
      if (target) target.style.display = rooms.length ? '' : 'none';
      renderProfileSection('up-mutual', createElement(MutualRooms, { rooms }));
    }));
  }
  if (!cachedPresence) {
    enhancements.push(get(ref(db, `presence/${targetUid}`)).then((snapshot) => {
      if (isCurrentProfileRequest(requestId, targetUid)) setProfilePresence(snapshot.val());
    }));
  }
  void Promise.allSettled(enhancements);

  try {
    const [publicProfile, privateProfile] = await Promise.all([publicProfilePromise, privateProfilePromise]);
    if (!isCurrentProfileRequest(requestId, targetUid)) return;
    if (!publicProfile && !privateProfile && !cachedUser) {
      window.showToast?.('This person has not published a public profile yet.');
      window.closeUserProfilePopup();
      return;
    }

    const user = {
      ...(cachedUser || {}),
      ...(publicProfile || {}),
      ...(privateProfile || {}),
    };
    renderProfileBase(targetUid, user, { isMe });
    configureProfileActions(targetUid, user, { currentUid, isMe, returnToContacts });
    popup.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (!isCurrentProfileRequest(requestId, targetUid)) return;
    popup.setAttribute('aria-busy', 'false');
    window.showToast?.(`Failed to load user profile: ${error.message}`);
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

document.getElementById('ctx-copy-btn')?.addEventListener('click', async () => {
  if (!window.contextTargetUid) return;
  if (await copyTextWithFallback(window.contextTargetUid)) {
    window.showToast('User ID copied!', false);
  } else {
    window.showToast('Could not copy the User ID on this device.', true);
  }
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
