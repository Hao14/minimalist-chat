import { get, ref } from 'firebase/database';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';
import { createTimedSingleFlightCache } from '../community/timedSingleFlightCache.js';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { ProfileCardPreview, ProfileCompleteness } from './SettingsWidgets.jsx';
import './settingsShell.css';
import {
  applyPersonalAgentPreferences,
  loadPersonalAgentPreferences,
  savePersonalAgentEnabled,
} from '../ai/personalAgentPreference.js';
import {
  DEFAULT_ACCENT_COLOR,
  applySavedTheme,
  applyTheme,
  clearCustomAccent,
  ensureThemeStylesheet,
  readCustomAccent,
  readStoredTheme,
  setCustomAccent,
  updateThemeBrowserChrome,
  updateThemeSelectionUI,
} from './themeRuntime.js';

const SETTINGS_TABS = ['profile', 'billing', 'app', 'performance', 'notifications'];
const MANAGEABLE_ACCOUNT_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
]);
let profileCompletenessRoot = null;
let settingsPaneAnimationTimer = 0;
let settingsModalAnimationTimer = 0;
let settingsLastFocus = null;
let themeSelectionRequest = 0;
let settingsPreviewRequestVersion = 0;

const settingsCardPreviewRoot = createHostAwareRoot();
const settingsPreviewProfileCache = createTimedSingleFlightCache({
  ttlMs: 2 * 60 * 1000,
  maxEntries: 1,
});
const settingsPreviewOverlayQuery = window.matchMedia('(max-width: 1180px)');
const settingsPreviewMobileQuery = window.matchMedia('(max-width: 820px)');

const SETTINGS_PANE_ANIMATION_MS = 320;
const SETTINGS_MODAL_ANIMATION_MS = 420;

const safeSetValue = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
};

const safeSetText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? '';
};

const FEATURE_MODE_KEY = 'minimalistMarketingMode';
const FEATURE_MODE_EVENT = 'minimalist:marketing-mode';
const FEATURE_MODE_CLASSES = ['simple-feature-mode', 'power-feature-mode'];

function normalizeFeatureMode(value) {
  return value === 'power' ? 'power' : 'simple';
}

function readFeatureMode() {
  return normalizeFeatureMode(localStorage.getItem(FEATURE_MODE_KEY));
}

function updateFeatureModeUI(mode = readFeatureMode()) {
  const normalized = normalizeFeatureMode(mode);
  document.querySelectorAll('[data-feature-mode-select]').forEach((btn) => {
    const isActive = btn.getAttribute('data-feature-mode-select') === normalized;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const note = document.getElementById('feature-mode-note');
  if (note) {
    note.textContent = normalized === 'power'
      ? 'Power Mode shows tasks, polls, events, wiki, analytics, moderation, integrations, room memory, time capsules, and archives.'
      : 'Simple Mode keeps the app focused on rooms, messages, files, search, and settings.';
  }

  const summary = document.getElementById('feature-mode-summary');
  if (summary) {
    summary.textContent = normalized === 'power'
      ? 'Power Mode is active. All room pages and advanced tools are visible on this device.'
      : 'Simple Mode is active. Advanced room pages are tucked away until you switch back to Power.';
  }
}

function activateChatForFeatureMode() {
  if (typeof window.activateRoomView === 'function') {
    window.activateRoomView('chat');
    return;
  }

  document.querySelectorAll('.room-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-target') === 'chat');
  });
  document.querySelectorAll('.room-view').forEach((view) => view.classList.add('hidden'));
  document.getElementById('room-view-chat')?.classList.remove('hidden');
  window.syncRoomChannelBar?.('chat');

  const messages = document.getElementById('messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function applyFeatureMode(mode = readFeatureMode(), { showToast = false } = {}) {
  const normalized = normalizeFeatureMode(mode);
  localStorage.setItem(FEATURE_MODE_KEY, normalized);
  document.body.classList.remove(...FEATURE_MODE_CLASSES);
  document.body.classList.add(`${normalized}-feature-mode`);
  window.dispatchEvent(new CustomEvent(FEATURE_MODE_EVENT, { detail: { mode: normalized } }));
  updateFeatureModeUI(normalized);

  if (normalized === 'simple') {
    const activeRoomTab = document.querySelector('.room-tab.active');
    const activeTarget = activeRoomTab?.getAttribute('data-target');
    if (activeTarget && activeTarget !== 'chat') {
      activateChatForFeatureMode();
    }
    document.getElementById('room-add-page-menu')?.classList.add('hidden');
    document.getElementById('room-channel-bar')?.classList.add('hidden');
  } else {
    window.syncRoomChannelBar?.();
  }

  if (showToast) {
    window.showToast?.(`${normalized === 'power' ? 'Power' : 'Simple'} Mode enabled.`, false);
  }
}

window.getFeatureMode = readFeatureMode;
window.setFeatureMode = applyFeatureMode;
window.isSimpleFeatureMode = () => readFeatureMode() === 'simple';

applySavedTheme();
applyFeatureMode(readFeatureMode());

document.addEventListener('click', async (event) => {
  const themeButton = event.target?.closest?.('.theme-select-btn');
  if (!themeButton) return;
  const selectedTheme = themeButton.getAttribute('data-theme') || 'light';
  const requestId = ++themeSelectionRequest;
  const themeButtons = [...document.querySelectorAll('.theme-select-btn')];
  themeButtons.forEach((button) => { button.disabled = true; });
  try {
    await ensureThemeStylesheet(selectedTheme);
    if (requestId === themeSelectionRequest) applyTheme(selectedTheme);
  } catch (error) {
    if (requestId === themeSelectionRequest) window.showToast?.(error.message || 'Theme could not be loaded.');
  } finally {
    if (requestId === themeSelectionRequest) {
      themeButtons.forEach((button) => { button.disabled = false; });
    }
  }
});

function updateCustomThemeUI() {
  const colorInput = document.getElementById('custom-accent-color');
  const applyBtn = document.getElementById('apply-custom-theme-btn');
  const resetBtn = document.getElementById('reset-custom-theme-btn');
  const note = document.getElementById('custom-theme-note');
  const currentAccent = readCustomAccent() || window.userThemeColor || DEFAULT_ACCENT_COLOR;

  if (colorInput) {
    colorInput.value = currentAccent;
  }

  if (applyBtn) applyBtn.disabled = false;
  if (resetBtn) resetBtn.disabled = !readCustomAccent();

  if (note) {
    note.textContent = 'Free for everyone — pick any accent color for this device.';
  }
}

function updateProfileSummaryUI() {
  safeSetText('profile-summary-name', window.userProfileName || 'Anonymous');
  safeSetText('profile-summary-status', window.userStatus || '—');
  safeSetText('profile-summary-pronouns', window.userPronouns || '—');
  safeSetText('profile-summary-flair', window.userFlair || '—');
  safeSetText('profile-summary-bio', window.userBio || 'No bio yet.');
}

function isSettingsCardPreviewOpen() {
  const preview = document.getElementById('settings-profile-preview');
  return Boolean(preview && !preview.classList.contains('hidden'));
}

function currentSettingsPreviewUser(uid = window.currentUser?.uid) {
  return {
    uid,
    displayName: window.userProfileName || window.currentUser?.displayName || 'You',
    photoUrl: window.userPhotoUrl || window.currentUser?.photoURL || '',
    pronouns: window.userPronouns || '',
    bio: window.userBio || '',
    themeColor: window.userThemeColor || DEFAULT_ACCENT_COLOR,
    bannerUrl: window.userBannerUrl || '',
    status: window.userStatus || 'Available',
    flair: window.userFlair || '',
    links: Array.isArray(window.userLinks) ? window.userLinks : [],
    shortId: window.userShortId || '',
    skills: window.userSkills || {},
    tier: window.userTier || 'base',
  };
}

function renderSettingsPreviewUser(user = {}) {
  const host = document.getElementById('settings-card-inline-preview');
  if (!host) return false;

  const avatar = user.photoUrl || user.photoURL || window.getAvatarUrl?.(user.displayName, '') || '';
  const bannerStyle = user.bannerUrl
    ? {
        backgroundImage: `url("${encodeURI(user.bannerUrl)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { background: user.themeColor || 'var(--accent-color)' };

  return settingsCardPreviewRoot.render(host, createElement(ProfileCardPreview, {
    user,
    avatar,
    bannerStyle,
    reputation: window.computeRep ? window.computeRep(user) : 0,
    variant: 'settings',
    onCopyLink: async (previewUser) => {
      const uid = previewUser?.uid || window.currentUser?.uid;
      try {
        await navigator.clipboard?.writeText(`${location.origin}/chat?profile=${uid}`);
        window.showToast?.('Profile link copied.', false);
      } catch {
        window.showToast?.('Could not copy the profile link.', true);
      }
    },
    onEdit: () => {
      window.requestAnimationFrame(() => {
        closeSettingsCardPreview({ restoreFocus: false });
        setProfileEditMode(true);
      });
    },
    onOpenFullProfile: () => {
      const uid = user.uid || window.currentUser?.uid;
      window.requestAnimationFrame(() => {
        closeSettingsModal({ restoreFocus: true });
        window.requestAnimationFrame(() => {
          if (typeof window.viewUserProfile !== 'function') {
            window.showToast?.('Profile preview could not be opened.', true);
            return;
          }
          Promise.resolve(window.viewUserProfile(uid)).catch(() => {
            window.showToast?.('Profile preview could not be opened.', true);
          });
        });
      });
    },
  }));
}

function syncSettingsPreviewAccessibility() {
  const content = document.querySelector('#settings-modal .settings-content');
  const sidebar = document.querySelector('#settings-modal .settings-sidebar');
  if (!content || !sidebar) return;
  const previewIsOverlay = isSettingsCardPreviewOpen() && settingsPreviewOverlayQuery.matches;
  const previewIsMobileDetail = isSettingsCardPreviewOpen() && settingsPreviewMobileQuery.matches;
  content.inert = previewIsOverlay;
  if (previewIsOverlay) content.setAttribute('aria-hidden', 'true');
  else content.removeAttribute('aria-hidden');
  sidebar.inert = previewIsMobileDetail;
  if (previewIsMobileDetail) sidebar.setAttribute('aria-hidden', 'true');
  else sidebar.removeAttribute('aria-hidden');
}

async function renderSettingsCardPreview(requestId = settingsPreviewRequestVersion) {
  const preview = document.getElementById('settings-profile-preview');
  const uid = window.currentUser?.uid;
  if (!preview || !uid || !isSettingsCardPreviewOpen()) return;

  const localUser = currentSettingsPreviewUser(uid);
  renderSettingsPreviewUser(localUser);
  preview.setAttribute('aria-busy', 'true');

  try {
    const remoteUser = await settingsPreviewProfileCache.load(uid, async () => {
      const snapshot = await get(ref(db, `users/${uid}`));
      return snapshot.val() || {};
    });
    if (
      requestId !== settingsPreviewRequestVersion
      || !isSettingsCardPreviewOpen()
      || window.currentUser?.uid !== uid
    ) return;
    renderSettingsPreviewUser({ ...localUser, ...remoteUser, uid });
  } catch {
    // The hydrated local profile keeps the preview useful while offline.
  } finally {
    if (requestId === settingsPreviewRequestVersion && isSettingsCardPreviewOpen()) {
      preview.setAttribute('aria-busy', 'false');
    }
  }
}

function openSettingsCardPreview() {
  const preview = document.getElementById('settings-profile-preview');
  const modal = document.getElementById('settings-modal');
  const trigger = document.getElementById('preview-profile-btn');
  if (!preview || !modal || !window.currentUser?.uid) return;

  if (isSettingsCardPreviewOpen()) {
    document.getElementById('close-settings-preview-btn')?.focus({ preventScroll: true });
    return;
  }

  settingsPreviewRequestVersion += 1;
  preview.classList.remove('hidden');
  preview.setAttribute('aria-hidden', 'false');
  preview.setAttribute('aria-busy', 'true');
  modal.classList.add('settings-profile-preview-open');
  trigger?.setAttribute('aria-expanded', 'true');
  syncSettingsPreviewAccessibility();
  void renderSettingsCardPreview(settingsPreviewRequestVersion);
  const requestId = settingsPreviewRequestVersion;
  Promise.resolve(window.ensureCommunityRuntime?.())
    .then(() => {
      if (requestId === settingsPreviewRequestVersion && isSettingsCardPreviewOpen()) {
        void renderSettingsCardPreview(requestId);
      }
    })
    .catch(() => {
      // The base profile remains available if optional community metadata cannot load.
    });
  window.requestAnimationFrame(() => {
    document.getElementById('close-settings-preview-btn')?.focus({ preventScroll: true });
  });
}

function closeSettingsCardPreview({ restoreFocus = true } = {}) {
  settingsPreviewRequestVersion += 1;
  const preview = document.getElementById('settings-profile-preview');
  const modal = document.getElementById('settings-modal');
  const trigger = document.getElementById('preview-profile-btn');

  preview?.classList.add('hidden');
  preview?.setAttribute('aria-hidden', 'true');
  preview?.setAttribute('aria-busy', 'false');
  modal?.classList.remove('settings-profile-preview-open');
  trigger?.setAttribute('aria-expanded', 'false');
  settingsCardPreviewRoot.unmount();
  syncSettingsPreviewAccessibility();

  if (restoreFocus && trigger?.isConnected && isSettingsOpen()) {
    window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  }
}

window.renderSettingsCardPreview = renderSettingsCardPreview;
window.openSettingsCardPreview = openSettingsCardPreview;
window.closeSettingsCardPreview = closeSettingsCardPreview;
window.invalidateSettingsProfilePreview = function invalidateSettingsProfilePreview() {
  const uid = window.currentUser?.uid;
  if (uid) settingsPreviewProfileCache.invalidate(uid);
  settingsPreviewRequestVersion += 1;
  if (isSettingsCardPreviewOpen()) void renderSettingsCardPreview(settingsPreviewRequestVersion);
};

if (typeof settingsPreviewOverlayQuery.addEventListener === 'function') {
  settingsPreviewOverlayQuery.addEventListener('change', syncSettingsPreviewAccessibility);
} else {
  settingsPreviewOverlayQuery.addListener?.(syncSettingsPreviewAccessibility);
}
if (typeof settingsPreviewMobileQuery.addEventListener === 'function') {
  settingsPreviewMobileQuery.addEventListener('change', syncSettingsPreviewAccessibility);
} else {
  settingsPreviewMobileQuery.addListener?.(syncSettingsPreviewAccessibility);
}

function updatePersonalAgentPreferenceUI() {
  applyPersonalAgentPreferences(loadPersonalAgentPreferences());
}

function setProfileEditMode(isEditing) {
  const pane = document.getElementById('pane-profile');
  const editPage = document.getElementById('profile-edit-page');
  const toggleBtn = document.getElementById('toggle-edit-btn');
  const title = document.getElementById('profile-pane-title');
  const description = document.getElementById('profile-pane-description');
  if (!pane || !editPage || !toggleBtn) return;

  if (isEditing && isSettingsCardPreviewOpen()) {
    closeSettingsCardPreview({ restoreFocus: false });
  }

  pane.querySelectorAll('.profile-view-section').forEach((section) => {
    section.classList.toggle('hidden', isEditing);
  });
  editPage.classList.toggle('hidden', !isEditing);
  pane.classList.toggle('profile-editing', isEditing);
  if (title) title.textContent = isEditing ? 'Edit Public Profile' : 'My Account';
  if (description) {
    description.textContent = isEditing
      ? 'Update the details people see when they open your profile.'
      : 'Manage your identity, sign-in details, and public profile.';
  }
  toggleBtn.textContent = 'Edit Profile';
  if (isEditing) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    editPage.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    document.getElementById('edit-display-name')?.focus();
  } else {
    updateProfileSummaryUI();
    if (window.renderProfileCompleteness) window.renderProfileCompleteness();
  }
}

window.setProfileEditMode = setProfileEditMode;

function animateSettingsModal(modalObj) {
  if (!modalObj) return;

  modalObj.classList.remove('settings-modal-enter');
  window.clearTimeout(settingsModalAnimationTimer);

  window.requestAnimationFrame(() => {
    modalObj.classList.add('settings-modal-enter');
    settingsModalAnimationTimer = window.setTimeout(() => {
      modalObj.classList.remove('settings-modal-enter');
    }, SETTINGS_MODAL_ANIMATION_MS);
  });
}

function closeSettingsModal({ restoreFocus = true } = {}) {
  closeSettingsCardPreview({ restoreFocus: false });
  document.getElementById('settings-modal')?.classList.add('hidden');
  document.getElementById('settings-modal')?.setAttribute('aria-hidden', 'true');
  document.getElementById('open-settings-btn')?.setAttribute('aria-expanded', 'false');
  document.getElementById('open-settings-btn-mobile')?.setAttribute('aria-expanded', 'false');
  const profilePopup = document.getElementById('user-profile-popup');
  if (!profilePopup || profilePopup.classList.contains('hidden')) {
    document.getElementById('modal-overlay')?.classList.add('hidden');
  }
  if (restoreFocus && settingsLastFocus && document.contains(settingsLastFocus)) {
    settingsLastFocus.focus();
  }
}

window.closeSettingsModal = closeSettingsModal;

function isSettingsOpen() {
  const modalObj = document.getElementById('settings-modal');
  return Boolean(modalObj && !modalObj.classList.contains('hidden'));
}

function focusSettingsTab(index) {
  const tab = SETTINGS_TABS[index];
  const tabBtn = document.getElementById(`tab-btn-${tab}`);
  if (!tabBtn) return;
  window.switchTab?.(`pane-${tab}`, `tab-btn-${tab}`);
  window.requestAnimationFrame(() => tabBtn.focus());
}

function handleSettingsTabKeydown(event) {
  const currentIndex = SETTINGS_TABS.findIndex((tab) => event.currentTarget?.id === `tab-btn-${tab}`);
  if (currentIndex < 0) return;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    focusSettingsTab(currentIndex);
    return;
  }

  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;

  event.preventDefault();
  const lastIndex = SETTINGS_TABS.length - 1;
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? lastIndex
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? (currentIndex === 0 ? lastIndex : currentIndex - 1)
        : (currentIndex === lastIndex ? 0 : currentIndex + 1);
  focusSettingsTab(nextIndex);
}

function handleSettingsEscape(event) {
  if (!isSettingsOpen() || event.defaultPrevented) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isSettingsCardPreviewOpen()) closeSettingsCardPreview();
    else closeSettingsModal();
    return;
  }

  if (event.key !== 'Tab') return;
  const modal = document.getElementById('settings-modal');
  const focusable = [...(modal?.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) || [])].filter((element) => (
    !element.closest('.hidden, [inert]')
    && element.getClientRects().length > 0
  ));
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function closeSettingsFromBackdrop(event) {
  if (event.target?.id === 'modal-overlay' && isSettingsOpen()) closeSettingsModal();
}

document.getElementById('apply-custom-theme-btn')?.addEventListener('click', () => {
  const color = document.getElementById('custom-accent-color')?.value || DEFAULT_ACCENT_COLOR;
  setCustomAccent(color);
  localStorage.setItem('customAccentColor', color);
  localStorage.setItem('theme', readStoredTheme());
  updateThemeBrowserChrome(readStoredTheme(), color);
  updateCustomThemeUI();
  window.showToast?.('Custom theme applied.', false);
});

document.getElementById('reset-custom-theme-btn')?.addEventListener('click', () => {
  localStorage.removeItem('customAccentColor');
  clearCustomAccent();
  applyTheme(readStoredTheme(), { persist: false });
  updateCustomThemeUI();
  window.showToast?.('Accent color reset.', false);
});

[
  ['desktop', 'personal-ai-desktop-enabled-toggle'],
  ['mobile', 'personal-ai-mobile-enabled-toggle'],
].forEach(([surface, toggleId]) => {
  document.getElementById(toggleId)?.addEventListener('change', (event) => {
    const preferences = savePersonalAgentEnabled(surface, event.currentTarget.checked);
    const enabled = preferences[surface];
    window.showToast?.(`Winston on ${surface} ${enabled ? 'enabled' : 'disabled'} on this device.`, false);
  });
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const modeBtn = target?.closest('[data-feature-mode-select]');
  if (!modeBtn) return;
  applyFeatureMode(modeBtn.getAttribute('data-feature-mode-select'), { showToast: true });
});

window.openSettings = function openSettings() {
  const modalObj = document.getElementById('settings-modal');
  if (!modalObj) {
    window.location.href = '/chat';
    return;
  }

  closeSettingsCardPreview({ restoreFocus: false });
  settingsLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : document.getElementById('open-settings-btn');
  modalObj.setAttribute('role', 'dialog');
  modalObj.setAttribute('aria-modal', 'true');
  modalObj.setAttribute('aria-hidden', 'false');
  modalObj.setAttribute('aria-label', 'Settings');
  modalObj.querySelector('.settings-tablist')?.setAttribute('role', 'tablist');
  modalObj.querySelector('.settings-tablist')?.setAttribute('aria-label', 'Settings sections');
  document.getElementById('open-settings-btn')?.setAttribute('aria-expanded', 'true');
  document.getElementById('open-settings-btn-mobile')?.setAttribute('aria-expanded', 'true');

  safeSetValue('edit-display-name', window.userProfileName);
  safeSetText('settings-display-name-title', window.userProfileName);
  safeSetValue('edit-pronouns', window.userPronouns);
  safeSetValue('edit-bio', window.userBio);
  safeSetValue('edit-theme-color', window.userThemeColor);
  safeSetValue('edit-status', window.userStatus || '');
  safeSetValue('edit-flair', window.userFlair || '');
  safeSetValue('edit-links', window.linksToText ? window.linksToText(window.userLinks) : '');
  safeSetValue('edit-skills', window.skillsToText ? window.skillsToText(window.userSkills) : '');

  if (window.renderProfileCompleteness) window.renderProfileCompleteness();
  updateProfileSummaryUI();
  setProfileEditMode(false);

  const preview = document.getElementById('settings-photo-preview');
  if (preview) preview.src = window.getAvatarUrl(window.userProfileName, window.userPhotoUrl);

  if (window.currentUser) {
    safeSetText('settings-user-email', window.currentUser.email || 'No email on file');
    safeSetText('settings-user-phone', window.userPhone || 'No phone on file');
    const joinDate = new Date(window.currentUser.metadata?.creationTime || Date.now());
    safeSetText(
      'settings-joined-date',
      joinDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    );
  }

  if (typeof window.switchTab === 'function') window.switchTab('pane-profile', 'tab-btn-profile');
  updateCustomThemeUI();
  updateThemeSelectionUI();
  updateFeatureModeUI();
  updatePersonalAgentPreferenceUI();
  window.renderPerformanceSettings?.();
  window.renderNotificationSettings?.();
  window.ensurePhoneNotifyButton?.();

  modalObj.classList.remove('hidden');
  animateSettingsModal(modalObj);
  document.getElementById('modal-overlay')?.classList.remove('hidden');
  window.requestAnimationFrame(() => {
    modalObj.querySelector('.settings-tab.active')?.focus();
  });
};

window.renderProfileCompleteness = function renderProfileCompleteness() {
  const el = document.getElementById('profile-completeness');
  if (!el) return;

  const checks = [
    ['Display name', !!(window.userProfileName && window.userProfileName !== 'Anonymous')],
    ['Avatar', !!window.userPhotoUrl],
    ['Bio', !!(window.userBio && window.userBio !== "I'm new here!")],
    ['Pronouns', !!window.userPronouns],
    ['Status', !!window.userStatus],
    ['Links', Array.isArray(window.userLinks) && window.userLinks.length > 0],
  ];
  const done = checks.filter((check) => check[1]).length;
  const pct = Math.round((done / checks.length) * 100);
  const missing = checks.filter((check) => !check[1]).map((check) => check[0]);

  if (!profileCompletenessRoot) profileCompletenessRoot = createRoot(el);
  profileCompletenessRoot.render(createElement(ProfileCompleteness, {
    percent: pct,
    done,
    total: checks.length,
    missing,
  }));
};

window.switchTab = function switchTab(paneId, btnId) {
  const nextPane = document.getElementById(paneId);
  const nextTab = document.getElementById(btnId);
  const modalObj = document.getElementById('settings-modal');

  if (paneId !== 'pane-profile' && isSettingsCardPreviewOpen()) {
    closeSettingsCardPreview({ restoreFocus: false });
  }

  SETTINGS_TABS.forEach((tab) => {
    const pane = document.getElementById(`pane-${tab}`);
    const tabBtn = document.getElementById(`tab-btn-${tab}`);
    pane?.classList.add('hidden');
    pane?.classList.remove('settings-pane-enter');
    pane?.setAttribute('role', 'tabpanel');
    pane?.setAttribute('aria-labelledby', `tab-btn-${tab}`);
    tabBtn?.classList.remove('active');
    tabBtn?.setAttribute('role', 'tab');
    tabBtn?.setAttribute('aria-selected', 'false');
    tabBtn?.setAttribute('aria-controls', `pane-${tab}`);
    tabBtn?.setAttribute('tabindex', '-1');
  });

  if (nextPane) {
    nextPane.classList.remove('hidden');
    nextPane.classList.remove('settings-pane-enter');
    void nextPane.offsetWidth;
    nextPane.classList.add('settings-pane-enter');
    window.clearTimeout(settingsPaneAnimationTimer);
    settingsPaneAnimationTimer = window.setTimeout(() => {
      nextPane.classList.remove('settings-pane-enter');
    }, SETTINGS_PANE_ANIMATION_MS);
  }

  if (nextTab) {
    nextTab.classList.add('active');
    nextTab.setAttribute('role', 'tab');
    nextTab.setAttribute('aria-selected', 'true');
    nextTab.setAttribute('aria-controls', paneId);
    nextTab.setAttribute('tabindex', '0');
  }

  const settingsContent = modalObj?.querySelector('.settings-content');
  if (typeof settingsContent?.scrollTo === 'function') {
    settingsContent.scrollTo({ top: 0, behavior: 'auto' });
  }

  if (modalObj) {
    modalObj.dataset.activeSettingsPane = paneId.replace(/^pane-/, '');
  }

  if (paneId === 'pane-notifications') {
    window.renderNotificationSettings?.();
    window.ensurePhoneNotifyButton?.();
  }

  if (paneId === 'pane-performance') {
    window.renderPerformanceSettings?.();
  }

  if (paneId === 'pane-billing') {
    window.updateBillingUI?.();
  }
};

window.updateBillingUI = function updateBillingUI() {
  const upgradeAdvancedBtn = document.getElementById('upgrade-advanced-btn');
  const upgradeProBtn = document.getElementById('upgrade-pro-btn');
  const manageBtn = document.getElementById('manage-billing-btn');
  const planName = document.getElementById('billing-plan-name');
  const planLimits = document.getElementById('billing-plan-limits');
  const planBadge = document.getElementById('billing-tier-badge');
  const planStatus = document.getElementById('billing-plan-status');
  const currentPlanCard = document.getElementById('account-current-plan');
  const advancedCard = document.getElementById('account-plan-advanced');
  const proCard = document.getElementById('account-plan-pro');
  const managementNote = document.getElementById('billing-management-note');
  const tier = window.userTier === 'pro' || window.userTier === 'advanced' ? window.userTier : 'base';
  const hasPaidAccountPlan = tier === 'pro' || tier === 'advanced';
  const subscriptionStatus = String(window.accountSubscriptionStatus || '').trim().toLowerCase();
  const canManageAccountSubscription = hasPaidAccountPlan
    || MANAGEABLE_ACCOUNT_SUBSCRIPTION_STATUSES.has(subscriptionStatus);

  if (planName) {
    planName.textContent =
      tier === 'pro'
        ? 'Minimalist Pro'
        : tier === 'advanced'
          ? 'Minimalist Advanced'
          : 'Minimalist Base';
  }

  if (planLimits) {
    planLimits.textContent =
      tier === 'pro'
        ? '3GB per file · 9GB/day · Unlimited rooms · Analytics · Video calls · Screen share system limit'
        : tier === 'advanced'
          ? '700MB per file · 1.5GB/day · 5 rooms · Screen share 1080p/60'
          : '10MB per file · 500MB/day · 3 rooms · Screen share 720p/30';
  }

  if (planBadge) {
    planBadge.textContent = tier === 'pro' ? 'PRO' : tier === 'advanced' ? 'ADVANCED' : 'BASE';
    planBadge.className = `tier-badge ${tier}`;
  }

  if (planStatus) {
    planStatus.textContent = hasPaidAccountPlan
      ? 'Active account subscription · Manage securely in Stripe'
      : canManageAccountSubscription
        ? 'Subscription needs attention · Manage securely in Stripe'
        : 'No paid account subscription';
  }

  if (currentPlanCard) {
    currentPlanCard.dataset.tier = tier;
    currentPlanCard.dataset.subscriptionStatus = subscriptionStatus || 'none';
  }
  [advancedCard, proCard].forEach((card) => {
    if (!card) return;
    const isCurrent = card.dataset.plan === tier;
    card.dataset.current = String(isCurrent);
    if (isCurrent) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
  });

  if (managementNote) {
    managementNote.textContent = canManageAccountSubscription
      ? hasPaidAccountPlan
        ? 'Use the Stripe portal to switch plans, update payment details, view invoices, or cancel. Changes are reflected here automatically.'
        : 'Open Stripe to resolve the subscription status, update payment details, view invoices, switch plans, or cancel.'
      : 'Hosted checkout opens on Stripe. You will review the plan and price before entering payment details.';
  }

  updateCustomThemeUI();

  if (canManageAccountSubscription) {
    if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'none';
    if (upgradeProBtn) upgradeProBtn.style.display = 'none';
    if (manageBtn) manageBtn.style.display = 'inline-flex';
  } else {
    if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'inline-flex';
    if (upgradeProBtn) upgradeProBtn.style.display = 'inline-flex';
    if (manageBtn) manageBtn.style.display = 'none';
  }
};

// Settings is lazy-loaded, so account data may have arrived before this
// updater existed. Reconcile the initially rendered billing panel now, then
// again whenever the Billing tab is selected.
window.updateBillingUI();

document.getElementById('close-settings-btn')?.addEventListener('click', closeSettingsModal);
document.addEventListener('keydown', handleSettingsEscape);
document.getElementById('modal-overlay')?.addEventListener('click', closeSettingsFromBackdrop);

document.getElementById('toggle-edit-btn')?.addEventListener('click', () => {
  const editPage = document.getElementById('profile-edit-page');
  setProfileEditMode(editPage?.classList.contains('hidden'));
});

document.getElementById('cancel-profile-edit-btn')?.addEventListener('click', () => setProfileEditMode(false));
document.getElementById('cancel-profile-edit-inline-btn')?.addEventListener('click', () => setProfileEditMode(false));

document.getElementById('tab-btn-profile')?.addEventListener('click', () => window.switchTab('pane-profile', 'tab-btn-profile'));
document.getElementById('tab-btn-billing')?.addEventListener('click', () => window.switchTab('pane-billing', 'tab-btn-billing'));
document.getElementById('tab-btn-app')?.addEventListener('click', () => window.switchTab('pane-app', 'tab-btn-app'));
document.getElementById('tab-btn-performance')?.addEventListener('click', () => window.switchTab('pane-performance', 'tab-btn-performance'));
document.getElementById('tab-btn-notifications')?.addEventListener('click', () => window.switchTab('pane-notifications', 'tab-btn-notifications'));
SETTINGS_TABS.forEach((tab) => {
  document.getElementById(`tab-btn-${tab}`)?.addEventListener('keydown', handleSettingsTabKeydown);
});

document.getElementById('preview-profile-btn')?.addEventListener('click', openSettingsCardPreview);
document.getElementById('close-settings-preview-btn')?.addEventListener('click', () => closeSettingsCardPreview());
