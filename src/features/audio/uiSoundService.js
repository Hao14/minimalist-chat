import { isQuietScheduleActive } from '../notifications/notificationModel.js';

export const APP_SOUND_STORAGE_KEY = 'minimalist:app-sounds';
export const APP_SOUND_PREFERENCE_EVENT = 'minimalist:app-sounds';

const MAX_RECENT_SOUND_KEYS = 120;
const RECENT_SOUND_KEY_TTL_MS = 10_000;
const SOUND_COOLDOWNS_MS = Object.freeze({
  achievement: 900,
  call: 1_000,
  error: 500,
  'message-sent': 90,
  notification: 650,
  preview: 0,
});

const SOUND_PATTERNS = Object.freeze({
  'message-sent': Object.freeze([
    { frequency: 560, endFrequency: 760, duration: 0.105, gain: 0.026, type: 'sine' },
  ]),
  notification: Object.freeze([
    { frequency: 523.25, duration: 0.16, gain: 0.045, type: 'sine' },
    { frequency: 659.25, offset: 0.105, duration: 0.25, gain: 0.042, type: 'sine' },
  ]),
  achievement: Object.freeze([
    { frequency: 523.25, duration: 0.16, gain: 0.04, type: 'triangle' },
    { frequency: 659.25, offset: 0.1, duration: 0.2, gain: 0.043, type: 'triangle' },
    { frequency: 783.99, offset: 0.22, duration: 0.3, gain: 0.046, type: 'triangle' },
  ]),
  call: Object.freeze([
    { frequency: 440, duration: 0.2, gain: 0.044, type: 'sine' },
    { frequency: 587.33, offset: 0.18, duration: 0.32, gain: 0.046, type: 'sine' },
  ]),
  error: Object.freeze([
    { frequency: 220, endFrequency: 155, duration: 0.22, gain: 0.035, type: 'triangle' },
  ]),
  preview: Object.freeze([
    { frequency: 523.25, duration: 0.14, gain: 0.042, type: 'sine' },
    { frequency: 659.25, offset: 0.095, duration: 0.22, gain: 0.04, type: 'sine' },
  ]),
});

let audioContext = null;
let runtimeInstalled = false;
let removeUnlockListeners = null;
const lastPlayedAt = new Map();
const recentSoundKeys = new Map();
const pendingSoundTypes = new Set();

function browserWindow() {
  return typeof window === 'undefined' ? null : window;
}

function browserStorage() {
  try {
    return browserWindow()?.localStorage || null;
  } catch {
    return null;
  }
}

function readStorage(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readQuietSchedule(storage) {
  try {
    return JSON.parse(readStorage(storage, 'minimalist:notify-schedule') || '{}') || {};
  } catch {
    return {};
  }
}

export function uiSoundsEnabled(storage = browserStorage()) {
  return readStorage(storage, APP_SOUND_STORAGE_KEY) !== 'off';
}

export function getUiSoundBlockReason({
  allowDuringQuietHours = false,
  now = new Date(),
  storage = browserStorage(),
} = {}) {
  if (!uiSoundsEnabled(storage)) return 'disabled';
  if (readStorage(storage, 'minimalist:dnd') === 'on') return 'dnd';
  if (!allowDuringQuietHours && isQuietScheduleActive(readQuietSchedule(storage), now)) return 'quiet-hours';
  return '';
}

function suspendAudioContext() {
  if (audioContext?.state !== 'running') return;
  void audioContext.suspend().catch(() => {});
}

export function setUiSoundsEnabled(enabled, storage = browserStorage()) {
  if (!storage) return false;
  try {
    if (enabled) storage.removeItem(APP_SOUND_STORAGE_KEY);
    else storage.setItem(APP_SOUND_STORAGE_KEY, 'off');
  } catch {
    return false;
  }

  if (!enabled) {
    suspendAudioContext();
  } else {
    const context = createAudioContext();
    if (context?.state !== 'running') void context?.resume().catch(() => {});
  }
  const targetWindow = browserWindow();
  targetWindow?.dispatchEvent(new targetWindow.CustomEvent(APP_SOUND_PREFERENCE_EVENT, {
    detail: { enabled: Boolean(enabled) },
  }));
  return true;
}

function createAudioContext() {
  const targetWindow = browserWindow();
  const AudioContextCtor = targetWindow?.AudioContext || targetWindow?.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (audioContext?.state === 'closed') audioContext = null;
  if (audioContext) return audioContext;

  try {
    audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
  } catch {
    try {
      audioContext = new AudioContextCtor();
    } catch {
      audioContext = null;
    }
  }
  return audioContext;
}

function forgetExpiredSoundKeys(now) {
  recentSoundKeys.forEach((playedAt, key) => {
    if (now - playedAt > RECENT_SOUND_KEY_TTL_MS) recentSoundKeys.delete(key);
  });
  while (recentSoundKeys.size > MAX_RECENT_SOUND_KEYS) {
    const oldestKey = recentSoundKeys.keys().next().value;
    if (oldestKey === undefined) break;
    recentSoundKeys.delete(oldestKey);
  }
}

function soundWasRecentlyPlayed(type, dedupeKey, now, bypassCooldown) {
  if (!bypassCooldown && now - Number(lastPlayedAt.get(type) || 0) < (SOUND_COOLDOWNS_MS[type] || 0)) {
    return true;
  }
  if (!dedupeKey) return false;
  forgetExpiredSoundKeys(now);
  return recentSoundKeys.has(`${type}:${dedupeKey}`);
}

function rememberSound(type, dedupeKey, now) {
  lastPlayedAt.set(type, now);
  if (dedupeKey) recentSoundKeys.set(`${type}:${dedupeKey}`, now);
  forgetExpiredSoundKeys(now);
}

function scheduleNote(context, note, startTime) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const noteStart = startTime + Number(note.offset || 0);
  const noteEnd = noteStart + note.duration;
  const attackEnd = Math.min(noteEnd, noteStart + 0.016);

  oscillator.type = note.type || 'sine';
  oscillator.frequency.setValueAtTime(note.frequency, noteStart);
  if (note.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, noteEnd);
  gain.gain.setValueAtTime(0.0001, noteStart);
  gain.gain.exponentialRampToValueAtTime(note.gain, attackEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
  oscillator.start(noteStart);
  oscillator.stop(noteEnd + 0.02);
}

export async function playUiSound(type, {
  allowDuringQuietHours = false,
  bypassCooldown = false,
  dedupeKey = '',
} = {}) {
  const pattern = SOUND_PATTERNS[type];
  if (!pattern || getUiSoundBlockReason({ allowDuringQuietHours })) return false;

  const playedAt = Date.now();
  if (pendingSoundTypes.has(type) || soundWasRecentlyPlayed(type, dedupeKey, playedAt, bypassCooldown)) return false;

  const context = createAudioContext();
  if (!context) return false;
  pendingSoundTypes.add(type);
  try {
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running') return false;
    const startTime = context.currentTime + 0.008;
    pattern.forEach((note) => scheduleNote(context, note, startTime));
    rememberSound(type, dedupeKey, playedAt);
    return true;
  } catch {
    return false;
  } finally {
    pendingSoundTypes.delete(type);
  }
}

export function installUiSoundRuntime() {
  const targetWindow = browserWindow();
  if (!targetWindow || runtimeInstalled) return;
  runtimeInstalled = true;

  const unlock = () => {
    if (!uiSoundsEnabled()) return;
    const context = createAudioContext();
    if (!context) return;
    const finishUnlock = () => {
      if (context.state !== 'running') return;
      removeUnlockListeners?.();
      removeUnlockListeners = null;
    };
    if (context.state === 'running') finishUnlock();
    else void context.resume().then(finishUnlock).catch(() => {});
  };
  removeUnlockListeners = () => {
    targetWindow.removeEventListener('pointerdown', unlock, true);
    targetWindow.removeEventListener('keydown', unlock, true);
  };
  targetWindow.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  targetWindow.addEventListener('keydown', unlock, { capture: true });
  targetWindow.addEventListener('storage', (event) => {
    if (event.key === APP_SOUND_STORAGE_KEY && event.newValue === 'off') suspendAudioContext();
  });
  targetWindow.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    removeUnlockListeners?.();
    removeUnlockListeners = null;
    const closingContext = audioContext;
    audioContext = null;
    if (closingContext && closingContext.state !== 'closed') void closingContext.close().catch(() => {});
  });

  targetWindow.playUiSound = playUiSound;
  targetWindow.playPing = () => playUiSound('notification');
}

installUiSoundRuntime();
