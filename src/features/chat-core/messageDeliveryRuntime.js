import { ref, runTransaction, serverTimestamp } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { getDatabaseConnectionState } from '../../lib/databaseConnection.js';
import { getStorageUploadTools } from '../../lib/firebaseStorage.js';
import { roomUploadLimits } from '../billing/roomEntitlements.js';

const DELIVERY_TIMEOUT_MS = 15_000;
const uploadLimits = {
  free: { label: 'Base', perFile: 10 * 1024 * 1024, daily: 500 * 1024 * 1024 },
  advanced: { label: 'Advanced', perFile: 700 * 1024 * 1024, daily: 1.5 * 1024 * 1024 * 1024 },
  pro: { label: 'Pro', perFile: 3 * 1024 * 1024 * 1024, daily: 9 * 1024 * 1024 * 1024 },
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function withDeliveryTimeout(promise) {
  let timerId = null;
  const timeout = new Promise((_, reject) => {
    timerId = window.setTimeout(() => {
      const error = new Error('Delivery could not be confirmed. Check your connection and retry.');
      error.code = 'delivery_timeout';
      reject(error);
    }, DELIVERY_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timerId));
}

export async function preflightMessageDelivery({ canPost, getCurrentUid, requesterUid, waitForBotConfig }) {
  if (getDatabaseConnectionState() === 'offline' || navigator.onLine === false) {
    const error = new Error('You are offline.');
    error.code = 'offline';
    throw error;
  }
  const [postingAllowed, botConfig] = await withDeliveryTimeout(Promise.all([canPost(), waitForBotConfig()]));
  if (!postingAllowed) {
    const error = new Error('Posting is unavailable in this room. Retry after access is restored.');
    error.code = 'posting_unavailable';
    throw error;
  }
  if (getCurrentUid() !== requesterUid) {
    const error = new Error('The active account changed. Switch back, then retry.');
    error.code = 'account_changed';
    throw error;
  }
  if (!botConfig) {
    const error = new Error('Room app settings are still loading. Your draft was kept in the failed message; retry in a moment.');
    error.code = 'room_config_pending';
    throw error;
  }
  return botConfig;
}

export function deliveryErrorMessage(error, roomId) {
  if (error?.code === 'offline') return 'You are offline. Reconnect, then retry.';
  if (error?.code === 'delivery_timeout') return 'Delivery was not confirmed. Retry when your connection is stable.';
  if (String(error?.code || '').toLowerCase().includes('permission_denied')) {
    return roomId === 'global'
      ? 'Global Chat did not accept this message. Refresh or retry.'
      : 'This room did not accept the message. Check access, then retry.';
  }
  return String(error?.message || 'Message failed to send.').slice(0, 180);
}

async function prepareAttachment(attempt, ensureFilePermission) {
  const { file, profile, requesterUid, roomId } = attempt;
  if (!file || attempt.uploadedFile) return;
  if (roomId !== 'global' && !(await ensureFilePermission())) {
    const error = new Error('File uploads are disabled in this room.');
    error.code = 'file_permission_denied';
    throw error;
  }

  const accountLimits = uploadLimits[profile.tier] || uploadLimits.free;
  const limits = roomId === 'global'
    ? accountLimits
    : roomUploadLimits(accountLimits, attempt.roomEntitlement, requesterUid);
  if (file.size > limits.perFile) throw new Error(`${limits.label} allows up to ${formatBytes(limits.perFile)} per file.`);

  const reservedUploadRef = ref(db, `upload_usage/${requesterUid}/${todayKey()}`);
  const reservation = await runTransaction(reservedUploadRef, (current) => {
    const used = Number(current || 0);
    if (used + file.size > limits.daily) return;
    return used + file.size;
  });
  if (!reservation.committed) throw new Error(`${limits.label} daily upload limit reached. Daily max is ${formatBytes(limits.daily)}.`);

  const safeName = file.name.replace(/[^\w.\-()[\] ]+/g, '_');
  const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
  const target = storageRef(storage, `chat_files/${requesterUid}/${roomId}/${attempt.id}_${safeName}`);
  try {
    const uploadTask = uploadBytesResumable(target, file, {
      contentType: file.type || 'application/octet-stream',
      customMetadata: {
        ownerUid: requesterUid,
        roomId,
        messageId: String(attempt.id || ''),
      },
    });
    attempt.cancelUpload = () => uploadTask.cancel();
    await new Promise((resolve, reject) => {
      uploadTask.on('state_changed', (snapshot) => {
        const totalBytes = Number(snapshot.totalBytes || file.size || 0);
        const bytesTransferred = Number(snapshot.bytesTransferred || 0);
        const progress = totalBytes ? Math.min(100, Math.round((bytesTransferred / totalBytes) * 100)) : 0;
        attempt.onUploadProgress?.({
          bytesTransferred,
          progress,
          state: snapshot.state,
          totalBytes,
        });
      }, reject, resolve);
    });
    const fileUrl = await getDownloadURL(target);
    const textPreview = await attempt.readTextPreview(file);
    attempt.uploadedImageUrl = file.type.startsWith('image/') ? fileUrl : null;
    attempt.uploadedFile = {
      url: fileUrl,
      name: file.name,
      type: file.type || 'File',
      size: file.size,
      ...(textPreview || {}),
    };
    attempt.onUploadProgress?.({
      bytesTransferred: file.size,
      progress: 100,
      state: 'complete',
      totalBytes: file.size,
    });
    window.awardXP?.(requesterUid, 'creativity', 3);
  } catch (error) {
    await runTransaction(reservedUploadRef, (current) => Math.max(0, Number(current || 0) - file.size));
    throw error;
  } finally {
    attempt.cancelUpload = null;
  }
}

export async function deliverMessageAttempt(attempt, { ensureFilePermission, writeMessage }) {
  await prepareAttachment(attempt, ensureFilePermission);
  const payload = {
    uid: attempt.profile.uid,
    name: attempt.profile.name,
    photoUrl: attempt.profile.photoUrl,
    text: attempt.text,
    attachedImage: attempt.uploadedImageUrl || null,
    attachedFile: attempt.uploadedFile || null,
    timestamp: serverTimestamp(),
    tier: attempt.profile.tier,
  };
  if (attempt.reply) {
    payload.replyTo = {
      ...attempt.reply,
      roomId: attempt.roomId,
      channelId: attempt.channelId,
    };
    payload.threadRootId = String(attempt.reply.threadRootId || attempt.reply.id || '');
    payload.threadParentId = String(attempt.reply.id || '');
  }
  await withDeliveryTimeout(writeMessage(payload));
  return payload;
}
