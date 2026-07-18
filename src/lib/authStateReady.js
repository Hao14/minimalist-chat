export const AUTH_STATE_READY_TIMEOUT_MS = 12_000;

function authStateTimeoutError() {
  const error = new Error('Timed out while restoring the Firebase authentication session.');
  error.code = 'auth/timeout';
  return error;
}

export function waitForInitialAuthState(
  auth,
  subscribe,
  {
    timeoutMs = AUTH_STATE_READY_TIMEOUT_MS,
    scheduleTimeout = globalThis.setTimeout,
    cancelTimeout = globalThis.clearTimeout,
  } = {},
) {
  if (typeof subscribe !== 'function') {
    return Promise.reject(new TypeError('An auth-state subscriber is required.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    let timeoutHandle;

    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) cancelTimeout(timeoutHandle);
      unsubscribe();
      handler(value);
    };

    timeoutHandle = scheduleTimeout(
      () => settle(reject, authStateTimeoutError()),
      timeoutMs,
    );

    try {
      const removeObserver = subscribe(
        auth,
        (user) => settle(resolve, user),
        (error) => settle(reject, error || new Error('Firebase authentication failed to initialize.')),
      );
      unsubscribe = typeof removeObserver === 'function' ? removeObserver : () => {};

      // Some test adapters and non-browser auth implementations can call the
      // observer synchronously, before they return the unsubscribe function.
      if (settled) unsubscribe();
    } catch (error) {
      settle(reject, error);
    }
  });
}
