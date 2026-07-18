export function createFeatureMountCoordinator() {
  const scopes = new Map();
  let nextRequestId = 0;

  function schedule(scope, contextKey, prepare, commit, options = {}) {
    const key = String(contextKey || 'default');
    const current = scopes.get(scope);

    if (current?.mountedKey === key && options.cacheIsValid?.() !== false) {
      if (current.pendingPromise && current.pendingKey !== key) {
        scopes.set(scope, {
          mountedKey: key,
          pendingKey: null,
          pendingPromise: null,
          requestId: ++nextRequestId,
        });
      }
      return {
        status: 'cached',
        promise: Promise.resolve({ status: 'cached', contextKey: key }),
      };
    }

    if (current?.pendingKey === key && current.pendingPromise) {
      return { status: 'pending', promise: current.pendingPromise };
    }

    const requestId = ++nextRequestId;
    const mountedKey = current?.mountedKey || null;
    let resolvePending;
    let rejectPending;
    const pendingPromise = new Promise((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });

    scopes.set(scope, {
      mountedKey,
      pendingKey: key,
      pendingPromise,
      requestId,
    });

    Promise.resolve()
      .then(prepare)
      .then((prepared) => {
        const latest = scopes.get(scope);
        const isCurrent = latest?.requestId === requestId && latest?.pendingKey === key;
        const isRelevant = options.isRelevant?.() !== false;
        if (!isCurrent || !isRelevant) {
          if (isCurrent) {
            scopes.set(scope, {
              mountedKey,
              pendingKey: null,
              pendingPromise: null,
              requestId,
            });
          }
          resolvePending({ status: 'stale', contextKey: key });
          return;
        }

        const value = commit(prepared);
        scopes.set(scope, {
          mountedKey: key,
          pendingKey: null,
          pendingPromise: null,
          requestId,
        });
        resolvePending({ status: 'mounted', contextKey: key, value });
      })
      .catch((error) => {
        const latest = scopes.get(scope);
        const isCurrent = latest?.requestId === requestId && latest?.pendingKey === key;
        if (!isCurrent) {
          resolvePending({ status: 'stale', contextKey: key });
          return;
        }
        scopes.set(scope, {
          mountedKey,
          pendingKey: null,
          pendingPromise: null,
          requestId,
        });
        rejectPending(error);
      });

    return { status: 'started', promise: pendingPromise };
  }

  function clear(scope) {
    if (scope) scopes.delete(scope);
    else scopes.clear();
  }

  function inspect(scope) {
    const state = scopes.get(scope);
    return state ? {
      mountedKey: state.mountedKey,
      pendingKey: state.pendingKey,
    } : null;
  }

  return { schedule, clear, inspect };
}
