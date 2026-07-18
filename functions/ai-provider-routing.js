'use strict';

const ROUTER_STATE_VERSION = 1;

const DEFAULT_PROVIDER_TIERS = Object.freeze([
    Object.freeze({ provider: 'ollama-bridge', capacity: 10 }),
    Object.freeze({ provider: 'cloudflare-workers-ai', capacity: 40 }),
    Object.freeze({ provider: 'groq', capacity: 40 })
]);
const DEFAULT_TOTAL_PROVIDER_CAPACITY = DEFAULT_PROVIDER_TIERS.reduce(
    (total, tier) => total + tier.capacity,
    0
);

function normalizedProviderTiers(tiers = DEFAULT_PROVIDER_TIERS) {
    const seen = new Set();
    return (Array.isArray(tiers) ? tiers : [])
        .map((tier) => ({
            provider: String(tier?.provider || '').trim(),
            capacity: Math.max(0, Math.floor(Number(tier?.capacity) || 0))
        }))
        .filter((tier) => {
            if (!tier.provider || !tier.capacity || seen.has(tier.provider)) return false;
            seen.add(tier.provider);
            return true;
        });
}

function normalizedExcludedProviders(excludedProviders, tiers = DEFAULT_PROVIDER_TIERS) {
    const providers = new Set(normalizedProviderTiers(tiers).map((tier) => tier.provider));
    const values = excludedProviders instanceof Set
        ? [...excludedProviders]
        : Array.isArray(excludedProviders)
            ? excludedProviders
            : excludedProviders == null
                ? []
                : [excludedProviders];
    return [...new Set(values
        .map((provider) => String(provider || '').trim())
        .filter((provider) => providers.has(provider)))];
}

function normalizeProviderRouterState(current, now = Date.now(), tiers = DEFAULT_PROVIDER_TIERS) {
    const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const providers = new Set(normalizedProviderTiers(tiers).map((tier) => tier.provider));
    const rawLeases = current?.leases && typeof current.leases === 'object' ? current.leases : {};
    const leases = {};

    Object.entries(rawLeases).forEach(([leaseId, lease]) => {
        const provider = String(lease?.provider || '').trim();
        const acquiredAt = Number(lease?.acquiredAt);
        const expiresAt = Number(lease?.expiresAt);
        if (
            !leaseId
            || !providers.has(provider)
            || !Number.isFinite(acquiredAt)
            || !Number.isFinite(expiresAt)
            || acquiredAt < 0
            || expiresAt <= safeNow
            || expiresAt <= acquiredAt
        ) return;
        leases[leaseId] = { provider, acquiredAt, expiresAt };
    });

    return {
        version: ROUTER_STATE_VERSION,
        leases,
        updatedAt: Number(current?.updatedAt) || safeNow
    };
}

function allocateProviderLease(
    current,
    {
        leaseId,
        now = Date.now(),
        ttlMs = 150000,
        tiers = DEFAULT_PROVIDER_TIERS,
        excludedProviders = []
    } = {}
) {
    const cleanLeaseId = String(leaseId || '').trim();
    if (!cleanLeaseId) throw new TypeError('leaseId is required');

    const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const safeTtlMs = Math.max(1000, Math.floor(Number(ttlMs) || 150000));
    const normalizedTiers = normalizedProviderTiers(tiers);
    const excluded = new Set(normalizedExcludedProviders(excludedProviders, normalizedTiers));
    const state = normalizeProviderRouterState(current, safeNow, normalizedTiers);
    const existing = state.leases[cleanLeaseId];
    // A repeated RTDB transaction callback must keep the lease that it already
    // allocated, even if a later callback receives a stricter exclusion list.
    if (existing) return { state, lease: existing, reused: true, full: false };

    const counts = Object.fromEntries(normalizedTiers.map((tier) => [tier.provider, 0]));
    Object.values(state.leases).forEach((lease) => {
        if (Object.hasOwn(counts, lease.provider)) counts[lease.provider] += 1;
    });

    const hasOverCapacityTier = normalizedTiers.some(
        (tier) => counts[tier.provider] > tier.capacity
    );
    if (hasOverCapacityTier) return { state, lease: null, reused: false, full: true };

    const tier = normalizedTiers.find((candidate) => (
        !excluded.has(candidate.provider)
        && counts[candidate.provider] < candidate.capacity
    ));
    if (!tier) return { state, lease: null, reused: false, full: true };

    const lease = {
        provider: tier.provider,
        acquiredAt: safeNow,
        expiresAt: safeNow + safeTtlMs
    };
    state.leases[cleanLeaseId] = lease;
    state.updatedAt = safeNow;
    return { state, lease, reused: false, full: false };
}

function releaseProviderLease(current, { leaseId, now = Date.now(), tiers = DEFAULT_PROVIDER_TIERS } = {}) {
    const cleanLeaseId = String(leaseId || '').trim();
    const state = normalizeProviderRouterState(current, now, tiers);
    if (cleanLeaseId) delete state.leases[cleanLeaseId];
    state.updatedAt = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return state;
}

module.exports = {
    DEFAULT_PROVIDER_TIERS,
    DEFAULT_TOTAL_PROVIDER_CAPACITY,
    ROUTER_STATE_VERSION,
    allocateProviderLease,
    normalizeProviderRouterState,
    normalizedExcludedProviders,
    normalizedProviderTiers,
    releaseProviderLease
};
