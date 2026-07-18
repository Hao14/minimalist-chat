import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authSessionRecoveryMessage,
  classifyAuthSessionError,
  recoverInvalidAuthSession,
  validatePersistedAuthSession,
} from '../src/lib/authSessionRecovery.js';
import { waitForInitialAuthState } from '../src/lib/authStateReady.js';
import { shouldUseGoogleRedirectAuth } from '../src/lib/googleIdentityAuth.js';
import { withTimeout } from '../src/lib/promiseTimeout.js';

test('uses full-page Google redirect for mobile web but not desktop or native shells', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const setWindow = (value) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value,
    });
  };
  const mobileWindow = ({
    native = false,
    mobile = false,
    userAgent = '',
    maxTouchPoints = 0,
    compact = false,
    coarse = false,
    standalone = false,
  } = {}) => ({
    Capacitor: native ? { isNativePlatform: () => true } : undefined,
    navigator: {
      maxTouchPoints,
      userAgent,
      userAgentData: { mobile },
      standalone,
    },
    matchMedia: (query) => ({
      matches: query === '(max-width: 1024px)' ? compact : coarse,
    }),
  });

  try {
    Reflect.deleteProperty(globalThis, 'window');
    assert.equal(shouldUseGoogleRedirectAuth(), false);

    setWindow(mobileWindow({ mobile: true }));
    assert.equal(shouldUseGoogleRedirectAuth(), true);

    setWindow(mobileWindow({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }));
    assert.equal(shouldUseGoogleRedirectAuth(), true);

    setWindow(mobileWindow({ maxTouchPoints: 5, compact: true, coarse: true }));
    assert.equal(shouldUseGoogleRedirectAuth(), true);

    setWindow(mobileWindow({ mobile: true, standalone: true }));
    assert.equal(shouldUseGoogleRedirectAuth(), true);

    setWindow(mobileWindow({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }));
    assert.equal(shouldUseGoogleRedirectAuth(), false);

    setWindow(mobileWindow({ native: true, mobile: true }));
    assert.equal(shouldUseGoogleRedirectAuth(), false);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('resolves a bounded operation and clears its deadline', async () => {
  let cancelCalls = 0;
  const result = await withTimeout(Promise.resolve('ready'), 50, {
    scheduleTimeout: () => 1,
    cancelTimeout: () => { cancelCalls += 1; },
  });

  assert.equal(result, 'ready');
  assert.equal(cancelCalls, 1);
});

test('rejects a stalled operation with the configured timeout code', async () => {
  let fireTimeout;
  const pending = withTimeout(new Promise(() => {}), 50, {
    code: 'database/timeout',
    message: 'Profile read timed out.',
    scheduleTimeout: (callback) => {
      fireTimeout = callback;
      return 1;
    },
    cancelTimeout: () => {},
  });

  fireTimeout();
  await assert.rejects(
    pending,
    (error) => error?.code === 'database/timeout' && error.message === 'Profile read timed out.',
  );
});

test('resolves the initial auth observer and unsubscribes safely', async () => {
  let unsubscribeCalls = 0;
  const user = { uid: 'user-1' };
  const result = await waitForInitialAuthState(
    {},
    (_auth, next) => {
      next(user);
      return () => { unsubscribeCalls += 1; };
    },
  );

  assert.equal(result, user);
  assert.equal(unsubscribeCalls, 1);
});

test('times out an auth observer that never reports a session', async () => {
  let fireTimeout;
  let unsubscribeCalls = 0;
  const pending = waitForInitialAuthState(
    {},
    () => () => { unsubscribeCalls += 1; },
    {
      timeoutMs: 50,
      scheduleTimeout: (callback) => {
        fireTimeout = callback;
        return 1;
      },
      cancelTimeout: () => {},
    },
  );

  fireTimeout();
  await assert.rejects(pending, (error) => error?.code === 'auth/timeout');
  assert.equal(unsubscribeCalls, 1);
});

test('surfaces Firebase auth observer errors without waiting for the timeout', async () => {
  const expected = Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
  await assert.rejects(
    waitForInitialAuthState({}, (_auth, _next, reject) => {
      reject(expected);
      return () => {};
    }),
    expected,
  );
});

test('classifies definitive Firebase session failures as terminal', () => {
  for (const code of ['auth/user-token-expired', 'auth/user-disabled']) {
    assert.equal(classifyAuthSessionError({ code }).terminal, true);
  }
});

test('only treats refresh-token errors as terminal during token validation', () => {
  for (const code of [
    'auth/invalid-refresh-token',
    'auth/missing-refresh-token',
    'auth/invalid-user-token',
  ]) {
    assert.equal(classifyAuthSessionError({ code }).terminal, false);
    assert.equal(classifyAuthSessionError({ code }, { duringTokenRefresh: true }).terminal, true);
  }
});

test('keeps transient failures non-destructive', () => {
  for (const code of [
    'auth/network-request-failed',
    'auth/timeout',
    'auth/too-many-requests',
    'auth/internal-error',
    'auth/web-storage-unsupported',
    'auth/requires-recent-login',
    'PERMISSION_DENIED',
  ]) {
    assert.equal(
      classifyAuthSessionError({ code }, { duringTokenRefresh: true }).terminal,
      false,
    );
  }
});

test('validates persisted users with one forced token refresh', async () => {
  let forceRefreshValue = null;
  const result = await validatePersistedAuthSession({
    getIdToken: async (forceRefresh) => {
      forceRefreshValue = forceRefresh;
      return 'token';
    },
  });

  assert.equal(forceRefreshValue, true);
  assert.equal(result.status, 'valid');
});

test('separates terminal refresh failures from temporary connection failures', async () => {
  const terminal = await validatePersistedAuthSession({
    getIdToken: async () => {
      throw Object.assign(new Error('expired'), { code: 'auth/user-token-expired' });
    },
  });
  const transient = await validatePersistedAuthSession({
    getIdToken: async () => {
      throw Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
    },
  });

  assert.equal(terminal.status, 'terminal');
  assert.equal(transient.status, 'transient');
});

test('deduplicates concurrent recovery and preserves an actionable message', async () => {
  let releaseSignOut;
  let resetCalls = 0;
  let signOutCalls = 0;
  const error = Object.assign(new Error('expired'), { code: 'auth/user-token-expired' });
  const signOut = async () => {
    signOutCalls += 1;
    await new Promise((resolve) => {
      releaseSignOut = resolve;
    });
  };

  const first = recoverInvalidAuthSession({
    auth: {},
    error,
    requestProviderReset: () => { resetCalls += 1; },
    signOut,
  });
  const second = recoverInvalidAuthSession({
    auth: {},
    error,
    requestProviderReset: () => { resetCalls += 1; },
    signOut,
  });

  await Promise.resolve();
  assert.equal(resetCalls, 1);
  assert.equal(signOutCalls, 1);
  releaseSignOut();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.recovered, true);
  assert.equal(secondResult.message, authSessionRecoveryMessage(error));
});

test('does not invoke recovery callbacks for transient errors', async () => {
  let calls = 0;
  const result = await recoverInvalidAuthSession({
    auth: {},
    error: { code: 'auth/network-request-failed' },
    requestProviderReset: () => { calls += 1; },
    signOut: async () => { calls += 1; },
  });

  assert.equal(result.recovered, false);
  assert.equal(calls, 0);
});

test('keeps recovery actionable when local sign-out rejects', async () => {
  const error = Object.assign(new Error('invalid'), { code: 'auth/invalid-user-token' });
  const result = await recoverInvalidAuthSession({
    auth: {},
    error,
    signOut: async () => { throw new Error('storage unavailable'); },
  });

  assert.equal(result.recovered, true);
  assert.equal(result.message, authSessionRecoveryMessage(error));
});
