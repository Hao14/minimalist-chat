'use strict';

const AI_QUEUE_CAPACITY_STATE_VERSION = 1;

function positiveLimit(value, fallback) {
    return Math.max(1, Math.floor(Number(value) || fallback));
}

function normalizedAiQueueCapacityState(current, {
    now = Date.now(),
    globalLimit = 10000,
    perOwnerLimit = 1000
} = {}) {
    const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const safeGlobalLimit = positiveLimit(globalLimit, 10000);
    const safePerOwnerLimit = Math.min(
        safeGlobalLimit,
        positiveLimit(perOwnerLimit, 1000)
    );
    const rawReservations = current?.reservations && typeof current.reservations === 'object'
        ? current.reservations
        : {};
    const reservations = {};
    const ownerCounts = {};

    Object.entries(rawReservations).forEach(([jobId, reservation]) => {
        const ownerUid = String(reservation?.ownerUid || '').trim();
        const reservationId = String(reservation?.reservationId || '').trim();
        const payloadHash = String(reservation?.payloadHash || '').trim();
        const createdAt = Number(reservation?.createdAt);
        if (
            !/^[a-f0-9]{64}$/.test(jobId)
            || !ownerUid
            || !reservationId
            || !/^[a-f0-9]{64}$/.test(payloadHash)
            || !Number.isFinite(createdAt)
            || createdAt < 0
        ) {
            const error = new TypeError(`Malformed AI queue capacity reservation: ${String(jobId).slice(0, 80)}`);
            error.code = 'AI_QUEUE_CAPACITY_CORRUPT';
            throw error;
        }
        reservations[jobId] = { ownerUid, reservationId, payloadHash, createdAt };
        ownerCounts[ownerUid] = (ownerCounts[ownerUid] || 0) + 1;
    });

    return {
        version: AI_QUEUE_CAPACITY_STATE_VERSION,
        globalLimit: safeGlobalLimit,
        perOwnerLimit: safePerOwnerLimit,
        activeCount: Object.keys(reservations).length,
        ownerCounts,
        reservations,
        updatedAt: Number(current?.updatedAt) || safeNow
    };
}

function reserveAiQueueCapacityState(current, {
    jobId,
    ownerUid,
    reservationId,
    payloadHash,
    allowOverLimit = false,
    now = Date.now(),
    globalLimit = 10000,
    perOwnerLimit = 1000
} = {}) {
    const cleanJobId = String(jobId || '').trim();
    const cleanOwnerUid = String(ownerUid || '').trim();
    const cleanReservationId = String(reservationId || '').trim();
    const cleanPayloadHash = String(payloadHash || '').trim();
    if (
        !/^[a-f0-9]{64}$/.test(cleanJobId)
        || !cleanOwnerUid
        || !cleanReservationId
        || !/^[a-f0-9]{64}$/.test(cleanPayloadHash)
    ) {
        throw new TypeError('A valid jobId, ownerUid, reservationId, and payloadHash are required');
    }
    const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const state = normalizedAiQueueCapacityState(current, {
        now: safeNow,
        globalLimit,
        perOwnerLimit
    });
    const existing = state.reservations[cleanJobId];
    if (existing) {
        return existing.ownerUid === cleanOwnerUid
            && existing.reservationId === cleanReservationId
            && existing.payloadHash === cleanPayloadHash
            ? { state, accepted: true, reused: true, reason: '' }
            : { state, accepted: false, reused: false, reason: 'conflict' };
    }
    if (!allowOverLimit && state.activeCount >= state.globalLimit) {
        return { state, accepted: false, reused: false, reason: 'global_full' };
    }
    if (!allowOverLimit && Number(state.ownerCounts[cleanOwnerUid] || 0) >= state.perOwnerLimit) {
        return { state, accepted: false, reused: false, reason: 'owner_full' };
    }

    state.reservations[cleanJobId] = {
        ownerUid: cleanOwnerUid,
        reservationId: cleanReservationId,
        payloadHash: cleanPayloadHash,
        createdAt: safeNow
    };
    state.ownerCounts[cleanOwnerUid] = Number(state.ownerCounts[cleanOwnerUid] || 0) + 1;
    state.activeCount += 1;
    state.updatedAt = safeNow;
    return { state, accepted: true, reused: false, reason: '' };
}

function releaseAiQueueCapacityState(current, {
    jobId,
    ownerUid,
    reservationId,
    now = Date.now(),
    globalLimit = 10000,
    perOwnerLimit = 1000
} = {}) {
    const cleanJobId = String(jobId || '').trim();
    const cleanOwnerUid = String(ownerUid || '').trim();
    const cleanReservationId = String(reservationId || '').trim();
    if (!/^[a-f0-9]{64}$/.test(cleanJobId) || !cleanOwnerUid || !cleanReservationId) {
        throw new TypeError('A valid jobId, ownerUid, and reservationId are required');
    }
    const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const state = normalizedAiQueueCapacityState(current, {
        now: safeNow,
        globalLimit,
        perOwnerLimit
    });
    const existing = state.reservations[cleanJobId];
    if (!existing) return { state, released: false, conflict: false };
    if (
        existing.ownerUid !== cleanOwnerUid
        || existing.reservationId !== cleanReservationId
    ) return { state, released: false, conflict: true };

    delete state.reservations[cleanJobId];
    const ownerCount = Math.max(0, Number(state.ownerCounts[cleanOwnerUid] || 0) - 1);
    if (ownerCount) state.ownerCounts[cleanOwnerUid] = ownerCount;
    else delete state.ownerCounts[cleanOwnerUid];
    state.activeCount = Math.max(0, state.activeCount - 1);
    state.updatedAt = safeNow;
    return { state, released: true, conflict: false };
}

module.exports = {
    AI_QUEUE_CAPACITY_STATE_VERSION,
    normalizedAiQueueCapacityState,
    releaseAiQueueCapacityState,
    reserveAiQueueCapacityState
};
