const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const DEFAULT_GOOGLE_AUTH_CLIENT_ID = '327658376387-48ots8pnboooefrb13i3i42jn9v073jv.apps.googleusercontent.com';
const GOOGLE_IDENTITY_SCRIPT_TIMEOUT_MS = 20000;
const GOOGLE_IDENTITY_SIGN_IN_TIMEOUT_MS = 30000;
const GOOGLE_IDENTITY_RESET_KEY = 'googleIdentityResetPending';
const GOOGLE_IDENTITY_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const GOOGLE_IDENTITY_PRODUCTION_HOSTS = new Set([
  'minimalist.chat',
  'www.minimalist.chat',
  'chat-app-356c1.web.app',
  'chat-app-356c1.firebaseapp.com',
]);

let googleIdentityScriptPromise = null;
let googleIdentityInitializedClientId = '';
let googleIdentityResponseHandler = null;

function setGoogleIdentityResetPending(pending) {
  if (typeof window === 'undefined') return;
  try {
    if (pending) window.sessionStorage.setItem(GOOGLE_IDENTITY_RESET_KEY, '1');
    else window.sessionStorage.removeItem(GOOGLE_IDENTITY_RESET_KEY);
  } catch {
    // Some embedded or privacy-focused browsers block session storage.
  }
}

function isGoogleIdentityResetPending() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(GOOGLE_IDENTITY_RESET_KEY) === '1';
  } catch {
    return false;
  }
}

function applyGoogleIdentitySessionReset(
  google = typeof window === 'undefined' ? null : window.google,
) {
  if (!google?.accounts?.id?.disableAutoSelect) return false;
  try {
    google.accounts.id.disableAutoSelect();
    setGoogleIdentityResetPending(false);
    return true;
  } catch {
    return false;
  }
}

export function requestGoogleIdentitySessionReset() {
  setGoogleIdentityResetPending(true);
  applyGoogleIdentitySessionReset();
}

export function cancelGoogleIdentitySessionReset() {
  setGoogleIdentityResetPending(false);
}

function consumeGoogleIdentitySessionReset(google) {
  if (!isGoogleIdentityResetPending()) return false;
  return applyGoogleIdentitySessionReset(google);
}

function googleIdentityError(error, fallback = 'Google sign-in failed.') {
  const code = error?.type || error?.error || error?.code || 'unknown';
  const message = error?.error_description || error?.message || fallback;
  const wrapped = new Error(message);
  wrapped.code = `google/${code}`;
  wrapped.originalError = error;
  return wrapped;
}

function withTimeout(promise, ms, message) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(message);
      error.code = 'google/script_timeout';
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  });
}

export function googleAuthClientId() {
  return window.GOOGLE_AUTH_CLIENT_ID || DEFAULT_GOOGLE_AUTH_CLIENT_ID;
}

function configuredGoogleIdentityHosts() {
  if (typeof window === 'undefined') return GOOGLE_IDENTITY_PRODUCTION_HOSTS;

  const configuredHosts = new Set();
  const hostValues = [
    ...(Array.isArray(window.GOOGLE_AUTH_ALLOWED_HOSTS) ? window.GOOGLE_AUTH_ALLOWED_HOSTS : []),
    ...String(window.GOOGLE_AUTH_ALLOWED_HOSTS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  const originValues = [
    ...(Array.isArray(window.GOOGLE_AUTH_ALLOWED_ORIGINS) ? window.GOOGLE_AUTH_ALLOWED_ORIGINS : []),
    ...String(window.GOOGLE_AUTH_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  hostValues.forEach((value) => configuredHosts.add(value));
  originValues.forEach((value) => {
    try {
      configuredHosts.add(new URL(value).hostname);
    } catch {
      configuredHosts.add(value);
    }
  });

  return configuredHosts.size ? configuredHosts : GOOGLE_IDENTITY_PRODUCTION_HOSTS;
}

export function shouldUseGoogleIdentityAuth() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const configuredHosts = configuredGoogleIdentityHosts();
  if (GOOGLE_IDENTITY_LOCAL_HOSTS.has(host) && !configuredHosts.has(host)) return false;
  if (!configuredHosts.has(host)) return false;
  return window.location.protocol === 'https:' || GOOGLE_IDENTITY_LOCAL_HOSTS.has(host);
}

export function shouldUseGoogleRedirectAuth() {
  if (typeof window === 'undefined') return false;
  if (window.Capacitor?.isNativePlatform?.()) return false;

  const browser = window.navigator || {};
  if (browser.userAgentData?.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(String(browser.userAgent || ''))) return true;

  const compactViewport = window.matchMedia?.('(max-width: 1024px)')?.matches === true;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches === true;
  return compactViewport && (coarsePointer || Number(browser.maxTouchPoints) > 0);
}

function requireGoogleAuthClientId() {
  const clientId = googleAuthClientId();
  if (!clientId) {
    throw googleIdentityError({
      code: 'missing_client_id',
      message: 'Google sign-in client id is missing.',
    });
  }
  return clientId;
}

function initializeGoogleIdentity(google, clientId, callback) {
  googleIdentityResponseHandler = callback;
  if (googleIdentityInitializedClientId === clientId) return;

  google.accounts.id.initialize({
    client_id: clientId,
    auto_select: false,
    cancel_on_tap_outside: true,
    itp_support: true,
    use_fedcm_for_button: true,
    ux_mode: 'popup',
    callback: (response) => googleIdentityResponseHandler?.(response),
  });
  googleIdentityInitializedClientId = clientId;
}

async function signInWithGoogleIdToken({
  auth,
  GoogleAuthProvider,
  signInWithCredential,
}, response) {
  if (!response?.credential) {
    throw googleIdentityError({
      code: 'missing_id_token',
      message: 'Google did not return an ID token.',
    });
  }

  const credential = GoogleAuthProvider.credential(response.credential);
  return signInWithCredential(auth, credential);
}

export function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) {
    consumeGoogleIdentitySessionReset(window.google);
    return Promise.resolve(window.google);
  }

  if (!googleIdentityScriptPromise) {
    googleIdentityScriptPromise = new Promise((resolve, reject) => {
      const done = (timer, poller, fn, value) => {
        window.clearTimeout(timer);
        window.clearInterval(poller);
        fn(value);
      };

      let script = document.querySelector('script[data-google-identity-script]')
        || document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);

      if (!script) {
        script = document.createElement('script');
        script.src = GOOGLE_IDENTITY_SCRIPT;
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentityScript = 'true';
        document.head.appendChild(script);
      }

      const timer = window.setTimeout(() => {
        const error = new Error('Google sign-in script took too long to load.');
        error.code = 'google/script_timeout';
        done(timer, poller, reject, error);
      }, GOOGLE_IDENTITY_SCRIPT_TIMEOUT_MS);

      const poller = window.setInterval(() => {
        if (window.google?.accounts?.id) done(timer, poller, resolve, window.google);
      }, 50);

      script.addEventListener('load', () => {
        if (window.google?.accounts?.id) done(timer, poller, resolve, window.google);
      }, { once: true });
      script.addEventListener('error', () => {
        done(timer, poller, reject, googleIdentityError({
          code: 'script_failed',
          message: 'Google sign-in script failed to load.',
        }));
      }, { once: true });
    }).then((google) => {
      if (!google?.accounts?.id) {
        throw googleIdentityError({
          code: 'script_failed',
          message: 'Google sign-in script is unavailable.',
        });
      }
      consumeGoogleIdentitySessionReset(google);
      return google;
    }).catch((error) => {
      googleIdentityScriptPromise = null;
      throw error;
    });
  }

  return googleIdentityScriptPromise;
}

async function runGoogleIdentitySignIn({
  auth,
  GoogleAuthProvider,
  signInWithCredential,
}) {
  const google = await loadGoogleIdentityScript();
  const clientId = requireGoogleAuthClientId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const responseHandler = async (response) => {
      if (!response?.credential) {
        settle(reject, googleIdentityError({
          code: 'missing_id_token',
          message: 'Google did not return an ID token.',
        }));
        return;
      }

      try {
        const userCredential = await signInWithGoogleIdToken({
          auth,
          GoogleAuthProvider,
          signInWithCredential,
        }, response);
        settle(resolve, userCredential);
      } catch (error) {
        settle(reject, error);
      }
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (googleIdentityResponseHandler === responseHandler) googleIdentityResponseHandler = null;
      fn(value);
    };

    initializeGoogleIdentity(google, clientId, responseHandler);

    google.accounts.id.prompt((notification) => {
      if (settled) return;

      if (notification?.isNotDisplayed?.()) {
        const reason = notification.getNotDisplayedReason?.() || 'not_displayed';
        settle(reject, googleIdentityError({
          code: reason,
          message: `Google sign-in could not be displayed (${reason}).`,
        }, 'Google sign-in could not be displayed.'));
        return;
      }

      if (notification?.isSkippedMoment?.()) {
        const reason = notification.getSkippedReason?.() || 'skipped';
        settle(reject, googleIdentityError({
          code: reason,
          message: `Google sign-in was skipped (${reason}).`,
        }, 'Google sign-in was skipped.'));
        return;
      }

      if (notification?.isDismissedMoment?.()) {
        const reason = notification.getDismissedReason?.() || 'dismissed';
        if (reason !== 'credential_returned') {
          settle(reject, googleIdentityError({
            code: reason,
            message: `Google sign-in was dismissed (${reason}).`,
          }, 'Google sign-in was closed before it finished.'));
        }
      }
    });
  });
}

export function signInWithGoogleIdentity(options) {
  return withTimeout(
    runGoogleIdentitySignIn(options),
    GOOGLE_IDENTITY_SIGN_IN_TIMEOUT_MS,
    'Google sign-in is taking too long on this connection. Please try again.',
  );
}

export async function renderGoogleIdentityButton({
  container,
  auth,
  GoogleAuthProvider,
  signInWithCredential,
  beforeSignIn,
  onResult,
  onError,
  text = 'continue_with',
}) {
  if (!container) return () => {};

  const google = await loadGoogleIdentityScript();
  const clientId = requireGoogleAuthClientId();

  const responseHandler = async (response) => {
    try {
      await beforeSignIn?.();
      const userCredential = await signInWithGoogleIdToken({
        auth,
        GoogleAuthProvider,
        signInWithCredential,
      }, response);
      await onResult?.(userCredential);
    } catch (error) {
      onError?.(error);
    }
  };

  initializeGoogleIdentity(google, clientId, responseHandler);

  let renderedWidth = 0;
  let resizeFrame = 0;
  const renderButton = () => {
    const width = Math.min(
      400,
      Math.max(220, Math.floor(container.getBoundingClientRect().width || 320)),
    );
    if (width === renderedWidth) return;

    renderedWidth = width;
    container.replaceChildren();
    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text,
      shape: 'pill',
      logo_alignment: 'left',
      width,
    });
  };

  renderButton();
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(renderButton);
      })
    : null;
  resizeObserver?.observe(container);

  return () => {
    resizeObserver?.disconnect();
    window.cancelAnimationFrame(resizeFrame);
    if (googleIdentityResponseHandler === responseHandler) googleIdentityResponseHandler = null;
    container.replaceChildren();
  };
}
