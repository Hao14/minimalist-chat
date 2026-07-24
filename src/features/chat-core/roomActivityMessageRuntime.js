import { push, ref, serverTimestamp, set } from 'firebase/database';
import { auth, db } from '../../lib/firebase.js';

function messagesRef(roomId, channelId = 'general') {
  if (roomId === 'global') return ref(db, 'messages');
  if (!channelId || channelId === 'general') return ref(db, `rooms_data/${roomId}/messages`);
  return ref(db, `rooms_data/${roomId}/channels/${channelId}/messages`);
}

async function writeWithAuthRetry(target, payload) {
  try {
    await set(target, payload);
  } catch (error) {
    const user = window.currentUser || auth.currentUser || null;
    if (error?.code !== 'PERMISSION_DENIED' || typeof user?.getIdToken !== 'function') throw error;
    await user.getIdToken(true).catch(() => {});
    await set(target, payload);
  }
}

export async function postRoomActivityMessage(roomId, channelId, profile, activityEvent) {
  if (!profile.uid) return;
  await writeWithAuthRetry(push(messagesRef(roomId, channelId)), {
    uid: profile.uid,
    name: 'Room activity',
    photoUrl: '',
    text: '',
    timestamp: serverTimestamp(),
    tier: profile.tier,
    automation: true,
    requestedBy: profile.uid,
    activityEvent: {
      type: String(activityEvent.type || 'activity').slice(0, 40),
      label: String(activityEvent.label || 'Room activity').slice(0, 80),
      detail: String(activityEvent.detail || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    },
  });
}
