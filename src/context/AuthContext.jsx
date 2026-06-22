// Replaces the legacy auth.js: the window.currentUser / window.userProfileName
// globals and the imperative onAuthStateChanged page-router become a single
// React context. Components read auth state via useAuth() and the router
// (App.jsx) handles redirects declaratively instead of window.location.replace.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { get, ref, set } from 'firebase/database';
import { auth, db } from '../lib/firebase';
import { generateShortId, getAvatarUrl } from '../lib/avatar';

const AuthContext = createContext(null);

const EMPTY_PROFILE = {
  displayName: 'Anonymous',
  photoUrl: '',
  pronouns: '',
  bio: '',
  themeColor: '#FFD700',
  status: '',
  links: [],
  shortId: '',
  tier: 'free',
  phoneNumber: 'No phone on file',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  // 'loading' until the first auth state resolves; then 'ready'.
  const [authStatus, setAuthStatus] = useState('loading');
  // Whether the signed-in user has completed profile setup.
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);

  const loadProfile = useCallback(async (uid) => {
    const snapshot = await get(ref(db, 'users/' + uid));
    if (!snapshot.exists()) {
      setNeedsProfileSetup(true);
      setProfile(null);
      return;
    }
    const data = snapshot.val();
    const merged = {
      displayName: data.displayName || 'Anonymous',
      photoUrl: data.photoUrl || '',
      pronouns: data.pronouns || '',
      bio: data.bio || '',
      themeColor: data.themeColor || '#FFD700',
      status: data.status || '',
      links: Array.isArray(data.links) ? data.links : [],
      tier: data.tier || 'free',
      phoneNumber: data.phoneNumber || 'No phone on file',
      shortId: data.shortId || '',
    };

    // Backfill a shortId for legacy accounts that never had one.
    if (!data.shortId) {
      merged.shortId = generateShortId();
      await set(ref(db, 'users/' + uid + '/shortId'), merged.shortId);
    }
    if (!data.createdAt && auth.currentUser) {
      await set(ref(db, 'users/' + uid + '/createdAt'), auth.currentUser.metadata.creationTime);
    }

    setProfile(merged);
    setNeedsProfileSetup(false);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          await loadProfile(u.uid);
        } catch {
          setNeedsProfileSetup(false);
        }
      } else {
        setProfile(null);
        setNeedsProfileSetup(false);
      }
      setAuthStatus('ready');
    });
    return unsub;
  }, [loadProfile]);

  // --- Auth actions (ported from the legacy form/button handlers) ---
  const loginWithEmail = useCallback(
    (email, password) => signInWithEmailAndPassword(auth, email, password),
    [],
  );

  const loginWithGoogle = useCallback(() => signInWithPopup(auth, new GoogleAuthProvider()), []);

  const signUpWithEmail = useCallback(async (email, password, username, phone) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    await set(ref(db, 'users/' + cred.user.uid), {
      displayName: username,
      phoneNumber: phone || '',
      photoUrl: getAvatarUrl(username, ''),
      shortId: generateShortId(),
      themeColor: '#FFD700',
      bio: "I'm new here!",
      pronouns: '',
      createdAt: cred.user.metadata.creationTime,
    });
    return cred;
  }, []);

  // First-time profile creation for Google sign-ins with no DB record yet.
  const completeProfileSetup = useCallback(
    async (name, rawPhoto) => {
      if (!auth.currentUser) return;
      const finalPhotoUrl = getAvatarUrl(name, rawPhoto);
      const shortId = generateShortId();
      await set(ref(db, 'users/' + auth.currentUser.uid), {
        displayName: name,
        photoUrl: finalPhotoUrl,
        shortId,
        themeColor: '#FFD700',
        bio: "I'm new here!",
        pronouns: '',
      });
      await loadProfile(auth.currentUser.uid);
    },
    [loadProfile],
  );

  const logout = useCallback(() => signOut(auth), []);

  const value = {
    user,
    profile: profile || EMPTY_PROFILE,
    authStatus,
    needsProfileSetup,
    isAuthenticated: !!user,
    loginWithEmail,
    loginWithGoogle,
    signUpWithEmail,
    completeProfileSetup,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
