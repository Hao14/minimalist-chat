import { deleteApp, initializeApp } from 'firebase/app';
import {
  deleteUser,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { ref, remove, set, update } from 'firebase/database';
import { app, auth, db } from '../../lib/firebase.js';
import { syncPublicUserDirectory } from '../../lib/authProfile.js';
import { normalizeStoredAvatarUrl } from '../../lib/avatar.js';
import { getStorageUploadTools } from '../../lib/firebaseStorage.js';
import { imageUploadMetadata, optimizeImageForUpload } from '../../lib/imageUploadOptimization.js';
import { writeAuthPresenceHint } from '../../lib/authPresenceHint.js';
import { forgetSavedAccount, readSavedAccounts, rememberAccount } from '../../lib/accountProfiles.js';
import {
  cancelGoogleIdentitySessionReset,
  requestGoogleIdentitySessionReset,
} from '../../lib/googleIdentityAuth.js';

function setSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Some mobile auth webviews block storage while auth flows settle.
  }
}

document.getElementById('save-new-profile-btn')?.addEventListener('click', async () => {
  try {
    const name = document.getElementById('new-display-name')?.value.trim();
    const rawPhoto = document.getElementById('new-photo-url')?.value.trim() || '';
    if (!name) return;

    const finalPhotoUrl = normalizeStoredAvatarUrl(rawPhoto);
    window.userShortId = window.generateShortId();

    const profile = {
      displayName: name,
      photoUrl: finalPhotoUrl,
      shortId: window.userShortId,
      themeColor: '#FFD700',
      bio: "I'm new here!",
      pronouns: '',
      createdAt: window.currentUser.metadata?.creationTime || new Date().toISOString(),
    };

    await set(ref(db, `users/${window.currentUser.uid}`), profile);
    try {
      const welcomeAt = Date.now();
      await set(ref(db, `users/${window.currentUser.uid}/badges/welcome`), welcomeAt);
      profile.badges = { welcome: welcomeAt };
    } catch (badgeError) {
      console.warn('Welcome badge award skipped', badgeError);
    }
    await syncPublicUserDirectory(window.currentUser, profile);

    window.userProfileName = name;
    window.userPhotoUrl = finalPhotoUrl;
    window.userThemeColor = '#FFD700';
    window.userBio = "I'm new here!";
    window.userPronouns = '';
    setSessionValue('showWelcomeTour', '1');
    if (typeof window.enterChat === 'function') window.enterChat();
  } catch (error) {
    if (window.showToast) window.showToast(`Error saving profile: ${error.message}`);
  }
});

document.getElementById('update-profile-btn')?.addEventListener('click', async () => {
  try {
    const fileInput = document.getElementById('edit-photo-file');
    let finalPhotoUrl = normalizeStoredAvatarUrl(window.userPhotoUrl);

    if (fileInput?.files.length > 0) {
      const photoFile = await optimizeImageForUpload(fileInput.files[0], { maxWidth: 512, maxHeight: 512 });
      const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
      const fileRef = storageRef(storage, `avatars/${window.currentUser.uid}`);
      await uploadBytesResumable(fileRef, photoFile, imageUploadMetadata(photoFile));
      finalPhotoUrl = await getDownloadURL(fileRef);
    }

    const bannerInput = document.getElementById('edit-banner-file');
    let finalBannerUrl = window.userBannerUrl || '';
    if (bannerInput?.files.length > 0) {
      const bannerFile = await optimizeImageForUpload(bannerInput.files[0], { maxWidth: 1600, maxHeight: 900 });
      const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
      const bannerRef = storageRef(storage, `banners/${window.currentUser.uid}`);
      await uploadBytesResumable(bannerRef, bannerFile, imageUploadMetadata(bannerFile));
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
    if (skills !== undefined) window.userSkills = skills;
    window.invalidateSettingsProfilePreview?.();

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
      const deletingUid = window.currentUser.uid;
      await clearPushTokenBeforeSessionChange({ allForAccount: true });
      await remove(ref(db, `users/${deletingUid}`));
      try {
        await remove(ref(db, `user_directory/${deletingUid}`));
      } catch {
        // Directory cleanup is best effort; account deletion is the important action.
      }
      requestGoogleIdentitySessionReset();
      await deleteUser(window.currentUser);
      forgetSavedAccount(deletingUid);
      writeAuthPresenceHint(false);
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
          await clearPushTokenBeforeSessionChange();
          await signOut(auth);
          writeAuthPresenceHint(false);
        } catch {
          // Redirect below still lets them re-auth.
        }
        window.location.replace('/login');
        return;
      }

      cancelGoogleIdentitySessionReset();

      if (window.showToast) window.showToast(`Failed to delete account: ${error.message}`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Delete Forever';
      }
    }
  });
}

function closeSettingsForSessionChange() {
  if (typeof window.closeSettingsModal === 'function') {
    window.closeSettingsModal({ restoreFocus: false });
  } else {
    document.getElementById('settings-modal')?.classList.add('hidden');
    document.getElementById('modal-overlay')?.classList.add('hidden');
  }
  sessionStorage.removeItem('blipLoaded');
}

async function clearPushTokenBeforeSessionChange(opts = {}, uid = window.currentUser?.uid) {
  try {
    await window.clearFirebasePushToken?.(uid, opts);
  } catch {
    // Push token cleanup is best-effort and should not trap the user in a session.
  }
}

const handleSettingsLogout = async () => {
  closeSettingsForSessionChange();
  await clearPushTokenBeforeSessionChange();
  requestGoogleIdentitySessionReset();
  try {
    await signOut(auth);
  } catch (error) {
    cancelGoogleIdentitySessionReset();
    throw error;
  }
  writeAuthPresenceHint(false);
};

const SWITCH_ACCOUNT_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

let switchAccountLastFocus = null;
let switchAccountParentState = null;

function isSwitchAccountDialogOpen() {
  const overlay = document.getElementById('switch-account-overlay');
  return Boolean(overlay && !overlay.classList.contains('hidden'));
}

function suspendSwitchAccountParent(trigger) {
  const parentDialog = trigger?.closest?.('[role="dialog"][aria-modal="true"]');
  if (!parentDialog || parentDialog.id === 'switch-account-overlay') return;

  switchAccountParentState = {
    element: parentDialog,
    ariaHidden: parentDialog.getAttribute('aria-hidden'),
    inert: parentDialog.inert,
  };
  parentDialog.setAttribute('aria-hidden', 'true');
  parentDialog.inert = true;
}

function restoreSwitchAccountParent() {
  const state = switchAccountParentState;
  switchAccountParentState = null;
  if (!state?.element?.isConnected) return;

  if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden');
  else state.element.setAttribute('aria-hidden', state.ariaHidden);
  state.element.inert = state.inert;
}

function closeSwitchAccountDialog({ restoreFocus = true } = {}) {
  const overlay = document.getElementById('switch-account-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  restoreSwitchAccountParent();
  const focusTarget = switchAccountLastFocus;
  switchAccountLastFocus = null;
  if (restoreFocus && focusTarget?.isConnected && !focusTarget.closest('[inert]')) {
    focusTarget.focus({ preventScroll: true });
  } else if (overlay.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('[aria-controls="switch-account-overlay"]').forEach((trigger) => {
    trigger.setAttribute('aria-expanded', 'false');
  });
}

function handleSwitchAccountDialogKeydown(event) {
  if (!isSwitchAccountDialogOpen()) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSwitchAccountDialog();
    return;
  }

  if (event.key !== 'Tab') return;
  const overlay = document.getElementById('switch-account-overlay');
  const focusable = [...(overlay?.querySelectorAll(SWITCH_ACCOUNT_FOCUSABLE_SELECTOR) || [])]
    .filter((element) => !element.closest('.hidden') && element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const activeIndex = focusable.indexOf(document.activeElement);
  const shouldWrapBackward = event.shiftKey && activeIndex <= 0;
  const shouldWrapForward = !event.shiftKey && (activeIndex < 0 || activeIndex === focusable.length - 1);
  if (shouldWrapBackward || shouldWrapForward) {
    event.preventDefault();
    focusable[shouldWrapBackward ? focusable.length - 1 : 0].focus();
  }
  event.stopImmediatePropagation();
}

function shouldRedirectAfterPopupError(error) {
  return [
    'auth/popup-blocked',
    'auth/cancelled-popup-request',
    'auth/operation-not-supported-in-this-environment',
    'auth/web-storage-unsupported',
  ].includes(error?.code);
}

function rememberCurrentAccount() {
  return rememberAccount(window.currentUser, {
    displayName: window.userProfileName,
    photoUrl: window.userPhotoUrl,
  });
}

function createAccountAvatar(account) {
  const avatar = document.createElement('span');
  avatar.className = 'switch-account-avatar';
  const photoUrl = normalizeStoredAvatarUrl(account.photoUrl);
  if (photoUrl) {
    const image = document.createElement('img');
    image.src = photoUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 44;
    image.height = 44;
    image.referrerPolicy = 'no-referrer';
    avatar.appendChild(image);
  } else {
    avatar.textContent = (account.displayName || account.email || '?').slice(0, 2).toUpperCase();
  }
  return avatar;
}

function accountChoices() {
  const activeAccount = rememberCurrentAccount();
  const savedAccounts = readSavedAccounts();
  if (!activeAccount || savedAccounts.some((account) => account.uid === activeAccount.uid)) return savedAccounts;
  return [activeAccount, ...savedAccounts];
}

function rememberAddedAccount(user) {
  const alreadySaved = readSavedAccounts().some((account) => account.uid === user?.uid);
  return { account: rememberAccount(user), alreadySaved };
}

function setAccountDialogBusy(overlay, busy, label = '') {
  overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (busy) {
    overlay.querySelectorAll('button').forEach((button) => {
      if (!button.classList.contains('switch-account-close')) button.disabled = true;
    });
  } else {
    overlay.querySelectorAll('.switch-account-actions button, .switch-email-form button').forEach((button) => {
      button.disabled = false;
    });
    renderSavedAccounts(overlay);
  }
  const status = overlay.querySelector('#switch-account-status');
  if (status) status.textContent = label;
}

function googleProvider(loginHint = '') {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return provider;
}

async function withTemporaryAuth(signIn) {
  const temporaryApp = initializeApp(app.options, `minimalist-add-account-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const temporaryAuth = getAuth(temporaryApp);
  try {
    await setPersistence(temporaryAuth, inMemoryPersistence);
    return await signIn(temporaryAuth);
  } finally {
    await signOut(temporaryAuth).catch(() => {});
    await deleteApp(temporaryApp).catch(() => {});
  }
}

function signInWithSelectedGoogleAccount(loginHint = '') {
  return signInWithPopup(auth, googleProvider(loginHint));
}

function addGoogleAccountWithoutSwitching() {
  return withTemporaryAuth((temporaryAuth) => signInWithPopup(temporaryAuth, googleProvider()));
}

async function completeAccountSelection(credential, previousUid) {
  const selectedUser = credential?.user;
  if (!selectedUser?.uid) throw new Error('The selected account could not be verified.');
  const selectedAccount = rememberAccount(selectedUser);
  if (previousUid && previousUid !== selectedUser.uid) {
    await clearPushTokenBeforeSessionChange({}, previousUid);
  }
  writeAuthPresenceHint(true);
  closeSwitchAccountDialog({ restoreFocus: false });
  closeSettingsForSessionChange();
  window.showToast?.(`${selectedAccount?.displayName || 'Account'} is now active.`, false);
  window.location.reload();
}

async function switchToSavedAccount(account, overlay) {
  const previousUid = window.currentUser?.uid || '';
  setAccountDialogBusy(overlay, true, `Opening ${account.displayName || account.email}…`);
  try {
    const credential = await signInWithSelectedGoogleAccount(account.email);
    await completeAccountSelection(credential, previousUid);
  } catch (error) {
    const closed = error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request';
    window.showToast?.(closed ? 'Account switch canceled.' : `Could not switch account: ${error.message}`);
    setAccountDialogBusy(overlay, false, 'Your current account is still active.');
  }
}

function openEmailAccountForm(overlay, account = null) {
  const form = overlay.querySelector('#switch-email-form');
  const emailInput = overlay.querySelector('#switch-email-address');
  const passwordInput = overlay.querySelector('#switch-email-password');
  const submit = overlay.querySelector('#switch-email-submit');
  const title = overlay.querySelector('#switch-email-title');
  if (!form || !emailInput || !passwordInput || !submit) return;
  form.dataset.mode = account ? 'switch' : 'add';
  form.dataset.accountUid = account?.uid || '';
  form.classList.remove('hidden');
  overlay.querySelector('.switch-account-card')?.classList.add('is-email-mode');
  overlay.querySelector('.switch-account-actions')?.classList.add('is-email-open');
  emailInput.value = account?.email || '';
  emailInput.readOnly = Boolean(account?.email);
  passwordInput.value = '';
  submit.textContent = account ? 'Switch account' : 'Add account';
  if (title) title.textContent = account ? 'Switch email profile' : 'Add email profile';
  const status = overlay.querySelector('#switch-account-status');
  if (status) status.textContent = account
    ? `Enter the password for ${account.email}.`
    : 'Sign in once to save this email profile. Your current account will stay active.';
  window.requestAnimationFrame(() => (account?.email ? passwordInput : emailInput).focus());
}

function closeEmailAccountForm(overlay) {
  const form = overlay.querySelector('#switch-email-form');
  if (!form) return;
  form.classList.add('hidden');
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.accountUid = '';
  overlay.querySelector('.switch-account-card')?.classList.remove('is-email-mode');
  overlay.querySelector('.switch-account-actions')?.classList.remove('is-email-open');
  const emailInput = overlay.querySelector('#switch-email-address');
  if (emailInput) emailInput.readOnly = false;
}

function renderSavedAccounts(overlay) {
  const list = overlay.querySelector('#switch-account-list');
  if (!list) return;
  const activeUid = window.currentUser?.uid || '';
  const accounts = accountChoices();
  list.replaceChildren();

  accounts.forEach((account) => {
    const row = document.createElement('div');
    row.className = `switch-account-row${account.uid === activeUid ? ' is-active' : ''}`;

    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'switch-account-choice';
    choice.dataset.switchAccountUid = account.uid;
    choice.disabled = account.uid === activeUid;
    choice.appendChild(createAccountAvatar(account));

    const copy = document.createElement('span');
    copy.className = 'switch-account-profile-copy';
    const name = document.createElement('strong');
    name.textContent = account.displayName;
    const email = document.createElement('small');
    email.textContent = account.email || (account.provider === 'google' ? 'Google account' : 'Email account');
    copy.append(name, email);
    choice.appendChild(copy);

    const badge = document.createElement('span');
    badge.className = 'switch-account-state';
    badge.textContent = account.uid === activeUid ? 'Current' : account.provider === 'google' ? 'Switch' : 'Sign in';
    choice.appendChild(badge);
    row.appendChild(choice);

    if (account.uid !== activeUid) {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'switch-account-remove';
      removeButton.dataset.removeAccountUid = account.uid;
      removeButton.setAttribute('aria-label', `Forget ${account.displayName} on this device`);
      removeButton.innerHTML = '<i class="ph-bold ph-trash" aria-hidden="true"></i>';
      row.appendChild(removeButton);
    }
    list.appendChild(row);
  });
}

function ensureSwitchAccountDialog() {
  let overlay = document.getElementById('switch-account-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'switch-account-overlay';
  overlay.className = 'switch-account-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <section class="switch-account-card" role="dialog" aria-modal="true" aria-labelledby="switch-account-title">
      <button class="switch-account-close" type="button" aria-label="Close account switcher">
        <i class="ph-bold ph-x"></i>
      </button>
      <h2 id="switch-account-title">Accounts</h2>
      <p class="switch-account-copy">Add a profile without signing out, or switch securely.</p>
      <div id="switch-account-list" class="switch-account-list" aria-label="Saved accounts"></div>
      <p id="switch-account-status" class="switch-account-status" role="status" aria-live="polite"></p>
      <form id="switch-email-form" class="switch-email-form hidden" data-mode="add">
        <strong id="switch-email-title" class="switch-email-title">Add email profile</strong>
        <label for="switch-email-address">Email</label>
        <input id="switch-email-address" name="email" type="email" autocomplete="username" required />
        <label for="switch-email-password">Password</label>
        <input id="switch-email-password" name="password" type="password" autocomplete="current-password" required />
        <div class="switch-email-actions">
          <button id="switch-email-submit" type="submit" class="switch-account-primary">Add account</button>
          <button id="switch-email-cancel" type="button" class="switch-account-secondary">Cancel</button>
        </div>
      </form>
      <div class="switch-account-actions">
        <button id="switch-add-google-btn" type="button" class="switch-account-primary" aria-label="Add Google account">
          <i class="ph-bold ph-google-logo"></i>
          <span>Google</span>
        </button>
        <button id="switch-email-login-btn" type="button" class="switch-account-secondary" aria-label="Add email account">
          <i class="ph-bold ph-envelope-simple"></i>
          <span>Email</span>
        </button>
      </div>
      <p class="switch-account-privacy"><i class="ph-bold ph-lock-key" aria-hidden="true"></i> Only account labels are saved on this device.</p>
    </section>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeSwitchAccountDialog();
  });
  overlay.querySelector('.switch-account-close')?.addEventListener('click', () => closeSwitchAccountDialog());
  overlay.querySelector('#switch-email-login-btn')?.addEventListener('click', () => openEmailAccountForm(overlay));
  overlay.querySelector('#switch-email-cancel')?.addEventListener('click', () => closeEmailAccountForm(overlay));
  overlay.querySelector('#switch-email-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = overlay.querySelector('#switch-email-address')?.value.trim() || '';
    const password = overlay.querySelector('#switch-email-password')?.value || '';
    const previousUid = window.currentUser?.uid || '';
    if (!email || !password) return;
    setAccountDialogBusy(overlay, true, form.dataset.mode === 'switch' ? `Signing in to ${email}…` : `Adding ${email}…`);
    try {
      const credential = form.dataset.mode === 'switch'
        ? await signInWithEmailAndPassword(auth, email, password)
        : await withTemporaryAuth((temporaryAuth) => signInWithEmailAndPassword(temporaryAuth, email, password));
      if (form.dataset.mode === 'switch') {
        await completeAccountSelection(credential, previousUid);
        return;
      }
      const { account: addedAccount, alreadySaved } = rememberAddedAccount(credential.user);
      closeEmailAccountForm(overlay);
      const addedMessage = alreadySaved
        ? `${addedAccount?.displayName || email} is already in your account list.`
        : `${addedAccount?.displayName || email} was added. Your current account is still active.`;
      setAccountDialogBusy(overlay, false, addedMessage);
      window.showToast?.(alreadySaved ? 'That account is already saved.' : 'Account added. Your current profile stayed active.', false);
    } catch (error) {
      setAccountDialogBusy(overlay, false, error.message || 'Could not add this account.');
      window.showToast?.(`Could not ${form.dataset.mode === 'switch' ? 'switch' : 'add'} account: ${error.message}`);
    } finally {
      const passwordInput = overlay.querySelector('#switch-email-password');
      if (passwordInput) passwordInput.value = '';
    }
  });
  overlay.querySelector('#switch-add-google-btn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    rememberCurrentAccount();
    setAccountDialogBusy(overlay, true, 'Choose a different Google account to add.');
    button.innerHTML = '<i class="ph-bold ph-spinner-gap"></i><span>Opening…</span>';
    try {
      const credential = await addGoogleAccountWithoutSwitching();
      const { account: addedAccount, alreadySaved } = rememberAddedAccount(credential.user);
      const addedMessage = alreadySaved
        ? `${addedAccount?.displayName || 'That account'} is already in your account list.`
        : `${addedAccount?.displayName || 'Account'} was added. Your current account is still active.`;
      setAccountDialogBusy(overlay, false, addedMessage);
      window.showToast?.(alreadySaved ? 'That account is already saved.' : 'Account added. Your current profile stayed active.', false);
    } catch (error) {
      if (shouldRedirectAfterPopupError(error)) {
        window.showToast?.('This browser blocked the account picker. Use “Add with email or password” instead.');
      } else {
        window.showToast?.(error?.code === 'auth/popup-closed-by-user' ? 'Account picker closed.' : error.message);
      }
      setAccountDialogBusy(overlay, false, 'Your current account is still active.');
    } finally {
      button.innerHTML = '<i class="ph-bold ph-google-logo"></i><span>Google</span>';
    }
  });
  overlay.querySelector('#switch-account-list')?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const removeButton = target?.closest('[data-remove-account-uid]');
    if (removeButton) {
      forgetSavedAccount(removeButton.dataset.removeAccountUid);
      renderSavedAccounts(overlay);
      return;
    }
    const choice = target?.closest('[data-switch-account-uid]');
    if (!choice || choice.disabled) return;
    const account = readSavedAccounts().find((entry) => entry.uid === choice.dataset.switchAccountUid);
    if (account?.provider === 'google') switchToSavedAccount(account, overlay);
    else if (account) openEmailAccountForm(overlay, account);
  });

  return overlay;
}

function openSwitchAccountDialog(trigger = document.activeElement) {
  const overlay = ensureSwitchAccountDialog();
  const wasOpen = !overlay.classList.contains('hidden');
  closeEmailAccountForm(overlay);
  renderSavedAccounts(overlay);
  setAccountDialogBusy(overlay, false, '');
  if (!wasOpen) {
    switchAccountLastFocus = trigger instanceof HTMLElement ? trigger : null;
  }
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.remove('hidden');
  if (!wasOpen) {
    overlay.querySelector('.switch-account-close')?.focus({ preventScroll: true });
    suspendSwitchAccountParent(switchAccountLastFocus);
    switchAccountLastFocus?.setAttribute('aria-expanded', 'true');
  }
}

const handleSwitchUser = (event) => {
  openSwitchAccountDialog(event.currentTarget);
};

document.addEventListener('keydown', handleSwitchAccountDialogKeydown, true);

window.openSwitchAccountDialog = openSwitchAccountDialog;

['logout-btn', 'account-logout-btn'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', handleSettingsLogout);
});

['switch-user-btn', 'account-switch-user-btn'].forEach((id) => {
  const trigger = document.getElementById(id);
  trigger?.setAttribute('aria-haspopup', 'dialog');
  trigger?.setAttribute('aria-controls', 'switch-account-overlay');
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.addEventListener('click', handleSwitchUser);
});
