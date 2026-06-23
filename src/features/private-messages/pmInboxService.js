import { onChildAdded, onChildChanged, ref, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';

let blinkInterval = null;
const originalTitle = 'Minimalist | Chat';

window.playPing = function playPing() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const playNote = (frequency, startTime, duration) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = context.currentTime;
    playNote(523.25, now, 0.2);
    playNote(659.25, now + 0.12, 0.4);
  } catch (error) {
    console.debug('Notification sound unavailable', error);
  }
};

window.triggerNotification = function triggerNotification(senderName) {
  window.playPing();
  clearInterval(blinkInterval);
  let isAlt = false;
  blinkInterval = setInterval(() => {
    document.title = isAlt ? originalTitle : `💬 New PM from ${senderName}!`;
    isAlt = !isAlt;
  }, 1000);
};

window.listenForPmInbox = function listenForPmInbox() {
  if (!window.currentUser) return;

  const inboxRef = ref(db, `inbox/${window.currentUser.uid}`);
  const handleInboxUpdate = (snapshot) => {
    const data = snapshot.val();
    if (!data || data.read !== false) return;

    if (window.currentPmTargetUid !== snapshot.key) {
      window.triggerNotification(data.fromName);
      return;
    }

    set(ref(db, `inbox/${window.currentUser.uid}/${snapshot.key}/read`), true);
  };

  onChildAdded(inboxRef, handleInboxUpdate);
  onChildChanged(inboxRef, handleInboxUpdate);
};
