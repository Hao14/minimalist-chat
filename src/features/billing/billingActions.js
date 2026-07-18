import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase.js';
import { getAuthedJsonHeaders } from '../../lib/authToken.js';

const DEFAULT_STRIPE_ENDPOINTS = {
  checkout: 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateCheckoutSession',
  portal: 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreatePortalSession',
  sync: 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeSyncCheckoutSession',
};

window.STRIPE_CHECKOUT_ENDPOINT ||= DEFAULT_STRIPE_ENDPOINTS.checkout;
window.STRIPE_PORTAL_ENDPOINT ||= DEFAULT_STRIPE_ENDPOINTS.portal;
window.STRIPE_SYNC_ENDPOINT ||= DEFAULT_STRIPE_ENDPOINTS.sync;

const billingEndpoints = {
  checkout: () => window.STRIPE_CHECKOUT_ENDPOINT,
  portal: () => window.STRIPE_PORTAL_ENDPOINT,
  sync: () => window.STRIPE_SYNC_ENDPOINT,
};

const planLabels = {
  advanced: 'Advanced',
  pro: 'Pro',
};

let pendingSyncPromise = null;

class BillingRequestError extends Error {
  constructor(message, { code = 'billing_request_failed', status = 0 } = {}) {
    super(message);
    this.name = 'BillingRequestError';
    this.code = code;
    this.status = status;
  }
}

function setBusy(button, busy, busyText = 'Opening…') {
  if (!button) return () => {};
  const previous = {
    disabled: button.disabled,
    text: button.textContent,
    ariaBusy: button.getAttribute('aria-busy'),
  };

  button.disabled = busy;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (busy) button.textContent = busyText;

  return () => {
    button.disabled = previous.disabled;
    button.textContent = previous.text;
    if (previous.ariaBusy == null) button.removeAttribute('aria-busy');
    else button.setAttribute('aria-busy', previous.ariaBusy);
  };
}

function setBillingStatus(message = '', tone = 'neutral') {
  const status = document.getElementById('account-billing-action-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = !message;
}

function currentFirebaseUser() {
  const user = window.currentUser || auth.currentUser || null;
  if (user && !window.currentUser) window.currentUser = user;
  return user;
}

function waitForCurrentUser(timeoutMs = 10000) {
  const user = currentFirebaseUser();
  if (user) return Promise.resolve(user);

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      unsubscribe();
      reject(new BillingRequestError('Please sign in first.', { code: 'auth_required', status: 401 }));
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!nextUser) return;
      window.clearTimeout(timeoutId);
      unsubscribe();
      window.currentUser = nextUser;
      resolve(nextUser);
    });
  });
}

async function authedPost(endpoint, payload = {}) {
  await waitForCurrentUser();
  if (!endpoint) {
    throw new BillingRequestError('Stripe billing is not configured yet.', { code: 'endpoint_missing' });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: await getAuthedJsonHeaders('Please sign in first.'),
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Infrastructure errors can return HTML or an empty body.
  }

  if (!response.ok) {
    throw new BillingRequestError(data.error || 'Billing request failed. Please try again.', {
      code: data.code || 'billing_request_failed',
      status: response.status,
    });
  }
  return data;
}

function cleanupBillingParams() {
  const url = new URL(window.location.href);
  ['billing', 'session_id'].forEach((param) => url.searchParams.delete(param));
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function validatedStripeUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new BillingRequestError('Stripe did not return a valid secure URL.', { code: 'stripe_url_invalid' });
  }
  if (url.protocol !== 'https:') {
    throw new BillingRequestError('Stripe did not return a secure checkout URL.', { code: 'stripe_url_insecure' });
  }
  return url.href;
}

function billingErrorMessage(error, action) {
  if (error.code === 'account_subscription_active') {
    return 'You already have an account subscription. Use Manage in Stripe to change plans or payment details.';
  }
  if (error.code === 'stripe_customer_not_found' || error.code === 'account_subscription_not_found') {
    return 'Your old billing record was repaired. Choose Advanced or Pro to start a live subscription.';
  }
  return `${action} failed: ${error.message}`;
}

async function syncCheckoutSession(sessionId) {
  const data = await authedPost(billingEndpoints.sync(), { sessionId });
  if (data.tier) {
    window.userTier = data.tier;
    window.updateBillingUI?.();
  }
  return data;
}

async function syncPendingCheckout(sessionId) {
  if (!sessionId || pendingSyncPromise) return pendingSyncPromise;

  pendingSyncPromise = (async () => {
    try {
      setBillingStatus('Finalizing your subscription…', 'progress');
      window.showToast?.('Finalizing your subscription…', false);
      const data = await syncCheckoutSession(sessionId);
      sessionStorage.removeItem('pendingStripeCheckoutSession');
      const plan = data.tier === 'pro' ? 'Pro' : data.tier === 'advanced' ? 'Advanced' : 'Base';
      setBillingStatus(`Your ${plan} subscription is active.`, 'success');
      window.showToast?.(`Billing updated: ${plan}.`, false);
    } catch (error) {
      const message = `Payment returned successfully, but plan sync needs a retry: ${error.message}`;
      setBillingStatus(message, 'error');
      window.showToast?.(message);
    } finally {
      pendingSyncPromise = null;
    }
  })();

  return pendingSyncPromise;
}

async function openStripeCheckout(plan, button) {
  const label = planLabels[plan] || plan;
  const reset = setBusy(button, true, 'Opening Stripe…');
  setBillingStatus(`Creating your secure ${label} checkout…`, 'progress');

  try {
    const data = await authedPost(billingEndpoints.checkout(), {
      plan,
      embedded: false,
      origin: window.location.origin,
    });
    const checkoutUrl = validatedStripeUrl(data.url);
    if (!data.sessionId) {
      throw new BillingRequestError('Stripe did not return a checkout session.', { code: 'checkout_session_missing' });
    }

    sessionStorage.setItem('pendingStripeCheckoutSession', data.sessionId);
    setBillingStatus('Secure checkout is ready. Taking you to Stripe…', 'success');
    window.location.assign(checkoutUrl);
  } catch (error) {
    reset();
    const message = billingErrorMessage(error, `${label} checkout`);
    setBillingStatus(message, 'error');
    window.showToast?.(message);
  }
}

async function openBillingPortal(button) {
  const reset = setBusy(button, true, 'Opening Stripe…');
  setBillingStatus('Opening secure subscription management…', 'progress');

  try {
    const data = await authedPost(billingEndpoints.portal(), { origin: window.location.origin });
    const portalUrl = validatedStripeUrl(data.url);
    setBillingStatus('Billing management is ready. Taking you to Stripe…', 'success');
    window.location.assign(portalUrl);
  } catch (error) {
    reset();
    const message = billingErrorMessage(error, 'Billing management');
    setBillingStatus(message, 'error');
    window.showToast?.(message);
  }
}

function syncReturnedCheckout() {
  const params = new URLSearchParams(window.location.search);
  const billingStatus = params.get('billing');
  const returnedSessionId = params.get('session_id');

  if (billingStatus === 'cancelled') {
    sessionStorage.removeItem('pendingStripeCheckoutSession');
    cleanupBillingParams();
    setBillingStatus('Checkout was cancelled. No billing changes were made.', 'neutral');
    window.showToast?.('Checkout cancelled. No changes made.', false);
    return;
  }

  if (billingStatus === 'portal-return') {
    cleanupBillingParams();
    setBillingStatus('Your latest Stripe billing details will appear here automatically.', 'success');
    return;
  }

  if (billingStatus !== 'success') return;
  const sessionId = returnedSessionId || sessionStorage.getItem('pendingStripeCheckoutSession');
  cleanupBillingParams();
  if (sessionId) {
    sessionStorage.setItem('pendingStripeCheckoutSession', sessionId);
    syncPendingCheckout(sessionId);
  }
}

function bindBillingButton(button, action) {
  if (!button || button.dataset.billingBound === 'true') return;
  button.dataset.billingBound = 'true';
  button.dataset.billingReady = 'stripe';
  button.addEventListener('click', action);
}

export function initializeBillingActions() {
  document.documentElement.dataset.billingProvider = 'stripe';

  bindBillingButton(document.getElementById('upgrade-advanced-btn'), (event) => {
    openStripeCheckout('advanced', event.currentTarget);
  });
  bindBillingButton(document.getElementById('upgrade-pro-btn'), (event) => {
    openStripeCheckout('pro', event.currentTarget);
  });
  bindBillingButton(document.getElementById('manage-billing-btn'), (event) => {
    openBillingPortal(event.currentTarget);
  });

  onAuthStateChanged(auth, (user) => {
    if (user) window.currentUser = user;
  });

  syncReturnedCheckout();
}
