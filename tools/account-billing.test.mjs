import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  isMissingStripeCustomerError,
  resolveStripeCustomer,
} = require('../functions/stripe-customer.js');

function fakeUserRef() {
  const updates = [];
  return {
    updates,
    async update(value) {
      updates.push(value);
    },
  };
}

function missingCustomerError(param = 'id') {
  return Object.assign(new Error('missing'), { code: 'resource_missing', param });
}

test('recognizes missing Stripe customers without swallowing unrelated resource errors', () => {
  assert.equal(isMissingStripeCustomerError(missingCustomerError('id')), true);
  assert.equal(isMissingStripeCustomerError(missingCustomerError('customer')), true);
  assert.equal(isMissingStripeCustomerError(missingCustomerError('price')), false);
  assert.equal(isMissingStripeCustomerError(Object.assign(new Error('down'), { code: 'api_error' })), false);
});

test('reuses a live customer owned by the Firebase user', async () => {
  const userRef = fakeUserRef();
  let createCalls = 0;
  const stripe = {
    customers: {
      retrieve: async () => ({
        id: 'cus_live_existing',
        livemode: true,
        metadata: { firebaseUid: 'user-1' },
      }),
      update: async () => assert.fail('metadata update should not be needed'),
      create: async () => {
        createCalls += 1;
      },
    },
  };

  const result = await resolveStripeCustomer({
    stripe,
    userRef,
    user: { stripeCustomerId: 'cus_live_existing', tier: 'advanced' },
    decoded: { uid: 'user-1', email: 'person@example.com' },
    expectedLivemode: true,
    now: 100,
  });

  assert.equal(result.customerId, 'cus_live_existing');
  assert.equal(result.created, false);
  assert.equal(result.replaced, false);
  assert.equal(createCalls, 0);
  assert.deepEqual(userRef.updates, [{ stripeCustomerId: 'cus_live_existing', stripeUpdatedAt: 100 }]);
});

test('replaces a stale test customer idempotently and clears stale account entitlements', async () => {
  const userRef = fakeUserRef();
  let createOptions;
  const stripe = {
    customers: {
      retrieve: async () => { throw missingCustomerError('id'); },
      update: async () => assert.fail('missing customer cannot be updated'),
      create: async (_params, options) => {
        createOptions = options;
        return { id: 'cus_live_new', livemode: true, metadata: { firebaseUid: 'user-2' } };
      },
    },
  };

  const result = await resolveStripeCustomer({
    stripe,
    userRef,
    user: {
      stripeCustomerId: 'cus_test_stale',
      stripeSubscriptionId: 'sub_test_stale',
      tier: 'pro',
    },
    decoded: { uid: 'user-2', email: 'person@example.com' },
    expectedLivemode: true,
    now: 200,
  });

  assert.equal(result.customerId, 'cus_live_new');
  assert.equal(result.created, true);
  assert.equal(result.replaced, true);
  assert.match(createOptions.idempotencyKey, /^minimalist-customer-v2-live-[a-f0-9]{64}$/);
  assert.deepEqual(userRef.updates[0], {
    tier: 'free',
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    stripePriceId: null,
    stripeCancelAtPeriodEnd: false,
    stripeCurrentPeriodEnd: null,
    stripeUpdatedAt: 200,
    stripeCustomerId: 'cus_live_new',
  });
});

test('does not overwrite billing state when Stripe has a transient failure', async () => {
  const userRef = fakeUserRef();
  const transient = Object.assign(new Error('temporary outage'), { code: 'api_connection_error' });
  const stripe = {
    customers: {
      retrieve: async () => { throw transient; },
      update: async () => assert.fail('metadata update should not run'),
      create: async () => assert.fail('customer creation should not run'),
    },
  };

  await assert.rejects(() => resolveStripeCustomer({
    stripe,
    userRef,
    user: { stripeCustomerId: 'cus_live_unknown' },
    decoded: { uid: 'user-3' },
    expectedLivemode: true,
  }), transient);
  assert.deepEqual(userRef.updates, []);
});

test('portal lookup clears a stale customer without creating an empty replacement', async () => {
  const userRef = fakeUserRef();
  let createCalls = 0;
  const stripe = {
    customers: {
      retrieve: async () => { throw missingCustomerError('id'); },
      update: async () => assert.fail('metadata update should not run'),
      create: async () => { createCalls += 1; },
    },
  };

  const result = await resolveStripeCustomer({
    stripe,
    userRef,
    user: { stripeCustomerId: 'cus_test_portal', tier: 'advanced' },
    decoded: { uid: 'user-4' },
    createIfMissing: false,
    expectedLivemode: true,
    now: 300,
  });

  assert.equal(result.customerId, '');
  assert.equal(createCalls, 0);
  assert.equal(userRef.updates[0].tier, 'free');
  assert.equal(userRef.updates[0].stripeCustomerId, null);
});

test('account checkout contract is hosted and the UI redirects to Stripe', async () => {
  const [backend, actions, panel, main] = await Promise.all([
    readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/billing/billingActions.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/billing/AccountBillingPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
  ]);

  assert.equal((backend.match(/resolveStripeCustomer\(\{/g) || []).length >= 3, true);
  assert.match(backend, /success_url: `\$\{origin\}\/chat\?billing=success/);
  assert.match(backend, /cancel_url: `\$\{origin\}\/chat\?billing=cancelled`/);
  assert.doesNotMatch(backend, /ui_mode:\s*['"](?:embedded_page|hosted_page)['"]/);
  assert.match(actions, /embedded:\s*false/);
  assert.match(actions, /window\.location\.assign\(checkoutUrl\)/);
  assert.doesNotMatch(actions, /initEmbeddedCheckout|createEmbeddedCheckoutPage/);
  assert.match(panel, /account-billing-action-status/);
  assert.match(panel, /manage-billing-btn/);
  assert.match(panel, /Manage subscription/);
  assert.match(panel, /aria-label="Manage subscription in Stripe"/);
  assert.match(actions, /bindBillingButton\(document\.getElementById\('manage-billing-btn'\)/);
  assert.match(main, /vite:preloadError/);
});

test('lazy Settings reconciles paid billing state when the Billing tab opens', async () => {
  const [settings, authGate, globalState, billingStyles] = await Promise.all([
    readFile(new URL('../src/features/settings/settingsService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/shell/authGate.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/shell/globalState.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/billing/accountBilling.css', import.meta.url), 'utf8'),
  ]);

  assert.match(settings, /if \(paneId === 'pane-billing'\) \{\s*window\.updateBillingUI\?\.\(\);\s*\}/);
  assert.match(settings, /window\.updateBillingUI\(\);/);
  assert.match(settings, /MANAGEABLE_ACCOUNT_SUBSCRIPTION_STATUSES/);
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused']) {
    assert.match(settings, new RegExp(`['"]${status}['"]`));
  }
  assert.match(settings, /if \(canManageAccountSubscription\)[\s\S]*manageBtn\.style\.display = 'inline-flex'/);
  assert.match(authGate, /window\.accountSubscriptionStatus = String\(data\.stripeSubscriptionStatus/);
  assert.match(globalState, /window\.accountSubscriptionStatus = ''/);
  assert.match(billingStyles, /\.account-billing__manage\s*\{[\s\S]*width:\s*auto;[\s\S]*white-space:\s*nowrap;/);
});
