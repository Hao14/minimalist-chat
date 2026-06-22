// Migrated from public/login.html + the login/signup handlers in auth.js.
// The multi-step flows that the legacy code drove by toggling .hidden classes
// are now plain React state.
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const { loginWithEmail, signUpWithEmail, loginWithGoogle } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState('login'); // 'login' | 'signup'

  // login flow
  const [loginStep, setLoginStep] = useState(1);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // signup flow
  const [signupStep, setSignupStep] = useState(1);
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    try {
      await loginWithEmail(loginEmail, loginPassword);
    } catch (err) {
      showToast('Login Error: ' + err.message);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    try {
      await signUpWithEmail(signupEmail, signupPassword, signupUsername, signupPhone);
    } catch (err) {
      showToast('Sign Up Error: ' + err.message);
    }
  }

  async function handleGoogle() {
    try {
      await loginWithGoogle();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showToast('Google Sign-In failed: ' + err.message);
      }
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        margin: 0,
      }}
    >
      <div className="shape yellow-circle bottom-left" />

      <div className="container fade-in-up" style={{ width: '100%' }}>
        <div id="auth-box" className="brutalist-auth-card">
          <div className="auth-toggle">
            <button
              className={'toggle-btn' + (mode === 'login' ? ' active' : '')}
              onClick={() => setMode('login')}
            >
              Log In
            </button>
            <button
              className={'toggle-btn' + (mode === 'signup' ? ' active' : '')}
              onClick={() => setMode('signup')}
            >
              Sign Up
            </button>
          </div>

          {mode === 'login' && (
            <form className="auth-form active" onSubmit={handleLogin}>
              <h1>
                Welcome <span>Back</span>
              </h1>

              {loginStep === 1 && (
                <div>
                  <div className="input-group mt-1">
                    <label>EMAIL ADDRESS</label>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="auth-submit-btn"
                    onClick={() => {
                      if (loginEmail.includes('@')) setLoginStep(2);
                    }}
                  >
                    Next
                  </button>
                </div>
              )}

              {loginStep === 2 && (
                <div>
                  <div className="input-group mt-1">
                    <label>PASSWORD</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="auth-submit-btn">
                    Sign In
                  </button>
                  <button
                    type="button"
                    className="action-btn mt-1"
                    style={{ width: '100%', marginTop: '0.5rem' }}
                    onClick={() => setLoginStep(1)}
                  >
                    Back
                  </button>
                </div>
              )}

              <div className="auth-divider">
                <span>OR</span>
              </div>
              <button type="button" className="google-btn" onClick={handleGoogle}>
                Sign In with Google
              </button>
            </form>
          )}

          {mode === 'signup' && (
            <form className="auth-form active" onSubmit={handleSignup}>
              <h1>
                Create <span>Account</span>
              </h1>

              {signupStep === 1 && (
                <div>
                  <div className="input-group mt-1">
                    <label>EMAIL ADDRESS</label>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      required
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="auth-submit-btn"
                    onClick={() => {
                      if (signupEmail.includes('@')) setSignupStep(2);
                    }}
                  >
                    Next
                  </button>
                </div>
              )}

              {signupStep === 2 && (
                <div>
                  <div className="input-group mt-1">
                    <label>USERNAME</label>
                    <input
                      type="text"
                      placeholder="ChatName"
                      required
                      value={signupUsername}
                      onChange={(e) => setSignupUsername(e.target.value)}
                    />
                  </div>
                  <div className="input-group">
                    <label>PHONE NUMBER</label>
                    <input
                      type="tel"
                      placeholder="+1... (Optional)"
                      value={signupPhone}
                      onChange={(e) => setSignupPhone(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="auth-submit-btn"
                    onClick={() => {
                      if (signupUsername.trim()) setSignupStep(3);
                    }}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    className="action-btn mt-1"
                    style={{ width: '100%', marginTop: '0.5rem' }}
                    onClick={() => setSignupStep(1)}
                  >
                    Back
                  </button>
                </div>
              )}

              {signupStep === 3 && (
                <div>
                  <div className="input-group mt-1">
                    <label>PASSWORD</label>
                    <input
                      type="password"
                      placeholder="Min. 6 characters"
                      required
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="auth-submit-btn">
                    Create Account
                  </button>
                  <button
                    type="button"
                    className="action-btn mt-1"
                    style={{ width: '100%', marginTop: '0.5rem' }}
                    onClick={() => setSignupStep(2)}
                  >
                    Back
                  </button>
                </div>
              )}

              <div className="auth-divider">
                <span>OR</span>
              </div>
              <button type="button" className="google-btn" onClick={handleGoogle}>
                Sign Up with Google
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
