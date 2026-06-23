import { deleteUser, signOut } from 'firebase/auth';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { ref, remove, set, update } from 'firebase/database';
import { auth, db, storage } from '../../lib/firebase.js';

document.getElementById('save-new-profile-btn')?.addEventListener('click', async () => {
  try {
    const name = document.getElementById('new-display-name')?.value.trim();
    const rawPhoto = document.getElementById('new-photo-url')?.value.trim() || '';
    if (!name) return;

    const finalPhotoUrl = window.getAvatarUrl(name, rawPhoto);
    window.userShortId = window.generateShortId();

    await set(ref(db, `users/${window.currentUser.uid}`), {
      displayName: name,
      photoUrl: finalPhotoUrl,
      shortId: window.userShortId,
      themeColor: '#FFD700',
      bio: "I'm new here!",
      pronouns: '',
    });

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

document.getElementById('logout-btn')?.addEventListener('click', () => {
  document.getElementById('settings-modal')?.classList.add('hidden');
  document.getElementById('modal-overlay')?.classList.add('hidden');
  sessionStorage.removeItem('blipLoaded');
  signOut(auth);
});
