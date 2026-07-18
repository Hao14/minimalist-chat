'use strict';

const crypto = require('node:crypto');

const AI_QUEUE_STATE_VERSION = 1;
const AI_QUEUE_FAR_FUTURE_MS = 8_000_000_000_000_000;
const DEFAULT_AI_QUEUE_RETRY_BASE_DELAY_MS = 2000;
const DEFAULT_AI_QUEUE_RETRY_MAX_DELAY_MS = 30000;

function safeQueueNow(now = Date.now()) {
    return Number.isFinite(Number(now)) ? Number(now) : Date.now();
}

function normalizedAiQueueExcludedProviders(providers) {
    const values = providers instanceof Set
        ? [...providers]
        : Array.isArray(providers)
            ? providers
            : providers == null
                ? []
                : [providers];
    return [...new Set(values
        .map((provider) => String(provider || '').trim().slice(0, 80))
        .filter(Boolean))]
        .slice(0, 16);
}

function aiQueueRetryDelayMs({
    attempts = 1,
    error,
    retryAfterMs = 0,
    baseDelayMs = DEFAULT_AI_QUEUE_RETRY_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_AI_QUEUE_RETRY_MAX_DELAY_MS
} = {}) {
    const safeAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
    const safeBase = Math.max(0, Math.floor(Number(baseDelayMs) || 0));
    const safeMax = Math.max(safeBase, Math.floor(Number(maxDelayMs) || 0));
    const requestedDelay = Math.max(
        0,
        Math.floor(Number(retryAfterMs) || 0),
        Math.floor(Number(error?.retryAfterMs) || 0),
        Math.floor(Number(error?.retryAfterSeconds) || 0) * 1000
    );
    const exponent = Math.min(30, safeAttempts - 1);
    const exponentialDelay = safeBase * (2 ** exponent);
    return Math.min(safeMax, Math.max(exponentialDelay, requestedDelay));
}

function aiQueueJobReadiness(current, { now = Date.now() } = {}) {
    const safeNow = safeQueueNow(now);
    const retryNotBefore = Math.max(0, Number(current?.retryNotBefore || 0));
    const excludedProviders = normalizedAiQueueExcludedProviders(current?.excludedProviders);
    if (!current || current.status !== 'queued') {
        return {
            ready: false,
            reason: current ? 'not-queued' : 'missing',
            retryNotBefore,
            waitMs: 0,
            excludedProviders
        };
    }
    if (retryNotBefore > safeNow) {
        return {
            ready: false,
            reason: 'retry-backoff',
            retryNotBefore,
            waitMs: retryNotBefore - safeNow,
            excludedProviders
        };
    }
    return {
        ready: true,
        reason: 'ready',
        retryNotBefore,
        waitMs: 0,
        excludedProviders
    };
}

function retryMetadata(current, {
    error,
    now,
    retryAfterMs,
    retryBaseDelayMs,
    retryMaxDelayMs
} = {}) {
    const safeNow = safeQueueNow(now);
    const retryDelayMs = aiQueueRetryDelayMs({
        attempts: current?.attempts,
        error,
        retryAfterMs,
        baseDelayMs: retryBaseDelayMs,
        maxDelayMs: retryMaxDelayMs
    });
    return {
        excludedProviders: normalizedAiQueueExcludedProviders([
            ...normalizedAiQueueExcludedProviders(current?.excludedProviders),
            current?.provider
        ]),
        retryScheduledAt: safeNow,
        retryDelayMs,
        retryNotBefore: safeNow + retryDelayMs
    };
}

function clearRetryMetadata(job, { clearExcludedProviders = false } = {}) {
    delete job.retryScheduledAt;
    delete job.retryDelayMs;
    delete job.retryNotBefore;
    if (clearExcludedProviders) delete job.excludedProviders;
    return job;
}

function aiQueueJobId(uid, requestId) {
    const cleanUid = String(uid || '').trim();
    const cleanRequestId = String(requestId || '').trim();
    if (!cleanUid || !cleanRequestId) throw new TypeError('uid and requestId are required');
    return crypto.createHash('sha256')
        .update(cleanUid)
        .update('\0')
        .update(cleanRequestId)
        .digest('hex');
}

function createAiQueueJob({
    jobId,
    queueKey,
    ownerUid,
    requestId,
    payloadHash,
    payload,
    bananas,
    reservationId,
    excludedProviders = [],
    retryNotBefore = 0,
    now = Date.now()
} = {}) {
    const safeNow = safeQueueNow(now);
    if (!jobId || !queueKey || !ownerUid || !requestId || !payloadHash || !payload) {
        throw new TypeError('jobId, queueKey, ownerUid, requestId, payloadHash, and payload are required');
    }
    const initialExcludedProviders = normalizedAiQueueExcludedProviders(excludedProviders);
    const safeRetryNotBefore = Math.max(0, Number(retryNotBefore || 0));
    const job = {
        version: AI_QUEUE_STATE_VERSION,
        jobId: String(jobId),
        queueKey: String(queueKey),
        ownerUid: String(ownerUid),
        requestId: String(requestId),
        payloadHash: String(payloadHash),
        status: 'queued',
        revision: 1,
        attempts: initialExcludedProviders.length ? 1 : 0,
        payload,
        bananas: bananas || {},
        ...(reservationId ? { reservationId: String(reservationId) } : {}),
        createdAt: safeNow,
        updatedAt: safeNow,
        // Capacity waiting has no wall-clock expiry. Terminal records use
        // deleteAfter for their separate, bounded result-retention window.
        expiresAt: AI_QUEUE_FAR_FUTURE_MS,
        claimExpiresAt: AI_QUEUE_FAR_FUTURE_MS,
        deleteAfter: AI_QUEUE_FAR_FUTURE_MS,
        pointerPending: true,
        statusProjectionPending: true,
        capacityReleasePending: false
    };
    if (initialExcludedProviders.length) job.excludedProviders = initialExcludedProviders;
    if (safeRetryNotBefore > safeNow) {
        job.retryScheduledAt = safeNow;
        job.retryDelayMs = safeRetryNotBefore - safeNow;
        job.retryNotBefore = safeRetryNotBefore;
    }
    return job;
}

function claimAiQueueJob(current, {
    claimId,
    provider,
    now = Date.now(),
    claimTtlMs = 180000
} = {}) {
    const cleanProvider = String(provider || '').trim();
    const readiness = aiQueueJobReadiness(current, { now });
    if (
        !readiness.ready
        || !claimId
        || !cleanProvider
        || readiness.excludedProviders.includes(cleanProvider)
    ) return null;
    const safeNow = safeQueueNow(now);
    const safeTtl = Math.max(30000, Math.floor(Number(claimTtlMs) || 180000));
    const job = {
        ...current,
        status: 'running',
        revision: Math.max(1, Math.floor(Number(current.revision) || 1)) + 1,
        attempts: Math.max(0, Math.floor(Number(current.attempts) || 0)) + 1,
        claimId: String(claimId),
        provider: cleanProvider,
        claimedAt: safeNow,
        claimExpiresAt: safeNow + safeTtl,
        updatedAt: safeNow,
        pointerPending: false,
        statusProjectionPending: true
    };
    return clearRetryMetadata(job);
}

function requeueExpiredAiQueueJob(current, {
    now = Date.now(),
    maxAttempts = 3,
    terminalRetentionMs = 24 * 60 * 60 * 1000,
    retryAfterMs = 0,
    retryBaseDelayMs = DEFAULT_AI_QUEUE_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs = DEFAULT_AI_QUEUE_RETRY_MAX_DELAY_MS
} = {}) {
    const safeNow = safeQueueNow(now);
    if (
        !current
        || current.status !== 'running'
        || Number(current.claimExpiresAt || AI_QUEUE_FAR_FUTURE_MS) > safeNow
    ) return { action: 'unchanged', job: current || null };

    if (Math.max(0, Math.floor(Number(current.attempts) || 0)) >= Math.max(1, Number(maxAttempts) || 3)) {
        const job = { ...current };
        delete job.payload;
        delete job.claimId;
        delete job.claimedAt;
        delete job.pointerPending;
        clearRetryMetadata(job, { clearExcludedProviders: true });
        job.status = 'failed';
        job.revision = Math.max(1, Math.floor(Number(current.revision) || 1)) + 1;
        job.error = {
            code: 'AI_QUEUE_RETRY_EXHAUSTED',
            message: 'The queued AI request could not be recovered after several worker interruptions.'
        };
        job.refundPending = true;
        job.capacityReleasePending = Boolean(job.reservationId);
        job.claimExpiresAt = AI_QUEUE_FAR_FUTURE_MS;
        job.expiresAt = AI_QUEUE_FAR_FUTURE_MS;
        job.finishedAt = safeNow;
        job.updatedAt = safeNow;
        job.deleteAfter = safeNow + Math.max(60000, Number(terminalRetentionMs) || 0);
        job.statusProjectionPending = true;
        return { action: 'failed', job };
    }

    const job = { ...current };
    delete job.claimId;
    delete job.claimedAt;
    delete job.provider;
    delete job.lastError;
    job.status = 'queued';
    job.revision = Math.max(1, Math.floor(Number(current.revision) || 1)) + 1;
    job.claimExpiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.updatedAt = safeNow;
    job.pointerPending = true;
    job.statusProjectionPending = true;
    Object.assign(job, retryMetadata(current, {
        now: safeNow,
        retryAfterMs,
        retryBaseDelayMs,
        retryMaxDelayMs
    }));
    return { action: 'requeued', job };
}

function retryAiQueueJob(current, {
    claimId,
    error,
    now = Date.now(),
    maxAttempts = 3,
    retryAfterMs = 0,
    retryBaseDelayMs = DEFAULT_AI_QUEUE_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs = DEFAULT_AI_QUEUE_RETRY_MAX_DELAY_MS
} = {}) {
    if (
        !current
        || current.status !== 'running'
        || current.claimId !== claimId
        || Math.max(0, Math.floor(Number(current.attempts) || 0)) >= Math.max(1, Number(maxAttempts) || 3)
    ) return null;
    const safeNow = safeQueueNow(now);
    const job = { ...current };
    delete job.claimId;
    delete job.claimedAt;
    delete job.provider;
    job.status = 'queued';
    job.revision = Math.max(1, Math.floor(Number(current.revision) || 1)) + 1;
    job.lastError = {
        code: String(error?.code || 'AI_QUEUE_RETRYABLE_ERROR').slice(0, 100),
        message: String(error?.message || 'The provider was temporarily unavailable.').slice(0, 300)
    };
    job.claimExpiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.expiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.updatedAt = safeNow;
    job.pointerPending = true;
    job.statusProjectionPending = true;
    Object.assign(job, retryMetadata(current, {
        error,
        now: safeNow,
        retryAfterMs,
        retryBaseDelayMs,
        retryMaxDelayMs
    }));
    return job;
}

function completeAiQueueJob(current, {
    claimId,
    result,
    now = Date.now(),
    terminalRetentionMs = 24 * 60 * 60 * 1000
} = {}) {
    if (!current || current.status !== 'running' || current.claimId !== claimId || !result) return null;
    const safeNow = safeQueueNow(now);
    const job = { ...current };
    delete job.payload;
    delete job.claimId;
    delete job.claimedAt;
    delete job.error;
    delete job.lastError;
    delete job.pointerPending;
    clearRetryMetadata(job, { clearExcludedProviders: true });
    job.status = 'completed';
    job.revision = Math.max(1, Math.floor(Number(current.revision) || 1)) + 1;
    job.result = result;
    job.claimExpiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.expiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.finishedAt = safeNow;
    job.updatedAt = safeNow;
    job.deleteAfter = safeNow + Math.max(60000, Number(terminalRetentionMs) || 0);
    job.statusProjectionPending = true;
    job.capacityReleasePending = Boolean(job.reservationId);
    return job;
}

function failAiQueueJob(current, {
    claimId,
    error,
    now = Date.now(),
    terminalRetentionMs = 24 * 60 * 60 * 1000
} = {}) {
    if (!current || current.status !== 'running' || current.claimId !== claimId) return null;
    const safeNow = safeQueueNow(now);
    const job = { ...current };
    delete job.payload;
    delete job.claimId;
    delete job.claimedAt;
    delete job.result;
    delete job.lastError;
    delete job.pointerPending;
    clearRetryMetadata(job, { clearExcludedProviders: true });
    job.status = 'failed';
    job.revision = Math.max(1, Math.floor(Number(current.revision) || 1)) + 1;
    job.error = {
        code: String(error?.code || 'AI_QUEUE_JOB_FAILED').slice(0, 100),
        message: String(error?.message || 'The queued AI request failed.').slice(0, 300)
    };
    job.refundPending = true;
    job.capacityReleasePending = Boolean(job.reservationId);
    job.claimExpiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.expiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.finishedAt = safeNow;
    job.updatedAt = safeNow;
    job.deleteAfter = safeNow + Math.max(60000, Number(terminalRetentionMs) || 0);
    job.statusProjectionPending = true;
    return job;
}

function failQueuedAiQueueJob(current, {
    error,
    now = Date.now(),
    terminalRetentionMs = 24 * 60 * 60 * 1000
} = {}) {
    if (!current || current.status !== 'queued') return null;
    const safeNow = safeQueueNow(now);
    const job = { ...current };
    delete job.payload;
    delete job.result;
    delete job.lastError;
    delete job.pointerPending;
    clearRetryMetadata(job, { clearExcludedProviders: true });
    job.status = 'failed';
    job.revision = Math.max(1, Math.floor(Number(current.revision) || 1)) + 1;
    job.error = {
        code: String(error?.code || 'AI_QUEUE_JOB_FAILED').slice(0, 100),
        message: String(error?.message || 'The queued AI request failed.').slice(0, 300)
    };
    job.refundPending = true;
    job.capacityReleasePending = Boolean(job.reservationId);
    job.claimExpiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.expiresAt = AI_QUEUE_FAR_FUTURE_MS;
    job.finishedAt = safeNow;
    job.updatedAt = safeNow;
    job.deleteAfter = safeNow + Math.max(60000, Number(terminalRetentionMs) || 0);
    job.statusProjectionPending = true;
    return job;
}

module.exports = {
    AI_QUEUE_FAR_FUTURE_MS,
    AI_QUEUE_STATE_VERSION,
    DEFAULT_AI_QUEUE_RETRY_BASE_DELAY_MS,
    DEFAULT_AI_QUEUE_RETRY_MAX_DELAY_MS,
    aiQueueJobReadiness,
    aiQueueJobId,
    aiQueueRetryDelayMs,
    claimAiQueueJob,
    completeAiQueueJob,
    createAiQueueJob,
    failAiQueueJob,
    failQueuedAiQueueJob,
    normalizedAiQueueExcludedProviders,
    requeueExpiredAiQueueJob,
    retryAiQueueJob
};
