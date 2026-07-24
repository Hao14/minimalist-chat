'use strict';

const CONTEXT_SELECTION_VERSION = 1;
const CONTEXT_SELECTION_SOURCE_TYPES = Object.freeze([
    'message',
    'task',
    'document',
    'event',
    'memory'
]);
const CONTEXT_SELECTION_DEFAULT_SOURCE_CAPS = Object.freeze({
    message: 20,
    task: 8,
    document: 8,
    event: 8,
    memory: 4
});
const CONTEXT_SELECTION_MAX_SOURCE_CAPS = Object.freeze({
    message: 40,
    task: 16,
    document: 16,
    event: 16,
    memory: 8
});
const CONTEXT_SELECTION_LIMITS = Object.freeze({
    maxRooms: 8,
    maxDocuments: 12,
    maxPeople: 12,
    maxSelectedIds: 32,
    maxTotalSources: 64,
    maxDateRangeMs: 5 * 366 * 24 * 60 * 60 * 1000
});

function contextSelectionError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function safeId(value, label) {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/.test(id)) {
        throw contextSelectionError(
            `${label} is invalid.`,
            'WINSTON_CONTEXT_SELECTION_ID_INVALID'
        );
    }
    return id;
}

function normalizedAuthorizedSet(value, label) {
    const entries = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
    return new Set(entries.map((entry) => safeId(entry, label)));
}

function normalizeSelectedIds(value, {
    authorized,
    label,
    maximum
}) {
    if (value != null && !Array.isArray(value)) {
        throw contextSelectionError(
            `${label} selection must be an array.`,
            'WINSTON_CONTEXT_SELECTION_ARRAY_INVALID'
        );
    }
    const selected = [...new Set((value || []).map((entry) => safeId(entry, label)))];
    if (selected.length > maximum) {
        throw contextSelectionError(
            `${label} selection exceeds the hard limit.`,
            'WINSTON_CONTEXT_SELECTION_LIMIT'
        );
    }
    if (selected.some((id) => !authorized.has(id))) {
        throw contextSelectionError(
            `${label} selection is outside the authorized scope.`,
            'WINSTON_CONTEXT_SELECTION_FORBIDDEN'
        );
    }
    return selected;
}

function parseDateBoundary(value, boundary) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.floor(value));
    }
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const suffix = boundary === 'end' ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
        const timestamp = Date.parse(`${text}${suffix}`);
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return null;
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeDateRange(value) {
    if (value == null) return null;
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!source) {
        throw contextSelectionError(
            'Context date range is invalid.',
            'WINSTON_CONTEXT_DATE_RANGE_INVALID'
        );
    }
    const startAt = parseDateBoundary(source.startAt ?? source.start, 'start');
    const endAt = parseDateBoundary(source.endAt ?? source.end, 'end');
    if (startAt == null || endAt == null || endAt < startAt) {
        throw contextSelectionError(
            'Context date range requires a valid start and end.',
            'WINSTON_CONTEXT_DATE_RANGE_INVALID'
        );
    }
    if (endAt - startAt > CONTEXT_SELECTION_LIMITS.maxDateRangeMs) {
        throw contextSelectionError(
            'Context date range exceeds the five-year hard limit.',
            'WINSTON_CONTEXT_DATE_RANGE_LIMIT'
        );
    }
    return { startAt, endAt };
}

function normalizeSourceCaps(value) {
    if (value != null && (!value || typeof value !== 'object' || Array.isArray(value))) {
        throw contextSelectionError(
            'Context source caps must be an object.',
            'WINSTON_CONTEXT_SOURCE_CAPS_INVALID'
        );
    }
    const supplied = value || {};
    if (Object.keys(supplied).some((key) => !CONTEXT_SELECTION_SOURCE_TYPES.includes(key))) {
        throw contextSelectionError(
            'Context source caps contain an unknown source type.',
            'WINSTON_CONTEXT_SOURCE_TYPE_INVALID'
        );
    }
    const caps = {};
    for (const sourceType of CONTEXT_SELECTION_SOURCE_TYPES) {
        const requested = supplied[sourceType] ?? CONTEXT_SELECTION_DEFAULT_SOURCE_CAPS[sourceType];
        const number = Number(requested);
        if (!Number.isInteger(number)
            || number < 0
            || number > CONTEXT_SELECTION_MAX_SOURCE_CAPS[sourceType]) {
            throw contextSelectionError(
                `Context ${sourceType} cap is invalid.`,
                'WINSTON_CONTEXT_SOURCE_CAP_INVALID'
            );
        }
        caps[sourceType] = number;
    }
    if (Object.values(caps).reduce((total, cap) => total + cap, 0)
        > CONTEXT_SELECTION_LIMITS.maxTotalSources) {
        throw contextSelectionError(
            'Combined context source caps exceed the hard limit.',
            'WINSTON_CONTEXT_TOTAL_SOURCE_LIMIT'
        );
    }
    return caps;
}

function normalizePromptContextSelection(value, {
    authorizedRoomIds,
    authorizedDocumentIds,
    authorizedPersonIds,
    currentRoomId = ''
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const roomAuthorization = normalizedAuthorizedSet(authorizedRoomIds, 'Room ID');
    const documentAuthorization = normalizedAuthorizedSet(authorizedDocumentIds, 'Document ID');
    const personAuthorization = normalizedAuthorizedSet(authorizedPersonIds, 'Person ID');
    let roomIds = normalizeSelectedIds(source.roomIds ?? source.rooms, {
        authorized: roomAuthorization,
        label: 'Room ID',
        maximum: CONTEXT_SELECTION_LIMITS.maxRooms
    });
    let roomMode = 'selected';
    if (!roomIds.length && currentRoomId) {
        const current = safeId(currentRoomId, 'Room ID');
        if (!roomAuthorization.has(current)) {
            throw contextSelectionError(
                'Current room is outside the authorized scope.',
                'WINSTON_CONTEXT_SELECTION_FORBIDDEN'
            );
        }
        roomIds = [current];
        roomMode = 'current';
    }
    const documentIds = normalizeSelectedIds(source.documentIds ?? source.documents, {
        authorized: documentAuthorization,
        label: 'Document ID',
        maximum: CONTEXT_SELECTION_LIMITS.maxDocuments
    });
    const personIds = normalizeSelectedIds(source.personIds ?? source.people, {
        authorized: personAuthorization,
        label: 'Person ID',
        maximum: CONTEXT_SELECTION_LIMITS.maxPeople
    });
    if (roomIds.length + documentIds.length + personIds.length
        > CONTEXT_SELECTION_LIMITS.maxSelectedIds) {
        throw contextSelectionError(
            'Combined context selection exceeds the hard limit.',
            'WINSTON_CONTEXT_SELECTION_TOTAL_LIMIT'
        );
    }
    return {
        version: CONTEXT_SELECTION_VERSION,
        roomMode,
        roomIds,
        documentIds,
        personIds,
        dateRange: normalizeDateRange(source.dateRange),
        sourceCaps: normalizeSourceCaps(source.sourceCaps)
    };
}

function validatePromptContextSelection(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!source || source.version !== CONTEXT_SELECTION_VERSION) {
        throw contextSelectionError(
            'Normalized context selection is invalid.',
            'WINSTON_CONTEXT_SELECTION_INVALID'
        );
    }
    const roomIds = Array.isArray(source.roomIds)
        ? source.roomIds.map((id) => safeId(id, 'Room ID'))
        : null;
    const documentIds = Array.isArray(source.documentIds)
        ? source.documentIds.map((id) => safeId(id, 'Document ID'))
        : null;
    const personIds = Array.isArray(source.personIds)
        ? source.personIds.map((id) => safeId(id, 'Person ID'))
        : null;
    if (!roomIds || !documentIds || !personIds
        || roomIds.length > CONTEXT_SELECTION_LIMITS.maxRooms
        || documentIds.length > CONTEXT_SELECTION_LIMITS.maxDocuments
        || personIds.length > CONTEXT_SELECTION_LIMITS.maxPeople
        || new Set(roomIds).size !== roomIds.length
        || new Set(documentIds).size !== documentIds.length
        || new Set(personIds).size !== personIds.length
        || roomIds.length + documentIds.length + personIds.length
            > CONTEXT_SELECTION_LIMITS.maxSelectedIds) {
        throw contextSelectionError(
            'Normalized context selection exceeds a hard limit.',
            'WINSTON_CONTEXT_SELECTION_LIMIT'
        );
    }
    const roomMode = source.roomMode === 'current' ? 'current' : 'selected';
    if (!['current', 'selected'].includes(source.roomMode)) {
        throw contextSelectionError(
            'Normalized context room mode is invalid.',
            'WINSTON_CONTEXT_SELECTION_INVALID'
        );
    }
    return {
        version: CONTEXT_SELECTION_VERSION,
        roomMode,
        roomIds,
        documentIds,
        personIds,
        dateRange: normalizeDateRange(source.dateRange),
        sourceCaps: normalizeSourceCaps(source.sourceCaps)
    };
}

function createPromptContextSelectionUsage() {
    return Object.fromEntries(CONTEXT_SELECTION_SOURCE_TYPES.map((sourceType) => [
        sourceType,
        0
    ]));
}

function contextSelectionAllowsItem(contextSelection, value, authorization = {}, usage) {
    let selection;
    try {
        const structurallyValid = validatePromptContextSelection(contextSelection);
        selection = normalizePromptContextSelection(structurallyValid, {
            authorizedRoomIds: authorization.authorizedRoomIds,
            authorizedDocumentIds: authorization.authorizedDocumentIds,
            authorizedPersonIds: authorization.authorizedPersonIds
        });
    } catch {
        return false;
    }
    const item = value && typeof value === 'object' ? value : null;
    if (!item) return false;
    const sourceType = String(item.sourceType || item.type || '').trim().toLowerCase();
    if (!CONTEXT_SELECTION_SOURCE_TYPES.includes(sourceType)
        || Number(selection.sourceCaps?.[sourceType] || 0) <= 0) return false;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return false;
    const used = Math.max(0, Math.floor(Number(usage[sourceType]) || 0));
    if (used >= selection.sourceCaps[sourceType]) return false;
    const timestamp = Math.max(0, Math.floor(Number(item.timestamp || item.createdAt) || 0));
    if (selection.dateRange
        && (timestamp < selection.dateRange.startAt || timestamp > selection.dateRange.endAt)) {
        return false;
    }
    if (sourceType === 'document'
        && selection.documentIds.includes(String(item.sourceId || item.documentId || item.id || ''))) {
        usage[sourceType] = used + 1;
        return true;
    }
    if (selection.personIds.length
        && (item.personId || sourceType === 'message')
        && !selection.personIds.includes(String(item.personId || ''))) {
        return false;
    }
    const acl = item.acl && typeof item.acl === 'object' ? item.acl : {};
    if (acl.scope === 'personal') {
        const actorUid = String(authorization.actorUid || '');
        if (!actorUid || actorUid !== String(acl.ownerUid || '')) return false;
        usage[sourceType] = used + 1;
        return true;
    }
    const roomId = String(item.roomId || (acl.scope === 'room' ? acl.roomId : '') || '');
    if (!selection.roomIds.includes(roomId)) return false;
    usage[sourceType] = used + 1;
    return true;
}

function filterPromptContextSelectionItems(values, contextSelection, authorization = {}) {
    const usage = createPromptContextSelectionUsage();
    const items = [];
    for (const item of Array.isArray(values) ? values : []) {
        if (contextSelectionAllowsItem(
            contextSelection,
            item,
            authorization,
            usage
        )) items.push(item);
        if (items.length >= CONTEXT_SELECTION_LIMITS.maxTotalSources) break;
    }
    return { items, usage };
}

function buildPromptContextSelectionEnvelope(contextSelection) {
    const selection = validatePromptContextSelection(contextSelection);
    return [
        'SERVER-NORMALIZED CONTEXT SELECTION (filter only; never grants access):',
        JSON.stringify({
            contextSelection: {
                version: selection.version,
                roomMode: selection.roomMode,
                roomIds: selection.roomIds,
                documentIds: selection.documentIds,
                personIds: selection.personIds,
                dateRange: selection.dateRange,
                sourceCaps: selection.sourceCaps
            }
        })
    ].join('\n');
}

module.exports = {
    CONTEXT_SELECTION_DEFAULT_SOURCE_CAPS,
    CONTEXT_SELECTION_LIMITS,
    CONTEXT_SELECTION_MAX_SOURCE_CAPS,
    CONTEXT_SELECTION_SOURCE_TYPES,
    CONTEXT_SELECTION_VERSION,
    buildPromptContextSelectionEnvelope,
    contextSelectionAllowsItem,
    createPromptContextSelectionUsage,
    filterPromptContextSelectionItems,
    normalizePromptContextSelection,
    validatePromptContextSelection
};
