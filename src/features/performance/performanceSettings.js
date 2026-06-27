import { update, ref } from 'firebase/database';
import { auth, db } from '../../lib/firebase.js';

const STORAGE_KEY = 'minimalist:performance-settings';
const EVENT_NAME = 'minimalist:performance-settings';

const MODES = {
  AUTO: 'auto',
  HARDWARE: 'hardware',
  LOW: 'low',
};

const MODE_LABELS = {
  [MODES.AUTO]: 'Auto',
  [MODES.HARDWARE]: 'Hardware',
  [MODES.LOW]: 'Low Performance',
};

const DEFAULTS = {
  mode: MODES.AUTO,
};

const LOW_FPS_THRESHOLD = 45;
const HIGH_FPS_THRESHOLD = 55;
const LOW_FPS_SUSTAINED_SAMPLES = 3;
const HIGH_FPS_SUSTAINED_SAMPLES = 5;
const EFFECT_PIXEL_SOFT_CAP = 3_000_000;
const EFFECT_PIXEL_HARD_CAP = 5_000_000;
const RUNTIME_STYLE_ID = 'minimalist-performance-runtime-styles';

let currentSettings = { ...DEFAULTS };
let latestCapability = null;
let latestComputed = null;
let fpsRaf = 0;
let fpsFrames = 0;
let fpsLast = 0;
let fpsValue = 0;
let lowFpsSamples = 0;
let highFpsSamples = 0;
let longTaskObserver = null;
let latestLongTask = 0;
let lastRenderedEffectiveMode = '';
let autoRuntimeMode = '';

function ensureRuntimePerformanceStyles() {
  if (document.getElementById(RUNTIME_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = RUNTIME_STYLE_ID;
  style.textContent = `
    html.performance-effects-lite *,
    body.performance-effects-lite * {
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
    }

    html.performance-effects-lite .mkt-motion-layer,
    body.performance-effects-lite .mkt-motion-layer,
    html.performance-effects-lite .modern-cursor-light,
    body.performance-effects-lite .modern-cursor-light {
      display: none !important;
    }

    html.performance-low *,
    body.performance-low * {
      scroll-behavior: auto !important;
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function validMode(mode) {
  return Object.values(MODES).includes(mode) ? mode : MODES.AUTO;
}

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
    // Storage can be unavailable in private windows. The live mode still applies.
  }
}

function normalizeSettings(settings = {}) {
  if (typeof settings.mode === 'string') {
    return { mode: validMode(settings.mode) };
  }

  // Backward compatibility for profile/localStorage values saved by the earlier
  // low/hardware/auto toggle UI.
  if (settings.lowPerformanceMode) return { mode: MODES.LOW };
  if (settings.hardwareAccelerationMode) return { mode: MODES.HARDWARE };
  if (settings.autoPerformanceMode) return { mode: MODES.AUTO };

  return { ...DEFAULTS };
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function saveDataEnabled() {
  return Boolean(navigator.connection?.saveData);
}

function isNativeWebView() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

function getViewportPixelProfile() {
  const viewportWidth = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 0));
  const viewportHeight = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 0));
  const devicePixelRatio = Math.max(1, Number(window.devicePixelRatio || 1));
  const viewportArea = viewportWidth * viewportHeight;
  const devicePixelCount = Math.round(viewportArea * devicePixelRatio * devicePixelRatio);
  const effectsOverSoftCap = devicePixelCount >= EFFECT_PIXEL_SOFT_CAP;
  const effectsOverHardCap = devicePixelCount >= EFFECT_PIXEL_HARD_CAP;

  return {
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
    viewportArea,
    devicePixelCount,
    effectsOverSoftCap,
    effectsOverHardCap,
  };
}

function classifyDeviceTier({ memory, cores, reducedMotion, saveData, effectsOverHardCap }) {
  if (reducedMotion || saveData) return 'low';
  if (effectsOverHardCap && ((memory > 0 && memory < 8) || (cores > 0 && cores < 8))) return 'low';
  if ((memory > 0 && memory <= 3) || (cores > 0 && cores <= 4)) return 'low';
  if ((memory >= 8 && cores >= 8) || (!memory && cores >= 8)) return 'high';
  return 'mid';
}

function detectDeviceCapability() {
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const reducedMotion = prefersReducedMotion();
  const saveData = saveDataEnabled();
  const nativeWebView = isNativeWebView();
  const coarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
  const constrainedViewport = Boolean(window.matchMedia?.('(max-width: 480px)')?.matches);
  const pixelProfile = getViewportPixelProfile();
  const tier = classifyDeviceTier({
    memory,
    cores,
    reducedMotion,
    saveData,
    effectsOverHardCap: pixelProfile.effectsOverHardCap,
  });
  const supportsHardwareMode = tier !== 'low' && !reducedMotion && !saveData;

  const reasons = [];
  if (reducedMotion) reasons.push('reduced motion preference');
  if (saveData) reasons.push('data saver');
  if (memory) reasons.push(`${memory}GB memory`);
  if (cores) reasons.push(`${cores} CPU cores`);
  if (nativeWebView) reasons.push('Capacitor WebView');
  if (coarsePointer) reasons.push('touch device');
  if (constrainedViewport) reasons.push('small viewport');
  if (pixelProfile.effectsOverSoftCap) {
    reasons.push(`${(pixelProfile.devicePixelCount / 1_000_000).toFixed(1)}M effective pixels`);
  }

  return {
    memory,
    cores,
    reducedMotion,
    saveData,
    nativeWebView,
    coarsePointer,
    constrainedViewport,
    ...pixelProfile,
    effectsBudget: pixelProfile.effectsOverSoftCap ? 'lite' : 'full',
    tier,
    supportsHardwareMode,
    reasons,
  };
}

function resolveAutoMode(capability = latestCapability || detectDeviceCapability()) {
  if (!capability.supportsHardwareMode) return MODES.LOW;

  if (fpsValue > 0 && lowFpsSamples >= LOW_FPS_SUSTAINED_SAMPLES) {
    autoRuntimeMode = MODES.LOW;
  } else if (highFpsSamples >= HIGH_FPS_SUSTAINED_SAMPLES) {
    autoRuntimeMode = MODES.HARDWARE;
  } else if (!autoRuntimeMode) {
    autoRuntimeMode = MODES.HARDWARE;
  }

  return autoRuntimeMode;
}

function computeSettings(settings = currentSettings) {
  latestCapability = detectDeviceCapability();
  const selectedMode = validMode(settings.mode);
  const effectiveMode = selectedMode === MODES.AUTO ? resolveAutoMode(latestCapability) : selectedMode;
  const autoEffectsLite = selectedMode === MODES.AUTO && latestCapability.effectsOverSoftCap;
  const effectiveLowPerformanceMode = effectiveMode === MODES.LOW || latestCapability.reducedMotion;

  latestComputed = {
    mode: selectedMode,
    effectiveMode,
    effectiveLowPerformanceMode,
    effectsLiteMode: effectiveLowPerformanceMode || autoEffectsLite,
    hardwareAccelerationMode: effectiveMode === MODES.HARDWARE,
    lowPerformanceMode: selectedMode === MODES.LOW,
    autoPerformanceMode: selectedMode === MODES.AUTO,
    reducedMotion: latestCapability.reducedMotion,
    fps: fpsValue,
    longTask: latestLongTask,
    capability: latestCapability,
  };

  return latestComputed;
}

function setElementRuntimeAttributes(element, computed) {
  if (!element) return;

  const effectiveLow = computed.effectiveLowPerformanceMode;
  const effectiveHardware = computed.effectiveMode === MODES.HARDWARE && !effectiveLow;

  ensureRuntimePerformanceStyles();

  element.classList.toggle('performance-auto', computed.mode === MODES.AUTO);
  element.classList.toggle('performance-manual', computed.mode !== MODES.AUTO);
  element.classList.toggle('performance-low', effectiveLow);
  element.classList.toggle('performance-hardware', effectiveHardware);
  element.classList.toggle('performance-gpu', effectiveHardware);
  element.classList.toggle('performance-effects-lite', computed.effectsLiteMode);
  element.classList.toggle('prefers-reduced-motion', computed.reducedMotion);

  element.dataset.performanceMode = computed.mode;
  element.dataset.performanceEffectiveMode = effectiveLow ? MODES.LOW : computed.effectiveMode;
  element.dataset.performanceEffects = computed.effectsLiteMode ? 'lite' : 'full';
  element.dataset.deviceTier = computed.capability.tier;
  element.dataset.devicePixelCount = String(computed.capability.devicePixelCount);
  element.dataset.performanceFps = computed.fps ? String(computed.fps) : 'sampling';
}

function updateRuntimeReadouts(computed = latestComputed) {
  if (!computed) return;

  document.querySelectorAll('[data-performance-runtime-fps]').forEach((node) => {
    node.textContent = computed.fps ? `${computed.fps} fps` : 'Sampling…';
  });

  document.querySelectorAll('[data-performance-runtime-effective]').forEach((node) => {
    node.textContent = MODE_LABELS[computed.effectiveLowPerformanceMode ? MODES.LOW : computed.effectiveMode];
  });

  document.querySelectorAll('[data-performance-runtime-tier]').forEach((node) => {
    node.textContent = computed.capability.tier;
  });
}

function applyRootClasses(settings = currentSettings, { announce = true } = {}) {
  const computed = computeSettings(settings);
  setElementRuntimeAttributes(document.documentElement, computed);
  setElementRuntimeAttributes(document.body, computed);
  updateRuntimeReadouts(computed);

  const nextEffective = computed.effectiveLowPerformanceMode ? MODES.LOW : computed.effectiveMode;
  const modeChanged = nextEffective !== lastRenderedEffectiveMode;
  lastRenderedEffectiveMode = nextEffective;

  window.performanceModeState = computed;
  if (announce) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: computed }));
  }

  if (modeChanged && document.getElementById('performance-settings-root')) {
    renderPerformanceSettings();
  }

  return computed;
}

function serializeForProfile(settings) {
  return {
    mode: validMode(settings.mode),
    // Keep legacy booleans so older clients do not misread the setting.
    lowPerformanceMode: settings.mode === MODES.LOW,
    hardwareAccelerationMode: settings.mode === MODES.HARDWARE,
    autoPerformanceMode: settings.mode === MODES.AUTO,
    updatedAt: Date.now(),
  };
}

async function persistToProfile(settings) {
  const user = window.currentUser || auth.currentUser;
  if (!user?.uid) return;

  try {
    await update(ref(db, `users/${user.uid}/performanceSettings`), serializeForProfile(settings));
  } catch {
    // Performance mode should never block the app if profile sync fails.
  }
}

function setPerformanceMode(mode, options = {}) {
  currentSettings = normalizeSettings({ mode });
  if (currentSettings.mode !== MODES.AUTO) {
    autoRuntimeMode = '';
  }
  safeStorageWrite(currentSettings);
  const computed = applyRootClasses(currentSettings);
  renderPerformanceSettings();

  if (options.persist !== false) {
    void persistToProfile(currentSettings);
  }

  return computed;
}

function setPerformanceSettings(next, options = {}) {
  const normalized = normalizeSettings({ ...currentSettings, ...next });
  return setPerformanceMode(normalized.mode, options);
}

function applyProfilePerformanceSettings(profileSettings) {
  if (profileSettings && typeof profileSettings === 'object') {
    currentSettings = normalizeSettings(profileSettings);
    safeStorageWrite(currentSettings);
  }

  const computed = applyRootClasses(currentSettings);
  renderPerformanceSettings();
  return computed;
}

function getPerformanceSettings() {
  return latestComputed || computeSettings(currentSettings);
}

function modeCardHtml(mode, label, description, icon, meta = '') {
  const computed = getPerformanceSettings();
  const selected = computed.mode === mode;
  const active = (computed.effectiveLowPerformanceMode ? MODES.LOW : computed.effectiveMode) === mode;

  return `
    <button
      class="performance-mode-card ${selected ? 'is-selected' : ''} ${active ? 'is-effective' : ''}"
      type="button"
      role="radio"
      aria-checked="${selected ? 'true' : 'false'}"
      data-performance-mode="${mode}"
    >
      <span class="performance-mode-icon"><i class="ph-bold ${icon}"></i></span>
      <span class="performance-mode-copy">
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(description)}</small>
        ${meta ? `<em>${escapeHtml(meta)}</em>` : ''}
      </span>
      <span class="performance-mode-check" aria-hidden="true"><i class="ph-bold ph-check"></i></span>
    </button>
  `;
}

function diagnosticRows(computed) {
  const { capability } = computed;
  const rows = [
    ['Selected mode', MODE_LABELS[computed.mode]],
    ['Active mode', MODE_LABELS[computed.effectiveLowPerformanceMode ? MODES.LOW : computed.effectiveMode]],
    ['Device tier', capability.tier],
    ['Hardware mode supported', capability.supportsHardwareMode ? 'Yes' : 'No'],
    ['FPS sample', computed.fps ? `${computed.fps} fps` : 'Sampling…'],
    ['CPU cores', capability.cores ? String(capability.cores) : 'Unknown'],
    ['Device memory', capability.memory ? `${capability.memory}GB` : 'Unknown'],
    ['Viewport pixels', `${capability.viewportWidth}×${capability.viewportHeight} @ ${capability.devicePixelRatio}x`],
    ['Effects budget', computed.effectsLiteMode ? 'Lite surfaces' : 'Full surfaces'],
    ['Save-Data', capability.saveData ? 'On' : 'Off'],
    ['Reduced motion', capability.reducedMotion ? 'On' : 'Off'],
    ['Last long task', computed.longTask ? `${Math.round(computed.longTask)}ms` : 'None observed'],
  ];

  return rows.map(([label, value]) => `
    <div class="performance-diagnostic-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');
}

function renderPerformanceSettings() {
  const root = document.getElementById('performance-settings-root');
  if (!root) return;

  const computed = getPerformanceSettings();
  const activeMode = computed.effectiveLowPerformanceMode ? MODES.LOW : computed.effectiveMode;
  const autoCopy = computed.mode === MODES.AUTO
    ? `Auto is currently running ${MODE_LABELS[activeMode]} mode.`
    : 'Manual selection is active. Choose Auto to resume live performance control.';

  root.innerHTML = `
    <section class="performance-hero-card">
      <span class="performance-kicker">Runtime Performance</span>
      <h3>Keep Minimalist smooth on every device.</h3>
      <p>Auto watches device capability and real FPS in the background, then quietly chooses the fastest safe rendering path without refreshing the app.</p>
      <div class="performance-live-pills" aria-label="Live performance status">
        <span><i class="ph-bold ph-gauge"></i><b data-performance-runtime-effective>${escapeHtml(MODE_LABELS[activeMode])}</b></span>
        <span><i class="ph-bold ph-cpu"></i><b data-performance-runtime-tier>${escapeHtml(computed.capability.tier)}</b> tier</span>
        <span><i class="ph-bold ph-monitor-play"></i><b data-performance-runtime-fps>${computed.fps ? `${computed.fps} fps` : 'Sampling…'}</b></span>
      </div>
    </section>

    <section class="performance-mode-picker" role="radiogroup" aria-label="Performance mode">
      ${modeCardHtml(
        MODES.AUTO,
        'Auto',
        'Default. Watches FPS, CPU, memory, Save-Data, and reduced motion. Switches modes without a refresh.',
        'ph-magic-wand',
        autoCopy,
      )}
      ${modeCardHtml(
        MODES.HARDWARE,
        'Hardware',
        'For faster devices. Uses GPU-friendly transform/opacity paths, smooth panels, and richer motion.',
        'ph-graphics-card',
        'Best for desktop, newer iPhone, iPad, and higher-end Android.',
      )}
      ${modeCardHtml(
        MODES.LOW,
        'Low Performance',
        'For older phones or battery saver. Removes heavy blur, shadows, background motion, and non-essential animation.',
        'ph-leaf',
        'Best for low-end Android and jank-sensitive WebViews.',
      )}
    </section>

    <section class="performance-status-card">
      <div>
        <span class="performance-kicker">Current behavior</span>
        <strong>${activeMode === MODES.LOW ? 'Responsiveness is being prioritized.' : 'GPU-friendly polish is active.'}</strong>
      </div>
      <p>${activeMode === MODES.LOW
        ? 'Minimalist will avoid expensive blur, shadow-heavy panels, animated layout shifts, and decorative background motion.'
        : 'Minimalist will keep animations on compositor-friendly transform and opacity paths with layer hints where they help.'}</p>
    </section>

    <section class="performance-diagnostics-card">
      <div class="performance-diagnostics-head">
        <span class="performance-kicker">Live diagnostics</span>
        <button type="button" data-performance-action="refresh-diagnostics">Refresh</button>
      </div>
      ${diagnosticRows(computed)}
    </section>
  `;

  updateRuntimeReadouts(computed);
}

function handlePerformanceClick(event) {
  const modeButton = event.target.closest('[data-performance-mode]');
  if (modeButton) {
    setPerformanceMode(modeButton.getAttribute('data-performance-mode'));
    return;
  }

  const action = event.target.closest('[data-performance-action]')?.getAttribute('data-performance-action');
  if (action === 'refresh-diagnostics') {
    latestCapability = detectDeviceCapability();
    applyRootClasses(currentSettings);
    renderPerformanceSettings();
  }
}

function updateFpsStability(fps) {
  if (fps < LOW_FPS_THRESHOLD) {
    lowFpsSamples += 1;
    highFpsSamples = 0;
    return;
  }

  if (fps > HIGH_FPS_THRESHOLD) {
    highFpsSamples += 1;
    lowFpsSamples = Math.max(0, lowFpsSamples - 1);
    return;
  }

  lowFpsSamples = Math.max(0, lowFpsSamples - 1);
  highFpsSamples = Math.max(0, highFpsSamples - 1);
}

function startFpsMonitor() {
  if (fpsRaf) return;

  const tick = (now) => {
    if (document.visibilityState === 'hidden') {
      fpsLast = now;
      fpsFrames = 0;
      fpsRaf = window.requestAnimationFrame(tick);
      return;
    }

    if (!fpsLast) fpsLast = now;
    fpsFrames += 1;

    if (now - fpsLast >= 1000) {
      fpsValue = Math.round((fpsFrames * 1000) / (now - fpsLast));
      fpsFrames = 0;
      fpsLast = now;
      updateFpsStability(fpsValue);

      applyRootClasses(currentSettings);
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
  if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const newest = entries[entries.length - 1];
      if (!newest) return;

      latestLongTask = newest.duration || 0;
      if (currentSettings.mode === MODES.AUTO && latestLongTask >= 120) {
        lowFpsSamples += 1;
        applyRootClasses(currentSettings);
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

  applyRootClasses(currentSettings, { announce: false });
  startFpsMonitor();
  startLongTaskObserver();

  document.addEventListener('click', handlePerformanceClick);
  window.addEventListener('resize', () => applyRootClasses(currentSettings), { passive: true });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyRootClasses(currentSettings);
  });
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.('change', () => {
    applyRootClasses(currentSettings);
    renderPerformanceSettings();
  });

  window.addEventListener('beforeunload', () => {
    stopFpsMonitor();
    stopLongTaskObserver();
  });

  window.getPerformanceSettings = getPerformanceSettings;
  window.setPerformanceSettings = setPerformanceSettings;
  window.setPerformanceMode = setPerformanceMode;
  window.renderPerformanceSettings = renderPerformanceSettings;
  window.applyPerformanceSettingsFromProfile = applyProfilePerformanceSettings;
}

initPerformanceSettings();

export {
  MODES,
  applyProfilePerformanceSettings,
  getPerformanceSettings,
  renderPerformanceSettings,
  setPerformanceMode,
  setPerformanceSettings,
};
