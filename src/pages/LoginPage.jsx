import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { auth, db } from '../lib/firebase.js';
import { ensureAuthProfile, isGoogleAuthUser, syncPublicUserDirectory } from '../lib/authProfile.js';

const strengthLabels = ['', 'Weak', 'Weak', 'Fair', 'Good', 'Strong'];
const strengthColors = ['#ccc', '#e53935', '#e53935', '#fb8c00', '#fdd835', '#43a047'];

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
    'auth/operation-not-allowed': 'Google sign-in is not enabled for this project yet.',
    'auth/operation-not-supported-in-this-environment': 'This browser needs Google sign-in to open in the current tab.',
    'auth/popup-blocked': 'The sign-in popup was blocked by your browser.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/unauthorized-domain': 'This domain is not authorized for Google sign-in in Firebase.',
    'auth/weak-password': 'Use a stronger password with at least 6 characters.',
  };
  return messages[error?.code] || 'Something went wrong. Please try again.';
}

function createGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function prefersRedirectGoogleAuth() {
  if (typeof window === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const mobileAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrowScreen = window.matchMedia?.('(max-width: 820px)')?.matches;
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone;
  return Boolean(mobileAgent || (coarsePointer && narrowScreen) || standalone);
}

function shouldRedirectAfterPopupError(error) {
  return [
    'auth/popup-blocked',
    'auth/cancelled-popup-request',
    'auth/operation-not-supported-in-this-environment',
  ].includes(error?.code);
}

function PasswordField({ id, label, placeholder, value, onChange }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={id === 'login-password' ? 'current-password' : 'new-password'}
          required
        />
        <button type="button" className="pw-toggle" onClick={() => setVisible((current) => !current)}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState('login');
  const [loginStep, setLoginStep] = useState(1);
  const [signupStep, setSignupStep] = useState(1);
  const [busy, setBusy] = useState(() => sessionStorage.getItem('googleAuthRedirectPending') === '1');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [remember, setRemember] = useState(true);
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
  const loginEmailInput = useRef(null);
  const signupEmailInput = useRef(null);
  const signupNameInput = useRef(null);
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  const usesRedirectGoogleAuth = prefersRedirectGoogleAuth();
  const strength = useMemo(() => passwordStrength(signup.password), [signup.password]);
  const passwordsMatch = signup.confirm && signup.confirm === signup.password;

  const showToast = (message, isError = true) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const previousTitle = document.title;
    const previousClass = document.body.className;
    const previousStyle = document.body.getAttribute('style');
    document.title = 'Minimalist | Enter';
    document.body.className = 'auth-screen';
    document.body.setAttribute(
      'style',
      'display:block;min-height:100vh;margin:0;padding:0;overflow-y:auto;',
    );

    let handledAuth = false;
    const finishSignedInUser = async (user, welcome = false) => {
      if (!user || handledAuth) return;
      handledAuth = true;
      sessionStorage.removeItem('googleAuthRedirectPending');
      try {
        if (isGoogleAuthUser(user)) await ensureAuthProfile(user, { welcome });
      } catch (error) {
        showToast(`Signed in, but profile setup needs a retry: ${error.message}`);
        handledAuth = false;
        setBusy(false);
        return;
      }
      window.location.replace('/chat');
    };

    getRedirectResult(auth)
      .then((result) => finishSignedInUser(result?.user, true))
      .catch((error) => {
        sessionStorage.removeItem('googleAuthRedirectPending');
        if (error?.code !== 'auth/popup-closed-by-user') showToast(friendlyAuthError(error));
        setBusy(false);
      });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) finishSignedInUser(user);
    });

    return () => {
      unsubscribe();
      window.clearTimeout(toastTimer.current);
      document.title = previousTitle;
      document.body.className = previousClass;
      if (previousStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', previousStyle);
    };
  }, []);

  const updateSignup = (field, value) => {
    setSignup((current) => ({ ...current, [field]: value }));
  };

  const continueLogin = () => {
    if (loginEmailInput.current?.reportValidity()) setLoginStep(2);
  };

  const continueSignupEmail = () => {
    if (signupEmailInput.current?.reportValidity()) setSignupStep(2);
  };

  const continueSignupProfile = () => {
    if (signupNameInput.current?.reportValidity()) setSignupStep(3);
  };

  const continueOnEnter = (event, nextStep) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    nextStep();
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    if (loginStep === 1) {
      continueLogin();
      return;
    }

    setBusy(true);
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      window.location.replace('/chat');
    } catch (error) {
      showToast(friendlyAuthError(error));
      setBusy(false);
    }
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    if (signupStep === 1) {
      continueSignupEmail();
      return;
    }
    if (signupStep === 2) {
      continueSignupProfile();
      return;
    }

    if (signup.password !== signup.confirm) {
      showToast('Passwords do not match.');
      return;
    }
    if (signup.password.length < 6) {
      showToast('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, signup.email.trim(), signup.password);
      await updateProfile(credential.user, { displayName: signup.username.trim() });
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
        badges: {
          welcome: Date.now(),
        },
      };
      await set(ref(db, `users/${credential.user.uid}`), profile);
      await syncPublicUserDirectory(credential.user, profile);
      sessionStorage.setItem('showWelcomeTour', '1');
      window.location.replace('/chat');
    } catch (error) {
      showToast(friendlyAuthError(error));
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    try {
      await setPersistence(auth, mode === 'login' && !remember ? browserSessionPersistence : browserLocalPersistence);
      const provider = createGoogleProvider();
      if (usesRedirectGoogleAuth) {
        sessionStorage.setItem('googleAuthRedirectPending', '1');
        await signInWithRedirect(auth, provider);
        return;
      }
      const credential = await signInWithPopup(auth, provider);
      await ensureAuthProfile(credential.user, { welcome: true });
      window.location.replace('/chat');
    } catch (error) {
      if (shouldRedirectAfterPopupError(error)) {
        try {
          sessionStorage.setItem('googleAuthRedirectPending', '1');
          await signInWithRedirect(auth, createGoogleProvider());
        } catch (redirectError) {
          sessionStorage.removeItem('googleAuthRedirectPending');
          showToast(friendlyAuthError(redirectError));
          setBusy(false);
        }
        return;
      }
      if (error?.code !== 'auth/popup-closed-by-user') showToast(friendlyAuthError(error));
      setBusy(false);
    }
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    if (!loginEmailInput.current?.reportValidity()) {
      setLoginStep(1);
      return;
    }
    try {
      await sendPasswordResetEmail(auth, loginEmail.trim());
      showToast('Password reset email sent.', false);
    } catch (error) {
      showToast(friendlyAuthError(error));
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
          copy: 'Use your password or continue with Google if this is a mobile browser.',
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

  return (
    <>
      <div className="auth-ambient auth-ambient-one" aria-hidden="true" />
      <div className="auth-ambient auth-ambient-two" aria-hidden="true" />
      <div className="auth-ambient auth-ambient-grid" aria-hidden="true" />

      <main className="react-auth-page auth-page-shell fade-in-up">
        <section className="auth-hero-panel" aria-label="Minimalist sign in overview">
          <a className="auth-brand" href="/">
            <span className="auth-brand-mark">
              <span />
              <span />
            </span>
            <span>Minimalist</span>
          </a>

          <div className="auth-hero-copy">
            <p className="auth-eyebrow">Rooms that stay calm</p>
            <h1>Come back to a quieter workspace.</h1>
            <p>
              Message, share, plan, and remember what matters without the noisy feed feeling.
            </p>
          </div>

          <div className="auth-live-card" aria-hidden="true">
            <div className="auth-live-top">
              <span className="auth-pulse-dot" />
              <span>secure room session</span>
            </div>
            <div className="auth-code-lines">
              <span style={{ width: '78%' }} />
              <span style={{ width: '56%' }} />
              <span style={{ width: '88%' }} />
            </div>
            <div className="auth-mini-room">
              <span># study-room</span>
              <strong>3 new replies</strong>
            </div>
          </div>

          <div className="auth-benefits" aria-label="Product highlights">
            <span>Private rooms</span>
            <span>Smart tools</span>
            <span>Clean mobile</span>
          </div>
        </section>

        <section id="auth-box" className={`brutalist-auth-card auth-panel ${busy ? 'is-busy' : ''}`} aria-busy={busy}>
          <div className="auth-panel-top">
            <div>
              <p className="auth-eyebrow">{mode === 'login' ? 'Welcome back' : 'New here?'}</p>
              <h2>{mode === 'login' ? 'Log in to Minimalist' : 'Create your account'}</h2>
            </div>
            <a className="auth-home-link" href="/">Home</a>
          </div>

          <div className="auth-toggle" role="tablist" aria-label="Choose authentication mode">
            <button
              type="button"
              className={`toggle-btn ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setMode('login')}
              aria-selected={mode === 'login'}
            >
              Log In
            </button>
            <button
              type="button"
              className={`toggle-btn ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => setMode('signup')}
              aria-selected={mode === 'signup'}
            >
              Sign Up
            </button>
          </div>

          {mode === 'login' ? (
            <form className="auth-form active" onSubmit={handleLogin} data-step={loginStep}>
              <div className="auth-form-heading">
                <span className="auth-step-pill">{loginStepMeta.badge}</span>
                <h3>{loginStepMeta.title}</h3>
                <p>{loginStepMeta.copy}</p>
              </div>
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
                      onChange={(event) => setLoginEmail(event.target.value)}
                      onKeyDown={(event) => continueOnEnter(event, continueLogin)}
                      autoComplete="email"
                      required
                    />
                  </div>
                  <button type="button" className="auth-submit-btn" onClick={continueLogin}>Continue</button>
                </div>
              ) : (
                <div className="auth-step-content">
                  <PasswordField
                    id="login-password"
                    label="PASSWORD"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={setLoginPassword}
                  />
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
                  <button type="button" className="action-btn mt-1 auth-back-btn" onClick={() => setLoginStep(1)}>
                    Back
                  </button>
                  <a href="#reset-password" className="text-link" onClick={handlePasswordReset}>Forgot Password?</a>
                </div>
              )}
              {!isNative && (
                <>
                  <div className="auth-divider"><span>OR</span></div>
                  <button type="button" className="google-btn" disabled={busy} onClick={handleGoogle}>
                    <span className="google-mark" aria-hidden="true">G</span>
                    {usesRedirectGoogleAuth ? 'Continue with Google' : 'Sign In with Google'}
                  </button>
                </>
              )}
            </form>
          ) : (
            <form className="auth-form active" onSubmit={handleSignup} data-step={signupStep}>
              <div className="auth-form-heading">
                <span className="auth-step-pill">{signupStepMeta.badge}</span>
                <h3>{signupStepMeta.title}</h3>
                <p>{signupStepMeta.copy}</p>
              </div>
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
                      required
                    />
                  </div>
                  <button type="button" className="auth-submit-btn" onClick={continueSignupEmail}>Continue</button>
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
                      required
                    />
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
                  <button type="button" className="auth-submit-btn" onClick={continueSignupProfile}>Continue</button>
                  <button type="button" className="action-btn mt-1 auth-back-btn" onClick={() => setSignupStep(1)}>Back</button>
                </div>
              )}
              {signupStep === 3 && (
                <div className="auth-step-content">
                  <div className="mt-1">
                    <PasswordField
                      id="signup-password"
                      label="PASSWORD"
                      placeholder="Min. 6 characters"
                      value={signup.password}
                      onChange={(value) => updateSignup('password', value)}
                    />
                    <div className="pw-strength">
                      <div
                        className="pw-strength-bar"
                        style={{ width: `${strength * 20}%`, background: strengthColors[strength] }}
                      />
                    </div>
                    <div className="pw-strength-label" style={{ color: strengthColors[strength] }}>
                      {signup.password ? strengthLabels[strength] : ''}
                    </div>
                  </div>
                  <PasswordField
                    id="signup-confirm"
                    label="CONFIRM PASSWORD"
                    placeholder="Re-enter password"
                    value={signup.confirm}
                    onChange={(value) => updateSignup('confirm', value)}
                  />
                  <div className="pw-match" style={{ color: passwordsMatch ? '#43a047' : '#e53935' }}>
                    {signup.confirm ? (passwordsMatch ? '✓ Passwords match' : '✗ Passwords do not match') : ''}
                  </div>
                  <button type="submit" className="auth-submit-btn" disabled={busy}>
                    {busy ? 'Creating…' : 'Create Account'}
                  </button>
                  <button type="button" className="action-btn mt-1 auth-back-btn" onClick={() => setSignupStep(2)}>Back</button>
                </div>
              )}
              {!isNative && (
                <>
                  <div className="auth-divider"><span>OR</span></div>
                  <button type="button" className="google-btn" disabled={busy} onClick={handleGoogle}>
                    <span className="google-mark" aria-hidden="true">G</span>
                    {usesRedirectGoogleAuth ? 'Continue with Google' : 'Sign Up with Google'}
                  </button>
                </>
              )}
            </form>
          )}
        </section>
      </main>

      <div id="brutalist-toast" className={toast ? '' : 'toast-hidden'} role="status" aria-live="polite">
        <span id="toast-icon">{toast?.isError ? '⚠️' : '✅'}</span>
        <span id="toast-message">{toast?.message || ''}</span>
        <button type="button" id="toast-close" aria-label="Close notification" onClick={() => setToast(null)}>✖</button>
      </div>
    </>
  );
}
