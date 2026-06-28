/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  limitToLast,
  off,
  onDisconnect,
  onValue,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';

const pmKeys = new Map();
const pmDecryptCache = new Map();
const sessions = new Map();
const listeners = new Set();
let activeUid = null;
let pmRoot = null;

function roomIdFor(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function emitSessions() {
  listeners.forEach((listener) => listener());
}

function snapshotSessions() {
  return {
    activeUid,
    sessions: [...sessions.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
  };
}

function upsertSession(targetUid, patch = {}) {
  if (!targetUid) return;
  const previous = sessions.get(targetUid);
  const nextSession = {
    targetUid,
    targetName: patch.targetName || previous?.targetName || patch.fromName || 'User',
    photoUrl: patch.photoUrl || previous?.photoUrl || '',
    unread: patch.unread ?? previous?.unread ?? false,
    lastText: patch.lastText ?? previous?.lastText ?? '',
    timestamp: patch.timestamp ?? previous?.timestamp ?? Date.now(),
  };

  if (
    previous
    && previous.targetName === nextSession.targetName
    && previous.photoUrl === nextSession.photoUrl
    && previous.unread === nextSession.unread
    && previous.lastText === nextSession.lastText
    && previous.timestamp === nextSession.timestamp
  ) return;

  sessions.set(targetUid, nextSession);
  emitSessions();
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
  if (!pmRoot) pmRoot = createRoot(host);
  pmRoot.render(<PrivateMessagesDock />);
}

function showPmDock(targetUid) {
  if (targetUid) activeUid = targetUid;
  ensurePmDock();
  document.getElementById('pm-popup')?.classList.remove('hidden');
  emitSessions();
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

function callParticipant(user) {
  return {
    uid: user.uid,
    name: window.userProfileName || user.displayName || 'Anonymous',
    photoUrl: window.userPhotoUrl || '',
    joinedAt: Date.now(),
    micReady: true,
  };
}

function SessionButton({ session, active, onPick, onClose }) {
  return (
    <button type="button" className={`pm-session ${active ? 'active' : ''}`} onClick={onPick}>
      <span className="pm-session-avatar">
        {session.photoUrl ? <img src={session.photoUrl} alt="" /> : (session.targetName || '?').slice(0, 2).toUpperCase()}
      </span>
      <span className="pm-session-main">
        <strong>{session.targetName}</strong>
        <small>{session.lastText || 'No messages yet.'}</small>
      </span>
      {session.unread ? <span className="pm-session-dot" title="Unread" /> : null}
      <span
        className="pm-session-close"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        ×
      </span>
    </button>
  );
}

function PmMessage({ activeSession, message, roomId }) {
  const mine = message.uid === window.currentUser?.uid;
  const read = mine && activeSession?.targetUid && message.readBy?.[activeSession.targetUid];
  return (
    <li className={`${mine ? 'my-pm' : 'their-pm'} ${message.encrypted ? 'encrypted-pm' : ''}`}>
      <div className="pm-message-text">{message.decryptedText}</div>
      <div className="pm-message-meta">
        {message.encrypted ? <span>Encrypted</span> : null}
        <span>{formatTime(message.timestamp)}</span>
        {mine ? <span>{read ? 'Read' : 'Sent'}</span> : null}
      </div>
      {message.encrypted && !pmKeys.has(roomId) ? <div className="pm-read-hint">Use the lock to unlock this chat.</div> : null}
    </li>
  );
}

function PrivateMessagesDock() {
  const [{ sessions: openSessions, activeUid: currentActiveUid }, setSessionState] = useState(snapshotSessions);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [call, setCall] = useState(null);
  const [micState, setMicState] = useState('idle');
  const [encryptionVersion, setEncryptionVersion] = useState(0);
  const [passphraseOpen, setPassphraseOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const messagesRef = useRef(null);

  const activeSession = useMemo(
    () => openSessions.find((session) => session.targetUid === currentActiveUid) || openSessions[0] || null,
    [currentActiveUid, openSessions],
  );
  const myUid = window.currentUser?.uid || '';
  const activeTargetUid = activeSession?.targetUid || '';
  const roomId = activeSession && myUid ? roomIdFor(myUid, activeSession.targetUid) : '';
  const callPath = roomId ? `pm_calls/${roomId}` : '';
  const encrypted = Boolean(roomId && pmKeys.has(roomId));
  const scopedCall = call?.roomId === roomId ? call : null;

  useEffect(() => {
    const listener = () => setSessionState(snapshotSessions());
    listeners.add(listener);
    listener();
    return () => listeners.delete(listener);
  }, []);

  useEffect(() => {
    if (!myUid) return undefined;
    const applyInbox = (inbox = {}) => {
      Object.entries(inbox).forEach(([targetUid, data]) => {
        upsertSession(targetUid, {
          targetName: sessions.get(targetUid)?.targetName || data.fromName || 'User',
          unread: data.read === false,
          lastText: data.lastText || (data.read === false ? 'New message' : ''),
          timestamp: data.timestamp || 0,
        });
      });
    };
    applyInbox(window.latestPmInbox || {});
    const handleInbox = (event) => applyInbox(event.detail?.inbox || {});
    window.addEventListener('minimalist:pm-inbox', handleInbox);
    return () => window.removeEventListener('minimalist:pm-inbox', handleInbox);
  }, [myUid]);

  useEffect(() => {
    if (!activeTargetUid || !myUid) return;
    activeUid = activeTargetUid;
    window.currentPmTargetUid = activeTargetUid;
    window.currentPmRoomId = roomId;
    upsertSession(activeTargetUid, { unread: false });
    set(ref(db, `inbox/${myUid}/${activeTargetUid}/read`), true).catch(() => {});
    remove(ref(db, `notifications/${myUid}/message_${activeTargetUid}`)).catch(() => {});
  }, [activeTargetUid, myUid, roomId]);

  useEffect(() => {
    if (!roomId || !myUid) return undefined;

    const messagesQuery = query(ref(db, `private_messages/${roomId}`), limitToLast(80));
    const unsubscribe = onValue(messagesQuery, async (snapshot) => {
      const nextMessages = [];
      snapshot.forEach((child) => {
        nextMessages.push({ id: child.key, ...child.val() });
      });

      const decrypted = await Promise.all(nextMessages.map(async (message) => ({
        ...message,
        decryptedText: await cachedDecryptPmText(roomId, message, encryptionVersion),
      })));

      const readAt = Date.now();
      const readUpdates = {};
      decrypted
        .filter((message) => message.uid !== myUid && !message.readBy?.[myUid])
        .forEach((message) => {
          readUpdates[`private_messages/${roomId}/${message.id}/readBy/${myUid}`] = readAt;
        });
      if (Object.keys(readUpdates).length) update(ref(db), readUpdates).catch(() => {});

      setMessages(decrypted);
    });
    return () => unsubscribe();
  }, [encryptionVersion, myUid, roomId]);

  useEffect(() => {
    if (!callPath) return undefined;
    const callRef = ref(db, callPath);
    const handleCall = (snapshot) => setCall(snapshot.val());
    onValue(callRef, handleCall);
    return () => off(callRef, 'value', handleCall);
  }, [callPath]);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTo(0, messagesRef.current.scrollHeight);
  }, [messages, activeSession?.targetUid, keyboardInset]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const popup = document.getElementById('pm-popup');
    if (!viewport || !popup) return undefined;
    let frame = 0;

    const syncKeyboardInset = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      setKeyboardInset(inset);
      popup.style.setProperty('--pm-keyboard-offset', `${inset}px`);
      });
    };

    syncKeyboardInset();
    viewport.addEventListener('resize', syncKeyboardInset);
    viewport.addEventListener('scroll', syncKeyboardInset);
    return () => {
      viewport.removeEventListener('resize', syncKeyboardInset);
      viewport.removeEventListener('scroll', syncKeyboardInset);
      if (frame) window.cancelAnimationFrame(frame);
      popup.style.removeProperty('--pm-keyboard-offset');
    };
  }, []);

  const closeDock = useCallback(() => {
    document.getElementById('pm-popup')?.classList.add('hidden');
    window.currentPmRoomId = null;
    window.currentPmTargetUid = null;
  }, []);

  const closeSession = useCallback((targetUid) => {
    sessions.delete(targetUid);
    if (activeUid === targetUid) activeUid = sessions.keys().next().value || null;
    if (!activeUid) closeDock();
    emitSessions();
  }, [closeDock]);

  const pickSession = useCallback((targetUid) => {
    activeUid = targetUid;
    emitSessions();
  }, []);

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
    if (!text || !roomId || !activeSession || !myUid) return;

    const messagePayload = await encryptPmText(roomId, text);
    await push(ref(db, `private_messages/${roomId}`), {
      uid: myUid,
      ...messagePayload,
      readBy: { [myUid]: Date.now() },
      timestamp: serverTimestamp(),
    });

    await set(ref(db, `inbox/${activeSession.targetUid}/${myUid}`), {
      fromName: window.userProfileName || 'Someone',
      senderUid: myUid,
      timestamp: Date.now(),
      lastText: messagePayload.encrypted ? 'Encrypted message' : text,
      read: false,
    });
    await set(ref(db, `inbox/${myUid}/${activeSession.targetUid}`), {
      fromName: activeSession.targetName,
      senderUid: activeSession.targetUid,
      timestamp: Date.now(),
      lastText: messagePayload.encrypted ? 'Encrypted message' : text,
      read: true,
    });

    window.createNotification?.(
      activeSession.targetUid,
      'message',
      `New message from ${window.userProfileName || 'Someone'}.`,
      {
        groupId: myUid,
        from: window.userProfileName || 'Someone',
        action: 'pm',
        pmTargetUid: myUid,
        pmTargetName: window.userProfileName || 'Someone',
      },
    );
    upsertSession(activeSession.targetUid, { lastText: text, timestamp: Date.now(), unread: false });
    setDraft('');
  }, [activeSession, draft, myUid, roomId]);

  const joinVoiceCall = useCallback(async () => {
    if (!roomId || !myUid || !activeSession) return;
    try {
      setMicState('checking');
      let micReady = false;
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micReady = stream.getAudioTracks().length > 0;
        stream.getTracks().forEach((track) => track.stop());
      }

      await update(ref(db, callPath), {
        status: 'active',
        type: 'voice',
        roomId,
        hostUid: scopedCall?.hostUid || myUid,
        hostName: scopedCall?.hostName || window.userProfileName || 'Someone',
        startedAt: scopedCall?.startedAt || serverTimestamp(),
      });

      const participantRef = ref(db, `${callPath}/participants/${myUid}`);
      await set(participantRef, { ...callParticipant(window.currentUser), micReady });
      onDisconnect(participantRef).remove();

      await set(ref(db, `inbox/${activeSession.targetUid}/${myUid}`), {
        fromName: window.userProfileName || 'Someone',
        senderUid: myUid,
        timestamp: Date.now(),
        lastText: 'Voice call started',
        read: false,
      });
      window.createNotification?.(
      activeSession.targetUid,
      'message',
      `${window.userProfileName || 'Someone'} started a PM voice call.`,
      {
        groupId: myUid,
        from: window.userProfileName || 'Someone',
        action: 'pm',
        pmTargetUid: myUid,
        pmTargetName: window.userProfileName || 'Someone',
      },
    );
      setMicState(micReady ? 'ready' : 'blocked');
      window.showToast?.('PM voice call joined.', false);
    } catch (error) {
      setMicState('blocked');
      window.showToast?.(`Voice call failed: ${error.message}`);
    }
  }, [activeSession, callPath, myUid, roomId, scopedCall]);

  const leaveVoiceCall = useCallback(async () => {
    if (!callPath || !myUid) return;
    await remove(ref(db, `${callPath}/participants/${myUid}`));
    setMicState('idle');
    window.showToast?.('Left PM voice call.', false);
  }, [callPath, myUid]);

  const endVoiceCall = useCallback(async () => {
    if (!callPath || !myUid || (scopedCall?.hostUid && scopedCall.hostUid !== myUid)) return;
    await remove(ref(db, callPath));
    setMicState('idle');
    window.showToast?.('PM voice call ended.', false);
  }, [callPath, myUid, scopedCall]);

  const visibleMessages = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((message) => String(message.decryptedText || '').toLowerCase().includes(needle));
  }, [messages, search]);

  const callActive = Boolean(activeSession && scopedCall?.status === 'active');
  const joinedCall = Boolean(myUid && scopedCall?.participants?.[myUid]);
  const callParticipants = Object.values(scopedCall?.participants || {});

  return (
    <div className="pm-shell">
      <aside className="pm-sidebar">
        <div className="pm-sidebar-title">PMs</div>
        <div className="pm-session-list">
          {openSessions.length ? openSessions.map((session) => (
            <SessionButton
              active={session.targetUid === activeSession?.targetUid}
              key={session.targetUid}
              onClose={() => closeSession(session.targetUid)}
              onPick={() => pickSession(session.targetUid)}
              session={session}
            />
          )) : <div className="pm-empty">Open a contact to start a PM.</div>}
        </div>
      </aside>

      <section className="pm-main">
        <header className="pm-header">
          <div className="pm-title-wrap">
            <span id="pm-target-name">{activeSession?.targetName || 'Private messages'}</span>
            <small>{callActive ? `${callParticipants.length} in voice call` : 'Multi-PM chat view'}</small>
          </div>
          <div className="pm-header-actions">
            <button type="button" className={`pm-action-btn ${encrypted ? 'active' : ''}`} id="pm-e2e-btn" title={encrypted ? 'Encrypted messages on' : 'Enable encrypted messages'} aria-label={encrypted ? 'Encrypted messages on' : 'Enable encrypted messages'} onClick={toggleEncryption}>
              <i className="ph-bold ph-lock-key" />
            </button>
            {joinedCall ? (
              <button type="button" className="pm-action-btn active" id="pm-call-btn" title="Leave voice call" aria-label="Leave voice call" onClick={leaveVoiceCall}>
                <i className="ph-bold ph-phone-disconnect" />
              </button>
            ) : (
              <button type="button" className="pm-action-btn" id="pm-call-btn" title="Start voice call" aria-label="Start voice call" onClick={joinVoiceCall}>
                <i className="ph-bold ph-phone-call" />
              </button>
            )}
            <button type="button" className="pm-close" id="pm-close-btn" title="Close" onClick={closeDock}>✖</button>
          </div>
        </header>

        <div id="pm-e2e-status" className={`pm-e2e-status ${encrypted ? 'active' : ''}`}>
          {encrypted ? 'Encrypted on · messages are protected before upload' : 'Standard PM · tap the lock to enable encrypted messages'}
        </div>

        {callActive ? (
          <div className="pm-call-strip">
            <div>
              <strong>Voice call active</strong>
              <span>{callParticipants.map((participant) => participant.name).filter(Boolean).join(', ') || 'Waiting for someone to join'}</span>
            </div>
            {scopedCall?.hostUid === myUid ? <button type="button" onClick={endVoiceCall}>End call</button> : null}
          </div>
        ) : null}
        {micState === 'checking' ? <div className="pm-call-strip muted">Checking microphone…</div> : null}
        {micState === 'blocked' ? <div className="pm-call-strip danger">Microphone was blocked or unavailable.</div> : null}

        <div className="pm-search-row">
          <input id="pm-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this PM…" />
        </div>

        <ul id="pm-messages" ref={messagesRef}>
          {activeSession ? visibleMessages.map((message) => (
            <PmMessage activeSession={activeSession} key={message.id} message={message} roomId={roomId} />
          )) : <li className="pm-empty-message">Pick a conversation.</li>}
          {activeSession && !visibleMessages.length ? <li className="pm-empty-message">No messages here yet.</li> : null}
        </ul>

        <form id="pm-form" onSubmit={sendMessage}>
          <input id="pm-input" autoComplete="off" placeholder={activeSession ? `Message ${activeSession.targetName}…` : 'Pick a PM…'} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!activeSession} />
          <button type="submit" disabled={!activeSession || !draft.trim()}>Send</button>
        </form>

        {passphraseOpen ? (
          <div className="pm-passphrase-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPassphraseOpen(false); }}>
            <form className="pm-passphrase-card" onSubmit={submitPassphrase}>
              <div className="pm-passphrase-head">
                <div>
                  <span>Encrypted PM</span>
                  <h3>Shared passphrase</h3>
                </div>
                <button type="button" onClick={() => setPassphraseOpen(false)} aria-label="Close passphrase dialog">✖</button>
              </div>
              <p>The other person must enter the same passphrase to read encrypted messages in this PM.</p>
              <input
                autoFocus
                name="passphrase"
                type="password"
                autoComplete="off"
                placeholder="Enter shared passphrase..."
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
  );
}

function openPrivateMessagesDock(targetUid, targetName, options = {}) {
  if (!targetUid) return;
  upsertSession(targetUid, {
    targetName,
    photoUrl: options.photoUrl || '',
    unread: false,
    timestamp: Date.now(),
  });
  showPmDock(targetUid);
}

window.openPrivateChat = openPrivateMessagesDock;
