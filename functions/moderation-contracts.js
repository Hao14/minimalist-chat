'use strict';

const crypto = require('node:crypto');

const MODERATION_POLICY_VERSION = 1;
const MODERATION_REPORT_VERSION = 1;
const MAX_MESSAGE_TEXT_CHARS = 8000;
const MAX_REPORT_REASON_CHARS = 1200;
const MIN_REPORT_REASON_CHARS = 8;

const REPORT_CATEGORIES = Object.freeze([
    'harassment',
    'hate',
    'threats',
    'spam',
    'sexual',
    'self_harm',
    'misinformation',
    'impersonation',
    'privacy',
    'illegal',
    'other'
]);

const REPORT_STATUSES = Object.freeze([
    'open',
    'triaged',
    'investigating',
    'resolved',
    'dismissed',
    'appealed'
]);

const RESOLUTION_CODES = Object.freeze([
    'no_action',
    'no_violation',
    'insufficient_evidence',
    'duplicate',
    'warning',
    'content_removed',
    'timeout',
    'member_removed',
    'ban',
    'escalated',
    'other'
]);

const REPORT_TRANSITIONS = Object.freeze({
    open: Object.freeze(['triaged', 'investigating', 'resolved', 'dismissed']),
    triaged: Object.freeze(['open', 'investigating', 'resolved', 'dismissed']),
    investigating: Object.freeze(['triaged', 'resolved', 'dismissed']),
    resolved: Object.freeze(['investigating']),
    dismissed: Object.freeze(['investigating']),
    appealed: Object.freeze([])
});

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const LINK_PATTERN = /\b(?:https?:\/\/|www\.)\S+/iu;
const REPEATED_CHARACTER_PATTERN = /(.)\1{7,}/iu;
const MENTION_PATTERN = /@[A-Za-z0-9][A-Za-z0-9._-]{0,63}/gu;
const REGEXP_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;

function moderationContractError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedText(value, maxLength, {
    field = 'Text',
    minLength = 0,
    collapseWhitespace = false
} = {}) {
    let clean = String(value ?? '').normalize('NFKC').trim();
    if (collapseWhitespace) clean = clean.replace(/\s+/g, ' ');
    if (clean.length < minLength) {
        throw moderationContractError(
            `${field} must contain at least ${minLength} characters.`,
            'MODERATION_TEXT_TOO_SHORT'
        );
    }
    if (clean.length > maxLength) {
        throw moderationContractError(
            `${field} must contain no more than ${maxLength} characters.`,
            'MODERATION_TEXT_TOO_LONG'
        );
    }
    return clean;
}

function clippedText(value, maxLength, {
    fallback = '',
    collapseWhitespace = false
} = {}) {
    let clean = String(value ?? fallback).normalize('NFKC').trim();
    if (!clean && fallback) clean = String(fallback).normalize('NFKC').trim();
    if (collapseWhitespace) clean = clean.replace(/\s+/g, ' ');
    return clean.slice(0, maxLength);
}

function sanitizeModerationId(value, field = 'ID', { minLength = 1, maxLength = 160 } = {}) {
    const clean = String(value || '').trim();
    if (
        clean.length < minLength
        || clean.length > maxLength
        || !SAFE_ID_PATTERN.test(clean)
    ) {
        throw moderationContractError(
            `${field} is invalid.`,
            'MODERATION_ID_INVALID'
        );
    }
    return clean;
}

function sanitizeModerationIdempotencyKey(value) {
    const clean = String(value || '').trim();
    if (!SAFE_IDEMPOTENCY_PATTERN.test(clean)) {
        throw moderationContractError(
            'An idempotency key containing 8 to 128 letters, numbers, underscores, or dashes is required.',
            'MODERATION_IDEMPOTENCY_INVALID'
        );
    }
    return clean;
}

function stableJsonValue(value) {
    if (Array.isArray(value)) return value.map(stableJsonValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, stableJsonValue(value[key])])
    );
}

function stableStringify(value) {
    return JSON.stringify(stableJsonValue(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function moderationReportId({ reporterUid, roomId, idempotencyKey }) {
    const reporter = sanitizeModerationId(reporterUid, 'Reporter ID', { maxLength: 128 });
    const room = sanitizeModerationId(roomId, 'Room ID');
    const key = sanitizeModerationIdempotencyKey(idempotencyKey);
    return `report_${sha256(`${reporter}\n${room}\n${key}`).slice(0, 40)}`;
}

function moderationAuditEventId(reportId, type, idempotencyKey) {
    const report = sanitizeModerationId(reportId, 'Report ID', { maxLength: 80 });
    const eventType = sanitizeModerationId(type, 'Audit event type', { maxLength: 40 });
    const key = sanitizeModerationIdempotencyKey(idempotencyKey);
    return `event_${sha256(`${report}\n${eventType}\n${key}`).slice(0, 40)}`;
}

function sanitizeReportCategory(value) {
    const category = String(value || '').trim().toLowerCase();
    if (!REPORT_CATEGORIES.includes(category)) {
        throw moderationContractError(
            `Report category must be one of: ${REPORT_CATEGORIES.join(', ')}.`,
            'MODERATION_REPORT_CATEGORY_INVALID'
        );
    }
    return category;
}

function sanitizeReportSubject(value = {}) {
    const subject = objectValue(value);
    const type = String(subject.type || '').trim().toLowerCase();
    if (type === 'message') {
        return {
            type,
            messageId: sanitizeModerationId(subject.messageId, 'Message ID'),
            channelId: sanitizeModerationId(subject.channelId || 'general', 'Channel ID', { maxLength: 80 })
        };
    }
    if (type === 'user') {
        return {
            type,
            targetUid: sanitizeModerationId(subject.targetUid, 'Target user ID', { maxLength: 128 })
        };
    }
    throw moderationContractError(
        'Report subject type must be message or user.',
        'MODERATION_REPORT_SUBJECT_INVALID'
    );
}

function sanitizeModerationReportInput(value = {}) {
    const input = objectValue(value);
    return {
        category: sanitizeReportCategory(input.category),
        reason: boundedText(input.reason, MAX_REPORT_REASON_CHARS, {
            field: 'Report reason',
            minLength: MIN_REPORT_REASON_CHARS
        }),
        subject: sanitizeReportSubject(input.subject),
        idempotencyKey: sanitizeModerationIdempotencyKey(input.idempotencyKey)
    };
}

function sanitizeEvidenceUrl(value) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    if (clean.length > 2048 || !/^https:\/\//i.test(clean)) return '';
    return clean;
}

function sanitizeEvidenceMessage(messageValue = {}, subject = {}) {
    const message = objectValue(messageValue);
    const attachedFile = objectValue(message.attachedFile);
    const replyTo = objectValue(message.replyTo);
    const evidence = {
        messageId: sanitizeModerationId(subject.messageId, 'Message ID'),
        channelId: sanitizeModerationId(subject.channelId || 'general', 'Channel ID', { maxLength: 80 }),
        authorUid: sanitizeModerationId(message.uid, 'Message author ID', { maxLength: 128 }),
        authorName: boundedText(message.name || 'Member', 160, {
            field: 'Message author name',
            collapseWhitespace: true
        }),
        text: boundedText(message.text || '', MAX_MESSAGE_TEXT_CHARS, {
            field: 'Evidence message'
        }),
        timestamp: Math.max(0, Number(message.timestamp) || 0)
    };

    const attachedImage = sanitizeEvidenceUrl(message.attachedImage);
    if (attachedImage) evidence.attachedImage = attachedImage;
    if (attachedFile.url) {
        const url = sanitizeEvidenceUrl(attachedFile.url);
        if (url) {
            evidence.attachedFile = {
                url,
                name: boundedText(attachedFile.name || 'File', 180, {
                    field: 'Attachment name',
                    collapseWhitespace: true
                }),
                type: boundedText(attachedFile.type || 'File', 120, {
                    field: 'Attachment type',
                    collapseWhitespace: true
                }),
                size: Math.max(0, Math.min(Number(attachedFile.size) || 0, 10 * 1024 * 1024 * 1024))
            };
        }
    }
    if (replyTo.id) {
        evidence.replyTo = {
            messageId: sanitizeModerationId(replyTo.id, 'Reply message ID'),
            authorUid: replyTo.uid
                ? sanitizeModerationId(replyTo.uid, 'Reply author ID', { maxLength: 128 })
                : '',
            authorName: boundedText(replyTo.name || 'Member', 160, {
                field: 'Reply author name',
                collapseWhitespace: true
            }),
            text: boundedText(replyTo.text || '', 1000, { field: 'Reply excerpt' })
        };
    }
    if (message.threadRootId) {
        evidence.threadRootId = sanitizeModerationId(message.threadRootId, 'Thread root ID');
    }
    if (message.threadParentId) {
        evidence.threadParentId = sanitizeModerationId(message.threadParentId, 'Thread parent ID');
    }
    return evidence;
}

function sanitizeEvidenceUser(userValue = {}, targetUid) {
    const user = objectValue(userValue);
    return {
        targetUid: sanitizeModerationId(targetUid, 'Target user ID', { maxLength: 128 }),
        displayName: boundedText(
            user.name || user.displayName || user.username || 'Member',
            160,
            { field: 'Target display name', collapseWhitespace: true }
        ),
        shortId: boundedText(user.shortId || '', 80, {
            field: 'Target short ID',
            collapseWhitespace: true
        })
    };
}

function buildModerationEvidence({
    subject,
    message = null,
    user = null,
    capturedAt = Date.now()
}) {
    const cleanSubject = sanitizeReportSubject(subject);
    const evidence = {
        version: MODERATION_REPORT_VERSION,
        capturedAt: Math.max(0, Number(capturedAt) || Date.now()),
        subject: cleanSubject
    };
    if (cleanSubject.type === 'message') {
        evidence.message = sanitizeEvidenceMessage(message, cleanSubject);
    } else {
        evidence.user = sanitizeEvidenceUser(user, cleanSubject.targetUid);
    }
    return {
        ...evidence,
        hash: sha256(stableStringify(evidence))
    };
}

function createAuditEntry({
    eventId,
    type,
    actorUid,
    at,
    previousHash = '',
    details = {}
}) {
    const entryWithoutHash = {
        eventId: sanitizeModerationId(eventId, 'Audit event ID', { maxLength: 80 }),
        type: sanitizeModerationId(type, 'Audit event type', { maxLength: 40 }),
        actorUid: sanitizeModerationId(actorUid, 'Audit actor ID', { maxLength: 128 }),
        at: Math.max(0, Number(at) || Date.now()),
        previousHash: String(previousHash || ''),
        details: stableJsonValue(objectValue(details))
    };
    return {
        ...entryWithoutHash,
        hash: sha256(stableStringify(entryWithoutHash))
    };
}

function createModerationReport({
    roomId,
    reporterUid,
    input,
    evidence,
    now = Date.now()
}) {
    const room = sanitizeModerationId(roomId, 'Room ID');
    const reporter = sanitizeModerationId(reporterUid, 'Reporter ID', { maxLength: 128 });
    const cleanInput = sanitizeModerationReportInput(input);
    const cleanEvidence = objectValue(evidence);
    const {
        hash: suppliedEvidenceHash,
        ...evidenceWithoutHash
    } = cleanEvidence;
    const expectedEvidenceHash = sha256(stableStringify(evidenceWithoutHash));
    if (
        cleanEvidence.version !== MODERATION_REPORT_VERSION
        || !suppliedEvidenceHash
        || suppliedEvidenceHash !== expectedEvidenceHash
        || stableStringify(cleanEvidence.subject) !== stableStringify(cleanInput.subject)
    ) {
        throw moderationContractError(
            'Moderation evidence hash does not match its snapshot.',
            'MODERATION_EVIDENCE_INVALID'
        );
    }
    const expectedEvidence = {
        ...stableJsonValue(evidenceWithoutHash),
        hash: suppliedEvidenceHash
    };

    const reportId = moderationReportId({
        reporterUid: reporter,
        roomId: room,
        idempotencyKey: cleanInput.idempotencyKey
    });
    const createdAt = Math.max(0, Number(now) || Date.now());
    const state = {
        status: 'open',
        assignedTo: '',
        resolutionCode: '',
        resolutionNote: '',
        updatedAt: createdAt,
        updatedBy: reporter
    };
    const eventId = moderationAuditEventId(reportId, 'created', cleanInput.idempotencyKey);
    const createdEvent = createAuditEntry({
        eventId,
        type: 'created',
        actorUid: reporter,
        at: createdAt,
        details: {
            category: cleanInput.category,
            subjectType: cleanInput.subject.type,
            status: state.status
        }
    });

    return {
        version: MODERATION_REPORT_VERSION,
        reportId,
        roomId: room,
        reporterUid: reporter,
        category: cleanInput.category,
        reason: cleanInput.reason,
        subject: cleanInput.subject,
        evidence: expectedEvidence,
        state,
        appeal: null,
        audit: { [eventId]: createdEvent },
        auditHead: createdEvent.hash,
        createdAt,
        updatedAt: createdAt
    };
}

function validateCurrentReport(value) {
    const report = objectValue(value);
    if (
        report.version !== MODERATION_REPORT_VERSION
        || !report.reportId
        || !report.roomId
        || !report.reporterUid
        || !REPORT_STATUSES.includes(report.state?.status)
        || !report.evidence?.hash
    ) {
        throw moderationContractError(
            'The moderation report state is invalid.',
            'MODERATION_REPORT_STATE_INVALID',
            409
        );
    }
    return report;
}

function appendAuditEvent(report, event) {
    if (report.audit?.[event.eventId]) {
        return { record: report, changed: false, event: report.audit[event.eventId] };
    }
    if (String(event.previousHash || '') !== String(report.auditHead || '')) {
        throw moderationContractError(
            'The moderation audit chain changed. Retry the action.',
            'MODERATION_AUDIT_CONFLICT',
            409
        );
    }
    return {
        record: {
            ...report,
            audit: {
                ...objectValue(report.audit),
                [event.eventId]: event
            },
            auditHead: event.hash,
            updatedAt: event.at
        },
        changed: true,
        event
    };
}

function sanitizeResolutionCode(value) {
    const clean = String(value || '').trim().toLowerCase();
    if (!RESOLUTION_CODES.includes(clean)) {
        throw moderationContractError(
            `Resolution code must be one of: ${RESOLUTION_CODES.join(', ')}.`,
            'MODERATION_RESOLUTION_INVALID'
        );
    }
    return clean;
}

function transitionModerationReport(reportValue, actionValue = {}) {
    const report = validateCurrentReport(reportValue);
    const action = objectValue(actionValue);
    const type = String(action.type || 'transition').trim().toLowerCase();
    const actorUid = sanitizeModerationId(action.actorUid, 'Actor ID', { maxLength: 128 });
    const idempotencyKey = sanitizeModerationIdempotencyKey(action.idempotencyKey);
    const at = Math.max(0, Number(action.now) || Date.now());
    const eventId = moderationAuditEventId(report.reportId, type, idempotencyKey);
    if (report.audit?.[eventId]) {
        return { record: report, changed: false, event: report.audit[eventId] };
    }

    if (type === 'transition') {
        const previousState = objectValue(report.state);
        const previousStatus = String(previousState.status);
        const requestedStatus = action.status === undefined || action.status === null || action.status === ''
            ? previousStatus
            : String(action.status).trim().toLowerCase();
        if (!REPORT_STATUSES.includes(requestedStatus) || requestedStatus === 'appealed') {
            throw moderationContractError(
                'Report status is invalid.',
                'MODERATION_REPORT_STATUS_INVALID'
            );
        }
        if (
            requestedStatus !== previousStatus
            && !REPORT_TRANSITIONS[previousStatus]?.includes(requestedStatus)
        ) {
            throw moderationContractError(
                `Report cannot move from ${previousStatus} to ${requestedStatus}.`,
                'MODERATION_REPORT_TRANSITION_INVALID',
                409
            );
        }

        const assignmentProvided = Object.hasOwn(action, 'assignedTo') && action.assignedTo !== undefined;
        const assignedTo = assignmentProvided && action.assignedTo
            ? sanitizeModerationId(action.assignedTo, 'Assignee ID', { maxLength: 128 })
            : assignmentProvided
                ? ''
                : String(previousState.assignedTo || '');
        const isTerminal = requestedStatus === 'resolved' || requestedStatus === 'dismissed';
        const resolutionCode = isTerminal
            ? sanitizeResolutionCode(action.resolutionCode || previousState.resolutionCode)
            : '';
        const resolutionNote = isTerminal
            ? boundedText(action.resolutionNote ?? previousState.resolutionNote ?? '', 1200, {
                field: 'Resolution note'
            })
            : '';
        const nextState = {
            status: requestedStatus,
            assignedTo,
            resolutionCode,
            resolutionNote,
            updatedAt: at,
            updatedBy: actorUid
        };
        const materiallyChanged = stableStringify({
            ...previousState,
            updatedAt: 0,
            updatedBy: ''
        }) !== stableStringify({
            ...nextState,
            updatedAt: 0,
            updatedBy: ''
        });
        if (!materiallyChanged) {
            throw moderationContractError(
                'The moderation transition did not change report state.',
                'MODERATION_REPORT_NO_CHANGE',
                409
            );
        }
        const event = createAuditEntry({
            eventId,
            type,
            actorUid,
            at,
            previousHash: report.auditHead,
            details: {
                fromStatus: previousStatus,
                toStatus: requestedStatus,
                fromAssignee: String(previousState.assignedTo || ''),
                toAssignee: assignedTo,
                resolutionCode
            }
        });
        const appended = appendAuditEvent({ ...report, state: nextState }, event);
        return appended;
    }

    if (type === 'appeal') {
        if (actorUid !== report.reporterUid) {
            throw moderationContractError(
                'Only the original reporter can appeal this report.',
                'MODERATION_APPEAL_FORBIDDEN',
                403
            );
        }
        const fromStatus = String(report.state.status || '');
        if (!['resolved', 'dismissed'].includes(fromStatus) || report.appeal) {
            throw moderationContractError(
                'Only a resolved or dismissed report without an existing appeal can be appealed.',
                'MODERATION_APPEAL_INVALID',
                409
            );
        }
        const reason = boundedText(action.reason, MAX_REPORT_REASON_CHARS, {
            field: 'Appeal reason',
            minLength: MIN_REPORT_REASON_CHARS
        });
        const appeal = {
            appealId: `appeal_${sha256(`${report.reportId}\n${idempotencyKey}`).slice(0, 40)}`,
            status: 'pending',
            fromStatus,
            reason,
            createdAt: at,
            createdBy: actorUid,
            updatedAt: at,
            decidedAt: 0,
            decidedBy: '',
            decisionNote: ''
        };
        const state = {
            ...report.state,
            status: 'appealed',
            updatedAt: at,
            updatedBy: actorUid
        };
        const event = createAuditEntry({
            eventId,
            type,
            actorUid,
            at,
            previousHash: report.auditHead,
            details: {
                fromStatus,
                toStatus: 'appealed',
                appealId: appeal.appealId
            }
        });
        return appendAuditEvent({ ...report, state, appeal }, event);
    }

    if (type === 'appeal_decision') {
        if (report.state?.status !== 'appealed' || report.appeal?.status !== 'pending') {
            throw moderationContractError(
                'This report has no pending appeal.',
                'MODERATION_APPEAL_NOT_PENDING',
                409
            );
        }
        const decision = String(action.decision || '').trim().toLowerCase();
        if (decision !== 'accept' && decision !== 'deny') {
            throw moderationContractError(
                'Appeal decision must be accept or deny.',
                'MODERATION_APPEAL_DECISION_INVALID'
            );
        }
        const decisionNote = boundedText(action.note || '', 1200, {
            field: 'Appeal decision note'
        });
        const nextStatus = decision === 'accept'
            ? 'investigating'
            : report.appeal.fromStatus;
        const appeal = {
            ...report.appeal,
            status: decision === 'accept' ? 'accepted' : 'denied',
            updatedAt: at,
            decidedAt: at,
            decidedBy: actorUid,
            decisionNote
        };
        const state = {
            ...report.state,
            status: nextStatus,
            resolutionCode: decision === 'accept' ? '' : report.state.resolutionCode,
            resolutionNote: decision === 'accept' ? '' : report.state.resolutionNote,
            updatedAt: at,
            updatedBy: actorUid
        };
        const event = createAuditEntry({
            eventId,
            type,
            actorUid,
            at,
            previousHash: report.auditHead,
            details: {
                appealId: appeal.appealId,
                decision,
                fromStatus: 'appealed',
                toStatus: nextStatus
            }
        });
        return appendAuditEvent({ ...report, state, appeal }, event);
    }

    throw moderationContractError(
        'Moderation report action is invalid.',
        'MODERATION_REPORT_ACTION_INVALID'
    );
}

function integerSetting(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function normalizeBlockedTerms(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[,|\n]/);
    const terms = [];
    const seen = new Set();
    for (const rawTerm of source) {
        const term = String(rawTerm || '').normalize('NFKC').trim().toLowerCase().slice(0, 80);
        if (!term || seen.has(term)) continue;
        seen.add(term);
        terms.push(term);
        if (terms.length >= 80) break;
    }
    return terms;
}

function normalizeRoomModerationConfig(value = {}) {
    const config = objectValue(value);
    const blockedTermsSource = config.blockedTerms ?? config.blockedWords;
    return {
        policyVersion: MODERATION_POLICY_VERSION,
        enabled: config.enabled === true,
        enforceServer: config.enforceServer === true,
        blockedTerms: normalizeBlockedTerms(blockedTermsSource),
        blockLinks: config.blockLinks === true,
        blockCaps: config.blockCaps !== false,
        blockFlood: config.blockFlood !== false,
        maxMentions: integerSetting(config.maxMentions, 8, 0, 25),
        slowModeSeconds: integerSetting(config.slowModeSeconds, 0, 0, 21600),
        rateLimitCount: integerSetting(config.rateLimitCount, 0, 0, 100),
        rateLimitWindowSeconds: integerSetting(config.rateLimitWindowSeconds, 10, 1, 3600),
        repeatLimit: integerSetting(config.repeatLimit, 2, 1, 10),
        repeatWindowSeconds: integerSetting(config.repeatWindowSeconds, 60, 1, 3600)
    };
}

function normalizeModerationState(value = {}) {
    const state = objectValue(value);
    return {
        version: MODERATION_POLICY_VERSION,
        windowStartedAt: Math.max(0, Number(state.windowStartedAt) || 0),
        windowCount: Math.max(0, Math.floor(Number(state.windowCount) || 0)),
        lastAcceptedAt: Math.max(0, Number(state.lastAcceptedAt) || 0),
        lastMessageHash: String(state.lastMessageHash || ''),
        duplicateCount: Math.max(0, Math.floor(Number(state.duplicateCount) || 0)),
        lastReservationId: String(state.lastReservationId || ''),
        updatedAt: Math.max(0, Number(state.updatedAt) || 0)
    };
}

function messageModerationHash(text) {
    const normalized = String(text || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    return sha256(normalized);
}

function blockedModerationDecision(code, message, retryAfterSeconds = 0) {
    return {
        allowed: false,
        code,
        message,
        retryAfterSeconds: Math.max(0, Math.ceil(Number(retryAfterSeconds) || 0)),
        policyVersion: MODERATION_POLICY_VERSION,
        nextState: null
    };
}

function evaluateMessageModeration({
    text,
    config: configValue = {},
    state: stateValue = {},
    now = Date.now()
}) {
    const clean = String(text || '').normalize('NFKC').trim();
    if (clean.length > MAX_MESSAGE_TEXT_CHARS) {
        return blockedModerationDecision(
            'message_too_long',
            `Messages can contain at most ${MAX_MESSAGE_TEXT_CHARS} characters.`
        );
    }

    const config = normalizeRoomModerationConfig(configValue);
    const state = normalizeModerationState(stateValue);
    const acceptedAt = Math.max(0, Number(now) || Date.now());
    if (!config.enabled || !clean) {
        return {
            allowed: true,
            code: null,
            message: '',
            retryAfterSeconds: 0,
            policyVersion: MODERATION_POLICY_VERSION,
            nextState: {
                ...state,
                updatedAt: acceptedAt
            }
        };
    }

    const lower = clean.toLowerCase();
    const matchedTerm = config.blockedTerms.find((term) => {
        const escaped = term.replace(REGEXP_ESCAPE_PATTERN, '\\$&');
        return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'iu').test(lower);
    });
    if (matchedTerm) {
        return blockedModerationDecision(
            'blocked_term',
            'This message contains a term blocked by room policy.'
        );
    }
    if (config.blockLinks && LINK_PATTERN.test(clean)) {
        return blockedModerationDecision(
            'links_blocked',
            'Links are restricted in this room.'
        );
    }
    if (config.blockFlood && REPEATED_CHARACTER_PATTERN.test(clean.replace(/\s+/g, ''))) {
        return blockedModerationDecision(
            'character_flood',
            'Repeated-character flooding is restricted in this room.'
        );
    }

    const letters = clean.replace(/[^A-Za-z]/g, '');
    const uppercaseLetters = letters.replace(/[^A-Z]/g, '');
    if (
        config.blockCaps
        && letters.length >= 18
        && uppercaseLetters.length / letters.length > 0.82
    ) {
        return blockedModerationDecision(
            'excessive_caps',
            'This message contains excessive capital letters.'
        );
    }

    const mentionCount = [...clean.matchAll(MENTION_PATTERN)].length;
    if (config.maxMentions > 0 && mentionCount > config.maxMentions) {
        return blockedModerationDecision(
            'mention_limit',
            `This room allows at most ${config.maxMentions} mentions in one message.`
        );
    }

    if (config.slowModeSeconds > 0 && state.lastAcceptedAt > 0) {
        const nextAllowedAt = state.lastAcceptedAt + (config.slowModeSeconds * 1000);
        if (acceptedAt < nextAllowedAt) {
            return blockedModerationDecision(
                'slow_mode',
                'Slow mode is active in this room.',
                (nextAllowedAt - acceptedAt) / 1000
            );
        }
    }

    const windowMs = config.rateLimitWindowSeconds * 1000;
    const insideWindow = state.windowStartedAt > 0 && acceptedAt - state.windowStartedAt < windowMs;
    const windowStartedAt = insideWindow ? state.windowStartedAt : acceptedAt;
    const windowCount = insideWindow ? state.windowCount : 0;
    if (config.rateLimitCount > 0 && windowCount >= config.rateLimitCount) {
        return blockedModerationDecision(
            'rate_limit',
            'Too many messages were sent in a short period.',
            (windowStartedAt + windowMs - acceptedAt) / 1000
        );
    }

    const hash = messageModerationHash(clean);
    const duplicateInsideWindow = (
        state.lastMessageHash === hash
        && state.lastAcceptedAt > 0
        && acceptedAt - state.lastAcceptedAt < (config.repeatWindowSeconds * 1000)
    );
    const duplicateCount = duplicateInsideWindow ? state.duplicateCount + 1 : 1;
    if (duplicateInsideWindow && duplicateCount > config.repeatLimit) {
        return blockedModerationDecision(
            'repeated_message',
            'Repeated duplicate messages are restricted in this room.',
            Math.max(
                1,
                (state.lastAcceptedAt + (config.repeatWindowSeconds * 1000) - acceptedAt) / 1000
            )
        );
    }

    return {
        allowed: true,
        code: null,
        message: '',
        retryAfterSeconds: 0,
        policyVersion: MODERATION_POLICY_VERSION,
        nextState: {
            version: MODERATION_POLICY_VERSION,
            windowStartedAt,
            windowCount: windowCount + 1,
            lastAcceptedAt: acceptedAt,
            lastMessageHash: hash,
            duplicateCount,
            lastReservationId: state.lastReservationId,
            updatedAt: acceptedAt
        }
    };
}

function sanitizeHttpsUrl(value, field) {
    const clean = boundedText(value || '', 2048, { field });
    if (!clean) return '';
    if (!/^https:\/\//i.test(clean)) {
        throw moderationContractError(
            `${field} must use HTTPS.`,
            'MODERATION_ATTACHMENT_URL_INVALID'
        );
    }
    return clean;
}

function sanitizeModeratedMessageInput(value = {}, identity = {}, now = Date.now()) {
    const input = objectValue(value);
    const uid = sanitizeModerationId(identity.uid, 'Sender ID', { maxLength: 128 });
    const text = boundedText(input.text || '', MAX_MESSAGE_TEXT_CHARS, {
        field: 'Message'
    });
    const attachedImage = sanitizeHttpsUrl(input.attachedImage || '', 'Image URL');
    const attachedFileValue = objectValue(input.attachedFile);
    let attachedFile = null;
    if (attachedFileValue.url) {
        attachedFile = {
            url: sanitizeHttpsUrl(attachedFileValue.url, 'File URL'),
            name: boundedText(attachedFileValue.name || 'File', 180, {
                field: 'File name',
                minLength: 1,
                collapseWhitespace: true
            }),
            type: boundedText(attachedFileValue.type || 'File', 120, {
                field: 'File type',
                minLength: 1,
                collapseWhitespace: true
            }),
            size: Math.max(0, Math.min(Number(attachedFileValue.size) || 0, 10 * 1024 * 1024 * 1024))
        };
        const textPreview = boundedText(attachedFileValue.textPreview || '', 5000, {
            field: 'File text preview'
        });
        if (textPreview) attachedFile.textPreview = textPreview;
        if (attachedFileValue.textPreviewTruncated === true) attachedFile.textPreviewTruncated = true;
    }
    if (!text && !attachedImage && !attachedFile) {
        throw moderationContractError(
            'A message must contain text or an attachment.',
            'MODERATION_MESSAGE_EMPTY'
        );
    }

    const message = {
        uid,
        name: boundedText(identity.name || 'Member', 160, {
            field: 'Sender name',
            minLength: 1,
            collapseWhitespace: true
        }),
        photoUrl: sanitizeHttpsUrl(identity.photoUrl || '', 'Sender photo URL'),
        text,
        attachedImage: attachedImage || null,
        attachedFile,
        timestamp: Math.max(0, Number(now) || Date.now()),
        tier: boundedText(identity.tier || 'free', 32, {
            field: 'Sender tier',
            minLength: 1,
            collapseWhitespace: true
        })
    };
    const reply = objectValue(input.replyTo);
    if (reply.id) {
        message.replyTo = {
            id: sanitizeModerationId(reply.id, 'Reply message ID')
        };
    }
    return message;
}

function applyServerReplyContext(messageValue, parentValue, {
    parentMessageId,
    roomId,
    channelId = 'general'
}) {
    const message = objectValue(messageValue);
    const parent = objectValue(parentValue);
    const cleanParentId = sanitizeModerationId(parentMessageId, 'Reply message ID');
    const cleanRoomId = sanitizeModerationId(roomId, 'Room ID');
    const cleanChannelId = sanitizeModerationId(channelId, 'Channel ID', { maxLength: 80 });
    const parentUid = sanitizeModerationId(parent.uid, 'Reply author ID', { maxLength: 128 });
    const threadRootId = parent.threadRootId
        ? sanitizeModerationId(parent.threadRootId, 'Thread root ID')
        : cleanParentId;
    const replyText = clippedText(parent.text || '', 1000);
    return {
        ...message,
        threadRootId,
        threadParentId: cleanParentId,
        replyTo: {
            id: cleanParentId,
            uid: parentUid,
            name: clippedText(parent.name, 160, {
                fallback: 'Member',
                collapseWhitespace: true
            }),
            text: replyText,
            roomId: cleanRoomId,
            channelId: cleanChannelId
        }
    };
}

function publicModerationDecision(decision, { serverEnforced = false } = {}) {
    return {
        allowed: decision?.allowed === true,
        code: decision?.code || null,
        message: String(decision?.message || ''),
        retryAfterSeconds: Math.max(0, Number(decision?.retryAfterSeconds) || 0),
        policyVersion: MODERATION_POLICY_VERSION,
        serverEnforced: serverEnforced === true
    };
}

module.exports = {
    MAX_MESSAGE_TEXT_CHARS,
    MODERATION_POLICY_VERSION,
    MODERATION_REPORT_VERSION,
    REPORT_CATEGORIES,
    REPORT_STATUSES,
    RESOLUTION_CODES,
    applyServerReplyContext,
    buildModerationEvidence,
    createModerationReport,
    evaluateMessageModeration,
    messageModerationHash,
    moderationAuditEventId,
    moderationContractError,
    moderationReportId,
    normalizeBlockedTerms,
    normalizeModerationState,
    normalizeRoomModerationConfig,
    publicModerationDecision,
    sanitizeModeratedMessageInput,
    sanitizeModerationId,
    sanitizeModerationIdempotencyKey,
    sanitizeModerationReportInput,
    sanitizeReportSubject,
    stableStringify,
    transitionModerationReport
};
