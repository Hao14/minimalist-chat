'use strict';

const { createHash } = require('node:crypto');
const {
    rankAiSemanticCandidates
} = require('./ai-semantic-search');

const KNOWLEDGE_INDEX_VERSION = 1;
const KNOWLEDGE_INDEX_SOURCE_TYPES = Object.freeze([
    'message',
    'task',
    'document',
    'event',
    'memory'
]);
const KNOWLEDGE_INDEX_LIMITS = Object.freeze({
    maxSnapshotItems: 5000,
    maxSnapshotChars: 12_000_000,
    maxItemChars: 12_000,
    maxTitleChars: 240,
    maxIdChars: 180,
    maxBatchUpserts: 64,
    maxBatchDeletes: 128,
    maxBatchChars: 512_000,
    maxMutationBatches: 256,
    maxRetrievalCandidates: 512,
    maxRetrievalResults: 24,
    maxCachedVectors: 20_000,
    maxVectorDimensions: 4096
});

function knowledgeIndexError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value, limit) {
    const text = compact(value);
    return text.length <= limit ? text : text.slice(0, limit);
}

function safeId(value, label = 'ID') {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,179}$/.test(id)) {
        throw knowledgeIndexError(`${label} is invalid.`, 'KNOWLEDGE_INDEX_ID_INVALID');
    }
    return id;
}

function safeUid(value) {
    const uid = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(uid)) {
        throw knowledgeIndexError('Knowledge-index owner is invalid.', 'KNOWLEDGE_INDEX_OWNER_INVALID');
    }
    return uid;
}

function boundedInteger(value, fallback, minimum, maximum) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function hash(value) {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
        .join(',')}}`;
}

function normalizedRoomSet(value) {
    const entries = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
    return new Set(entries.map((entry) => safeId(entry, 'Room ID')));
}

function normalizeKnowledgeIndexAcl(value, {
    ownerUid,
    roomId
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const scope = String(source.scope || (source.roomId || roomId ? 'room' : 'personal'))
        .trim()
        .toLowerCase();
    if (scope === 'personal') {
        return {
            scope,
            ownerUid: safeUid(source.ownerUid || ownerUid)
        };
    }
    if (scope === 'room') {
        return {
            scope,
            roomId: safeId(source.roomId || roomId, 'Room ID')
        };
    }
    throw knowledgeIndexError(
        'Knowledge-index scope must be personal or room.',
        'KNOWLEDGE_INDEX_SCOPE_INVALID'
    );
}

function canAccessKnowledgeIndexItem(item, {
    actorUid,
    authorizedRoomIds
} = {}) {
    let uid;
    let roomIds;
    try {
        uid = safeUid(actorUid);
        roomIds = normalizedRoomSet(authorizedRoomIds);
    } catch {
        return false;
    }
    const acl = item?.acl;
    if (!acl || typeof acl !== 'object') return false;
    if (acl.scope === 'personal') return acl.ownerUid === uid;
    if (acl.scope === 'room') return roomIds.has(acl.roomId);
    return false;
}

function knowledgeIndexContentHash(value) {
    const source = value && typeof value === 'object' ? value : {};
    return hash(stableJson({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        title: source.title,
        text: source.text,
        timestamp: source.timestamp
    }));
}

function knowledgeIndexAclHash(value) {
    return hash(stableJson(value?.acl || value || {}));
}

function knowledgeIndexRecordId(sourceType, sourceId, acl) {
    const normalizedAcl = normalizeKnowledgeIndexAcl(acl);
    const scopeKey = normalizedAcl.scope === 'personal'
        ? `personal:${normalizedAcl.ownerUid}`
        : `room:${normalizedAcl.roomId}`;
    return `ki_${hash(`${scopeKey}\0${sourceType}\0${sourceId}`).slice(0, 40)}`;
}

function knowledgeIndexSourceKey(sourceType, sourceId) {
    return `kis_${hash(`${sourceType}\0${sourceId}`).slice(0, 40)}`;
}

function knowledgeIndexVectorNamespace(value) {
    const item = value && typeof value === 'object' ? value : {};
    return `kiv1_${hash(`${item.id}\0${item.contentHash}\0${item.aclHash}`).slice(0, 40)}`;
}

function knowledgeIndexVectorCacheKey(value, model = 'default') {
    const item = value && typeof value === 'object' ? value : {};
    const namespace = item.vectorNamespace || knowledgeIndexVectorNamespace(item);
    const safeModel = String(model || 'default').trim().slice(0, 180);
    return `${namespace}_${hash(safeModel).slice(0, 16)}`;
}

function normalizeKnowledgeIndexItem(value, {
    maxItemChars = KNOWLEDGE_INDEX_LIMITS.maxItemChars,
    maxTitleChars = KNOWLEDGE_INDEX_LIMITS.maxTitleChars
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!source) {
        throw knowledgeIndexError(
            'Knowledge-index item must be an object.',
            'KNOWLEDGE_INDEX_ITEM_INVALID'
        );
    }
    const sourceType = String(source.sourceType || source.type || '').trim().toLowerCase();
    if (!KNOWLEDGE_INDEX_SOURCE_TYPES.includes(sourceType)) {
        throw knowledgeIndexError(
            'Knowledge-index source type is invalid.',
            'KNOWLEDGE_INDEX_SOURCE_TYPE_INVALID'
        );
    }
    const sourceId = safeId(source.sourceId || source.itemId || source.id, 'Source ID');
    const safeTextLimit = boundedInteger(
        maxItemChars,
        KNOWLEDGE_INDEX_LIMITS.maxItemChars,
        80,
        KNOWLEDGE_INDEX_LIMITS.maxItemChars
    );
    const text = compact(source.text || source.excerpt || source.content);
    if (!text) {
        throw knowledgeIndexError(
            'Knowledge-index text is required.',
            'KNOWLEDGE_INDEX_TEXT_REQUIRED'
        );
    }
    if (text.length > safeTextLimit) {
        throw knowledgeIndexError(
            'Knowledge-index text exceeds the hard limit.',
            'KNOWLEDGE_INDEX_TEXT_LIMIT'
        );
    }
    const title = clip(
        source.title || source.label || sourceType,
        boundedInteger(
            maxTitleChars,
            KNOWLEDGE_INDEX_LIMITS.maxTitleChars,
            20,
            KNOWLEDGE_INDEX_LIMITS.maxTitleChars
        )
    );
    const acl = normalizeKnowledgeIndexAcl(source.acl, {
        ownerUid: source.ownerUid,
        roomId: source.roomId
    });
    const item = {
        id: knowledgeIndexRecordId(sourceType, sourceId, acl),
        sourceKey: knowledgeIndexSourceKey(sourceType, sourceId),
        sourceType,
        sourceId,
        title,
        text,
        timestamp: Math.max(0, Math.floor(Number(source.timestamp || source.createdAt) || 0)),
        updatedAt: Math.max(0, Math.floor(Number(source.updatedAt || source.timestamp) || 0)),
        acl
    };
    item.contentHash = knowledgeIndexContentHash(item);
    item.aclHash = knowledgeIndexAclHash(item);
    item.recordHash = hash(`${item.contentHash}\0${item.aclHash}`);
    item.vectorNamespace = knowledgeIndexVectorNamespace(item);
    return item;
}

function validateKnowledgeIndexItem(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!source) {
        throw knowledgeIndexError(
            'Knowledge-index item must be an object.',
            'KNOWLEDGE_INDEX_ITEM_INVALID'
        );
    }
    const expected = normalizeKnowledgeIndexItem(source);
    if (source.id !== expected.id
        || source.sourceType !== expected.sourceType
        || source.sourceKey !== expected.sourceKey
        || source.sourceId !== expected.sourceId
        || source.title !== expected.title
        || source.text !== expected.text
        || Number(source.timestamp) !== expected.timestamp
        || Number(source.updatedAt) !== expected.updatedAt
        || stableJson(source.acl) !== stableJson(expected.acl)
        || source.contentHash !== expected.contentHash
        || source.aclHash !== expected.aclHash
        || source.recordHash !== expected.recordHash
        || source.vectorNamespace !== expected.vectorNamespace) {
        throw knowledgeIndexError(
            'Knowledge-index item integrity check failed.',
            'KNOWLEDGE_INDEX_ITEM_INTEGRITY'
        );
    }
    return expected;
}

function normalizeAuthorizedKnowledgeIndexItems(values, {
    actorUid,
    authorizedRoomIds,
    onUnauthorized = 'reject',
    maxItems = KNOWLEDGE_INDEX_LIMITS.maxSnapshotItems,
    maxTotalChars = KNOWLEDGE_INDEX_LIMITS.maxSnapshotChars,
    ...itemOptions
} = {}) {
    const input = Array.isArray(values) ? values : [];
    const itemLimit = boundedInteger(
        maxItems,
        KNOWLEDGE_INDEX_LIMITS.maxSnapshotItems,
        1,
        KNOWLEDGE_INDEX_LIMITS.maxSnapshotItems
    );
    const charLimit = boundedInteger(
        maxTotalChars,
        KNOWLEDGE_INDEX_LIMITS.maxSnapshotChars,
        1000,
        KNOWLEDGE_INDEX_LIMITS.maxSnapshotChars
    );
    if (input.length > itemLimit) {
        throw knowledgeIndexError(
            'Knowledge-index snapshot exceeds the item hard limit.',
            'KNOWLEDGE_INDEX_ITEM_LIMIT'
        );
    }
    const normalized = [];
    const seen = new Set();
    const seenSources = new Set();
    let totalChars = 0;
    for (const raw of input) {
        const item = normalizeKnowledgeIndexItem(raw, itemOptions);
        if (!canAccessKnowledgeIndexItem(item, { actorUid, authorizedRoomIds })) {
            if (onUnauthorized === 'skip') continue;
            throw knowledgeIndexError(
                'Knowledge-index item is outside the authorized scope.',
                'KNOWLEDGE_INDEX_FORBIDDEN'
            );
        }
        if (seen.has(item.id) || seenSources.has(item.sourceKey)) {
            throw knowledgeIndexError(
                'Knowledge-index source IDs must be unique.',
                'KNOWLEDGE_INDEX_DUPLICATE'
            );
        }
        totalChars += item.title.length + item.text.length;
        if (totalChars > charLimit) {
            throw knowledgeIndexError(
                'Knowledge-index snapshot exceeds the text hard limit.',
                'KNOWLEDGE_INDEX_SNAPSHOT_TEXT_LIMIT'
            );
        }
        seen.add(item.id);
        seenSources.add(item.sourceKey);
        normalized.push(item);
    }
    return normalized;
}

function normalizeManifestEntry(value, id) {
    const source = value && typeof value === 'object' ? value : {};
    if (!/^ki_[a-f0-9]{40}$/.test(String(id || ''))) return null;
    if (!/^[a-f0-9]{64}$/.test(String(source.contentHash || ''))
        || !/^[a-f0-9]{64}$/.test(String(source.aclHash || ''))
        || !/^[a-f0-9]{64}$/.test(String(source.recordHash || ''))
        || !/^kis_[a-f0-9]{40}$/.test(String(source.sourceKey || ''))
        || !/^kiv1_[a-f0-9]{40}$/.test(String(source.vectorNamespace || ''))) {
        return null;
    }
    return {
        id,
        sourceKey: source.sourceKey,
        contentHash: source.contentHash,
        aclHash: source.aclHash,
        recordHash: source.recordHash,
        vectorNamespace: source.vectorNamespace
    };
}

function buildKnowledgeIndexManifest(items) {
    const input = Array.isArray(items) ? items : [];
    if (input.length > KNOWLEDGE_INDEX_LIMITS.maxSnapshotItems) {
        throw knowledgeIndexError(
            'Knowledge-index manifest exceeds the item hard limit.',
            'KNOWLEDGE_INDEX_MANIFEST_LIMIT'
        );
    }
    const manifest = {};
    const sourceKeys = new Set();
    let totalChars = 0;
    for (const rawItem of input) {
        const item = validateKnowledgeIndexItem(rawItem);
        if (manifest[item.id] || sourceKeys.has(item.sourceKey)) {
            throw knowledgeIndexError(
                'Knowledge-index manifest contains a duplicate source.',
                'KNOWLEDGE_INDEX_DUPLICATE'
            );
        }
        totalChars += item.title.length + item.text.length;
        if (totalChars > KNOWLEDGE_INDEX_LIMITS.maxSnapshotChars) {
            throw knowledgeIndexError(
                'Knowledge-index manifest exceeds the text hard limit.',
                'KNOWLEDGE_INDEX_SNAPSHOT_TEXT_LIMIT'
            );
        }
        sourceKeys.add(item.sourceKey);
        manifest[item.id] = {
            sourceKey: item.sourceKey,
            contentHash: item.contentHash,
            aclHash: item.aclHash,
            recordHash: item.recordHash,
            vectorNamespace: item.vectorNamespace
        };
    }
    return manifest;
}

function normalizePreviousManifest(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const entries = Object.entries(source);
    if (entries.length > KNOWLEDGE_INDEX_LIMITS.maxSnapshotItems) {
        throw knowledgeIndexError(
            'Knowledge-index manifest exceeds the item hard limit.',
            'KNOWLEDGE_INDEX_MANIFEST_LIMIT'
        );
    }
    const normalized = {};
    for (const [id, entry] of entries) {
        const clean = normalizeManifestEntry(entry, id);
        if (!clean) {
            throw knowledgeIndexError(
                'Knowledge-index manifest contains an invalid entry.',
                'KNOWLEDGE_INDEX_MANIFEST_INVALID'
            );
        }
        normalized[id] = clean;
    }
    return normalized;
}

function diffKnowledgeIndexSnapshot({
    previousManifest,
    currentItems,
    fullSnapshot = false
} = {}) {
    const previous = normalizePreviousManifest(previousManifest);
    const current = (Array.isArray(currentItems) ? currentItems : [])
        .map(validateKnowledgeIndexItem);
    const currentManifest = buildKnowledgeIndexManifest(current);
    const previousBySourceKey = new Map();
    for (const entry of Object.values(previous)) {
        const existing = previousBySourceKey.get(entry.sourceKey) || [];
        existing.push(entry);
        previousBySourceKey.set(entry.sourceKey, existing);
    }
    const upserts = [];
    const movedDeletes = [];
    for (const item of current) {
        const old = previous[item.id];
        const moved = (previousBySourceKey.get(item.sourceKey) || [])
            .filter((entry) => entry.id !== item.id);
        movedDeletes.push(...moved.map((entry) => ({
            id: entry.id,
            vectorNamespaces: [entry.vectorNamespace],
            reason: 'acl_scope_changed'
        })));
        if (!old || old.recordHash !== item.recordHash) {
            upserts.push({
                ...item,
                retiredVectorNamespaces: old
                    && old.vectorNamespace !== item.vectorNamespace
                    ? [old.vectorNamespace]
                    : []
            });
        }
    }
    const movedIds = new Set(movedDeletes.map(({ id }) => id));
    const deletes = [
        ...movedDeletes,
        ...(fullSnapshot
            ? Object.entries(previous)
                .filter(([id]) => !currentManifest[id])
                .filter(([id]) => !movedIds.has(id))
                .map(([id, entry]) => ({
                    id,
                    vectorNamespaces: [entry.vectorNamespace],
                    reason: 'source_deleted'
                }))
            : [])
    ];
    const manifest = fullSnapshot ? currentManifest : { ...previous, ...currentManifest };
    for (const id of movedIds) delete manifest[id];
    const snapshotHash = hash(stableJson(manifest));
    return {
        upserts,
        deletes,
        manifest,
        snapshotHash,
        fullSnapshot: fullSnapshot === true
    };
}

function normalizeKnowledgeIndexCursor(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const version = Number(source.version);
    const generation = String(source.generation || '');
    const position = Number(source.position);
    const totalMutations = Number(source.totalMutations);
    const snapshotHash = String(source.snapshotHash || '');
    if (version !== KNOWLEDGE_INDEX_VERSION
        || !/^kg_[a-f0-9]{24}$/.test(generation)
        || !Number.isSafeInteger(position)
        || position < 0
        || !Number.isSafeInteger(totalMutations)
        || totalMutations < position
        || !/^[a-f0-9]{64}$/.test(snapshotHash)) {
        throw knowledgeIndexError(
            'Knowledge-index cursor is invalid.',
            'KNOWLEDGE_INDEX_CURSOR_INVALID'
        );
    }
    return { version, generation, position, totalMutations, snapshotHash };
}

function cursorsEqual(left, right) {
    try {
        return stableJson(normalizeKnowledgeIndexCursor(left))
            === stableJson(normalizeKnowledgeIndexCursor(right));
    } catch {
        return false;
    }
}

function mutationChars(upsert) {
    return String(upsert?.title || '').length + String(upsert?.text || '').length;
}

function planKnowledgeIndexMutationBatches(diff, {
    maxUpserts = KNOWLEDGE_INDEX_LIMITS.maxBatchUpserts,
    maxDeletes = KNOWLEDGE_INDEX_LIMITS.maxBatchDeletes,
    maxBatchChars = KNOWLEDGE_INDEX_LIMITS.maxBatchChars
} = {}) {
    const source = diff && typeof diff === 'object' ? diff : {};
    const upserts = Array.isArray(source.upserts) ? [...source.upserts] : [];
    const deletes = Array.isArray(source.deletes) ? [...source.deletes] : [];
    const snapshotHash = String(source.snapshotHash || '');
    if (!/^[a-f0-9]{64}$/.test(snapshotHash)) {
        throw knowledgeIndexError(
            'Knowledge-index snapshot hash is invalid.',
            'KNOWLEDGE_INDEX_SNAPSHOT_HASH_INVALID'
        );
    }
    const upsertLimit = boundedInteger(
        maxUpserts,
        KNOWLEDGE_INDEX_LIMITS.maxBatchUpserts,
        1,
        KNOWLEDGE_INDEX_LIMITS.maxBatchUpserts
    );
    const deleteLimit = boundedInteger(
        maxDeletes,
        KNOWLEDGE_INDEX_LIMITS.maxBatchDeletes,
        1,
        KNOWLEDGE_INDEX_LIMITS.maxBatchDeletes
    );
    const charLimit = boundedInteger(
        maxBatchChars,
        KNOWLEDGE_INDEX_LIMITS.maxBatchChars,
        KNOWLEDGE_INDEX_LIMITS.maxItemChars,
        KNOWLEDGE_INDEX_LIMITS.maxBatchChars
    );
    const generation = `kg_${snapshotHash.slice(0, 24)}`;
    const totalMutations = upserts.length + deletes.length;
    const batches = [];
    let upsertOffset = 0;
    let deleteOffset = 0;
    let position = 0;

    do {
        const batchDeletes = deletes.slice(deleteOffset, deleteOffset + deleteLimit);
        deleteOffset += batchDeletes.length;
        const batchUpserts = [];
        let usedChars = 0;
        while (upsertOffset < upserts.length && batchUpserts.length < upsertLimit) {
            const next = upserts[upsertOffset];
            const nextChars = mutationChars(next);
            if (nextChars > charLimit) {
                throw knowledgeIndexError(
                    'Knowledge-index upsert exceeds the batch text hard limit.',
                    'KNOWLEDGE_INDEX_BATCH_TEXT_LIMIT'
                );
            }
            if (batchUpserts.length && usedChars + nextChars > charLimit) break;
            batchUpserts.push(next);
            usedChars += nextChars;
            upsertOffset += 1;
        }
        const mutationCount = batchDeletes.length + batchUpserts.length;
        const cursor = {
            version: KNOWLEDGE_INDEX_VERSION,
            generation,
            position,
            totalMutations,
            snapshotHash
        };
        position += mutationCount;
        const complete = upsertOffset >= upserts.length && deleteOffset >= deletes.length;
        batches.push({
            cursor,
            nextCursor: {
                version: KNOWLEDGE_INDEX_VERSION,
                generation,
                position,
                totalMutations,
                snapshotHash
            },
            upserts: batchUpserts,
            deletes: batchDeletes,
            complete
        });
        if (batches.length > KNOWLEDGE_INDEX_LIMITS.maxMutationBatches) {
            throw knowledgeIndexError(
                'Knowledge-index mutation plan exceeds the batch hard limit.',
                'KNOWLEDGE_INDEX_BATCH_LIMIT'
            );
        }
    } while (upsertOffset < upserts.length || deleteOffset < deletes.length);
    return batches;
}

function purgeVectorNamespaces(vectorCache, namespaces) {
    const prefixes = (Array.isArray(namespaces) ? namespaces : [])
        .filter((entry) => /^kiv1_[a-f0-9]{40}$/.test(String(entry || '')))
        .map((entry) => `${entry}_`);
    if (!prefixes.length) return;
    for (const key of Object.keys(vectorCache)) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) delete vectorCache[key];
    }
}

function requireExpectedVectorNamespaces(value, expected, code) {
    const supplied = Array.isArray(value) ? value : [];
    if (stableJson(supplied) !== stableJson(expected)) {
        throw knowledgeIndexError(
            'Knowledge-index vector purge scope does not match stored state.',
            code
        );
    }
}

function applyKnowledgeIndexMutationBatch(state, batch) {
    const current = state && typeof state === 'object' ? state : {};
    const cursor = normalizeKnowledgeIndexCursor(batch?.cursor);
    const nextCursor = normalizeKnowledgeIndexCursor(batch?.nextCursor);
    if (!current.cursor && cursor.position !== 0) {
        throw knowledgeIndexError(
            'Knowledge-index mutation batch is stale or out of order.',
            'KNOWLEDGE_INDEX_CURSOR_CONFLICT'
        );
    }
    let currentCursor = null;
    if (current.cursor) currentCursor = normalizeKnowledgeIndexCursor(current.cursor);
    const currentComplete = currentCursor
        && currentCursor.position === currentCursor.totalMutations;
    const startsNextGeneration = currentComplete
        && cursor.position === 0
        && cursor.generation !== currentCursor.generation;
    const confirmsCompletedSnapshot = currentComplete
        && cursor.position === 0
        && cursor.totalMutations === 0
        && cursor.snapshotHash === currentCursor.snapshotHash;
    if (currentCursor
        && !cursorsEqual(currentCursor, cursor)
        && !startsNextGeneration
        && !confirmsCompletedSnapshot) {
        throw knowledgeIndexError(
            'Knowledge-index mutation batch is stale or out of order.',
            'KNOWLEDGE_INDEX_CURSOR_CONFLICT'
        );
    }
    if (cursor.generation !== nextCursor.generation
        || cursor.snapshotHash !== nextCursor.snapshotHash
        || cursor.totalMutations !== nextCursor.totalMutations
        || nextCursor.position < cursor.position) {
        throw knowledgeIndexError(
            'Knowledge-index mutation cursor progression is invalid.',
            'KNOWLEDGE_INDEX_CURSOR_PROGRESSION_INVALID'
        );
    }
    const currentRecords = current.records && typeof current.records === 'object'
        ? current.records
        : {};
    const currentVectorCache = current.vectorCache && typeof current.vectorCache === 'object'
        ? current.vectorCache
        : {};
    if (Object.keys(currentRecords).length > KNOWLEDGE_INDEX_LIMITS.maxSnapshotItems
        || Object.keys(currentVectorCache).length > KNOWLEDGE_INDEX_LIMITS.maxCachedVectors) {
        throw knowledgeIndexError(
            'Knowledge-index state exceeds a hard limit.',
            'KNOWLEDGE_INDEX_STATE_LIMIT'
        );
    }
    const records = { ...currentRecords };
    const vectorCache = { ...currentVectorCache };
    const deletions = Array.isArray(batch?.deletes) ? batch.deletes : [];
    const upserts = Array.isArray(batch?.upserts) ? batch.upserts : [];
    if (deletions.length > KNOWLEDGE_INDEX_LIMITS.maxBatchDeletes
        || upserts.length > KNOWLEDGE_INDEX_LIMITS.maxBatchUpserts
        || upserts.reduce((total, upsert) => total + mutationChars(upsert), 0)
            > KNOWLEDGE_INDEX_LIMITS.maxBatchChars) {
        throw knowledgeIndexError(
            'Knowledge-index mutation batch exceeds a hard limit.',
            'KNOWLEDGE_INDEX_BATCH_LIMIT'
        );
    }
    if (nextCursor.position !== cursor.position + deletions.length + upserts.length) {
        throw knowledgeIndexError(
            'Knowledge-index mutation cursor progression is invalid.',
            'KNOWLEDGE_INDEX_CURSOR_PROGRESSION_INVALID'
        );
    }
    if ((batch?.complete === true) !== (nextCursor.position === nextCursor.totalMutations)) {
        throw knowledgeIndexError(
            'Knowledge-index mutation completion marker is invalid.',
            'KNOWLEDGE_INDEX_CURSOR_PROGRESSION_INVALID'
        );
    }
    for (const deletion of deletions) {
        if (!/^ki_[a-f0-9]{40}$/.test(String(deletion?.id || ''))) {
            throw knowledgeIndexError(
                'Knowledge-index deletion ID is invalid.',
                'KNOWLEDGE_INDEX_DELETE_INVALID'
            );
        }
        const stored = records[deletion.id]
            ? validateKnowledgeIndexItem(records[deletion.id])
            : null;
        if (!stored) {
            throw knowledgeIndexError(
                'Knowledge-index deletion does not match stored state.',
                'KNOWLEDGE_INDEX_DELETE_CONFLICT'
            );
        }
        const vectorNamespaces = [stored.vectorNamespace];
        requireExpectedVectorNamespaces(
            deletion.vectorNamespaces,
            vectorNamespaces,
            'KNOWLEDGE_INDEX_DELETE_CONFLICT'
        );
        delete records[deletion.id];
        purgeVectorNamespaces(vectorCache, vectorNamespaces);
    }
    for (const rawUpsert of upserts) {
        const upsert = validateKnowledgeIndexItem(rawUpsert);
        const stored = records[upsert.id]
            ? validateKnowledgeIndexItem(records[upsert.id])
            : null;
        if (stored && stored.sourceKey !== upsert.sourceKey) {
            throw knowledgeIndexError(
                'Knowledge-index upsert does not match stored state.',
                'KNOWLEDGE_INDEX_UPSERT_CONFLICT'
            );
        }
        const retiredVectorNamespaces = stored
            && stored.vectorNamespace !== upsert.vectorNamespace
            ? [stored.vectorNamespace]
            : [];
        requireExpectedVectorNamespaces(
            rawUpsert.retiredVectorNamespaces,
            retiredVectorNamespaces,
            'KNOWLEDGE_INDEX_UPSERT_CONFLICT'
        );
        purgeVectorNamespaces(vectorCache, retiredVectorNamespaces);
        records[upsert.id] = upsert;
    }
    if (Object.keys(records).length > KNOWLEDGE_INDEX_LIMITS.maxSnapshotItems) {
        throw knowledgeIndexError(
            'Knowledge-index state exceeds a hard limit.',
            'KNOWLEDGE_INDEX_STATE_LIMIT'
        );
    }
    return { records, vectorCache, cursor: nextCursor };
}

function normalizedVector(value) {
    if (!Array.isArray(value)
        || value.length < 1
        || value.length > KNOWLEDGE_INDEX_LIMITS.maxVectorDimensions) return null;
    const vector = value.map(Number);
    if (vector.some((entry) => !Number.isFinite(entry))) return null;
    const magnitude = Math.sqrt(vector.reduce((sum, entry) => sum + (entry * entry), 0));
    if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
    return vector.map((entry) => entry / magnitude);
}

async function rankKnowledgeIndexItems({
    query,
    items,
    actorUid,
    authorizedRoomIds,
    embeddingModel = 'default',
    embedder = null,
    getCachedVector = null,
    setCachedVector = null,
    maxCandidates = KNOWLEDGE_INDEX_LIMITS.maxRetrievalCandidates,
    maxResults = 12,
    ...rankOptions
} = {}) {
    const safeCandidateLimit = boundedInteger(
        maxCandidates,
        KNOWLEDGE_INDEX_LIMITS.maxRetrievalCandidates,
        1,
        KNOWLEDGE_INDEX_LIMITS.maxRetrievalCandidates
    );
    const rawItems = Array.isArray(items) ? items.slice(0, safeCandidateLimit) : [];
    const accessible = normalizeAuthorizedKnowledgeIndexItems(rawItems, {
        actorUid,
        authorizedRoomIds,
        onUnauthorized: 'skip',
        maxItems: safeCandidateLimit,
        maxTotalChars: KNOWLEDGE_INDEX_LIMITS.maxSnapshotChars
    });
    const candidates = accessible.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        roomId: item.acl.scope === 'room' ? item.acl.roomId : '',
        label: item.title,
        text: item.text,
        timestamp: item.timestamp,
        diversityKey: item.acl.scope === 'room'
            ? `${item.sourceType}:${item.acl.roomId}`
            : `${item.sourceType}:personal`
    }));
    const cacheKeys = accessible.map((item) => knowledgeIndexVectorCacheKey(item, embeddingModel));
    let cacheHits = 0;
    let cacheMisses = 0;
    let embeddedItems = 0;
    let assembledVectors = null;

    if (typeof embedder === 'function' && accessible.length) {
        const itemVectors = new Array(accessible.length).fill(null);
        if (typeof getCachedVector === 'function') {
            await Promise.all(accessible.map(async (item, index) => {
                try {
                    const cached = normalizedVector(await getCachedVector({
                        key: cacheKeys[index],
                        item,
                        model: embeddingModel
                    }));
                    if (cached) {
                        itemVectors[index] = cached;
                    }
                } catch {
                    // A cache failure must not prevent lexical fallback.
                }
            }));
        }
        const missing = itemVectors
            .map((vector, index) => (vector ? -1 : index))
            .filter((index) => index >= 0);
        cacheMisses = missing.length;
        try {
            const texts = [
                clip(query, 720),
                ...missing.map((index) => `${accessible[index].title}\n${accessible[index].text}`)
            ];
            const generated = await embedder(texts);
            const normalized = Array.isArray(generated) ? generated.map(normalizedVector) : [];
            if (normalized.length !== texts.length || normalized.some((vector) => !vector)) {
                throw knowledgeIndexError(
                    'Embedding hook returned malformed vectors.',
                    'KNOWLEDGE_INDEX_EMBEDDING_INVALID'
                );
            }
            const dimensions = normalized[0].length;
            if (normalized.some((vector) => vector.length !== dimensions)) {
                throw knowledgeIndexError(
                    'Embedding dimensions do not match cached vectors.',
                    'KNOWLEDGE_INDEX_EMBEDDING_DIMENSIONS'
                );
            }
            const cacheDimensionMisses = itemVectors
                .map((vector, index) => (vector && vector.length !== dimensions ? index : -1))
                .filter((index) => index >= 0);
            let replacementVectors = [];
            if (cacheDimensionMisses.length) {
                const replacements = await embedder(cacheDimensionMisses.map((index) => (
                    `${accessible[index].title}\n${accessible[index].text}`
                )));
                replacementVectors = Array.isArray(replacements)
                    ? replacements.map(normalizedVector)
                    : [];
                if (replacementVectors.length !== cacheDimensionMisses.length
                    || replacementVectors.some((vector) => (
                        !vector || vector.length !== dimensions
                    ))) {
                    throw knowledgeIndexError(
                        'Embedding dimensions do not match cached vectors.',
                        'KNOWLEDGE_INDEX_EMBEDDING_DIMENSIONS'
                    );
                }
            }
            cacheHits = itemVectors.filter((vector) => vector && vector.length === dimensions).length;
            cacheMisses = missing.length + cacheDimensionMisses.length;
            const persistVector = async (index, vector) => {
                itemVectors[index] = vector;
                embeddedItems += 1;
                if (typeof setCachedVector !== 'function') return;
                try {
                    await setCachedVector({
                        key: cacheKeys[index],
                        item: accessible[index],
                        model: embeddingModel,
                        vector
                    });
                } catch {
                    // Cache writes are an optimization and remain non-fatal.
                }
            };
            for (let offset = 0; offset < missing.length; offset += 1) {
                const index = missing[offset];
                await persistVector(index, normalized[offset + 1]);
            }
            for (let offset = 0; offset < cacheDimensionMisses.length; offset += 1) {
                await persistVector(cacheDimensionMisses[offset], replacementVectors[offset]);
            }
            assembledVectors = [normalized[0], ...itemVectors];
        } catch {
            assembledVectors = null;
        }
    }
    const ranked = await rankAiSemanticCandidates({
        query,
        candidates,
        maxCandidates: safeCandidateLimit,
        maxResults: boundedInteger(
            maxResults,
            12,
            1,
            KNOWLEDGE_INDEX_LIMITS.maxRetrievalResults
        ),
        ...rankOptions,
        embedder: assembledVectors ? async () => assembledVectors : null
    });
    const byId = new Map(accessible.map((item) => [item.id, item]));
    return {
        ...ranked,
        results: ranked.results.map((result) => ({
            ...result,
            item: byId.get(result.candidate.id)
        })),
        metrics: {
            ...ranked.metrics,
            authorizedCandidates: accessible.length,
            cacheHits,
            cacheMisses,
            embeddedItems
        }
    };
}

module.exports = {
    KNOWLEDGE_INDEX_LIMITS,
    KNOWLEDGE_INDEX_SOURCE_TYPES,
    KNOWLEDGE_INDEX_VERSION,
    applyKnowledgeIndexMutationBatch,
    buildKnowledgeIndexManifest,
    canAccessKnowledgeIndexItem,
    diffKnowledgeIndexSnapshot,
    knowledgeIndexAclHash,
    knowledgeIndexContentHash,
    knowledgeIndexRecordId,
    knowledgeIndexSourceKey,
    knowledgeIndexVectorCacheKey,
    knowledgeIndexVectorNamespace,
    normalizeAuthorizedKnowledgeIndexItems,
    normalizeKnowledgeIndexAcl,
    normalizeKnowledgeIndexCursor,
    normalizeKnowledgeIndexItem,
    planKnowledgeIndexMutationBatches,
    rankKnowledgeIndexItems,
    validateKnowledgeIndexItem
};
