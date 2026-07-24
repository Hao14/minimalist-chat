const DATABASE_NAME = 'minimalist-chat-outbox';
const DATABASE_VERSION = 1;
const STORE_NAME = 'message-attempts';

let databasePromise = null;

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('requesterUid', 'requesterUid');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the local outbox.'));
  });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local outbox operation failed.'));
  });
}

export function serializableOutboxAttempt(attempt = {}) {
  return {
    id: String(attempt.id || ''),
    roomId: String(attempt.roomId || ''),
    roomName: String(attempt.roomName || ''),
    roomShortId: String(attempt.roomShortId || ''),
    channelId: String(attempt.channelId || 'general'),
    scopeKey: String(attempt.scopeKey || ''),
    requesterUid: String(attempt.requesterUid || ''),
    text: String(attempt.text || ''),
    previewUrl: String(attempt.previewUrl || ''),
    file: attempt.file || null,
    reply: attempt.reply || null,
    profile: attempt.profile || null,
    roomEntitlement: attempt.roomEntitlement || null,
    createdAt: Number(attempt.createdAt || Date.now()),
    optimisticMessage: attempt.optimisticMessage || null,
    uploadedImageUrl: attempt.uploadedImageUrl || null,
    uploadedFile: attempt.uploadedFile || null,
  };
}

export async function saveOutboxAttempt(attempt) {
  const record = serializableOutboxAttempt(attempt);
  if (!record.id || !record.requesterUid) return false;
  const database = await openDatabase();
  if (!database) return false;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).put(record));
  return true;
}

export async function removeOutboxAttempt(id) {
  const database = await openDatabase();
  if (!database) return false;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).delete(String(id || '')));
  return true;
}

export async function loadOutboxAttempts(requesterUid) {
  const database = await openDatabase();
  if (!database || !requesterUid) return [];
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const records = await requestResult(
    transaction.objectStore(STORE_NAME).index('requesterUid').getAll(String(requesterUid)),
  );
  return records.sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
}
