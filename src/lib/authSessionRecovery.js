const TERMINAL_AUTH_SESSION_CODES = new Set([
  'auth/user-disabled',
  'auth/user-token-expired',
]);

const TOKEN_REFRESH_TERMINAL_CODES = new Set([
  ...TERMINAL_AUTH_SESSION_CODES,
  'auth/invalid-refresh-token',
  'auth/missing-refresh-token',
  'auth/invalid-user-token',
]);

const AUTH_RECOVERY_MESSAGE_KEY = 'minimalistAuthRecoveryMessage';

let activeRecoveryPromise = null;

export function classifyAuthSessionError(error, { duringTokenRefresh = false } = {}) {
  const code = String(error?.code || '');
  const terminal = duringTokenRefresh
    ? TOKEN_REFRESH_TERMINAL_CODES.has(code)
    : TERMINAL_AUTH_SESSION_CODES.has(code);

  return {
    code,
    reason: terminal
      ? (code === 'auth/user-disabled' ? 'account-disabled' : 'session-expired')
      : 'transient',
    terminal,
  };
}

export function authSessionRecoveryMessage(error) {
  return classifyAuthSessionError(error, { duringTokenRefresh: true }).reason === 'account-disabled'
    ? 'This account has been disabled. Contact support if you think this is a mistake.'
    : 'Your saved sign-in expired. Continue with Google or email to reconnect.';
}

function rememberAuthSessionRecoveryMessage(message) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(AUTH_RECOVERY_MESSAGE_KEY, message);
  } catch {
    // Some embedded or privacy-focused browsers block session storage.
  }
}

export function consumeAuthSessionRecoveryMessage() {
  if (typeof window === 'undefined') return '';
  try {
    const message = window.sessionStorage.getItem(AUTH_RECOVERY_MESSAGE_KEY) || '';
    window.sessionStorage.removeItem(AUTH_RECOVERY_MESSAGE_KEY);
    return message;
  } catch {
    return '';
  }
}

export async function validatePersistedAuthSession(user) {
  if (!user?.getIdToken) {
    const error = new Error('The saved authentication session is incomplete.');
    error.code = 'auth/invalid-user-token';
    return { error, reason: 'session-expired', status: 'terminal' };
  }

  try {
    await user.getIdToken(true);
    return { error: null, reason: 'valid', status: 'valid' };
  } catch (error) {
    const classification = classifyAuthSessionError(error, { duringTokenRefresh: true });
    return {
      error,
      reason: classification.reason,
      status: classification.terminal ? 'terminal' : 'transient',
    };
  }
}

export function recoverInvalidAuthSession({
  auth,
  error,
  remember = true,
  requestProviderReset,
  signOut,
}) {
  const classification = classifyAuthSessionError(error, { duringTokenRefresh: true });
  if (!classification.terminal) {
    return Promise.resolve({ error, message: '', recovered: false });
  }

  if (!activeRecoveryPromise) {
    activeRecoveryPromise = (async () => {
      const message = authSessionRecoveryMessage(error);
      if (remember) rememberAuthSessionRecoveryMessage(message);

      try {
        requestProviderReset?.();
      } catch {
        // Provider reset is best effort; Firebase sign-out is the important step.
      }

      try {
        await signOut?.(auth);
      } catch {
        // Keep the actionable recovery state even if local persistence is damaged.
      }

      return { error, message, recovered: true };
    })().finally(() => {
      activeRecoveryPromise = null;
    });
  }

  return activeRecoveryPromise;
}
