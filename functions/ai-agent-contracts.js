'use strict';

const crypto = require('node:crypto');

const AI_ROUTING_POLICIES = Object.freeze(['balanced', 'local-only']);
const AI_MEMORY_SCOPES = Object.freeze(['personal', 'room']);
const AI_IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const AI_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const AI_BRIEFING_MAX_ROOMS = 8;
const AI_MEMORY_MAX_CARDS = 80;
const AI_MEMORY_TEXT_MAX_CHARS = 900;
const AI_ACTION_TTL_MS = 15 * 60 * 1000;
const AI_ACTION_MAX_INVITEES = 8;
const AI_ACTION_TYPES = Object.freeze([
    'create_task',
    'create_room',
    'invite_friends',
    'start_friend_call',
    'create_event',
    'update_event',
    'set_reminder',
    'complete_task'
]);
const AI_CLARIFICATION_MARKER_START = '[[MINIMALIST_CLARIFICATION]]';
const AI_CLARIFICATION_MARKER_END = '[[/MINIMALIST_CLARIFICATION]]';
const AI_CLARIFICATION_MAX_QUESTION_CHARS = 240;
const AI_CLARIFICATION_MAX_OPTION_CHARS = 80;
const AI_CLARIFICATION_MIN_OPTIONS = 2;
const AI_CLARIFICATION_MAX_OPTIONS = 5;
const AI_CLARIFICATION_MAX_MARKER_CHARS = 2048;
const AI_CLARIFICATION_SAFE_FALLBACK = 'I need one more detail before I can answer safely. Please provide it in your own words.';

function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value, limit) {
    const text = compact(value);
    return text.length > limit ? text.slice(0, limit) : text;
}

function contractError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function normalizeAiRoutingPolicy(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'auto' || normalized === 'default') return 'balanced';
    if (AI_ROUTING_POLICIES.includes(normalized)) return normalized;
    throw contractError('routingPolicy must be "balanced" or "local-only".', 'AI_ROUTING_POLICY_INVALID');
}

function aiProviderExclusionsForPolicy(policy) {
    return normalizeAiRoutingPolicy(policy) === 'local-only'
        ? ['cloudflare-workers-ai', 'groq']
        : [];
}

function publicAiRoute(provider) {
    if (provider === 'ollama-bridge') return 'local';
    if (provider === 'cloudflare-workers-ai') return 'cloudflare';
    if (provider === 'groq' || provider === 'groq-fallback') return 'groq';
    return 'unknown';
}

function sanitizeSelectedRoomIds(value) {
    if (!Array.isArray(value)) {
        throw contractError('selectedRoomIds must be an array.', 'AI_BRIEFING_ROOMS_INVALID');
    }
    const selected = [];
    const seen = new Set();
    for (const candidate of value) {
        const roomId = String(candidate || '').trim();
        if (!roomId || seen.has(roomId)) continue;
        if (roomId !== 'global' && !/^[A-Za-z0-9_-]{1,160}$/.test(roomId)) {
            throw contractError('A selected room ID is invalid.', 'AI_BRIEFING_ROOM_INVALID');
        }
        seen.add(roomId);
        selected.push(roomId);
        if (selected.length > AI_BRIEFING_MAX_ROOMS) {
            throw contractError(`A briefing can include at most ${AI_BRIEFING_MAX_ROOMS} rooms.`, 'AI_BRIEFING_ROOM_LIMIT');
        }
    }
    if (!selected.length) {
        throw contractError('Select at least one room for a briefing.', 'AI_BRIEFING_ROOMS_REQUIRED');
    }
    return selected;
}

function sanitizeSourceItemId(value) {
    const raw = String(value || '').trim();
    if (/^[A-Za-z0-9_-]{1,160}$/.test(raw)) return raw;
    if (!raw) return '';
    return `opaque_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
}

function sanitizeAiSource(source, index = 0) {
    const id = /^S\d{1,3}$/.test(String(source?.id || ''))
        ? String(source.id)
        : `S${Math.max(1, Number(index) + 1)}`;
    const type = ['message', 'task', 'document', 'event', 'file', 'audio'].includes(source?.type)
        ? source.type
        : 'message';
    const roomId = source?.roomId === 'global'
        ? 'global'
        : sanitizeSourceItemId(source?.roomId);
    const channelId = source?.channelId === 'general' || !source?.channelId
        ? 'general'
        : sanitizeSourceItemId(source.channelId);
    return {
        id,
        type,
        roomId,
        channelId,
        itemId: sanitizeSourceItemId(source?.itemId),
        label: clip(source?.label || type, 140),
        timestamp: Math.max(0, Math.floor(Number(source?.timestamp) || 0)),
        excerpt: clip(source?.excerpt, 360)
    };
}

function sanitizeAiSources(sources, limit = 32) {
    const safe = [];
    const seen = new Set();
    for (const source of Array.isArray(sources) ? sources : []) {
        const normalized = sanitizeAiSource(source, safe.length);
        if (seen.has(normalized.id) || !normalized.itemId || !normalized.roomId) continue;
        seen.add(normalized.id);
        safe.push(normalized);
        if (safe.length >= Math.max(1, Number(limit) || 32)) break;
    }
    return safe;
}

function validateAiReplyCitations(reply, sources) {
    const safeSources = sanitizeAiSources(sources);
    const allowed = new Map(safeSources.map((source) => [source.id, source]));
    const citedIds = [];
    const seen = new Set();
    const safeReply = String(reply || '')
        .replace(/\[(S\d{1,6})\]\([^\r\n)]*\)/gi, '[$1]')
        .replace(/\[S(\d{1,6})\]/gi, (match, digits) => {
            const id = `S${Number(digits)}`;
            if (!allowed.has(id)) return '';
            if (!seen.has(id)) {
                seen.add(id);
                citedIds.push(id);
            }
            return `[${id}]`;
        })
        .replace(/[ \t]+([,.;:!?])/g, '$1')
        .trim();
    return {
        reply: safeReply,
        sources: citedIds.map((id) => allowed.get(id))
    };
}

function stripClarificationCitationSyntax(value) {
    return String(value || '')
        .replace(/\[S\d+\](?:\([^\r\n)]*\))?/gi, '')
        .replace(/[ \t]+([,.;:!?])/g, '$1');
}

function boundedClarificationText(value, limit) {
    if (typeof value !== 'string') return '';
    const text = compact(stripClarificationCitationSyntax(value));
    if (
        !text
        || text.length > limit
        || [...text].some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127;
        })
        || text.includes(AI_CLARIFICATION_MARKER_START)
        || text.includes(AI_CLARIFICATION_MARKER_END)
    ) return '';
    return text;
}

function clarificationFingerprint(question, labels, allowFreeText) {
    return crypto.createHash('sha256')
        .update(JSON.stringify({ question, labels, allowFreeText }))
        .digest('hex');
}

function sanitizeAiClarificationInteraction(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!source) return null;
    const question = boundedClarificationText(source.question, AI_CLARIFICATION_MAX_QUESTION_CHARS);
    const rawOptions = Array.isArray(source.options) ? source.options : [];
    if (
        !question
        || rawOptions.length < AI_CLARIFICATION_MIN_OPTIONS
        || rawOptions.length > AI_CLARIFICATION_MAX_OPTIONS
    ) return null;

    const labels = [];
    const seen = new Set();
    for (const option of rawOptions) {
        const rawLabel = option && typeof option === 'object' && !Array.isArray(option)
            ? option.label
            : option;
        const label = boundedClarificationText(rawLabel, AI_CLARIFICATION_MAX_OPTION_CHARS);
        const key = label.toLocaleLowerCase('en-US');
        if (!label || seen.has(key)) return null;
        seen.add(key);
        labels.push(label);
    }

    // A model-provided choice can never remove the typed-answer escape hatch.
    const allowFreeText = true;
    const fingerprint = clarificationFingerprint(question, labels, allowFreeText);
    const id = `clarification_${fingerprint.slice(0, 24)}`;
    return {
        id,
        type: 'clarification',
        question,
        options: labels.map((label, index) => ({
            id: `option_${index + 1}_${crypto.createHash('sha256').update(id).update('\0').update(label).digest('hex').slice(0, 16)}`,
            label
        })),
        allowFreeText
    };
}

function visibleReplyWithClarificationQuestion(reply, question) {
    const visible = String(reply || '').trim();
    if (!visible) return question;
    const normalizedVisible = compact(stripClarificationCitationSyntax(visible)).toLocaleLowerCase('en-US');
    const normalizedQuestion = compact(question).toLocaleLowerCase('en-US');
    return normalizedVisible.includes(normalizedQuestion)
        ? visible
        : `${visible}\n\n${question}`;
}

function sanitizeAiClarificationPartialReply(value) {
    const reply = String(value || '');
    const markerIndex = reply.indexOf(AI_CLARIFICATION_MARKER_START);
    if (markerIndex >= 0) return reply.slice(0, markerIndex).trimEnd();

    const maxPrefixLength = Math.min(reply.length, AI_CLARIFICATION_MARKER_START.length - 1);
    for (let length = maxPrefixLength; length > 0; length -= 1) {
        if (reply.endsWith(AI_CLARIFICATION_MARKER_START.slice(0, length))) {
            return reply.slice(0, -length).trimEnd();
        }
    }
    return reply;
}

function parseAiClarificationReply(value) {
    const rawReply = String(value || '');
    const markerIndex = rawReply.indexOf(AI_CLARIFICATION_MARKER_START);
    if (markerIndex < 0) {
        const reply = sanitizeAiClarificationPartialReply(rawReply).trim();
        return {
            reply: reply || AI_CLARIFICATION_SAFE_FALLBACK,
            interaction: null
        };
    }

    const visibleReply = rawReply.slice(0, markerIndex).trim();
    const safeVisibleReply = visibleReply || AI_CLARIFICATION_SAFE_FALLBACK;
    const marker = rawReply.slice(markerIndex);
    if (marker.length > AI_CLARIFICATION_MAX_MARKER_CHARS) {
        return { reply: safeVisibleReply, interaction: null };
    }
    const payloadStart = AI_CLARIFICATION_MARKER_START.length;
    const markerEndIndex = marker.indexOf(AI_CLARIFICATION_MARKER_END, payloadStart);
    if (
        markerEndIndex < 0
        || marker.slice(markerEndIndex + AI_CLARIFICATION_MARKER_END.length).trim()
    ) {
        return { reply: safeVisibleReply, interaction: null };
    }

    const payload = marker.slice(payloadStart, markerEndIndex).trim();
    let decoded;
    try {
        decoded = JSON.parse(payload);
    } catch {
        return { reply: safeVisibleReply, interaction: null };
    }
    const interaction = sanitizeAiClarificationInteraction(decoded);
    if (!interaction) return { reply: safeVisibleReply, interaction: null };
    return {
        reply: visibleReplyWithClarificationQuestion(visibleReply, interaction.question),
        interaction
    };
}

function sanitizeAiMemoryInput(value, { now = Date.now() } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const text = clip(source.text, AI_MEMORY_TEXT_MAX_CHARS);
    if (!text) throw contractError('Memory text is required.', 'AI_MEMORY_TEXT_REQUIRED');
    const scope = String(source.scope || 'personal').trim().toLowerCase();
    if (!AI_MEMORY_SCOPES.includes(scope)) {
        throw contractError('Memory scope must be personal or room.', 'AI_MEMORY_SCOPE_INVALID');
    }
    const roomId = scope === 'room'
        ? (source.roomId === 'global' ? 'global' : sanitizeSourceItemId(source.roomId))
        : '';
    if (scope === 'room' && !roomId) {
        throw contractError('A room-scoped memory needs a roomId.', 'AI_MEMORY_ROOM_REQUIRED');
    }
    let expiresAt = Math.max(0, Math.floor(Number(source.expiresAt) || 0));
    if (expiresAt && expiresAt <= now) {
        throw contractError('Memory expiry must be in the future.', 'AI_MEMORY_EXPIRY_INVALID');
    }
    if (expiresAt > now + (365 * 24 * 60 * 60 * 1000)) {
        expiresAt = now + (365 * 24 * 60 * 60 * 1000);
    }
    return {
        text,
        scope,
        ...(roomId ? { roomId } : {}),
        provenance: clip(source.provenance || 'User approved in Winston', 180),
        ...(expiresAt ? { expiresAt } : {})
    };
}

function publicAiMemory(memory, id = '') {
    const source = memory && typeof memory === 'object' ? memory : {};
    return {
        id: sanitizeSourceItemId(id || source.id),
        text: clip(source.text, AI_MEMORY_TEXT_MAX_CHARS),
        scope: source.scope === 'room' ? 'room' : 'personal',
        ...(source.scope === 'room' ? { roomId: source.roomId === 'global' ? 'global' : sanitizeSourceItemId(source.roomId) } : {}),
        provenance: clip(source.provenance, 180),
        createdAt: Math.max(0, Math.floor(Number(source.createdAt) || 0)),
        updatedAt: Math.max(0, Math.floor(Number(source.updatedAt) || 0)),
        ...(Number(source.expiresAt) > 0 ? { expiresAt: Math.floor(Number(source.expiresAt)) } : {})
    };
}

function sanitizeAiMemoryId(value) {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(id)) {
        throw contractError('A valid memoryId is required.', 'AI_MEMORY_ID_INVALID');
    }
    return id;
}

function sanitizeAiImageAttachment(value) {
    const source = value && typeof value === 'object' ? value : {};
    const mimeType = String(source.mimeType || '').trim().toLowerCase();
    if (!AI_IMAGE_MIME_TYPES.includes(mimeType)) {
        throw contractError('Winston accepts JPEG, PNG, or WebP images.', 'AI_IMAGE_MIME_UNSUPPORTED', 415);
    }
    const image = String(source.image || source.data || '').trim();
    if (!image || image.startsWith('data:') || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        throw contractError('Image data must be raw base64 without a data URL prefix.', 'AI_IMAGE_DATA_INVALID');
    }
    const bytes = Buffer.from(image, 'base64');
    if (!bytes.length || bytes.length > AI_IMAGE_MAX_BYTES) {
        throw contractError(`Image size must be at most ${AI_IMAGE_MAX_BYTES} bytes.`, 'AI_IMAGE_TOO_LARGE', 413);
    }
    const canonical = bytes.toString('base64').replace(/=+$/, '');
    if (canonical !== image.replace(/=+$/, '')) {
        throw contractError('Image base64 is malformed.', 'AI_IMAGE_DATA_INVALID');
    }
    const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    const expected = mimeType === 'image/jpeg' ? jpeg : mimeType === 'image/png' ? png : webp;
    if (!expected) throw contractError('The image bytes do not match the declared MIME type.', 'AI_IMAGE_SIGNATURE_INVALID', 415);
    return {
        name: clip(source.name || 'Winston image', 120),
        mimeType,
        image,
        size: bytes.length
    };
}

function latestUserMessage(messages) {
    return [...(Array.isArray(messages) ? messages : [])]
        .reverse()
        .find((message) => message?.role !== 'assistant' && compact(message?.content));
}

function proposedTaskText(messages) {
    const latest = compact(latestUserMessage(messages)?.content);
    if (!latest || /\b(?:do not|don't|dont|never)\s+(?:create|add|make)\b/i.test(latest)) return '';
    const match = latest.match(/\b(?:create|add|make)\s+(?:me\s+)?(?:a\s+)?task\b(?:\s+(?:to|for))?\s*[:-]?\s*(.+)$/i);
    if (!match) return '';
    const text = clip(match[1].replace(/^(?:called|named)\s+/i, ''), 500);
    return /[\p{L}\p{N}]/u.test(text) ? text : '';
}

function buildCreateTaskProposal({ uid, requestId, roomId, messages, now = Date.now() } = {}) {
    const text = proposedTaskText(messages);
    if (!text) return null;
    const cleanUid = String(uid || '').trim();
    const cleanRequestId = String(requestId || '').trim();
    const cleanRoomId = roomId === 'global' ? 'global' : sanitizeSourceItemId(roomId);
    if (!cleanUid || !cleanRequestId || !cleanRoomId) return null;
    const id = crypto.createHash('sha256')
        .update(cleanUid).update('\0').update(cleanRequestId).update('\0create_task')
        .digest('hex');
    return {
        id,
        type: 'create_task',
        title: `Create task: ${clip(text, 120)}`,
        description: 'Winston will add this task only after you confirm.',
        requiresConfirmation: true,
        status: 'proposed',
        roomId: cleanRoomId,
        payload: {
            roomId: cleanRoomId,
            text,
            status: 'todo',
            priority: 'medium'
        },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS
    };
}

function aiActionId(uid, requestId, type) {
    const cleanUid = String(uid || '').trim();
    const cleanRequestId = String(requestId || '').trim();
    if (!cleanUid || !cleanRequestId || !AI_ACTION_TYPES.includes(type)) return '';
    return crypto.createHash('sha256')
        .update(cleanUid).update('\0').update(cleanRequestId).update('\0').update(type)
        .digest('hex');
}

function boundedActionName(value, limit = 120) {
    const text = clip(value, limit);
    if (!text || /[\u0000-\u001f\u007f]/u.test(text)) return '';
    return text.replace(/^["'“”‘’]+|["'“”‘’.,!?]+$/gu, '').trim();
}

function validCalendarDate(value) {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

function validCalendarTime(value) {
    const time = String(value || '').trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '';
}

function parseReminderDueAt(value, now = Date.now()) {
    const text = compact(value);
    const relative = text.match(/\bin\s+(\d{1,4})\s*(minutes?|mins?|hours?|hrs?|days?)\b/i);
    if (relative) {
        const amount = Math.max(1, Number(relative[1]) || 0);
        const unit = relative[2].toLowerCase();
        const multiplier = unit.startsWith('day')
            ? 24 * 60 * 60 * 1000
            : unit.startsWith('hour') || unit.startsWith('hr')
                ? 60 * 60 * 1000
                : 60 * 1000;
        return now + (amount * multiplier);
    }
    const absolute = text.match(/\b(?:on|at)\s+(\d{4}-\d{2}-\d{2})(?:[T\s]+([0-2]\d:[0-5]\d)(?::[0-5]\d)?(?:\s*(Z|[+-]\d{2}:\d{2}))?)?/i);
    if (!absolute || !validCalendarDate(absolute[1])) return 0;
    // An offset-less wall-clock time belongs to the user's locale, not UTC.
    // The authenticated request does not currently carry a trusted timezone,
    // so fail closed and let Winston ask for an explicit offset.
    const time = validCalendarTime(absolute[2]);
    const zone = String(absolute[3] || '').toUpperCase();
    if (!time || !zone) return 0;
    const timestamp = Date.parse(`${absolute[1]}T${time}:00${zone}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseAiWorkspaceActionIntent(messages, { roomId = 'global', now = Date.now() } = {}) {
    const latest = compact(latestUserMessage(messages)?.content);
    if (!latest || /\b(?:do not|don't|dont|never)\s+(?:create|add|schedule|update|move|remind|complete|finish|mark)\b/i.test(latest)) {
        return null;
    }
    const cleanRoomId = roomId === 'global' ? 'global' : sanitizeSourceItemId(roomId);
    if (!cleanRoomId) return null;

    const createEvent = latest.match(
        /\b(?:create|add|schedule)\s+(?:an?\s+)?event\b(?:\s+(?:called|named|for))?\s+(.+?)\s+(?:on|for)\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+([0-2]\d:[0-5]\d))?(?:\s+for\s+(\d{1,3})\s+minutes?)?/i
    );
    if (createEvent) {
        const title = boundedActionName(createEvent[1], 120);
        const date = validCalendarDate(createEvent[2]);
        const time = validCalendarTime(createEvent[3]);
        const duration = Math.max(0, Math.min(24 * 60, Number(createEvent[4]) || (time ? 60 : 0)));
        if (title && date) {
            return { type: 'create_event', roomId: cleanRoomId, title, date, time, duration };
        }
    }

    const updateEvent = latest.match(
        /\b(?:update|move|reschedule)\s+(?:the\s+)?event\s+["'“”]?(.+?)["'“”]?\s+(?:to|for)\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+([0-2]\d:[0-5]\d))?/i
    );
    if (updateEvent) {
        const eventName = boundedActionName(updateEvent[1], 120);
        const date = validCalendarDate(updateEvent[2]);
        const time = validCalendarTime(updateEvent[3]);
        if (eventName && date) {
            return { type: 'update_event', roomId: cleanRoomId, eventName, patch: { date, ...(time ? { time } : {}) } };
        }
    }

    if (/\bremind\s+me\b/i.test(latest)) {
        const dueAt = parseReminderDueAt(latest, now);
        const reminderMatch = latest.match(/\bremind\s+me\s+(?:to\s+)?(.+?)\s+(?:in\s+\d{1,4}\s*(?:minutes?|mins?|hours?|hrs?|days?)|(?:on|at)\s+\d{4}-\d{2}-\d{2}(?:[T\s]+[0-2]\d:[0-5]\d(?::[0-5]\d)?(?:\s*(?:Z|[+-]\d{2}:\d{2}))?)?)[.!?]*$/i);
        const text = boundedActionName(reminderMatch?.[1], 180);
        if (text && dueAt > now) {
            return { type: 'set_reminder', roomId: cleanRoomId, text, dueAt };
        }
    }

    const completeTask = latest.match(
        /\b(?:complete|finish)\s+(?:the\s+)?(?:task\s+)?["'“”]?(.+?)["'“”]?(?:\s+task)?[.!?]*$|\bmark\s+(?:the\s+)?(?:task\s+)?["'“”]?(.+?)["'“”]?\s+(?:as\s+)?done[.!?]*$/i
    );
    if (completeTask) {
        const taskName = boundedActionName(completeTask[1] || completeTask[2], 180);
        if (taskName && !/^(?:it|this|that|the task|task)$/i.test(taskName)) {
            return { type: 'complete_task', roomId: cleanRoomId, taskName };
        }
    }
    return null;
}

function buildCreateEventProposal({ uid, requestId, roomId, event, now = Date.now() } = {}) {
    const id = aiActionId(uid, requestId, 'create_event');
    const cleanRoomId = roomId === 'global' ? 'global' : sanitizeSourceItemId(roomId);
    const title = boundedActionName(event?.title, 120);
    const date = validCalendarDate(event?.date);
    const time = validCalendarTime(event?.time);
    const duration = Math.max(0, Math.min(24 * 60, Math.floor(Number(event?.duration) || 0)));
    if (!id || !cleanRoomId || !title || !date) return null;
    return {
        id,
        type: 'create_event',
        title: `Create event: ${title}`,
        description: `Winston will add this event on ${date}${time ? ` at ${time}` : ''} only after you confirm.`,
        requiresConfirmation: true,
        status: 'proposed',
        roomId: cleanRoomId,
        payload: {
            roomId: cleanRoomId,
            title,
            date,
            time,
            duration,
            location: clip(event?.location, 160),
            desc: clip(event?.desc || event?.description, 2000)
        },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS
    };
}

function buildUpdateEventProposal({
    uid,
    requestId,
    roomId,
    eventId,
    eventTitle,
    eventDate,
    eventTime,
    patch,
    now = Date.now()
} = {}) {
    const id = aiActionId(uid, requestId, 'update_event');
    const cleanRoomId = roomId === 'global' ? 'global' : sanitizeSourceItemId(roomId);
    const cleanEventId = sanitizeSourceItemId(eventId);
    const title = boundedActionName(eventTitle, 120);
    const expectedDate = validCalendarDate(eventDate);
    const expectedTime = validCalendarTime(eventTime);
    const date = validCalendarDate(patch?.date);
    const time = validCalendarTime(patch?.time);
    if (
        !id
        || !cleanRoomId
        || !cleanEventId
        || !title
        || !expectedDate
        || (eventTime && !expectedTime)
        || !date
        || (patch?.time && !time)
    ) return null;
    return {
        id,
        type: 'update_event',
        title: `Update event: ${title}`,
        description: `Winston will move this event to ${date}${time ? ` at ${time}` : ''} only after you confirm.`,
        requiresConfirmation: true,
        status: 'proposed',
        roomId: cleanRoomId,
        payload: {
            roomId: cleanRoomId,
            eventId: cleanEventId,
            eventTitle: title,
            expectedEvent: { title, date: expectedDate, time: expectedTime },
            patch: { date, ...(time ? { time } : {}) }
        },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS
    };
}

function buildSetReminderProposal({ uid, requestId, roomId, text, dueAt, now = Date.now() } = {}) {
    const id = aiActionId(uid, requestId, 'set_reminder');
    const cleanRoomId = roomId === 'global' ? 'global' : sanitizeSourceItemId(roomId);
    const reminderText = boundedActionName(text, 180);
    const timestamp = Math.floor(Number(dueAt) || 0);
    if (!id || !cleanRoomId || !reminderText || timestamp <= now || timestamp > now + (365 * 24 * 60 * 60 * 1000)) return null;
    return {
        id,
        type: 'set_reminder',
        title: `Set reminder: ${clip(reminderText, 100)}`,
        description: `Winston will save this reminder for ${new Date(timestamp).toISOString()} only after you confirm.`,
        requiresConfirmation: true,
        status: 'proposed',
        roomId: cleanRoomId,
        payload: { roomId: cleanRoomId, text: reminderText, dueAt: timestamp },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS
    };
}

function buildCompleteTaskProposal({ uid, requestId, roomId, taskId, taskText, now = Date.now() } = {}) {
    const id = aiActionId(uid, requestId, 'complete_task');
    const cleanRoomId = roomId === 'global' ? 'global' : sanitizeSourceItemId(roomId);
    const cleanTaskId = sanitizeSourceItemId(taskId);
    const text = boundedActionName(taskText, 180);
    if (!id || !cleanRoomId || !cleanTaskId || !text) return null;
    return {
        id,
        type: 'complete_task',
        title: `Complete task: ${clip(text, 100)}`,
        description: 'Winston will mark this exact task done only after you confirm.',
        requiresConfirmation: true,
        status: 'proposed',
        roomId: cleanRoomId,
        payload: { roomId: cleanRoomId, taskId: cleanTaskId, taskText: text },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS
    };
}

function splitRequestedContactNames(value) {
    const cleaned = compact(value)
        .replace(/\b(?:from|in)\s+my\s+contacts?\b/gi, '')
        .replace(/\b(?:please|now)\b[.!?]*$/gi, '')
        .replace(/^[\s:,-]+|[\s.!?]+$/g, '');
    if (!cleaned || /^(?:all|everyone|anyone|people|contacts?|friends?|my\s+(?:contacts?|friends?))$/i.test(cleaned)) return [];
    const names = [];
    const seen = new Set();
    for (const piece of cleaned.split(/\s*(?:,|\band\b|&)\s*/i)) {
        const name = boundedActionName(
            String(piece || '').replace(/^(?:my\s+)?(?:friend|contact)\s+/i, '').replace(/^@/, ''),
            120,
        );
        const key = name.toLocaleLowerCase('en-US');
        if (!name || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
        if (names.length >= AI_ACTION_MAX_INVITEES) break;
    }
    return names;
}

function parseAiSocialActionIntent(messages, { roomId = 'global' } = {}) {
    const latest = compact(latestUserMessage(messages)?.content);
    if (!latest || /\b(?:do not|don't|dont|never)\s+(?:create|make|invite|call|phone|ring)\b/i.test(latest)) return null;

    const createMatch = latest.match(/\b(?:create|make|set\s*up)\s+(?:a\s+|an\s+|the\s+)?(?:(friends?|private|community|public)\s+)?room\b([\s\S]*)/i);
    if (createMatch) {
        const roomTypeHint = String(createMatch[1] || '').toLowerCase();
        const roomType = /community|public/.test(roomTypeHint) ? 'community' : 'friends';
        let tail = String(createMatch[2] || '').trim();
        let inviteText = '';
        const inviteMatch = tail.match(/(?:^|\s)(?:and\s+)?invite\s+(.+)$/i);
        if (inviteMatch) {
            inviteText = inviteMatch[1];
            tail = tail.slice(0, inviteMatch.index).trim();
        } else {
            const withMatch = tail.match(/\s+with\s+(.+)$/i);
            if (withMatch) {
                inviteText = withMatch[1];
                tail = tail.slice(0, withMatch.index).trim();
            }
        }
        const roomName = boundedActionName(
            tail.replace(/^[\s:,-]*(?:called|named|for)\s+/i, '').replace(/^[\s:,-]+/, ''),
            120,
        );
        if (!roomName || /^(?:a|an|the|it|one|room|friends?|private|community|public)$/i.test(roomName)) return null;
        const requestedNames = splitRequestedContactNames(inviteText);
        return {
            type: 'create_room',
            roomName,
            roomType,
            requestedNames,
            resolutionRequired: Boolean(inviteText && !requestedNames.length),
        };
    }

    const callMatch = latest.match(/\b(?:call|phone|ring)\s+(.+?)(?:\s+(?:please|now))?[.!?]*$/i);
    if (callMatch) {
        const requestedNames = splitRequestedContactNames(callMatch[1]);
        if (requestedNames.length === 1) {
            return { type: 'start_friend_call', requestedNames };
        }
        return null;
    }

    const cleanRoomId = roomId === 'global' ? 'global' : sanitizeSourceItemId(roomId);
    const inviteMatch = latest.match(/\binvite\s+(.+?)(?:\s+(?:to|into)\s+(?:(?:this|the|my|current)\s+)?room\b|[.!?]*$)/i);
    if (inviteMatch && cleanRoomId && cleanRoomId !== 'global') {
        const requestedNames = splitRequestedContactNames(inviteMatch[1]);
        if (requestedNames.length) return { type: 'invite_friends', roomId: cleanRoomId, requestedNames };
        return { type: 'invite_friends', roomId: cleanRoomId, requestedNames: [], resolutionRequired: true };
    }
    return null;
}

function sanitizeResolvedContacts(value) {
    const contacts = [];
    const seen = new Set();
    for (const candidate of Array.isArray(value) ? value : []) {
        const uid = String(candidate?.uid || '').trim();
        const name = boundedActionName(candidate?.name, 120);
        if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid) || !name || seen.has(uid)) continue;
        seen.add(uid);
        contacts.push({ uid, name });
        if (contacts.length >= AI_ACTION_MAX_INVITEES) break;
    }
    return contacts;
}

function buildCreateRoomProposal({ uid, requestId, roomName, roomType, contacts = [], now = Date.now() } = {}) {
    const name = boundedActionName(roomName, 120);
    const type = roomType === 'community' ? 'community' : 'friends';
    const invitees = sanitizeResolvedContacts(contacts);
    const id = aiActionId(uid, requestId, 'create_room');
    if (!id || !name) return null;
    return {
        id,
        type: 'create_room',
        title: `Create room: ${name}`,
        description: invitees.length
            ? `Winston will create this ${type === 'community' ? 'community' : 'friends'} room and send ${invitees.length} friend invite${invitees.length === 1 ? '' : 's'} after you confirm.`
            : `Winston will create this ${type === 'community' ? 'community' : 'friends'} room after you confirm.`,
        requiresConfirmation: true,
        status: 'proposed',
        roomId: '',
        payload: {
            name,
            roomType: type,
            inviteeUids: invitees.map((contact) => contact.uid),
            inviteeNames: invitees.map((contact) => contact.name),
        },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS,
    };
}

function buildInviteFriendsProposal({ uid, requestId, roomId, contacts = [], now = Date.now() } = {}) {
    const cleanRoomId = sanitizeSourceItemId(roomId);
    const invitees = sanitizeResolvedContacts(contacts);
    const id = aiActionId(uid, requestId, 'invite_friends');
    if (!id || !cleanRoomId || cleanRoomId === 'global' || !invitees.length) return null;
    const names = invitees.map((contact) => contact.name);
    return {
        id,
        type: 'invite_friends',
        title: `Invite ${names.join(', ')}`,
        description: `Winston will send ${invitees.length === 1 ? 'this friend' : 'these friends'} an invite to the current room only after you confirm.`,
        requiresConfirmation: true,
        status: 'proposed',
        roomId: cleanRoomId,
        payload: {
            roomId: cleanRoomId,
            targetUids: invitees.map((contact) => contact.uid),
            targetNames: names,
        },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS,
    };
}

function buildStartFriendCallProposal({ uid, requestId, contact, now = Date.now() } = {}) {
    const target = sanitizeResolvedContacts(contact ? [contact] : [])[0];
    const id = aiActionId(uid, requestId, 'start_friend_call');
    if (!id || !target) return null;
    return {
        id,
        type: 'start_friend_call',
        title: `Call ${target.name}`,
        description: 'Winston will verify this person is still your friend, then open a short-lived call intent after you confirm. Your browser will request microphone access before ringing.',
        requiresConfirmation: true,
        status: 'proposed',
        roomId: '',
        payload: { targetUid: target.uid, targetName: target.name },
        createdAt: now,
        expiresAt: now + AI_ACTION_TTL_MS,
    };
}

function publicAiActionResult(type, value) {
    const result = value && typeof value === 'object' ? value : null;
    if (!result) return null;
    if (type === 'create_task') {
        return {
            taskId: sanitizeSourceItemId(result.taskId),
            roomId: result.roomId === 'global' ? 'global' : sanitizeSourceItemId(result.roomId),
        };
    }
    if (type === 'create_room') {
        return {
            roomId: sanitizeSourceItemId(result.roomId),
            roomName: boundedActionName(result.roomName, 120),
            shortId: clip(result.shortId, 40),
            inviteCode: clip(result.inviteCode, 80),
            invitedCount: Math.max(0, Math.min(AI_ACTION_MAX_INVITEES, Math.floor(Number(result.invitedCount) || 0))),
            invitedNames: sanitizeResolvedContacts((Array.isArray(result.invitedNames) ? result.invitedNames : []).map((name, index) => ({ uid: `result_${index + 1}`, name }))).map((contact) => contact.name),
        };
    }
    if (type === 'invite_friends') {
        return {
            roomId: sanitizeSourceItemId(result.roomId),
            roomName: boundedActionName(result.roomName, 120),
            inviteCode: clip(result.inviteCode, 80),
            invitedCount: Math.max(0, Math.min(AI_ACTION_MAX_INVITEES, Math.floor(Number(result.invitedCount) || 0))),
            invitedNames: sanitizeResolvedContacts((Array.isArray(result.invitedNames) ? result.invitedNames : []).map((name, index) => ({ uid: `result_${index + 1}`, name }))).map((contact) => contact.name),
        };
    }
    if (type === 'start_friend_call') {
        const threadId = /^[A-Za-z0-9_-]{13,257}$/.test(String(result.threadId || ''))
            ? String(result.threadId)
            : '';
        return {
            threadId,
            targetUid: /^[A-Za-z0-9_-]{6,128}$/.test(String(result.targetUid || '')) ? String(result.targetUid) : '',
            targetName: boundedActionName(result.targetName, 120),
            callIntentExpiresAt: Math.max(0, Math.floor(Number(result.callIntentExpiresAt) || 0)),
        };
    }
    if (type === 'create_event' || type === 'update_event') {
        return {
            eventId: sanitizeSourceItemId(result.eventId),
            roomId: result.roomId === 'global' ? 'global' : sanitizeSourceItemId(result.roomId),
            title: boundedActionName(result.title, 120),
            date: validCalendarDate(result.date),
            time: validCalendarTime(result.time)
        };
    }
    if (type === 'set_reminder') {
        return {
            reminderId: sanitizeSourceItemId(result.reminderId),
            roomId: result.roomId === 'global' ? 'global' : sanitizeSourceItemId(result.roomId),
            dueAt: Math.max(0, Math.floor(Number(result.dueAt) || 0))
        };
    }
    if (type === 'complete_task') {
        return {
            taskId: sanitizeSourceItemId(result.taskId),
            roomId: result.roomId === 'global' ? 'global' : sanitizeSourceItemId(result.roomId),
            completedAt: Math.max(0, Math.floor(Number(result.completedAt) || 0))
        };
    }
    return null;
}

function publicAiAction(action) {
    const source = action && typeof action === 'object' ? action : {};
    const type = AI_ACTION_TYPES.includes(source.type) ? source.type : 'unknown';
    const result = publicAiActionResult(type, source.result);
    return {
        id: /^[a-f0-9]{64}$/.test(String(source.id || '')) ? source.id : '',
        type,
        title: clip(source.title, 160),
        description: clip(source.description, 260),
        requiresConfirmation: source.requiresConfirmation !== false,
        status: ['proposed', 'confirming', 'confirmed', 'dismissed', 'expired'].includes(source.status)
            ? source.status
            : 'proposed',
        roomId: source.roomId === 'global' ? 'global' : sanitizeSourceItemId(source.roomId),
        expiresAt: Math.max(0, Math.floor(Number(source.expiresAt) || 0)),
        ...(result ? { result } : {})
    };
}

function sanitizeAiActionId(value) {
    const id = String(value || '').trim();
    if (!/^[a-f0-9]{64}$/.test(id)) {
        throw contractError('A valid actionId is required.', 'AI_ACTION_ID_INVALID');
    }
    return id;
}

function sanitizeAiPreloadMetadata(value, expectedModel) {
    const data = value && typeof value === 'object' ? value : {};
    const model = String(data.model || '').trim();
    if (
        data.ok !== true
        || model !== String(expectedModel || '').trim()
        || data.route !== 'local-preload'
        || data.billable !== false
    ) {
        throw contractError('The protected AI bridge returned invalid preload metadata.', 'AI_PRELOAD_INVALID_RESPONSE', 502);
    }
    const keepAlive = /^\d{1,4}[smh]$/.test(String(data.keepAlive || '').trim())
        ? String(data.keepAlive).trim()
        : '';
    return {
        warmed: true,
        model,
        route: 'local-preload',
        billable: false,
        ...(keepAlive ? { keepAlive } : {}),
        loadDurationMs: Math.max(0, Math.floor(Number(data.loadDurationMs) || 0))
    };
}

module.exports = {
    AI_ACTION_MAX_INVITEES,
    AI_ACTION_TTL_MS,
    AI_ACTION_TYPES,
    AI_BRIEFING_MAX_ROOMS,
    AI_CLARIFICATION_MARKER_END,
    AI_CLARIFICATION_MARKER_START,
    AI_CLARIFICATION_MAX_OPTION_CHARS,
    AI_CLARIFICATION_MAX_OPTIONS,
    AI_CLARIFICATION_MAX_QUESTION_CHARS,
    AI_CLARIFICATION_MIN_OPTIONS,
    AI_CLARIFICATION_SAFE_FALLBACK,
    AI_IMAGE_MAX_BYTES,
    AI_MEMORY_MAX_CARDS,
    AI_MEMORY_TEXT_MAX_CHARS,
    aiProviderExclusionsForPolicy,
    buildCompleteTaskProposal,
    buildCreateEventProposal,
    buildCreateRoomProposal,
    buildCreateTaskProposal,
    buildInviteFriendsProposal,
    buildSetReminderProposal,
    buildStartFriendCallProposal,
    buildUpdateEventProposal,
    normalizeAiRoutingPolicy,
    parseAiWorkspaceActionIntent,
    parseAiSocialActionIntent,
    parseAiClarificationReply,
    publicAiAction,
    publicAiMemory,
    publicAiRoute,
    sanitizeAiActionId,
    sanitizeAiClarificationInteraction,
    sanitizeAiClarificationPartialReply,
    sanitizeAiImageAttachment,
    sanitizeAiMemoryId,
    sanitizeAiMemoryInput,
    sanitizeAiPreloadMetadata,
    sanitizeAiSource,
    sanitizeAiSources,
    sanitizeSelectedRoomIds,
    validateAiReplyCitations
};
