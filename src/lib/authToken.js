import { signOut } from 'firebase/auth';
import { recoverInvalidAuthSession } from './authSessionRecovery.js';
import { writeAuthPresenceHint } from './authPresenceHint.js';
import { auth, getAppCheckHeaders } from './firebase.js';
import { requestGoogleIdentitySessionReset } from './googleIdentityAuth.js';

export async function getRequiredIdToken(message = 'Please sign in before using this feature.') {
  const user = window.currentUser || auth.currentUser || null;
  if (!user?.getIdToken) {
    const error = new Error(message);
    error.status = 401;
    throw error;
  }
  try {
    return await user.getIdToken();
  } catch (error) {
    const recovery = await recoverInvalidAuthSession({
      auth,
      error,
      requestProviderReset: requestGoogleIdentitySessionReset,
      signOut,
    });
    if (!recovery.recovered) throw error;

    window.currentUser = null;
    writeAuthPresenceHint(false);
    const recoveryError = new Error(recovery.message);
    recoveryError.cause = error;
    recoveryError.code = error?.code || 'auth/user-token-expired';
    recoveryError.status = 401;
    throw recoveryError;
  }
}

export async function getAuthedJsonHeaders(message = 'Please sign in before using this feature.') {
  const token = await getRequiredIdToken(message);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(await getAppCheckHeaders()),
  };
}
