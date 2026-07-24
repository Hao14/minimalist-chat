'use strict';

const crypto = require('node:crypto');
const {
    claimScheduledMessage,
    publicScheduledMessage,
    sanitizeScheduledMessage,
    scheduleBucket,
    scheduleQueueKey,
} = require('./scheduled-message-contracts');
const {
    checkMessage,
    requireAccountCanPost,
    roomModerationRole,
    sendMessage,
} = require('./room-moderation');

function httpError(message, code, status) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeIdempotencyKey(value) {
    const clean = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(clean)) {
        throw httpError(
            'An idempotency key containing 8 to 128 letters, numbers, underscores, or dashes is required.',
            'SCHEDULE_IDEMPOTENCY_INVALID',
            400
        );
    }
    return clean;
}

function scheduledMessageId(uid, idempotencyKey) {
    const hash = crypto
        .createHash('sha256')
        .update(`${uid}\n${safeIdempotencyKey(idempotencyKey)}`)
        .digest('hex')
        .slice(0, 40);
    return `schedule_${hash}`;
}

function scheduledMessagePath(uid, scheduleId) {
    return `scheduled_room_messages/${uid}/${scheduleId}`;
}

function scheduledProjectionPath(uid, scheduleId) {
    return `user_scheduled_messages/${uid}/${scheduleId}`;
}

function scheduledQueuePath(message, scheduleId) {
    return `scheduled_message_queue/${scheduleBucket(message.deliverAt)}/${scheduleQueueKey(message.uid, scheduleId)}`;
}

async function requireRoomMembership(database, uid, roomId) {
    if (roomId === 'global') return {};
    const snapshot = await database.ref(`rooms_meta/${roomId}`).once('value');
    if (!snapshot.exists()) throw httpError('Room not found.', 'SCHEDULE_ROOM_NOT_FOUND', 404);
    const room = snapshot.val() || {};
    if (!roomModerationRole(uid, room).isMember) {
        throw httpError('Join the room before scheduling a message.', 'SCHEDULE_ROOM_ACCESS_DENIED', 403);
    }
    return room;
}

async function createScheduledMessage(database, decoded, body, now = Date.now()) {
    const idempotencyKey = safeIdempotencyKey(body.idempotencyKey);
    const scheduleId = scheduledMessageId(decoded.uid, idempotencyKey);
    const reference = database.ref(scheduledMessagePath(decoded.uid, scheduleId));
    const existing = await reference.once('value');
    if (existing.exists()) {
        return {
            scheduledMessage: publicScheduledMessage(existing.val(), scheduleId),
            idempotent: true,
        };
    }

    const message = sanitizeScheduledMessage(body.message, { now, uid: decoded.uid });
    const room = await requireRoomMembership(database, decoded.uid, message.roomId);
    if (message.roomId === 'global') {
        await requireAccountCanPost(database, decoded.uid);
    } else {
        await checkMessage({
            database,
            uid: decoded.uid,
            roomId: message.roomId,
            room,
            channelId: message.channelId,
            text: message.text,
            now,
        });
    }
    const value = {
        ...message,
        idempotencyKey,
        name: String(decoded.name || ''),
        version: 1,
    };
    const projection = publicScheduledMessage(value, scheduleId);
    await database.ref().update({
        [scheduledMessagePath(decoded.uid, scheduleId)]: value,
        [scheduledProjectionPath(decoded.uid, scheduleId)]: projection,
        [scheduledQueuePath(value, scheduleId)]: {
            uid: decoded.uid,
            scheduleId,
            deliverAt: value.deliverAt,
        },
    });
    return { scheduledMessage: projection, idempotent: false };
}

async function cancelScheduledMessage(database, uid, scheduleId, now = Date.now()) {
    const reference = database.ref(scheduledMessagePath(uid, scheduleId));
    let previous = null;
    const transaction = await reference.transaction((current) => {
        previous = current;
        if (!current || current.status !== 'pending') return undefined;
        return {
            ...current,
            status: 'cancelled',
            cancelledAt: now,
        };
    }, undefined, false);
    if (!transaction.committed) {
        if (!previous) throw httpError('Scheduled message not found.', 'SCHEDULE_NOT_FOUND', 404);
        throw httpError('Only pending messages can be cancelled.', 'SCHEDULE_NOT_PENDING', 409);
    }
    const value = transaction.snapshot.val() || {};
    await database.ref().update({
        [scheduledProjectionPath(uid, scheduleId)]: publicScheduledMessage(value, scheduleId),
        [scheduledQueuePath(previous, scheduleId)]: null,
    });
    return publicScheduledMessage(value, scheduleId);
}

function createRoomSchedulingHandler({
    admin,
    requireFirebaseUser,
    setCors,
    allowedCorsOrigin,
}) {
    return async function roomSchedulingHandler(req, res) {
        setCors(req, res);
        if (req.method === 'OPTIONS') return res.status(204).send('');
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Use POST.', code: 'method_not_allowed' });
        }
        try {
            if (req.get('Origin') && !allowedCorsOrigin(req)) {
                throw httpError('This origin is not allowed to schedule messages.', 'SCHEDULE_ORIGIN_DENIED', 403);
            }
            const decoded = await requireFirebaseUser(req);
            const body = objectValue(req.body);
            const action = String(body.action || '').trim().toLowerCase();
            const database = admin.database();
            if (action === 'create') {
                const result = await createScheduledMessage(database, decoded, body);
                return res.status(result.idempotent ? 200 : 201).json(result);
            }
            if (action === 'cancel') {
                const scheduleId = String(body.scheduleId || '').trim();
                if (!/^schedule_[a-f0-9]{40}$/.test(scheduleId)) {
                    throw httpError('Scheduled message ID is invalid.', 'SCHEDULE_ID_INVALID', 400);
                }
                const scheduledMessage = await cancelScheduledMessage(database, decoded.uid, scheduleId);
                return res.status(200).json({ scheduledMessage });
            }
            throw httpError('Scheduling action is invalid.', 'SCHEDULE_ACTION_INVALID', 400);
        } catch (error) {
            const status = Math.max(400, Math.min(Number(error?.status) || 500, 599));
            if (status >= 500) console.error('roomScheduling failed', error?.code || error?.message || error);
            return res.status(status).json({
                error: status >= 500 ? 'Room scheduling failed.' : error.message,
                code: error?.code || 'SCHEDULE_FAILED',
            });
        }
    };
}

async function deliverScheduledEntry(database, entry, {
    now = Date.now(),
    claimId = crypto.randomUUID(),
} = {}) {
    const uid = String(entry.uid || '');
    const scheduleId = String(entry.scheduleId || '');
    if (!uid || !scheduleId) return { skipped: true };
    const reference = database.ref(scheduledMessagePath(uid, scheduleId));
    let beforeClaim = null;
    const claim = await reference.transaction((current) => {
        beforeClaim = current;
        return claimScheduledMessage(current, { claimId, now });
    }, undefined, false);
    if (!claim.committed) return { skipped: true };
    const scheduled = claim.snapshot.val() || {};
    const messageId = `scheduled_${scheduleId.slice('schedule_'.length)}`;

    try {
        const roomSnapshot = scheduled.roomId === 'global'
            ? null
            : await database.ref(`rooms_meta/${scheduled.roomId}`).once('value');
        const room = roomSnapshot?.val() || {};
        if (scheduled.roomId === 'global') {
            await requireAccountCanPost(database, uid);
            await database.ref(`messages/${messageId}`).transaction((current) => current || {
                uid,
                name: scheduled.name || 'Member',
                photoUrl: '',
                text: scheduled.text,
                timestamp: now,
                tier: 'free',
                scheduled: true,
                scheduledMessageId: scheduleId,
            });
        } else {
            await sendMessage({
                database,
                decoded: { uid, name: scheduled.name || 'Member' },
                roomId: scheduled.roomId,
                room,
                body: {
                    channelId: scheduled.channelId,
                    messageId,
                    message: {
                        text: scheduled.text,
                        scheduled: true,
                        scheduledMessageId: scheduleId,
                    },
                },
                now,
            });
        }
        const sent = {
            ...scheduled,
            status: 'sent',
            sentAt: now,
            messageId,
        };
        delete sent.claimId;
        delete sent.claimedAt;
        await database.ref().update({
            [scheduledMessagePath(uid, scheduleId)]: sent,
            [scheduledProjectionPath(uid, scheduleId)]: publicScheduledMessage(sent, scheduleId),
            [scheduledQueuePath(beforeClaim || scheduled, scheduleId)]: null,
        });
        return { delivered: true, uid, scheduleId };
    } catch (error) {
        const failed = {
            ...scheduled,
            status: 'failed',
            failedAt: now,
            error: String(error?.message || 'Scheduled delivery failed.').slice(0, 180),
        };
        delete failed.claimId;
        delete failed.claimedAt;
        await database.ref().update({
            [scheduledMessagePath(uid, scheduleId)]: failed,
            [scheduledProjectionPath(uid, scheduleId)]: publicScheduledMessage(failed, scheduleId),
            [scheduledQueuePath(beforeClaim || scheduled, scheduleId)]: null,
        });
        return { delivered: false, uid, scheduleId, error };
    }
}

async function processDueScheduledMessages(admin, {
    now = Date.now(),
    bucketLimit = 10,
    entryLimit = 100,
} = {}) {
    const database = admin.database();
    const currentBucket = scheduleBucket(now);
    const bucketsSnapshot = await database.ref('scheduled_message_queue')
        .orderByKey()
        .endAt(currentBucket)
        .limitToFirst(bucketLimit)
        .once('value');
    const entries = [];
    bucketsSnapshot.forEach((bucketSnapshot) => {
        bucketSnapshot.forEach((entrySnapshot) => {
            if (entries.length >= entryLimit) return;
            entries.push({
                bucket: bucketSnapshot.key,
                queueKey: entrySnapshot.key,
                ...(entrySnapshot.val() || {}),
            });
        });
    });
    const results = [];
    for (const entry of entries) {
        results.push(await deliverScheduledEntry(database, entry, { now }));
    }
    return results;
}

module.exports = {
    cancelScheduledMessage,
    createRoomSchedulingHandler,
    createScheduledMessage,
    deliverScheduledEntry,
    processDueScheduledMessages,
    scheduledMessageId,
    scheduledMessagePath,
    scheduledProjectionPath,
    scheduledQueuePath,
};
