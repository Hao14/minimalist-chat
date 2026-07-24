'use strict';

const crypto = require('node:crypto');

const FRIENDSHIP_ACTIONS = Object.freeze(['send', 'accept', 'remove']);
const FRIENDSHIP_STATUSES = Object.freeze(['pending', 'accepted']);

function friendshipError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function sanitizeFriendUid(value, field = 'targetUid') {
    const uid = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) {
        throw friendshipError(`A valid ${field} is required.`, 'FRIENDSHIP_TARGET_INVALID');
    }
    return uid;
}

function friendshipPairMembers(firstUid, secondUid) {
    const first = sanitizeFriendUid(firstUid, 'uid');
    const second = sanitizeFriendUid(secondUid, 'targetUid');
    if (first === second) {
        throw friendshipError('You cannot add yourself as a friend.', 'FRIENDSHIP_SELF_INVALID');
    }
    return [first, second].sort((left, right) => left.localeCompare(right, 'en'));
}

function friendshipPairId(firstUid, secondUid) {
    const members = friendshipPairMembers(firstUid, secondUid);
    return crypto.createHash('sha256').update(members[0]).update('\0').update(members[1]).digest('hex');
}

function friendshipPairFromProjections({ firstUid, secondUid, firstStatus, secondStatus, now = Date.now() } = {}) {
    const first = sanitizeFriendUid(firstUid, 'uid');
    const second = sanitizeFriendUid(secondUid, 'targetUid');
    const members = friendshipPairMembers(first, second);
    const left = String(firstStatus || '').trim();
    const right = String(secondStatus || '').trim();
    if (!left && !right) return null;
    const updatedAt = Math.max(1, Math.floor(Number(now) || Date.now()));
    if (left === 'accepted' && right === 'accepted') {
        return {
            members,
            requesterUid: members[0],
            addresseeUid: members[1],
            status: 'accepted',
            createdAt: updatedAt,
            acceptedAt: updatedAt,
            updatedAt,
            migratedFromProjections: true,
        };
    }
    if (left === 'pending_sent' && right === 'pending_received') {
        return {
            members,
            requesterUid: first,
            addresseeUid: second,
            status: 'pending',
            createdAt: updatedAt,
            updatedAt,
            migratedFromProjections: true,
        };
    }
    if (left === 'pending_received' && right === 'pending_sent') {
        return {
            members,
            requesterUid: second,
            addresseeUid: first,
            status: 'pending',
            createdAt: updatedAt,
            updatedAt,
            migratedFromProjections: true,
        };
    }
    throw friendshipError('The stored friendship projections are inconsistent.', 'FRIENDSHIP_STATE_INVALID', 409);
}

function validCurrentPair(current, members) {
    if (!current || typeof current !== 'object') return null;
    if (!FRIENDSHIP_STATUSES.includes(current.status)) {
        throw friendshipError('The stored friendship state is invalid.', 'FRIENDSHIP_STATE_INVALID', 409);
    }
    const storedMembers = Array.isArray(current.members) ? current.members.map(String).sort() : [];
    if (storedMembers.length !== 2 || storedMembers[0] !== members[0] || storedMembers[1] !== members[1]) {
        throw friendshipError('The stored friendship pair does not match this request.', 'FRIENDSHIP_STATE_INVALID', 409);
    }
    const requesterUid = sanitizeFriendUid(current.requesterUid, 'requesterUid');
    const addresseeUid = sanitizeFriendUid(current.addresseeUid, 'addresseeUid');
    if (
        requesterUid === addresseeUid
        || !members.includes(requesterUid)
        || !members.includes(addresseeUid)
    ) {
        throw friendshipError('The stored friendship participants are invalid.', 'FRIENDSHIP_STATE_INVALID', 409);
    }
    return { ...current, members, requesterUid, addresseeUid };
}

function transitionFriendshipPair(current, { action, actorUid, targetUid, now = Date.now() } = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!FRIENDSHIP_ACTIONS.includes(normalizedAction)) {
        throw friendshipError('Friendship action must be send, accept, or remove.', 'FRIENDSHIP_ACTION_INVALID');
    }
    const actor = sanitizeFriendUid(actorUid, 'uid');
    const target = sanitizeFriendUid(targetUid, 'targetUid');
    const members = friendshipPairMembers(actor, target);
    const updatedAt = Math.max(1, Math.floor(Number(now) || Date.now()));

    if (normalizedAction === 'remove') {
        return {
            action: normalizedAction,
            record: null,
            actorStatus: null,
            targetStatus: null,
            changed: Boolean(current),
        };
    }

    const stored = validCurrentPair(current, members);

    if (normalizedAction === 'send') {
        if (stored?.status === 'accepted') {
            return {
                action: normalizedAction,
                record: stored,
                actorStatus: 'accepted',
                targetStatus: 'accepted',
                changed: false,
            };
        }
        if (stored?.status === 'pending') {
            if (stored.requesterUid !== actor || stored.addresseeUid !== target) {
                throw friendshipError(
                    'This person already sent you a friend request. Accept or remove that request first.',
                    'FRIENDSHIP_REQUEST_ALREADY_RECEIVED',
                    409,
                );
            }
            return {
                action: normalizedAction,
                record: stored,
                actorStatus: 'pending_sent',
                targetStatus: 'pending_received',
                changed: false,
            };
        }
        return {
            action: normalizedAction,
            record: {
                members,
                requesterUid: actor,
                addresseeUid: target,
                status: 'pending',
                createdAt: updatedAt,
                updatedAt,
            },
            actorStatus: 'pending_sent',
            targetStatus: 'pending_received',
            changed: true,
        };
    }

    if (!stored) {
        throw friendshipError('No incoming friend request was found.', 'FRIENDSHIP_REQUEST_NOT_FOUND', 404);
    }
    if (stored.status === 'accepted') {
        return {
            action: normalizedAction,
            record: stored,
            actorStatus: 'accepted',
            targetStatus: 'accepted',
            changed: false,
        };
    }
    if (stored.requesterUid !== target || stored.addresseeUid !== actor) {
        throw friendshipError('Only the recipient can accept this friend request.', 'FRIENDSHIP_ACCEPT_FORBIDDEN', 403);
    }
    return {
        action: normalizedAction,
        record: {
            ...stored,
            status: 'accepted',
            acceptedAt: updatedAt,
            updatedAt,
        },
        actorStatus: 'accepted',
        targetStatus: 'accepted',
        changed: true,
    };
}

module.exports = {
    FRIENDSHIP_ACTIONS,
    FRIENDSHIP_STATUSES,
    friendshipPairId,
    friendshipPairFromProjections,
    friendshipPairMembers,
    sanitizeFriendUid,
    transitionFriendshipPair,
};
