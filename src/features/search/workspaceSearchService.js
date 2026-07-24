import {
  endBefore,
  get,
  limitToLast,
  orderByChild,
  query,
  ref,
} from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { mergeWorkspaceMessagePages } from './workspaceSearchModel.js';

export const WORKSPACE_SEARCH_PAGE_SIZE = 80;
const MANIFEST_TTL_MS = 2 * 60 * 1000;
const MESSAGE_INDEX_TTL_MS = 30 * 1000;
const READ_CONCURRENCY = 6;

const workspaceCaches = new Map();
let directoryCache = null;
let directoryLoad = null;

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
}

function roomSource(room, channelId = 'general', channelName = 'general') {
  const isGlobal = room.id === 'global';
  const path = isGlobal
    ? 'messages'
    : channelId === 'general'
      ? `rooms_data/${room.id}/messages`
      : `rooms_data/${room.id}/channels/${channelId}/messages`;
  return {
    key: `${room.id}:${channelId}`,
    path,
    room,
    channelId,
    channelName,
  };
}

async function loadWorkspaceManifest(uid) {
  const roomsSnapshot = await get(ref(db, `user_rooms/${uid}`));
  const indexedRooms = [];
  roomsSnapshot.forEach((child) => {
    if (child.key !== 'global') indexedRooms.push({ id: child.key, ...(child.val() || {}) });
  });

  const metadataResults = await mapWithConcurrency(
    indexedRooms,
    READ_CONCURRENCY,
    async (indexedRoom) => {
      const roomMetaPath = `rooms_meta/${indexedRoom.id}`;
      const [creatorSnapshot, memberSnapshot, channelsSnapshot] = await Promise.all([
        get(ref(db, `${roomMetaPath}/creatorId`)),
        get(ref(db, `${roomMetaPath}/members/${uid}`)),
        get(ref(db, `${roomMetaPath}/channels`)),
      ]);
      const creatorId = creatorSnapshot.val() || '';
      const isMember = creatorId === uid || memberSnapshot.exists();
      if (!isMember) return null;
      return {
        ...indexedRoom,
        id: indexedRoom.id,
        creatorId,
        channels: channelsSnapshot.val() || {},
        name: indexedRoom.name || 'Room',
        shortId: indexedRoom.shortId || '',
      };
    },
  );

  const joinedRooms = metadataResults.filter((result) => result && !result.error);
  const globalRoom = {
    id: 'global',
    name: 'Global Chat',
    shortId: 'GLOBAL',
    mine: true,
  };
  const rooms = [globalRoom, ...joinedRooms];
  const sources = [roomSource(globalRoom)];

  joinedRooms.forEach((room) => {
    sources.push(roomSource(room));
    Object.entries(room.channels || {}).forEach(([channelId, channel]) => {
      if (!channelId || channelId === 'general') return;
      sources.push(roomSource(room, channelId, channel?.name || channelId));
    });
  });

  return {
    loadedAt: Date.now(),
    rooms,
    sources,
    skippedRoomCount: metadataResults.filter((result) => !result || result.error).length,
  };
}

function normalizedMessage(source, child) {
  const raw = child.val() || {};
  const poll = raw.poll && typeof raw.poll === 'object' ? {
    question: raw.poll.question || '',
    options: raw.poll.options || [],
    closed: raw.poll.closed === true,
    createdAt: Number(raw.poll.createdAt || 0),
  } : null;
  return {
    id: child.key,
    messageId: child.key,
    text: raw.text || '',
    name: raw.name || 'Someone',
    uid: raw.uid || '',
    authorShortId: raw.shortId || raw.authorShortId || '',
    authorHandle: raw.handle || '',
    timestamp: Number(raw.timestamp ?? raw.ts ?? raw.createdAt ?? 0),
    orderTimestamp: raw.timestamp ?? null,
    room: source.room.id,
    roomId: source.room.id,
    roomName: source.room.name,
    shortId: source.room.shortId || '',
    channelId: source.channelId,
    channelName: source.channelName,
    attachedImage: raw.attachedImage || null,
    attachedFile: raw.attachedFile || null,
    attachment: raw.attachment || null,
    file: raw.file || null,
    imageUrl: raw.imageUrl || '',
    linkPreview: raw.linkPreview || null,
    poll,
    mentions: raw.mentions || null,
    replyTo: raw.replyTo || null,
    threadId: raw.threadId || '',
    threadRootId: raw.threadRootId || '',
    parentMessageId: raw.parentMessageId || '',
  };
}

async function loadSourcePage(source, cursor = null) {
  const constraints = [orderByChild('timestamp')];
  if (cursor?.timestamp !== undefined && cursor?.id) {
    constraints.push(endBefore(cursor.timestamp, cursor.id));
  }
  constraints.push(limitToLast(WORKSPACE_SEARCH_PAGE_SIZE));
  const snapshot = await get(query(ref(db, source.path), ...constraints));
  const messages = [];
  snapshot.forEach((child) => messages.push(normalizedMessage(source, child)));
  const oldestByIndex = messages[0];
  messages.sort((left, right) => (
    right.timestamp - left.timestamp
    || String(right.id).localeCompare(String(left.id))
  ));
  return {
    messages,
    cursor: oldestByIndex ? {
      timestamp: oldestByIndex.orderTimestamp,
      id: oldestByIndex.id,
    } : null,
    hasMore: messages.length === WORKSPACE_SEARCH_PAGE_SIZE,
    error: null,
  };
}

function cacheSnapshot(cache) {
  const sourceIndexes = [...cache.sourceIndexes.values()];
  const messages = mergeWorkspaceMessagePages(
    [],
    sourceIndexes.flatMap((sourceIndex) => sourceIndex.messages),
  );
  return {
    rooms: cache.manifest.rooms,
    messages,
    loadedAt: cache.loadedAt,
    loadedMessageCount: messages.length,
    sourceCount: cache.manifest.sources.length,
    loadedSourceCount: sourceIndexes.filter((source) => !source.error).length,
    failedSourceCount: sourceIndexes.filter((source) => source.error).length,
    skippedRoomCount: cache.manifest.skippedRoomCount,
    hasMore: sourceIndexes.some((source) => source.hasMore),
  };
}

async function createWorkspaceCache(uid) {
  const manifest = await loadWorkspaceManifest(uid);
  const pageResults = await mapWithConcurrency(
    manifest.sources,
    READ_CONCURRENCY,
    async (source) => ({ source, page: await loadSourcePage(source) }),
  );
  const sourceIndexes = new Map();

  pageResults.forEach((result, index) => {
    const source = result?.source || manifest.sources[index];
    if (result?.error) {
      sourceIndexes.set(source.key, {
        source,
        messages: [],
        cursor: null,
        hasMore: false,
        error: result.error,
      });
      return;
    }
    sourceIndexes.set(source.key, { source, ...result.page });
  });

  return {
    uid,
    manifest,
    sourceIndexes,
    loadedAt: Date.now(),
    promise: null,
  };
}

export async function loadWorkspaceSearchIndex(uid, { force = false } = {}) {
  if (!uid) return {
    rooms: [],
    messages: [],
    loadedMessageCount: 0,
    sourceCount: 0,
    loadedSourceCount: 0,
    failedSourceCount: 0,
    skippedRoomCount: 0,
    hasMore: false,
  };

  const cached = workspaceCaches.get(uid);
  if (cached?.promise) return cached.promise;
  const manifestFresh = cached && Date.now() - cached.manifest.loadedAt < MANIFEST_TTL_MS;
  const messagesFresh = cached && Date.now() - cached.loadedAt < MESSAGE_INDEX_TTL_MS;
  if (!force && manifestFresh && messagesFresh) return cacheSnapshot(cached);

  const promise = createWorkspaceCache(uid)
    .then((nextCache) => {
      workspaceCaches.set(uid, nextCache);
      if (workspaceCaches.size > 3) {
        const oldestUid = [...workspaceCaches.keys()].find((cacheUid) => cacheUid !== uid);
        if (oldestUid) workspaceCaches.delete(oldestUid);
      }
      return cacheSnapshot(nextCache);
    })
    .catch((error) => {
      if (workspaceCaches.get(uid)?.promise === promise) workspaceCaches.delete(uid);
      throw error;
    });
  workspaceCaches.set(uid, { ...(cached || {}), uid, promise });
  return promise;
}

export async function loadOlderWorkspaceMessages(uid) {
  let cache = workspaceCaches.get(uid);
  if (!cache?.manifest || !cache?.sourceIndexes) {
    await loadWorkspaceSearchIndex(uid);
    cache = workspaceCaches.get(uid);
  }
  if (!cache) return loadWorkspaceSearchIndex(uid);
  if (cache.olderPromise) return cache.olderPromise;

  const eligible = [...cache.sourceIndexes.values()].filter((sourceIndex) => (
    sourceIndex.hasMore && sourceIndex.cursor
  ));
  if (!eligible.length) return cacheSnapshot(cache);

  const olderPromise = mapWithConcurrency(
    eligible,
    READ_CONCURRENCY,
    async (sourceIndex) => ({
      key: sourceIndex.source.key,
      page: await loadSourcePage(sourceIndex.source, sourceIndex.cursor),
    }),
  ).then((results) => {
    results.forEach((result, index) => {
      const current = eligible[index];
      if (result?.error) {
        cache.sourceIndexes.set(current.source.key, {
          ...current,
          hasMore: false,
          error: result.error,
        });
        return;
      }
      cache.sourceIndexes.set(result.key, {
        ...current,
        ...result.page,
        messages: mergeWorkspaceMessagePages(current.messages, result.page.messages),
      });
    });
    cache.loadedAt = Date.now();
    return cacheSnapshot(cache);
  }).finally(() => {
    if (cache.olderPromise === olderPromise) cache.olderPromise = null;
  });

  cache.olderPromise = olderPromise;
  return olderPromise;
}

export async function loadWorkspacePeopleDirectory(uid) {
  const fresh = directoryCache?.uid === uid
    && Date.now() - directoryCache.loadedAt < MANIFEST_TTL_MS;
  if (fresh) return directoryCache.users;
  if (directoryLoad?.uid === uid) return directoryLoad.promise;

  const promise = get(ref(db, 'user_directory'))
    .then((snapshot) => {
      directoryCache = {
        uid,
        loadedAt: Date.now(),
        users: snapshot.val() || {},
      };
      return directoryCache.users;
    })
    .finally(() => {
      if (directoryLoad?.promise === promise) directoryLoad = null;
    });
  directoryLoad = { uid, promise };
  return promise;
}
