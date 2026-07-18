import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('room billing functions route catalog prices without treating unknown prices as free', async () => {
  const functionsSource = await source('functions/index.js');
  assert.match(functionsSource, /const STRIPE_ROOM_PRICE_TO_PLAN = Object\.fromEntries/);
  assert.match(functionsSource, /apiVersion: '2026-02-25\.clover'/);
  assert.match(functionsSource, /return STRIPE_PRICE_TO_TIER\[priceId\] \|\| null/);
  assert.match(functionsSource, /billingScopeForPrice\(priceId, metadata = \{\}\)/);
  assert.match(functionsSource, /explicitScope === 'room' \? 'room' : ''/);
  assert.match(functionsSource, /COMPLETED_ROOM_CHECKOUT_PAYMENT_STATUSES = new Set\(\['paid'\]\)/);
  assert.match(functionsSource, /assertPositiveRoomCheckout\(session\)/);
  assert.match(functionsSource, /ACTIVE_STRIPE_STATUSES = new Set\(\['active', 'trialing'\]\)/);
  assert.match(functionsSource, /Number\(session\?\.amount_total \|\| 0\) <= 0/);
  assert.match(functionsSource, /requirePositiveRoomCheckoutInvoice/);
  assert.match(functionsSource, /MANAGEABLE_STRIPE_STATUSES = new Set\(\['active', 'trialing', 'past_due', 'unpaid', 'paused'\]\)/);
});

test('room billing exposes creator-only checkout, sync, portal, and selected-user endpoints', async () => {
  const functionsSource = await source('functions/index.js');
  for (const exportName of [
    'stripeCreateRoomCheckoutSession',
    'stripeSyncRoomCheckoutSession',
    'stripeCreateRoomPortalSession',
    'stripeUpdateRoomBenefitUsers',
  ]) {
    assert.match(functionsSource, new RegExp(`exports\\.${exportName} = functions`));
  }
  assert.match(functionsSource, /roomData\.creatorId !== uid/);
  assert.match(functionsSource, /const ROOM_PLAN_MAX_SELECTED_USERS = Object\.freeze\(\{ advanced: 20, pro: 50 \}\)/);
  assert.match(functionsSource, /ensureRoomIntegrationInstance\(roomId, roomData\)/);
});

test('room billing portal stays available for recoverable Stripe states', async () => {
  const functionsSource = await source('functions/index.js');
  const portalSource = functionsSource.slice(
    functionsSource.indexOf('exports.stripeCreateRoomPortalSession'),
    functionsSource.indexOf('exports.stripeUpdateRoomBenefitUsers'),
  );

  assert.match(portalSource, /MANAGEABLE_STRIPE_STATUSES\.has\(privateData\.stripeSubscriptionStatus\)/);
  assert.match(portalSource, /MANAGEABLE_STRIPE_STATUSES\.has\(subscription\?\.status\)/);
});

test('room billing initializes its immutable room instance without transacting the live room record', async () => {
  const functionsSource = await source('functions/index.js');
  const ensureInstanceSource = functionsSource.slice(
    functionsSource.indexOf('async function ensureRoomIntegrationInstance'),
    functionsSource.indexOf('function unboundWebhookSecretMatchesRoom'),
  );

  assert.match(ensureInstanceSource, /roomRef\.child\('integrationInstanceId'\)/);
  assert.match(ensureInstanceSource, /instanceRef\.transaction/);
  assert.doesNotMatch(ensureInstanceSource, /roomRef\.transaction/);
  assert.match(ensureInstanceSource, /'room_setup_busy'/);
  assert.match(ensureInstanceSource, /latestSnapshot\.exists\(\)/);
  assert.match(ensureInstanceSource, /sameRoomGeneration/);
  assert.match(ensureInstanceSource, /initialCreatedAt/);
});

test('Realtime Database publishes only the room entitlement to room participants', async () => {
  const rules = JSON.parse(await source('database.rules.json'));
  const roomBilling = rules.rules.room_billing;
  assert.equal(roomBilling['.write'], false);
  assert.equal(roomBilling.$roomId.entitlement['.write'], false);
  assert.match(roomBilling.$roomId.entitlement['.read'], /creatorId/);
  assert.match(roomBilling.$roomId.entitlement['.read'], /members/);
  assert.equal(roomBilling.$roomId.private['.read'], false);
  assert.equal(roomBilling.$roomId.pending['.read'], false);
  assert.equal(roomBilling.$roomId.checkoutLock['.read'], false);
});

test('browser room billing service uses dedicated configured endpoints', async () => {
  const serviceSource = await source('src/features/billing/roomBillingService.js');
  for (const exportName of [
    'createRoomCheckout',
    'syncRoomCheckout',
    'createRoomBillingPortal',
    'updateRoomBenefitUsers',
  ]) {
    assert.match(serviceSource, new RegExp(`export async function ${exportName}`));
  }
  assert.match(serviceSource, /ROOM_BILLING_CHECKOUT_ENDPOINT/);
  assert.match(serviceSource, /getAuthedJsonHeaders/);
});

test('room purchase creates a hosted recurring Stripe Checkout link', async () => {
  const functionsSource = await source('functions/index.js');
  const roomCheckoutSource = functionsSource.slice(
    functionsSource.indexOf('exports.stripeCreateRoomCheckoutSession'),
    functionsSource.indexOf('exports.stripeSyncRoomCheckoutSession'),
  );
  assert.match(functionsSource, /mode: 'subscription'/);
  assert.match(functionsSource, /line_items: \[\{ price: priceId, quantity: 1 \}\]/);
  assert.match(functionsSource, /success_url: `\$\{origin\}\/chat\?room_billing=success/);
  assert.match(functionsSource, /cancel_url: `\$\{origin\}\/chat\?room_billing=cancelled/);
  assert.match(functionsSource, /json\(\{ url: session\.url, sessionId: session\.id, reused: false \}\)/);
  assert.match(functionsSource, /await requireLiveRoomPrice\(stripe, plan, priceId\)/);
  assert.match(functionsSource, /Number\(price\?\.unit_amount\) === expected\.unitAmount/);
  assert.match(functionsSource, /invoice\?\.status === 'paid'/);
  assert.match(functionsSource, /Number\(invoice\?\.amount_paid \|\| 0\) >= expected\.unitAmount/);
  assert.doesNotMatch(roomCheckoutSource, /allow_promotion_codes: true/);
});

test('room billing is purchase-first and unlocks user assignment only after payment', async () => {
  const [panelSource, controlsSource] = await Promise.all([
    source('src/features/billing/RoomSubscriptionPanel.jsx'),
    source('src/features/rooms/roomControls.js'),
  ]);

  assert.match(panelSource, /id="rs-room-subscription-members"/);
  assert.match(panelSource, /id="rs-room-subscription-lock"/);
  assert.match(panelSource, /room-subscription-user-list hidden/);
  assert.match(controlsSource, /const assignmentUnlocked = latestRoomBillingEntitlement\.active/);
  assert.match(controlsSource, /list\.classList\.toggle\('hidden', !assignmentUnlocked\)/);
  assert.match(controlsSource, /selectedUserIds: \[\]/);
  assert.match(controlsSource, /Purchase \$\{plan\.label\} with Stripe/);
  assert.doesNotMatch(controlsSource, /Assign at least one room member before checkout/);
});

test('adding room-plan users remains server-gated by an active paid subscription', async () => {
  const functionsSource = await source('functions/index.js');
  assert.match(functionsSource, /exports\.stripeUpdateRoomBenefitUsers = functions/);
  assert.match(functionsSource, /Number\(initialPrivate\.checkoutCompletedAt \|\| 0\) <= 0/);
  assert.match(functionsSource, /An active paid room plan is required\./);
  assert.match(functionsSource, /'room_billing_inactive'/);
});

test('Stripe deployment subscribes to delayed Checkout payment success', async () => {
  const deploySource = await source('tools/deploy-stripe-billing.ps1');
  assert.match(deploySource, /'checkout\.session\.completed'/);
  assert.match(deploySource, /'checkout\.session\.async_payment_succeeded'/);
});
