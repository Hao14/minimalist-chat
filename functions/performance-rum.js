'use strict';

const crypto = require('node:crypto');

const RUM_SCHEMA_VERSION = 1;
const RUM_STORAGE_ROOT = 'performance_rum/v1';
const MAX_PAYLOAD_BYTES = 4096;
const MAX_METRICS_PER_BATCH = 7;
const MAX_ACTIVE_RELEASES = 8;
const DEFAULT_MINIMUM_GATE_SAMPLES = 75;
const DEFAULT_HOURLY_ADMISSION_LIMIT = 50000;

const METRIC_SPECS = Object.freeze({
    lcp: Object.freeze({
        unit: 'ms',
        min: 0,
        max: 60000,
        precision: 0,
        threshold: 2500,
        bounds: Object.freeze([100, 200, 400, 800, 1200, 1800, 2500, 4000, 6000, 10000, 20000, 60000])
    }),
    inp: Object.freeze({
        unit: 'ms',
        min: 0,
        max: 60000,
        precision: 0,
        threshold: 200,
        bounds: Object.freeze([40, 80, 120, 160, 200, 300, 500, 800, 1200, 2500, 5000, 10000, 60000])
    }),
    cls: Object.freeze({
        unit: 'score',
        min: 0,
        max: 5,
        precision: 4,
        threshold: 0.1,
        bounds: Object.freeze([0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2, 5])
    }),
    chat_ready: Object.freeze({
        unit: 'ms',
        min: 0,
        max: 120000,
        precision: 0,
        bounds: Object.freeze([250, 500, 750, 1000, 1500, 2000, 2500, 4000, 6000, 10000, 20000, 60000, 120000])
    }),
    long_task_total: Object.freeze({
        unit: 'ms',
        min: 0,
        max: 600000,
        precision: 0,
        bounds: Object.freeze([50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 180000, 600000])
    }),
    long_task_max: Object.freeze({
        unit: 'ms',
        min: 0,
        max: 120000,
        precision: 0,
        bounds: Object.freeze([50, 75, 100, 150, 250, 500, 1000, 2500, 5000, 10000, 30000, 120000])
    }),
    long_task_count: Object.freeze({
        unit: 'count',
        min: 0,
        max: 10000,
        precision: 0,
        integer: true,
        bounds: Object.freeze([0, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 10000])
    })
});

const DEVICE_CLASSES = new Set(['mobile', 'desktop']);
const MEMORY_TIERS = new Set(['low', 'mid', 'high', 'unknown']);
const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'release', 'deviceClass', 'memoryTier', 'metrics']);
const RELEASE_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function roundedMetricValue(value, precision) {
    const scale = 10 ** precision;
    return Math.round(value * scale) / scale;
}

function normalizeMetricValue(name, value) {
    const spec = METRIC_SPECS[name];
    const number = Number(value);
    if (!spec || !Number.isFinite(number) || number < spec.min || number > spec.max) {
        throw httpError(400, 'invalid_metric', `Invalid ${name || 'performance'} metric.`);
    }
    if (spec.integer && !Number.isInteger(number)) {
        throw httpError(400, 'invalid_metric', `${name} must be an integer.`);
    }
    return roundedMetricValue(number, spec.precision);
}

function normalizePerformanceBatch(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw httpError(400, 'invalid_payload', 'Performance payload must be an object.');
    }

    const unknownKey = Object.keys(value).find((key) => !TOP_LEVEL_KEYS.has(key));
    if (unknownKey) throw httpError(400, 'invalid_payload', 'Performance payload contains an unsupported field.');
    if (value.schemaVersion !== RUM_SCHEMA_VERSION) {
        throw httpError(400, 'invalid_schema', 'Unsupported performance schema.');
    }

    const release = String(value.release || '').trim();
    if (!RELEASE_PATTERN.test(release)) {
        throw httpError(400, 'invalid_release', 'Performance release is invalid.');
    }

    const deviceClass = String(value.deviceClass || '').trim().toLowerCase();
    if (!DEVICE_CLASSES.has(deviceClass)) {
        throw httpError(400, 'invalid_device_class', 'Performance device class is invalid.');
    }

    const memoryTier = String(value.memoryTier || '').trim().toLowerCase();
    if (!MEMORY_TIERS.has(memoryTier)) {
        throw httpError(400, 'invalid_memory_tier', 'Performance memory tier is invalid.');
    }

    if (!value.metrics || typeof value.metrics !== 'object' || Array.isArray(value.metrics)) {
        throw httpError(400, 'invalid_metrics', 'Performance metrics must be an object.');
    }

    const entries = Object.entries(value.metrics);
    if (!entries.length || entries.length > MAX_METRICS_PER_BATCH) {
        throw httpError(400, 'invalid_metrics', 'Performance metrics batch is empty or too large.');
    }

    const metrics = {};
    for (const [name, metricValue] of entries) {
        if (!Object.hasOwn(METRIC_SPECS, name)) {
            throw httpError(400, 'invalid_metric', 'Performance metric name is invalid.');
        }
        metrics[name] = normalizeMetricValue(name, metricValue);
    }

    return Object.freeze({
        schemaVersion: RUM_SCHEMA_VERSION,
        release,
        deviceClass,
        memoryTier,
        metrics: Object.freeze(metrics)
    });
}

function releaseStorageKey(release) {
    return Buffer.from(release, 'utf8').toString('base64url');
}

function utcDay(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}

function utcHour(now = Date.now()) {
    return new Date(now).toISOString().slice(11, 13);
}

function activeRumReleases(env = process.env) {
    const configured = Array.from(new Set(String(env.PERFORMANCE_RUM_ACTIVE_RELEASES || '')
        .split(/[\s,]+/)
        .map((release) => release.trim())
        .filter(Boolean)));
    if (!configured.length) {
        throw httpError(
            503,
            'active_releases_not_configured',
            'Performance collection has no active release allowlist.'
        );
    }
    if (configured.length > MAX_ACTIVE_RELEASES) {
        throw httpError(
            500,
            'too_many_active_releases',
            'Performance collection has too many active releases configured.'
        );
    }
    if (configured.some((release) => !RELEASE_PATTERN.test(release))) {
        throw httpError(
            500,
            'invalid_active_release_config',
            'Performance collection active release configuration is invalid.'
        );
    }
    return new Set(configured);
}

function requireActiveRumRelease(release, env = process.env) {
    if (!activeRumReleases(env).has(release)) {
        throw httpError(403, 'inactive_release', 'Performance release is not active.');
    }
}

function hourlyAdmissionLimit(env = process.env) {
    const configured = Math.floor(Number(env.PERFORMANCE_RUM_HOURLY_LIMIT));
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_HOURLY_ADMISSION_LIMIT;
    return Math.min(1000000, configured);
}

async function consumeDurableAdmission({
    admin,
    release,
    now = Date.now(),
    limit = DEFAULT_HOURLY_ADMISSION_LIMIT
}) {
    const path = `${RUM_STORAGE_ROOT}/admission/days/${utcDay(now)}`
        + `/releases/${releaseStorageKey(release)}/hours/${utcHour(now)}`;
    const transaction = await admin.database().ref(path).transaction((current) => {
        const count = Math.max(0, Math.floor(Number(current) || 0));
        if (count >= limit) return undefined;
        return count + 1;
    }, undefined, false);
    if (!transaction.committed) {
        throw httpError(429, 'hourly_admission_exhausted', 'Performance collection is temporarily rate limited.');
    }
    return path;
}

function metricBucketKey(name, value) {
    const spec = METRIC_SPECS[name];
    const index = spec.bounds.findIndex((bound) => value <= bound);
    const boundedIndex = index < 0 ? spec.bounds.length - 1 : index;
    return `b${String(boundedIndex).padStart(2, '0')}`;
}

function incrementValue(ServerValue, amount) {
    if (ServerValue?.increment) return ServerValue.increment(amount);
    return { '.sv': { increment: amount } };
}

function buildAggregateUpdates(batch, now, ServerValue) {
    const day = utcDay(now);
    const releaseKey = releaseStorageKey(batch.release);
    const releaseRoot = `${RUM_STORAGE_ROOT}/days/${day}/releases/${releaseKey}`;
    const deviceRoot = `${releaseRoot}/devices/${batch.deviceClass}`;
    const updates = {
        [`${releaseRoot}/release`]: batch.release,
        [`${releaseRoot}/schemaVersion`]: RUM_SCHEMA_VERSION,
        [`${releaseRoot}/updatedAt`]: ServerValue?.TIMESTAMP || { '.sv': 'timestamp' },
        [`${deviceRoot}/batches`]: incrementValue(ServerValue, 1),
        [`${deviceRoot}/memoryTiers/${batch.memoryTier}`]: incrementValue(ServerValue, 1)
    };

    for (const [name, value] of Object.entries(batch.metrics)) {
        const metricRoot = `${deviceRoot}/metrics/${name}`;
        updates[`${metricRoot}/count`] = incrementValue(ServerValue, 1);
        updates[`${metricRoot}/sum`] = incrementValue(ServerValue, value);
        updates[`${metricRoot}/bins/${metricBucketKey(name, value)}`] = incrementValue(ServerValue, 1);
    }

    return { day, releaseKey, updates };
}

function percentileFromHistogram(name, metric, percentile = 0.75) {
    const spec = METRIC_SPECS[name];
    const bins = metric?.bins && typeof metric.bins === 'object' ? metric.bins : {};
    const counts = spec.bounds.map((_bound, index) => (
        Math.max(0, Math.floor(Number(bins[`b${String(index).padStart(2, '0')}`]) || 0))
    ));
    const histogramCount = counts.reduce((sum, count) => sum + count, 0);
    const count = Math.max(histogramCount, Math.floor(Number(metric?.count) || 0));
    if (!count || !histogramCount) return null;

    const target = Math.max(1, Math.ceil(histogramCount * percentile));
    let cumulative = 0;
    for (let index = 0; index < counts.length; index += 1) {
        cumulative += counts[index];
        if (cumulative >= target) return spec.bounds[index];
    }
    return spec.bounds.at(-1);
}

function summarizeDevice(device, minimumSamples) {
    const source = device && typeof device === 'object' ? device : {};
    const metrics = {};

    for (const [name, spec] of Object.entries(METRIC_SPECS)) {
        const metric = source.metrics?.[name];
        const count = Math.max(0, Math.floor(Number(metric?.count) || 0));
        const sum = Number(metric?.sum) || 0;
        const p75 = percentileFromHistogram(name, metric);
        metrics[name] = {
            count,
            p75,
            mean: count ? roundedMetricValue(sum / count, spec.precision) : null,
            unit: spec.unit,
            approximate: p75 !== null
        };
    }

    const memoryTiers = Object.fromEntries(
        Array.from(MEMORY_TIERS, (tier) => [
            tier,
            Math.max(0, Math.floor(Number(source.memoryTiers?.[tier]) || 0))
        ])
    );

    return {
        batches: Math.max(0, Math.floor(Number(source.batches) || 0)),
        minimumSamples,
        memoryTiers,
        metrics
    };
}

function summarizeReleaseSnapshot(snapshot, {
    day,
    release,
    minimumSamples = DEFAULT_MINIMUM_GATE_SAMPLES,
    generatedAt = Date.now()
} = {}) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const devices = {
        mobile: summarizeDevice(source.devices?.mobile, minimumSamples),
        desktop: summarizeDevice(source.devices?.desktop, minimumSamples)
    };
    const thresholds = Object.fromEntries(
        Object.entries(METRIC_SPECS)
            .filter(([, spec]) => Number.isFinite(spec.threshold))
            .map(([name, spec]) => [name, spec.threshold])
    );
    const checks = [];

    for (const [deviceClass, device] of Object.entries(devices)) {
        for (const [metric, threshold] of Object.entries(thresholds)) {
            const result = device.metrics[metric];
            const status = result.count < minimumSamples || result.p75 === null
                ? 'insufficient'
                : result.p75 <= threshold ? 'pass' : 'fail';
            checks.push({
                deviceClass,
                metric,
                count: result.count,
                p75: result.p75,
                threshold,
                status
            });
        }
    }

    return {
        schemaVersion: RUM_SCHEMA_VERSION,
        format: 'minimalist-rum-p75-v1',
        day,
        release: release || source.release || '',
        generatedAt,
        percentile: 75,
        devices,
        gate: {
            minimumSamples,
            thresholds,
            ready: checks.every((check) => check.status !== 'insufficient'),
            passing: checks.every((check) => check.status === 'pass'),
            checks
        }
    };
}

function timingSafeTokenMatch(actual, expected) {
    const actualBuffer = Buffer.from(String(actual || ''));
    const expectedBuffer = Buffer.from(String(expected || ''));
    return actualBuffer.length === expectedBuffer.length
        && actualBuffer.length > 0
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function performanceReadToken(req) {
    const authorization = String(req.get('Authorization') || '');
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    return String(bearer || req.get('X-Performance-Read-Token') || '').trim();
}

function requestPayloadSize(req) {
    const contentLength = Number(req.get('Content-Length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 0) return contentLength;
    if (req.rawBody?.byteLength) return req.rawBody.byteLength;
    return Buffer.byteLength(JSON.stringify(req.body || {}));
}

function createPerformanceRumHandler({
    admin,
    ServerValue,
    setCors,
    allowedCorsOrigin,
    requireAppCheck = async () => {
        throw httpError(500, 'app_check_not_configured', 'Performance App Check verification is unavailable.');
    },
    env = process.env,
    now = () => Date.now()
}) {
    if (!admin?.database || typeof setCors !== 'function' || typeof allowedCorsOrigin !== 'function') {
        throw new TypeError('Performance RUM handler dependencies are required.');
    }

    return async function performanceRumHandler(req, res) {
        setCors(req, res);
        res.set('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }

        try {
            if (req.method === 'POST') {
                const rawOrigin = String(req.get('Origin') || '').trim();
                const origin = rawOrigin ? allowedCorsOrigin(req) : '';
                if (!rawOrigin || !origin) {
                    throw httpError(403, 'origin_not_allowed', 'Performance collection origin is not allowed.');
                }
                if (requestPayloadSize(req) > MAX_PAYLOAD_BYTES) {
                    throw httpError(413, 'payload_too_large', 'Performance payload is too large.');
                }
                if (!/^application\/json(?:;|$)/i.test(String(req.get('Content-Type') || ''))) {
                    throw httpError(415, 'unsupported_media_type', 'Performance payload must use JSON.');
                }

                await requireAppCheck(req);
                const batch = normalizePerformanceBatch(req.body);
                requireActiveRumRelease(batch.release, env);
                const receivedAt = now();
                await consumeDurableAdmission({
                    admin,
                    release: batch.release,
                    now: receivedAt,
                    limit: hourlyAdmissionLimit(env)
                });
                const aggregate = buildAggregateUpdates(batch, receivedAt, ServerValue);
                await admin.database().ref().update(aggregate.updates);
                res.status(202).json({
                    accepted: true,
                    schemaVersion: RUM_SCHEMA_VERSION
                });
                return;
            }

            if (req.method === 'GET') {
                const configuredToken = String(env.PERFORMANCE_RUM_READ_TOKEN || '').trim();
                if (!configuredToken || !timingSafeTokenMatch(performanceReadToken(req), configuredToken)) {
                    throw httpError(401, 'read_not_authorized', 'Performance summary is not authorized.');
                }

                const day = String(req.query?.day || '').trim();
                const release = String(req.query?.release || '').trim();
                if (!DAY_PATTERN.test(day) || !RELEASE_PATTERN.test(release)) {
                    throw httpError(400, 'invalid_summary_query', 'Performance summary day or release is invalid.');
                }
                const minimumSamples = Math.max(
                    1,
                    Math.min(10000, Math.floor(Number(env.PERFORMANCE_RUM_MIN_SAMPLES) || DEFAULT_MINIMUM_GATE_SAMPLES))
                );
                const releaseKey = releaseStorageKey(release);
                const snapshot = await admin.database()
                    .ref(`${RUM_STORAGE_ROOT}/days/${day}/releases/${releaseKey}`)
                    .once('value');
                res.status(200).json(summarizeReleaseSnapshot(snapshot.val(), {
                    day,
                    release,
                    minimumSamples,
                    generatedAt: now()
                }));
                return;
            }

            throw httpError(405, 'method_not_allowed', 'Use POST to record metrics or GET to read a summary.');
        } catch (error) {
            const status = Number(error?.status || 500);
            res.status(status).json({
                error: status >= 500 ? 'Performance collection is temporarily unavailable.' : error.message,
                code: error?.code || 'performance_rum_failed'
            });
        }
    };
}

module.exports = {
    DEFAULT_MINIMUM_GATE_SAMPLES,
    DEFAULT_HOURLY_ADMISSION_LIMIT,
    MAX_PAYLOAD_BYTES,
    METRIC_SPECS,
    RUM_SCHEMA_VERSION,
    RUM_STORAGE_ROOT,
    buildAggregateUpdates,
    consumeDurableAdmission,
    createPerformanceRumHandler,
    hourlyAdmissionLimit,
    metricBucketKey,
    normalizePerformanceBatch,
    percentileFromHistogram,
    requireActiveRumRelease,
    releaseStorageKey,
    summarizeReleaseSnapshot,
    utcDay,
    utcHour
};
