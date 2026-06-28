const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const DEFAULT_GOOGLE_AUTH_CLIENT_ID = '327658376387-48ots8pnboooefrb13i3i42jn9v073jv.apps.googleusercontent.com';

let googleIdentityScriptPromise = null;

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
  if (window.google?.accounts?.id) return Promise.resolve(window.google);

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
        done(timer, poller, reject, new Error('Google sign-in script took too long to load.'));
      }, 8000);

      const poller = window.setInterval(() => {
        if (window.google?.accounts?.id) done(timer, poller, resolve, window.google);
      }, 50);

      script.addEventListener('load', () => {
        if (window.google?.accounts?.id) done(timer, poller, resolve, window.google);
      }, { once: true });
      script.addEventListener('error', () => {
        done(timer, poller, reject, new Error('Google sign-in script failed to load.'));
      }, { once: true });
    }).then((google) => {
      if (!google?.accounts?.id) throw new Error('Google sign-in script is unavailable.');
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
  const clientId = googleAuthClientId();

  if (!clientId) throw new Error('Google sign-in client id is missing.');

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    google.accounts.id.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      itp_support: true,
      use_fedcm_for_prompt: true,
      ux_mode: 'popup',
      callback: async (response) => {
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
      },
    });

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
    12000,
    'Google sign-in did not open in this browser. Try Chrome or Safari.',
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
  const clientId = googleAuthClientId();
  if (!clientId) throw new Error('Google sign-in client id is missing.');

  google.accounts.id.initialize({
    client_id: clientId,
    auto_select: false,
    cancel_on_tap_outside: true,
    itp_support: true,
    use_fedcm_for_button: true,
    ux_mode: 'popup',
    callback: async (response) => {
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
    },
  });

  container.replaceChildren();
  const width = Math.min(
    400,
    Math.max(220, Math.floor(container.getBoundingClientRect().width || 320)),
  );
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text,
    shape: 'rectangular',
    logo_alignment: 'left',
    width,
  });

  return () => {
    container.replaceChildren();
  };
}
