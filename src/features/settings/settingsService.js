import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ProfileCompleteness } from './SettingsWidgets.jsx';
import {
  DEFAULT_ACCENT_COLOR,
  applySavedTheme,
  applyTheme,
  clearCustomAccent,
  readCustomAccent,
  readStoredTheme,
  setCustomAccent,
  updateThemeBrowserChrome,
  updateThemeSelectionUI,
} from './themeRuntime.js';

const SETTINGS_TABS = ['profile', 'billing', 'app', 'performance', 'notifications'];
let profileCompletenessRoot = null;
let settingsPaneAnimationTimer = 0;
let settingsModalAnimationTimer = 0;

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

document.addEventListener('click', (event) => {
  const themeButton = event.target?.closest?.('.theme-select-btn');
  if (!themeButton) return;
  const selectedTheme = themeButton.getAttribute('data-theme') || 'light';
  applyTheme(selectedTheme);
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

function setProfileEditMode(isEditing) {
  const pane = document.getElementById('pane-profile');
  const editPage = document.getElementById('profile-edit-page');
  const toggleBtn = document.getElementById('toggle-edit-btn');
  const title = document.getElementById('profile-pane-title');
  if (!pane || !editPage || !toggleBtn) return;

  pane.querySelectorAll('.profile-view-section').forEach((section) => {
    section.classList.toggle('hidden', isEditing);
  });
  editPage.classList.toggle('hidden', !isEditing);
  pane.classList.toggle('profile-editing', isEditing);
  if (title) title.textContent = isEditing ? 'Edit Public Profile' : 'My Account';
  toggleBtn.textContent = 'Edit Profile';
  if (isEditing) {
    editPage.scrollIntoView({ block: 'start', behavior: 'smooth' });
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

document.addEventListener('click', (event) => {
  const modeBtn = event.target.closest('[data-feature-mode-select]');
  if (!modeBtn) return;
  applyFeatureMode(modeBtn.getAttribute('data-feature-mode-select'), { showToast: true });
});

window.openSettings = function openSettings() {
  const modalObj = document.getElementById('settings-modal');
  if (!modalObj) {
    window.location.href = '/chat';
    return;
  }

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
    safeSetText('settings-user-email', `Email: ${window.currentUser.email || 'No email on file'}`);
    safeSetText('settings-user-phone', `Phone: ${window.userPhone}`);
    const joinDate = new Date(window.currentUser.metadata.creationTime);
    safeSetText(
      'settings-joined-date',
      `Joined: ${joinDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })}`,
    );
  }

  if (typeof window.switchTab === 'function') window.switchTab('pane-profile', 'tab-btn-profile');
  updateCustomThemeUI();
  updateThemeSelectionUI();
  updateFeatureModeUI();
  window.renderPerformanceSettings?.();
  window.renderNotificationSettings?.();
  window.ensurePhoneNotifyButton?.();

  modalObj.classList.remove('hidden');
  animateSettingsModal(modalObj);
  document.getElementById('modal-overlay')?.classList.remove('hidden');
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

  SETTINGS_TABS.forEach((tab) => {
    const pane = document.getElementById(`pane-${tab}`);
    const tabBtn = document.getElementById(`tab-btn-${tab}`);
    pane?.classList.add('hidden');
    pane?.classList.remove('settings-pane-enter');
    tabBtn?.classList.remove('active');
    tabBtn?.setAttribute('role', 'tab');
    tabBtn?.setAttribute('aria-selected', 'false');
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
};

window.updateBillingUI = function updateBillingUI() {
  const upgradeAdvancedBtn = document.getElementById('upgrade-advanced-btn');
  const upgradeProBtn = document.getElementById('upgrade-pro-btn');
  const manageBtn = document.getElementById('manage-billing-btn');
  const planName = document.getElementById('billing-plan-name');
  const planLimits = document.getElementById('billing-plan-limits');
  const planBadge = document.getElementById('billing-tier-badge');

  if (planName) {
    planName.textContent =
      window.userTier === 'pro'
        ? 'Minimalist Pro'
        : window.userTier === 'advanced'
          ? 'Minimalist Advanced'
          : 'Minimalist Base';
  }

  if (planLimits) {
    planLimits.textContent =
      window.userTier === 'pro'
        ? '3GB per file · 9GB/day · Unlimited rooms · Analytics · Video calls · Screen share system limit'
        : window.userTier === 'advanced'
          ? '700MB per file · 1.5GB/day · 5 rooms · Screen share 1080p/60'
          : '10MB per file · 500MB/day · 3 rooms · Screen share 720p/30';
  }

  if (planBadge) {
    planBadge.textContent = window.userTier === 'pro' ? 'PRO' : window.userTier === 'advanced' ? 'ADVANCED' : 'BASE';
    planBadge.className = `tier-badge ${window.userTier === 'pro' ? 'pro' : window.userTier === 'advanced' ? 'advanced' : 'base'}`;
  }

  updateCustomThemeUI();

  if (window.userTier === 'pro' || window.userTier === 'advanced') {
    if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'none';
    if (upgradeProBtn) upgradeProBtn.style.display = 'none';
    if (manageBtn) manageBtn.style.display = 'block';
  } else {
    if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'block';
    if (upgradeProBtn) upgradeProBtn.style.display = 'block';
    if (manageBtn) manageBtn.style.display = 'none';
  }
};

document.getElementById('close-settings-btn')?.addEventListener('click', () => {
  document.getElementById('settings-modal')?.classList.add('hidden');
  const profilePopup = document.getElementById('user-profile-popup');
  if (!profilePopup || profilePopup.classList.contains('hidden')) {
    document.getElementById('modal-overlay')?.classList.add('hidden');
  }
});

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

document.getElementById('preview-profile-btn')?.addEventListener('click', async (e) => {
  const box = document.getElementById('settings-card-inline-preview');
  const btn = e.currentTarget;
  if (!box) return;

  const show = box.classList.contains('hidden');
  if (show) {
    if (window.renderSettingsCardPreview) await window.renderSettingsCardPreview();
    box.classList.remove('hidden');
    btn.textContent = 'Hide Card';
  } else {
    box.classList.add('hidden');
    btn.textContent = 'Preview Card';
  }
});
