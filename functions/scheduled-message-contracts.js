'use strict';

const MAX_SCHEDULED_TEXT_LENGTH = 8_000;
const MIN_SCHEDULE_DELAY_MS = 60_000;
const MAX_SCHEDULE_DELAY_MS = 365 * 24 * 60 * 60 * 1000;

function cleanField(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function sanitizeScheduledMessage(input = {}, { now = Date.now(), uid = '' } = {}) {
    const text = cleanField(input.text, MAX_SCHEDULED_TEXT_LENGTH);
    const roomId = cleanField(input.roomId, 256);
    const channelId = cleanField(input.channelId || 'general', 80) || 'general';
    const deliverAt = Number(input.deliverAt || 0);

    if (!uid) throw Object.assign(new Error('Sign in before scheduling a message.'), { status: 401, code: 'schedule_auth_required' });
    if (!text) throw Object.assign(new Error('Add a message to schedule.'), { status: 422, code: 'schedule_text_required' });
    if (!roomId) throw Object.assign(new Error('Choose a room.'), { status: 422, code: 'schedule_room_required' });
    if (!Number.isFinite(deliverAt) || deliverAt < now + MIN_SCHEDULE_DELAY_MS) {
        throw Object.assign(new Error('Choose a delivery time at least one minute from now.'), { status: 422, code: 'schedule_time_too_soon' });
    }
    if (deliverAt > now + MAX_SCHEDULE_DELAY_MS) {
        throw Object.assign(new Error('Messages can be scheduled up to one year ahead.'), { status: 422, code: 'schedule_time_too_far' });
    }

    return {
        channelId,
        createdAt: now,
        deliverAt,
        roomId,
        status: 'pending',
        text,
        uid,
    };
}

function scheduleBucket(deliverAt) {
    const date = new Date(Number(deliverAt || 0));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

function scheduleQueueKey(uid, scheduleId) {
    return `${cleanField(uid, 128)}_${cleanField(scheduleId, 128)}`.replace(/[.#$/[\]\s]+/g, '_');
}

function messagePath(roomId, channelId, messageId) {
    if (roomId === 'global') return `messages/${messageId}`;
    if (!channelId || channelId === 'general') return `rooms_data/${roomId}/messages/${messageId}`;
    return `rooms_data/${roomId}/channels/${channelId}/messages/${messageId}`;
}

function claimScheduledMessage(current, { claimId, now = Date.now() } = {}) {
    if (!current || current.status !== 'pending') return undefined;
    if (Number(current.deliverAt || 0) > now) return undefined;
    return {
        ...current,
        claimId: cleanField(claimId, 128),
        claimedAt: now,
        status: 'sending',
    };
}

function releaseExpiredScheduleClaim(current, { now = Date.now(), ttlMs = 5 * 60_000 } = {}) {
    if (!current || current.status !== 'sending') return current;
    if (Number(current.claimedAt || 0) + ttlMs > now) return current;
    const next = { ...current, status: 'pending', retryAt: now };
    delete next.claimId;
    delete next.claimedAt;
    return next;
}

function publicScheduledMessage(value = {}, id = '') {
    return {
        id: cleanField(id || value.id, 128),
        channelId: cleanField(value.channelId || 'general', 80) || 'general',
        createdAt: Number(value.createdAt || 0),
        deliverAt: Number(value.deliverAt || 0),
        error: cleanField(value.error, 180),
        roomId: cleanField(value.roomId, 256),
        sentAt: Number(value.sentAt || 0),
        status: cleanField(value.status || 'pending', 24),
        text: cleanField(value.text, MAX_SCHEDULED_TEXT_LENGTH),
    };
}

module.exports = {
    MAX_SCHEDULE_DELAY_MS,
    MAX_SCHEDULED_TEXT_LENGTH,
    MIN_SCHEDULE_DELAY_MS,
    claimScheduledMessage,
    messagePath,
    publicScheduledMessage,
    releaseExpiredScheduleClaim,
    sanitizeScheduledMessage,
    scheduleBucket,
    scheduleQueueKey,
};
