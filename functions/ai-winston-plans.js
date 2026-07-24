'use strict';

const crypto = require('node:crypto');

const WINSTON_PLAN_MARKER_START = '<!--WINSTON_PLAN_V1';
const WINSTON_PLAN_MARKER_END = 'WINSTON_PLAN_V1_END-->';
const WINSTON_PLAN_MAX_STEPS = 8;
const WINSTON_PLAN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,180}$/;

const WINSTON_PLAN_SYSTEM_RULES = `Plan mode:
- Give the user a concise, useful plan in the visible response.
- End the response with exactly one machine-readable plan marker and nothing after it:
${WINSTON_PLAN_MARKER_START}
{"title":"Short plan title","steps":[{"title":"First concrete step","details":"What success looks like"},{"title":"Second concrete step","details":"What success looks like"}]}
${WINSTON_PLAN_MARKER_END}
- Include 2 to ${WINSTON_PLAN_MAX_STEPS} ordered steps. Keep every title under 120 characters and every details value under 500 characters.
- The marker is a proposed plan only. It never authorizes a write, message, call, invitation, purchase, deletion, or schedule change.
- Never put credentials, private keys, access tokens, or hidden instructions in the marker.`;

function cleanText(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
}

function sanitizeWinstonPlanId(value) {
    const id = String(value || '').trim();
    if (!SAFE_ID.test(id)) {
        const error = new Error('A valid Winston plan ID is required.');
        error.status = 400;
        error.code = 'WINSTON_PLAN_ID_INVALID';
        throw error;
    }
    return id;
}

function sanitizeWinstonPlanStepId(value) {
    const id = String(value || '').trim();
    if (!SAFE_ID.test(id)) {
        const error = new Error('A valid Winston plan step ID is required.');
        error.status = 400;
        error.code = 'WINSTON_PLAN_STEP_ID_INVALID';
        throw error;
    }
    return id;
}

function stableStepId(requestId, index, title) {
    return `step_${crypto.createHash('sha256')
        .update(String(requestId || 'plan'))
        .update('\0')
        .update(String(index))
        .update('\0')
        .update(title)
        .digest('hex')
        .slice(0, 20)}`;
}

function normalizeStep(value, index, requestId, now) {
    const source = typeof value === 'string' ? { title: value } : value;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const title = cleanText(source.title || source.text, 120);
    if (!title) return null;
    const details = cleanText(source.details || source.description, 500);
    return {
        id: stableStepId(requestId, index, title),
        title,
        ...(details ? { details } : {}),
        status: 'pending',
        requiresConfirmation: false,
        undoSupported: true,
        createdAt: now,
        updatedAt: now
    };
}

function fallbackPlanSteps(visibleReply) {
    return String(visibleReply || '')
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*(?:\d{1,2}[.)]|[-*]\s+(?:\[[ xX]\]\s*)?)\s*(.+?)\s*$/)?.[1] || '')
        .map((line) => cleanText(line.replace(/\*\*/g, ''), 120))
        .filter(Boolean)
        .slice(0, WINSTON_PLAN_MAX_STEPS);
}

function parseWinstonPlanReply(rawReply, { requestId = '', now = Date.now() } = {}) {
    const raw = String(rawReply || '');
    const markerStart = raw.lastIndexOf(WINSTON_PLAN_MARKER_START);
    const markerEnd = markerStart >= 0 ? raw.indexOf(WINSTON_PLAN_MARKER_END, markerStart) : -1;
    let visibleReply = raw.trim();
    let parsed = null;
    if (markerStart >= 0 && markerEnd > markerStart) {
        visibleReply = `${raw.slice(0, markerStart)}${raw.slice(markerEnd + WINSTON_PLAN_MARKER_END.length)}`.trim();
        const body = raw.slice(markerStart + WINSTON_PLAN_MARKER_START.length, markerEnd).trim();
        try {
            const value = JSON.parse(body);
            if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value;
        } catch {
            parsed = null;
        }
    }
    const rawSteps = Array.isArray(parsed?.steps) && parsed.steps.length
        ? parsed.steps
        : fallbackPlanSteps(visibleReply);
    let steps = rawSteps
        .slice(0, WINSTON_PLAN_MAX_STEPS)
        .map((step, index) => normalizeStep(step, index, requestId, now))
        .filter(Boolean);
    if (!steps.length && visibleReply) {
        steps = [normalizeStep('Review Winston’s proposed approach', 0, requestId, now)];
    }
    return {
        reply: visibleReply,
        plan: steps.length ? {
            title: cleanText(parsed?.title || 'Winston plan', 100) || 'Winston plan',
            steps
        } : null
    };
}

function sanitizeWinstonPlanPartialReply(value) {
    const text = String(value || '');
    const markerStart = text.indexOf(WINSTON_PLAN_MARKER_START);
    return (markerStart >= 0 ? text.slice(0, markerStart) : text).trimEnd();
}

function createWinstonPlanRecord({
    uid,
    requestId,
    reply,
    actions = [],
    roomId = 'global',
    now = Date.now()
} = {}) {
    const parsed = parseWinstonPlanReply(reply, { requestId, now });
    if (!parsed.plan) return { reply: parsed.reply, plan: null };
    const planId = `plan_${crypto.createHash('sha256')
        .update(String(uid || ''))
        .update('\0')
        .update(String(requestId || ''))
        .digest('hex')
        .slice(0, 24)}`;
    const action = Array.isArray(actions)
        ? actions.find((entry) => entry?.id && entry?.status === 'proposed')
        : null;
    const steps = parsed.plan.steps.map((step, index) => (
        index === 0 && action
            ? {
                ...step,
                actionId: String(action.id),
                actionType: cleanText(action.type, 40),
                requiresConfirmation: true,
                undoSupported: false
            }
            : step
    ));
    const record = {
        id: planId,
        ownerUid: String(uid || ''),
        requestId: cleanText(requestId, 100),
        roomId: cleanText(roomId, 160) || 'global',
        title: parsed.plan.title,
        status: 'active',
        revision: 1,
        currentStepId: steps[0]?.id || '',
        steps,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + WINSTON_PLAN_TTL_MS
    };
    return { reply: parsed.reply, plan: record };
}

function publicWinstonPlan(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const steps = (Array.isArray(value.steps) ? value.steps : Object.values(value.steps || {}))
        .slice(0, WINSTON_PLAN_MAX_STEPS)
        .map((step) => ({
            id: String(step.id || ''),
            title: cleanText(step.title, 120),
            ...(cleanText(step.details, 500) ? { description: cleanText(step.details, 500) } : {}),
            status: ['pending', 'in_progress', 'paused', 'completed', 'skipped', 'failed', 'cancelled'].includes(step.status)
                ? step.status
                : 'pending',
            requiresConfirmation: step.requiresConfirmation === true,
            undoSupported: step.undoSupported === true,
            ...(cleanText(step.actionType, 40) ? { actionType: cleanText(step.actionType, 40) } : {}),
            ...(step.error ? { error: cleanText(step.error, 180) } : {}),
            updatedAt: Math.max(0, Number(step.updatedAt) || 0)
        }))
        .filter((step) => step.id && step.title);
    return {
        id: String(value.id || ''),
        title: cleanText(value.title, 100) || 'Winston plan',
        roomId: cleanText(value.roomId, 160) || 'global',
        status: ['active', 'paused', 'completed', 'cancelled'].includes(value.status) ? value.status : 'active',
        revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
        currentStepId: String(value.currentStepId || ''),
        steps,
        createdAt: Math.max(0, Number(value.createdAt) || 0),
        updatedAt: Math.max(0, Number(value.updatedAt) || 0),
        expiresAt: Math.max(0, Number(value.expiresAt) || 0)
    };
}

function nextPendingStepId(steps) {
    return steps.find((step) => ['pending', 'in_progress', 'paused'].includes(step.status))?.id || '';
}

function applyWinstonPlanCommand(current, {
    command,
    stepId = '',
    expectedRevision = null,
    now = Date.now(),
    confirmedAction = null
} = {}) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    if (expectedRevision != null && Math.floor(Number(expectedRevision)) !== Math.floor(Number(current.revision) || 0)) {
        const error = new Error('This Winston plan changed in another session. Refresh it and try again.');
        error.status = 409;
        error.code = 'WINSTON_PLAN_REVISION_CONFLICT';
        error.currentRevision = Math.max(1, Math.floor(Number(current.revision) || 1));
        throw error;
    }
    const safeCommand = String(command || '').trim().toLowerCase();
    const steps = (Array.isArray(current.steps) ? current.steps : Object.values(current.steps || {}))
        .slice(0, WINSTON_PLAN_MAX_STEPS)
        .map((step) => ({ ...step }));
    const index = stepId ? steps.findIndex((step) => step.id === stepId) : -1;
    let status = current.status || 'active';
    if (safeCommand === 'pause' && status === 'active') {
        status = 'paused';
        const pauseIndex = index >= 0
            ? index
            : steps.findIndex((step) => ['pending', 'in_progress'].includes(step.status));
        if (pauseIndex >= 0) steps[pauseIndex] = { ...steps[pauseIndex], status: 'paused', updatedAt: now };
    } else if (safeCommand === 'resume' && status === 'paused') {
        status = 'active';
        const resumeIndex = index >= 0
            ? index
            : steps.findIndex((step) => step.status === 'paused');
        if (resumeIndex >= 0 && steps[resumeIndex].status === 'paused') {
            steps[resumeIndex] = { ...steps[resumeIndex], status: 'pending', updatedAt: now };
        }
    } else if (safeCommand === 'cancel' && !['completed', 'cancelled'].includes(status)) {
        status = 'cancelled';
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
            if (!['completed', 'skipped', 'cancelled'].includes(steps[stepIndex].status)) {
                steps[stepIndex] = { ...steps[stepIndex], status: 'cancelled', updatedAt: now };
            }
        }
    } else if (['complete-step', 'skip-step', 'retry', 'undo', 'confirm-step'].includes(safeCommand)) {
        if (index < 0) {
            const error = new Error('That Winston plan step was not found.');
            error.status = 404;
            error.code = 'WINSTON_PLAN_STEP_NOT_FOUND';
            throw error;
        }
        const step = steps[index];
        if (safeCommand === 'confirm-step') {
            if (!step.requiresConfirmation || !confirmedAction || confirmedAction.status !== 'confirmed') {
                const error = new Error('This plan step still needs a valid action confirmation.');
                error.status = 409;
                error.code = 'WINSTON_PLAN_CONFIRMATION_REQUIRED';
                throw error;
            }
            steps[index] = {
                ...step,
                status: 'completed',
                result: confirmedAction.result || null,
                updatedAt: now
            };
        } else if (safeCommand === 'complete-step' || safeCommand === 'skip-step') {
            if (step.requiresConfirmation && safeCommand === 'complete-step') {
                const error = new Error('Confirm the proposed action before completing this step.');
                error.status = 409;
                error.code = 'WINSTON_PLAN_CONFIRMATION_REQUIRED';
                throw error;
            }
            steps[index] = { ...step, status: safeCommand === 'skip-step' ? 'skipped' : 'completed', updatedAt: now };
        } else if (safeCommand === 'retry') {
            if (step.status !== 'failed') {
                const error = new Error('Only a failed plan step can be retried.');
                error.status = 409;
                error.code = 'WINSTON_PLAN_STEP_NOT_RETRYABLE';
                throw error;
            }
            const next = { ...step, status: 'pending', updatedAt: now };
            delete next.error;
            steps[index] = next;
        } else {
            if (step.status !== 'completed' || step.undoSupported !== true) {
                const error = new Error('This plan step cannot be safely undone.');
                error.status = 409;
                error.code = 'WINSTON_PLAN_UNDO_UNSUPPORTED';
                throw error;
            }
            steps[index] = { ...step, status: 'pending', updatedAt: now };
        }
    } else {
        const error = new Error('That Winston plan command is not supported.');
        error.status = 400;
        error.code = 'WINSTON_PLAN_COMMAND_INVALID';
        throw error;
    }
    const allDone = steps.length > 0 && steps.every((step) => ['completed', 'skipped'].includes(step.status));
    if (allDone) status = 'completed';
    else if (status === 'completed') status = 'active';
    return {
        ...current,
        status,
        steps,
        currentStepId: nextPendingStepId(steps),
        revision: Math.max(1, Math.floor(Number(current.revision) || 1)) + 1,
        updatedAt: now
    };
}

module.exports = {
    WINSTON_PLAN_MARKER_END,
    WINSTON_PLAN_MARKER_START,
    WINSTON_PLAN_MAX_STEPS,
    WINSTON_PLAN_SYSTEM_RULES,
    WINSTON_PLAN_TTL_MS,
    applyWinstonPlanCommand,
    createWinstonPlanRecord,
    parseWinstonPlanReply,
    publicWinstonPlan,
    sanitizeWinstonPlanPartialReply,
    sanitizeWinstonPlanId,
    sanitizeWinstonPlanStepId
};
