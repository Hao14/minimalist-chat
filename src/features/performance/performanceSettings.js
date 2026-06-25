import { update, ref } from 'firebase/database';
import { auth, db } from '../../lib/firebase.js';

const STORAGE_KEY = 'minimalist:performance-settings';
const EVENT_NAME = 'minimalist:performance-settings';

const DEFAULTS = {
  lowPerformanceMode: false,
  hardwareAccelerationMode: false,
  autoPerformanceMode: false,
};

let currentSettings = {
  ...DEFAULTS,
};

let latestAssessment = null;
let fpsValue = 0;
let fpsRaf = 0;
let fpsFrames = 0;
let fpsLast = 0;
let longTaskObserver = null;
let latestLongTask = 0;

const isDevDiagnosticsHost = () => {
  const host = window.location?.hostname || '';
  return Boolean(import.meta.env?.DEV || ['localhost', '127.0.0.1', '::1'].includes(host));
};

function safeStorageRead() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeStorageWrite(settings) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be disabled in private windows. Root classes still apply.
  }
}

function normalizeSettings(settings = {}) {
  return {
    lowPerformanceMode: Boolean(settings.lowPerformanceMode),
    hardwareAccelerationMode: Boolean(settings.hardwareAccelerationMode),
    autoPerformanceMode: Boolean(settings.autoPerformanceMode),
  };
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function saveDataEnabled() {
  return Boolean(navigator.connection?.saveData);
}

function viewportLooksConstrained() {
  return Boolean(window.matchMedia?.('(max-width: 430px)')?.matches);
}

function detectDevicePerformance() {
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const reducedMotion = prefersReducedMotion();
  const saveData = saveDataEnabled();
  const constrainedViewport = viewportLooksConstrained();
  const lowMemory = memory > 0 && memory <= 4;
  const lowCoreCount = cores > 0 && cores <= 4;
  const lowFps = fpsValue > 0 && fpsValue < 42;

  const reasons = [];
  if (reducedMotion) reasons.push('reduced motion preference');
  if (saveData) reasons.push('data saver');
  if (lowMemory) reasons.push(`${memory}GB device memory`);
  if (lowCoreCount) reasons.push(`${cores} CPU cores`);
  if (constrainedViewport && (lowMemory || lowCoreCount)) reasons.push('small mobile viewport');
  if (lowFps) reasons.push(`${fpsValue}fps during animation sampling`);

  return {
    memory,
    cores,
    reducedMotion,
    saveData,
    constrainedViewport,
    lowMemory,
    lowCoreCount,
    lowFps,
    shouldRecommendLowMode: reasons.length > 0,
    reasons,
  };
}

function computedSettings(settings = currentSettings) {
  latestAssessment = detectDevicePerformance();
  const reducedMotion = latestAssessment.reducedMotion;
  const effectiveLowPerformanceMode = Boolean(
    settings.lowPerformanceMode || reducedMotion || (settings.autoPerformanceMode && latestAssessment.shouldRecommendLowMode),
  );

  return {
    ...settings,
    reducedMotion,
    effectiveLowPerformanceMode,
    assessment: latestAssessment,
  };
}

function applyRootClasses(settings = currentSettings) {
  const computed = computedSettings(settings);
  const root = document.documentElement;
  root.classList.toggle('performance-low', computed.effectiveLowPerformanceMode);
  root.classList.toggle('performance-gpu', Boolean(settings.hardwareAccelerationMode) && !computed.effectiveLowPerformanceMode);
  root.classList.toggle('prefers-reduced-motion', computed.reducedMotion);

  if (document.body) {
    document.body.classList.toggle('performance-low', computed.effectiveLowPerformanceMode);
    document.body.classList.toggle('performance-gpu', Boolean(settings.hardwareAccelerationMode) && !computed.effectiveLowPerformanceMode);
    document.body.classList.toggle('prefers-reduced-motion', computed.reducedMotion);
  }

  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: computed }));
  return computed;
}

async function persistToProfile(settings) {
  const user = window.currentUser || auth.currentUser;
  if (!user?.uid) return;

  try {
    await update(ref(db, `users/${user.uid}/performanceSettings`), {
      ...normalizeSettings(settings),
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.warn('Performance settings profile sync failed', error);
  }
}

function setPerformanceSettings(next, options = {}) {
  currentSettings = normalizeSettings({ ...currentSettings, ...next });
  safeStorageWrite(currentSettings);
  const computed = applyRootClasses(currentSettings);
  renderPerformanceSettings();

  if (options.persist !== false) {
    void persistToProfile(currentSettings);
  }

  return computed;
}

function applyProfilePerformanceSettings(profileSettings) {
  if (!profileSettings || typeof profileSettings !== 'object') {
    applyRootClasses(currentSettings);
    renderPerformanceSettings();
    return computedSettings(currentSettings);
  }

  currentSettings = normalizeSettings({
    ...currentSettings,
    ...profileSettings,
  });
  safeStorageWrite(currentSettings);
  const computed = applyRootClasses(currentSettings);
  renderPerformanceSettings();
  return computed;
}

function getPerformanceSettings() {
  return computedSettings(currentSettings);
}

function toggleLabelHtml(id, label, description, checked, icon) {
  return `
    <button class="performance-toggle-card ${checked ? 'is-on' : ''}" type="button" role="switch" aria-checked="${checked ? 'true' : 'false'}" data-performance-toggle="${id}">
      <span class="performance-toggle-icon"><i class="ph-bold ${icon}"></i></span>
      <span class="performance-toggle-copy">
        <strong>${label}</strong>
        <small>${description}</small>
      </span>
      <span class="performance-switch" aria-hidden="true"><span></span></span>
    </button>
  `;
}

function diagnosticRows(computed) {
  const { assessment } = computed;
  return [
    ['Mode', computed.effectiveLowPerformanceMode ? 'Low effects active' : 'Full visual polish'],
    ['GPU hints', computed.hardwareAccelerationMode && !computed.effectiveLowPerformanceMode ? 'Enabled' : 'Off'],
    ['Reduced motion', assessment.reducedMotion ? 'Yes' : 'No'],
    ['Device memory', assessment.memory ? `${assessment.memory}GB` : 'Unknown'],
    ['CPU cores', assessment.cores ? String(assessment.cores) : 'Unknown'],
    ['Save-Data', assessment.saveData ? 'On' : 'Off'],
    ['Viewport', `${window.innerWidth} × ${window.innerHeight}`],
    ['FPS sample', fpsValue ? `${fpsValue} fps` : 'Sampling…'],
    ['Last long task', latestLongTask ? `${Math.round(latestLongTask)}ms` : 'None observed'],
  ].map(([label, value]) => `
    <div class="performance-diagnostic-row">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');
}

function renderPerformanceSettings() {
  const root = document.getElementById('performance-settings-root');
  if (!root) return;

  const computed = getPerformanceSettings();
  const { assessment } = computed;
  const showSuggestion = !computed.lowPerformanceMode && assessment.shouldRecommendLowMode;
  const dev = isDevDiagnosticsHost();

  root.innerHTML = `
    <section class="performance-hero-card">
      <span class="performance-kicker">Runtime preferences</span>
      <h3>Make Minimalist feel fast on this device.</h3>
      <p>Choose how much motion and visual depth the app should use. Changes apply immediately and sync to your profile when you are signed in.</p>
    </section>

    ${showSuggestion ? `
      <section class="performance-suggestion" role="status">
        <i class="ph-bold ph-gauge"></i>
        <div>
          <strong>Your device may perform better with Low Performance Mode.</strong>
          <span>${assessment.reasons.join(' · ') || 'This device looks constrained.'}</span>
        </div>
        <button type="button" data-performance-action="enable-low">Use low mode</button>
      </section>
    ` : ''}

    <section class="performance-toggle-list" aria-label="Performance preferences">
      ${toggleLabelHtml(
        'lowPerformanceMode',
        'Low Performance Mode',
        'Reduce animations, visual effects, blur, background motion, and extra activity for older phones or tablets.',
        computed.lowPerformanceMode,
        'ph-leaf',
      )}
      ${toggleLabelHtml(
        'hardwareAccelerationMode',
        'Hardware Acceleration Mode',
        'Use app-level GPU-friendly animation paths for modals, drawers, chat panels, and floating cards.',
        computed.hardwareAccelerationMode,
        'ph-graphics-card',
      )}
      ${toggleLabelHtml(
        'autoPerformanceMode',
        'Auto Performance Mode',
        'Automatically reduce effects when this device appears slower, battery constrained, or asks for reduced motion.',
        computed.autoPerformanceMode,
        'ph-magic-wand',
      )}
    </section>

    <section class="performance-status-card">
      <div>
        <span class="performance-kicker">Current behavior</span>
        <strong>${computed.effectiveLowPerformanceMode ? 'Reduced effects are active.' : 'Full visual polish is active.'}</strong>
      </div>
      <p>${computed.effectiveLowPerformanceMode
        ? 'Heavy blur, decorative gradients, offscreen motion, and message animations are toned down.'
        : 'Animated panels, polished transitions, and richer visual effects remain enabled.'}</p>
    </section>

    ${dev ? `
      <section class="performance-diagnostics-card">
        <div class="performance-diagnostics-head">
          <span class="performance-kicker">Developer diagnostics</span>
          <button type="button" data-performance-action="refresh-diagnostics">Refresh</button>
        </div>
        ${diagnosticRows(computed)}
      </section>
    ` : ''}
  `;

  if (dev) startFpsMonitor();
}

function handlePerformanceClick(event) {
  const toggle = event.target.closest('[data-performance-toggle]');
  if (toggle) {
    const key = toggle.getAttribute('data-performance-toggle');
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
    setPerformanceSettings({ [key]: !currentSettings[key] });
    return;
  }

  const action = event.target.closest('[data-performance-action]')?.getAttribute('data-performance-action');
  if (action === 'enable-low') {
    setPerformanceSettings({ lowPerformanceMode: true, autoPerformanceMode: true });
  } else if (action === 'refresh-diagnostics') {
    latestAssessment = detectDevicePerformance();
    renderPerformanceSettings();
  }
}

function startFpsMonitor() {
  if (fpsRaf || !isDevDiagnosticsHost()) return;

  const tick = (now) => {
    if (!fpsLast) fpsLast = now;
    fpsFrames += 1;

    if (now - fpsLast >= 1000) {
      fpsValue = Math.round((fpsFrames * 1000) / (now - fpsLast));
      fpsFrames = 0;
      fpsLast = now;
      if (document.getElementById('performance-settings-root')) renderPerformanceSettings();
    }

    fpsRaf = window.requestAnimationFrame(tick);
  };

  fpsRaf = window.requestAnimationFrame(tick);
}

function stopFpsMonitor() {
  if (!fpsRaf) return;
  window.cancelAnimationFrame(fpsRaf);
  fpsRaf = 0;
  fpsFrames = 0;
  fpsLast = 0;
}

function startLongTaskObserver() {
  if (!isDevDiagnosticsHost() || longTaskObserver || typeof PerformanceObserver === 'undefined') return;

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const newest = entries[entries.length - 1];
      if (!newest) return;
      latestLongTask = newest.duration || 0;
      if (latestLongTask > 80) {
        console.debug('[Minimalist performance] Long task observed:', Math.round(latestLongTask), 'ms');
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    longTaskObserver = null;
  }
}

function stopLongTaskObserver() {
  longTaskObserver?.disconnect?.();
  longTaskObserver = null;
}

function initPerformanceSettings() {
  currentSettings = normalizeSettings({
    ...DEFAULTS,
    ...safeStorageRead(),
  });

  applyRootClasses(currentSettings);

  document.addEventListener('click', handlePerformanceClick);
  window.addEventListener('resize', () => applyRootClasses(currentSettings), { passive: true });
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.('change', () => {
    applyRootClasses(currentSettings);
    renderPerformanceSettings();
  });

  startLongTaskObserver();

  window.addEventListener('beforeunload', () => {
    stopFpsMonitor();
    stopLongTaskObserver();
  });

  window.getPerformanceSettings = getPerformanceSettings;
  window.setPerformanceSettings = setPerformanceSettings;
  window.renderPerformanceSettings = renderPerformanceSettings;
  window.applyPerformanceSettingsFromProfile = applyProfilePerformanceSettings;
}

initPerformanceSettings();

export {
  applyProfilePerformanceSettings,
  getPerformanceSettings,
  renderPerformanceSettings,
  setPerformanceSettings,
};
