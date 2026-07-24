/* eslint-disable react-refresh/only-export-components */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  endBefore,
  get,
  limitToLast,
  off,
  onDisconnect,
  onValue,
  orderByKey,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { createRoot } from 'react-dom/client';
import { auth, db } from '../../lib/firebase.js';
import { normalizeStoredAvatarUrl } from '../../lib/avatar.js';
import { playUiSound } from '../audio/uiSoundService.js';
import {
  mergePmMessagePages,
  PM_HISTORY_PAGE_SIZE,
  pmHistoryCursor,
  pmHistoryMayHaveOlder,
  roomIdFor,
} from './pmHistoryModel.js';
import { useDirectAudioCall } from './useDirectAudioCall.js';

const pmKeys = new Map();
const pmDecryptCache = new Map();
const sessions = new Map();
const listeners = new Set();
let activeUid = null;
let pmRoot = null;
let pmRootHost = null;
let pmCallPortalRoot = null;
let pmDockOpener = null;
let pmStateOwnerUid = null;
let livePmCallTargetUid = null;
let pmReturnSurface = null;
let pmDockVisible = false;
let pendingPmVoiceCallIntent = null;

function browserAlertsOwnBackgroundCall() {
  if (document.visibilityState === 'visible' && document.hasFocus()) return false;
  try {
    return localStorage.getItem('minimalist:phone-notifications') === 'enabled'
      && typeof window.Notification !== 'undefined'
      && window.Notification.permission === 'granted';
  } catch {
    return false;
  }
}

const pendingPmCallStreams = new Map();
const PM_SESSION_LIMIT = 64;
const PM_CALL_RING_MS = 35_000;
const PM_CALL_EVENT_PREFIX = '\u{1F4DE} Voice call';
const PM_CALL_EVENT_TYPE = 'direct_call';
const SAFE_PM_CALL_UID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_PM_CALL_THREAD_ID = /^[A-Za-z0-9_-]{1,260}$/;

function expectedPmThreadId(userUid, targetUid) {
  if (!SAFE_PM_CALL_UID.test(String(userUid || '')) || !SAFE_PM_CALL_UID.test(String(targetUid || ''))) return '';
  const threadId = roomIdFor(userUid, targetUid);
  return SAFE_PM_CALL_THREAD_ID.test(threadId) ? threadId : '';
}

async function hasAcceptedPmFriendship(userUid, targetUid) {
  if (!expectedPmThreadId(userUid, targetUid)) return false;
  const snapshot = await get(ref(db, `friends/${userUid}/${targetUid}`));
  return snapshot.val() === 'accepted';
}

function friendCallOnlyMessage() {
  return 'Voice calls are available only between accepted friends.';
}

function isPmCallPermissionDenied(error) {
  return /permission[-_ ]?denied/i.test(`${error?.code || ''} ${error?.message || ''}`);
}

function emitSessions() {
  listeners.forEach((listener) => listener());
}

function isProtectedPmSession(session) {
  return Boolean(
    session
    && (
      session.open
      || session.unread
      || session.targetUid === activeUid
      || session.targetUid === livePmCallTargetUid
    )
  );
}

function prunePmSessions() {
  if (sessions.size <= PM_SESSION_LIMIT) return false;

  const removable = [...sessions.values()]
    .filter((session) => !isProtectedPmSession(session))
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  let changed = false;
  while (sessions.size > PM_SESSION_LIMIT && removable.length) {
    const oldest = removable.shift();
    if (!oldest || !sessions.delete(oldest.targetUid)) continue;
    changed = true;
  }
  return changed;
}

function protectedPmSessionUids() {
  return [...sessions.values()]
    .filter(isProtectedPmSession)
    .map((session) => session.targetUid);
}

window.getProtectedPmSessionUids = protectedPmSessionUids;

function scopePmStateToUser(uid) {
  const nextUid = uid || null;
  if (pmStateOwnerUid === nextUid) return;

  pendingPmCallStreams.forEach(stopMediaStream);
  pendingPmCallStreams.clear();
  pmKeys.clear();
  pmDecryptCache.clear();
  sessions.clear();
  activeUid = null;
  livePmCallTargetUid = null;
  pmReturnSurface = null;
  pmDockOpener = null;
  pendingPmVoiceCallIntent = null;
  pmStateOwnerUid = nextUid;
  emitSessions();
}

function snapshotSessions() {
  return {
    activeUid,
    sessions: [...sessions.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
  };
}

function upsertSession(targetUid, patch = {}, { notify = true } = {}) {
  if (!targetUid) return false;
  const previous = sessions.get(targetUid);
  const nextSession = {
    targetUid,
    targetName: patch.targetName || previous?.targetName || patch.fromName || 'User',
    photoUrl: normalizeStoredAvatarUrl(patch.photoUrl || previous?.photoUrl),
    open: patch.open ?? previous?.open ?? false,
    unread: patch.unread ?? previous?.unread ?? false,
    lastText: patch.lastText ?? previous?.lastText ?? '',
    timestamp: patch.timestamp ?? previous?.timestamp ?? Date.now(),
  };

  if (
    previous
    && previous.targetName === nextSession.targetName
    && previous.photoUrl === nextSession.photoUrl
    && previous.open === nextSession.open
    && previous.unread === nextSession.unread
    && previous.lastText === nextSession.lastText
    && previous.timestamp === nextSession.timestamp
  ) return false;

  sessions.set(targetUid, nextSession);
  prunePmSessions();
  if (notify) emitSessions();
  return true;
}

function applyPmInboxSessions(inbox = {}) {
  let changed = false;
  Object.entries(inbox)
    .sort(([, a], [, b]) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
    .forEach(([targetUid, data]) => {
      changed = upsertSession(targetUid, {
        targetName: sessions.get(targetUid)?.targetName || data.fromName || 'User',
        unread: data.read === false,
        lastText: data.lastText || (data.read === false ? 'New message' : ''),
        timestamp: data.timestamp || 0,
      }, { notify: false }) || changed;
    });
  changed = prunePmSessions() || changed;
  if (changed) emitSessions();
}

function ensurePmDock() {
  const popup = document.getElementById('pm-popup');
  if (!popup) return;
  let host = document.getElementById('pm-dock-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pm-dock-root';
    popup.replaceChildren(host);
  }
  if (!pmRoot || pmRootHost !== host) {
    pmRoot?.unmount();
    host.replaceChildren();
    pmRoot = createRoot(host);
    pmRootHost = host;
    pmRoot.render(<PrivateMessagesDock />);
  }
}

function showPmDock(targetUid, options = {}) {
  const userUid = auth.currentUser?.uid || window.currentUser?.uid || '';
  scopePmStateToUser(userUid);
  if (window.latestPmInboxUid === userUid) applyPmInboxSessions(window.latestPmInbox || {});
  if (targetUid && livePmCallTargetUid && targetUid !== livePmCallTargetUid) {
    targetUid = livePmCallTargetUid;
    window.showToast?.('Finish the current call before opening another conversation.');
  }
  const previousActiveUid = activeUid;
  if (targetUid) activeUid = targetUid;
  pmDockOpener = options.opener instanceof HTMLElement
    ? options.opener
    : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  window.closeFloatingUI?.({ keep: 'pm-popup', restoreFocus: false });
  pmDockVisible = true;
  ensurePmDock();
  const popup = document.getElementById('pm-popup');
  popup?.classList.remove('pm-call-dock-minimized');
  popup?.classList.remove('hidden');
  popup?.setAttribute('aria-hidden', 'false');
  if (targetUid && userUid) {
    window.currentPmTargetUid = targetUid;
    window.currentPmRoomId = roomIdFor(userUid, targetUid);
  }
  emitSessions();
  window.dispatchEvent(new CustomEvent('minimalist:pm-dock-open', {
    detail: { targetUid, changed: Boolean(targetUid && previousActiveUid !== targetUid) },
  }));
}

function finishPmDockClose({ restoreOrigin = true } = {}) {
  pmDockVisible = false;
  const popup = document.getElementById('pm-popup');
  popup?.classList.add('hidden');
  popup?.setAttribute('aria-hidden', 'true');
  window.currentPmRoomId = null;
  window.currentPmTargetUid = null;
  window.dispatchEvent(new CustomEvent('minimalist:pm-dock-close'));

  const opener = pmDockOpener;
  const returnSurface = pmReturnSurface;
  pmDockOpener = null;
  pmReturnSurface = null;

  if (restoreOrigin && returnSurface === 'contacts') {
    window.openContactsPanel?.();
    window.requestAnimationFrame(() => {
      const openerIsVisible = opener?.isConnected && !opener.closest?.('.hidden');
      const focusTarget = openerIsVisible ? opener : document.getElementById('close-contacts-btn');
      focusTarget?.focus?.({ preventScroll: true });
    });
    return;
  }

  if (restoreOrigin && opener?.isConnected) opener.focus({ preventScroll: true });
}

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function callPermissionMessage(error) {
  const name = String(error?.name || '');
  if (!window.isSecureContext) return 'Calls need HTTPS to use your microphone.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Microphone permission was denied. Allow microphone access for this site, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found on this device.';
  return error?.message || 'Your microphone could not be opened.';
}

async function requestPmAudio() {
  if (!window.isSecureContext) throw new Error('Calls need HTTPS to use your microphone.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support voice calls.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (!stream.getAudioTracks().length) {
      stopMediaStream(stream);
      throw new Error('No microphone was found on this device.');
    }
    return stream;
  } catch (error) {
    throw new Error(callPermissionMessage(error));
  }
}

function userCallParticipant(user) {
  return {
    uid: user.uid,
    name: window.userProfileName || user.displayName || 'Anonymous',
    photoUrl: window.userPhotoUrl || user.photoURL || '',
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    micOn: true,
  };
}

async function acceptPmCall(call, { openDock = true } = {}) {
  const user = auth.currentUser || window.currentUser;
  if (
    !user?.uid
    || !call?.roomId
    || call.calleeUid !== user.uid
    || call.status !== 'ringing'
    || Number(call.expiresAt || 0) <= Date.now()
  ) return false;
  let stream = null;
  let accepted = false;
  try {
    if (!(await hasAcceptedPmFriendship(user.uid, call.callerUid))) {
      throw new Error(friendCallOnlyMessage());
    }
    stream = await requestPmAudio();
    pendingPmCallStreams.set(call.roomId, stream);
    const callPath = `pm_calls/${call.roomId}`;
    const acceptedAt = Date.now();
    const statusResult = await runTransaction(ref(db, `${callPath}/status`), (status) => (
      status === 'ringing' && Number(call.expiresAt || 0) > Date.now() ? 'active' : undefined
    ), { applyLocally: false });
    if (!statusResult.committed) throw new Error('This call is no longer available.');
    accepted = true;
    await update(ref(db, callPath), {
      acceptedAt,
      startedAt: acceptedAt,
      [`participants/${user.uid}`]: userCallParticipant(user),
    });
    onDisconnect(ref(db, `${callPath}/participants/${user.uid}`)).remove();
    if (openDock) {
      openPrivateMessagesDock(call.callerUid, call.callerName || 'Caller', { photoUrl: call.callerPhotoUrl || '' });
    }
    return true;
  } catch (error) {
    if (accepted) {
      runTransaction(ref(db, `pm_calls/${call.roomId}/status`), (status) => (
        status === 'active' ? 'ended' : undefined
      ), { applyLocally: false }).then((result) => (
        result.committed ? set(ref(db, `pm_calls/${call.roomId}/endedAt`), serverTimestamp()) : null
      )).catch(() => {});
    }
    if (pendingPmCallStreams.get(call.roomId) === stream) pendingPmCallStreams.delete(call.roomId);
    stopMediaStream(stream);
    window.showToast?.(`Could not answer: ${error.message || error}`);
    return false;
  }
}

async function declinePmCall(call) {
  const user = auth.currentUser || window.currentUser;
  if (!user?.uid || !call?.roomId || call.calleeUid !== user.uid || call.status !== 'ringing') return;
  const callPath = `pm_calls/${call.roomId}`;
  const result = await runTransaction(ref(db, `${callPath}/status`), (status) => (
    status === 'ringing' ? 'declined' : undefined
  ), { applyLocally: false });
  if (result.committed) await set(ref(db, `${callPath}/endedAt`), serverTimestamp());
  set(ref(db, `inbox/${user.uid}/${call.callerUid}/read`), true).catch(() => {});
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derivePmKey(roomId, passphrase) {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`minimalist-pm:${roomId}`),
      iterations: 120000,
      hash: 'SHA-256',
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptPmText(roomId, text) {
  const key = pmKeys.get(roomId);
  if (!key) return { text };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return {
    encrypted: true,
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

async function decryptPmText(roomId, message) {
  if (!message.encrypted) return message.text || '';
  const key = pmKeys.get(roomId);
  if (!key) return 'Encrypted message — enter the shared passphrase to read it.';
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(message.iv) },
      key,
      base64ToBytes(message.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return 'Could not decrypt — wrong passphrase for this chat.';
  }
}

function pmDecryptCacheKey(roomId, message, encryptionVersion) {
  if (!message?.encrypted) return `${roomId}:${message?.id}:plain:${message?.text || ''}`;
  return [
    roomId,
    message.id,
    encryptionVersion,
    message.iv || '',
    String(message.ciphertext || '').length,
    String(message.ciphertext || '').slice(0, 36),
  ].join(':');
}

async function cachedDecryptPmText(roomId, message, encryptionVersion) {
  const key = pmDecryptCacheKey(roomId, message, encryptionVersion);
  if (pmDecryptCache.has(key)) return pmDecryptCache.get(key);
  const decrypted = await decryptPmText(roomId, message);
  pmDecryptCache.set(key, decrypted);
  if (pmDecryptCache.size > 600) {
    const firstKey = pmDecryptCache.keys().next().value;
    pmDecryptCache.delete(firstKey);
  }
  return decrypted;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const value = typeof timestamp === 'number' ? timestamp : timestamp;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function conversationDayKey(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatConversationDay(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (conversationDayKey(date.getTime()) === conversationDayKey(today.getTime())) return 'Today';
  if (conversationDayKey(date.getTime()) === conversationDayKey(yesterday.getTime())) return 'Yesterday';
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function messagesShareGroup(previous, current) {
  if (!previous || !current || previous.uid !== current.uid) return false;
  if (previous.type === PM_CALL_EVENT_TYPE || current.type === PM_CALL_EVENT_TYPE) return false;
  const previousTime = Number(previous.timestamp || 0);
  const currentTime = Number(current.timestamp || 0);
  return conversationDayKey(previousTime) === conversationDayKey(currentTime)
    && currentTime >= previousTime
    && currentTime - previousTime < 5 * 60 * 1000;
}

function callStateLabel(call, myUid) {
  if (!call) return '';
  if (call.status === 'ringing') return call.callerUid === myUid ? 'Calling…' : 'Incoming voice call';
  if (call.status === 'active') return 'Voice call connected';
  if (call.status === 'declined') return 'Call declined';
  if (call.status === 'cancelled') return 'Call cancelled';
  if (call.status === 'missed') return 'No answer';
  if (call.status === 'ended') return 'Call ended';
  return 'Voice call';
}

function IncomingCallManager() {
  const [uid, setUid] = useState(() => auth.currentUser?.uid || window.currentUser?.uid || '');
  const [inbox, setInbox] = useState({});
  const [friendships, setFriendships] = useState({ uid: '', loaded: false, values: {} });
  const [candidateCalls, setCandidateCalls] = useState({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => onAuthStateChanged(auth, (user) => {
    const nextUid = user?.uid || '';
    scopePmStateToUser(nextUid);
    setUid(nextUid);
  }), []);

  useEffect(() => {
    if (!uid) return undefined;

    return onValue(ref(db, `friends/${uid}`), (snapshot) => {
      setFriendships({ uid, loaded: true, values: snapshot.val() || {} });
    }, () => {
      setFriendships({ uid, loaded: true, values: {} });
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;

    const applyInbox = (nextInbox, inboxUid = window.latestPmInboxUid) => {
      if (inboxUid && inboxUid !== uid) return;
      setInbox(nextInbox || {});
    };
    const initialFrame = window.requestAnimationFrame(() => applyInbox(window.latestPmInbox || {}));
    const handleInbox = (event) => applyInbox(event.detail?.inbox || {}, window.latestPmInboxUid);
    window.addEventListener('minimalist:pm-inbox', handleInbox);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener('minimalist:pm-inbox', handleInbox);
    };
  }, [uid]);

  const recentSenders = useMemo(() => Object.entries(inbox)
    .sort(([, a], [, b]) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
    .slice(0, 24)
    .map(([senderUid]) => senderUid), [inbox]);
  const callPeerUids = useMemo(() => [...new Set([
    ...recentSenders,
    ...Object.entries(friendships.values || {})
      .filter(([, status]) => status === 'accepted')
      .map(([friendUid]) => friendUid),
  ])]
    .filter((peerUid) => peerUid !== uid && SAFE_PM_CALL_UID.test(peerUid))
    .slice(0, PM_SESSION_LIMIT), [friendships.values, recentSenders, uid]);
  const callPeerKey = callPeerUids.join('|');

  useEffect(() => {
    if (!uid || !callPeerUids.length) return undefined;
    const unsubscribers = callPeerUids.map((peerUid) => {
      const roomId = roomIdFor(uid, peerUid);
      return onValue(ref(db, `pm_calls/${roomId}`), (snapshot) => {
        const value = snapshot.val();
        setNow(Date.now());
        setCandidateCalls((current) => {
          const next = { ...current };
          if (value) next[roomId] = value;
          else delete next[roomId];
          return next;
        });
      });
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    // The serialized peer key keeps listener churn tied to inbox/friendship changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPeerKey, uid]);

  useEffect(() => {
    if (!uid || friendships.uid !== uid || !friendships.loaded) return;
    Object.values(candidateCalls).forEach((call) => {
      if (
        call?.status === 'ringing'
        && call.calleeUid === uid
        && friendships.values?.[call.callerUid] !== 'accepted'
      ) {
        declinePmCall(call).catch(() => {});
      }
    });
  }, [candidateCalls, friendships, uid]);

  const incomingCall = useMemo(() => Object.values(candidateCalls)
    .filter((call) => call?.status === 'ringing'
      && call.calleeUid === uid
      && friendships.uid === uid
      && friendships.loaded
      && friendships.values?.[call.callerUid] === 'accepted'
      && Number(call.expiresAt || 0) > now)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null, [candidateCalls, friendships, now, uid]);

  useEffect(() => {
    if (!incomingCall) return undefined;
    const ring = () => {
      if (browserAlertsOwnBackgroundCall()) return;
      void playUiSound('call', { allowDuringQuietHours: true });
      navigator.vibrate?.([420, 180, 420]);
    };
    ring();
    const ringtone = window.setInterval(ring, 1800);
    const expiryTimer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Number(incomingCall.expiresAt || 0) - Date.now()),
    );
    return () => {
      window.clearInterval(ringtone);
      window.clearTimeout(expiryTimer);
      navigator.vibrate?.(0);
    };
  }, [incomingCall]);

  if (!incomingCall) return null;
  const callerName = incomingCall.callerName || 'Someone';
  const initials = callerName.slice(0, 2).toUpperCase();

  return (
    <div className="pm-incoming-call-layer" role="dialog" aria-modal="true" aria-labelledby="pm-incoming-call-name">
      <div className="pm-incoming-call-card">
        <span className="pm-call-kicker"><i className="ph-bold ph-phone-incoming" aria-hidden="true" /> Incoming voice call</span>
        <div className="pm-call-avatar-wrap" aria-hidden="true">
          <span className="pm-call-pulse pulse-one" />
          <span className="pm-call-pulse pulse-two" />
          <span className="pm-call-avatar">
            {incomingCall.callerPhotoUrl ? <img src={incomingCall.callerPhotoUrl} alt="" /> : initials}
          </span>
        </div>
        <div className="pm-incoming-call-copy">
          <h2 id="pm-incoming-call-name">{callerName}</h2>
          <p>is calling you on Minimalist</p>
        </div>
        <div className="pm-incoming-call-actions">
          <button type="button" className="pm-call-control decline" onClick={() => declinePmCall(incomingCall)}>
            <i className="ph-bold ph-phone-disconnect" aria-hidden="true" />
            <span>Decline</span>
          </button>
          <button type="button" className="pm-call-control accept" autoFocus onClick={() => acceptPmCall(incomingCall)}>
            <i className="ph-bold ph-phone" aria-hidden="true" />
            <span>Answer</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ensurePmCallPortal() {
  let host = document.getElementById('pm-call-portal');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pm-call-portal';
    document.body.appendChild(host);
  }
  if (!pmCallPortalRoot) pmCallPortalRoot = createRoot(host);
  pmCallPortalRoot.render(<IncomingCallManager />);
}

function SessionButton({ session, active, onPick, onClose }) {
  const unreadLabel = session.unread ? 'Unread conversation. ' : '';
  const summary = session.lastText || 'No messages yet.';
  const timestamp = session.timestamp
    ? new Date(session.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <div className={`pm-session ${active ? 'active' : ''}`}>
      <button
        type="button"
        className="pm-session-pick"
        onClick={onPick}
        aria-current={active ? 'true' : undefined}
        aria-label={`${session.targetName}. ${unreadLabel}${summary}`}
      >
        <span className="pm-session-avatar">
          {normalizeStoredAvatarUrl(session.photoUrl) ? <img src={normalizeStoredAvatarUrl(session.photoUrl)} alt="" /> : (session.targetName || '?').slice(0, 2).toUpperCase()}
        </span>
        <span className="pm-session-main">
          <span className="pm-session-name-row">
            <strong>{session.targetName}</strong>
            {timestamp ? <time dateTime={new Date(session.timestamp).toISOString()}>{timestamp}</time> : null}
          </span>
          <small>{summary}</small>
        </span>
        {session.unread ? <span className="pm-session-dot" title="Unread" aria-hidden="true" /> : null}
      </button>
      <button
        type="button"
        className="pm-session-close"
        onClick={onClose}
        aria-label={`Close PM with ${session.targetName}`}
        title="Close PM"
      >
        <i className="ph-bold ph-x" aria-hidden="true" />
      </button>
    </div>
  );
}

function PmMessage({ activeSession, grouped, message, myUid, onCallBack, roomId }) {
  const mine = message.uid === myUid;
  const read = mine && activeSession?.targetUid && message.readBy?.[activeSession.targetUid];
  const isCallEvent = message.type === PM_CALL_EVENT_TYPE
    || String(message.decryptedText || '').startsWith(PM_CALL_EVENT_PREFIX);
  return (
    <li className={`${mine ? 'my-pm' : 'their-pm'} ${message.encrypted ? 'encrypted-pm' : ''} ${isCallEvent ? 'pm-call-event' : ''} ${grouped ? 'pm-message-grouped' : ''}`}>
      {isCallEvent ? (
        <div className="pm-call-event-card">
          <span className="pm-call-event-icon"><i className="ph-bold ph-phone-call" aria-hidden="true" /></span>
          <span className="pm-call-event-copy">
            <strong>Voice call</strong>
            <small>{mine ? 'You started a call' : `${activeSession?.targetName || 'This person'} called`} · {formatTime(message.timestamp)}</small>
          </span>
          <button type="button" onClick={onCallBack} aria-label={`Call ${activeSession?.targetName || 'this person'} back`}>
            Call back
          </button>
        </div>
      ) : (
        <>
          <div className="pm-message-bubble">
            <div className="pm-message-text">{message.decryptedText}</div>
            {message.encrypted && !pmKeys.has(roomId) ? <div className="pm-read-hint">Use the lock to unlock this chat.</div> : null}
          </div>
          <div className="pm-message-meta">
            {message.encrypted ? <span>Encrypted</span> : null}
            <span>{formatTime(message.timestamp)}</span>
            {mine ? <span>{read ? 'Read' : 'Sent'}</span> : null}
          </div>
        </>
      )}
    </li>
  );
}

function PmRemoteAudio({ muted, stream }) {
  const audioRef = useRef(null);
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.srcObject = stream || null;
    audioRef.current.play?.().catch(() => {});
  }, [stream]);
  return <audio ref={audioRef} autoPlay muted={muted} playsInline />;
}

function DirectCallStage({
  call,
  myUid,
  engineReady,
  connectionState,
  micOn,
  speakerOn,
  error,
  remoteStreams,
  onAnswer,
  onDecline,
  onEnd,
  onMessage,
  onToggleMic,
  onToggleSpeaker,
}) {
  const [now, setNow] = useState(() => Date.now());
  const outgoing = call?.callerUid === myUid;
  const terminal = ['cancelled', 'declined', 'missed', 'ended'].includes(call?.status);
  const otherName = outgoing ? call?.calleeName : call?.callerName;
  const otherPhoto = outgoing ? call?.calleePhotoUrl : call?.callerPhotoUrl;
  const statusLabel = callStateLabel(call, myUid);
  const elapsed = call?.status === 'active' && call.startedAt
    ? Math.max(0, Math.floor((now - Number(call.startedAt)) / 1000))
    : 0;
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const activeStatus = error
    ? 'Audio unavailable'
    : connectionState === 'connected'
      ? elapsedLabel
      : engineReady
        ? 'Connecting audio…'
        : 'Preparing audio…';

  useEffect(() => {
    if (call?.status !== 'active') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [call?.status]);

  useEffect(() => {
    if (!outgoing || call?.status !== 'ringing') return undefined;
    const ringback = () => {
      void playUiSound('call', { allowDuringQuietHours: true });
    };
    ringback();
    const timer = window.setInterval(ringback, 2300);
    return () => window.clearInterval(timer);
  }, [call?.status, outgoing]);

  return (
    <div className="pm-direct-call-stage">
      <span className="pm-call-kicker">
        <i className={`ph-bold ${call?.status === 'active' ? 'ph-broadcast' : 'ph-phone-call'}`} aria-hidden="true" />
        {call?.status === 'active' ? 'Private audio' : outgoing ? 'Outgoing call' : 'Incoming call'}
      </span>
      <div className="pm-call-avatar-wrap" aria-hidden="true">
        <span className="pm-call-pulse pulse-one" />
        <span className="pm-call-pulse pulse-two" />
        <span className="pm-call-avatar">
          {otherPhoto ? <img src={otherPhoto} alt="" /> : String(otherName || '?').slice(0, 2).toUpperCase()}
        </span>
      </div>
      <div className="pm-call-stage-copy">
        <h2>{otherName || 'Private call'}</h2>
        <p>{statusLabel}{call?.status === 'active' ? ` · ${activeStatus}` : ''}</p>
        {error ? <span className="pm-call-error" role="status">{error}</span> : null}
      </div>

      {!terminal ? <div className="pm-call-stage-actions">
        {call?.status === 'ringing' && !outgoing ? (
          <>
            <button type="button" className="pm-call-control decline" onClick={onDecline}>
              <i className="ph-bold ph-phone-disconnect" aria-hidden="true" /><span>Decline</span>
            </button>
            <button type="button" className="pm-call-control accept" onClick={onAnswer}>
              <i className="ph-bold ph-phone" aria-hidden="true" /><span>Answer</span>
            </button>
          </>
        ) : (
          <>
            {call?.status === 'active' ? (
              <>
                <button type="button" className={`pm-call-control neutral ${micOn ? '' : 'muted'}`} onClick={onToggleMic} aria-pressed={!micOn}>
                  <i className={`ph-bold ${micOn ? 'ph-microphone' : 'ph-microphone-slash'}`} aria-hidden="true" /><span>{micOn ? 'Mute' : 'Unmute'}</span>
                </button>
                <button type="button" className={`pm-call-control neutral ${speakerOn ? '' : 'muted'}`} onClick={onToggleSpeaker} aria-pressed={!speakerOn}>
                  <i className="ph-bold ph-broadcast" aria-hidden="true" /><span>{speakerOn ? 'Sound' : 'Muted'}</span>
                </button>
                <button type="button" className="pm-call-control neutral" onClick={onMessage}>
                  <i className="ph-bold ph-chat-circle-text" aria-hidden="true" /><span>Message</span>
                </button>
              </>
            ) : null}
            <button type="button" className="pm-call-control decline" onClick={onEnd}>
              <i className="ph-bold ph-phone-disconnect" aria-hidden="true" /><span>{call?.status === 'ringing' ? 'Cancel' : 'Hang up'}</span>
            </button>
          </>
        )}
      </div> : null}
      {call?.status !== 'active' ? <button type="button" className="pm-call-message-link" onClick={onMessage}>
        <i className="ph-bold ph-chat-circle-text" aria-hidden="true" /> Open messages
      </button> : null}
      <div className="pm-remote-audio" aria-hidden="true">
        {Object.entries(remoteStreams || {}).map(([uid, stream]) => <PmRemoteAudio key={uid} muted={!speakerOn} stream={stream} />)}
      </div>
    </div>
  );
}

function PrivateMessagesDock() {
  const [{ sessions: openSessions, activeUid: currentActiveUid }, setSessionState] = useState(snapshotSessions);
  const [authenticatedUid, setAuthenticatedUid] = useState(() => auth.currentUser?.uid || window.currentUser?.uid || '');
  const [messages, setMessages] = useState([]);
  const [messageState, setMessageState] = useState('idle');
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [olderMessagesError, setOlderMessagesError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [sessionSearch, setSessionSearch] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [call, setCall] = useState(null);
  const [callStarting, setCallStarting] = useState(false);
  const [callFriendship, setCallFriendship] = useState({ key: '', status: 'idle' });
  const [callStageMinimized, setCallStageMinimized] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [sending, setSending] = useState(false);
  const [dockOpenVersion, setDockOpenVersion] = useState(0);
  const [dockOpen, setDockOpen] = useState(() => pmDockVisible);
  const [mobileInboxOpen, setMobileInboxOpen] = useState(false);
  const [encryptionVersion, setEncryptionVersion] = useState(0);
  const [passphraseOpen, setPassphraseOpen] = useState(false);
  const messagesRef = useRef(null);
  const composerRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const lastScrolledRoomRef = useRef('');
  const callStartAttemptRef = useRef(0);
  const callStartingRef = useRef(false);
  const messageRoomRef = useRef('');

  const activeSession = useMemo(
    () => openSessions.find((session) => session.targetUid === currentActiveUid) || openSessions[0] || null,
    [currentActiveUid, openSessions],
  );
  const myUid = authenticatedUid;
  const activeTargetUid = activeSession?.targetUid || '';
  const roomId = activeSession && myUid ? roomIdFor(myUid, activeSession.targetUid) : '';
  const callPath = roomId ? `pm_calls/${roomId}` : '';
  const encrypted = Boolean(roomId && pmKeys.has(roomId));
  const scopedCall = call?.roomId === roomId ? call : null;
  const draft = drafts[activeTargetUid] || '';
  const filteredSessions = useMemo(() => {
    const needle = sessionSearch.trim().toLowerCase();
    if (!needle) return openSessions;
    return openSessions.filter((session) => (
      `${session.targetName || ''} ${session.lastText || ''}`.toLowerCase().includes(needle)
    ));
  }, [openSessions, sessionSearch]);
  const callFriendshipKey = myUid && activeTargetUid ? `${myUid}:${activeTargetUid}` : '';
  const friendCallAllowed = Boolean(
    callFriendship.key === callFriendshipKey
    && callFriendship.status === 'accepted'
  );
  const friendCallChecking = Boolean(
    callFriendshipKey
    && (callFriendship.key !== callFriendshipKey || callFriendship.status === 'checking')
  );
  const friendCallError = callFriendship.key === callFriendshipKey
    && ['blocked', 'error'].includes(callFriendship.status)
    ? friendCallOnlyMessage()
    : '';
  const callLive = Boolean(scopedCall && (scopedCall.status === 'ringing' || scopedCall.status === 'active'));
  const friendCallAriaLabel = callLive
    ? 'Open voice call'
    : friendCallChecking
      ? 'Voice calling unavailable — checking friendship'
      : friendCallAllowed
        ? `Call ${activeSession?.targetName || 'this friend'}`
        : 'Voice calling unavailable — accepted friends only';
  const joinedCall = Boolean(friendCallAllowed && myUid
    && scopedCall?.participants?.[myUid]
    && (scopedCall.status === 'ringing' || scopedCall.status === 'active'));
  const callParticipants = Object.values(scopedCall?.participants || {});
  const callBusy = callLive || callStarting;
  const callStageVisible = Boolean(scopedCall
    && ['ringing', 'active', 'cancelled', 'declined', 'missed', 'ended'].includes(scopedCall.status)
    && !callStageMinimized);
  const initialCallStream = roomId ? pendingPmCallStreams.get(roomId) || null : null;
  const {
    remoteStreams,
    engineReady,
    connectionState,
    micOn,
    toggleMic,
    error: callEngineError,
    stop: stopCallEngine,
  } = useDirectAudioCall({
    callPath,
    joined: joinedCall,
    myUid,
    participants: callParticipants,
    initialStream: initialCallStream,
  });

  useEffect(() => {
    if (!callFriendshipKey) return undefined;
    return onValue(ref(db, `friends/${myUid}/${activeTargetUid}`), (snapshot) => {
      setCallFriendship({
        key: callFriendshipKey,
        status: snapshot.val() === 'accepted' ? 'accepted' : 'blocked',
      });
    }, () => {
      setCallFriendship({ key: callFriendshipKey, status: 'error' });
    });
  }, [activeTargetUid, callFriendshipKey, myUid]);

  useEffect(() => {
    const listener = () => setSessionState(snapshotSessions());
    listeners.add(listener);
    listener();
    return () => listeners.delete(listener);
  }, []);

  useEffect(() => {
    if (!myUid) return undefined;
    applyPmInboxSessions(window.latestPmInbox || {});
    const handleInbox = (event) => applyPmInboxSessions(event.detail?.inbox || {});
    window.addEventListener('minimalist:pm-inbox', handleInbox);
    return () => window.removeEventListener('minimalist:pm-inbox', handleInbox);
  }, [myUid]);

  useEffect(() => {
    if (!dockOpen || !activeTargetUid || !myUid) return;
    activeUid = activeTargetUid;
    window.currentPmTargetUid = activeTargetUid;
    window.currentPmRoomId = roomId;
    upsertSession(activeTargetUid, { unread: false });
    set(ref(db, `inbox/${myUid}/${activeTargetUid}/read`), true).catch(() => {});
    remove(ref(db, `notifications/${myUid}/message_${activeTargetUid}`)).catch(() => {});
  }, [activeTargetUid, dockOpen, myUid, roomId]);

  useEffect(() => {
    if (!dockOpen || !roomId || !myUid) return undefined;

    let cancelled = false;
    const preserveVisibleHistory = messageRoomRef.current === roomId;
    messageRoomRef.current = roomId;
    const loadingFrame = window.requestAnimationFrame(() => {
      setOlderMessagesError('');
      setLoadingOlderMessages(false);
      if (!preserveVisibleHistory) setMessages([]);
      setMessageState(preserveVisibleHistory ? 'ready' : 'loading');
    });
    const messagesQuery = query(
      ref(db, `private_messages/${roomId}`),
      orderByKey(),
      limitToLast(PM_HISTORY_PAGE_SIZE),
    );
    const unsubscribe = onValue(messagesQuery, async (snapshot) => {
      window.cancelAnimationFrame(loadingFrame);
      const nextMessages = [];
      snapshot.forEach((child) => {
        nextMessages.push({ id: child.key, ...child.val() });
      });

      const decrypted = await Promise.all(nextMessages.map(async (message) => ({
        ...message,
        decryptedText: await cachedDecryptPmText(roomId, message, encryptionVersion),
      })));

      if (cancelled) return;

      setMessages((current) => mergePmMessagePages(preserveVisibleHistory ? current : [], decrypted));
      setHasOlderMessages(pmHistoryMayHaveOlder(nextMessages.length));
      setLoadingOlderMessages(false);
      setOlderMessagesError('');
      setMessageState('ready');
    }, () => {
      if (!cancelled) {
        window.cancelAnimationFrame(loadingFrame);
        setLoadingOlderMessages(false);
        if (!preserveVisibleHistory) setMessages([]);
        setMessageState(preserveVisibleHistory ? 'stale' : 'error');
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(loadingFrame);
      unsubscribe();
    };
  }, [dockOpen, encryptionVersion, myUid, roomId]);

  const loadOlderMessages = useCallback(async () => {
    const cursor = pmHistoryCursor(messages);
    if (!cursor || !roomId || !myUid || loadingOlderMessages) return;

    const requestedRoomId = roomId;
    const list = messagesRef.current;
    const previousScrollHeight = list?.scrollHeight || 0;
    const previousScrollTop = list?.scrollTop || 0;
    stickToBottomRef.current = false;
    setLoadingOlderMessages(true);
    setOlderMessagesError('');

    try {
      const olderQuery = query(
        ref(db, `private_messages/${requestedRoomId}`),
        orderByKey(),
        endBefore(cursor),
        limitToLast(PM_HISTORY_PAGE_SIZE),
      );
      const snapshot = await get(olderQuery);
      const olderMessages = [];
      snapshot.forEach((child) => olderMessages.push({ id: child.key, ...child.val() }));
      const decrypted = await Promise.all(olderMessages.map(async (message) => ({
        ...message,
        decryptedText: await cachedDecryptPmText(requestedRoomId, message, encryptionVersion),
      })));

      if (messageRoomRef.current !== requestedRoomId) return;
      setMessages((current) => mergePmMessagePages(decrypted, current));
      setHasOlderMessages(pmHistoryMayHaveOlder(olderMessages.length));
      setMessageState('ready');

      window.requestAnimationFrame(() => {
        const currentList = messagesRef.current;
        if (!currentList || messageRoomRef.current !== requestedRoomId) return;
        currentList.scrollTop = previousScrollTop + (currentList.scrollHeight - previousScrollHeight);
      });
    } catch (error) {
      if (messageRoomRef.current === requestedRoomId) {
        setOlderMessagesError(error?.message || 'Older messages could not be loaded.');
      }
    } finally {
      if (messageRoomRef.current === requestedRoomId) setLoadingOlderMessages(false);
    }
  }, [encryptionVersion, loadingOlderMessages, messages, myUid, roomId]);

  useEffect(() => {
    if (!messages.length || !roomId || !myUid) return;
    const popup = document.getElementById('pm-popup');
    if (!popup || popup.classList.contains('hidden') || popup.classList.contains('pm-call-dock-minimized')) return;
    const readAt = Date.now();
    const readUpdates = {};
    messages
      .filter((message) => message.uid !== myUid && !message.readBy?.[myUid])
      .forEach((message) => {
        readUpdates[`private_messages/${roomId}/${message.id}/readBy/${myUid}`] = readAt;
      });
    if (Object.keys(readUpdates).length) update(ref(db), readUpdates).catch(() => {});
  }, [dockOpenVersion, messages, myUid, roomId]);

  useEffect(() => {
    if (!callPath || (!dockOpen && !callLive && !callStarting)) return undefined;
    const callRef = ref(db, callPath);
    const handleCall = (snapshot) => setCall(snapshot.val());
    onValue(callRef, handleCall);
    return () => off(callRef, 'value', handleCall);
  }, [callLive, callPath, callStarting, dockOpen]);

  useEffect(() => () => {
    callStartAttemptRef.current += 1;
    callStartingRef.current = false;
    setCallStarting(false);
    const pendingStream = pendingPmCallStreams.get(roomId);
    stopMediaStream(pendingStream);
    pendingPmCallStreams.delete(roomId);
  }, [roomId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSearch('');
      setSearchOpen(false);
      setCallStageMinimized(false);
      setSpeakerOn(true);
      stickToBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [roomId]);

  useEffect(() => {
    const list = messagesRef.current;
    if (!list || callStageVisible) return;
    const switchedRooms = lastScrolledRoomRef.current !== roomId;
    if (!switchedRooms && !stickToBottomRef.current) return;
    lastScrolledRoomRef.current = roomId;
    window.requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight, behavior: switchedRooms ? 'auto' : 'smooth' }));
  }, [callStageVisible, messages, roomId]);

  useEffect(() => {
    if (!scopedCall || scopedCall.status !== 'ringing' || scopedCall.callerUid !== myUid) return undefined;
    const remaining = Math.max(0, Number(scopedCall.expiresAt || 0) - Date.now());
    const timer = window.setTimeout(() => {
      runTransaction(ref(db, `${callPath}/status`), (status) => (
        status === 'ringing' ? 'missed' : undefined
      ), { applyLocally: false }).then((result) => (
        result.committed ? set(ref(db, `${callPath}/endedAt`), serverTimestamp()) : null
      )).catch(() => {});
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [callPath, myUid, scopedCall]);

  useEffect(() => {
    if (!scopedCall || !myUid || !['cancelled', 'declined', 'missed', 'ended'].includes(scopedCall.status)) return undefined;
    const timer = window.setTimeout(() => remove(ref(db, callPath)).catch(() => {}), 5000);
    return () => window.clearTimeout(timer);
  }, [callPath, myUid, scopedCall]);

  useEffect(() => {
    if (!scopedCall || !myUid || !['cancelled', 'declined', 'missed', 'ended'].includes(scopedCall.status)) return undefined;
    stopCallEngine();
    stopMediaStream(pendingPmCallStreams.get(roomId));
    pendingPmCallStreams.delete(roomId);
    remove(ref(db, `${callPath}/participants/${myUid}`)).catch(() => {});
    remove(ref(db, `${callPath}/signals/${myUid}`)).catch(() => {});
    return undefined;
  }, [callPath, myUid, roomId, scopedCall, stopCallEngine]);

  useEffect(() => {
    if (engineReady && roomId) pendingPmCallStreams.delete(roomId);
  }, [engineReady, roomId]);

  useEffect(() => {
    const popup = document.getElementById('pm-popup');
    if (callLive || !popup?.classList.contains('pm-call-dock-minimized')) return;
    popup.classList.remove('pm-call-dock-minimized');
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');
    window.currentPmRoomId = null;
    window.currentPmTargetUid = null;
  }, [callLive]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const popup = document.getElementById('pm-popup');
    if (!dockOpen || !viewport || !popup) return undefined;
    let frame = 0;

    const syncViewport = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        popup.style.setProperty('--pm-viewport-height', `${Math.round(viewport.height)}px`);
        popup.style.setProperty('--pm-viewport-top', `${Math.max(0, Math.round(viewport.offsetTop))}px`);
      });
    };

    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
      if (frame) window.cancelAnimationFrame(frame);
      popup.style.removeProperty('--pm-viewport-height');
      popup.style.removeProperty('--pm-viewport-top');
    };
  }, [dockOpen]);

  useEffect(() => {
    const handleDockOpen = (event) => {
      setDockOpen(true);
      setCallStageMinimized(false);
      setMobileInboxOpen(!event.detail?.targetUid);
      setSessionSearch('');
      setSearch('');
      setSearchOpen(false);
      setPassphraseOpen(false);
      stickToBottomRef.current = true;
      if (event.detail?.changed) {
        setMessages([]);
        setMessageState('loading');
      }
      setDockOpenVersion((version) => version + 1);
    };
    const handleDockClose = () => setDockOpen(false);
    window.addEventListener('minimalist:pm-dock-open', handleDockOpen);
    window.addEventListener('minimalist:pm-dock-close', handleDockClose);
    return () => {
      window.removeEventListener('minimalist:pm-dock-open', handleDockOpen);
      window.removeEventListener('minimalist:pm-dock-close', handleDockClose);
    };
  }, []);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    const nextUid = user?.uid || '';
    callStartAttemptRef.current += 1;
    callStartingRef.current = false;
    setCallStarting(false);
    scopePmStateToUser(nextUid);
    setAuthenticatedUid(nextUid);
    if (!nextUid) {
      setMessages([]);
      setMessageState('idle');
      document.getElementById('pm-popup')?.classList.add('hidden');
    }
  }), []);

  useEffect(() => {
    livePmCallTargetUid = callLive ? activeTargetUid : null;
    return () => {
      if (livePmCallTargetUid === activeTargetUid) livePmCallTargetUid = null;
    };
  }, [activeTargetUid, callLive]);

  const closeDock = useCallback((options) => {
    const restoreOrigin = options?.restoreOrigin !== false;
    const popup = document.getElementById('pm-popup');
    if (callLive) {
      pmDockVisible = false;
      popup?.classList.add('pm-call-dock-minimized');
      popup?.classList.remove('hidden');
      popup?.setAttribute('aria-hidden', 'false');
      setCallStageMinimized(true);
      window.currentPmRoomId = null;
      window.currentPmTargetUid = null;
      window.dispatchEvent(new CustomEvent('minimalist:pm-dock-close', { detail: { keepCall: true } }));
      if (!restoreOrigin) {
        pmReturnSurface = null;
        pmDockOpener = null;
      }
      window.showToast?.('Call minimized. Use the call bar to return or hang up.', false);
      return;
    }
    if (callStarting) {
      callStartAttemptRef.current += 1;
      callStartingRef.current = false;
      stopMediaStream(pendingPmCallStreams.get(roomId));
      pendingPmCallStreams.delete(roomId);
      setCallStarting(false);
    }
    finishPmDockClose({ restoreOrigin });
  }, [callLive, callStarting, roomId]);

  const closeSession = useCallback((targetUid) => {
    if (callBusy && targetUid === activeTargetUid) {
      setCallStageMinimized(false);
      window.showToast?.(callStarting ? 'Cancel call setup by closing private messages first.' : 'End the call before closing this conversation.');
      return;
    }
    sessions.delete(targetUid);
    if (activeUid === targetUid) activeUid = sessions.keys().next().value || null;
    if (!activeUid) closeDock();
    emitSessions();
  }, [activeTargetUid, callBusy, callStarting, closeDock]);

  const pickSession = useCallback((targetUid) => {
    if (callBusy && targetUid !== activeTargetUid) {
      setCallStageMinimized(false);
      window.showToast?.(callStarting ? 'Wait for call setup to finish before switching conversations.' : 'Finish the current call before switching conversations.');
      return;
    }
    const sameSession = targetUid === activeTargetUid;
    if (!sameSession) {
      setMessages([]);
      setMessageState('loading');
      activeUid = targetUid;
    }
    setMobileInboxOpen(false);
    emitSessions();
  }, [activeTargetUid, callBusy, callStarting]);

  const startNewMessage = useCallback(() => {
    if (callBusy) {
      setCallStageMinimized(false);
      window.showToast?.(callStarting ? 'Wait for call setup to finish before starting another conversation.' : 'Finish the current call before starting another conversation.');
      return;
    }
    closeDock({ restoreOrigin: false });
    window.openContactsPanel?.();
  }, [callBusy, callStarting, closeDock]);

  const restoreCallDock = useCallback(() => {
    showPmDock(activeTargetUid);
    setCallStageMinimized(false);
  }, [activeTargetUid]);

  useEffect(() => {
    window.closePrivateChatDock = closeDock;
    const handleKeydown = (event) => {
      if (event.defaultPrevented || event.key !== 'Escape' || document.getElementById('pm-popup')?.classList.contains('hidden')) return;
      if (passphraseOpen) {
        event.preventDefault();
        setPassphraseOpen(false);
        return;
      }
      event.preventDefault();
      closeDock();
    };
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      if (window.closePrivateChatDock === closeDock) delete window.closePrivateChatDock;
    };
  }, [closeDock, passphraseOpen]);

  const toggleEncryption = useCallback(async () => {
    if (!roomId) return;
    if (pmKeys.has(roomId)) {
      pmKeys.delete(roomId);
      setEncryptionVersion((value) => value + 1);
      window.showToast?.('Encrypted messages disabled for this PM window.', false);
      return;
    }

    if (!crypto?.subtle) {
      window.showToast?.('This browser does not support encrypted PMs.');
      return;
    }

    setPassphraseOpen(true);
  }, [roomId]);

  const submitPassphrase = useCallback(async (event) => {
    event.preventDefault();
    if (!roomId) return;
    const formData = new FormData(event.currentTarget);
    const passphrase = String(formData.get('passphrase') || '');
    if (!passphrase.trim()) return;
    try {
      pmKeys.set(roomId, await derivePmKey(roomId, passphrase));
      setEncryptionVersion((value) => value + 1);
      setPassphraseOpen(false);
      window.showToast?.('Encrypted messages enabled for this PM window.', false);
    } catch (error) {
      window.showToast?.(`Could not enable encrypted messages: ${error.message}`);
    }
  }, [roomId]);

  const sendMessage = useCallback(async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !roomId || !activeSession || !myUid || sending) return;

    setSending(true);
    try {
      const messagePayload = await encryptPmText(roomId, text);
      await push(ref(db, `private_messages/${roomId}`), {
        uid: myUid,
        ...messagePayload,
        readBy: { [myUid]: Date.now() },
        timestamp: serverTimestamp(),
      });

      await set(ref(db, `inbox/${myUid}/${activeSession.targetUid}`), {
        fromName: activeSession.targetName,
        senderUid: activeSession.targetUid,
        timestamp: Date.now(),
        lastText: messagePayload.encrypted ? 'Encrypted message' : text,
        read: true,
      });

      upsertSession(activeSession.targetUid, { lastText: text, timestamp: Date.now(), unread: false });
      setDrafts((current) => ({ ...current, [activeSession.targetUid]: '' }));
      if (composerRef.current) composerRef.current.style.height = 'auto';
      stickToBottomRef.current = true;
      void playUiSound('message-sent');
    } catch (error) {
      void playUiSound('error');
      window.showToast?.(`Message not sent: ${error.message || error}`);
    } finally {
      setSending(false);
    }
  }, [activeSession, draft, myUid, roomId, sending]);

  const startVoiceCall = useCallback(async () => {
    if (!roomId || !myUid || !activeSession || callStartingRef.current) return;
    const attemptId = callStartAttemptRef.current + 1;
    callStartAttemptRef.current = attemptId;
    callStartingRef.current = true;
    setCallStarting(true);
    let stream = null;
    let reserved = false;
    try {
      if (!(await hasAcceptedPmFriendship(myUid, activeSession.targetUid))) {
        throw new Error(friendCallOnlyMessage());
      }
      setCallFriendship({ key: `${myUid}:${activeSession.targetUid}`, status: 'accepted' });
      stream = await requestPmAudio();
      if (callStartAttemptRef.current !== attemptId) {
        stopMediaStream(stream);
        return;
      }
      pendingPmCallStreams.set(roomId, stream);
      const createdAt = Date.now();
      const user = auth.currentUser || window.currentUser;
      const callerName = window.userProfileName || user?.displayName || 'Someone';
      const nextCall = {
        status: 'ringing',
        type: 'voice',
        roomId,
        hostUid: myUid,
        callerUid: myUid,
        callerName,
        callerPhotoUrl: window.userPhotoUrl || user?.photoURL || '',
        calleeUid: activeSession.targetUid,
        calleeName: activeSession.targetName,
        calleePhotoUrl: activeSession.photoUrl || '',
        createdAt,
        expiresAt: createdAt + PM_CALL_RING_MS,
        participants: { [myUid]: userCallParticipant(user) },
      };
      const reservation = await runTransaction(ref(db, callPath), (existing) => {
        const terminal = ['cancelled', 'declined', 'missed', 'ended'].includes(existing?.status);
        const expired = existing?.status === 'ringing' && Number(existing.expiresAt || 0) <= Date.now();
        if (existing && !terminal && !expired) return undefined;
        return nextCall;
      }, { applyLocally: false });
      if (!reservation.committed) {
        throw new Error('This conversation already has a call in progress.');
      }
      reserved = true;
      if (callStartAttemptRef.current !== attemptId) {
        const cancelledError = new Error('Call setup was cancelled.');
        cancelledError.code = 'pm-call/cancelled';
        throw cancelledError;
      }
      setCall(reservation.snapshot.val() || nextCall);
      const participantRef = ref(db, `${callPath}/participants/${myUid}`);
      onDisconnect(participantRef).remove();
      push(ref(db, `private_messages/${roomId}`), {
        uid: myUid,
        type: PM_CALL_EVENT_TYPE,
        roomId,
        callCreatedAt: createdAt,
        text: 'Voice call',
        readBy: { [myUid]: Date.now() },
        timestamp: serverTimestamp(),
      }).catch((error) => console.debug('Call history event unavailable', error));
      upsertSession(activeSession.targetUid, { lastText: 'Voice call', timestamp: createdAt, unread: false });
      setCallStageMinimized(false);
    } catch (error) {
      if (pendingPmCallStreams.get(roomId) === stream) pendingPmCallStreams.delete(roomId);
      stopMediaStream(stream);
      if (reserved) {
        runTransaction(ref(db, `${callPath}/status`), (status) => (
          status === 'ringing' ? 'cancelled' : undefined
        ), { applyLocally: false }).then((result) => (
          result.committed ? set(ref(db, `${callPath}/endedAt`), serverTimestamp()) : null
        )).catch(() => {});
      }
      if (error?.code !== 'pm-call/cancelled') {
        const message = isPmCallPermissionDenied(error) ? friendCallOnlyMessage() : error.message || error;
        window.showToast?.(`Voice call failed: ${message}`);
      }
    } finally {
      if (callStartAttemptRef.current === attemptId) {
        callStartingRef.current = false;
        setCallStarting(false);
      }
    }
  }, [activeSession, callPath, myUid, roomId]);

  useEffect(() => {
    const intent = pendingPmVoiceCallIntent;
    if (!intent || !dockOpen || intent.targetUid !== activeTargetUid) return undefined;
    if (Number(intent.callIntentExpiresAt || 0) <= Date.now()) {
      pendingPmVoiceCallIntent = null;
      window.showToast?.('The confirmed call expired. Ask Winston to prepare it again.');
      return undefined;
    }
    const expiryTimer = window.setTimeout(() => {
      if (pendingPmVoiceCallIntent === intent) {
        pendingPmVoiceCallIntent = null;
        window.showToast?.('The confirmed call expired. Ask Winston to prepare it again.');
      }
    }, Math.max(1, Number(intent.callIntentExpiresAt) - Date.now()));
    if (callLive) {
      pendingPmVoiceCallIntent = null;
      window.clearTimeout(expiryTimer);
      return undefined;
    }
    if (!friendCallChecking && !friendCallAllowed) {
      pendingPmVoiceCallIntent = null;
      window.clearTimeout(expiryTimer);
      window.showToast?.(friendCallOnlyMessage());
      return undefined;
    }
    if (callStarting || !friendCallAllowed) return () => window.clearTimeout(expiryTimer);
    pendingPmVoiceCallIntent = null;
    window.clearTimeout(expiryTimer);
    window.setTimeout(() => void startVoiceCall(), 0);
    return undefined;
  }, [activeTargetUid, callLive, callStarting, dockOpen, dockOpenVersion, friendCallAllowed, friendCallChecking, startVoiceCall]);

  const answerVoiceCall = useCallback(() => acceptPmCall(scopedCall, { openDock: false }), [scopedCall]);
  const declineVoiceCall = useCallback(() => declinePmCall(scopedCall), [scopedCall]);

  const endVoiceCall = useCallback(async () => {
    if (!callPath || !myUid || !scopedCall) return;
    stopCallEngine();
    stopMediaStream(pendingPmCallStreams.get(roomId));
    pendingPmCallStreams.delete(roomId);
    const nextStatus = scopedCall.status === 'ringing' ? 'cancelled' : 'ended';
    const result = await runTransaction(ref(db, `${callPath}/status`), (status) => (
      status === scopedCall.status ? nextStatus : undefined
    ), { applyLocally: false });
    if (result.committed) {
      await set(ref(db, `${callPath}/endedAt`), serverTimestamp());
      window.showToast?.(nextStatus === 'cancelled' ? 'Call cancelled.' : 'Call ended.', false);
    }
  }, [callPath, myUid, roomId, scopedCall, stopCallEngine]);

  const visibleMessages = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((message) => String(message.decryptedText || '').toLowerCase().includes(needle));
  }, [messages, search]);

  return (
    <>
      {callLive ? (
        <div className="pm-persistent-call-bar" role="status" aria-label={`Voice call with ${activeSession?.targetName || 'contact'}`}>
          <button type="button" className="pm-persistent-call-main" onClick={restoreCallDock}>
            <span className="pm-persistent-call-icon"><i className="ph-bold ph-broadcast" aria-hidden="true" /></span>
            <span><strong>{activeSession?.targetName || 'Private call'}</strong><small>{connectionState === 'connected' ? 'Connected' : callStateLabel(scopedCall, myUid)}</small></span>
          </button>
          <button type="button" className={micOn ? '' : 'active'} onClick={toggleMic} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} aria-pressed={!micOn}>
            <i className={`ph-bold ${micOn ? 'ph-microphone' : 'ph-microphone-slash'}`} aria-hidden="true" />
          </button>
          <button type="button" className="end" onClick={endVoiceCall} aria-label="End voice call">
            <i className="ph-bold ph-phone-disconnect" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className={`pm-shell ${mobileInboxOpen ? 'show-inbox' : ''} ${callStageVisible ? 'call-mode' : ''}`}>
      <aside className="pm-sidebar">
        <div className="pm-sidebar-title">
          <span>
            <strong>Direct messages</strong>
            <small>{openSessions.length ? `${openSessions.length} open conversation${openSessions.length === 1 ? '' : 's'}` : 'Private conversations'}</small>
          </span>
          <div className="pm-sidebar-actions">
            <button type="button" className="pm-sidebar-compose" onClick={startNewMessage} aria-label="Start a new private message" title="New message"><i className="ph-bold ph-pencil-simple-line" aria-hidden="true" /></button>
            <button type="button" className="pm-sidebar-close" onClick={closeDock} aria-label="Close private messages"><i className="ph-bold ph-x" aria-hidden="true" /></button>
          </div>
        </div>
        <label className="pm-session-search">
          <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          <input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search messages" aria-label="Search private message conversations" />
          {sessionSearch ? <button type="button" onClick={() => setSessionSearch('')} aria-label="Clear conversation search"><i className="ph-bold ph-x" aria-hidden="true" /></button> : null}
        </label>
        <div className="pm-session-list">
          {filteredSessions.length ? filteredSessions.map((session) => (
            <SessionButton
              active={session.targetUid === activeSession?.targetUid}
              key={session.targetUid}
              onClose={() => closeSession(session.targetUid)}
              onPick={() => pickSession(session.targetUid)}
              session={session}
            />
          )) : (
            <div className="pm-session-empty-state">
              <span><i className={`ph-bold ${sessionSearch ? 'ph-magnifying-glass' : 'ph-chat-circle'}`} aria-hidden="true" /></span>
              <strong>{sessionSearch ? 'No conversations found' : 'Your private inbox'}</strong>
              <small>{sessionSearch ? 'Try another name or message.' : 'Choose a contact to start a focused conversation.'}</small>
              {!sessionSearch ? <button type="button" onClick={startNewMessage}>New message</button> : null}
            </div>
          )}
        </div>
      </aside>

      <section className="pm-main">
        <header className="pm-header">
          <button type="button" className="pm-mobile-back" onClick={() => setMobileInboxOpen(true)} aria-label="Back to private message conversations">
            <i className="ph-bold ph-arrow-left" aria-hidden="true" />
          </button>
          <button type="button" className="pm-header-avatar" onClick={() => activeSession && window.viewUserProfile?.(activeSession.targetUid)} aria-label={activeSession ? `Open ${activeSession.targetName}'s profile` : 'Private messages'}>
            {normalizeStoredAvatarUrl(activeSession?.photoUrl) ? <img src={normalizeStoredAvatarUrl(activeSession?.photoUrl)} alt="" /> : String(activeSession?.targetName || 'PM').slice(0, 2).toUpperCase()}
          </button>
          <div className="pm-title-wrap">
            <span id="pm-target-name">{activeSession?.targetName || 'Private messages'}</span>
            <small>{callLive ? callStateLabel(scopedCall, myUid) : encrypted ? 'Encrypted conversation' : 'Private conversation'}</small>
          </div>
          <div className="pm-header-actions">
            <button type="button" className={`pm-action-btn ${searchOpen ? 'active' : ''}`} title="Search conversation" aria-label="Search conversation" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}>
              <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
            </button>
            <button type="button" className={`pm-action-btn pm-call-action ${callLive ? 'active' : ''}`} id="pm-call-btn" title={callLive ? 'Open voice call' : friendCallChecking ? 'Checking friendship' : friendCallAllowed ? 'Start voice call' : friendCallOnlyMessage()} aria-label={friendCallAriaLabel} aria-busy={callStarting || friendCallChecking} disabled={!activeSession || callStarting || (!callLive && !friendCallAllowed)} onClick={callLive ? () => setCallStageMinimized(false) : startVoiceCall}>
              <i className="ph-bold ph-phone-call" aria-hidden="true" /><span>{callLive ? 'Return to call' : callStarting ? 'Starting…' : friendCallChecking ? 'Checking…' : 'Call'}</span>
            </button>
            <button type="button" className="pm-close" id="pm-close-btn" title="Close" aria-label="Close private messages" onClick={closeDock}><i className="ph-bold ph-x" aria-hidden="true" /></button>
          </div>
        </header>

        {activeSession && !callStageVisible ? (
          <div id="pm-e2e-status" className={`pm-thread-utility-row ${encrypted ? 'active' : ''}`}>
            <button
              type="button"
              className={`pm-security-chip ${encrypted ? 'active' : ''}`}
              id="pm-e2e-btn"
              title={encrypted ? 'Encrypted messages on' : 'Enable encrypted messages'}
              aria-label={encrypted ? 'Encrypted messages on' : 'Enable encrypted messages'}
              aria-pressed={encrypted}
              onClick={toggleEncryption}
            >
              <i className={`ph-bold ${encrypted ? 'ph-shield-check' : 'ph-lock-key-open'}`} aria-hidden="true" />
              <span>{encrypted ? 'Encrypted before upload' : 'Encryption is off'}</span>
            </button>
          </div>
        ) : null}

        {searchOpen && !callStageVisible ? (
          <div className="pm-search-row">
            <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
            <input autoFocus id="pm-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this conversation" aria-label="Search this private message conversation" />
            {search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><i className="ph-bold ph-x" aria-hidden="true" /></button> : null}
          </div>
        ) : null}

        {callStageVisible ? (
          <DirectCallStage
             call={scopedCall}
             myUid={myUid}
             engineReady={engineReady}
             connectionState={connectionState}
             micOn={micOn}
             speakerOn={speakerOn}
            error={friendCallError || callEngineError}
            remoteStreams={remoteStreams}
            onAnswer={answerVoiceCall}
            onDecline={declineVoiceCall}
            onEnd={endVoiceCall}
             onMessage={() => setCallStageMinimized(true)}
             onToggleMic={toggleMic}
             onToggleSpeaker={() => setSpeakerOn((enabled) => !enabled)}
           />
        ) : (
          <>
            {callLive ? (
              <button type="button" className="pm-call-mini" onClick={() => setCallStageMinimized(false)}>
                <span><i className="ph-bold ph-broadcast" aria-hidden="true" /> {callStateLabel(scopedCall, myUid)}</span>
                <strong>{callParticipants.length} connected</strong>
              </button>
            ) : null}
            <ul
              id="pm-messages"
              ref={messagesRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              onScroll={(event) => {
                const list = event.currentTarget;
                stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
              }}
            >
              {!activeSession ? <li className="pm-empty-message">Choose a conversation to begin.</li> : null}
              {activeSession && messageState === 'loading' ? (
                <li className="pm-thread-state" role="status"><span className="pm-thread-spinner" aria-hidden="true" /> Loading conversation…</li>
              ) : null}
              {activeSession && messageState === 'error' ? (
                <li className="pm-thread-state error"><i className="ph-bold ph-warning-circle" aria-hidden="true" /> This conversation could not be loaded.</li>
              ) : null}
              {activeSession && messageState === 'stale' ? (
                <li className="pm-thread-state stale"><i className="ph-bold ph-cloud-slash" aria-hidden="true" /> Showing saved messages. Reconnect to refresh.</li>
              ) : null}
              {activeSession && !search && (messageState === 'ready' || messageState === 'stale') && (hasOlderMessages || loadingOlderMessages || olderMessagesError) ? (
                <li className={`pm-history-control ${olderMessagesError ? 'error' : ''}`}>
                  {olderMessagesError ? <span>{olderMessagesError}</span> : null}
                  <button type="button" disabled={loadingOlderMessages} onClick={loadOlderMessages}>
                    <i className={`ph-bold ${loadingOlderMessages ? 'ph-circle-notch' : 'ph-clock-counter-clockwise'}`} aria-hidden="true" />
                    {loadingOlderMessages ? 'Loading history…' : olderMessagesError ? 'Try older messages again' : 'Load older messages'}
                  </button>
                </li>
              ) : null}
              {activeSession && (messageState === 'ready' || messageState === 'stale') ? visibleMessages.map((message, index) => {
                const previousMessage = visibleMessages[index - 1];
                const showDay = !previousMessage || conversationDayKey(previousMessage.timestamp) !== conversationDayKey(message.timestamp);
                return (
                  <Fragment key={message.id}>
                    {showDay ? (
                      <li className="pm-date-divider" aria-label={`Messages from ${formatConversationDay(message.timestamp)}`}>
                        <span>{formatConversationDay(message.timestamp)}</span>
                      </li>
                    ) : null}
                    <PmMessage
                      activeSession={activeSession}
                      grouped={messagesShareGroup(previousMessage, message)}
                      message={message}
                      myUid={myUid}
                      onCallBack={startVoiceCall}
                      roomId={roomId}
                    />
                  </Fragment>
                );
              }) : null}
              {activeSession && (messageState === 'ready' || messageState === 'stale') && search && !visibleMessages.length ? <li className="pm-empty-message">No matching messages.</li> : null}
              {activeSession && (messageState === 'ready' || messageState === 'stale') && !search && !visibleMessages.length ? (
                <li className="pm-conversation-empty">
                  <span className="pm-conversation-empty-avatar">
                    {normalizeStoredAvatarUrl(activeSession.photoUrl) ? <img src={normalizeStoredAvatarUrl(activeSession.photoUrl)} alt="" /> : String(activeSession.targetName || '?').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="pm-conversation-orbit" aria-hidden="true"><i /><i /><i /></span>
                  <strong>A quiet place for you two</strong>
                  <p>{friendCallAllowed
                    ? `Send ${activeSession.targetName} a focused message or start a private voice call.`
                    : `Send ${activeSession.targetName} a focused message. Voice calls are available after you become accepted friends.`}</p>
                  <div>
                    <button type="button" className="primary" aria-label={friendCallAriaLabel} aria-busy={callStarting || friendCallChecking} disabled={callStarting || !friendCallAllowed} onClick={startVoiceCall}><i className="ph-bold ph-phone-call" aria-hidden="true" /> {callStarting ? 'Starting…' : friendCallChecking ? 'Checking friendship…' : friendCallAllowed ? 'Start call' : 'Friends only'}</button>
                    <button type="button" onClick={() => window.viewUserProfile?.(activeSession.targetUid)}><i className="ph-bold ph-user" aria-hidden="true" /> View profile</button>
                  </div>
                </li>
              ) : null}
            </ul>

            <form id="pm-form" onSubmit={sendMessage}>
              <div className="pm-composer-field">
                <textarea
                  id="pm-input"
                  ref={composerRef}
                  autoComplete="off"
                  rows="1"
                  placeholder={activeSession ? `Message ${activeSession.targetName}…` : 'Pick a PM…'}
                  value={draft}
                  onChange={(event) => {
                    setDrafts((current) => ({ ...current, [activeTargetUid]: event.target.value }));
                    event.target.style.height = 'auto';
                    event.target.style.height = `${Math.min(event.target.scrollHeight, 96)}px`;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  disabled={!activeSession || sending}
                  aria-describedby="pm-composer-hint"
                  aria-label={activeSession ? `Message ${activeSession.targetName}` : 'Pick a PM before typing'}
                />
                <span className="pm-composer-hint" id="pm-composer-hint">Enter to send · Shift + Enter for a new line</span>
              </div>
              <button type="submit" disabled={!activeSession || !draft.trim() || sending} aria-label={sending ? 'Sending private message' : 'Send private message'}>
                <i className={`ph-bold ${sending ? 'ph-circle-notch' : 'ph-paper-plane-tilt'}`} aria-hidden="true" />
              </button>
            </form>
          </>
        )}

        {passphraseOpen ? (
          <div className="pm-passphrase-overlay" role="dialog" aria-modal="true" aria-labelledby="pm-passphrase-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setPassphraseOpen(false); }}>
            <form className="pm-passphrase-card" onSubmit={submitPassphrase}>
              <div className="pm-passphrase-head">
                <div>
                  <span>Encrypted PM</span>
                  <h3 id="pm-passphrase-title">Shared passphrase</h3>
                </div>
                <button type="button" onClick={() => setPassphraseOpen(false)} aria-label="Close passphrase dialog"><i className="ph-bold ph-x" aria-hidden="true" /></button>
              </div>
              <p>The other person must enter the same passphrase to read encrypted messages in this PM.</p>
              <input
                autoFocus
                name="passphrase"
                type="password"
                autoComplete="off"
                placeholder="Enter shared passphrase..."
                aria-label="Shared passphrase"
              />
              <div className="pm-passphrase-actions">
                <button type="button" onClick={() => setPassphraseOpen(false)}>Cancel</button>
                <button type="submit">Enable</button>
              </div>
            </form>
          </div>
        ) : null}
      </section>
      </div>
    </>
  );
}

async function startPrivateCallWithFriend(value = {}) {
  const userUid = auth.currentUser?.uid || window.currentUser?.uid || '';
  const targetUid = String(value.targetUid || '').trim();
  const targetName = String(value.targetName || '').trim().slice(0, 120);
  const threadId = String(value.threadId || '').trim();
  const callIntentExpiresAt = Math.floor(Number(value.callIntentExpiresAt) || 0);
  const expectedThread = expectedPmThreadId(userUid, targetUid);
  if (
    !expectedThread
    || threadId !== expectedThread
    || !targetName
    || callIntentExpiresAt <= Date.now()
    || callIntentExpiresAt > Date.now() + (5 * 60 * 1000)
  ) {
    throw new Error('Winston’s call confirmation is invalid or expired.');
  }
  if (!(await hasAcceptedPmFriendship(userUid, targetUid))) {
    throw new Error(friendCallOnlyMessage());
  }
  if (livePmCallTargetUid && livePmCallTargetUid !== targetUid) {
    throw new Error('Finish the current call before starting another one.');
  }
  if (livePmCallTargetUid === targetUid) {
    openPrivateMessagesDock(targetUid, targetName);
    return true;
  }
  pendingPmVoiceCallIntent = { targetUid, threadId, callIntentExpiresAt };
  openPrivateMessagesDock(targetUid, targetName);
  return true;
}

function openPrivateMessagesDock(targetUid, targetName, options = {}) {
  if (!targetUid) return;
  scopePmStateToUser(auth.currentUser?.uid || window.currentUser?.uid || '');
  pmReturnSurface = options.returnTo === 'contacts' ? 'contacts' : null;
  const popup = document.getElementById('pm-popup');
  const sameVisibleTarget = pmDockVisible
    && activeUid === targetUid
    && popup
    && !popup.classList.contains('hidden');
  const previous = sessions.get(targetUid);
  upsertSession(targetUid, {
    targetName,
    photoUrl: options.photoUrl || '',
    open: true,
    unread: false,
    timestamp: sameVisibleTarget ? previous?.timestamp || Date.now() : Date.now(),
  });
  showPmDock(targetUid, { opener: options.opener });
}

window.openPrivateChat = openPrivateMessagesDock;
window.startPrivateCallWithFriend = startPrivateCallWithFriend;
window.closePrivateChatDock = (options) => finishPmDockClose({
  restoreOrigin: options?.restoreOrigin !== false,
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensurePmCallPortal, { once: true });
} else {
  ensurePmCallPortal();
}
