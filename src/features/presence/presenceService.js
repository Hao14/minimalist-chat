import { onDisconnect, onValue, ref, serverTimestamp, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';

let presenceStarted = false;

window.initializePresence = function initializePresence() {
  if (!window.currentUser || presenceStarted) return;
  presenceStarted = true;

  const myPresenceRef = ref(db, `presence/${window.currentUser.uid}`);
  onValue(ref(db, '.info/connected'), (snapshot) => {
    if (snapshot.val() !== true) return;
    onDisconnect(myPresenceRef)
      .set({ state: 'offline', lastChanged: serverTimestamp() })
      .then(() => {
        set(myPresenceRef, { state: 'online', lastChanged: serverTimestamp() });
      });
  });

  document.addEventListener('visibilitychange', () => {
    set(myPresenceRef, {
      state: document.visibilityState === 'visible' ? 'online' : 'offline',
      lastChanged: serverTimestamp(),
    });
  });
};
