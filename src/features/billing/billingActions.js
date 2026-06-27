import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase.js';

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

let stripeJsPromise = null;
let stripeInstance = null;
let stripeInstanceKey = '';
let embeddedCheckout = null;
let pendingSyncPromise = null;

function setBusy(button, busy, busyText = 'Loading…') {
  if (!button) return () => {};

  const previous = {
    disabled: button.disabled,
    text: button.textContent,
  };

  button.disabled = busy;
  if (busy) button.textContent = busyText;

  return () => {
    button.disabled = previous.disabled;
    button.textContent = previous.text;
  };
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
      reject(new Error('Please sign in first.'));
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
  const user = await waitForCurrentUser();
  if (!endpoint) throw new Error('Stripe billing endpoint is not configured yet.');

  const token = await user.getIdToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Some infrastructure errors return HTML/text.
  }

  if (!response.ok) throw new Error(data.error || 'Billing request failed.');
  return data;
}

function cleanupBillingParams() {
  const url = new URL(window.location.href);
  ['billing', 'session_id'].forEach((param) => url.searchParams.delete(param));
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function getStripePublishableKey() {
  return String(window.STRIPE_PUBLISHABLE_KEY || '').trim();
}

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve();
  if (stripeJsPromise) return stripeJsPromise;

  stripeJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-stripe-js]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.dataset.stripeJs = 'true';
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Stripe.js failed to load.'));
    document.head.appendChild(script);
  });

  return stripeJsPromise;
}

async function getStripeInstance() {
  const publishableKey = getStripePublishableKey();
  if (!publishableKey) return null;

  await loadStripeJs();
  if (!stripeInstance || stripeInstanceKey !== publishableKey) {
    stripeInstance = window.Stripe(publishableKey);
    stripeInstanceKey = publishableKey;
  }

  return stripeInstance;
}

function embeddedCard() {
  return document.getElementById('stripe-embedded-checkout-card');
}

function embeddedCheckoutContainer() {
  return document.getElementById('stripe-embedded-checkout');
}

function clearEmbeddedCheckoutContainer(container = embeddedCheckoutContainer()) {
  if (!container) return;
  if (typeof container.replaceChildren === 'function') {
    container.replaceChildren();
    return;
  }
  while (container.firstChild) container.removeChild(container.firstChild);
}

function nextPaint() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function portalEmbeddedCard() {
  const card = embeddedCard();
  if (card && card.parentElement !== document.body) document.body.appendChild(card);
  return card;
}

function setEmbeddedStatus(message, isError = false) {
  const status = document.getElementById('stripe-embedded-status');
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('stripe-status-error', !!isError);
}

function destroyEmbeddedCheckout() {
  if (embeddedCheckout?.destroy) embeddedCheckout.destroy();
  embeddedCheckout = null;
  const container = embeddedCheckoutContainer();
  if (container) {
    container.classList.remove('is-loading');
    clearEmbeddedCheckoutContainer(container);
  }
}

function showEmbeddedPanel(plan) {
  const card = portalEmbeddedCard();
  const title = document.getElementById('stripe-embedded-title');
  const container = embeddedCheckoutContainer();
  if (!card || !container) return;

  destroyEmbeddedCheckout();
  if (title) title.textContent = `Upgrade to ${planLabels[plan] || plan}`;
  clearEmbeddedCheckoutContainer(container);
  container.classList.add('is-loading');
  setEmbeddedStatus('Stripe is loading securely inside this page…');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'stripe-embedded-title');
  document.body.classList.add('stripe-checkout-open');
  card.classList.remove('hidden');
  document.getElementById('stripe-embedded-close')?.focus();
}

function hideEmbeddedPanel() {
  destroyEmbeddedCheckout();
  embeddedCard()?.classList.add('hidden');
  document.body.classList.remove('stripe-checkout-open');
  setEmbeddedStatus('');
}

async function syncCheckoutSession(sessionId, { showSuccess = true } = {}) {
  const data = await authedPost(billingEndpoints.sync(), { sessionId });

  if (data.tier) {
    window.userTier = data.tier;
    window.updateBillingUI?.();
  }

  if (showSuccess) {
    window.showToast?.(`Billing updated: ${data.tier === 'pro' ? 'Pro' : data.tier === 'advanced' ? 'Advanced' : 'Base'}.`, false);
  }

  return data;
}

async function syncPendingCheckout() {
  const sessionId = sessionStorage.getItem('pendingStripeCheckoutSession');
  if (!sessionId || pendingSyncPromise) return pendingSyncPromise;

  pendingSyncPromise = (async () => {
    try {
      window.showToast?.('Finalizing your subscription…', false);
      await syncCheckoutSession(sessionId);
      sessionStorage.removeItem('pendingStripeCheckoutSession');
      hideEmbeddedPanel();
    } catch (error) {
      window.showToast?.(`Payment succeeded, but billing sync needs a retry: ${error.message}`);
    } finally {
      pendingSyncPromise = null;
    }
  })();

  return pendingSyncPromise;
}

async function handleEmbeddedComplete(sessionId) {
  try {
    setEmbeddedStatus('Payment succeeded. Updating your plan…');
    sessionStorage.setItem('pendingStripeCheckoutSession', sessionId);
    await syncPendingCheckout();
  } catch (error) {
    setEmbeddedStatus(`Payment succeeded, but sync needs a retry: ${error.message}`, true);
  }
}

async function openHostedCheckout(plan) {
  const data = await authedPost(billingEndpoints.checkout(), {
    plan,
    embedded: false,
    origin: window.location.origin,
  });

  if (!data.url) throw new Error('Stripe did not return a checkout URL.');
  window.location.href = data.url;
}

async function openStripeCheckout(plan, button) {
  const label = planLabels[plan] || plan;
  const reset = setBusy(button, true, 'Opening…');

  try {
    const stripe = await getStripeInstance();
    if (!stripe) {
      window.showToast?.('Embedded checkout needs a Stripe publishable key. Opening hosted checkout for now…', false);
      await openHostedCheckout(plan);
      return;
    }
    const createEmbeddedCheckout = stripe.createEmbeddedCheckoutPage || stripe.initEmbeddedCheckout;
    if (typeof createEmbeddedCheckout !== 'function') {
      window.showToast?.('This browser cannot load embedded checkout. Opening hosted checkout instead…', false);
      await openHostedCheckout(plan);
      return;
    }

    showEmbeddedPanel(plan);
    const data = await authedPost(billingEndpoints.checkout(), {
      plan,
      embedded: true,
      origin: window.location.origin,
    });

    if (!data.clientSecret || !data.sessionId) throw new Error('Stripe did not return an embedded checkout session.');

    embeddedCheckout = await createEmbeddedCheckout.call(stripe, {
      fetchClientSecret: () => Promise.resolve(data.clientSecret),
      onComplete: () => handleEmbeddedComplete(data.sessionId),
    });

    const container = embeddedCheckoutContainer();
    if (!container) throw new Error('Checkout container is missing.');
    container.classList.remove('is-loading');
    clearEmbeddedCheckoutContainer(container);
    await nextPaint();
    try {
      embeddedCheckout.mount(container);
    } catch (mountError) {
      if (!/contains no child nodes/i.test(mountError?.message || '')) throw mountError;
      clearEmbeddedCheckoutContainer(container);
      await nextPaint();
      embeddedCheckout.mount(container);
    }
    setEmbeddedStatus('Secure checkout is ready.');
  } catch (error) {
    embeddedCheckoutContainer()?.classList.remove('is-loading');
    setEmbeddedStatus(`${label} checkout failed: ${error.message}`, true);
    window.showToast?.(`${label} checkout failed: ${error.message}`);
  } finally {
    reset();
  }
}

async function openBillingPortal(button) {
  const reset = setBusy(button, true, 'Opening…');

  try {
    const data = await authedPost(billingEndpoints.portal(), {
      origin: window.location.origin,
    });

    if (!data.url) throw new Error('Stripe did not return a portal URL.');
    window.location.href = data.url;
  } catch (error) {
    reset();
    window.showToast?.(`Billing portal failed: ${error.message}`);
  }
}

async function syncReturnedCheckout() {
  const params = new URLSearchParams(window.location.search);
  const billingStatus = params.get('billing');
  const sessionId = params.get('session_id');

  if (billingStatus === 'cancelled') {
    window.showToast?.('Checkout cancelled. No changes made.', false);
    cleanupBillingParams();
    return;
  }

  if (billingStatus !== 'success' || !sessionId) {
    syncPendingCheckout();
    return;
  }

  sessionStorage.setItem('pendingStripeCheckoutSession', sessionId);
  cleanupBillingParams();
  syncPendingCheckout();
}

export function initializeBillingActions() {
  document.documentElement.dataset.billingProvider = 'stripe';

  const advancedButton = document.getElementById('upgrade-advanced-btn');
  const proButton = document.getElementById('upgrade-pro-btn');
  const portalButton = document.getElementById('manage-billing-btn');
  const closeEmbeddedButton = document.getElementById('stripe-embedded-close');

  advancedButton?.addEventListener('click', (event) => {
    openStripeCheckout('advanced', event.currentTarget);
  });

  proButton?.addEventListener('click', (event) => {
    openStripeCheckout('pro', event.currentTarget);
  });

  portalButton?.addEventListener('click', (event) => {
    openBillingPortal(event.currentTarget);
  });

  closeEmbeddedButton?.addEventListener('click', hideEmbeddedPanel);

  [advancedButton, proButton, portalButton].forEach((button) => {
    if (button) button.dataset.billingReady = 'stripe';
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.currentUser = user;
      syncPendingCheckout();
    }
  });

  syncReturnedCheckout();
}
