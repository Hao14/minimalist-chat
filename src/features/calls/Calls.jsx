import { useEffect, useMemo, useRef, useState } from 'react';
import { get, off, onDisconnect, onValue, ref, remove, serverTimestamp, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';

function participantFor(user) {
  return {
    uid: user.uid,
    name: user.displayName || 'Anonymous',
    photoUrl: user.photoUrl || '',
    joinedAt: serverTimestamp(),
    lastSeen: Date.now(),
    micReady: false,
    cameraReady: false,
    screenReady: false,
  };
}

function formatStartedAt(value) {
  if (!value) return 'just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function readinessLabel(participant) {
  if (participant?.micReady && participant?.cameraReady) return 'Mic + camera ready';
  if (participant?.screenReady) return 'Screen ready';
  if (participant?.micReady) return 'Mic ready';
  if (participant?.cameraReady) return 'Camera ready';
  return 'Not checked yet';
}

export function Calls({ adminUid, roomId, user }) {
  const [call, setCall] = useState(null);
  const [permissionState, setPermissionState] = useState('idle');
  const [screenState, setScreenState] = useState('idle');
  const [screenStream, setScreenStream] = useState(null);
  const screenVideoRef = useRef(null);

  const participants = useMemo(() => (
    Object.values(call?.participants || {})
      .filter((participant) => participant?.uid)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
  ), [call?.participants]);

  const isActive = call?.status === 'active';
  const myParticipant = user?.uid ? call?.participants?.[user.uid] : null;
  const isJoined = Boolean(myParticipant);
  const canEnd = Boolean(user?.uid && (call?.hostUid === user.uid || user.uid === adminUid));
  const canUseVideoCalls = Boolean(user?.uid && ((window.userTier || 'free') === 'pro' || user.uid === adminUid));
  const callPath = `room_calls/${roomId}`;

  useEffect(() => {
    if (!roomId) return undefined;
    const callRef = ref(db, callPath);
    const handleValue = (snapshot) => setCall(snapshot.val());
    onValue(callRef, handleValue);
    return () => off(callRef, 'value', handleValue);
  }, [callPath, roomId]);

  useEffect(() => {
    if (!isJoined || !user?.uid || !roomId) return undefined;
    const meRef = ref(db, `${callPath}/participants/${user.uid}`);
    const markSeen = () => update(meRef, { lastSeen: Date.now() }).catch(() => {});
    const interval = setInterval(markSeen, 15000);
    onDisconnect(meRef).remove();
    markSeen();
    return () => clearInterval(interval);
  }, [callPath, isJoined, roomId, user?.uid]);

  useEffect(() => {
    if (!screenVideoRef.current) return;
    screenVideoRef.current.srcObject = screenStream;
  }, [screenStream]);

  useEffect(() => () => {
    screenStream?.getTracks().forEach((track) => track.stop());
  }, [screenStream]);

  const joinCall = async (callType = 'voice') => {
    if (!user?.uid) return;
    if (callType === 'video' && !canUseVideoCalls) return window.showToast?.('Video calls are a Pro feature. Voice calls are available on Base.');
    const allowed = roomId === 'global' || (await get(ref(db, `rooms_meta/${roomId}/permissions/calls`)).catch(() => null))?.val() !== false;
    if (!allowed) return window.showToast?.('Calls and screen sharing are disabled in this room.');
    const callRef = ref(db, callPath);
    const snapshot = await get(callRef);
    const existing = snapshot.val() || {};

    if (existing.status !== 'active') {
      await update(callRef, {
        status: 'active',
        roomId,
        type: callType,
        hostUid: existing.hostUid || user.uid,
        hostName: existing.hostName || user.displayName || 'Anonymous',
        startedAt: existing.startedAt || serverTimestamp(),
      });
    } else if (callType === 'video' && existing.type !== 'video') {
      await update(callRef, { type: 'video', upgradedAt: Date.now(), upgradedBy: user.uid });
    }

    const meRef = ref(db, `${callPath}/participants/${user.uid}`);
    await set(meRef, participantFor(user));
    onDisconnect(meRef).remove();
    window.showToast?.(`${callType === 'video' ? 'Video' : 'Voice'} call joined.`, false);
  };

  const leaveCall = async () => {
    if (!user?.uid) return;
    stopScreenShare(false);
    await remove(ref(db, `${callPath}/participants/${user.uid}`));
    setPermissionState('idle');
    setScreenState('idle');
    window.showToast?.('You left the call space.', false);
  };

  const endCall = async () => {
    if (!canEnd) return;
    stopScreenShare(false);
    await remove(ref(db, callPath));
    setPermissionState('idle');
    setScreenState('idle');
    window.showToast?.('Call space ended.', false);
  };

  const stopScreenShare = async (showNotice = true) => {
    screenStream?.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
    setScreenState('ready');
    if (user?.uid) {
      await update(ref(db, `${callPath}/participants/${user.uid}`), {
        screenReady: true,
        screenSharing: false,
        screenStoppedAt: Date.now(),
      }).catch(() => {});
    }
    if (showNotice) window.showToast?.('Screen sharing stopped.', false);
  };

  const startScreenShare = async () => {
    if (!user?.uid) return;
    if (!canUseVideoCalls) return window.showToast?.('Screen sharing is included with Pro video calls.');
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenState('unsupported');
      return;
    }

    try {
      if (!isJoined) await joinCall('video');
      setScreenState('checking');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenReady = stream.getVideoTracks().length > 0;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          setScreenStream(null);
          setScreenState('ready');
          update(ref(db, `${callPath}/participants/${user.uid}`), {
            screenReady: true,
            screenSharing: false,
            screenStoppedAt: Date.now(),
          }).catch(() => {});
        }, { once: true });
      });
      setScreenStream(stream);
      await update(ref(db, `${callPath}/participants/${user.uid}`), {
        screenReady,
        screenSharing: screenReady,
        screenCheckedAt: Date.now(),
      });
      setScreenState(screenReady ? 'sharing' : 'blocked');
    } catch (error) {
      setScreenState('blocked');
      window.showToast?.(`Screen share failed: ${error.message}`);
    }
  };

  const checkDevices = async () => {
    if (!user?.uid) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState('unsupported');
      return;
    }

    try {
      if (!isJoined) await joinCall('voice');
      setPermissionState('checking');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: canUseVideoCalls });
      const micReady = stream.getAudioTracks().length > 0;
      const cameraReady = stream.getVideoTracks().length > 0;
      stream.getTracks().forEach((track) => track.stop());
      await update(ref(db, `${callPath}/participants/${user.uid}`), {
        micReady,
        cameraReady,
        videoAllowed: canUseVideoCalls,
        checkedAt: Date.now(),
      });
      setPermissionState(micReady && (canUseVideoCalls ? cameraReady : true) ? 'ready' : 'partial');
    } catch (error) {
      setPermissionState('blocked');
      window.showToast?.(`Device check failed: ${error.message}`);
    }
  };

  return (
    <div className="calls-wrap">
      <div className="calls-hero">
        <div>
          <div className="calls-kicker"><i className="ph-bold ph-phone-call" /> Room calls foundation</div>
          <h3>{isActive ? 'Call space is open' : 'Start a room call space'}</h3>
          <p>
            Voice calls are available to everyone. Pro unlocks camera checks, video call upgrades, and screen sharing.
          </p>
        </div>
        <div className={`call-status-pill ${isActive ? 'active' : ''}`}>
          <span className="call-dot" /> {isActive ? `${call.type === 'video' ? 'Video' : 'Voice'} · live since ${formatStartedAt(call.startedAt)}` : 'No active call'}
        </div>
      </div>

      <div className="calls-grid">
        <section className="call-card">
          <div className="call-card-head">
            <h4><i className="ph-bold ph-users-three" /> Participants</h4>
            <span>{participants.length}</span>
          </div>
          <div className="call-participants">
            {participants.length ? participants.map((participant) => (
              <div className="call-person" key={participant.uid}>
                <img src={participant.photoUrl || window.getAvatarUrl?.(participant.name, '')} alt="" />
                <div>
                  <strong>{participant.name}</strong>
                  <span>{participant.screenSharing ? 'Sharing screen' : readinessLabel(participant)}</span>
                </div>
                {participant.uid === call?.hostUid ? <em>Host</em> : null}
              </div>
            )) : <div className="call-empty">No one is in the call space yet.</div>}
          </div>
        </section>

        <section className="call-card">
          <div className="call-card-head">
            <h4><i className="ph-bold ph-shield-check" /> Device readiness</h4>
          </div>
          <p className="call-muted">
            The check button asks the browser for mic/camera permission, then immediately stops the preview stream.
          </p>
          <div className={`call-device-state state-${permissionState}`}>
            {permissionState === 'idle' ? 'Devices not checked in this browser.' : null}
            {permissionState === 'checking' ? 'Checking devices…' : null}
            {permissionState === 'ready' ? (canUseVideoCalls ? 'Mic and camera are ready.' : 'Mic is ready for voice calls.') : null}
            {permissionState === 'partial' ? 'One device is ready; check browser/device settings.' : null}
            {permissionState === 'blocked' ? 'Permission was blocked or no device was found.' : null}
            {permissionState === 'unsupported' ? 'This browser does not expose media device checks.' : null}
          </div>
        </section>

        <section className="call-card">
          <div className="call-card-head">
            <h4><i className="ph-bold ph-monitor-arrow-up" /> Screen sharing</h4>
          </div>
          <p className="call-muted">
            Start a browser screen capture, preview it locally, and let the room know you are sharing.
          </p>
          {screenStream ? (
            <video className="screen-preview" ref={screenVideoRef} autoPlay muted playsInline aria-label="Your shared screen preview" />
          ) : null}
          <div className={`call-device-state state-${screenState}`}>
            {screenState === 'idle' ? 'Screen sharing not checked in this browser.' : null}
            {screenState === 'checking' ? 'Checking screen-share permission…' : null}
            {screenState === 'ready' ? 'Screen sharing is ready.' : null}
            {screenState === 'sharing' ? 'You are sharing your screen preview.' : null}
            {screenState === 'blocked' ? 'Screen sharing was cancelled or blocked.' : null}
            {screenState === 'unsupported' ? 'This browser does not support screen sharing.' : null}
          </div>
        </section>
      </div>

      <div className="call-control-bar">
        {!isActive ? (
          <button type="button" className="call-primary" onClick={() => joinCall('voice')}><i className="ph-bold ph-phone-call" /> Start voice call</button>
        ) : isJoined ? (
          <button type="button" className="call-secondary" onClick={leaveCall}><i className="ph-bold ph-phone-disconnect" /> Leave</button>
        ) : (
          <button type="button" className="call-primary" onClick={() => joinCall('voice')}><i className="ph-bold ph-phone-call" /> Join voice call</button>
        )}
        <button type="button" className="call-secondary" onClick={checkDevices}><i className="ph-bold ph-microphone" /> Check mic{canUseVideoCalls ? '/camera' : ''}</button>
        <button type="button" className="call-secondary" onClick={() => joinCall('video')}><i className="ph-bold ph-video-camera" /> {canUseVideoCalls ? 'Upgrade to video' : 'Video is Pro'}</button>
        {screenStream ? (
          <button type="button" className="call-danger" onClick={() => stopScreenShare()}><i className="ph-bold ph-monitor-x" /> Stop sharing</button>
        ) : (
          <button type="button" className="call-secondary" onClick={startScreenShare}><i className="ph-bold ph-monitor-arrow-up" /> Share screen</button>
        )}
        {canEnd ? <button type="button" className="call-danger" onClick={endCall}><i className="ph-bold ph-x-circle" /> End for room</button> : null}
      </div>
    </div>
  );
}
