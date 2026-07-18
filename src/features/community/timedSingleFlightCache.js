export function createTimedSingleFlightCache({
    ttlMs,
    maxEntries,
    now = () => Date.now(),
} = {}) {
    const resolved = new Map();
    const inFlight = new Map();
    const safeTtlMs = Math.max(0, Number(ttlMs) || 0);
    const safeMaxEntries = Math.max(1, Math.floor(Number(maxEntries) || 1));

    function trim(cache) {
        while (cache.size > safeMaxEntries) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey === undefined) break;
            cache.delete(oldestKey);
        }
    }

    function pruneExpired(timestamp = now()) {
        resolved.forEach((entry, key) => {
            if (timestamp - entry.loadedAt >= safeTtlMs) resolved.delete(key);
        });
    }

    function readFresh(key) {
        pruneExpired();
        const entry = resolved.get(key);
        if (!entry) return { hit: false, value: undefined };
        resolved.delete(key);
        resolved.set(key, entry);
        return { hit: true, value: entry.value };
    }

    function load(key, loader) {
        const cached = readFresh(key);
        if (cached.hit) return Promise.resolve(cached.value);

        const pending = inFlight.get(key);
        if (pending) {
            inFlight.delete(key);
            inFlight.set(key, pending);
            return pending;
        }

        let request;
        request = Promise.resolve()
            .then(loader)
            .then((value) => {
                // Invalidation removes the request from `inFlight`, preventing a
                // stale response from repopulating the cache after a mutation.
                if (inFlight.get(key) === request) {
                    resolved.delete(key);
                    resolved.set(key, { value, loadedAt: now() });
                    trim(resolved);
                }
                return value;
            })
            .finally(() => {
                if (inFlight.get(key) === request) inFlight.delete(key);
            });

        inFlight.set(key, request);
        trim(inFlight);
        return request;
    }

    function invalidate(key) {
        resolved.delete(key);
        inFlight.delete(key);
    }

    function clear() {
        resolved.clear();
        inFlight.clear();
    }

    function stats() {
        pruneExpired();
        return { resolved: resolved.size, inFlight: inFlight.size };
    }

    return Object.freeze({ clear, invalidate, load, stats });
}
