import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const rulesSource = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
const socialSource = readFileSync(new URL('../src/features/community/social.js', import.meta.url), 'utf8');
const profileSectionsSource = readFileSync(new URL('../src/features/profile/ProfilePopupSections.jsx', import.meta.url), 'utf8');

test('Firebase server timestamps use the supported modular Admin SDK export', () => {
  assert.match(serverSource, /const \{ ServerValue \} = require\('firebase-admin\/database'\);/);
  assert.match(serverSource, /ServerValue\.TIMESTAMP/);
  assert.doesNotMatch(serverSource, /admin\.database\.ServerValue/);
});

function sourceBetween(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return serverSource.slice(start, end);
}

test('profile spotlight sends only authenticated-directory data to AI providers', () => {
  const spotlightLoader = sourceBetween(
    'async function loadProfileSpotlightContext',
    'async function callCloudflareAiModel',
  );

  assert.match(spotlightLoader, /user_directory\/\$\{uid\}/);
  assert.doesNotMatch(spotlightLoader, /`users\//);
  assert.doesNotMatch(spotlightLoader, /\b(?:xp|kudos|badges|stats)\b/);
});

test('profile spotlight discloses cloud routing and preserves the actual provider label', () => {
  assert.match(socialSource, /provider:\s*result\.provider/);
  assert.match(socialSource, /model:\s*result\.model/);
  assert.match(profileSectionsSource, /processed by Cloudflare or Groq/i);
  assert.match(profileSectionsSource, /Processed by \{providerLabel\}/);
});

test('private queue state is denied and only each owner can read the sanitized status mirror', () => {
  const rules = JSON.parse(rulesSource);
  assert.equal(rules.rules.ai_runtime['.read'], false);
  assert.equal(rules.rules.ai_runtime['.write'], false);
  assert.equal(rules.rules.ai_queue_status.$uid['.read'], 'auth != null && auth.uid === $uid');
  assert.equal(rules.rules.ai_queue_status.$uid['.write'], false);
});

test('queue status projection allowlists results instead of spreading internal job state', () => {
  const projection = sourceBetween('function publicQueuedAiResult', 'async function writeAiQueueStatus');
  assert.match(projection, /reply:/);
  assert.match(projection, /provider:/);
  assert.match(projection, /modelProfile:/);
  assert.doesNotMatch(projection, /\.\.\.result/);
  assert.doesNotMatch(projection, /payload/);
  assert.doesNotMatch(projection, /claimId/);
});

test('router readiness, durable admission, and bounded capacity precede a Banana charge', () => {
  const runAi = sourceBetween('async function runServerOwnedAi', 'async function executeClaimedAiQueueJob');
  const readinessAt = runAi.indexOf('providerRouterReadiness');
  const reserveAt = runAi.indexOf('reserveAiQueueAdmission');
  const capacityAt = runAi.indexOf('reserveAiQueueCapacity');
  const chargeAt = runAi.indexOf('chargeBananas');
  assert.ok(readinessAt >= 0 && reserveAt > readinessAt && capacityAt > reserveAt && chargeAt > capacityAt);
  assert.match(serverSource, /status: 'refundPending'/);
});

test('gateway status falls back to a healthy multi-provider router on bridge transport failures', () => {
  const probe = sourceBetween('async function probeOllamaBridge', 'async function chargeBananas');
  const statusAction = sourceBetween("if (action === 'status')", 'const requestedMode');

  assert.match(probe, /catch \(error\) \{\s*return bridgeProbeFailure\(base, error\);/);
  assert.match(probe, /AI_PRELOAD_UNAVAILABLE/);
  assert.match(statusAction, /routerCanServeWithoutLocalBridge/);
  assert.match(statusAction, /routingPolicy === 'balanced'/);
  assert.match(statusAction, /provider: 'multi-provider-router'/);
  assert.match(statusAction, /degradedProviders/);
});

test('gateway status never advertises cloud fallback for local-only routing', () => {
  const probe = sourceBetween('async function probeOllamaBridge', 'async function chargeBananas');
  const statusAction = sourceBetween("if (action === 'status')", 'const requestedMode');

  assert.match(probe, /const transientPreloadFailure = preloadResponse\.status === 429\s*\|\| preloadResponse\.status >= 500/);
  assert.match(probe, /fallbackAllowed: transientPreloadFailure/);
  assert.match(
    statusAction,
    /const canStatusFallback = routingPolicy === 'balanced'\s*&& canUseGroqFallback\(\)\s*&& probe\.fallbackAllowed/,
  );
  assert.match(
    statusAction,
    /const provider = routingPolicy === 'balanced' && canUseGroqFallback\(\)/,
  );
  assert.doesNotMatch(statusAction, /probe\.fallbackAllowed \|\| !canUseOllamaBridge\(\)/);
});

test('durable charge receipts fence rollover and refund recovery', () => {
  const charge = sourceBetween('async function chargeBananas', 'function assertFreshAiCharge');
  const release = sourceBetween('async function releaseBananaCharge', 'async function aiChargeReceipt');
  assert.match(charge, /chargeId,/);
  assert.match(charge, /status: 'charged'/);
  assert.match(charge, /deleteAfter: durable \? AI_QUEUE_FAR_FUTURE_MS/);
  assert.match(release, /receipt\?\.status === 'refunded'/);
  assert.match(release, /status: 'refunded'/);
  assert.doesNotMatch(release, /delete chargeReceipts/);
});

test('terminal queue states release fenced capacity and sweep crash markers', () => {
  assert.match(serverSource, /async function settleAiQueueJobCapacity/);
  assert.match(serverSource, /async function reconcileAiQueueCapacityReleases/);
  assert.match(serverSource, /async function reconcileAiQueueAdmissionCapacityReleases/);
  assert.match(serverSource, /async function reconcileOrphanAiQueueCapacity/);
  assert.match(serverSource, /reconcileAiQueueCapacityReleases\(/);
  const rules = JSON.parse(rulesSource);
  const queueRules = rules.rules.ai_runtime.text_request_queue_v1;
  assert.ok(queueRules.jobs['.indexOn'].includes('capacityReleasePending'));
  assert.ok(queueRules.admissions['.indexOn'].includes('capacityReleasePending'));
  assert.ok(queueRules.capacity.reservations['.indexOn'].includes('createdAt'));
  const sweeper = sourceBetween('exports.aiQueueSweeper', 'exports.aiGateway');
  assert.match(sweeper, /secrets: \['GROQ_API_KEY', 'OLLAMA_SERVER_TOKEN', 'CLOUDFLARE_AI_API_TOKEN'\]/);
});

test('delayed retries autonomously wake and FIFO claim revalidates the pending root', () => {
  const kick = sourceBetween('async function scheduleAiQueueDelayedWake', 'async function recoverStaleAiQueueWakes');
  assert.match(kick, /AI_QUEUE_DELAYED_WAKE_SLOT/);
  assert.match(kick, /head\.readiness\.retryNotBefore/);
  const claim = sourceBetween('async function claimAiQueueCandidate', 'async function failClaimedAiQueueJob');
  assert.match(claim, /conditionalAiQueueTransaction\(aiQueuePendingRef\(\)/);
  assert.match(claim, /Object\.entries\(pending\)\.sort/);
  assert.match(claim, /headKey !== queueKey/);
  const worker = sourceBetween('exports.aiQueueWorker', 'exports.aiQueueSweeper');
  assert.match(worker, /snapshot\.val\(\)\?\.notBefore/);
  assert.match(worker, /setTimeout\(resolve, waitMs\)/);
});

test('queue status polling preserves an active FIFO claim marker', () => {
  const readJob = sourceBetween('async function readAiQueueJobForOwner', 'async function cancelAiQueueJob');
  assert.match(readJob, /await ensureAiQueuePendingPointer\(job\)/);
  assert.doesNotMatch(readJob, /aiQueuePendingRef\(job\.queueKey\)\.set\(job\.jobId\)/);
});

test('capacity waiting has no expiry and wake delivery uses recoverable child slots', () => {
  assert.doesNotMatch(serverSource, /expireWaitingAiQueueJobs|AI_QUEUE_WAIT_TTL_MS/);
  assert.match(serverSource, /wake\/\{wakeSlot\}/);
  assert.match(serverSource, /recoverStaleAiQueueWakes/);
  assert.match(serverSource, /await snapshot\.ref\.remove\(\);/);
});

test('conditional queue transactions seed cold-cache nulls from a fenced preload', () => {
  const helper = sourceBetween('async function conditionalAiQueueTransaction', 'function aiQueueStatusRef');
  assert.match(helper, /const known = \(await reference\.once\('value'\)\)\.val\(\)/);
  assert.match(helper, /let firstCallback = true/);
  assert.match(helper, /firstCallback && current === null/);
  assert.match(helper, /current === null && known !== null \? known : current/);
});

test('queued model completion uses the cold-cache-safe transaction helper', () => {
  const execute = sourceBetween('async function executeClaimedAiQueueJob', 'exports.aiQueueWorker');
  assert.match(execute, /conditionalAiQueueTransaction\(aiQueueJobRef\(job\.jobId\)/);
  assert.doesNotMatch(execute, /aiQueueJobRef\(job\.jobId\)\.transaction/);
});

test('spotlight completion is fenced to the profile element that started it', () => {
  assert.match(socialSource, /dataset\.aiSpotlightRequest/);
  assert.match(socialSource, /document\.getElementById\('up-spotlight'\) === el/);
  assert.match(socialSource, /popup\?\.dataset\.profileUid === uid/);
});
