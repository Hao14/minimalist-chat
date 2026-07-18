import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadGoogleIdentityScript,
  requestGoogleIdentitySessionReset,
  renderGoogleIdentityButton,
  shouldUseGoogleIdentityAuth,
  shouldUseGoogleRedirectAuth,
  signInWithGoogleIdentity,
} from '../lib/googleIdentityAuth.js';
import {
  consumeAuthSessionRecoveryMessage,
  recoverInvalidAuthSession,
  validatePersistedAuthSession,
} from '../lib/authSessionRecovery.js';
import { writeAuthPresenceHint } from '../lib/authPresenceHint.js';
import { withTimeout } from '../lib/promiseTimeout.js';

const strengthLabels = ['', 'Weak', 'Weak', 'Fair', 'Good', 'Strong'];
const strengthColors = ['#ccc', '#e53935', '#e53935', '#fb8c00', '#fdd835', '#43a047'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_REDIRECT_RESULT_TIMEOUT_MS = 12_000;
const AUTH_PROFILE_SETUP_TIMEOUT_MS = 8_000;

let authKitPromise;

function loadAuthKit() {
  if (!authKitPromise) {
    authKitPromise = Promise.all([
      import('firebase/auth'),
      import('firebase/database'),
      import('../lib/firebase.js'),
      import('../lib/authProfile.js'),
    ]).then(([authModule, databaseModule, firebaseModule, profileModule]) => ({
      ...authModule,
      ref: databaseModule.ref,
      set: databaseModule.set,
      auth: firebaseModule.auth,
      db: firebaseModule.db,
      ensureAuthProfile: profileModule.ensureAuthProfile,
      ensureWelcomeBadge: profileModule.ensureWelcomeBadge,
      isGoogleAuthUser: profileModule.isGoogleAuthUser,
      syncPublicUserDirectory: profileModule.syncPublicUserDirectory,
    }));
  }

  return authKitPromise;
}

function passwordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 5);
}

function friendlyAuthError(error) {
  const messages = {
    'auth/account-exists-with-different-credential': 'That email already uses a different sign-in method.',
    'auth/email-already-in-use': 'That email already has an account.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/network-request-failed': 'The network is unavailable. Try again in a moment.',
    'auth/timeout': 'Sign-in verification timed out. Check your connection and try again.',
    'auth/internal-error': 'Sign-in verification could not finish. Please try again.',
    'auth/operation-not-allowed': 'Google sign-in is not enabled for this project yet.',
    'auth/operation-not-supported-in-this-environment': 'This browser needs Google sign-in to open in the current tab.',
    'auth/popup-blocked': 'The sign-in popup was blocked by your browser.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
    'auth/redirect-cancelled-by-user': 'Google sign-in was closed before it finished.',
    'google/popup_closed': 'Google sign-in was closed before it finished.',
    'google/popup_failed_to_open': 'This browser blocked Google sign-in. Open Minimalist in Chrome or Safari and try again.',
    'google/script_failed': 'Google sign-in could not load. Try again, or use email/password.',
    'google/script_timeout': 'Google sign-in is taking too long on this connection. Try again, or use email/password.',
    'google/browser_not_supported': 'This browser does not support Google sign-in. Open Minimalist in Chrome or Safari and try again.',
    'google/cancel_called': 'Google sign-in was closed before it finished.',
    'google/dismissed': 'Google sign-in was closed before it finished.',
    'google/flow_restarted': 'Google sign-in restarted. Please try again.',
    'google/invalid_client': 'Google sign-in is not configured correctly for this app.',
    'google/issuing_failed': 'Google could not issue a sign-in token. Please try again.',
    'google/missing_client_id': 'Google sign-in is missing its client id.',
    'google/missing_id_token': 'Google did not return a secure sign-in token.',
    'google/no_session': 'Google could not find an active account in this browser. Use email/password or try Chrome or Safari.',
    'google/not_displayed': 'Google sign-in could not open in this browser. Use email/password or try Chrome or Safari.',
    'google/opt_out_or_no_session': 'Google could not find an active account in this browser. Open Minimalist in Chrome or Safari and try again.',
    'google/skipped': 'Google sign-in was skipped by the browser. Use email/password or try Chrome or Safari.',
    'google/secure_http_required': 'Google sign-in requires a secure HTTPS page.',
    'google/suppressed_by_user': 'Google sign-in is temporarily suppressed in this browser. Open Minimalist in Chrome or Safari and try again.',
    'google/tap_outside': 'Google sign-in was closed before it finished.',
    'google/unregistered_origin': 'This domain is not authorized for Google sign-in.',
    'google/user_cancel': 'Google sign-in was closed before it finished.',
    'google/unknown': 'Google sign-in could not finish in this browser. Try Chrome or Safari.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/unauthorized-domain': 'This domain is not authorized for Google sign-in in Firebase.',
    'auth/web-storage-unsupported': 'This browser blocks the storage Google sign-in needs. Try opening the site in Chrome or Safari.',
    'auth/weak-password': 'Use a stronger password with at least 6 characters.',
  };
  if (messages[error?.code]) return messages[error.code];
  const detail = error?.code || error?.message;
  return detail ? `Google sign-in failed: ${detail}` : 'Something went wrong. Please try again.';
}

function shouldRedirectAfterPopupError(error) {
  return [
    'auth/popup-blocked',
    'auth/cancelled-popup-request',
    'auth/operation-not-supported-in-this-environment',
    'google/popup_failed_to_open',
    'google/not_displayed',
  ].includes(error?.code);
}

function shouldRetryWithFirebaseGoogle(error) {
  return [
    'google/invalid_client',
    'google/secure_http_required',
    'google/unregistered_origin',
  ].includes(error?.code);
}

async function signInWithFirebaseGoogle(kit) {
  const provider = new kit.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return kit.signInWithPopup(kit.auth, provider);
}

async function signInWithFirebaseGoogleRedirect(kit) {
  const provider = new kit.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return kit.signInWithRedirect(kit.auth, provider);
}

function getSessionValue(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Some mobile browsers partition or block sessionStorage during auth.
  }
}

function removeSessionValue(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Some mobile browsers partition or block sessionStorage during auth.
  }
}

function safeInternalChatUrl(value) {
  if (!value) return '';
  try {
    const targetUrl = new URL(value, window.location.origin);
    if (targetUrl.origin !== window.location.origin || targetUrl.pathname !== '/chat') return '';
    if (targetUrl.searchParams.get('billing') === 'portal-return') {
      targetUrl.searchParams.delete('billing');
    }
    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  } catch {
    return '';
  }
}

function postAuthRedirect() {
  const pendingChatUrl = safeInternalChatUrl(getSessionValue('pendingChatUrl'));
  if (pendingChatUrl) return pendingChatUrl;

  const pendingJoinUrl = getSessionValue('pendingJoinUrl') || '';
  return pendingJoinUrl.startsWith('/join/') ? pendingJoinUrl : '/chat';
}

function navigateAfterAuth() {
  writeAuthPresenceHint(true);
  const targetUrl = new URL(postAuthRedirect(), window.location.origin);
  const targetPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (targetUrl.origin !== window.location.origin) {
    window.location.replace('/chat');
    return;
  }

  if (targetPath === currentPath) {
    window.location.reload();
    return;
  }

  removeSessionValue('pendingChatUrl');
  removeSessionValue('pendingJoinUrl');
  window.location.replace(targetPath);
}

function requiresVerifiedEmail(user, isGoogleAuthUser = () => false) {
  return Boolean(user?.email) && user.emailVerified === false && !isGoogleAuthUser(user);
}

function ensureAuthProfileWithDeadline(kit, user, options) {
  return withTimeout(
    kit.ensureAuthProfile(user, options),
    AUTH_PROFILE_SETUP_TIMEOUT_MS,
    {
      code: 'database/timeout',
      message: 'Profile setup timed out. Chat can finish it after sign-in.',
    },
  );
}

function mergeDescribedBy(...ids) {
  const cleanIds = ids.filter(Boolean);
  return cleanIds.length ? cleanIds.join(' ') : undefined;
}

function focusNextFrame(ref) {
  window.requestAnimationFrame(() => ref.current?.focus());
}

function PasswordField({ describedBy, error, id, inputRef, label, placeholder, value, onChange }) {
  const [visible, setVisible] = useState(false);
  const visibilityLabel = `${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`;

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          ref={inputRef}
          id={id}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={id === 'login-password' ? 'current-password' : 'new-password'}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : 'false'}
          required
        />
        <button
          type="button"
          className="pw-toggle"
          aria-controls={id}
          aria-label={visibilityLabel}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

function GoogleBrandMark() {
  return (
    <svg className="google-mark" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285f4"
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.876 2.684-6.613Z"
      />
      <path
        fill="#34a853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.182l-2.909-2.258c-.806.54-1.835.86-3.047.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#fbbc05"
        d="M3.963 10.706A5.414 5.414 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.826.956 4.038l3.007-2.332Z"
      />
      <path
        fill="#ea4335"
        d="M9 3.58c1.322 0 2.508.454 3.441 1.346l2.581-2.581C13.463.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

function GoogleIdentityAuthButton({
  busy,
  mode,
  remember,
  onFallbackClick,
  onResult,
  onError,
  setBusy,
}) {
  const mountRef = useRef(null);
  const callbacksRef = useRef({ onResult, onError });
  const authPreferencesRef = useRef({ mode, remember });
  const [renderState, setRenderState] = useState(() => (
    shouldUseGoogleIdentityAuth() && !shouldUseGoogleRedirectAuth() ? 'loading' : 'fallback'
  ));

  useEffect(() => {
    callbacksRef.current = { onResult, onError };
  }, [onResult, onError]);

  useEffect(() => {
    authPreferencesRef.current = { mode, remember };
  }, [mode, remember]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = null;

    const mountButton = async () => {
      const shouldMountIdentityButton = shouldUseGoogleIdentityAuth()
        && !shouldUseGoogleRedirectAuth();
      setRenderState(shouldMountIdentityButton ? 'loading' : 'fallback');

      if (!shouldMountIdentityButton) {
        mountRef.current?.replaceChildren();
        return;
      }

      try {
        const kit = await loadAuthKit();
        if (cancelled || !mountRef.current) return;

        const nextCleanup = await renderGoogleIdentityButton({
          container: mountRef.current,
          auth: kit.auth,
          GoogleAuthProvider: kit.GoogleAuthProvider,
          signInWithCredential: kit.signInWithCredential,
          text: 'continue_with',
          beforeSignIn: async () => {
            const preferences = authPreferencesRef.current;
            setBusy(true);
            await kit.setPersistence(
              kit.auth,
              preferences.mode === 'login' && !preferences.remember
                ? kit.browserSessionPersistence
                : kit.browserLocalPersistence,
            );
          },
          onResult: (credential) => callbacksRef.current.onResult?.(credential),
          onError: (error) => callbacksRef.current.onError?.(error),
        });

        if (cancelled) {
          nextCleanup();
          return;
        }

        cleanup = nextCleanup;
        setRenderState('mounted');
      } catch {
        if (!cancelled) {
          mountRef.current?.replaceChildren();
          setRenderState('fallback');
        }
      }
    };

    mountButton();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [setBusy]);

  const mounted = renderState === 'mounted';

  return (
    <div className="google-auth-method">
      <div
        className={`google-identity-shell is-${renderState} ${busy ? 'is-disabled' : ''}`}
        data-google-state={renderState}
        aria-busy={busy ? 'true' : 'false'}
        aria-disabled={busy ? 'true' : 'false'}
      >
        <div className="google-identity-control" inert={busy ? true : undefined}>
          <div ref={mountRef} className="google-identity-button" aria-hidden={!mounted} />
          {renderState === 'loading' && !busy ? (
            <div className="google-auth-loading" role="status" aria-live="polite">
              <span className="google-mark-frame" aria-hidden="true"><GoogleBrandMark /></span>
              <span>Getting Google ready…</span>
            </div>
          ) : null}
          {renderState === 'fallback' ? (
            <button
              type="button"
              className="google-btn auth-google-primary"
              disabled={busy}
              onClick={onFallbackClick}
            >
              <span className="google-mark-frame" aria-hidden="true"><GoogleBrandMark /></span>
              <span>Continue with Google</span>
            </button>
          ) : null}
        </div>
        {busy ? (
          <div className="google-auth-busy" role="status" aria-live="polite">
            <span className="google-auth-spinner" aria-hidden="true" />
            <span>Connecting to Google…</span>
          </div>
        ) : null}
      </div>
      <p className="google-auth-caption">
        <i className="ph-bold ph-shield-check" aria-hidden="true" />
        No new password needed
      </p>
    </div>
  );
}

function AuthSignalScene() {
  const sceneRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;

    const root = document.documentElement;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || root.classList.contains('performance-low') || root.classList.contains('prefers-reduced-motion')) {
      return undefined;
    }

    let finishTimer;
    let inView = false;
    let hasPlayed = false;
    let observer;
    const play = () => {
      if (hasPlayed || !inView || document.hidden) return;
      hasPlayed = true;
      observer?.disconnect();
      setIsAnimating(true);
      finishTimer = window.setTimeout(() => setIsAnimating(false), 4700);
    };

    const handleVisibilityChange = () => play();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (!('IntersectionObserver' in window)) {
      inView = true;
      play();
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.clearTimeout(finishTimer);
      };
    }

    observer = new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting);
      play();
    }, { threshold: 0.32 });

    observer.observe(scene);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearTimeout(finishTimer);
    };
  }, []);

  return (
    <div className="auth-hero-panel auth-signal-panel" aria-hidden="true">
      <div ref={sceneRef} className={`auth-signal-scene ${isAnimating ? 'is-animating' : ''}`}>
        <div className="auth-signal-heading">
          <span><i className="ph-bold ph-broadcast" /> Live from Home</span>
          <h2>From room noise<br />to what matters.</h2>
          <p>Minimalist catches you up without making you dig.</p>
        </div>

        <div className="auth-signal-stage">
          <span className="auth-signal-route auth-signal-route-in" />
          <span className="auth-signal-route auth-signal-route-out" />
          <span className="auth-signal-spark auth-signal-spark-one">✦</span>
          <span className="auth-signal-spark auth-signal-spark-two">✦</span>

          <div className="auth-signal-note auth-signal-note-one">
            <span className="auth-signal-avatar">J</span>
            <p>Did we land on Friday?</p>
          </div>
          <div className="auth-signal-note auth-signal-note-two">
            <span className="auth-signal-avatar">M</span>
            <p>I can own the first draft.</p>
          </div>
          <div className="auth-signal-note auth-signal-note-three">
            <i className="ph-bold ph-file-text" />
            <p>Shared: project-outline.pdf</p>
          </div>

          <div className="auth-signal-core">
            <span className="auth-signal-ring auth-signal-ring-one" />
            <span className="auth-signal-ring auth-signal-ring-two" />
            <div className="auth-signal-machine">
              <span className="auth-signal-mark"><span /><span /></span>
              <small>Catch-Me-Up</small>
              <strong>Sorting<br />the signal</strong>
            </div>
          </div>

          <div className="auth-signal-receipt">
            <div className="auth-signal-receipt-top">
              <span><i className="ph-bold ph-sparkle" /> Catch-Me-Up</span>
              <strong>3 useful updates</strong>
            </div>
            <div className="auth-signal-update">
              <i className="ph-bold ph-check-circle" />
              <p><small>Decision</small><strong>Review starts Friday.</strong></p>
            </div>
            <div className="auth-signal-update">
              <i className="ph-bold ph-check-square" />
              <p><small>Next step</small><strong>First draft has an owner.</strong></p>
            </div>
            <div className="auth-signal-update">
              <i className="ph-bold ph-file-text" />
              <p><small>Shared</small><strong>Project outline is ready.</strong></p>
            </div>
          </div>
        </div>

        <div className="auth-signal-result">
          <span><i className="ph-bold ph-moon-stars" /> Focus mode</span>
          <strong><i className="ph-bold ph-check" /> All caught up</strong>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState('login');
  const [loginStep, setLoginStep] = useState(1);
  const [signupStep, setSignupStep] = useState(1);
  const [busy, setBusy] = useState(() => getSessionValue('googleAuthRedirectPending') === '1');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [verificationState, setVerificationState] = useState(null);
  const [signup, setSignup] = useState({
    email: '',
    username: '',
    birthday: '',
    phone: '',
    password: '',
    confirm: '',
  });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const loginTabRef = useRef(null);
  const loginEmailInput = useRef(null);
  const signupTabRef = useRef(null);
  const signupEmailInput = useRef(null);
  const signupNameInput = useRef(null);
  const loginPasswordInput = useRef(null);
  const signupPasswordInput = useRef(null);
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  const strength = useMemo(() => passwordStrength(signup.password), [signup.password]);
  const passwordsMatch = signup.confirm && signup.confirm === signup.password;

  const showToast = (message, isError = true) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const updateFieldErrors = (fields, nextErrors) => {
    setFieldErrors((current) => {
      const draft = { ...current };
      fields.forEach((field) => delete draft[field]);
      return { ...draft, ...nextErrors };
    });
    return Object.keys(nextErrors).length === 0;
  };

  const setAuthMode = (nextMode) => {
    setMode(nextMode);
    setFieldErrors({});
    setVerificationState(null);
    if (nextMode === 'login') setLoginStep(1);
    if (nextMode === 'signup') setSignupStep(1);
  };

  const handleModeTabsKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    if (event.key === 'ArrowLeft' || event.key === 'Home') {
      setAuthMode('login');
      loginTabRef.current?.focus();
      return;
    }

    setAuthMode('signup');
    signupTabRef.current?.focus();
  };

  const validateEmail = (value) => {
    const clean = value.trim();
    if (!clean) return 'Enter your email address.';
    if (!EMAIL_PATTERN.test(clean)) return 'Enter a valid email address.';
    return '';
  };

  const validateLoginEmailStep = () => {
    const error = validateEmail(loginEmail);
    return updateFieldErrors(['loginEmail'], error ? { loginEmail: error } : {});
  };

  const validateLoginPasswordStep = () => {
    const nextErrors = {};
    if (!loginPassword) nextErrors.loginPassword = 'Enter your password.';
    return updateFieldErrors(['loginPassword'], nextErrors);
  };

  const validateSignupEmailStep = () => {
    const error = validateEmail(signup.email);
    return updateFieldErrors(['email'], error ? { email: error } : {});
  };

  const validateSignupProfileStep = () => {
    const nextErrors = {};
    if (!signup.username.trim()) nextErrors.username = 'Choose a username.';
    return updateFieldErrors(['username'], nextErrors);
  };

  const validateSignupPasswordStep = () => {
    const nextErrors = {};
    if (signup.password.length < 6) nextErrors.password = 'Password must be at least 6 characters.';
    if (!signup.confirm) nextErrors.confirm = 'Re-enter your password.';
    else if (signup.password !== signup.confirm) nextErrors.confirm = 'Passwords do not match.';
    return updateFieldErrors(['password', 'confirm'], nextErrors);
  };

  const showVerificationGate = async (kit, user, { autoSend = false } = {}) => {
    if (!user) return;

    removeSessionValue('googleAuthRedirectPending');
    let message = `Verify ${user.email || 'your email'} to continue to chat.`;
    let error = '';
    const sentKey = user.uid ? `emailVerificationSent:${user.uid}` : '';

    if (autoSend && user.email && (!sentKey || getSessionValue(sentKey) !== '1')) {
      try {
        await kit.sendEmailVerification(user);
        if (sentKey) setSessionValue(sentKey, '1');
        message = `We sent a verification link to ${user.email}. Open it, then come back here.`;
      } catch (verificationError) {
        error = friendlyAuthError(verificationError);
      }
    }

    setVerificationState({
      email: user.email || '',
      error,
      message,
    });
    setBusy(false);
  };

  useEffect(() => {
    const previousTitle = document.title;
    const previousClass = document.body.className;
    const previousStyle = document.body.getAttribute('style');
    let unsubscribe = () => {};
    let cancelled = false;
    let idleHandle = null;
    document.title = 'Minimalist | Enter';
    document.body.className = 'auth-screen';
    document.body.setAttribute(
      'style',
      'display:block;min-height:100vh;margin:0;padding:0;overflow-y:auto;',
    );

    const recoveryMessage = consumeAuthSessionRecoveryMessage();
    if (recoveryMessage) showToast(recoveryMessage);

    let handledAuth = false;
    const finishSignedInUser = async (kit, user, welcome = false) => {
      if (!user || handledAuth) return;
      if (requiresVerifiedEmail(user, kit.isGoogleAuthUser)) {
        await showVerificationGate(kit, user, { autoSend: welcome });
        return;
      }

      handledAuth = true;
      removeSessionValue('googleAuthRedirectPending');
      try {
        if (kit.isGoogleAuthUser(user)) {
          await ensureAuthProfileWithDeadline(kit, user, { welcome });
        }
      } catch (error) {
        showToast(`Signed in, but profile setup needs a retry: ${error.message}`);
      }
      navigateAfterAuth();
    };

    const initAuthSessionWatcher = async () => {
      try {
        const kit = await loadAuthKit();
        if (cancelled) return;
        let authSessionReady = false;
        let observedUser = null;

        unsubscribe = kit.onAuthStateChanged(kit.auth, (user) => {
          observedUser = user;
          if (authSessionReady && user) finishSignedInUser(kit, user);
        });

        let redirectResult;
        try {
          redirectResult = await withTimeout(
            kit.getRedirectResult(kit.auth),
            GOOGLE_REDIRECT_RESULT_TIMEOUT_MS,
            {
              code: 'auth/timeout',
              message: 'Google sign-in took too long to return to Minimalist.',
            },
          );
        } catch (error) {
          authSessionReady = true;
          removeSessionValue('googleAuthRedirectPending');
          const recoveredUser = observedUser || kit.auth.currentUser;
          if (error?.code === 'auth/timeout' && recoveredUser) {
            await finishSignedInUser(kit, recoveredUser, true);
            return;
          }
          if (error?.code !== 'auth/popup-closed-by-user') showToast(friendlyAuthError(error));
          setBusy(false);
          return;
        }

        if (cancelled) return;
        const redirectedUser = redirectResult?.user || null;
        const persistedUser = redirectedUser ? null : (observedUser || kit.auth.currentUser);

        if (persistedUser) {
          const tokenState = await validatePersistedAuthSession(persistedUser);
          if (cancelled) return;

          if (tokenState.status === 'terminal') {
            const recovery = await recoverInvalidAuthSession({
              auth: kit.auth,
              error: tokenState.error,
              remember: false,
              requestProviderReset: requestGoogleIdentitySessionReset,
              signOut: kit.signOut,
            });
            authSessionReady = true;
            if (!cancelled) {
              removeSessionValue('googleAuthRedirectPending');
              showToast(recovery.message);
              setBusy(false);
            }
            return;
          }

          if (tokenState.status === 'transient') {
            authSessionReady = true;
            removeSessionValue('googleAuthRedirectPending');
            showToast(friendlyAuthError(tokenState.error));
            setBusy(false);
            return;
          }
        }

        authSessionReady = true;
        if (redirectedUser) finishSignedInUser(kit, redirectedUser, true);
        else if (persistedUser) finishSignedInUser(kit, persistedUser);
        else {
          removeSessionValue('googleAuthRedirectPending');
          setBusy(false);
        }
      } catch (error) {
        removeSessionValue('googleAuthRedirectPending');
        if (!cancelled) {
          showToast(friendlyAuthError(error));
          setBusy(false);
        }
      }
    };

    initAuthSessionWatcher();
    if (shouldUseGoogleIdentityAuth() && !shouldUseGoogleRedirectAuth()) {
      loadGoogleIdentityScript().catch(() => {});
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle);
      unsubscribe();
      window.clearTimeout(toastTimer.current);
      document.title = previousTitle;
      document.body.className = previousClass;
      if (previousStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', previousStyle);
    };
  }, []);

  const updateSignup = (field, value) => {
    updateFieldErrors([field], {});
    setSignup((current) => ({ ...current, [field]: value }));
  };

  const continueLogin = () => {
    if (busy) return;
    if (validateLoginEmailStep()) {
      setLoginStep(2);
      focusNextFrame(loginPasswordInput);
    }
  };

  const continueSignupEmail = () => {
    if (busy) return;
    if (validateSignupEmailStep()) {
      setSignupStep(2);
      focusNextFrame(signupNameInput);
    }
  };

  const continueSignupProfile = () => {
    if (busy) return;
    if (validateSignupProfileStep()) {
      setSignupStep(3);
      focusNextFrame(signupPasswordInput);
    }
  };

  const returnToLoginEmail = () => {
    if (busy) return;
    setLoginStep(1);
    focusNextFrame(loginEmailInput);
  };

  const returnToSignupEmail = () => {
    if (busy) return;
    setSignupStep(1);
    focusNextFrame(signupEmailInput);
  };

  const returnToSignupProfile = () => {
    if (busy) return;
    setSignupStep(2);
    focusNextFrame(signupNameInput);
  };

  const continueOnEnter = (event, nextStep) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (busy) return;
    nextStep();
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (loginStep === 1) {
      continueLogin();
      return;
    }
    if (!validateLoginPasswordStep()) return;

    setBusy(true);
    try {
      const kit = await loadAuthKit();
      await kit.setPersistence(kit.auth, remember ? kit.browserLocalPersistence : kit.browserSessionPersistence);
      const credential = await kit.signInWithEmailAndPassword(kit.auth, loginEmail.trim(), loginPassword);
      if (requiresVerifiedEmail(credential.user, kit.isGoogleAuthUser)) {
        await showVerificationGate(kit, credential.user, { autoSend: true });
        return;
      }
      navigateAfterAuth();
    } catch (error) {
      showToast(friendlyAuthError(error));
      setBusy(false);
    }
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (signupStep === 1) {
      continueSignupEmail();
      return;
    }
    if (signupStep === 2) {
      continueSignupProfile();
      return;
    }
    if (!validateSignupPasswordStep()) return;

    setBusy(true);
    try {
      const kit = await loadAuthKit();
      const credential = await kit.createUserWithEmailAndPassword(kit.auth, signup.email.trim(), signup.password);
      await kit.updateProfile(credential.user, { displayName: signup.username.trim() });
      const shortId = Math.random().toString(36).slice(2, 8).toUpperCase();
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(signup.username.trim())}&background=000&color=FFD700&bold=true`;
      const profile = {
        displayName: signup.username.trim(),
        phoneNumber: signup.phone.trim(),
        birthday: signup.birthday,
        photoUrl: avatar,
        shortId,
        themeColor: '#FFD700',
        bio: "I'm new here!",
        pronouns: '',
        createdAt: credential.user.metadata.creationTime,
      };
      await kit.set(kit.ref(kit.db, `users/${credential.user.uid}`), profile);
      try {
        const result = await kit.ensureWelcomeBadge(credential.user.uid, profile);
        if (result.awardedAt) profile.badges = { welcome: result.awardedAt };
      } catch (badgeError) {
        console.warn('Welcome badge award skipped', badgeError);
      }
      await kit.syncPublicUserDirectory(credential.user, profile);
      setSessionValue('showWelcomeTour', '1');
      if (requiresVerifiedEmail(credential.user, kit.isGoogleAuthUser)) {
        await showVerificationGate(kit, credential.user, { autoSend: true });
        return;
      }
      navigateAfterAuth();
    } catch (error) {
      showToast(friendlyAuthError(error));
      setBusy(false);
    }
  };

  const beginGoogleRedirect = async () => {
    try {
      const kit = await loadAuthKit();
      setSessionValue('googleAuthRedirectPending', '1');
      await kit.setPersistence(
        kit.auth,
        mode === 'login' && !remember ? kit.browserSessionPersistence : kit.browserLocalPersistence,
      );
      await signInWithFirebaseGoogleRedirect(kit);
      return true;
    } catch (error) {
      removeSessionValue('googleAuthRedirectPending');
      showToast(friendlyAuthError(error));
      setBusy(false);
      return false;
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);

    if (shouldUseGoogleRedirectAuth()) {
      await beginGoogleRedirect();
      return;
    }

    try {
      const kit = await loadAuthKit();
      await kit.setPersistence(kit.auth, mode === 'login' && !remember ? kit.browserSessionPersistence : kit.browserLocalPersistence);
      let credential;
      try {
        credential = shouldUseGoogleIdentityAuth()
          ? await signInWithGoogleIdentity(kit)
          : await signInWithFirebaseGoogle(kit);
      } catch (error) {
        if (!shouldRetryWithFirebaseGoogle(error)) throw error;
        credential = await signInWithFirebaseGoogle(kit);
      }
      try {
        await ensureAuthProfileWithDeadline(kit, credential.user, { welcome: true });
      } catch (error) {
        showToast(`Signed in, but profile setup needs a retry: ${error.message}`);
      }
      navigateAfterAuth();
    } catch (error) {
      await handleGoogleError(error);
    }
  };

  const handleGoogleIdentityResult = async (credential) => {
    try {
      const kit = await loadAuthKit();
      try {
        await ensureAuthProfileWithDeadline(kit, credential.user, { welcome: true });
      } catch (error) {
        showToast(`Signed in, but profile setup needs a retry: ${error.message}`);
      }
      navigateAfterAuth();
    } catch (error) {
      await handleGoogleError(error);
    }
  };

  const startGoogleRedirectFallback = async (error) => {
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone;
    if (isNative || standalone || !shouldRedirectAfterPopupError(error)) return false;
    await beginGoogleRedirect();
    return true;
  };

  const handleGoogleError = async (error) => {
    if (await startGoogleRedirectFallback(error)) return;
    if (error?.code !== 'auth/popup-closed-by-user') showToast(friendlyAuthError(error));
    setBusy(false);
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    if (busy) return;
    const resetEmail = loginEmail.trim();
    if (!resetEmail) {
      setLoginStep(1);
      updateFieldErrors(['loginEmail'], { loginEmail: 'Enter your email first.' });
      focusNextFrame(loginEmailInput);
      return;
    }
    if (!EMAIL_PATTERN.test(resetEmail)) {
      setLoginStep(1);
      updateFieldErrors(['loginEmail'], { loginEmail: 'Enter a valid email address.' });
      focusNextFrame(loginEmailInput);
      return;
    }
    try {
      const kit = await loadAuthKit();
      await kit.sendPasswordResetEmail(kit.auth, resetEmail);
      showToast('Password reset email sent.', false);
    } catch (error) {
      showToast(friendlyAuthError(error));
    }
  };

  const resendVerificationEmail = async () => {
    setBusy(true);
    try {
      const kit = await loadAuthKit();
      const user = kit.auth.currentUser;
      if (!user) {
        setVerificationState(null);
        showToast('Sign in again to resend verification.');
        return;
      }
      await kit.sendEmailVerification(user);
      setSessionValue(`emailVerificationSent:${user.uid}`, '1');
      setVerificationState((current) => current ? {
        ...current,
        error: '',
        message: `A fresh verification link was sent to ${user.email || current.email}.`,
      } : current);
    } catch (error) {
      setVerificationState((current) => current ? { ...current, error: friendlyAuthError(error) } : current);
    } finally {
      setBusy(false);
    }
  };

  const confirmVerifiedEmail = async () => {
    setBusy(true);
    try {
      const kit = await loadAuthKit();
      const user = kit.auth.currentUser;
      if (!user) {
        setVerificationState(null);
        showToast('Sign in again to continue.');
        return;
      }

      await kit.reload(user);
      if (kit.auth.currentUser?.emailVerified) {
        setVerificationState(null);
        removeSessionValue(`emailVerificationSent:${user.uid}`);
        navigateAfterAuth();
        return;
      }

      setVerificationState((current) => current ? {
        ...current,
        error: '',
        message: `Still waiting on ${user.email || current.email}. Finish the verification link, then try again.`,
      } : current);
    } catch (error) {
      setVerificationState((current) => current ? { ...current, error: friendlyAuthError(error) } : current);
    } finally {
      setBusy(false);
    }
  };

  const switchAccountForVerification = async () => {
    setBusy(true);
    try {
      const kit = await loadAuthKit();
      const uid = kit.auth.currentUser?.uid;
      await kit.signOut(kit.auth);
      if (uid) removeSessionValue(`emailVerificationSent:${uid}`);
      setVerificationState(null);
      setAuthMode('login');
      setLoginPassword('');
      showToast('Signed out. Use a verified account to continue.', false);
    } catch (error) {
      showToast(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const loginStepMeta =
    loginStep === 1
      ? {
          badge: 'Step 1 of 2',
          title: 'Start with your email',
          copy: 'We’ll find your room profile first, then ask for the password.',
        }
      : {
          badge: 'Step 2 of 2',
          title: 'Enter your password',
          copy: 'Use your password, or continue with Google instead.',
        };

  const signupStepMeta = [
    {
      badge: 'Step 1 of 3',
      title: 'Create your login',
      copy: 'Use the email you want connected to rooms, invites, and billing.',
    },
    {
      badge: 'Step 2 of 3',
      title: 'Set up your profile',
      copy: 'Pick the name people will recognize. You can finish the rest later.',
    },
    {
      badge: 'Step 3 of 3',
      title: 'Secure the account',
      copy: 'Choose a password you won’t hate typing twice.',
    },
  ][signupStep - 1];
  const signupPasswordDescribedBy = mergeDescribedBy(
    fieldErrors.password ? 'signup-password-error' : undefined,
    signup.password ? 'signup-password-strength-label' : undefined,
  );
  const signupConfirmDescribedBy = mergeDescribedBy(
    fieldErrors.confirm ? 'signup-confirm-error' : undefined,
    signup.confirm ? 'signup-confirm-match' : undefined,
  );
  const verificationDescribedBy = mergeDescribedBy(
    'auth-verify-message',
    verificationState?.error ? 'auth-verify-error' : undefined,
  );
  const toastClassName = toast ? (toast.isError ? 'toast-error' : 'toast-success') : 'toast-hidden';

  return (
    <>
      <div className="auth-ambient auth-ambient-one" aria-hidden="true" />
      <div className="auth-ambient auth-ambient-two" aria-hidden="true" />
      <div className="auth-ambient auth-ambient-grid" aria-hidden="true" />

      <main className="react-auth-page auth-page-shell fade-in-up">
        <header className="auth-site-header">
          <a className="auth-brand" href="/">
            <div className="mascot-blip" aria-hidden="true">
              <div className="blip-eye left" />
              <div className="blip-eye right" />
            </div>
            <span>Minimalist</span>
          </a>
          <a className="auth-home-link" href="/">
            <i className="ph-bold ph-arrow-left" aria-hidden="true" />
            <span>Back to site</span>
          </a>
        </header>

        <AuthSignalScene />

        <section id="auth-box" className={`brutalist-auth-card auth-panel ${busy ? 'is-busy' : ''}`} aria-busy={busy}>
          <div className="auth-panel-top">
            <div>
              <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
              <p className="auth-panel-subtitle">{mode === 'login' ? 'Log in to Minimalist' : 'Start a calmer room'}</p>
            </div>
          </div>

          <div className="auth-toggle" role="tablist" aria-label="Choose authentication mode">
            <button
              ref={loginTabRef}
              id="auth-tab-login"
              type="button"
              className={`toggle-btn ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setAuthMode('login')}
              onKeyDown={handleModeTabsKeyDown}
              role="tab"
              aria-controls="auth-tabpanel-login"
              aria-selected={mode === 'login'}
              tabIndex={mode === 'login' ? 0 : -1}
            >
              Log In
            </button>
            <button
              ref={signupTabRef}
              id="auth-tab-signup"
              type="button"
              className={`toggle-btn ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => setAuthMode('signup')}
              onKeyDown={handleModeTabsKeyDown}
              role="tab"
              aria-controls="auth-tabpanel-signup"
              aria-selected={mode === 'signup'}
              tabIndex={mode === 'signup' ? 0 : -1}
            >
              Sign Up
            </button>
          </div>

          {verificationState ? (
            <section
              className="auth-verify-card"
              aria-describedby={verificationDescribedBy}
              aria-labelledby="auth-verify-title"
              aria-live="polite"
            >
              <p className="auth-step-pill">Verification required</p>
              <h3 id="auth-verify-title">Verify your email before opening chat.</h3>
              <p id="auth-verify-message">{verificationState.message}</p>
              {verificationState.error ? <p id="auth-verify-error" className="auth-inline-error">{verificationState.error}</p> : null}
              <div className="auth-verify-actions">
                <button type="button" className="auth-submit-btn" disabled={busy} onClick={confirmVerifiedEmail}>
                  {busy ? 'Checking…' : "I've Verified"}
                </button>
                <button type="button" className="action-btn auth-back-btn" disabled={busy} onClick={resendVerificationEmail}>
                  Resend Email
                </button>
                <button type="button" className="text-link auth-verify-link" disabled={busy} onClick={switchAccountForVerification}>
                  Use Another Account
                </button>
              </div>
            </section>
          ) : mode === 'login' ? (
            <form
              id="auth-tabpanel-login"
              className="auth-form active"
              onSubmit={handleLogin}
              data-step={loginStep}
              noValidate
              role="tabpanel"
              aria-labelledby="auth-tab-login"
            >
              <div className="auth-form-heading">
                <span className="auth-step-pill">{loginStepMeta.badge}</span>
                <h3>{loginStepMeta.title}</h3>
                <p>{loginStepMeta.copy}</p>
              </div>
              <GoogleIdentityAuthButton
                busy={busy}
                mode={mode}
                remember={remember}
                onFallbackClick={handleGoogle}
                onResult={handleGoogleIdentityResult}
                onError={handleGoogleError}
                setBusy={setBusy}
              />
              <div className="auth-divider"><span>OR USE EMAIL</span></div>
              {loginStep === 1 ? (
                <div className="auth-step-content">
                  <div className="input-group mt-1">
                    <label htmlFor="login-email">EMAIL ADDRESS</label>
                    <input
                      ref={loginEmailInput}
                      type="email"
                      id="login-email"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(event) => {
                        setLoginEmail(event.target.value);
                        updateFieldErrors(['loginEmail'], {});
                      }}
                      onKeyDown={(event) => continueOnEnter(event, continueLogin)}
                      autoComplete="email"
                      aria-describedby={fieldErrors.loginEmail ? 'login-email-error' : undefined}
                      aria-invalid={fieldErrors.loginEmail ? 'true' : 'false'}
                      required
                    />
                    {fieldErrors.loginEmail ? <p id="login-email-error" className="auth-inline-error">{fieldErrors.loginEmail}</p> : null}
                  </div>
                  <button type="button" className="auth-submit-btn" disabled={busy} onClick={continueLogin}>Continue</button>
                </div>
              ) : (
                <div className="auth-step-content">
                  <PasswordField
                    id="login-password"
                    inputRef={loginPasswordInput}
                    label="PASSWORD"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(value) => {
                      setLoginPassword(value);
                      updateFieldErrors(['loginPassword'], {});
                    }}
                    describedBy={fieldErrors.loginPassword ? 'login-password-error' : undefined}
                    error={fieldErrors.loginPassword}
                  />
                  {fieldErrors.loginPassword ? <p id="login-password-error" className="auth-inline-error">{fieldErrors.loginPassword}</p> : null}
                  <label className="remember-me">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                    />{' '}
                    Remember me
                  </label>
                  <button type="submit" className="auth-submit-btn" disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign In'}
                  </button>
                  <button type="button" className="action-btn mt-1 auth-back-btn" disabled={busy} onClick={returnToLoginEmail}>
                    Back
                  </button>
                  <a href="#reset-password" className="text-link" onClick={handlePasswordReset}>Forgot Password?</a>
                </div>
              )}
            </form>
          ) : (
            <form
              id="auth-tabpanel-signup"
              className="auth-form active"
              onSubmit={handleSignup}
              data-step={signupStep}
              noValidate
              role="tabpanel"
              aria-labelledby="auth-tab-signup"
            >
              <div className="auth-form-heading">
                <span className="auth-step-pill">{signupStepMeta.badge}</span>
                <h3>{signupStepMeta.title}</h3>
                <p>{signupStepMeta.copy}</p>
              </div>
              <GoogleIdentityAuthButton
                busy={busy}
                mode={mode}
                remember={remember}
                onFallbackClick={handleGoogle}
                onResult={handleGoogleIdentityResult}
                onError={handleGoogleError}
                setBusy={setBusy}
              />
              <div className="auth-divider"><span>OR USE EMAIL</span></div>
              {signupStep === 1 && (
                <div className="auth-step-content">
                  <div className="input-group mt-1">
                    <label htmlFor="signup-email">EMAIL ADDRESS</label>
                    <input
                      ref={signupEmailInput}
                      type="email"
                      id="signup-email"
                      placeholder="you@example.com"
                      value={signup.email}
                      onChange={(event) => updateSignup('email', event.target.value)}
                      onKeyDown={(event) => continueOnEnter(event, continueSignupEmail)}
                      autoComplete="email"
                      aria-describedby={fieldErrors.email ? 'signup-email-error' : undefined}
                      aria-invalid={fieldErrors.email ? 'true' : 'false'}
                      required
                    />
                    {fieldErrors.email ? <p id="signup-email-error" className="auth-inline-error">{fieldErrors.email}</p> : null}
                  </div>
                  <button type="button" className="auth-submit-btn" disabled={busy} onClick={continueSignupEmail}>Continue</button>
                </div>
              )}
              {signupStep === 2 && (
                <div className="auth-step-content">
                  <div className="input-group mt-1">
                    <label htmlFor="signup-username">USERNAME</label>
                    <input
                      ref={signupNameInput}
                      type="text"
                      id="signup-username"
                      placeholder="ChatName"
                      value={signup.username}
                      onChange={(event) => updateSignup('username', event.target.value)}
                      onKeyDown={(event) => continueOnEnter(event, continueSignupProfile)}
                      autoComplete="username"
                      aria-describedby={fieldErrors.username ? 'signup-username-error' : undefined}
                      aria-invalid={fieldErrors.username ? 'true' : 'false'}
                      required
                    />
                    {fieldErrors.username ? <p id="signup-username-error" className="auth-inline-error">{fieldErrors.username}</p> : null}
                  </div>
                  <div className="input-group">
                    <label htmlFor="signup-birthday">BIRTHDAY <span className="optional-label">(optional)</span></label>
                    <input
                      type="date"
                      id="signup-birthday"
                      value={signup.birthday}
                      onChange={(event) => updateSignup('birthday', event.target.value)}
                      onKeyDown={(event) => continueOnEnter(event, continueSignupProfile)}
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="signup-phone">PHONE NUMBER <span className="optional-label">(optional)</span></label>
                    <input
                      type="tel"
                      id="signup-phone"
                      placeholder="+1..."
                      value={signup.phone}
                      onChange={(event) => updateSignup('phone', event.target.value)}
                      onKeyDown={(event) => continueOnEnter(event, continueSignupProfile)}
                      autoComplete="tel"
                    />
                  </div>
                  <button type="button" className="auth-submit-btn" disabled={busy} onClick={continueSignupProfile}>Continue</button>
                  <button type="button" className="action-btn mt-1 auth-back-btn" disabled={busy} onClick={returnToSignupEmail}>Back</button>
                </div>
              )}
              {signupStep === 3 && (
                <div className="auth-step-content">
                  <div className="mt-1">
                    <PasswordField
                      id="signup-password"
                      inputRef={signupPasswordInput}
                      label="PASSWORD"
                      placeholder="Min. 6 characters"
                      value={signup.password}
                      onChange={(value) => updateSignup('password', value)}
                      describedBy={signupPasswordDescribedBy}
                      error={fieldErrors.password}
                    />
                    {fieldErrors.password ? <p id="signup-password-error" className="auth-inline-error">{fieldErrors.password}</p> : null}
                    <div
                      className="pw-strength"
                      role="progressbar"
                      aria-label="Password strength"
                      aria-valuemin="0"
                      aria-valuemax="5"
                      aria-valuenow={strength}
                    >
                      <div
                        className="pw-strength-bar"
                        style={{ width: `${strength * 20}%`, background: strengthColors[strength] }}
                      />
                    </div>
                    <div id="signup-password-strength-label" className="pw-strength-label" aria-live="polite" style={{ color: strengthColors[strength] }}>
                      {signup.password ? strengthLabels[strength] : ''}
                    </div>
                  </div>
                  <PasswordField
                    id="signup-confirm"
                    label="CONFIRM PASSWORD"
                    placeholder="Re-enter password"
                    value={signup.confirm}
                    onChange={(value) => updateSignup('confirm', value)}
                    describedBy={signupConfirmDescribedBy}
                    error={fieldErrors.confirm}
                  />
                  {fieldErrors.confirm ? <p id="signup-confirm-error" className="auth-inline-error">{fieldErrors.confirm}</p> : null}
                  <div id="signup-confirm-match" className="pw-match" aria-live="polite" style={{ color: passwordsMatch ? '#43a047' : '#e53935' }}>
                    {signup.confirm ? (passwordsMatch ? '✓ Passwords match' : '✗ Passwords do not match') : ''}
                  </div>
                  <button type="submit" className="auth-submit-btn" disabled={busy}>
                    {busy ? 'Creating…' : 'Create Account'}
                  </button>
                  <button type="button" className="action-btn mt-1 auth-back-btn" disabled={busy} onClick={returnToSignupProfile}>Back</button>
                </div>
              )}
            </form>
          )}
        </section>
      </main>

      <div id="brutalist-toast" className={toastClassName} role={toast?.isError ? 'alert' : 'status'} aria-live="polite" aria-hidden={!toast} hidden={!toast}>
        <span id="toast-icon">{toast?.isError ? '⚠️' : '✅'}</span>
        <span id="toast-message">{toast?.message || ''}</span>
        <button type="button" id="toast-close" aria-label="Close notification" tabIndex={toast ? 0 : -1} onClick={() => setToast(null)}>✖</button>
      </div>
    </>
  );
}
