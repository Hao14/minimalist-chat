import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase.js';

export function observeMarketingAuthState(callback) {
  return onAuthStateChanged(auth, (user) => callback(Boolean(user)));
}
