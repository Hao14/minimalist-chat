import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { auth, db } from '../lib/firebase.js';

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
    'auth/email-already-in-use': 'That email already has an account.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/network-request-failed': 'The network is unavailable. Try again in a moment.',
    'auth/popup-blocked': 'The sign-in popup was blocked by your browser.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/weak-password': 'Use a stronger password with at least 6 characters.',
  };
  return messages[error?.code] || 'Something went wrong. Please try again.';
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
  const [busy, setBusy] = useState(false);
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
    document.body.className = 'marketing';
    document.body.setAttribute(
      'style',
      'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem 0;',
    );

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) window.location.replace('/chat');
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

  const handleLogin = async (event) => {
    event.preventDefault();
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
      await set(ref(db, `users/${credential.user.uid}`), {
        displayName: signup.username.trim(),
        phoneNumber: signup.phone.trim(),
        birthday: signup.birthday,
        photoUrl: avatar,
        shortId,
        themeColor: '#FFD700',
        bio: "I'm new here!",
        pronouns: '',
        createdAt: credential.user.metadata.creationTime,
      });
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
      await signInWithPopup(auth, new GoogleAuthProvider());
      window.location.replace('/chat');
    } catch (error) {
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

  return (
    <>
      <div className="shape yellow-circle bottom-left" />
      <div className="shape auth-shape auth-shape-square" />
      <div className="shape auth-shape auth-shape-dot" />
      <div className="shape auth-shape auth-shape-ring" />

      <main className="container fade-in-up react-auth-page">
        <div id="auth-box" className="brutalist-auth-card">
          <div className="auth-toggle">
            <button
              type="button"
              className={`toggle-btn ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setMode('login')}
            >
              Log In
            </button>
            <button
              type="button"
              className={`toggle-btn ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => setMode('signup')}
            >
              Sign Up
            </button>
          </div>

          {mode === 'login' ? (
            <form className="auth-form active" onSubmit={handleLogin}>
              <h1>Welcome <span>Back</span></h1>
              {loginStep === 1 ? (
                <div>
                  <div className="input-group mt-1">
                    <label htmlFor="login-email">EMAIL ADDRESS</label>
                    <input
                      ref={loginEmailInput}
                      type="email"
                      id="login-email"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(event) => setLoginEmail(event.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                  <button type="button" className="auth-submit-btn" onClick={continueLogin}>Next</button>
                </div>
              ) : (
                <div>
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
                    Sign In with Google
                  </button>
                </>
              )}
            </form>
          ) : (
            <form className="auth-form active" onSubmit={handleSignup}>
              <h1>Create <span>Account</span></h1>
              {signupStep === 1 && (
                <div>
                  <div className="input-group mt-1">
                    <label htmlFor="signup-email">EMAIL ADDRESS</label>
                    <input
                      ref={signupEmailInput}
                      type="email"
                      id="signup-email"
                      placeholder="you@example.com"
                      value={signup.email}
                      onChange={(event) => updateSignup('email', event.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                  <button type="button" className="auth-submit-btn" onClick={continueSignupEmail}>Next</button>
                </div>
              )}
              {signupStep === 2 && (
                <div>
                  <div className="input-group mt-1">
                    <label htmlFor="signup-username">USERNAME</label>
                    <input
                      ref={signupNameInput}
                      type="text"
                      id="signup-username"
                      placeholder="ChatName"
                      value={signup.username}
                      onChange={(event) => updateSignup('username', event.target.value)}
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
                      autoComplete="tel"
                    />
                  </div>
                  <button type="button" className="auth-submit-btn" onClick={continueSignupProfile}>Next</button>
                  <button type="button" className="action-btn mt-1 auth-back-btn" onClick={() => setSignupStep(1)}>Back</button>
                </div>
              )}
              {signupStep === 3 && (
                <div>
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
                    Sign Up with Google
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </main>

      <div id="brutalist-toast" className={toast ? '' : 'toast-hidden'} role="status" aria-live="polite">
        <span id="toast-icon">{toast?.isError ? '⚠️' : '✅'}</span>
        <span id="toast-message">{toast?.message || ''}</span>
        <button type="button" id="toast-close" aria-label="Close notification" onClick={() => setToast(null)}>✖</button>
      </div>
    </>
  );
}
