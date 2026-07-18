import { onChildAdded, onChildChanged, onValue, ref, remove, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { isQuietScheduleActive } from '../notifications/notificationModel.js';

let blinkInterval = null;
let audioContext = null;
let inboxUnsubscribe = null;
let listeningUid = null;
let listenerStartedAt = 0;
let latestUnreadCount = 0;
let latestInbox = {};
let activeTitleAlert = '';
const originalTitle = 'Minimalist | Chat';
const notifiedInboxEvents = new Set();
const MAX_NOTIFIED_INBOX_EVENTS = 500;
const PM_INBOX_RETAIN_LIMIT = 80;
const PUSH_TOKEN_STORAGE_KEY = 'minimalist:fcm-token-registration';
const contactUnreadTargets = [
  'open-contacts-btn',
  'open-contacts-btn-mobile',
];
const legacyUpdatesUnreadTargets = [
  'open-updates-btn-desktop',
  'open-updates-btn-mobile',
];

function rememberInboxEvent(eventKey) {
  if (notifiedInboxEvents.has(eventKey)) return false;
  notifiedInboxEvents.add(eventKey);
  while (notifiedInboxEvents.size > MAX_NOTIFIED_INBOX_EVENTS) {
    const oldest = notifiedInboxEvents.values().next().value;
    if (oldest === undefined) break;
    notifiedInboxEvents.delete(oldest);
  }
  return true;
}

function compactPmInbox(inbox = {}) {
  const entries = Object.entries(inbox);
  if (entries.length <= PM_INBOX_RETAIN_LIMIT) return inbox;

  const protectedUids = new Set(window.getProtectedPmSessionUids?.() || []);
  if (window.currentPmTargetUid) protectedUids.add(window.currentPmTargetUid);
  const sortedEntries = entries.sort(([, a], [, b]) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  const required = [];
  const recentRead = [];
  sortedEntries.forEach((entry) => {
    const [targetUid, data] = entry;
    if (data?.read === false || protectedUids.has(targetUid)) required.push(entry);
    else recentRead.push(entry);
  });

  return Object.fromEntries([
    ...required,
    ...recentRead.slice(0, Math.max(0, PM_INBOX_RETAIN_LIMIT - required.length)),
  ]);
}

function eventTargetElement(event) {
  const target = event.target;
  if (target instanceof Element) return target;
  return target?.parentElement || null;
}

function notificationSupported() {
  return typeof window.Notification !== 'undefined';
}

async function ensureNotificationServiceWorker() {
  if (!navigator.serviceWorker) return null;
  // The Vite entry removes production service workers in development so stale
  // cached bundles cannot mask local changes. Re-registering here would make a
  // fresh localhost tab unregister and hard-reload again on its next launch.
  if (import.meta.env?.DEV) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) return existing;
    return await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.debug('Notification service worker unavailable', error);
    return null;
  }
}

function phoneAlertsEnabled() {
  return localStorage.getItem('minimalist:phone-notifications') === 'enabled';
}

function privateMessageDeliveryPaused(data = {}) {
  if (localStorage.getItem('minimalist:dnd') === 'on') return true;
  if (data.eventType === 'call') return false;
  try {
    const schedule = JSON.parse(localStorage.getItem('minimalist:notify-schedule') || '{}') || {};
    return isQuietScheduleActive(schedule);
  } catch {
    return false;
  }
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
    dot.removeAttribute('role');
    dot.removeAttribute('aria-label');
    dot.setAttribute('aria-hidden', 'true');
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
      dot.setAttribute('role', 'status');
      dot.setAttribute('aria-label', `Unread private message from ${data?.fromName || 'Someone'}`);
      dot.removeAttribute('aria-hidden');
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

function pauseTitleAlert() {
  clearInterval(blinkInterval);
  blinkInterval = null;
  if (activeTitleAlert) document.title = activeTitleAlert;
}

function startTitleAlert() {
  pauseTitleAlert();
  if (!activeTitleAlert || document.hidden) return;
  let showAlert = true;
  blinkInterval = window.setInterval(() => {
    showAlert = !showAlert;
    document.title = showAlert ? activeTitleAlert : originalTitle;
  }, 1000);
}

function clearTitleAlert() {
  const hadActiveAlert = Boolean(activeTitleAlert || blinkInterval);
  clearInterval(blinkInterval);
  blinkInterval = null;
  activeTitleAlert = '';
  if (hadActiveAlert) document.title = originalTitle;
}

window.syncPrivateMessageDeliveryPreferences = function syncPrivateMessageDeliveryPreferences() {
  if (privateMessageDeliveryPaused()) clearTitleAlert();
};

window.updatePmUnreadBadge = function updatePmUnreadBadge(count, inbox = null) {
  latestUnreadCount = count;
  if (inbox) {
    latestInbox = inbox;
    window.latestPmInbox = inbox;
    window.latestPmInboxUid = window.currentUser?.uid || null;
    window.dispatchEvent(new CustomEvent('minimalist:pm-inbox', { detail: { inbox, unreadCount: count } }));
  }
  const label = count > 9 ? '9+' : String(count);
  contactUnreadTargets.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const defaultLabel = el.dataset.defaultAriaLabel
      || el.getAttribute('aria-label')
      || el.title
      || el.textContent.trim()
      || 'Contacts';
    el.dataset.defaultAriaLabel = defaultLabel.replace(/ \(\d+ unread PMs?\)$/, '');
    el.classList.toggle('has-unread', count > 0);
    if (count > 0) {
      el.dataset.unreadCount = label;
      el.setAttribute('aria-label', `${el.dataset.defaultAriaLabel} (${count} unread PM${count === 1 ? '' : 's'})`);
    } else {
      delete el.dataset.unreadCount;
      el.setAttribute('aria-label', el.dataset.defaultAriaLabel);
    }
  });

  const updatesIndicatorHandled = window.updateUpdatesUnreadIndicator?.({ pmUnread: count }) === true;
  if (!updatesIndicatorHandled) {
    legacyUpdatesUnreadTargets.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const defaultLabel = el.dataset.defaultAriaLabel
        || el.getAttribute('aria-label')
        || el.title
        || el.textContent.trim()
        || 'Updates';
      el.dataset.defaultAriaLabel = defaultLabel;
      el.classList.toggle('has-unread', count > 0);
      if (count > 0) {
        el.dataset.unreadCount = label;
        el.setAttribute('aria-label', `${defaultLabel} (${count} unread PM${count === 1 ? '' : 's'})`);
      } else {
        delete el.dataset.unreadCount;
        el.setAttribute('aria-label', defaultLabel);
      }
    });
  }

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
  if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel();
  else document.getElementById('updates-panel')?.classList.remove('open');
  clearTitleAlert();
}

function openPmPayloadFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const isPmOpen = params.get('notification') === 'pm' || params.has('pmTargetUid');
  const targetUid = isPmOpen ? (params.get('pmTargetUid') || params.get('targetUid')) : '';
  if (!targetUid) return null;
  return {
    type: 'minimalist-open-pm',
    targetUid,
    targetName: params.get('pmTargetName') || params.get('targetName') || params.get('fromName') || 'User',
  };
}

function clearPmOpenParams() {
  const url = new URL(window.location.href);
  ['notification', 'pmTargetUid', 'pmTargetName', 'targetUid', 'targetName', 'fromName'].forEach((key) => {
    url.searchParams.delete(key);
  });
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function consumePmOpenFromUrl() {
  const payload = openPmPayloadFromUrl();
  if (!payload) return;
  openPmFromNotification(payload);
  clearPmOpenParams();
}

async function sendBrowserPmNotification(senderName, data = {}, senderUid = '') {
  if (!phoneAlertsEnabled() || !notificationSupported() || window.Notification.permission !== 'granted') return;

  const isVoiceCall = data.eventType === 'call';

  const payload = {
    type: 'minimalist-open-pm',
    targetUid: senderUid,
    targetName: senderName || 'User',
    fromName: senderName || 'Someone',
  };
  const title = isVoiceCall ? `Incoming call from ${senderName || 'Someone'}` : `New PM from ${senderName || 'Someone'}`;
  const options = {
    body: isVoiceCall ? `${senderName || 'Someone'} is calling you on Minimalist.` : cleanSnippet(data.lastText),
    tag: `${isVoiceCall ? 'minimalist-call' : 'minimalist-pm'}-${senderUid || 'unknown'}`,
    renotify: true,
    data: payload,
  };

  try {
    const registration = await ensureNotificationServiceWorker();
    if (registration) {
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
  const labelText = !supported
    ? 'Alerts unavailable'
    : permission === 'denied'
      ? 'Alerts blocked'
      : enabled
        ? hasFcmKey
          ? 'PM alerts on'
          : 'Browser PM alerts on'
        : hasFcmKey
          ? 'PM alerts'
          : 'Browser PM alerts';

  button.classList.toggle('enabled', enabled);
  button.disabled = !supported || permission === 'denied';
  button.title = !supported
    ? 'This browser does not support web notifications.'
    : permission === 'denied'
      ? 'Notifications are blocked in this browser.'
      : enabled
        ? hasFcmKey
          ? 'Private-message push alerts are enabled on this device.'
          : 'Browser alerts are enabled. Add FCM_VAPID_KEY for closed-app phone push.'
        : hasFcmKey
          ? 'Enable phone/browser private-message alerts.'
          : 'Enable browser/PWA alerts for this device. Closed-app phone push is unavailable until FCM_VAPID_KEY is set.';
  const icon = document.createElement('i');
  icon.className = enabled ? 'ph-bold ph-device-mobile' : 'ph-bold ph-device-mobile-camera';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = labelText;
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  button.setAttribute('aria-label', enabled ? `${labelText}. PM alerts are enabled on this device.` : `${labelText}. Enable PM alerts on this device.`);
  button.replaceChildren(icon, label);
}

function pushTokenKey(token) {
  return token.replace(/[.#$/[\]]/g, '_');
}

function readRememberedPushToken() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.uid || !parsed.key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rememberPushToken(uid, key) {
  try {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, JSON.stringify({ uid, key, updatedAt: Date.now() }));
  } catch {
    // Private browser modes can block localStorage. Token cleanup stays best-effort.
  }
}

function forgetPushToken() {
  try {
    localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // Best effort only.
  }
}

async function syncFirebasePushToken() {
  const vapidKey = String(window.FCM_VAPID_KEY || '').trim();
  if (import.meta.env?.DEV || !vapidKey || !window.currentUser || !navigator.serviceWorker) return false;

  try {
    const [{ getMessaging, getToken, isSupported }, { app }] = await Promise.all([
      import('firebase/messaging'),
      import('../../lib/firebase.js'),
    ]);
    const supported = await isSupported();
    if (!supported) return false;

    const registration = await ensureNotificationServiceWorker();
    if (!registration) return false;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) return false;
    const uid = window.currentUser.uid;
    const key = pushTokenKey(token);
    const previous = readRememberedPushToken();
    if (previous?.uid === uid && previous.key && previous.key !== key) {
      await remove(ref(db, `push_tokens/${uid}/${previous.key}`)).catch(() => {});
    }

    await set(ref(db, `push_tokens/${uid}/${key}`), {
      token,
      updatedAt: Date.now(),
      userAgent: navigator.userAgent.slice(0, 180),
      platform: navigator.platform || '',
    });
    rememberPushToken(uid, key);

    return true;
  } catch (error) {
    console.debug('Firebase push token sync failed', error);
    return false;
  }
}

window.clearFirebasePushToken = async function clearFirebasePushToken(uid = window.currentUser?.uid, opts = {}) {
  const remembered = readRememberedPushToken();
  const targetUid = uid || remembered?.uid || '';

  try {
    if (targetUid && opts.allForAccount === true) {
      await remove(ref(db, `push_tokens/${targetUid}`));
    } else if (targetUid && remembered?.key && (!remembered.uid || remembered.uid === targetUid)) {
      await remove(ref(db, `push_tokens/${targetUid}/${remembered.key}`));
    }
  } catch (error) {
    console.debug('Stored push token cleanup failed', error);
  }

  try {
    const [{ getMessaging, deleteToken, isSupported }, { app }] = await Promise.all([
      import('firebase/messaging'),
      import('../../lib/firebase.js'),
    ]);
    if (await isSupported()) {
      await deleteToken(getMessaging(app));
    }
  } catch (error) {
    console.debug('Firebase messaging token delete failed', error);
  }

  forgetPushToken();
  return true;
};

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
  if (privateMessageDeliveryPaused(data)) return;
  window.playPing();
  sendBrowserPmNotification(senderName, data, senderUid);
  const isVoiceCall = data.eventType === 'call';
  activeTitleAlert = isVoiceCall ? `📞 ${senderName} is calling!` : `💬 New PM from ${senderName}!`;
  document.title = activeTitleAlert;
  startTitleAlert();
};

document.addEventListener('visibilitychange', () => {
  if (!activeTitleAlert) return;
  if (document.hidden) pauseTitleAlert();
  else startTitleAlert();
});

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (target?.closest('#enable-phone-notifications-btn')) {
    event.preventDefault();
    window.requestPhoneNotifications();
  }
});

if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'minimalist-open-pm') openPmFromNotification(event.data);
  });
}

window.setTimeout(consumePmOpenFromUrl, 0);

window.stopPmInboxListener = function stopPmInboxListener({ clearState = false } = {}) {
  inboxUnsubscribe?.();
  inboxUnsubscribe = null;
  listeningUid = null;
  listenerStartedAt = 0;
  notifiedInboxEvents.clear();

  if (clearState) {
    latestUnreadCount = 0;
    latestInbox = {};
    window.latestPmInbox = {};
    window.updatePmUnreadBadge?.(0, {});
    window.latestPmInboxUid = null;
  }
};

window.listenForPmInbox = function listenForPmInbox() {
  const uid = window.currentUser?.uid;
  if (!uid) {
    window.stopPmInboxListener({ clearState: true });
    return;
  }
  if (listeningUid === uid && inboxUnsubscribe) {
    ensurePhoneNotifyButton();
    return;
  }

  const accountChanged = Boolean(listeningUid && listeningUid !== uid);
  window.stopPmInboxListener({ clearState: accountChanged });
  listeningUid = uid;
  listenerStartedAt = Date.now();
  notifiedInboxEvents.clear();
  ensurePhoneNotifyButton();
  if (phoneAlertsEnabled() && notificationSupported() && window.Notification.permission === 'granted') {
    syncFirebasePushToken();
  }
  const inboxRef = ref(db, `inbox/${uid}`);
  const stopValue = onValue(inboxRef, (snapshot) => {
    if (listeningUid !== uid || window.currentUser?.uid !== uid) return;
    const inbox = snapshot.val() || {};
    const unreadCount = Object.values(inbox).filter((item) => item?.read === false).length;
    window.updatePmUnreadBadge(unreadCount, compactPmInbox(inbox));
  });
  const handleInboxUpdate = (snapshot, reason) => {
    if (listeningUid !== uid || window.currentUser?.uid !== uid) return;
    const data = snapshot.val();
    if (!data || data.read !== false) return;

    if (window.currentPmTargetUid !== snapshot.key) {
      const eventKey = `${snapshot.key}:${data.timestamp || ''}:${data.lastText || ''}`;
      const isOldInitialUnread = reason === 'added' && data.timestamp && data.timestamp < listenerStartedAt - 3000;
      if (!isOldInitialUnread && rememberInboxEvent(eventKey)) {
        window.triggerNotification(data.fromName, data, snapshot.key);
      }
      return;
    }

    set(ref(db, `inbox/${uid}/${snapshot.key}/read`), true);
  };

  const stopAdded = onChildAdded(inboxRef, (snapshot) => handleInboxUpdate(snapshot, 'added'));
  const stopChanged = onChildChanged(inboxRef, (snapshot) => handleInboxUpdate(snapshot, 'changed'));
  inboxUnsubscribe = () => {
    stopValue();
    stopAdded();
    stopChanged();
  };
};

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) window.stopPmInboxListener?.();
});
