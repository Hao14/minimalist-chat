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

function configuredSameOriginAuthDomains() {
  if (typeof window === 'undefined') return sameOriginAuthDomains;

  const configuredHosts = new Set([
    ...sameOriginAuthDomains,
    ...(Array.isArray(window.FIREBASE_AUTH_SAME_ORIGIN_HOSTS) ? window.FIREBASE_AUTH_SAME_ORIGIN_HOSTS : []),
    ...String(window.FIREBASE_AUTH_SAME_ORIGIN_HOSTS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ]);

  return configuredHosts;
}

function resolveAuthDomain() {
  if (typeof window === 'undefined') return defaultAuthDomain;
  if (window.FIREBASE_AUTH_DOMAIN) return String(window.FIREBASE_AUTH_DOMAIN).trim();
  return configuredSameOriginAuthDomains().has(window.location.hostname)
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
let appCheckPromise = null;

function appCheckSiteKey() {
  if (typeof window === 'undefined') return '';
  return String(window.FIREBASE_APP_CHECK_SITE_KEY || window.FIREBASE_APPCHECK_SITE_KEY || '').trim();
}

export function isAppCheckConfigured() {
  return Boolean(appCheckSiteKey());
}

export async function getAppCheckHeaders(forceRefresh = false) {
  const siteKey = appCheckSiteKey();
  if (!siteKey) return {};

  if (!appCheckPromise) {
    appCheckPromise = import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      if (typeof window !== 'undefined' && window.FIREBASE_APP_CHECK_DEBUG_TOKEN) {
        globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = window.FIREBASE_APP_CHECK_DEBUG_TOKEN === true
          ? true
          : String(window.FIREBASE_APP_CHECK_DEBUG_TOKEN);
      }
      return initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    });
  }

  try {
    const [{ getToken }, appCheck] = await Promise.all([
      import('firebase/app-check'),
      appCheckPromise,
    ]);
    const result = await getToken(appCheck, forceRefresh);
    return result?.token ? { 'X-Firebase-AppCheck': result.token } : {};
  } catch (error) {
    console.warn('Firebase App Check token unavailable', error);
    return {};
  }
}

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
