import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onChildAdded, push, ref, remove, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';

// Public STUN is sufficient for the same peer-to-peer path used by room calls.
// TURN can be added here later without changing the hook's public API.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function usableAudioStream(stream) {
  return Boolean(stream?.getAudioTracks?.().some((track) => track.readyState === 'live'));
}

function audioPermissionMessage(error) {
  const name = String(error?.name || '');
  if (!window.isSecureContext) return 'Calls need HTTPS to use your microphone.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Microphone permission was denied. Allow microphone access for this site, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found on this device.';
  }
  return error?.message || 'This browser could not open your microphone.';
}

async function requestAudioStream() {
  if (!window.isSecureContext) throw new Error('Calls need HTTPS to use your microphone.');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support microphone access.');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (!usableAudioStream(stream)) {
      stopMediaStream(stream);
      throw new Error('No microphone was found on this device.');
    }
    return stream;
  } catch (error) {
    throw new Error(audioPermissionMessage(error));
  }
}

function participantUids(participants, myUid) {
  const values = Array.isArray(participants)
    ? participants.map((participant, index) => [String(index), participant])
    : Object.entries(participants || {});

  const uids = values.flatMap(([key, participant]) => {
    const uid = typeof participant === 'string' ? participant : participant?.uid || key;
    return uid && uid !== myUid ? [uid] : [];
  });

  return [...new Set(uids)].sort();
}

/**
 * Runs the audio-only WebRTC mesh for a one-to-one RTDB-backed call.
 * Call lifecycle (ringing/accepted/ended) remains owned by the caller so this
 * hook can focus on media, peer reconciliation, and deterministic cleanup.
 */
export function useDirectAudioCall({
  callPath,
  joined,
  myUid,
  participants,
  initialStream = null,
}) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [engineReady, setEngineReady] = useState(false);
  const [connectionState, setConnectionState] = useState('idle');
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');

  const engineRef = useRef(null);
  const initialStreamRef = useRef(initialStream);
  const micOnRef = useRef(true);

  useEffect(() => {
    initialStreamRef.current = initialStream;
  }, [initialStream]);

  const otherUids = useMemo(
    () => participantUids(participants, myUid),
    [myUid, participants],
  );

  useEffect(() => {
    if (!joined || !callPath || !myUid) return undefined;

    let disposed = false;
    let local = null;
    let localMediaUsable = false;
    let unsubscribeSignals = null;
    let signalChain = Promise.resolve();
    const peers = new Map();
    const remoteStreamMap = new Map();

    const syncConnectionState = () => {
      if (disposed) return;
      if (!localMediaUsable) {
        setConnectionState('failed');
        return;
      }

      const peerStates = [...peers.values()].map(({ pc }) => pc.connectionState);
      const hasConnectedPeer = peerStates.includes('connected');
      const hasLiveRemoteAudio = [...remoteStreamMap.values()].some((stream) => (
        stream.getAudioTracks().some((track) => track.readyState === 'live')
      ));
      const hasUnavailablePeer = peerStates.some((state) => (
        state === 'disconnected' || state === 'failed' || state === 'closed'
      ));
      const hasHardFailure = peerStates.length > 0
        && peerStates.every((state) => state === 'failed' || state === 'closed');

      if (hasConnectedPeer || (hasLiveRemoteAudio && !hasUnavailablePeer)) {
        setConnectionState('connected');
      } else if (hasHardFailure) {
        setConnectionState('failed');
      } else {
        setConnectionState('connecting');
      }
    };

    const sendSignal = (toUid, data) => {
      push(ref(db, `${callPath}/signals/${toUid}`), {
        from: myUid,
        ...data,
        ts: Date.now(),
      }).catch(() => {});
    };

    const setRemoteStream = (uid, stream) => {
      if (disposed) return;
      remoteStreamMap.set(uid, stream);
      setRemoteStreams((current) => (
        current[uid] === stream ? current : { ...current, [uid]: stream }
      ));
      syncConnectionState();
    };

    const clearRemoteStream = (uid, expectedStream = null) => {
      if (disposed) return;
      const currentStream = remoteStreamMap.get(uid);
      if (!currentStream || (expectedStream && currentStream !== expectedStream)) return;
      remoteStreamMap.delete(uid);
      setRemoteStreams((current) => {
        if (!current[uid] || (expectedStream && current[uid] !== expectedStream)) return current;
        const next = { ...current };
        delete next[uid];
        return next;
      });
      syncConnectionState();
    };

    const createPeer = (otherUid) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const entry = {
        pc,
        polite: myUid < otherUid,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingCandidates: [],
      };
      peers.set(otherUid, entry);
      syncConnectionState();

      if (local) {
        local.getAudioTracks().forEach((track) => pc.addTrack(track, local));
      } else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          sendSignal(otherUid, { kind: 'desc', desc: pc.localDescription.toJSON() });
        } catch (negotiationError) {
          if (!disposed) setError(negotiationError?.message || 'Audio negotiation failed.');
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) sendSignal(otherUid, { kind: 'cand', cand: candidate.toJSON() });
      };

      pc.ontrack = ({ track, streams }) => {
        const stream = streams[0];
        if (!stream || track.kind !== 'audio') return;
        setRemoteStream(otherUid, stream);

        const clearIfEnded = () => {
          if (stream.getAudioTracks().every((audioTrack) => audioTrack.readyState === 'ended')) {
            clearRemoteStream(otherUid, stream);
          }
        };
        track.addEventListener('ended', clearIfEnded, { once: true });
        stream.addEventListener('removetrack', clearIfEnded);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') clearRemoteStream(otherUid);
        syncConnectionState();
      };
      pc.oniceconnectionstatechange = syncConnectionState;

      return entry;
    };

    const closePeer = (uid) => {
      const entry = peers.get(uid);
      if (entry) {
        try { entry.pc.close(); } catch { /* The connection is already closed. */ }
        peers.delete(uid);
      }
      clearRemoteStream(uid);
      syncConnectionState();
    };

    const addCandidate = async (entry, candidate) => {
      if (!entry.pc.remoteDescription) {
        entry.pendingCandidates.push(candidate);
        return;
      }
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (candidateError) {
        if (!entry.ignoreOffer) throw candidateError;
      }
    };

    const flushCandidates = async (entry) => {
      const pending = entry.pendingCandidates.splice(0);
      for (const candidate of pending) {
        await addCandidate(entry, candidate);
      }
    };

    const handleSignal = async (message) => {
      const fromUid = message?.from;
      if (!fromUid || fromUid === myUid || disposed) return;

      let entry = peers.get(fromUid);
      if (!entry) entry = createPeer(fromUid);
      const { pc } = entry;

      try {
        if (message.kind === 'desc' && message.desc) {
          const description = message.desc;
          const readyForOffer = !entry.makingOffer
            && (pc.signalingState === 'stable' || entry.isSettingRemoteAnswerPending);
          const offerCollision = description.type === 'offer' && !readyForOffer;
          entry.ignoreOffer = !entry.polite && offerCollision;
          if (entry.ignoreOffer) return;

          entry.isSettingRemoteAnswerPending = description.type === 'answer';
          try {
            await pc.setRemoteDescription(description);
          } finally {
            entry.isSettingRemoteAnswerPending = false;
          }
          await flushCandidates(entry);

          if (description.type === 'offer') {
            await pc.setLocalDescription();
            sendSignal(fromUid, { kind: 'desc', desc: pc.localDescription.toJSON() });
          }
        } else if (message.kind === 'cand' && message.cand && !entry.ignoreOffer) {
          await addCandidate(entry, message.cand);
        }
      } catch (signalError) {
        if (!disposed) setError(signalError?.message || 'The audio connection was interrupted.');
      }
    };

    const reconcile = (uids) => {
      const activeUids = new Set(uids);
      uids.forEach((uid) => {
        // One deterministic side starts the connection; the other creates its
        // peer lazily when the first offer arrives, reducing offer glare.
        if (!peers.has(uid) && myUid < uid) createPeer(uid);
      });
      [...peers.keys()].forEach((uid) => {
        if (!activeUids.has(uid)) closePeer(uid);
      });
    };

    const teardown = () => {
      if (disposed) return;
      disposed = true;
      unsubscribeSignals?.();
      peers.forEach(({ pc }) => {
        try { pc.close(); } catch { /* The connection is already closed. */ }
      });
      peers.clear();
      remoteStreamMap.clear();
      stopMediaStream(local);
      local = null;
      localMediaUsable = false;
      remove(ref(db, `${callPath}/signals/${myUid}`)).catch(() => {});

      if (engineRef.current === controller) engineRef.current = null;
      setEngineReady(false);
      setConnectionState('idle');
      setError('');
      setLocalStream(null);
      setRemoteStreams({});
    };

    const controller = {
      reconcile,
      setMicEnabled(enabled) {
        local?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
      },
      stop: teardown,
    };
    engineRef.current = controller;

    (async () => {
      setEngineReady(false);
      setConnectionState('connecting');
      setError('');
      try {
        if (typeof RTCPeerConnection === 'undefined') {
          throw new Error('This browser does not support peer-to-peer audio calls.');
        }

        const providedStream = initialStreamRef.current;
        initialStreamRef.current = null;
        local = usableAudioStream(providedStream) ? providedStream : await requestAudioStream();
        if (providedStream && providedStream !== local) stopMediaStream(providedStream);
      } catch (mediaError) {
        local = null;
        if (!disposed) {
          setEngineReady(false);
          setConnectionState('failed');
          setError(audioPermissionMessage(mediaError));
        }
      }

      if (disposed) {
        stopMediaStream(local);
        return;
      }

      if (local) {
        localMediaUsable = usableAudioStream(local);
        local.getAudioTracks().forEach((track) => {
          track.enabled = micOnRef.current;
          track.addEventListener('ended', () => {
            if (disposed) return;
            localMediaUsable = usableAudioStream(local);
            setEngineReady(localMediaUsable);
            if (!localMediaUsable) setError('The microphone disconnected during the call.');
            syncConnectionState();
          }, { once: true });
        });
        setLocalStream(local);
        setEngineReady(localMediaUsable);
        syncConnectionState();
        update(ref(db, `${callPath}/participants/${myUid}`), {
          micOn: micOnRef.current,
          lastSeen: Date.now(),
        }).catch(() => {});
      }

      unsubscribeSignals = onChildAdded(ref(db, `${callPath}/signals/${myUid}`), (snapshot) => {
        const message = snapshot.val();
        remove(snapshot.ref).catch(() => {});
        signalChain = signalChain.then(() => handleSignal(message));
      });
    })();

    return teardown;
  }, [callPath, joined, myUid]);

  useEffect(() => {
    if (!engineReady) return;
    engineRef.current?.reconcile(otherUids);
  }, [engineReady, otherUids]);

  const toggleMic = useCallback(() => {
    setMicOn((current) => {
      const next = !current;
      micOnRef.current = next;
      engineRef.current?.setMicEnabled(next);
      if (joined && callPath && myUid) {
        update(ref(db, `${callPath}/participants/${myUid}`), {
          micOn: next,
          lastSeen: Date.now(),
        }).catch(() => {});
      }
      return next;
    });
  }, [callPath, joined, myUid]);

  const stop = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
      return;
    }
    stopMediaStream(initialStreamRef.current);
    initialStreamRef.current = null;
    setEngineReady(false);
    setConnectionState('idle');
    setError('');
    setLocalStream(null);
    setRemoteStreams({});
  }, []);

  return {
    localStream,
    remoteStreams,
    engineReady,
    connectionState,
    micOn,
    toggleMic,
    error,
    stop,
  };
}
