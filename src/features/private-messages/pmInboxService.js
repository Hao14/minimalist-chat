import { onChildAdded, onChildChanged, onValue, ref, set } from 'firebase/database';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app, db } from '../../lib/firebase.js';

let blinkInterval = null;
let audioContext = null;
let inboxUnsubscribe = null;
let listeningUid = null;
let listenerStartedAt = 0;
let latestUnreadCount = 0;
let latestInbox = {};
const originalTitle = 'Minimalist | Chat';
const notifiedInboxEvents = new Set();
const unreadRailTargets = [
  'open-contacts-btn',
  'open-contacts-btn-mobile',
  'open-updates-btn-desktop',
  'open-updates-btn-mobile',
];

function notificationSupported() {
  return typeof window.Notification !== 'undefined';
}

function phoneAlertsEnabled() {
  return localStorage.getItem('minimalist:phone-notifications') === 'enabled';
}

function cleanSnippet(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Open Minimalist to reply.';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function updateContactUnreadDots(inbox = {}) {
  document.querySelectorAll('.unread-indicator').forEach((dot) => {
    dot.classList.remove('unread-ping');
    dot.removeAttribute('title');
    delete dot.dataset.unreadFrom;
  });
  Object.entries(inbox).forEach(([targetUid, data]) => {
    const dot = document.getElementById(`dot-${targetUid}`);
    if (!dot) return;
    const hasUnread = data?.read === false;
    dot.classList.toggle('unread-ping', hasUnread);
    if (hasUnread) {
      dot.dataset.unreadFrom = data?.fromName || 'Someone';
      dot.title = `New PM from ${data?.fromName || 'Someone'}`;
    }
  });
}

function updateNativeAppBadge(count) {
  try {
    if (count > 0 && navigator.setAppBadge) {
      navigator.setAppBadge(count);
      return;
    }
    if (count === 0 && navigator.clearAppBadge) navigator.clearAppBadge();
  } catch {
    // App badges are best-effort and vary heavily by browser/platform.
  }
}

function clearTitleAlert() {
  clearInterval(blinkInterval);
  blinkInterval = null;
  if (document.title.includes('New PM from')) document.title = originalTitle;
}

window.updatePmUnreadBadge = function updatePmUnreadBadge(count, inbox = null) {
  latestUnreadCount = count;
  if (inbox) {
    latestInbox = inbox;
    window.latestPmInbox = inbox;
  }
  const label = count > 9 ? '9+' : String(count);
  unreadRailTargets.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('has-unread', count > 0);
    if (count > 0) {
      el.dataset.unreadCount = label;
      el.setAttribute('aria-label', `${el.title || 'Updates'} (${count} unread PM${count === 1 ? '' : 's'})`);
    } else {
      delete el.dataset.unreadCount;
      el.removeAttribute('aria-label');
    }
  });

  if (inbox) updateContactUnreadDots(inbox);
  updateNativeAppBadge(count);
  if (count === 0) clearTitleAlert();
};

window.refreshContactUnreadDots = function refreshContactUnreadDots() {
  updateContactUnreadDots(latestInbox || {});
};

async function openPmFromNotification(payload = {}) {
  const targetUid = payload.targetUid || payload.pmTargetUid;
  const targetName = payload.targetName || payload.pmTargetName || payload.fromName || 'User';
  if (!targetUid) return;
  window.focus?.();
  window.openPrivateChat?.(targetUid, targetName);
  document.getElementById('updates-panel')?.classList.remove('open');
}

async function sendBrowserPmNotification(senderName, data = {}, senderUid = '') {
  if (!phoneAlertsEnabled() || !notificationSupported() || window.Notification.permission !== 'granted') return;

  const payload = {
    type: 'minimalist-open-pm',
    targetUid: senderUid,
    targetName: senderName || 'User',
    fromName: senderName || 'Someone',
  };
  const title = `New PM from ${senderName || 'Someone'}`;
  const options = {
    body: cleanSnippet(data.lastText),
    tag: `minimalist-pm-${senderUid || 'unknown'}`,
    renotify: true,
    data: payload,
  };

  try {
    if (navigator.serviceWorker?.ready) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return;
    }

    const notification = new window.Notification(title, options);
    notification.onclick = () => {
      notification.close();
      openPmFromNotification(payload);
    };
  } catch (error) {
    console.debug('Browser notification unavailable', error);
  }
}

function updatePhoneNotifyButton() {
  const button = document.getElementById('enable-phone-notifications-btn');
  if (!button) return;

  const supported = notificationSupported();
  const permission = supported ? window.Notification.permission : 'unsupported';
  const enabled = phoneAlertsEnabled() && permission === 'granted';
  const hasFcmKey = Boolean(String(window.FCM_VAPID_KEY || '').trim());

  button.classList.toggle('enabled', enabled);
  button.disabled = !supported || permission === 'denied';
  button.title = !supported
    ? 'This browser does not support web notifications.'
    : permission === 'denied'
      ? 'Notifications are blocked in this browser.'
      : enabled
        ? hasFcmKey
          ? 'Phone push alerts are enabled on this device.'
          : 'Browser alerts are enabled. Add FCM_VAPID_KEY for closed-app phone push.'
        : 'Enable phone/browser alerts for new PMs.';
  const icon = document.createElement('i');
  icon.className = enabled ? 'ph-bold ph-device-mobile' : 'ph-bold ph-device-mobile-camera';
  const label = document.createElement('span');
  label.textContent = enabled ? 'Phone alerts on' : 'Phone alerts';
  button.replaceChildren(icon, label);
}

function pushTokenKey(token) {
  return token.replace(/[.#$/[\]]/g, '_');
}

async function syncFirebasePushToken() {
  const vapidKey = String(window.FCM_VAPID_KEY || '').trim();
  if (!vapidKey || !window.currentUser || !navigator.serviceWorker) return false;

  try {
    const supported = await isSupported();
    if (!supported) return false;

    const registration = await navigator.serviceWorker.ready;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) return false;
    await set(ref(db, `push_tokens/${window.currentUser.uid}/${pushTokenKey(token)}`), {
      token,
      updatedAt: Date.now(),
      userAgent: navigator.userAgent.slice(0, 180),
      platform: navigator.platform || '',
    });

    return true;
  } catch (error) {
    console.debug('Firebase push token sync failed', error);
    return false;
  }
}

function ensurePhoneNotifyButton() {
  const slot = document.getElementById('notification-phone-alerts-slot');
  let button = document.getElementById('enable-phone-notifications-btn');

  if (!slot) {
    updatePhoneNotifyButton();
    return;
  }

  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'enable-phone-notifications-btn';
    button.className = 'phone-notify-btn';
  }

  if (button.parentElement !== slot) slot.appendChild(button);
  updatePhoneNotifyButton();
}

window.ensurePhoneNotifyButton = ensurePhoneNotifyButton;

window.requestPhoneNotifications = async function requestPhoneNotifications() {
  if (!notificationSupported()) {
    window.showToast?.('This browser does not support phone/browser notifications yet.');
    updatePhoneNotifyButton();
    return false;
  }

  try {
    const permission = window.Notification.permission === 'granted'
      ? 'granted'
      : await window.Notification.requestPermission();

    if (permission !== 'granted') {
      localStorage.removeItem('minimalist:phone-notifications');
      window.showToast?.('Notifications were not enabled. You can allow them in browser settings.');
      updatePhoneNotifyButton();
      return false;
    }

    localStorage.setItem('minimalist:phone-notifications', 'enabled');
    const pushReady = await syncFirebasePushToken();
    updatePhoneNotifyButton();
    if (latestUnreadCount > 0) updateNativeAppBadge(latestUnreadCount);
    window.showToast?.(
      pushReady
        ? 'Phone PM push alerts are enabled for this device.'
        : 'Browser/PWA PM alerts are enabled. Add a Firebase VAPID key for closed-app phone push.',
      false,
    );
    return true;
  } catch (error) {
    window.showToast?.(`Could not enable notifications: ${error.message || error}`);
    updatePhoneNotifyButton();
    return false;
  }
};

window.playPing = async function playPing() {
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audioContext ||= new AudioCtor();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const context = audioContext;
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
    playNote(523.25, now, 0.18);
    playNote(659.25, now + 0.11, 0.32);
  } catch (error) {
    console.debug('Notification sound unavailable', error);
  }
};

window.triggerNotification = function triggerNotification(senderName, data = {}, senderUid = '') {
  window.playPing();
  sendBrowserPmNotification(senderName, data, senderUid);
  clearInterval(blinkInterval);
  let isAlt = false;
  blinkInterval = setInterval(() => {
    document.title = isAlt ? originalTitle : `💬 New PM from ${senderName}!`;
    isAlt = !isAlt;
  }, 1000);
};

document.addEventListener('click', (event) => {
  if (event.target.closest('#enable-phone-notifications-btn')) {
    event.preventDefault();
    window.requestPhoneNotifications();
  }
});

if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'minimalist-open-pm') openPmFromNotification(event.data);
  });
}

window.listenForPmInbox = function listenForPmInbox() {
  if (!window.currentUser) return;
  if (listeningUid === window.currentUser.uid && inboxUnsubscribe) {
    ensurePhoneNotifyButton();
    return;
  }

  if (inboxUnsubscribe) inboxUnsubscribe();
  listeningUid = window.currentUser.uid;
  listenerStartedAt = Date.now();
  notifiedInboxEvents.clear();
  ensurePhoneNotifyButton();
  if (phoneAlertsEnabled() && notificationSupported() && window.Notification.permission === 'granted') {
    syncFirebasePushToken();
  }
  const inboxRef = ref(db, `inbox/${window.currentUser.uid}`);
  const stopValue = onValue(inboxRef, (snapshot) => {
    const inbox = snapshot.val() || {};
    const unreadCount = Object.values(inbox).filter((item) => item?.read === false).length;
    window.updatePmUnreadBadge(unreadCount, inbox);
  });
  const handleInboxUpdate = (snapshot, reason) => {
    const data = snapshot.val();
    if (!data || data.read !== false) return;

    if (window.currentPmTargetUid !== snapshot.key) {
      const eventKey = `${snapshot.key}:${data.timestamp || ''}:${data.lastText || ''}`;
      const isOldInitialUnread = reason === 'added' && data.timestamp && data.timestamp < listenerStartedAt - 3000;
      if (!notifiedInboxEvents.has(eventKey) && !isOldInitialUnread) {
        notifiedInboxEvents.add(eventKey);
        window.triggerNotification(data.fromName, data, snapshot.key);
      }
      return;
    }

    set(ref(db, `inbox/${window.currentUser.uid}/${snapshot.key}/read`), true);
  };

  const stopAdded = onChildAdded(inboxRef, (snapshot) => handleInboxUpdate(snapshot, 'added'));
  const stopChanged = onChildChanged(inboxRef, (snapshot) => handleInboxUpdate(snapshot, 'changed'));
  inboxUnsubscribe = () => {
    stopValue();
    stopAdded();
    stopChanged();
  };
};
