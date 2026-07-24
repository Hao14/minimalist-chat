import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_SOUND_STORAGE_KEY,
  getUiSoundBlockReason,
  playUiSound,
  setUiSoundsEnabled,
  uiSoundsEnabled,
} from '../src/features/audio/uiSoundService.js';

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('app sounds default on and persist an explicit device-level opt out', () => {
  const storage = memoryStorage();
  assert.equal(uiSoundsEnabled(storage), true);
  assert.equal(setUiSoundsEnabled(false, null), false);
  assert.equal(setUiSoundsEnabled(false, storage), true);
  assert.equal(storage.getItem(APP_SOUND_STORAGE_KEY), 'off');
  assert.equal(uiSoundsEnabled(storage), false);
  assert.equal(setUiSoundsEnabled(true, storage), true);
  assert.equal(storage.getItem(APP_SOUND_STORAGE_KEY), null);
});

test('DND and quiet hours block cues while urgent calls may bypass quiet hours only', () => {
  const quietSchedule = JSON.stringify({ enabled: true, start: '22:00', end: '07:00' });
  const now = new Date(2026, 6, 17, 23, 30);
  const quietStorage = memoryStorage({ 'minimalist:notify-schedule': quietSchedule });
  assert.equal(getUiSoundBlockReason({ storage: quietStorage, now }), 'quiet-hours');
  assert.equal(getUiSoundBlockReason({ storage: quietStorage, now, allowDuringQuietHours: true }), '');

  const dndStorage = memoryStorage({
    'minimalist:dnd': 'on',
    'minimalist:notify-schedule': quietSchedule,
  });
  assert.equal(getUiSoundBlockReason({ storage: dndStorage, now, allowDuringQuietHours: true }), 'dnd');
  assert.equal(getUiSoundBlockReason({ storage: memoryStorage({ [APP_SOUND_STORAGE_KEY]: 'off' }), now }), 'disabled');
});

test('the synthesized send cue unlocks once and disconnects its short-lived nodes', async () => {
  let oscillatorCount = 0;
  let disconnectedNodes = 0;

  class FakeAudioContext {
    constructor() {
      this.currentTime = 4;
      this.destination = {};
      this.state = 'suspended';
    }

    async resume() {
      this.state = 'running';
    }

    createOscillator() {
      oscillatorCount += 1;
      let onEnded = null;
      return {
        frequency: {
          exponentialRampToValueAtTime() {},
          setValueAtTime() {},
        },
        addEventListener: (_event, callback) => { onEnded = callback; },
        connect() {},
        disconnect: () => { disconnectedNodes += 1; },
        start() {},
        stop: () => { onEnded?.(); },
        type: 'sine',
      };
    }

    createGain() {
      return {
        gain: {
          exponentialRampToValueAtTime() {},
          setValueAtTime() {},
        },
        connect() {},
        disconnect: () => { disconnectedNodes += 1; },
      };
    }
  }

  globalThis.window = {
    AudioContext: FakeAudioContext,
    localStorage: memoryStorage(),
  };
  try {
    assert.equal(await playUiSound('message-sent', { bypassCooldown: true }), true);
    assert.equal(oscillatorCount, 1);
    assert.equal(disconnectedNodes, 2);
    assert.equal(await playUiSound('not-a-cue'), false);
  } finally {
    delete globalThis.window;
  }
});
