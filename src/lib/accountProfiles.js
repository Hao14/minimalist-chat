import { normalizeStoredAvatarUrl } from './avatar.js';

const SAVED_ACCOUNTS_KEY = 'minimalist.saved-accounts.v1';
const SAVED_ACCOUNTS_EVENT = 'minimalist:saved-accounts';
const MAX_SAVED_ACCOUNTS = 8;

function safeRead() {
  try {
    const value = JSON.parse(window.localStorage?.getItem(SAVED_ACCOUNTS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function safeWrite(accounts) {
  try {
    window.localStorage?.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // The active Firebase session still works when local account hints cannot persist.
  }
  window.dispatchEvent(new CustomEvent(SAVED_ACCOUNTS_EVENT, { detail: { accounts } }));
}

function providerForUser(user) {
  const providers = Array.isArray(user?.providerData) ? user.providerData : [];
  return providers.some((provider) => provider?.providerId === 'google.com') ? 'google' : 'password';
}

function normalizeAccount(account = {}) {
  const uid = String(account.uid || '').trim();
  if (!uid) return null;
  return {
    uid,
    displayName: String(account.displayName || account.email || 'Minimalist user').slice(0, 120),
    email: String(account.email || '').slice(0, 180),
    photoUrl: normalizeStoredAvatarUrl(account.photoUrl).slice(0, 2048),
    provider: account.provider === 'google' ? 'google' : 'password',
    lastUsedAt: Number(account.lastUsedAt || 0),
  };
}

export function readSavedAccounts() {
  return safeRead()
    .map(normalizeAccount)
    .filter(Boolean)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_SAVED_ACCOUNTS);
}

export function rememberAccount(user, profile = {}) {
  if (!user?.uid) return null;
  const accounts = readSavedAccounts();
  const previous = accounts.find((account) => account.uid === user.uid) || {};
  const nextAccount = normalizeAccount({
    ...previous,
    uid: user.uid,
    displayName: profile.displayName || user.displayName || previous.displayName,
    email: user.email || previous.email,
    photoUrl: profile.photoUrl || user.photoURL || previous.photoUrl,
    provider: providerForUser(user),
    lastUsedAt: Date.now(),
  });
  const nextAccounts = [
    nextAccount,
    ...accounts.filter((account) => account.uid !== nextAccount.uid),
  ].slice(0, MAX_SAVED_ACCOUNTS);
  safeWrite(nextAccounts);
  return nextAccount;
}

export function forgetSavedAccount(uid) {
  const nextAccounts = readSavedAccounts().filter((account) => account.uid !== uid);
  safeWrite(nextAccounts);
  return nextAccounts;
}

export { SAVED_ACCOUNTS_EVENT, SAVED_ACCOUNTS_KEY };
