import { get, ref, set } from 'firebase/database';
import {
  createInitialsAvatarDataUrl,
  normalizeStoredAvatarUrl,
} from './avatar.js';
import { db } from './firebase.js';

export { createInitialsAvatarDataUrl };

function randomShortId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function setSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Some mobile auth webviews block storage while redirect/popup flows settle.
  }
}

export function isGoogleAuthUser(user) {
  return Boolean(user?.providerData?.some((provider) => provider?.providerId === 'google.com'));
}

export function displayNameFromAuthUser(user) {
  const emailName = user?.email ? user.email.split('@')[0] : '';
  return (user?.displayName || emailName || 'New User').trim();
}

export function publicDirectoryProfileFromUser(user, profile = {}) {
  const displayName = (profile.displayName || displayNameFromAuthUser(user) || 'New User').trim();
  return {
    displayName,
    photoUrl: normalizeStoredAvatarUrl(profile.photoUrl || user?.photoURL),
    shortId: profile.shortId || '',
    username: profile.username || '',
    pronouns: profile.pronouns || '',
    bio: profile.bio || '',
    status: profile.status || '',
    flair: profile.flair || '',
    themeColor: profile.themeColor || '#FFD700',
    updatedAt: Date.now(),
  };
}

export async function syncPublicUserDirectory(user, profile = {}) {
  if (!user?.uid) return false;

  try {
    await set(ref(db, `user_directory/${user.uid}`), publicDirectoryProfileFromUser(user, profile));
    return true;
  } catch (error) {
    console.warn('Public user directory sync failed', error);
    return false;
  }
}

export async function ensureWelcomeBadge(userOrUid, profile = {}) {
  const uid = typeof userOrUid === 'string' ? userOrUid : userOrUid?.uid;
  if (!uid) return { awardedAt: null, newlyAwarded: false };

  const existingProfileBadge = profile?.badges?.welcome;
  if (existingProfileBadge) {
    return { awardedAt: existingProfileBadge, newlyAwarded: false };
  }

  const badgeRef = ref(db, `users/${uid}/badges/welcome`);
  const badgeSnapshot = await get(badgeRef);
  if (badgeSnapshot.exists()) {
    return { awardedAt: badgeSnapshot.val(), newlyAwarded: false };
  }

  const awardedAt = Date.now();
  await set(badgeRef, awardedAt);
  return { awardedAt, newlyAwarded: true };
}

export async function ensureAuthProfile(user, { welcome = false } = {}) {
  if (!user?.uid) return null;

  const profileRef = ref(db, `users/${user.uid}`);
  const snapshot = await get(profileRef);
  if (snapshot.exists()) {
    const profile = snapshot.val();
    const storedPhotoUrl = normalizeStoredAvatarUrl(profile.photoUrl || profile.photoURL);
    if ((profile.photoUrl || '') !== storedPhotoUrl || profile.photoURL) {
      profile.photoUrl = storedPhotoUrl;
      delete profile.photoURL;
      try {
        await set(ref(db, `users/${user.uid}/photoUrl`), storedPhotoUrl);
        if (snapshot.val()?.photoURL) await set(ref(db, `users/${user.uid}/photoURL`), null);
      } catch (error) {
        console.warn('Legacy avatar migration skipped', error);
      }
    }
    if (welcome) {
      try {
        const result = await ensureWelcomeBadge(user.uid, profile);
        if (result.awardedAt) {
          profile.badges = {
            ...(profile.badges || {}),
            welcome: result.awardedAt,
          };
        }
        if (result.newlyAwarded) setSessionValue('showWelcomeTour', '1');
      } catch (error) {
        console.warn('Welcome badge award skipped', error);
      }
    }
    syncPublicUserDirectory(user, profile);
    return profile;
  }

  const displayName = displayNameFromAuthUser(user);
  const shortId = randomShortId();
  const avatar = normalizeStoredAvatarUrl(user.photoURL);

  const profile = {
    displayName,
    phoneNumber: user.phoneNumber || '',
    birthday: '',
    photoUrl: avatar,
    shortId,
    themeColor: '#FFD700',
    bio: "I'm new here!",
    pronouns: '',
    createdAt: user.metadata?.creationTime || new Date().toISOString(),
  };

  await set(profileRef, profile);
  if (welcome) {
    try {
      const result = await ensureWelcomeBadge(user.uid, profile);
      if (result.awardedAt) profile.badges = { welcome: result.awardedAt };
    } catch (error) {
      console.warn('Welcome badge award skipped', error);
    }
  }
  await syncPublicUserDirectory(user, profile);
  if (welcome) setSessionValue('showWelcomeTour', '1');
  return profile;
}
