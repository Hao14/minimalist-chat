import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  get,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { db } from '../../lib/firebase.js';

// Public STUN servers handle the common NAT cases. Peer-to-peer media flows
// directly between browsers; signalling (offers/answers/ICE) rides on RTDB.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

function participantFor(user, { micOn = true, camOn = false } = {}) {
  return {
    uid: user.uid,
    name: user.displayName || 'Anonymous',
    photoUrl: user.photoUrl || '',
    joinedAt: serverTimestamp(),
    lastSeen: Date.now(),
    micOn,
    camOn,
    screenOn: false,
    screenStreamId: null,
  };
}

function formatStartedAt(value) {
  if (!value) return 'just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function screenShareProfileForTier(tier, isAdmin = false) {
  const normalized = String(tier || 'base').toLowerCase();
  if (isAdmin || normalized === 'pro') {
    return { label: 'System limit', constraints: null, displayMedia: { video: true, audio: false } };
  }
  if (normalized === 'advanced') {
    return {
      label: '1080p · 60fps',
      constraints: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 60, max: 60 } },
      displayMedia: { video: true, audio: false },
    };
  }
  return {
    label: '720p · 30fps',
    constraints: { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } },
    displayMedia: { video: true, audio: false },
  };
}

const ROOM_PERMISSION_DEFAULTS = { manageChannels: false, webhooks: false };

function permissionValue(permissions = {}, key) {
  if (Object.prototype.hasOwnProperty.call(permissions || {}, key)) return permissions[key] !== false;
  return ROOM_PERMISSION_DEFAULTS[key] ?? true;
}

function isRoomManager(roomData = {}, user, adminUid) {
  if (!user?.uid) return false;
  if (user.uid === adminUid) return true;
  if (roomData.creatorId) return roomData.creatorId === user.uid;
  return Object.keys(roomData.members || {})[0] === user.uid;
}

async function canUseRoomPermission(roomId, user, adminUid, key, deniedMessage) {
  if (!roomId || roomId === 'global') return true;
  const snapshot = await get(ref(db, `rooms_meta/${roomId}`)).catch(() => null);
  const roomData = snapshot?.val() || {};
  if (isRoomManager(roomData, user, adminUid)) return true;
  if (!permissionValue(roomData.permissions, key)) {
    window.showToast?.(deniedMessage);
    return false;
  }
  return true;
}

function streamHasVideo(stream) {
  return Boolean(stream && stream.getVideoTracks && stream.getVideoTracks().length);
}

// Binds a MediaStream to a <video> element imperatively (srcObject can't be set via JSX).
function MediaVideo({ stream, mirror, className }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) el.srcObject = stream || null;
  }, [stream]);
  return (
    <video
      ref={videoRef}
      className={className}
      autoPlay
      playsInline
      muted
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

// Hidden <audio> sink so remote voices are actually heard (video tiles stay muted to avoid echo).
function RemoteAudio({ stream }) {
  const audioRef = useRef(null);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    el.play?.().catch(() => {});
  }, [stream]);
  return <audio ref={audioRef} autoPlay />;
}

export function Calls({ adminUid, roomId, user }) {
  const [call, setCall] = useState(null);
  const [remoteMedia, setRemoteMedia] = useState({}); // { uid: { camera, screen } }
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const engineRef = useRef(null);
  const micOnRef = useRef(true);
  const wantCamRef = useRef(false);

  const callPath = `room_calls/${roomId}`;
  const myUid = user?.uid || '';

  const participants = useMemo(() => (
    Object.values(call?.participants || {})
      .filter((participant) => participant?.uid)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
  ), [call?.participants]);

  const participantKey = useMemo(() => participants.map((p) => `${p.uid}:${p.camOn ? 1 : 0}${p.screenOn ? 1 : 0}${p.screenStreamId || ''}`).join('|'), [participants]);

  const isActive = call?.status === 'active';
  const myParticipant = myUid ? call?.participants?.[myUid] : null;
  const isJoined = Boolean(myParticipant);
  const canEnd = Boolean(myUid && (call?.hostUid === myUid || myUid === adminUid));
  const canUseVideoCalls = Boolean(myUid && ((window.userTier || 'free') === 'pro' || myUid === adminUid));
  const screenShareProfile = screenShareProfileForTier(window.userTier || 'free', myUid === adminUid);

  // Live snapshot of the room call (status, host, participants).
  useEffect(() => {
    if (!roomId) return undefined;
    const callRef = ref(db, callPath);
    return onValue(callRef, (snapshot) => setCall(snapshot.val()));
  }, [callPath, roomId]);

  // Presence heartbeat + auto-cleanup if the tab dies.
  useEffect(() => {
    if (!isJoined || !myUid || !roomId) return undefined;
    const meRef = ref(db, `${callPath}/participants/${myUid}`);
    const markSeen = () => update(meRef, { lastSeen: Date.now() }).catch(() => {});
    const interval = setInterval(markSeen, 15000);
    onDisconnect(meRef).remove();
    markSeen();
    return () => clearInterval(interval);
  }, [callPath, isJoined, roomId, myUid]);

  // Ticking clock for the call timer.
  useEffect(() => {
    if (!isActive) return undefined;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // ── WebRTC engine ─────────────────────────────────────────────────────────
  // Spins up when we are in the call, tears down completely when we leave.
  // Uses the "perfect negotiation" pattern so either side can (re)negotiate
  // without glare when cameras/screen shares come and go.
  useEffect(() => {
    if (!isJoined || !roomId || !myUid) return undefined;

    let disposed = false;
    const pcs = new Map(); // otherUid -> { pc, polite, makingOffer, ignoreOffer }
    const screenIds = {}; // otherUid -> screen stream id (to classify remote tracks)
    let local = null;
    let screen = null;
    let unsubSignals = null;

    const meRef = ref(db, `${callPath}/participants/${myUid}`);
    const sendSignal = (toUid, data) => {
      push(ref(db, `${callPath}/signals/${toUid}`), { from: myUid, ...data, ts: Date.now() }).catch(() => {});
    };

    const setRemote = (uid, kind, stream) => {
      if (disposed) return;
      setRemoteMedia((prev) => {
        const current = { camera: null, screen: null, ...(prev[uid] || {}) };
        current[kind] = stream;
        return { ...prev, [uid]: current };
      });
    };
    const clearRemote = (uid) => {
      if (disposed) return;
      setRemoteMedia((prev) => {
        if (!prev[uid]) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    };

    const createPeer = (otherUid) => {
      const polite = myUid < otherUid;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const entry = { pc, polite, makingOffer: false, ignoreOffer: false };
      pcs.set(otherUid, entry);

      if (local) local.getTracks().forEach((track) => pc.addTrack(track, local));
      else pc.addTransceiver('audio', { direction: 'recvonly' }); // still hear others if our mic failed
      if (screen) screen.getVideoTracks().forEach((track) => pc.addTrack(track, screen));

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          sendSignal(otherUid, { kind: 'desc', desc: pc.localDescription.toJSON() });
        } catch (error) {
          console.error('Call negotiation failed', error);
        } finally {
          entry.makingOffer = false;
        }
      };
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) sendSignal(otherUid, { kind: 'cand', cand: candidate.toJSON() });
      };
      pc.ontrack = ({ track, streams }) => {
        const stream = streams[0];
        if (!stream) return;
        const classify = () => {
          const isScreen = stream.id === screenIds[otherUid]
            || (track.kind === 'video' && stream.getAudioTracks().length === 0);
          setRemote(otherUid, isScreen ? 'screen' : 'camera', stream);
        };
        classify();
        stream.addEventListener('removetrack', classify);
        track.addEventListener('ended', classify);
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && pcs.get(otherUid) === entry) {
          // leave teardown to the participant reconcile; just clear stale media on hard failure
          if (pc.connectionState === 'failed') clearRemote(otherUid);
        }
      };
      return entry;
    };

    const closePeer = (uid) => {
      const entry = pcs.get(uid);
      if (entry) {
        try { entry.pc.close(); } catch { /* ignore */ }
        pcs.delete(uid);
      }
      clearRemote(uid);
    };

    const handleSignal = async (message) => {
      const fromUid = message?.from;
      if (!fromUid || fromUid === myUid) return;
      let entry = pcs.get(fromUid);
      if (!entry) entry = createPeer(fromUid);
      const { pc } = entry;
      try {
        if (message.kind === 'desc' && message.desc) {
          const description = message.desc;
          const collision = description.type === 'offer'
            && (entry.makingOffer || pc.signalingState !== 'stable');
          entry.ignoreOffer = !entry.polite && collision;
          if (entry.ignoreOffer) return;
          await pc.setRemoteDescription(description);
          if (description.type === 'offer') {
            await pc.setLocalDescription();
            sendSignal(fromUid, { kind: 'desc', desc: pc.localDescription.toJSON() });
          }
        } else if (message.kind === 'cand' && message.cand) {
          try {
            await pc.addIceCandidate(message.cand);
          } catch (error) {
            if (!entry.ignoreOffer) console.error('ICE candidate error', error);
          }
        }
      } catch (error) {
        console.error('Signal handling error', error);
      }
    };

    // Imperative handle used by the toolbar + reconcile effect.
    engineRef.current = {
      getLocalStream: () => local,
      setMicEnabled(enabled) {
        local?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
      },
      addCamera(track) {
        if (!local) return;
        local.addTrack(track);
        pcs.forEach(({ pc }) => pc.addTrack(track, local));
      },
      removeCamera() {
        if (!local) return;
        local.getVideoTracks().forEach((track) => {
          pcs.forEach(({ pc }) => {
            const sender = pc.getSenders().find((s) => s.track === track);
            if (sender) pc.removeTrack(sender);
          });
          track.stop();
          local.removeTrack(track);
        });
      },
      addScreen(stream) {
        screen = stream;
        stream.getVideoTracks().forEach((track) => {
          pcs.forEach(({ pc }) => pc.addTrack(track, stream));
        });
      },
      removeScreen() {
        if (!screen) return;
        screen.getTracks().forEach((track) => {
          pcs.forEach(({ pc }) => {
            const sender = pc.getSenders().find((s) => s.track === track);
            if (sender) pc.removeTrack(sender);
          });
          track.stop();
        });
        screen = null;
      },
      reconcile(list) {
        const others = list.filter((p) => p.uid && p.uid !== myUid);
        others.forEach((p) => {
          if (p.screenStreamId) screenIds[p.uid] = p.screenStreamId;
          else delete screenIds[p.uid];
        });
        const otherUids = new Set(others.map((p) => p.uid));
        // We open the connection toward peers with a "larger" uid; the other
        // side opens lazily when our offer lands. Keeps offers from colliding.
        others.forEach((p) => {
          if (!pcs.has(p.uid) && myUid < p.uid) createPeer(p.uid);
        });
        [...pcs.keys()].forEach((uid) => { if (!otherUids.has(uid)) closePeer(uid); });
      },
    };

    (async () => {
      try {
        const wantVideo = wantCamRef.current && canUseVideoCalls;
        local = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
      } catch (error) {
        local = null;
        window.showToast?.(`Microphone unavailable: ${error.message}`);
      }
      if (disposed) {
        local?.getTracks().forEach((track) => track.stop());
        return;
      }
      if (local) {
        local.getAudioTracks().forEach((track) => { track.enabled = micOnRef.current; });
        const hasVideo = streamHasVideo(local);
        setLocalStream(local);
        setCamOn(hasVideo);
        update(meRef, { micOn: micOnRef.current, camOn: hasVideo }).catch(() => {});
      }

      unsubSignals = onChildAdded(ref(db, `${callPath}/signals/${myUid}`), (snapshot) => {
        const message = snapshot.val();
        remove(snapshot.ref).catch(() => {});
        handleSignal(message);
      });

      setEngineReady(true);
    })();

    return () => {
      disposed = true;
      setEngineReady(false);
      engineRef.current = null;
      unsubSignals?.();
      pcs.forEach(({ pc }) => { try { pc.close(); } catch { /* ignore */ } });
      pcs.clear();
      local?.getTracks().forEach((track) => track.stop());
      screen?.getTracks().forEach((track) => track.stop());
      remove(ref(db, `${callPath}/signals/${myUid}`)).catch(() => {});
      setRemoteMedia({});
      setLocalStream(null);
      setScreenStream(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoined, roomId, myUid]);

  // Keep the peer mesh in sync with who is in the room.
  useEffect(() => {
    if (!engineReady) return;
    engineRef.current?.reconcile(participants);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, participantKey]);

  const joinCall = useCallback(async (callType = 'voice') => {
    if (!myUid) return false;
    if (callType === 'video' && !canUseVideoCalls) {
      window.showToast?.('Video calls are a Pro feature. Voice and screen share are on every plan.');
      return false;
    }
    if (!(await canUseRoomPermission(roomId, user, adminUid, 'calls', 'Voice calls are disabled in this room.'))) return false;
    if (callType === 'video' && !(await canUseRoomPermission(roomId, user, adminUid, 'video', 'Video calls are disabled in this room.'))) return false;

    const wantVideo = callType === 'video' && canUseVideoCalls;
    wantCamRef.current = wantVideo;
    micOnRef.current = true;
    setMicOn(true);
    setCamOn(wantVideo);

    const callRef = ref(db, callPath);
    const snapshot = await get(callRef);
    const existing = snapshot.val() || {};
    if (existing.status !== 'active') {
      await update(callRef, {
        status: 'active',
        roomId,
        type: callType,
        hostUid: existing.hostUid || myUid,
        hostName: existing.hostName || user.displayName || 'Anonymous',
        startedAt: existing.startedAt || serverTimestamp(),
      });
    } else if (wantVideo && existing.type !== 'video') {
      await update(callRef, { type: 'video' });
    }

    const meRef = ref(db, `${callPath}/participants/${myUid}`);
    await set(meRef, participantFor(user, { micOn: true, camOn: wantVideo }));
    onDisconnect(meRef).remove();
    return true;
  }, [adminUid, callPath, canUseVideoCalls, myUid, roomId, user]);

  const leaveCall = useCallback(async () => {
    if (!myUid) return;
    setScreenStream(null);
    setScreenOn(false);
    setCamOn(false);
    setMicOn(true);
    micOnRef.current = true;
    wantCamRef.current = false;
    await remove(ref(db, `${callPath}/participants/${myUid}`));
    window.showToast?.('You left the call.', false);
  }, [callPath, myUid]);

  const endCall = useCallback(async () => {
    if (!canEnd) return;
    setScreenStream(null);
    setScreenOn(false);
    await remove(ref(db, callPath));
    window.showToast?.('Call ended for the room.', false);
  }, [callPath, canEnd]);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    micOnRef.current = next;
    engineRef.current?.setMicEnabled(next);
    if (myUid) update(ref(db, `${callPath}/participants/${myUid}`), { micOn: next, lastSeen: Date.now() }).catch(() => {});
  }, [callPath, micOn, myUid]);

  const toggleCamera = useCallback(async () => {
    if (!engineRef.current) return;
    if (!canUseVideoCalls) {
      window.showToast?.('Video calls are a Pro feature.');
      return;
    }
    const meRef = ref(db, `${callPath}/participants/${myUid}`);
    if (camOn) {
      engineRef.current.removeCamera();
      setCamOn(false);
      wantCamRef.current = false;
      update(meRef, { camOn: false }).catch(() => {});
      return;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = cam.getVideoTracks()[0];
      if (!track) return;
      engineRef.current.addCamera(track);
      setCamOn(true);
      wantCamRef.current = true;
      update(meRef, { camOn: true }).catch(() => {});
    } catch (error) {
      window.showToast?.(`Camera unavailable: ${error.message}`);
    }
  }, [callPath, camOn, canUseVideoCalls, myUid]);

  const stopScreenShare = useCallback((notify = true) => {
    engineRef.current?.removeScreen();
    setScreenStream(null);
    setScreenOn(false);
    if (myUid) update(ref(db, `${callPath}/participants/${myUid}`), { screenOn: false, screenStreamId: null }).catch(() => {});
    if (notify) window.showToast?.('Screen sharing stopped.', false);
  }, [callPath, myUid]);

  const startScreenShare = useCallback(async () => {
    if (!engineRef.current) return;
    if (!(await canUseRoomPermission(roomId, user, adminUid, 'screenShare', 'Screen sharing is disabled in this room.'))) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      window.showToast?.('This browser does not support screen sharing.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(screenShareProfile.displayMedia);
      const track = stream.getVideoTracks()[0];
      if (track && screenShareProfile.constraints) {
        await track.applyConstraints(screenShareProfile.constraints).catch(() => {});
      }
      track?.addEventListener('ended', () => stopScreenShare(), { once: true });
      engineRef.current.addScreen(stream);
      setScreenStream(stream);
      setScreenOn(true);
      if (myUid) {
        update(ref(db, `${callPath}/participants/${myUid}`), {
          screenOn: true,
          screenStreamId: stream.id,
          screenQuality: screenShareProfile.label,
          lastSeen: Date.now(),
        }).catch(() => {});
      }
      window.showToast?.(`Sharing your screen at ${screenShareProfile.label}.`, false);
    } catch (error) {
      if (error?.name !== 'NotAllowedError') {
        window.showToast?.(`Screen share failed: ${error.message}`);
      }
    }
  }, [adminUid, callPath, myUid, roomId, screenShareProfile, stopScreenShare, user]);

  const elapsed = useMemo(() => {
    if (!call?.startedAt) return '';
    const seconds = Math.max(0, Math.floor((nowTs - call.startedAt) / 1000));
    const mins = Math.floor(seconds / 60);
    const secs = String(seconds % 60).padStart(2, '0');
    const hrs = Math.floor(mins / 60);
    if (hrs) return `${hrs}:${String(mins % 60).padStart(2, '0')}:${secs}`;
    return `${mins}:${secs}`;
  }, [call?.startedAt, nowTs]);

  const avatarFor = (name, photoUrl) => photoUrl || window.getAvatarUrl?.(name || 'Anonymous', '') || '';

  // ── Pre-join lobby ─────────────────────────────────────────────────────────
  if (!isJoined) {
    return (
      <div className="calls-wrap calls-lobby">
        <div className="call-lobby">
          <div className="call-lobby-stage">
            {isActive && participants.length ? (
              <div className="call-lobby-faces">
                {participants.slice(0, 5).map((p) => (
                  <img key={p.uid} src={avatarFor(p.name, p.photoUrl)} alt={p.name} title={p.name} />
                ))}
                {participants.length > 5 ? <span className="call-lobby-more">+{participants.length - 5}</span> : null}
              </div>
            ) : (
              <div className="call-lobby-glyph"><i className="ph-bold ph-phone-call" /></div>
            )}
          </div>

          <div className="call-lobby-panel">
            <div className="calls-kicker"><i className="ph-bold ph-broadcast" /> Room call</div>
            <h3>{isActive ? 'Call in progress' : 'Start a call'}</h3>
            <p>
              {isActive
                ? `${participants.length} ${participants.length === 1 ? 'person is' : 'people are'} on the call · live since ${formatStartedAt(call.startedAt)}.`
                : 'Real-time voice, video and screen sharing for everyone in this room.'}
            </p>

            <div className="call-lobby-actions">
              {isActive ? (
                <button type="button" className="call-cta" onClick={() => joinCall(call?.type === 'video' ? 'video' : 'voice')}>
                  <i className="ph-bold ph-phone-incoming" /> Join call
                </button>
              ) : (
                <>
                  <button type="button" className="call-cta" onClick={() => joinCall('voice')}>
                    <i className="ph-bold ph-phone-call" /> Start voice call
                  </button>
                  <button
                    type="button"
                    className="call-cta ghost"
                    onClick={() => joinCall('video')}
                    disabled={!canUseVideoCalls}
                    title={canUseVideoCalls ? 'Start with camera on' : 'Video is a Pro feature'}
                  >
                    <i className="ph-bold ph-video-camera" /> {canUseVideoCalls ? 'Start video call' : 'Video (Pro)'}
                  </button>
                </>
              )}
            </div>

            <div className="call-lobby-hint">
              <i className="ph-bold ph-monitor-arrow-up" /> Voice &amp; screen share on every plan · your screen share runs at {screenShareProfile.label}.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── In-call stage ──────────────────────────────────────────────────────────
  const tiles = [];
  participants.forEach((p) => {
    const self = p.uid === myUid;
    const camStream = self ? (camOn ? localStream : null) : (remoteMedia[p.uid]?.camera || null);
    const camHasVideo = self ? (camOn && streamHasVideo(localStream)) : (Boolean(p.camOn) && streamHasVideo(camStream));
    tiles.push({
      key: `${p.uid}-cam`,
      kind: 'cam',
      self,
      uid: p.uid,
      name: self ? `${p.name || 'You'} (You)` : p.name,
      photoUrl: p.photoUrl,
      stream: camHasVideo ? camStream : null,
      video: camHasVideo,
      micOn: self ? micOn : p.micOn !== false,
      isHost: p.uid === call?.hostUid,
    });

    const sharing = self ? screenOn : Boolean(p.screenOn);
    if (sharing) {
      const scrStream = self ? screenStream : (remoteMedia[p.uid]?.screen || null);
      tiles.push({
        key: `${p.uid}-screen`,
        kind: 'screen',
        self,
        uid: p.uid,
        name: self ? 'Your screen' : `${p.name}’s screen`,
        stream: scrStream,
        video: Boolean(scrStream),
      });
    }
  });

  const screenCount = tiles.filter((t) => t.kind === 'screen').length;

  return (
    <div className="calls-wrap calls-live">
      <div className="call-topbar">
        <span className={`call-status-pill ${isActive ? 'active' : ''}`}>
          <span className="call-dot" /> Live · {elapsed}
        </span>
        <span className="call-topbar-meta">
          <i className="ph-bold ph-users-three" /> {participants.length}
        </span>
      </div>

      <div className={`call-stage ${screenCount ? 'has-screen' : ''}`} data-tiles={tiles.length}>
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className={`call-tile ${tile.kind === 'screen' ? 'is-screen' : ''} ${tile.self ? 'is-self' : ''}`}
          >
            {tile.video && tile.stream ? (
              <MediaVideo
                stream={tile.stream}
                mirror={tile.self && tile.kind === 'cam'}
                className="call-tile-video"
              />
            ) : (
              <div className="call-tile-avatar">
                <img src={avatarFor(tile.name, tile.photoUrl)} alt="" />
              </div>
            )}

            {tile.kind === 'cam' && tile.isHost ? <span className="call-tile-badge">Host</span> : null}
            {tile.kind === 'screen' ? (
              <span className="call-tile-badge badge-screen"><i className="ph-bold ph-monitor-arrow-up" /> Sharing</span>
            ) : null}

            <div className="call-tile-foot">
              <span className="call-tile-name">{tile.name}</span>
              {tile.kind === 'cam' ? (
                <i className={`ph-bold ${tile.micOn ? 'ph-microphone call-mic-on' : 'ph-microphone-slash call-mic-off'}`} />
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="call-dock">
        <button type="button" className={`call-dock-btn ${micOn ? '' : 'off'}`} onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'}>
          <i className={`ph-bold ${micOn ? 'ph-microphone' : 'ph-microphone-slash'}`} />
        </button>
        <button
          type="button"
          className={`call-dock-btn ${camOn ? 'active' : 'off'}`}
          onClick={toggleCamera}
          disabled={!canUseVideoCalls}
          title={!canUseVideoCalls ? 'Video is a Pro feature' : camOn ? 'Turn camera off' : 'Turn camera on'}
        >
          <i className={`ph-bold ${camOn ? 'ph-video-camera' : 'ph-video-camera-slash'}`} />
        </button>
        <button
          type="button"
          className={`call-dock-btn ${screenOn ? 'active' : ''}`}
          onClick={() => (screenOn ? stopScreenShare() : startScreenShare())}
          title={screenOn ? 'Stop sharing' : 'Share screen'}
        >
          <i className={`ph-bold ${screenOn ? 'ph-stop-circle' : 'ph-monitor-arrow-up'}`} />
        </button>
        <button type="button" className="call-dock-btn danger" onClick={leaveCall} title="Leave call">
          <i className="ph-bold ph-phone-x" />
        </button>
        {canEnd ? (
          <button type="button" className="call-dock-btn danger ghost-danger" onClick={endCall} title="End call for everyone">
            <i className="ph-bold ph-x-circle" />
          </button>
        ) : null}
      </div>

      {participants.map((p) => {
        if (p.uid === myUid) return null;
        const stream = remoteMedia[p.uid]?.camera;
        return stream ? <RemoteAudio key={`audio-${p.uid}`} stream={stream} /> : null;
      })}
    </div>
  );
}
