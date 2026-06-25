import { deleteUser, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { ref, remove, set, update } from 'firebase/database';
import { auth, db, storage } from '../../lib/firebase.js';
import { syncPublicUserDirectory } from '../../lib/authProfile.js';

document.getElementById('save-new-profile-btn')?.addEventListener('click', async () => {
  try {
    const name = document.getElementById('new-display-name')?.value.trim();
    const rawPhoto = document.getElementById('new-photo-url')?.value.trim() || '';
    if (!name) return;

    const finalPhotoUrl = window.getAvatarUrl(name, rawPhoto);
    window.userShortId = window.generateShortId();

    const profile = {
      displayName: name,
      photoUrl: finalPhotoUrl,
      shortId: window.userShortId,
      themeColor: '#FFD700',
      bio: "I'm new here!",
      pronouns: '',
      createdAt: window.currentUser.metadata?.creationTime || new Date().toISOString(),
      badges: {
        welcome: Date.now(),
      },
    };

    await set(ref(db, `users/${window.currentUser.uid}`), profile);
    await syncPublicUserDirectory(window.currentUser, profile);

    window.userProfileName = name;
    window.userPhotoUrl = finalPhotoUrl;
    window.userThemeColor = '#FFD700';
    window.userBio = "I'm new here!";
    window.userPronouns = '';
    sessionStorage.setItem('showWelcomeTour', '1');
    if (typeof window.enterChat === 'function') window.enterChat();
  } catch (error) {
    if (window.showToast) window.showToast(`Error saving profile: ${error.message}`);
  }
});

document.getElementById('update-profile-btn')?.addEventListener('click', async () => {
  try {
    const fileInput = document.getElementById('edit-photo-file');
    let finalPhotoUrl = window.userPhotoUrl;

    if (fileInput?.files.length > 0) {
      const fileRef = storageRef(storage, `avatars/${window.currentUser.uid}`);
      await uploadBytesResumable(fileRef, fileInput.files[0]);
      finalPhotoUrl = await getDownloadURL(fileRef);
    }

    const bannerInput = document.getElementById('edit-banner-file');
    let finalBannerUrl = window.userBannerUrl || '';
    if (bannerInput?.files.length > 0) {
      const bannerRef = storageRef(storage, `banners/${window.currentUser.uid}`);
      await uploadBytesResumable(bannerRef, bannerInput.files[0]);
      finalBannerUrl = await getDownloadURL(bannerRef);
    }

    const newName = document.getElementById('edit-display-name')?.value.trim() || '';
    const pronouns = document.getElementById('edit-pronouns')?.value.trim() || '';
    const bio = document.getElementById('edit-bio')?.value.trim() || '';
    const themeColor = document.getElementById('edit-theme-color')?.value || '#FFD700';
    const newStatus = (document.getElementById('edit-status')?.value || '').trim();
    const newFlair = (document.getElementById('edit-flair')?.value || '').trim().slice(0, 24);
    const newLinks = window.parseProfileLinks(document.getElementById('edit-links')?.value || '');
    const skills = window.buildSkills
      ? await window.buildSkills(window.currentUser.uid, document.getElementById('edit-skills')?.value || '')
      : undefined;

    const payload = {
      displayName: newName,
      photoUrl: finalPhotoUrl,
      pronouns,
      bio,
      themeColor,
      status: newStatus,
      flair: newFlair,
      bannerUrl: finalBannerUrl,
      links: newLinks,
      shortId: window.userShortId,
    };
    if (skills !== undefined) payload.skills = skills;

    await update(ref(db, `users/${window.currentUser.uid}`), payload);
    await syncPublicUserDirectory(window.currentUser, payload);

    window.userProfileName = newName;
    window.userPhotoUrl = finalPhotoUrl;
    window.userPronouns = pronouns;
    window.userBio = bio;
    window.userThemeColor = themeColor;
    window.userBannerUrl = finalBannerUrl;
    window.userFlair = newFlair;
    window.userStatus = newStatus;
    window.userLinks = newLinks;

    const safeSetText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || '—';
    };
    safeSetText('profile-summary-name', window.userProfileName);
    safeSetText('profile-summary-status', window.userStatus);
    safeSetText('profile-summary-pronouns', window.userPronouns);
    safeSetText('profile-summary-flair', window.userFlair);
    safeSetText('profile-summary-bio', window.userBio || 'No bio yet.');

    if (window.setProfileEditMode) window.setProfileEditMode(false);
    else document.getElementById('toggle-edit-btn')?.click();
    if (window.showToast) window.showToast('Profile Updated!');
  } catch (error) {
    if (window.showToast) window.showToast(`Error updating profile: ${error.message}`);
  }
});

const deleteAccountBtn = document.getElementById('delete-account-btn');
if (deleteAccountBtn) {
  const modal = document.getElementById('delete-account-modal');
  const closeModal = () => modal?.classList.add('hidden');

  deleteAccountBtn.addEventListener('click', () => {
    const input = document.getElementById('delete-confirm-input');
    if (input) input.value = '';
    modal?.classList.remove('hidden');
  });

  document.getElementById('delete-cancel-btn')?.addEventListener('click', closeModal);
  document.getElementById('delete-confirm-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('delete-confirm-input');
    if ((input?.value || '').trim().toUpperCase() !== 'DELETE') {
      if (window.showToast) window.showToast('Type DELETE to confirm.');
      return;
    }

    const btn = document.getElementById('delete-confirm-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Deleting…';
    }

    try {
      await remove(ref(db, `users/${window.currentUser.uid}`));
      try {
        await remove(ref(db, `user_directory/${window.currentUser.uid}`));
      } catch {
        // Directory cleanup is best effort; account deletion is the important action.
      }
      await deleteUser(window.currentUser);
      try {
        await signOut(auth);
      } catch {
        // Account deletion is the important part; sign-out is best effort.
      }
      window.location.replace('/');
    } catch (error) {
      if (error.code === 'auth/requires-recent-login') {
        if (window.showToast) window.showToast('Please log in again, then delete — a quick security step.');
        try {
          await signOut(auth);
        } catch {
          // Redirect below still lets them re-auth.
        }
        window.location.replace('/login');
        return;
      }

      if (window.showToast) window.showToast(`Failed to delete account: ${error.message}`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Delete Forever';
      }
    }
  });
}

function closeSettingsForSessionChange() {
  document.getElementById('settings-modal')?.classList.add('hidden');
  document.getElementById('modal-overlay')?.classList.add('hidden');
  sessionStorage.removeItem('blipLoaded');
}

const handleSettingsLogout = () => {
  closeSettingsForSessionChange();
  signOut(auth);
};

function closeSwitchAccountDialog() {
  document.getElementById('switch-account-overlay')?.classList.add('hidden');
}

function ensureSwitchAccountDialog() {
  let overlay = document.getElementById('switch-account-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'switch-account-overlay';
  overlay.className = 'switch-account-overlay hidden';
  overlay.innerHTML = `
    <section class="switch-account-card" role="dialog" aria-modal="true" aria-labelledby="switch-account-title">
      <button class="switch-account-close" type="button" aria-label="Close account switcher">
        <i class="ph-bold ph-x"></i>
      </button>
      <p class="switch-account-kicker">Account switcher</p>
      <h2 id="switch-account-title">Add another account</h2>
      <p class="switch-account-copy">Pick another Google account without signing out first. If you need email/password, use the sign-out option below.</p>
      <div class="switch-account-current">
        <span class="switch-account-avatar" id="switch-account-avatar">?</span>
        <div>
          <strong id="switch-account-name">Current account</strong>
          <small id="switch-account-email">Signed in</small>
        </div>
      </div>
      <div class="switch-account-actions">
        <button id="switch-add-google-btn" type="button" class="switch-account-primary">
          <i class="ph-bold ph-google-logo"></i>
          Add Google account
        </button>
        <button id="switch-stay-btn" type="button" class="switch-account-secondary">
          Stay on this account
        </button>
        <button id="switch-email-login-btn" type="button" class="switch-account-danger">
          Sign out for email login
        </button>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeSwitchAccountDialog();
  });
  overlay.querySelector('.switch-account-close')?.addEventListener('click', closeSwitchAccountDialog);
  overlay.querySelector('#switch-stay-btn')?.addEventListener('click', closeSwitchAccountDialog);
  overlay.querySelector('#switch-email-login-btn')?.addEventListener('click', async () => {
    closeSwitchAccountDialog();
    closeSettingsForSessionChange();
    sessionStorage.setItem('minimalistSwitchUser', '1');
    await signOut(auth);
    window.location.replace('/login');
  });
  overlay.querySelector('#switch-add-google-btn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.innerHTML = '<i class="ph-bold ph-spinner-gap"></i> Opening account picker…';
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      closeSwitchAccountDialog();
      closeSettingsForSessionChange();
      window.showToast?.('Account switched.', false);
      window.location.reload();
    } catch (error) {
      window.showToast?.(error?.code === 'auth/popup-closed-by-user' ? 'Account picker closed.' : `Could not switch account: ${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="ph-bold ph-google-logo"></i> Add Google account';
    }
  });

  return overlay;
}

function openSwitchAccountDialog() {
  const overlay = ensureSwitchAccountDialog();
  const displayName = window.userProfileName || window.currentUser?.displayName || 'Current account';
  const email = window.currentUser?.email || 'Signed in';
  const avatar = overlay.querySelector('#switch-account-avatar');
  const name = overlay.querySelector('#switch-account-name');
  const emailNode = overlay.querySelector('#switch-account-email');
  if (avatar) avatar.textContent = (displayName || email || '?').slice(0, 2).toUpperCase();
  if (name) name.textContent = displayName;
  if (emailNode) emailNode.textContent = email;
  overlay.classList.remove('hidden');
}

const handleSwitchUser = () => {
  openSwitchAccountDialog();
};

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSwitchAccountDialog();
});

window.openSwitchAccountDialog = openSwitchAccountDialog;

['logout-btn', 'account-logout-btn'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', handleSettingsLogout);
});

['switch-user-btn', 'account-switch-user-btn'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', handleSwitchUser);
});
