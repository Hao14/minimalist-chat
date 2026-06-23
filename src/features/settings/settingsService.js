const SETTINGS_TABS = ['profile', 'billing', 'app'];

const safeSetValue = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
};

const safeSetText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? '';
};

const DEFAULT_ACCENT_COLOR = '#FFD700';
const THEME_CLASSES = ['dark-mode', 'gray-mode', 'modern-mode'];

function setCustomAccent(color) {
  document.documentElement.style.setProperty('--accent-color', color);
  document.body.style.setProperty('--accent-color', color);
}

function clearCustomAccent() {
  document.documentElement.style.removeProperty('--accent-color');
  document.body.style.removeProperty('--accent-color');
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.classList.remove(...THEME_CLASSES);
  if (savedTheme !== 'light') document.body.classList.add(`${savedTheme}-mode`);
  const customAccent = localStorage.getItem('customAccentColor');
  clearCustomAccent();
  if (customAccent) setCustomAccent(customAccent);
}

applySavedTheme();

document.querySelectorAll('.theme-select-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const selectedTheme = e.currentTarget.getAttribute('data-theme') || 'light';
    document.body.classList.remove(...THEME_CLASSES);
    if (selectedTheme !== 'light') document.body.classList.add(`${selectedTheme}-mode`);
    localStorage.setItem('theme', selectedTheme);
  });
});

function updateCustomThemeUI() {
  const colorInput = document.getElementById('custom-accent-color');
  const applyBtn = document.getElementById('apply-custom-theme-btn');
  const resetBtn = document.getElementById('reset-custom-theme-btn');
  const note = document.getElementById('custom-theme-note');
  const currentAccent = localStorage.getItem('customAccentColor') || window.userThemeColor || DEFAULT_ACCENT_COLOR;

  if (colorInput) {
    colorInput.value = currentAccent;
  }

  if (applyBtn) applyBtn.disabled = false;
  if (resetBtn) resetBtn.disabled = !localStorage.getItem('customAccentColor');

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

document.getElementById('apply-custom-theme-btn')?.addEventListener('click', () => {
  const color = document.getElementById('custom-accent-color')?.value || DEFAULT_ACCENT_COLOR;
  setCustomAccent(color);
  localStorage.setItem('customAccentColor', color);
  localStorage.setItem('theme', localStorage.getItem('theme') || 'light');
  updateCustomThemeUI();
  window.showToast?.('Custom theme applied.', false);
});

document.getElementById('reset-custom-theme-btn')?.addEventListener('click', () => {
  localStorage.removeItem('customAccentColor');
  clearCustomAccent();
  applySavedTheme();
  updateCustomThemeUI();
  window.showToast?.('Accent color reset.', false);
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

  modalObj.classList.remove('hidden');
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

  el.innerHTML = `
    <div class="pc-row"><span>Profile ${pct}% complete</span><span class="pc-count">${done}/${checks.length}</span></div>
    <div class="pc-bar"><div class="pc-fill" style="width:${pct}%"></div></div>
    ${
      missing.length
        ? `<div class="pc-missing">Add: ${missing.join(', ')}</div>`
        : '<div class="pc-missing pc-done">All set! 🎉</div>'
    }`;
};

window.switchTab = function switchTab(paneId, btnId) {
  SETTINGS_TABS.forEach((tab) => {
    document.getElementById(`pane-${tab}`)?.classList.add('hidden');
    document.getElementById(`tab-btn-${tab}`)?.classList.remove('active');
  });
  document.getElementById(paneId)?.classList.remove('hidden');
  document.getElementById(btnId)?.classList.add('active');
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
        ? '3GB per file · 9GB/day · Unlimited rooms · Analytics · Video calls'
        : window.userTier === 'advanced'
          ? '700MB per file · 1.5GB/day · 5 rooms'
          : '10MB per file · 500MB/day · 3 rooms';
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
