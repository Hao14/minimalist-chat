'use strict';

const {
    MAX_MESSAGE_TEXT_CHARS,
    applyServerReplyContext,
    buildModerationEvidence,
    createModerationReport,
    evaluateMessageModeration,
    moderationReportId,
    normalizeRoomModerationConfig,
    publicModerationDecision,
    sanitizeModeratedMessageInput,
    sanitizeModerationId,
    sanitizeModerationIdempotencyKey,
    sanitizeModerationReportInput,
    transitionModerationReport
} = require('./moderation-contracts');

const DEFAULT_PLATFORM_ADMIN_UID = 'WsREhwYvPxaCSAjz0aqvwAU1leg2';
const MAX_REPORT_LIST_LIMIT = 100;

function httpError(message, code, status) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function roleName(value) {
    if (typeof value === 'string') return value.trim().toLowerCase();
    const role = objectValue(value);
    return String(role.role || role.name || '').trim().toLowerCase();
}

function roomModerationRole(uid, roomValue = {}, {
    platformAdminUid = DEFAULT_PLATFORM_ADMIN_UID
} = {}) {
    const room = objectValue(roomValue);
    const memberValue = room.members?.[uid];
    const memberRole = roleName(memberValue);
    const assignedRole = roleName(
        room.memberRoles?.[uid]
        || room.roleAssignments?.[uid]
        || room.memberRoleAssignments?.[uid]
    );
    const permissions = objectValue(room.memberPermissions?.[uid]);
    const isPlatformAdmin = uid === platformAdminUid;
    const isOwner = isPlatformAdmin || room.creatorId === uid || memberRole === 'owner' || assignedRole === 'owner';
    const isMember = isOwner || Boolean(memberValue);
    const isModerator = isOwner || (
        isMember
        && (
            room.moderators?.[uid] === true
            || memberRole === 'moderator'
            || memberRole === 'admin'
            || assignedRole === 'moderator'
            || assignedRole === 'mod'
            || assignedRole === 'admin'
            || permissions.moderate === true
        )
    );
    return {
        isMember,
        isModerator,
        isOwner,
        role: isOwner ? 'owner' : isModerator ? 'moderator' : isMember ? 'member' : 'none'
    };
}

function roomMessagePath(roomId, channelId, messageId = '') {
    const base = channelId && channelId !== 'general'
        ? `rooms_data/${roomId}/channels/${channelId}/messages`
        : `rooms_data/${roomId}/messages`;
    return messageId ? `${base}/${messageId}` : base;
}

function mergedRoomModerationConfig(roomValue = {}) {
    const room = objectValue(roomValue);
    const server = objectValue(room.moderation);
    const legacy = objectValue(room.bots?.autoModeration);
    const choose = (key, legacyKey = key) => (
        Object.hasOwn(server, key) ? server[key] : legacy[legacyKey]
    );
    return normalizeRoomModerationConfig({
        enabled: choose('enabled'),
        enforceServer: server.enforceServer === true,
        blockedTerms: Object.hasOwn(server, 'blockedTerms')
            ? server.blockedTerms
            : legacy.blockedWords,
        blockLinks: choose('blockLinks'),
        blockCaps: choose('blockCaps'),
        blockFlood: choose('blockFlood'),
        maxMentions: server.maxMentions,
        slowModeSeconds: server.slowModeSeconds,
        rateLimitCount: server.rateLimitCount,
        rateLimitWindowSeconds: server.rateLimitWindowSeconds,
        repeatLimit: server.repeatLimit,
        repeatWindowSeconds: server.repeatWindowSeconds
    });
}

function moderationReportPath(roomId, reportId = '') {
    const base = `room_moderation/${roomId}/reports`;
    return reportId ? `${base}/${reportId}` : base;
}

function publicReport(reportValue, { summary = false } = {}) {
    const report = objectValue(reportValue);
    const base = {
        id: String(report.reportId || ''),
        roomId: String(report.roomId || ''),
        reporterUid: String(report.reporterUid || ''),
        category: String(report.category || ''),
        reason: String(report.reason || ''),
        subject: report.subject || null,
        state: report.state || null,
        appeal: report.appeal || null,
        createdAt: Number(report.createdAt || 0),
        updatedAt: Number(report.updatedAt || 0)
    };
    if (summary) {
        return {
            ...base,
            evidenceHash: String(report.evidence?.hash || '')
        };
    }
    return {
        ...base,
        evidence: report.evidence || null,
        audit: Object.values(objectValue(report.audit))
            .sort((left, right) => Number(left?.at || 0) - Number(right?.at || 0))
    };
}

async function roomRecord(database, roomId) {
    const snapshot = await database.ref(`rooms_meta/${roomId}`).once('value');
    if (!snapshot.exists()) {
        throw httpError('Room not found.', 'MODERATION_ROOM_NOT_FOUND', 404);
    }
    return snapshot.val() || {};
}

function requireMembership(role) {
    if (!role.isMember) {
        throw httpError(
            'You need to be a room member to use moderation here.',
            'MODERATION_ROOM_ACCESS_DENIED',
            403
        );
    }
}

function requireModerator(role) {
    if (!role.isModerator) {
        throw httpError(
            'Room owner or moderator access is required.',
            'MODERATION_MODERATOR_REQUIRED',
            403
        );
    }
}

function requirePostAccess(room, uid, role, channelId = 'general', now = Date.now()) {
    requireMembership(role);
    const memberPermissions = objectValue(room.memberPermissions?.[uid]);
    const roomPermissions = objectValue(room.permissions);
    if (
        memberPermissions.chat === false
        || (!Object.hasOwn(memberPermissions, 'chat') && roomPermissions.chat === false)
    ) {
        throw httpError(
            'Posting is disabled for this account in this room.',
            'MODERATION_CHAT_PERMISSION_DENIED',
            403
        );
    }
    const channel = objectValue(room.channels?.[channelId]);
    if (channelId !== 'general' && !room.channels?.[channelId]) {
        throw httpError('Channel not found.', 'MODERATION_CHANNEL_NOT_FOUND', 404);
    }
    const channelMode = String(channel.mode || 'chat').trim().toLowerCase();
    const requiredRole = String(
        channel.postRole || (channelMode === 'announcements' ? 'moderator' : '')
    ).trim().toLowerCase();
    if (requiredRole === 'owner' && !role.isOwner) {
        throw httpError(
            'Only room owners can post in this channel.',
            'MODERATION_CHANNEL_POST_ROLE_DENIED',
            403
        );
    }
    if (
        (requiredRole === 'admin' || requiredRole === 'moderator')
        && !role.isModerator
    ) {
        throw httpError(
            'Only room moderators can post in this channel.',
            'MODERATION_CHANNEL_POST_ROLE_DENIED',
            403
        );
    }
    const muted = room.muted?.[uid];
    if (muted === true || muted === 'forever' || (Number(muted) > Number(now))) {
        throw httpError(
            'This account is muted in the room.',
            'MODERATION_ROOM_MUTED',
            403
        );
    }
}

async function requireAccountCanPost(database, uid) {
    const snapshot = await database.ref(`users/${uid}`).once('value').catch(() => null);
    const account = objectValue(snapshot?.val());
    if (account.isBanned === true) {
        throw httpError(
            'This account is banned.',
            'MODERATION_ACCOUNT_BANNED',
            403
        );
    }
    if (account.isMuted === true) {
        throw httpError(
            'This account is muted.',
            'MODERATION_ACCOUNT_MUTED',
            403
        );
    }
}

async function loadMessageEvidence(database, roomId, subject) {
    const snapshot = await database
        .ref(roomMessagePath(roomId, subject.channelId, subject.messageId))
        .once('value');
    if (!snapshot.exists()) {
        throw httpError(
            'The reported message no longer exists.',
            'MODERATION_MESSAGE_NOT_FOUND',
            404
        );
    }
    return snapshot.val() || {};
}

async function loadUserEvidence(database, room, targetUid) {
    const targetRole = roomModerationRole(targetUid, room);
    if (!targetRole.isMember) {
        throw httpError(
            'The reported account is not a room member.',
            'MODERATION_TARGET_NOT_IN_ROOM',
            404
        );
    }
    const snapshot = await database.ref(`user_directory/${targetUid}`).once('value').catch(() => null);
    return snapshot?.val() || { name: 'Member' };
}

async function createReport({ database, uid, roomId, room, body, now = Date.now() }) {
    const role = roomModerationRole(uid, room);
    requireMembership(role);
    const input = sanitizeModerationReportInput(body);
    const reportId = moderationReportId({
        reporterUid: uid,
        roomId,
        idempotencyKey: input.idempotencyKey
    });
    const reference = database.ref(moderationReportPath(roomId, reportId));
    const existingSnapshot = await reference.once('value');
    if (existingSnapshot.exists()) {
        const existing = existingSnapshot.val() || {};
        if (existing.reporterUid !== uid) {
            throw httpError(
                'The report idempotency key conflicts with another report.',
                'MODERATION_REPORT_IDEMPOTENCY_CONFLICT',
                409
            );
        }
        return { report: publicReport(existing), idempotent: true };
    }

    let rawMessage = null;
    let rawUser = null;
    if (input.subject.type === 'message') {
        rawMessage = await loadMessageEvidence(database, roomId, input.subject);
        if (rawMessage.uid === uid) {
            throw httpError(
                'You cannot report your own message.',
                'MODERATION_SELF_REPORT_INVALID',
                400
            );
        }
    } else {
        if (input.subject.targetUid === uid) {
            throw httpError(
                'You cannot report your own account.',
                'MODERATION_SELF_REPORT_INVALID',
                400
            );
        }
        rawUser = await loadUserEvidence(database, room, input.subject.targetUid);
    }

    const evidence = buildModerationEvidence({
        subject: input.subject,
        message: rawMessage,
        user: rawUser,
        capturedAt: now
    });
    const report = createModerationReport({
        roomId,
        reporterUid: uid,
        input,
        evidence,
        now
    });
    let idempotent = false;
    const transaction = await reference.transaction((current) => {
        if (current) {
            idempotent = true;
            return current;
        }
        return report;
    }, undefined, false);
    if (!transaction.committed) {
        throw httpError(
            'The report could not be saved. Retry with the same idempotency key.',
            'MODERATION_REPORT_WRITE_CONFLICT',
            409
        );
    }
    const saved = transaction.snapshot.val();
    if (saved?.reporterUid !== uid) {
        throw httpError(
            'The report idempotency key conflicts with another report.',
            'MODERATION_REPORT_IDEMPOTENCY_CONFLICT',
            409
        );
    }
    return { report: publicReport(saved), idempotent };
}

async function getReport(database, roomId, reportId) {
    const cleanReportId = sanitizeModerationId(reportId, 'Report ID', { maxLength: 80 });
    const snapshot = await database.ref(moderationReportPath(roomId, cleanReportId)).once('value');
    if (!snapshot.exists()) {
        throw httpError('Moderation report not found.', 'MODERATION_REPORT_NOT_FOUND', 404);
    }
    return snapshot.val();
}

async function listReports({ database, uid, roomId, room, body }) {
    const role = roomModerationRole(uid, room);
    const requestedLimit = Math.floor(Number(body.limit) || 50);
    const limit = Math.max(1, Math.min(requestedLimit, MAX_REPORT_LIST_LIMIT));
    let query = database.ref(moderationReportPath(roomId));
    if (role.isModerator) {
        query = query.orderByChild('createdAt').limitToLast(limit);
    } else {
        query = query.orderByChild('reporterUid').equalTo(uid).limitToLast(limit);
    }
    const snapshot = await query.once('value');
    const requestedStatus = body.status
        ? String(body.status).trim().toLowerCase()
        : '';
    const reports = Object.values(snapshot.val() || {})
        .filter((report) => (
            (role.isModerator || report?.reporterUid === uid)
            && (!requestedStatus || report?.state?.status === requestedStatus)
        ))
        .sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0))
        .slice(0, limit)
        .map((report) => publicReport(report, { summary: true }));
    return { reports, role: role.role };
}

async function transitionReport({
    database,
    uid,
    roomId,
    room,
    body,
    type,
    now = Date.now()
}) {
    const role = roomModerationRole(uid, room);
    const reportId = sanitizeModerationId(body.reportId, 'Report ID', { maxLength: 80 });
    const reference = database.ref(moderationReportPath(roomId, reportId));

    if (type === 'transition') {
        requireModerator(role);
        if (body.assignedTo) {
            const assigneeRole = roomModerationRole(
                sanitizeModerationId(body.assignedTo, 'Assignee ID', { maxLength: 128 }),
                room
            );
            requireModerator(assigneeRole);
        }
    }
    if (type === 'appeal_decision') requireModerator(role);

    let transitionError = null;
    let transitionResult = null;
    const transaction = await reference.transaction((current) => {
        if (!current) {
            transitionError = httpError(
                'Moderation report not found.',
                'MODERATION_REPORT_NOT_FOUND',
                404
            );
            return undefined;
        }
        if (type === 'appeal' && current.reporterUid !== uid) {
            transitionError = httpError(
                'Only the original reporter can appeal this report.',
                'MODERATION_APPEAL_FORBIDDEN',
                403
            );
            return undefined;
        }
        try {
            transitionResult = transitionModerationReport(current, {
                type,
                actorUid: uid,
                idempotencyKey: sanitizeModerationIdempotencyKey(body.idempotencyKey),
                status: body.status,
                assignedTo: Object.hasOwn(body, 'assignedTo') ? body.assignedTo : undefined,
                resolutionCode: body.resolutionCode,
                resolutionNote: body.resolutionNote,
                reason: body.reason,
                decision: body.decision,
                note: body.note,
                now
            });
            return transitionResult.record;
        } catch (error) {
            transitionError = error;
            return undefined;
        }
    }, undefined, false);

    if (transitionError) throw transitionError;
    if (!transaction.committed) {
        throw httpError(
            'The moderation report changed while it was being updated. Retry with the same idempotency key.',
            'MODERATION_REPORT_WRITE_CONFLICT',
            409
        );
    }
    return {
        report: publicReport(transaction.snapshot.val()),
        idempotent: transitionResult?.changed === false
    };
}

function moderationStatePath(roomId, uid, channelId) {
    return `room_moderation/${roomId}/messageState/${uid}/${channelId || 'general'}`;
}

async function checkMessage({ database, uid, roomId, room, channelId, text, reserveId = '', now = Date.now() }) {
    const role = roomModerationRole(uid, room);
    requirePostAccess(room, uid, role, channelId, now);
    await requireAccountCanPost(database, uid);
    if (channelId !== 'general' && !room.channels?.[channelId]) {
        throw httpError('Channel not found.', 'MODERATION_CHANNEL_NOT_FOUND', 404);
    }
    const config = mergedRoomModerationConfig(room);
    const stateReference = database.ref(moderationStatePath(roomId, uid, channelId));

    if (!reserveId) {
        const snapshot = await stateReference.once('value').catch(() => null);
        const decision = evaluateMessageModeration({
            text,
            config,
            state: snapshot?.val() || {},
            now
        });
        return {
            decision,
            moderation: publicModerationDecision(decision, {
                serverEnforced: config.enforceServer
            }),
            config,
            idempotent: false
        };
    }

    let decision = null;
    let idempotent = false;
    const transaction = await stateReference.transaction((current) => {
        if (current?.lastReservationId === reserveId) {
            idempotent = true;
            decision = {
                allowed: true,
                code: null,
                message: '',
                retryAfterSeconds: 0,
                policyVersion: config.policyVersion,
                nextState: current
            };
            return current;
        }
        decision = evaluateMessageModeration({ text, config, state: current || {}, now });
        if (!decision.allowed) return undefined;
        return {
            ...decision.nextState,
            lastReservationId: reserveId,
            updatedAt: now
        };
    }, undefined, false);
    if (!transaction.committed || !decision?.allowed) {
        const error = httpError(
            decision?.message || 'The message was blocked by room policy.',
            decision?.code || 'MODERATION_MESSAGE_BLOCKED',
            decision?.retryAfterSeconds > 0 ? 429 : 403
        );
        error.retryAfterSeconds = Number(decision?.retryAfterSeconds || 0);
        error.moderation = publicModerationDecision(decision || {}, {
            serverEnforced: config.enforceServer
        });
        throw error;
    }
    return {
        decision,
        moderation: publicModerationDecision(decision, {
            serverEnforced: config.enforceServer
        }),
        config,
        idempotent
    };
}

async function serverMessageIdentity(database, decoded, roomId, channelId) {
    const [userSnapshot, directorySnapshot] = await Promise.all([
        database.ref(`users/${decoded.uid}`).once('value').catch(() => null),
        database.ref(`user_directory/${decoded.uid}`).once('value').catch(() => null)
    ]);
    const user = userSnapshot?.val() || {};
    const directory = directorySnapshot?.val() || {};
    const candidatePhoto = String(
        directory.photoUrl
        || directory.photoURL
        || user.photoUrl
        || user.photoURL
        || decoded.picture
        || ''
    ).trim();
    return {
        uid: decoded.uid,
        name: directory.name || directory.displayName || user.name || user.displayName || decoded.name || 'Member',
        photoUrl: /^https:\/\//i.test(candidatePhoto) ? candidatePhoto : '',
        tier: user.tier || 'free',
        roomId,
        channelId
    };
}

async function sendMessage({
    database,
    decoded,
    roomId,
    room,
    body,
    now = Date.now()
}) {
    const channelId = sanitizeModerationId(body.channelId || 'general', 'Channel ID', { maxLength: 80 });
    const messageId = sanitizeModerationId(body.messageId, 'Message ID', {
        minLength: 8,
        maxLength: 160
    });
    const role = roomModerationRole(decoded.uid, room);
    requirePostAccess(room, decoded.uid, role, channelId, now);
    await requireAccountCanPost(database, decoded.uid);
    if (channelId !== 'general' && !room.channels?.[channelId]) {
        throw httpError('Channel not found.', 'MODERATION_CHANNEL_NOT_FOUND', 404);
    }

    const reference = database.ref(roomMessagePath(roomId, channelId, messageId));
    const existingSnapshot = await reference.once('value');
    if (existingSnapshot.exists()) {
        const existing = existingSnapshot.val() || {};
        if (existing.uid !== decoded.uid) {
            throw httpError(
                'Message ID already belongs to another sender.',
                'MODERATION_MESSAGE_ID_CONFLICT',
                409
            );
        }
        return {
            message: { id: messageId, ...existing },
            moderation: publicModerationDecision({ allowed: true }),
            idempotent: true
        };
    }

    const identity = await serverMessageIdentity(database, decoded, roomId, channelId);
    let message = sanitizeModeratedMessageInput(body.message, identity, now);
    if (message.replyTo?.id) {
        const parentMessageId = message.replyTo.id;
        const parentSnapshot = await database
            .ref(roomMessagePath(roomId, channelId, parentMessageId))
            .once('value');
        if (!parentSnapshot.exists()) {
            throw httpError(
                'The reply target no longer exists in this channel.',
                'MODERATION_REPLY_TARGET_NOT_FOUND',
                404
            );
        }
        message = applyServerReplyContext(message, parentSnapshot.val(), {
            parentMessageId,
            roomId,
            channelId
        });
    }
    const check = await checkMessage({
        database,
        uid: decoded.uid,
        roomId,
        room,
        channelId,
        text: message.text || '[attachment]',
        reserveId: messageId,
        now
    });
    const payload = {
        ...message,
        moderation: {
            policyVersion: check.moderation.policyVersion,
            checkedAt: now,
            serverEnforced: check.config.enforceServer === true
        }
    };
    let idempotent = check.idempotent;
    const transaction = await reference.transaction((current) => {
        if (current) {
            idempotent = true;
            return current;
        }
        return payload;
    }, undefined, false);
    if (!transaction.committed) {
        throw httpError(
            'The moderated message could not be saved. Retry with the same message ID.',
            'MODERATION_MESSAGE_WRITE_CONFLICT',
            409
        );
    }
    const saved = transaction.snapshot.val() || {};
    if (saved.uid !== decoded.uid) {
        throw httpError(
            'Message ID already belongs to another sender.',
            'MODERATION_MESSAGE_ID_CONFLICT',
            409
        );
    }

    const preview = message.text
        ? `${message.name}: ${message.text}`
        : `${message.name} sent ${message.attachedImage ? 'an image' : 'a file'}`;
    await database.ref(`rooms_meta/${roomId}/lastMessage`)
        .set(preview.length > 30 ? `${preview.slice(0, 30)}...` : preview)
        .catch(() => null);
    return {
        message: { id: messageId, ...saved },
        moderation: check.moderation,
        idempotent
    };
}

async function editMessage({
    database,
    decoded,
    roomId,
    room,
    body,
    now = Date.now()
}) {
    const channelId = sanitizeModerationId(body.channelId || 'general', 'Channel ID', { maxLength: 80 });
    const messageId = sanitizeModerationId(body.messageId, 'Message ID', {
        minLength: 8,
        maxLength: 160
    });
    const idempotencyKey = sanitizeModerationIdempotencyKey(body.idempotencyKey);
    const role = roomModerationRole(decoded.uid, room);
    requirePostAccess(room, decoded.uid, role, channelId, now);
    await requireAccountCanPost(database, decoded.uid);
    if (channelId !== 'general' && !room.channels?.[channelId]) {
        throw httpError('Channel not found.', 'MODERATION_CHANNEL_NOT_FOUND', 404);
    }

    const reference = database.ref(roomMessagePath(roomId, channelId, messageId));
    const existingSnapshot = await reference.once('value');
    if (!existingSnapshot.exists()) {
        throw httpError('Message not found.', 'MODERATION_MESSAGE_NOT_FOUND', 404);
    }
    const existing = existingSnapshot.val() || {};
    if (existing.uid !== decoded.uid) {
        throw httpError(
            'Only the message author can edit this message.',
            'MODERATION_MESSAGE_EDIT_FORBIDDEN',
            403
        );
    }

    const text = String(body.text || '').normalize('NFKC').trim();
    if (text.length > MAX_MESSAGE_TEXT_CHARS) {
        throw httpError(
            `Messages can contain at most ${MAX_MESSAGE_TEXT_CHARS} characters.`,
            'message_too_long',
            400
        );
    }
    if (!text && !existing.attachedImage && !existing.attachedFile) {
        throw httpError(
            'A message must contain text or an attachment.',
            'MODERATION_MESSAGE_EMPTY',
            400
        );
    }

    const editReservationId = `${messageId}_${idempotencyKey}`;
    const check = await checkMessage({
        database,
        uid: decoded.uid,
        roomId,
        room,
        channelId,
        text: text || '[attachment]',
        reserveId: editReservationId,
        now
    });
    let idempotent = check.idempotent;
    let editError = null;
    const transaction = await reference.transaction((current) => {
        if (!current) {
            editError = httpError('Message not found.', 'MODERATION_MESSAGE_NOT_FOUND', 404);
            return undefined;
        }
        if (current.uid !== decoded.uid) {
            editError = httpError(
                'Only the message author can edit this message.',
                'MODERATION_MESSAGE_EDIT_FORBIDDEN',
                403
            );
            return undefined;
        }
        if (current.moderation?.lastEditId === idempotencyKey) {
            idempotent = true;
            return current;
        }
        return {
            ...current,
            text,
            edited: true,
            editedAt: now,
            moderation: {
                ...objectValue(current.moderation),
                policyVersion: check.moderation.policyVersion,
                checkedAt: now,
                serverEnforced: check.config.enforceServer === true,
                lastEditId: idempotencyKey
            }
        };
    }, undefined, false);
    if (editError) throw editError;
    if (!transaction.committed) {
        throw httpError(
            'The moderated edit could not be saved. Retry with the same idempotency key.',
            'MODERATION_MESSAGE_WRITE_CONFLICT',
            409
        );
    }
    return {
        message: { id: messageId, ...(transaction.snapshot.val() || {}) },
        moderation: check.moderation,
        idempotent
    };
}

function createRoomModerationHandler({
    admin,
    requireFirebaseUser,
    setCors,
    allowedCorsOrigin,
    platformAdminUid = DEFAULT_PLATFORM_ADMIN_UID
}) {
    if (!admin?.database || typeof requireFirebaseUser !== 'function') {
        throw new TypeError('Room moderation requires Firebase Admin and an auth verifier.');
    }
    return async function roomModerationHandler(req, res) {
        setCors(req, res);
        if (req.method === 'OPTIONS') return res.status(204).send('');
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Use POST.', code: 'method_not_allowed' });
        }

        try {
            if (req.get('Origin') && !allowedCorsOrigin(req)) {
                throw httpError(
                    'This origin is not allowed to use room moderation.',
                    'MODERATION_ORIGIN_DENIED',
                    403
                );
            }
            const decoded = await requireFirebaseUser(req);
            const body = objectValue(req.body);
            const action = String(body.action || '').trim().toLowerCase();
            const roomId = sanitizeModerationId(body.roomId, 'Room ID');
            if (roomId === 'global') {
                throw httpError(
                    'Room moderation currently requires a private or discoverable room.',
                    'MODERATION_GLOBAL_UNSUPPORTED',
                    400
                );
            }
            const database = admin.database();
            const room = await roomRecord(database, roomId);

            if (action === 'report-create') {
                const result = await createReport({
                    database,
                    uid: decoded.uid,
                    roomId,
                    room,
                    body,
                    now: Date.now()
                });
                return res.status(result.idempotent ? 200 : 201).json(result);
            }
            if (action === 'report-list') {
                return res.status(200).json(await listReports({
                    database,
                    uid: decoded.uid,
                    roomId,
                    room,
                    body
                }));
            }
            if (action === 'report-get') {
                const report = await getReport(database, roomId, body.reportId);
                const requestRole = roomModerationRole(decoded.uid, room, { platformAdminUid });
                if (!requestRole.isModerator && report.reporterUid !== decoded.uid) {
                    throw httpError(
                        'You cannot view this moderation report.',
                        'MODERATION_REPORT_ACCESS_DENIED',
                        403
                    );
                }
                return res.status(200).json({ report: publicReport(report), role: requestRole.role });
            }
            if (action === 'report-transition') {
                return res.status(200).json(await transitionReport({
                    database,
                    uid: decoded.uid,
                    roomId,
                    room,
                    body,
                    type: 'transition'
                }));
            }
            if (action === 'report-appeal') {
                return res.status(200).json(await transitionReport({
                    database,
                    uid: decoded.uid,
                    roomId,
                    room,
                    body,
                    type: 'appeal'
                }));
            }
            if (action === 'appeal-decide') {
                return res.status(200).json(await transitionReport({
                    database,
                    uid: decoded.uid,
                    roomId,
                    room,
                    body,
                    type: 'appeal_decision'
                }));
            }
            if (action === 'message-check') {
                const channelId = sanitizeModerationId(
                    body.channelId || 'general',
                    'Channel ID',
                    { maxLength: 80 }
                );
                const checked = await checkMessage({
                    database,
                    uid: decoded.uid,
                    roomId,
                    room,
                    channelId,
                    text: body.text,
                    now: Date.now()
                });
                return res.status(200).json({ moderation: checked.moderation });
            }
            if (action === 'message-send') {
                return res.status(200).json(await sendMessage({
                    database,
                    decoded,
                    roomId,
                    room,
                    body,
                    now: Date.now()
                }));
            }
            if (action === 'message-edit') {
                return res.status(200).json(await editMessage({
                    database,
                    decoded,
                    roomId,
                    room,
                    body,
                    now: Date.now()
                }));
            }
            throw httpError(
                'Moderation action is invalid.',
                'MODERATION_ACTION_INVALID',
                400
            );
        } catch (error) {
            const status = Math.max(400, Math.min(Number(error?.status) || 500, 599));
            if (status >= 500) {
                console.error('roomModeration failed', error?.code || error?.message || error);
            }
            if (error?.retryAfterSeconds) {
                res.set('Retry-After', String(Math.ceil(error.retryAfterSeconds)));
            }
            return res.status(status).json({
                error: status >= 500 ? 'Room moderation failed.' : error.message,
                code: error?.code || 'MODERATION_FAILED',
                ...(error?.moderation ? { moderation: error.moderation } : {})
            });
        }
    };
}

module.exports = {
    DEFAULT_PLATFORM_ADMIN_UID,
    checkMessage,
    createRoomModerationHandler,
    editMessage,
    mergedRoomModerationConfig,
    moderationReportPath,
    publicReport,
    requireAccountCanPost,
    roomMessagePath,
    roomModerationRole,
    sendMessage
};
