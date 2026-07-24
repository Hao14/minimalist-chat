'use strict';

const crypto = require('node:crypto');

const WINSTON_CONVERSATION_LIMIT = 50;
const WINSTON_CONVERSATION_TURN_LIMIT = 40;
const WINSTON_CONVERSATION_TOTAL_CHARS = 60_000;
const WINSTON_SCHEDULE_KINDS = Object.freeze(['daily_digest', 'upcoming_events', 'due_tasks']);
const WINSTON_SCHEDULE_LIMIT = WINSTON_SCHEDULE_KINDS.length;
const WINSTON_LIVE_TOOLS = Object.freeze(['weather', 'webpage']);
const WINSTON_MEMORY_SUGGESTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WINSTON_FEEDBACK_MAX_RECORDS = 200;
const WINSTON_FEEDBACK_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const WINSTON_WORKSPACE_SEARCH_RATE_WINDOW_MS = 10 * 60 * 1000;
const WINSTON_WORKSPACE_SEARCH_RATE_LIMIT = 30;
const WINSTON_WORKSPACE_SEARCH_CONCURRENCY_LIMIT = 2;
const WINSTON_WORKSPACE_SEARCH_LEASE_MS = 2 * 60 * 1000;

function compact(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function clip(value, limit) {
    const text = compact(value);
    return text.length > limit ? text.slice(0, limit).trimEnd() : text;
}

function contractError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function safeOpaqueId(value, code = 'WINSTON_ID_INVALID') {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(id)) {
        throw contractError('A valid Winston record ID is required.', code);
    }
    return id;
}

function sanitizeRoomId(value, { allowGlobal = true } = {}) {
    const roomId = String(value || '').trim();
    if (allowGlobal && roomId === 'global') return roomId;
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(roomId)) {
        throw contractError('A valid room ID is required.', 'WINSTON_ROOM_ID_INVALID');
    }
    return roomId;
}

function sanitizeWinstonConversationRevision(value) {
    const revision = Number(value ?? 0);
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw contractError('Winston conversation revision is invalid.', 'WINSTON_CONVERSATION_REVISION_INVALID');
    }
    return revision;
}

function sanitizeWinstonConversationTurn(value, index = 0) {
    const source = value && typeof value === 'object' ? value : {};
    const content = String(source.content || '').trim().slice(0, 4_000);
    if (!content) return null;
    const role = source.role === 'assistant' ? 'assistant' : 'user';
    const createdAt = Math.max(0, Math.floor(Number(source.createdAt) || 0));
    const suppliedId = String(source.id || '').trim();
    const id = /^[A-Za-z0-9_-]{8,160}$/.test(suppliedId)
        ? suppliedId
        : `turn_${crypto.createHash('sha256')
            .update(role).update('\0')
            .update(String(createdAt)).update('\0')
            .update(String(Math.max(0, Number(index) || 0))).update('\0')
            .update(content)
            .digest('hex')
            .slice(0, 32)}`;
    return {
        id,
        role,
        content,
        createdAt
    };
}

function summarizeWinstonConversation(turns) {
    const safeTurns = (Array.isArray(turns) ? turns : [])
        .map(sanitizeWinstonConversationTurn)
        .filter(Boolean);
    const firstUser = safeTurns.find((turn) => turn.role === 'user');
    const latest = safeTurns.slice(-2);
    const title = clip(firstUser?.content || 'New Winston conversation', 72) || 'New Winston conversation';
    const summary = clip(latest.map((turn) => (
        `${turn.role === 'assistant' ? 'Winston' : 'You'}: ${clip(turn.content, 180)}`
    )).join(' · '), 420);
    return { title, summary };
}

function sanitizeWinstonConversation(value, { now = Date.now() } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    let turns = (Array.isArray(source.turns) ? source.turns : Array.isArray(source.messages) ? source.messages : [])
        .slice(-WINSTON_CONVERSATION_TURN_LIMIT)
        .map(sanitizeWinstonConversationTurn)
        .filter(Boolean);
    let totalChars = turns.reduce((sum, turn) => sum + turn.content.length, 0);
    while (turns.length > 1 && totalChars > WINSTON_CONVERSATION_TOTAL_CHARS) {
        totalChars -= turns[0].content.length;
        turns = turns.slice(1);
    }
    const turnIds = new Set();
    for (const turn of turns) {
        if (turnIds.has(turn.id)) {
            throw contractError('Winston conversation turn IDs must be unique.', 'WINSTON_CONVERSATION_TURN_ID_DUPLICATE');
        }
        turnIds.add(turn.id);
    }
    if (!turns.length) {
        throw contractError('A conversation needs at least one turn.', 'WINSTON_CONVERSATION_EMPTY');
    }
    const derived = summarizeWinstonConversation(turns);
    return {
        title: clip(source.title, 100) || derived.title,
        summary: derived.summary,
        roomId: sanitizeRoomId(source.roomId || 'global'),
        turns,
        baseRevision: sanitizeWinstonConversationRevision(source.baseRevision ?? source.revision ?? 0),
        updatedAt: now
    };
}

function winstonConversationSnapshotHash(value) {
    const source = value && typeof value === 'object' ? value : {};
    const turns = (Array.isArray(source.turns) ? source.turns : Array.isArray(source.messages) ? source.messages : [])
        .slice(-WINSTON_CONVERSATION_TURN_LIMIT)
        .map(sanitizeWinstonConversationTurn)
        .filter(Boolean);
    return crypto.createHash('sha256').update(JSON.stringify({
        title: clip(source.title, 100),
        roomId: sanitizeRoomId(source.roomId || 'global'),
        turns
    })).digest('hex');
}

function resolveWinstonConversationWrite(current, input, { baseRevision = 0, now = Date.now() } = {}) {
    const existing = current && typeof current === 'object' && !Array.isArray(current) ? current : null;
    const revision = sanitizeWinstonConversationRevision(baseRevision);
    const currentRevision = Math.max(0, Math.floor(Number(existing?.revision) || 0));
    if (existing && winstonConversationSnapshotHash(existing) === winstonConversationSnapshotHash(input)) {
        return { outcome: 'idempotent', currentRevision, value: existing };
    }
    if ((existing && revision !== currentRevision) || (!existing && revision !== 0)) {
        return { outcome: 'conflict', currentRevision, value: existing };
    }
    if (currentRevision >= Number.MAX_SAFE_INTEGER) {
        return { outcome: 'conflict', currentRevision, value: existing };
    }
    return {
        outcome: 'write',
        currentRevision,
        value: {
            ...input,
            updatedAt: Math.max(0, Math.floor(Number(input?.updatedAt) || now)),
            turnCount: Array.isArray(input?.turns) ? input.turns.length : 0,
            createdAt: Number(existing?.createdAt || now),
            revision: currentRevision + 1
        }
    };
}

function publicWinstonConversation(value, id, { includeTurns = false } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {
        id: safeOpaqueId(id, 'WINSTON_CONVERSATION_ID_INVALID'),
        title: clip(source.title, 100) || 'Winston conversation',
        summary: clip(source.summary, 420),
        roomId: sanitizeRoomId(source.roomId || 'global'),
        turnCount: Math.max(0, Math.min(WINSTON_CONVERSATION_TURN_LIMIT, Number(
            source.turnCount ?? (Array.isArray(source.turns) ? source.turns.length : 0)
        ) || 0)),
        createdAt: Math.max(0, Math.floor(Number(source.createdAt) || 0)),
        updatedAt: Math.max(0, Math.floor(Number(source.updatedAt) || 0)),
        revision: Math.max(0, Math.min(
            Number.MAX_SAFE_INTEGER,
            Math.floor(Number(source.revision) || 0)
        ))
    };
    if (includeTurns) {
        result.turns = (Array.isArray(source.turns) ? source.turns : [])
            .slice(-WINSTON_CONVERSATION_TURN_LIMIT)
            .map(sanitizeWinstonConversationTurn)
            .filter(Boolean);
        result.messages = result.turns;
    }
    return result;
}

function resolveWinstonModelProfile(value, messages = []) {
    const requested = String(value || 'fast').trim().toLowerCase();
    if (requested === 'fast' || requested === 'smart') {
        return { requestedProfile: requested, modelProfile: requested, automatic: false, reason: 'user_selected' };
    }
    if (requested !== 'auto') {
        throw contractError('AI model profile must be "auto", "fast", or "smart".', 'INVALID_AI_MODEL_PROFILE');
    }
    const text = (Array.isArray(messages) ? messages : [])
        .slice(-4)
        .map((message) => compact(message?.content))
        .join('\n')
        .slice(-12_000);
    const complexIntent = /\b(?:analy[sz]e|compare|investigate|strategy|strategic|plan|reason|trade-?offs?|deep|comprehensive|summari[sz]e|briefing|prioriti[sz]e|synthesize|architecture|debug|diagnose)\b/i.test(text);
    const structuredIntent = /(?:^|\n)\s*(?:\d+[.)]|[-*]\s)/m.test(text) || (text.match(/[?]/g) || []).length >= 2;
    const longRequest = text.length >= 900;
    const modelProfile = complexIntent || structuredIntent || longRequest ? 'smart' : 'fast';
    return {
        requestedProfile: 'auto',
        modelProfile,
        automatic: true,
        reason: complexIntent ? 'complex_intent' : structuredIntent ? 'multi_part' : longRequest ? 'long_request' : 'short_request'
    };
}

function validTimeZone(value) {
    const candidate = clip(value || 'UTC', 80) || 'UTC';
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
        return candidate;
    } catch {
        throw contractError('Choose a valid IANA time zone.', 'WINSTON_SCHEDULE_TIME_ZONE_INVALID');
    }
}

function sanitizeScheduleDays(value) {
    const raw = Array.isArray(value) ? value : [0, 1, 2, 3, 4, 5, 6];
    const days = [...new Set(raw.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
        .sort((left, right) => left - right);
    if (!days.length) throw contractError('Select at least one schedule day.', 'WINSTON_SCHEDULE_DAYS_REQUIRED');
    return days;
}

function sanitizeScheduleRoomIds(value) {
    if (!Array.isArray(value)) {
        throw contractError('selectedRoomIds must be an array.', 'WINSTON_SCHEDULE_ROOMS_INVALID');
    }
    const roomIds = [...new Set(value.map((roomId) => sanitizeRoomId(roomId)))];
    if (!roomIds.length || roomIds.length > 8) {
        throw contractError('A proactive schedule needs 1 to 8 rooms.', 'WINSTON_SCHEDULE_ROOM_LIMIT');
    }
    return roomIds;
}

function zonedParts(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        weekday: 'short'
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        second: Number(values.second),
        weekday: weekdays[values.weekday]
    };
}

function zonedLocalToEpoch({ year, month, day, hour, minute }, timeZone) {
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    let guess = targetUtc;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const actual = zonedParts(guess, timeZone);
        const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
        const delta = targetUtc - actualUtc;
        if (!delta) break;
        guess += delta;
    }
    return guess;
}

function nextWinstonScheduleRun(schedule, now = Date.now()) {
    const source = schedule && typeof schedule === 'object' ? schedule : {};
    if (source.enabled !== true) return 0;
    const timeZone = validTimeZone(source.timeZone || 'UTC');
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(source.localTime || '08:00'));
    if (!time) throw contractError('Schedule time must use HH:mm.', 'WINSTON_SCHEDULE_TIME_INVALID');
    const days = sanitizeScheduleDays(source.days);
    const localNow = zonedParts(now, timeZone);
    const baseDate = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
    for (let offset = 0; offset <= 8; offset += 1) {
        const candidateDate = new Date(baseDate.getTime() + (offset * 24 * 60 * 60 * 1000));
        if (!days.includes(candidateDate.getUTCDay())) continue;
        const candidate = zonedLocalToEpoch({
            year: candidateDate.getUTCFullYear(),
            month: candidateDate.getUTCMonth() + 1,
            day: candidateDate.getUTCDate(),
            hour: Number(time[1]),
            minute: Number(time[2])
        }, timeZone);
        if (candidate > now + 30_000) return candidate;
    }
    throw contractError('Winston could not calculate the next schedule run.', 'WINSTON_SCHEDULE_NEXT_RUN_INVALID');
}

function sanitizeWinstonSchedule(value, { now = Date.now() } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const requestedKind = String(source.kind || source.type || 'daily_digest').trim().toLowerCase();
    const kind = requestedKind === 'daily-briefing' || requestedKind === 'daily_briefing'
        ? 'daily_digest'
        : requestedKind;
    if (!WINSTON_SCHEDULE_KINDS.includes(kind)) {
        throw contractError('Unknown Winston schedule type.', 'WINSTON_SCHEDULE_KIND_INVALID');
    }
    const localTime = String(source.localTime || source.time || '08:00').trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(localTime)) {
        throw contractError('Schedule time must use HH:mm.', 'WINSTON_SCHEDULE_TIME_INVALID');
    }
    const schedule = {
        kind,
        enabled: source.enabled === true,
        localTime,
        timeZone: validTimeZone(source.timeZone || source.timezone || 'UTC'),
        days: sanitizeScheduleDays(source.days),
        selectedRoomIds: sanitizeScheduleRoomIds(source.selectedRoomIds ?? source.roomIds),
        lookAheadHours: Math.max(1, Math.min(168, Math.floor(Number(source.lookAheadHours) || 24))),
        updatedAt: now
    };
    return { ...schedule, nextRunAt: nextWinstonScheduleRun(schedule, now) };
}

function canonicalWinstonScheduleId(kind) {
    if (!WINSTON_SCHEDULE_KINDS.includes(kind)) {
        throw contractError('Unknown Winston schedule type.', 'WINSTON_SCHEDULE_KIND_INVALID');
    }
    return `winston_${kind}`;
}

function canonicalizeWinstonScheduleRecords(value, { now = Date.now() } = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const records = {};
    const aliases = {};
    const removedIds = [];
    for (const kind of WINSTON_SCHEDULE_KINDS) {
        const canonicalId = canonicalWinstonScheduleId(kind);
        const entries = Object.entries(source).filter(([id, schedule]) => (
            /^[A-Za-z0-9_-]{8,160}$/.test(id)
            && schedule
            && typeof schedule === 'object'
            && schedule.kind === kind
        ));
        if (!entries.length) continue;
        entries.sort((left, right) => {
            const updatedDelta = Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0);
            if (updatedDelta) return updatedDelta;
            const revisionDelta = Number(right[1].revision || 0) - Number(left[1].revision || 0);
            if (revisionDelta) return revisionDelta;
            if (left[0] === canonicalId) return -1;
            if (right[0] === canonicalId) return 1;
            return left[0].localeCompare(right[0]);
        });
        const [winnerId, winner] = entries[0];
        const migrated = entries.length > 1 || winnerId !== canonicalId;
        const maxRevision = Math.min(
            Number.MAX_SAFE_INTEGER - 1,
            Math.max(0, ...entries
                .map(([, schedule]) => Number(schedule.revision || 0))
                .filter(Number.isFinite))
        );
        records[canonicalId] = migrated
            ? {
                ...winner,
                updatedAt: now,
                revision: maxRevision + 1
            }
            : { ...winner };
        for (const [id] of entries) {
            if (id === canonicalId) continue;
            aliases[id] = canonicalId;
            removedIds.push(id);
        }
    }
    for (const [id, schedule] of Object.entries(source)) {
        if (
            !/^[A-Za-z0-9_-]{8,160}$/.test(id)
            || !schedule
            || typeof schedule !== 'object'
            || !WINSTON_SCHEDULE_KINDS.includes(schedule.kind)
        ) {
            removedIds.push(id);
        }
    }
    return {
        records,
        aliases,
        removedIds: [...new Set(removedIds)]
    };
}

function publicWinstonSchedule(value, id) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        id: safeOpaqueId(id, 'WINSTON_SCHEDULE_ID_INVALID'),
        kind: WINSTON_SCHEDULE_KINDS.includes(source.kind) ? source.kind : 'daily_digest',
        enabled: source.enabled === true,
        localTime: /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(source.localTime || '')) ? source.localTime : '08:00',
        timeZone: validTimeZone(source.timeZone || 'UTC'),
        days: sanitizeScheduleDays(source.days),
        selectedRoomIds: sanitizeScheduleRoomIds(source.selectedRoomIds),
        lookAheadHours: Math.max(1, Math.min(168, Math.floor(Number(source.lookAheadHours) || 24))),
        createdAt: Math.max(0, Math.floor(Number(source.createdAt) || 0)),
        updatedAt: Math.max(0, Math.floor(Number(source.updatedAt) || 0)),
        nextRunAt: Math.max(0, Math.floor(Number(source.nextRunAt) || 0)),
        lastRunAt: Math.max(0, Math.floor(Number(source.lastRunAt) || 0))
    };
}

function sanitizeWinstonFeedback(value) {
    const source = value && typeof value === 'object' ? value : {};
    const rating = String(source.rating || (source.helpful === true ? 'helpful' : source.helpful === false ? 'not_helpful' : '')).trim().toLowerCase();
    if (!['helpful', 'not_helpful'].includes(rating)) {
        throw contractError('Feedback rating must be helpful or not_helpful.', 'WINSTON_FEEDBACK_RATING_INVALID');
    }
    const requestedCategory = String(source.category || source.reason || 'general').trim().toLowerCase();
    const allowedCategories = ['general', 'accuracy', 'relevance', 'formatting', 'speed', 'tool_result', 'citation'];
    const category = allowedCategories.includes(requestedCategory) ? requestedCategory : 'general';
    const requestId = String(source.requestId || source.messageId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(requestId)) {
        throw contractError('A valid requestId is required for feedback.', 'WINSTON_FEEDBACK_REQUEST_INVALID');
    }
    return {
        rating,
        category,
        requestHash: crypto.createHash('sha256').update(requestId).digest('hex'),
        modelProfile: ['fast', 'smart'].includes(source.modelProfile || source.model) ? (source.modelProfile || source.model) : '',
        route: ['local', 'cloudflare', 'groq', 'unknown'].includes(source.route || source.provider)
            ? (source.route || source.provider)
            : 'unknown'
    };
}

function winstonMemoryDedupeKey(value) {
    const normalized = compact(value)
        .toLocaleLowerCase('en-US')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function containsSensitiveMemory(value) {
    return /\b(?:password|passcode|api\s*key|secret\s*key|access\s*token|refresh\s*token|private\s*key|seed\s*phrase|social\s*security|ssn|credit\s*card|cvv)\b/i.test(String(value || ''));
}

function buildWinstonMemorySuggestion({ uid, requestId, messages, roomId = 'global', now = Date.now() } = {}) {
    const latest = [...(Array.isArray(messages) ? messages : [])]
        .reverse()
        .find((message) => message?.role !== 'assistant' && compact(message?.content));
    const content = compact(latest?.content);
    const match = content.match(/\b(?:please\s+)?remember(?:\s+that)?\s+(.{3,900})$/i)
        || content.match(/\bfrom\s+now\s+on[,:\s]+(.{3,900})$/i);
    if (!match) return null;
    const text = clip(match[1].replace(/\b(?:for this room|in this room)\b[.!?]*$/i, ''), 900);
    if (text.length < 3 || containsSensitiveMemory(text)) return null;
    const scope = /\b(?:for this room|in this room)\b/i.test(content) ? 'room' : 'personal';
    const cleanUid = String(uid || '').trim();
    const cleanRequestId = String(requestId || '').trim();
    if (!cleanUid || !cleanRequestId) return null;
    const dedupeKey = winstonMemoryDedupeKey(text);
    const id = crypto.createHash('sha256')
        .update(cleanUid).update('\0').update(cleanRequestId).update('\0').update(dedupeKey)
        .digest('hex');
    return {
        id,
        text,
        scope,
        ...(scope === 'room' ? { roomId: sanitizeRoomId(roomId) } : {}),
        provenance: 'Suggested from your Winston conversation; not saved until approved',
        dedupeKey,
        status: 'pending',
        createdAt: now,
        expiresAt: now + WINSTON_MEMORY_SUGGESTION_TTL_MS
    };
}

function isWinstonMemorySuggestionApprovalClaimable(value, { uid, now = Date.now() } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    if (!uid || source.ownerUid !== uid || Number(source.expiresAt || 0) <= now) return false;
    if (source.status === 'pending') return true;
    return source.status === 'approving' && Number(source.approvalLeaseExpiresAt || 0) <= now;
}

function publicWinstonMemorySuggestion(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        id: /^[a-f0-9]{64}$/.test(String(source.id || '')) ? source.id : '',
        text: clip(source.text, 900),
        scope: source.scope === 'room' ? 'room' : 'personal',
        ...(source.scope === 'room' ? { roomId: sanitizeRoomId(source.roomId || 'global') } : {}),
        provenance: clip(source.provenance, 180),
        status: ['pending', 'approved', 'dismissed', 'expired', 'duplicate'].includes(source.status)
            ? source.status
            : 'pending',
        createdAt: Math.max(0, Math.floor(Number(source.createdAt) || 0)),
        expiresAt: Math.max(0, Math.floor(Number(source.expiresAt) || 0))
    };
}

function sanitizeWinstonWorkspaceQuery(value) {
    const query = clip(value, 500);
    if (query.length < 2) {
        throw contractError('Enter at least two characters to search the workspace.', 'WINSTON_SEARCH_QUERY_REQUIRED');
    }
    return query;
}

function reserveWinstonWorkspaceSearchAdmission(value, {
    token,
    now = Date.now(),
    windowMs = WINSTON_WORKSPACE_SEARCH_RATE_WINDOW_MS,
    rateLimit = WINSTON_WORKSPACE_SEARCH_RATE_LIMIT,
    concurrencyLimit = WINSTON_WORKSPACE_SEARCH_CONCURRENCY_LIMIT,
    leaseMs = WINSTON_WORKSPACE_SEARCH_LEASE_MS
} = {}) {
    const cleanToken = String(token || '').trim();
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(cleanToken)) {
        throw contractError('A valid workspace-search admission token is required.', 'WINSTON_SEARCH_ADMISSION_TOKEN_INVALID');
    }
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sourceStartedAt = Number(source.windowStartedAt || 0);
    const inWindow = Number.isFinite(sourceStartedAt)
        && sourceStartedAt <= now
        && now - sourceStartedAt < windowMs;
    const windowStartedAt = inWindow ? sourceStartedAt : now;
    const count = inWindow
        ? Math.max(0, Math.min(rateLimit, Math.floor(Number(source.count) || 0)))
        : 0;
    const leases = Object.fromEntries(Object.entries(
        source.leases && typeof source.leases === 'object' ? source.leases : {}
    ).filter(([id, expiresAt]) => (
        /^[A-Za-z0-9_-]{8,160}$/.test(id)
        && Number.isFinite(Number(expiresAt))
        && Number(expiresAt) > now
    )));
    const state = { windowStartedAt, count, leases };
    if (leases[cleanToken]) return { admitted: true, reused: true, state };
    if (count >= rateLimit) return { admitted: false, reason: 'rate_limited', state };
    if (Object.keys(leases).length >= concurrencyLimit) {
        return { admitted: false, reason: 'concurrency_limited', state };
    }
    return {
        admitted: true,
        reused: false,
        state: {
            windowStartedAt,
            count: count + 1,
            leases: {
                ...leases,
                [cleanToken]: now + leaseMs
            }
        }
    };
}

function pruneWinstonFeedbackRecords(value, {
    now = Date.now(),
    maxRecords = WINSTON_FEEDBACK_MAX_RECORDS,
    ttlMs = WINSTON_FEEDBACK_TTL_MS
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const cutoff = now - Math.max(1, Number(ttlMs) || WINSTON_FEEDBACK_TTL_MS);
    const limit = Math.max(1, Math.min(WINSTON_FEEDBACK_MAX_RECORDS, Math.floor(Number(maxRecords) || WINSTON_FEEDBACK_MAX_RECORDS)));
    return Object.fromEntries(Object.entries(source)
        .filter(([id, record]) => (
            /^[a-f0-9]{64}$/.test(id)
            && record
            && typeof record === 'object'
            && Number(record.createdAt || 0) > cutoff
            && Number(record.createdAt || 0) <= now
        ))
        .sort((left, right) => (
            Number(right[1].createdAt || 0) - Number(left[1].createdAt || 0)
            || left[0].localeCompare(right[0])
        ))
        .slice(0, limit));
}

function sanitizeWinstonLiveTool(value) {
    const source = value && typeof value === 'object' ? value : {};
    const tool = String(source.tool || '').trim().toLowerCase();
    if (!WINSTON_LIVE_TOOLS.includes(tool)) {
        throw contractError('Unknown Winston live tool.', 'WINSTON_LIVE_TOOL_INVALID');
    }
    if (tool === 'weather') {
        const location = clip(source.location, 100);
        if (location.length < 2) {
            throw contractError('Enter a city or place for weather.', 'WINSTON_WEATHER_LOCATION_REQUIRED');
        }
        return { tool, location };
    }
    const url = String(source.url || '').trim();
    if (!url || url.length > 2048) {
        throw contractError('Enter a valid webpage URL.', 'WINSTON_WEBPAGE_URL_REQUIRED');
    }
    return { tool, url };
}

module.exports = {
    WINSTON_CONVERSATION_LIMIT,
    WINSTON_CONVERSATION_TOTAL_CHARS,
    WINSTON_CONVERSATION_TURN_LIMIT,
    WINSTON_LIVE_TOOLS,
    WINSTON_FEEDBACK_MAX_RECORDS,
    WINSTON_FEEDBACK_TTL_MS,
    WINSTON_WORKSPACE_SEARCH_CONCURRENCY_LIMIT,
    WINSTON_WORKSPACE_SEARCH_LEASE_MS,
    WINSTON_WORKSPACE_SEARCH_RATE_LIMIT,
    WINSTON_WORKSPACE_SEARCH_RATE_WINDOW_MS,
    WINSTON_MEMORY_SUGGESTION_TTL_MS,
    WINSTON_SCHEDULE_KINDS,
    WINSTON_SCHEDULE_LIMIT,
    buildWinstonMemorySuggestion,
    canonicalWinstonScheduleId,
    canonicalizeWinstonScheduleRecords,
    containsSensitiveMemory,
    isWinstonMemorySuggestionApprovalClaimable,
    nextWinstonScheduleRun,
    pruneWinstonFeedbackRecords,
    publicWinstonConversation,
    publicWinstonMemorySuggestion,
    publicWinstonSchedule,
    reserveWinstonWorkspaceSearchAdmission,
    resolveWinstonConversationWrite,
    resolveWinstonModelProfile,
    safeOpaqueId,
    sanitizeRoomId,
    sanitizeWinstonConversation,
    sanitizeWinstonConversationRevision,
    sanitizeWinstonConversationTurn,
    sanitizeWinstonFeedback,
    sanitizeWinstonLiveTool,
    sanitizeWinstonSchedule,
    sanitizeWinstonWorkspaceQuery,
    summarizeWinstonConversation,
    winstonConversationSnapshotHash,
    zonedLocalToEpoch,
    winstonMemoryDedupeKey
};
