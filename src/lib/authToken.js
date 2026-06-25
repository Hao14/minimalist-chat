import { auth } from './firebase.js';

export async function getRequiredIdToken(message = 'Please sign in before using this feature.') {
  const user = window.currentUser || auth.currentUser || null;
  if (!user?.getIdToken) {
    const error = new Error(message);
    error.status = 401;
    throw error;
  }
  return user.getIdToken();
}
