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
import {
  canUseRoomVideo,
  effectiveScreenShareTier,
  useRoomEntitlement,
} from '../billing/roomEntitlements.js';

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

function userPermissionValue(roomData = {}, key, uid) {
  const overrides = uid ? roomData.memberPermissions?.[uid] : null;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] !== false;
  return permissionValue(roomData.permissions, key);
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
  if (!userPermissionValue(roomData, key, user?.uid)) {
    window.showToast?.(deniedMessage);
    return false;
  }
  return true;
}

function streamHasVideo(stream) {
  return Boolean(stream && stream.getVideoTracks && stream.getVideoTracks().length);
}

function formatElapsedTime(startedAt, now = Date.now()) {
  if (!startedAt) return '';
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, '0');
  const hrs = Math.floor(mins / 60);
  if (hrs) return `${hrs}:${String(mins % 60).padStart(2, '0')}:${secs}`;
  return `${mins}:${secs}`;
}

function CallStatusText({ channelId, engineReady, startedAt }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!engineReady || !startedAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [engineReady, startedAt]);

  const status = engineReady
    ? formatElapsedTime(startedAt, now) || 'live'
    : 'connecting audio';
  return `#${channelId} · ${status}`;
}

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function callPermissionErrorMessage(error, wantVideo) {
  const name = String(error?.name || '');
  if (!window.isSecureContext) return 'Calls need HTTPS to request microphone and camera permissions.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return wantVideo
      ? 'Camera or microphone permission was denied. Allow both permissions for this site in your browser settings, then try again.'
      : 'Microphone permission was denied. Allow microphone access for this site in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return wantVideo
      ? 'No camera or microphone was found on this device.'
      : 'No microphone was found on this device.';
  }
  return error?.message || 'This browser could not open your microphone or camera.';
}

async function requestCallMedia({ wantVideo = false } = {}) {
  if (!window.isSecureContext) {
    throw new Error('Calls need HTTPS to request microphone and camera permissions.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support microphone/camera access. Open the HTTPS app in Chrome and try again.');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantVideo ? { facingMode: 'user' } : false,
    });
    if (!stream.getAudioTracks().length) {
      stopMediaStream(stream);
      throw new Error('No microphone was found on this device.');
    }
    return stream;
  } catch (error) {
    throw new Error(callPermissionErrorMessage(error, wantVideo));
  }
}

function cameraPermissionErrorMessage(error) {
  const name = String(error?.name || '');
  if (!window.isSecureContext) return 'Calls need HTTPS to request camera permission.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found on this device.';
  return error?.message || 'This browser could not open your camera.';
}

async function requestCameraStream() {
  if (!window.isSecureContext) throw new Error('Calls need HTTPS to request camera permission.');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support camera access. Open the HTTPS app in Chrome and try again.');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user' },
    });
    if (!stream.getVideoTracks().length) {
      stopMediaStream(stream);
      throw new Error('No camera was found on this device.');
    }
    return stream;
  } catch (error) {
    throw new Error(cameraPermissionErrorMessage(error));
  }
}

function screenShareUnavailableMessage() {
  if (!window.isSecureContext) return 'Screen sharing needs HTTPS.';
  return 'This browser does not support screen sharing. On Android, use a browser with screen capture support or present from desktop.';
}

function screenShareErrorMessage(error) {
  const name = String(error?.name || '');
  if (!window.isSecureContext) return 'Screen sharing needs HTTPS.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Screen sharing was canceled or blocked by browser permissions.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No screen is available to share on this device.';
  return error?.message || 'Screen sharing could not start.';
}

function callPathForChannel(roomId, channelId = 'general', channelsV2 = false) {
  if (!channelsV2 || channelId === 'general') return `room_calls/${roomId}`;
  return `room_calls/${roomId}/channels/${channelId}`;
}

function stripNestedChannels(callData) {
  if (!callData) return null;
  const { channels, ...generalCall } = callData;
  void channels;
  return generalCall.status || generalCall.participants ? generalCall : null;
}

function stripSignalingData(callData) {
  if (!callData || typeof callData !== 'object') return null;
  const { signals, channels, ...generalCall } = callData;
  void signals;
  const cleanChannels = Object.fromEntries(Object.entries(channels || {}).map(([channelId, channelCall]) => {
    const { signals: channelSignals, ...cleanCall } = channelCall || {};
    void channelSignals;
    return [channelId, cleanCall];
  }));
  return Object.keys(cleanChannels).length ? { ...generalCall, channels: cleanChannels } : generalCall;
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

export function Calls({ adminUid, roomId, user, activeChannelId = 'general', enableCallChannelsV2 = false }) {
  const [allCallData, setAllCallData] = useState(null);
  const [roomChannels, setRoomChannels] = useState({});
  const [selectedChannelId, setSelectedChannelId] = useState(activeChannelId || 'general');
  const [remoteMedia, setRemoteMedia] = useState({}); // { uid: { camera, screen } }
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [joinPendingType, setJoinPendingType] = useState('');
  const engineRef = useRef(null);
  const joiningRef = useRef(false);
  const micOnRef = useRef(true);
  const pendingLocalStreamRef = useRef(null);
  const wantCamRef = useRef(false);
  const callSnapshotKeyRef = useRef('');

  const rootCallPath = `room_calls/${roomId}`;
  const myUid = user?.uid || '';
  const roomEntitlement = useRoomEntitlement(roomId);
  const callChannels = useMemo(() => ([
    { id: 'general', name: 'general' },
    ...Object.entries(roomChannels || {})
      .map(([id, channel]) => ({ id, name: channel?.name || id }))
      .filter((channel) => channel.id !== 'general')
      .sort((a, b) => a.name.localeCompare(b.name)),
  ]), [roomChannels]);
  const selectedChannelExists = useMemo(
    () => callChannels.some((channel) => channel.id === selectedChannelId),
    [callChannels, selectedChannelId],
  );
  const effectiveSelectedChannelId = selectedChannelExists ? selectedChannelId : 'general';
  const callPath = useMemo(
    () => callPathForChannel(roomId, effectiveSelectedChannelId, enableCallChannelsV2),
    [effectiveSelectedChannelId, enableCallChannelsV2, roomId],
  );

  const channelCallsById = useMemo(() => ({
    general: stripNestedChannels(allCallData),
    ...((allCallData && typeof allCallData.channels === 'object') ? allCallData.channels : {}),
  }), [allCallData]);

  const call = enableCallChannelsV2
    ? channelCallsById[effectiveSelectedChannelId] || null
    : channelCallsById.general || null;
  const joinedChannelId = useMemo(() => {
    if (!myUid) return '';
    return Object.entries(channelCallsById)
      .find(([, channelCall]) => channelCall?.participants?.[myUid])?.[0] || '';
  }, [channelCallsById, myUid]);
  const isJoinedElsewhere = Boolean(enableCallChannelsV2 && joinedChannelId && joinedChannelId !== selectedChannelId);
  const joinedCall = enableCallChannelsV2 && joinedChannelId
    ? channelCallsById[joinedChannelId] || null
    : call;
  const joinedCallPath = useMemo(
    () => callPathForChannel(roomId, joinedChannelId || effectiveSelectedChannelId, enableCallChannelsV2),
    [effectiveSelectedChannelId, enableCallChannelsV2, joinedChannelId, roomId],
  );

  const participants = useMemo(() => (
    Object.values(call?.participants || {})
      .filter((participant) => participant?.uid)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
  ), [call?.participants]);
  const joinedParticipants = useMemo(() => (
    Object.values(joinedCall?.participants || {})
      .filter((participant) => participant?.uid)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
  ), [joinedCall?.participants]);

  const participantKey = useMemo(() => joinedParticipants.map((p) => `${p.uid}:${p.camOn ? 1 : 0}${p.screenOn ? 1 : 0}${p.screenStreamId || ''}`).join('|'), [joinedParticipants]);

  const isActive = call?.status === 'active' && participants.length > 0;
  const isJoinedInSelectedChannel = Boolean(myUid && call?.participants?.[myUid]);
  const myParticipant = myUid ? joinedCall?.participants?.[myUid] : null;
  const isJoined = Boolean(myParticipant);
  const canEnd = Boolean(myUid && (call?.hostUid === myUid || myUid === adminUid));
  const canUseVideoCalls = Boolean(myUid && (
    myUid === adminUid
    || canUseRoomVideo(window.userTier || 'free', roomEntitlement, myUid)
  ));
  const screenShareProfile = screenShareProfileForTier(
    effectiveScreenShareTier(window.userTier || 'free', roomEntitlement, myUid),
    myUid === adminUid,
  );
  const isJoining = Boolean(joinPendingType);
  const joinPendingLabel = joinPendingType === 'video' ? 'Opening camera...' : 'Opening microphone...';

  useEffect(() => {
    if (!roomId || !enableCallChannelsV2 || roomId === 'global') return undefined;
    return onValue(ref(db, `rooms_meta/${roomId}/channels`), (snapshot) => setRoomChannels(snapshot.val() || {}));
  }, [enableCallChannelsV2, roomId]);

  // Live snapshot of all room calls (status, host, participants).
  useEffect(() => {
    if (!roomId) return undefined;
    const callRef = ref(db, rootCallPath);
    return onValue(callRef, (snapshot) => {
      const callData = stripSignalingData(snapshot.val());
      const snapshotKey = JSON.stringify(callData);
      if (snapshotKey === callSnapshotKeyRef.current) return;
      callSnapshotKeyRef.current = snapshotKey;
      setAllCallData(callData);
    });
  }, [rootCallPath, roomId]);

  // Presence heartbeat + auto-cleanup if the tab dies.
  useEffect(() => {
    if (!isJoined || !myUid || !roomId) return undefined;
    const meRef = ref(db, `${joinedCallPath}/participants/${myUid}`);
    const markSeen = () => update(meRef, { lastSeen: Date.now() }).catch(() => {});
    const interval = setInterval(markSeen, 15000);
    onDisconnect(meRef).remove();
    markSeen();
    return () => clearInterval(interval);
  }, [isJoined, joinedCallPath, roomId, myUid]);

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

    const meRef = ref(db, `${joinedCallPath}/participants/${myUid}`);
    const sendSignal = (toUid, data) => {
      push(ref(db, `${joinedCallPath}/signals/${toUid}`), { from: myUid, ...data, ts: Date.now() }).catch(() => {});
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
      teardown() {
        pcs.forEach(({ pc }) => { try { pc.close(); } catch { /* ignore */ } });
        pcs.clear();
        stopMediaStream(local);
        stopMediaStream(screen);
        local = null;
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
        local = pendingLocalStreamRef.current || await requestCallMedia({ wantVideo });
        pendingLocalStreamRef.current = null;
      } catch (error) {
        local = null;
        window.showToast?.(`Call permission failed: ${error.message}`);
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

      unsubSignals = onChildAdded(ref(db, `${joinedCallPath}/signals/${myUid}`), (snapshot) => {
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
      stopMediaStream(pendingLocalStreamRef.current);
      pendingLocalStreamRef.current = null;
      remove(ref(db, `${joinedCallPath}/signals/${myUid}`)).catch(() => {});
      setRemoteMedia({});
      setLocalStream(null);
      setScreenStream(null);
    };
  }, [canUseVideoCalls, isJoined, joinedCallPath, roomId, myUid]);

  const stopLocalCaptureNow = useCallback(() => {
    engineRef.current?.teardown?.();
    stopMediaStream(localStream);
    stopMediaStream(screenStream);
    stopMediaStream(pendingLocalStreamRef.current);
    pendingLocalStreamRef.current = null;
    setEngineReady(false);
    setRemoteMedia({});
    setLocalStream(null);
    setScreenStream(null);
  }, [localStream, screenStream]);

  // Keep the peer mesh in sync with who is in the room.
  useEffect(() => {
    if (!engineReady) return;
    engineRef.current?.reconcile(joinedParticipants);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, participantKey]);

  const switchCallChannel = useCallback((channelId) => {
    const nextChannelId = channelId || 'general';
    setSelectedChannelId(nextChannelId);
    window.switchRoomChannel?.(nextChannelId);
  }, []);

  const joinCall = useCallback(async (callType = 'voice') => {
    if (!myUid || joiningRef.current) return false;

    let preflightStream = null;
    let previousParticipantPath = '';
    const wasJoinedBefore = Boolean(joinedChannelId);
    joiningRef.current = true;
    setJoinPendingType(callType);

    try {
      if (enableCallChannelsV2 && !selectedChannelExists) {
        window.showToast?.('That call channel no longer exists.');
        setSelectedChannelId('general');
        return false;
      }
      if (callType === 'video' && !canUseVideoCalls) {
        window.showToast?.('Video calls are a Pro feature. Voice and screen share are on every plan.');
        return false;
      }
      if (!(await canUseRoomPermission(roomId, user, adminUid, 'calls', 'Voice calls are disabled in this room.'))) return false;
      if (callType === 'video' && !(await canUseRoomPermission(roomId, user, adminUid, 'video', 'Video calls are disabled in this room.'))) return false;

      const wantVideo = callType === 'video' && canUseVideoCalls;
      preflightStream = await requestCallMedia({ wantVideo });
      stopMediaStream(pendingLocalStreamRef.current);
      pendingLocalStreamRef.current = preflightStream;
      wantCamRef.current = wantVideo;
      micOnRef.current = true;
      setMicOn(true);
      setCamOn(wantVideo);

      if (enableCallChannelsV2 && joinedChannelId && joinedChannelId !== effectiveSelectedChannelId) {
        previousParticipantPath = `${callPathForChannel(roomId, joinedChannelId, true)}/participants/${myUid}`;
      }

      const callRef = ref(db, callPath);
      const snapshot = await get(callRef);
      const existing = snapshot.val() || {};
      const existingParticipants = Object.values(existing.participants || {})
        .filter((participant) => participant?.uid);
      if (!existingParticipants.length) {
        await update(callRef, {
          status: 'active',
          roomId,
          type: callType,
          hostUid: myUid,
          hostName: user.displayName || 'Anonymous',
          startedAt: serverTimestamp(),
          participants: null,
          signals: null,
        });
      } else if (existing.status !== 'active') {
        const firstParticipant = existingParticipants[0];
        await update(callRef, {
          status: 'active',
          roomId,
          type: existing.type || callType,
          hostUid: existing.hostUid || firstParticipant.uid,
          hostName: existing.hostName || firstParticipant.name || 'Anonymous',
          startedAt: existing.startedAt || serverTimestamp(),
        });
      } else if (wantVideo && existing.type !== 'video') {
        await update(callRef, { type: 'video' });
      }

      const meRef = ref(db, `${callPath}/participants/${myUid}`);
      await set(meRef, participantFor(user, { micOn: true, camOn: wantVideo }));
      onDisconnect(meRef).remove();
      if (previousParticipantPath) await remove(ref(db, previousParticipantPath)).catch(() => {});
      return true;
    } catch (error) {
      if (pendingLocalStreamRef.current === preflightStream) pendingLocalStreamRef.current = null;
      stopMediaStream(preflightStream);
      if (!wasJoinedBefore) {
        setMicOn(true);
        setCamOn(false);
        micOnRef.current = true;
        wantCamRef.current = false;
      }
      window.showToast?.(`Call failed: ${error.message || error}`);
      return false;
    } finally {
      joiningRef.current = false;
      setJoinPendingType('');
    }
  }, [adminUid, callPath, canUseVideoCalls, effectiveSelectedChannelId, enableCallChannelsV2, joinedChannelId, myUid, roomId, selectedChannelExists, user]);

  const leaveCall = useCallback(async () => {
    if (!myUid) return;
    stopLocalCaptureNow();
    setScreenOn(false);
    setCamOn(false);
    setMicOn(true);
    micOnRef.current = true;
    wantCamRef.current = false;
    const callRef = ref(db, joinedCallPath);
    await remove(ref(db, `${joinedCallPath}/participants/${myUid}`));
    const snapshot = await get(callRef).catch(() => null);
    const nextCall = snapshot?.val() || {};
    const remaining = Object.values(nextCall.participants || {})
      .filter((participant) => participant?.uid)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    if (!remaining.length) {
      if (enableCallChannelsV2 && (joinedChannelId || selectedChannelId) === 'general') {
        await update(callRef, { status: null, type: null, hostUid: null, hostName: null, startedAt: null, signals: null }).catch(() => {});
      } else {
        await remove(callRef).catch(() => {});
      }
    } else if (nextCall.hostUid === myUid) {
      const nextHost = remaining[0];
      await update(callRef, { hostUid: nextHost.uid, hostName: nextHost.name || 'Anonymous' }).catch(() => {});
    }
    window.showToast?.('You left the call.', false);
  }, [enableCallChannelsV2, joinedCallPath, joinedChannelId, myUid, selectedChannelId, stopLocalCaptureNow]);

  const endCall = useCallback(async () => {
    if (!canEnd) return;
    stopLocalCaptureNow();
    setScreenOn(false);
    if (enableCallChannelsV2 && selectedChannelId === 'general') {
      await update(ref(db, rootCallPath), {
        status: null,
        type: null,
        hostUid: null,
        hostName: null,
        startedAt: null,
        participants: null,
        signals: null,
      });
    } else {
      await remove(ref(db, callPath));
    }
    window.showToast?.(`Call ended for #${selectedChannelId}.`, false);
  }, [callPath, canEnd, enableCallChannelsV2, rootCallPath, selectedChannelId, stopLocalCaptureNow]);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    micOnRef.current = next;
    engineRef.current?.setMicEnabled(next);
    if (myUid) update(ref(db, `${joinedCallPath}/participants/${myUid}`), { micOn: next, lastSeen: Date.now() }).catch(() => {});
  }, [joinedCallPath, micOn, myUid]);

  const toggleCamera = useCallback(async () => {
    if (!engineRef.current) {
      window.showToast?.('Call controls are still connecting. Try again in a moment.');
      return;
    }
    if (!canUseVideoCalls) {
      window.showToast?.('Video calls are a Pro feature.');
      return;
    }
    const meRef = ref(db, `${joinedCallPath}/participants/${myUid}`);
    if (camOn) {
      engineRef.current.removeCamera();
      setCamOn(false);
      wantCamRef.current = false;
      update(meRef, { camOn: false }).catch(() => {});
      return;
    }
    let cam = null;
    let trackAdded = false;
    try {
      cam = await requestCameraStream();
      const track = cam.getVideoTracks()[0];
      if (!track) throw new Error('No camera was found on this device.');
      engineRef.current.addCamera(track);
      trackAdded = true;
      setCamOn(true);
      wantCamRef.current = true;
      update(meRef, { camOn: true }).catch(() => {});
    } catch (error) {
      if (!trackAdded) stopMediaStream(cam);
      window.showToast?.(`Camera unavailable: ${error.message || error}`);
    }
  }, [camOn, canUseVideoCalls, joinedCallPath, myUid]);

  const stopScreenShare = useCallback((notify = true) => {
    engineRef.current?.removeScreen();
    setScreenStream(null);
    setScreenOn(false);
    if (myUid) update(ref(db, `${joinedCallPath}/participants/${myUid}`), { screenOn: false, screenStreamId: null }).catch(() => {});
    if (notify) window.showToast?.('Screen sharing stopped.', false);
  }, [joinedCallPath, myUid]);

  const startScreenShare = useCallback(async () => {
    if (!engineRef.current) {
      window.showToast?.('Call controls are still connecting. Try again in a moment.');
      return;
    }
    if (!(await canUseRoomPermission(roomId, user, adminUid, 'screenShare', 'Screen sharing is disabled in this room.'))) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      window.showToast?.(screenShareUnavailableMessage());
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
        update(ref(db, `${joinedCallPath}/participants/${myUid}`), {
          screenOn: true,
          screenStreamId: stream.id,
          screenQuality: screenShareProfile.label,
          lastSeen: Date.now(),
        }).catch(() => {});
      }
      window.showToast?.(`Sharing your screen at ${screenShareProfile.label}.`, false);
    } catch (error) {
      window.showToast?.(`Screen share failed: ${screenShareErrorMessage(error)}`);
    }
  }, [adminUid, joinedCallPath, myUid, roomId, screenShareProfile, stopScreenShare, user]);

  const avatarFor = (name, photoUrl) => photoUrl || window.getAvatarUrl?.(name || 'Anonymous', '') || '';
  const callPageHeader = (
    <header className="calls-page-header">
      <div className="calls-page-heading">
        <span className="calls-kicker"><i className="ph-bold ph-waveform" /> Voice, video &amp; screen share</span>
        <h2>Calls</h2>
        <p>Meet in <strong>#{effectiveSelectedChannelId}</strong> without leaving the room.</p>
      </div>
      <span className={`call-page-state ${isActive ? 'live' : 'ready'}`}>
        <span className="call-page-state-dot" />
        {isActive ? `${participants.length} live` : 'Ready'}
      </span>
    </header>
  );
  const visibleCallChannels = enableCallChannelsV2 ? callChannels : callChannels.slice(0, 1);
  const channelRail = (
    <div className="call-channel-rail" role="navigation" aria-label="Call channels">
      <span className="call-channel-label">Channels</span>
      <div className="call-channel-tabs">
        {visibleCallChannels.map((channel) => {
          const channelParticipants = Object.values(channelCallsById[channel.id]?.participants || {})
            .filter((participant) => participant?.uid);
          const live = channelCallsById[channel.id]?.status === 'active' && channelParticipants.length > 0;
          return (
            <button
              type="button"
              key={channel.id}
              className={`call-channel-card ${selectedChannelId === channel.id ? 'active' : ''} ${live ? 'live' : ''}`}
              onClick={() => switchCallChannel(channel.id)}
              disabled={isJoining}
              aria-pressed={selectedChannelId === channel.id}
            >
              <span className="call-channel-name"># {channel.name}</span>
              <span className="call-channel-meta">
                <i className="ph-bold ph-users-three" /> {channelParticipants.length}
                {live ? <em>Live</em> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const participantRoster = participants.length ? (
    <ul className="call-roster">
      {participants.slice(0, 6).map((participant) => (
        <li key={participant.uid}>
          <img src={avatarFor(participant.name, participant.photoUrl)} alt="" />
          <span className="call-roster-copy">
            <strong>{participant.uid === myUid ? `${participant.name || 'You'} (You)` : participant.name || 'Anonymous'}</strong>
            <small>{participant.uid === call?.hostUid ? 'Host' : participant.micOn === false ? 'Muted' : 'In the call'}</small>
          </span>
          <i className={`ph-bold ${participant.micOn === false ? 'ph-microphone-slash call-mic-off' : 'ph-microphone call-mic-on'}`} />
        </li>
      ))}
      {participants.length > 6 ? <li className="call-roster-more">+{participants.length - 6} more</li> : null}
    </ul>
  ) : (
    <div className="call-empty-roster">
      <i className="ph-bold ph-user-plus" />
      <span>No participants yet</span>
    </div>
  );

  // ── Pre-join lobby ─────────────────────────────────────────────────────────
  if (!isJoinedInSelectedChannel) {
    const activeJoinType = call?.type === 'video' ? 'video' : 'voice';
    const activeJoinBlocked = activeJoinType === 'video' && !canUseVideoCalls;
    return (
      <div className="calls-wrap calls-lobby">
        {callPageHeader}
        {channelRail}
        <div className="call-lobby">
          <section className={`call-lobby-stage ${isActive ? 'is-live' : ''}`} aria-labelledby="call-lobby-title">
            <div className="call-stage-eyebrow">
              <span># {effectiveSelectedChannelId}</span>
              <span>{isActive ? `${call?.type === 'video' ? 'Video' : 'Voice'} call` : 'Open room'}</span>
            </div>

            <div className="call-lobby-visual" aria-hidden="true">
              {isActive ? (
                <div className="call-lobby-faces">
                  {participants.slice(0, 5).map((participant) => (
                    <img key={participant.uid} src={avatarFor(participant.name, participant.photoUrl)} alt="" />
                  ))}
                  {participants.length > 5 ? <span className="call-lobby-more">+{participants.length - 5}</span> : null}
                </div>
              ) : (
                <div className="call-lobby-glyph"><i className="ph-bold ph-phone-call" /></div>
              )}
            </div>

            <h3 id="call-lobby-title">{isActive ? `#${effectiveSelectedChannelId} is live` : 'No one is in this call yet'}</h3>
            <p>
              {isJoinedElsewhere
                ? `You are already in #${joinedChannelId}. Joining here will move you to this call.`
                : isActive
                ? `${participants.length} ${participants.length === 1 ? 'person is' : 'people are'} here · started ${formatStartedAt(call.startedAt)}.`
                : 'Start a focused voice or video session. Room members can join from this same space.'}
            </p>

            <div className="call-lobby-actions">
              {isActive ? (
                <button
                  type="button"
                  className="call-cta"
                  onClick={() => joinCall(activeJoinType)}
                  disabled={isJoining || activeJoinBlocked}
                  aria-busy={isJoining}
                  title={activeJoinBlocked ? 'Video calls are a Pro feature' : undefined}
                >
                  <i className="ph-bold ph-phone-incoming" /> {isJoining ? joinPendingLabel : activeJoinBlocked ? 'Video call (Pro)' : 'Join call'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="call-cta"
                    onClick={() => joinCall('voice')}
                    disabled={isJoining}
                    aria-busy={isJoining}
                  >
                    <i className="ph-bold ph-phone-call" /> {isJoining && joinPendingType === 'voice' ? joinPendingLabel : 'Start voice'}
                  </button>
                  <button
                    type="button"
                    className="call-cta ghost"
                    onClick={() => joinCall('video')}
                    disabled={isJoining || !canUseVideoCalls}
                    aria-busy={isJoining && joinPendingType === 'video'}
                    title={canUseVideoCalls ? 'Start with camera on' : 'Video is a Pro feature'}
                  >
                    <i className="ph-bold ph-video-camera" /> {isJoining && joinPendingType === 'video' ? joinPendingLabel : canUseVideoCalls ? 'Start video' : 'Video (Pro)'}
                  </button>
                </>
              )}
            </div>

            <div className="call-lobby-hint">
              <i className="ph-bold ph-lock-key" /> Media stays peer-to-peer. Your browser asks permission before connecting.
            </div>
          </section>

          <aside className="call-lobby-rail" aria-label="Call details">
            <section className="call-side-card">
              <div className="call-side-card-head">
                <div>
                  <span>People</span>
                  <h3>Participants</h3>
                </div>
                <strong>{participants.length}</strong>
              </div>
              {participantRoster}
            </section>

            <section className="call-side-card">
              <div className="call-side-card-head">
                <div>
                  <span>Before you join</span>
                  <h3>Your setup</h3>
                </div>
              </div>
              <div className="call-device-list">
                <div className="call-device-row">
                  <i className="ph-bold ph-microphone" />
                  <span><strong>Microphone</strong><small>Requested on join</small></span>
                </div>
                <div className="call-device-row">
                  <i className="ph-bold ph-video-camera" />
                  <span><strong>Camera</strong><small>{canUseVideoCalls ? 'Available' : 'Pro feature'}</small></span>
                </div>
                <div className="call-device-row">
                  <i className="ph-bold ph-monitor-arrow-up" />
                  <span><strong>Screen share</strong><small>{screenShareProfile.label} in call</small></span>
                </div>
              </div>
            </section>
          </aside>
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
  const callControlsDisabled = !engineReady;
  const cameraDisabled = !canUseVideoCalls || callControlsDisabled;
  const cameraTitle = !canUseVideoCalls
    ? 'Video is a Pro feature'
    : callControlsDisabled
    ? 'Call controls are still connecting'
    : camOn
    ? 'Turn camera off'
    : 'Turn camera on';

  return (
    <div className="calls-wrap calls-live">
      {callPageHeader}
      {channelRail}
      <div className="call-live-workspace">
        <section className="call-live-main" aria-label="Call stage">
          <div className="call-topbar">
            <span className={`call-status-pill ${isActive ? 'active' : ''}`}>
              <span className="call-dot" />
              <span className="call-status-text">
                <CallStatusText
                  channelId={effectiveSelectedChannelId}
                  engineReady={engineReady}
                  startedAt={call?.startedAt}
                />
              </span>
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
        </section>

        <aside className="call-live-rail" aria-label="Current call details">
          <section className="call-side-card call-side-card-participants">
            <div className="call-side-card-head">
              <div>
                <span>Live now</span>
                <h3>Participants</h3>
              </div>
              <strong>{participants.length}</strong>
            </div>
            {participantRoster}
          </section>

          <section className="call-side-card">
            <div className="call-side-card-head">
              <div>
                <span>Your controls</span>
                <h3>Device status</h3>
              </div>
            </div>
            <div className="call-device-list">
              <div className="call-device-row">
                <i className={`ph-bold ${micOn ? 'ph-microphone' : 'ph-microphone-slash'}`} />
                <span><strong>Microphone</strong><small>{engineReady ? (micOn ? 'On' : 'Muted') : 'Connecting'}</small></span>
              </div>
              <div className="call-device-row">
                <i className={`ph-bold ${camOn ? 'ph-video-camera' : 'ph-video-camera-slash'}`} />
                <span><strong>Camera</strong><small>{canUseVideoCalls ? (camOn ? 'On' : 'Off') : 'Pro feature'}</small></span>
              </div>
              <div className="call-device-row">
                <i className={`ph-bold ${screenOn ? 'ph-stop-circle' : 'ph-monitor-arrow-up'}`} />
                <span><strong>Screen share</strong><small>{screenOn ? 'Sharing now' : `${screenShareProfile.label} available`}</small></span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="call-dock">
        <button
          type="button"
          className={`call-dock-btn ${micOn ? '' : 'off'}`}
          onClick={toggleMic}
          disabled={callControlsDisabled}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={micOn}
          title={callControlsDisabled ? 'Call controls are still connecting' : micOn ? 'Mute' : 'Unmute'}
        >
          <i className={`ph-bold ${micOn ? 'ph-microphone' : 'ph-microphone-slash'}`} />
        </button>
        <button
          type="button"
          className={`call-dock-btn ${camOn ? 'active' : 'off'}`}
          onClick={toggleCamera}
          disabled={cameraDisabled}
          aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
          aria-pressed={camOn}
          title={cameraTitle}
        >
          <i className={`ph-bold ${camOn ? 'ph-video-camera' : 'ph-video-camera-slash'}`} />
        </button>
        <button
          type="button"
          className={`call-dock-btn ${screenOn ? 'active' : ''}`}
          onClick={() => (screenOn ? stopScreenShare() : startScreenShare())}
          disabled={callControlsDisabled}
          aria-label={screenOn ? 'Stop sharing screen' : 'Share screen'}
          aria-pressed={screenOn}
          title={callControlsDisabled ? 'Call controls are still connecting' : screenOn ? 'Stop sharing' : 'Share screen'}
        >
          <i className={`ph-bold ${screenOn ? 'ph-stop-circle' : 'ph-monitor-arrow-up'}`} />
        </button>
        <button type="button" className="call-dock-btn danger" onClick={leaveCall} aria-label="Leave call" title="Leave call">
          <i className="ph-bold ph-phone-x" />
        </button>
        {canEnd ? (
          <button type="button" className="call-dock-btn danger ghost-danger" onClick={endCall} aria-label="End call for everyone" title="End call for everyone">
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
