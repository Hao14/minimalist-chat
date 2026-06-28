import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const defaultAuthDomain = 'chat-app-356c1.firebaseapp.com';
const sameOriginAuthDomains = new Set([
  'minimalist.chat',
  'www.minimalist.chat',
  'chat-app-356c1.web.app',
  'chat-app-356c1.firebaseapp.com',
]);

function resolveAuthDomain() {
  if (typeof window === 'undefined') return defaultAuthDomain;
  return sameOriginAuthDomains.has(window.location.hostname)
    ? window.location.hostname
    : defaultAuthDomain;
}

const firebaseConfig = {
  apiKey: 'AIzaSyDAnwh1kYnomfGIMM71J9tCY3tuOV0ejnE',
  authDomain: resolveAuthDomain(),
  databaseURL: 'https://chat-app-356c1-default-rtdb.firebaseio.com',
  projectId: 'chat-app-356c1',
  storageBucket: 'chat-app-356c1.firebasestorage.app',
  messagingSenderId: '327658376387',
  appId: '1:327658376387:web:4a47e25dc8156afb7de676',
  measurementId: 'G-M3DPZWT9LD',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

let storagePromise = null;
let functionsPromise = null;

export function getStorageLazy() {
  if (!storagePromise) {
    storagePromise = import('firebase/storage').then(({ getStorage }) => getStorage(app));
  }
  return storagePromise;
}

export function getFunctionsLazy() {
  if (!functionsPromise) {
    functionsPromise = import('firebase/functions').then(({ getFunctions }) => getFunctions(app));
  }
  return functionsPromise;
}
