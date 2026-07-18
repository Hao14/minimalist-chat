import { getAuthedJsonHeaders } from '../../lib/authToken.js';

const DEFAULT_ROOM_BILLING_ENDPOINTS = Object.freeze({
  checkout: 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateRoomCheckoutSession',
  sync: 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeSyncRoomCheckoutSession',
  portal: 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateRoomPortalSession',
  users: 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeUpdateRoomBenefitUsers',
});

const ROOM_PLAN_USER_LIMITS = Object.freeze({ advanced: 20, pro: 50 });
const REQUEST_TIMEOUT_MS = 20_000;

function browserWindow() {
  return globalThis.window || {};
}

function roomBillingEndpoint(kind) {
  const appWindow = browserWindow();
  const configured = {
    checkout: appWindow.ROOM_BILLING_CHECKOUT_ENDPOINT,
    sync: appWindow.ROOM_BILLING_SYNC_ENDPOINT,
    portal: appWindow.ROOM_BILLING_PORTAL_ENDPOINT,
    users: appWindow.ROOM_BILLING_USERS_ENDPOINT,
  }[kind];
  return String(configured || DEFAULT_ROOM_BILLING_ENDPOINTS[kind] || '').trim();
}

function currentOrigin() {
  return String(browserWindow().location?.origin || '').trim();
}

function containsInvalidFirebaseKeyCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return '.#$[]/'.includes(character) || codePoint <= 31 || codePoint === 127;
  });
}

function requiredRoomId(value) {
  const roomId = String(value || '').trim();
  if (!roomId || roomId === 'global' || containsInvalidFirebaseKeyCharacter(roomId)) {
    const error = new Error('Choose a private room first.');
    error.code = 'invalid_room';
    error.status = 400;
    throw error;
  }
  return roomId;
}

function requiredRoomPlan(value) {
  const plan = String(value || '').trim().toLowerCase();
  if (!ROOM_PLAN_USER_LIMITS[plan]) {
    const error = new Error('Choose Advanced Room or Pro Room.');
    error.code = 'unknown_room_plan';
    error.status = 400;
    throw error;
  }
  return plan;
}

function validUserId(value) {
  const uid = String(value || '').trim();
  return uid.length > 0
    && uid.length <= 128
    && !containsInvalidFirebaseKeyCharacter(uid);
}

export function normalizeRoomBenefitUserIds(value) {
  const rawUserIds = Array.isArray(value)
    ? value
    : Object.entries(value && typeof value === 'object' ? value : {})
      .filter(([, selected]) => selected === true)
      .map(([uid]) => uid);
  const userIds = [];
  const seen = new Set();
  rawUserIds.forEach((rawUid) => {
    const uid = String(rawUid || '').trim();
    if (!validUserId(uid)) {
      const error = new Error('A selected user ID is invalid.');
      error.code = 'invalid_selected_user';
      error.status = 400;
      throw error;
    }
    if (seen.has(uid)) return;
    seen.add(uid);
    userIds.push(uid);
  });
  return userIds.sort();
}

async function postRoomBilling(kind, payload) {
  const endpoint = roomBillingEndpoint(kind);
  if (!endpoint) {
    const error = new Error('Room billing is not configured yet.');
    error.code = 'room_billing_not_configured';
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: await getAuthedJsonHeaders('Please sign in before managing room billing.'),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Room billing request failed.');
      error.code = data.code || 'room_billing_failed';
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('The room billing request timed out.');
      timeoutError.code = 'request_timeout';
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function createRoomCheckout({ roomId: rawRoomId, plan: rawPlan, selectedUserIds = [], origin = currentOrigin() }) {
  const roomId = requiredRoomId(rawRoomId);
  const plan = requiredRoomPlan(rawPlan);
  const userIds = normalizeRoomBenefitUserIds(selectedUserIds);
  const maxSelectedUsers = ROOM_PLAN_USER_LIMITS[plan];
  if (userIds.length > maxSelectedUsers) {
    const error = new Error(`${plan === 'pro' ? 'Pro Room' : 'Advanced Room'} supports up to ${maxSelectedUsers} selected users.`);
    error.code = 'selected_user_limit';
    error.status = 400;
    throw error;
  }
  return postRoomBilling('checkout', { roomId, plan, selectedUserIds: userIds, origin });
}

export async function syncRoomCheckout({ roomId: rawRoomId, sessionId: rawSessionId }) {
  const roomId = requiredRoomId(rawRoomId);
  const sessionId = String(rawSessionId || '').trim();
  if (!sessionId.startsWith('cs_')) {
    const error = new Error('Missing room checkout session ID.');
    error.code = 'invalid_checkout_session';
    error.status = 400;
    throw error;
  }
  return postRoomBilling('sync', { roomId, sessionId });
}

export async function createRoomBillingPortal({ roomId: rawRoomId, origin = currentOrigin() }) {
  return postRoomBilling('portal', { roomId: requiredRoomId(rawRoomId), origin });
}

export async function updateRoomBenefitUsers({ roomId: rawRoomId, selectedUserIds = [] }) {
  return postRoomBilling('users', {
    roomId: requiredRoomId(rawRoomId),
    selectedUserIds: normalizeRoomBenefitUserIds(selectedUserIds),
  });
}

export async function redirectToRoomCheckout(options) {
  const data = await createRoomCheckout(options);
  if (!data.url) throw new Error('Stripe did not return a room checkout URL.');
  browserWindow().location.assign(data.url);
  return data;
}

export async function redirectToRoomBillingPortal(options) {
  const data = await createRoomBillingPortal(options);
  if (!data.url) throw new Error('Stripe did not return a room billing portal URL.');
  browserWindow().location.assign(data.url);
  return data;
}

export function readRoomBillingReturn(search = browserWindow().location?.search || '') {
  const params = new URLSearchParams(search);
  const status = String(params.get('room_billing') || '');
  if (!status) return null;
  return {
    status,
    roomId: String(params.get('room_id') || ''),
    sessionId: String(params.get('session_id') || ''),
  };
}
