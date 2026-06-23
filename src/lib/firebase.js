import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyDAnwh1kYnomfGIMM71J9tCY3tuOV0ejnE',
  authDomain: 'chat-app-356c1.firebaseapp.com',
  databaseURL: 'https://chat-app-356c1-default-rtdb.firebaseio.com',
  projectId: 'chat-app-356c1',
  storageBucket: 'chat-app-356c1.firebasestorage.app',
  messagingSenderId: '327658376387',
  appId: '1:327658376387:web:4a47e25dc8156afb7de676',
  measurementId: 'G-M3DPZWT9LD',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
