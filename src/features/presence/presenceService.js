import { onDisconnect, onValue, ref, serverTimestamp, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { setDatabaseConnectionState } from '../../lib/databaseConnection.js';

let presenceUid = null;
let presenceRef = null;
let disconnectHandle = null;
let stopConnectionListener = null;
let visibilityHandler = null;
let presenceVersion = 0;

function presencePayload(state) {
  return { state, lastChanged: serverTimestamp() };
}

window.stopPresence = function stopPresence({ keepDisconnect = false, markOffline = false } = {}) {
  const previousRef = presenceRef;
  const previousDisconnect = disconnectHandle;
  presenceVersion += 1;

  stopConnectionListener?.();
  stopConnectionListener = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;

  if (!keepDisconnect) previousDisconnect?.cancel().catch(() => {});
  if (markOffline && previousRef) set(previousRef, presencePayload('offline')).catch(() => {});

  presenceUid = null;
  presenceRef = null;
  disconnectHandle = null;
  setDatabaseConnectionState('offline');
};

window.initializePresence = function initializePresence() {
  const uid = window.currentUser?.uid;
  if (!uid) {
    window.stopPresence();
    return;
  }
  if (presenceUid === uid && stopConnectionListener) return;
  if (presenceUid) window.stopPresence({ markOffline: true });

  presenceUid = uid;
  const version = ++presenceVersion;
  presenceRef = ref(db, `presence/${uid}`);
  disconnectHandle = onDisconnect(presenceRef);
  setDatabaseConnectionState('connecting');

  stopConnectionListener = onValue(ref(db, '.info/connected'), (snapshot) => {
    if (version !== presenceVersion || presenceUid !== uid || window.currentUser?.uid !== uid) return;
    const isConnected = snapshot.val() === true;
    setDatabaseConnectionState(isConnected ? 'online' : 'offline');
    if (!isConnected) return;
    disconnectHandle
      .set(presencePayload('offline'))
      .then(() => {
        if (version !== presenceVersion || presenceUid !== uid || window.currentUser?.uid !== uid) return;
        return set(presenceRef, presencePayload(document.hidden ? 'offline' : 'online'));
      })
      .catch(() => {});
  });

  visibilityHandler = () => {
    if (version !== presenceVersion || presenceUid !== uid || window.currentUser?.uid !== uid) return;
    set(presenceRef, presencePayload(document.hidden ? 'offline' : 'online')).catch(() => {});
  };
  document.addEventListener('visibilitychange', visibilityHandler);
};

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  window.stopPresence?.({ keepDisconnect: true, markOffline: true });
});
