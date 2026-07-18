import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

/*
 * No-cost RTDB emulator contention harness for the durable AI queue.
 *
 * Run from the repository root with:
 *   firebase --config firebase.rules-test.json emulators:exec --only database \
 *     --project chat-app-356c1 "node tools/ai-queue-rtdb-contention-test.mjs"
 *
 * The production queue helpers in functions/index.js are intentionally private,
 * so this harness imports the pure state transitions and mirrors the same RTDB
 * transaction boundaries. It never imports the Functions entrypoint and never
 * calls Ollama, Cloudflare Workers AI, Groq, or any deployed Firebase resource.
 */

const require = createRequire(import.meta.url);
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const {
  aiQueueJobId,
  claimAiQueueJob,
  completeAiQueueJob,
  createAiQueueJob,
  requeueExpiredAiQueueJob,
} = require('../functions/ai-request-queue.js');
const {
  releaseAiQueueCapacityState,
  reserveAiQueueCapacityState,
} = require('../functions/ai-queue-capacity.js');
const { deleteApp, initializeApp } = requireFunctions('firebase-admin/app');
const { getDatabase } = requireFunctions('firebase-admin/database');

const PROJECT_ID = 'chat-app-356c1';
const DATABASE_URL = `https://${PROJECT_ID}-default-rtdb.firebaseio.com`;
const QUEUE_PATH = 'ai_runtime/text_request_queue_v1';
const STATUS_PATH = 'ai_queue_status';
const UNIQUE_PER_OWNER = 250;
const DUPLICATES_PER_OWNER = 25;
const EXPECTED_UNIQUE = UNIQUE_PER_OWNER * 2;
const TOTAL_SUBMISSIONS = EXPECTED_UNIQUE + (DUPLICATES_PER_OWNER * 2);
const PROVIDER_SLOTS = Object.freeze({
  pc: 10,
  cloudflare: 40,
  groq: 40,
});
const TOTAL_SLOTS = Object.values(PROVIDER_SLOTS).reduce((sum, count) => sum + count, 0);
const OWNER_A = 'queue-owner-a';
const OWNER_B = 'queue-owner-b';
// Two independent Admin connections provide real cross-client contention while
// avoiding a firebase-database-emulator v4.11.2 rules-engine crash observed
// when 4-12 clients issue hundreds of writes nearly simultaneously.
const SERVER_CONTEXTS = 2;

function ref(db, path = '') {
  return path ? db.ref(path) : db.ref();
}

function payloadFor(ownerUid, requestId) {
  return {
    mode: 'personal',
    modelProfile: 'fast',
    messages: [{
      role: 'user',
      content: `private synthetic prompt for ${ownerUid}/${requestId}`,
    }],
  };
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function queueKey(ticket, jobId) {
  return `${String(ticket).padStart(16, '0')}_${jobId.slice(0, 16)}`;
}

function reservationId(jobId) {
  return `reservation-${jobId}`;
}

async function reserveCapacity(db, { jobId, ownerUid, hash }) {
  let outcome = null;
  const transaction = await ref(db, `${QUEUE_PATH}/capacity`).transaction((current) => {
    outcome = reserveAiQueueCapacityState(current, {
      jobId,
      ownerUid,
      reservationId: reservationId(jobId),
      payloadHash: hash,
      now: 900_000,
      globalLimit: 10000,
      perOwnerLimit: 1000,
    });
    return outcome.accepted ? outcome.state : undefined;
  }, undefined, false);
  assert.equal(transaction.committed, true, `capacity reservation ${jobId} must commit`);
  assert.equal(transaction.snapshot.child(`reservations/${jobId}/reservationId`).val(), reservationId(jobId));
}

async function releaseCapacity(db, job) {
  let outcome = null;
  const capacityTransaction = await ref(db, `${QUEUE_PATH}/capacity`).transaction((current) => {
    outcome = releaseAiQueueCapacityState(current, {
      jobId: job.jobId,
      ownerUid: job.ownerUid,
      reservationId: job.reservationId,
      now: Number(job.finishedAt || 0) + 1,
      globalLimit: 10000,
      perOwnerLimit: 1000,
    });
    return outcome.conflict ? undefined : outcome.state;
  }, undefined, false);
  assert.equal(capacityTransaction.committed, true, `capacity release ${job.jobId} must commit`);
  const jobRef = ref(db, `${QUEUE_PATH}/jobs/${job.jobId}`);
  await jobRef.transaction((current) => {
    if (
      current?.status !== 'completed'
      || current.reservationId !== job.reservationId
      || current.capacityReleasePending !== true
    ) return undefined;
    return { ...current, capacityReleasePending: false };
  }, undefined, false);
}

function providerForSlot(slotIndex) {
  if (slotIndex < PROVIDER_SLOTS.pc) return 'pc';
  if (slotIndex < PROVIDER_SLOTS.pc + PROVIDER_SLOTS.cloudflare) return 'cloudflare';
  return 'groq';
}

function publicStatus(job) {
  const projection = {
    version: job.version,
    jobId: job.jobId,
    requestId: job.requestId,
    status: job.status,
    revision: job.revision,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
  if (job.finishedAt != null) projection.finishedAt = job.finishedAt;
  if (job.deleteAfter != null) projection.retainedUntil = job.deleteAfter;
  if (job.result) projection.result = job.result;
  return projection;
}

function makeSubmissions() {
  const attempts = [];
  for (const ownerUid of [OWNER_A, OWNER_B]) {
    for (let index = 0; index < UNIQUE_PER_OWNER; index += 1) {
      const requestId = `shared-${String(index).padStart(4, '0')}`;
      attempts.push({ ownerUid, requestId, duplicate: false });
    }
    for (let index = 0; index < DUPLICATES_PER_OWNER; index += 1) {
      const requestId = `shared-${String(index).padStart(4, '0')}`;
      attempts.push({ ownerUid, requestId, duplicate: true });
    }
  }
  assert.equal(attempts.length, TOTAL_SUBMISSIONS);

  // Deterministic interleaving keeps the test reproducible while ensuring each
  // RTDB client receives attempts for both owners and duplicate request IDs.
  return attempts
    .map((attempt, index) => ({
      attempt,
      order: Number.parseInt(
        crypto.createHash('sha256').update(`${attempt.ownerUid}/${attempt.requestId}/${index}`).digest('hex').slice(0, 12),
        16,
      ),
    }))
    .sort((left, right) => left.order - right.order)
    .map(({ attempt }) => attempt);
}

function shard(items, count) {
  const groups = Array.from({ length: count }, () => []);
  items.forEach((item, index) => groups[index % groups.length].push(item));
  return groups;
}

async function allocateTicket(db) {
  const transaction = await ref(db, `${QUEUE_PATH}/meta/nextTicket`).transaction((current) => {
    const next = Math.max(0, Math.floor(Number(current) || 0)) + 1;
    return Number.isSafeInteger(next) ? next : undefined;
  }, undefined, false);
  assert.equal(transaction.committed, true, 'ticket transaction must commit');
  return Number(transaction.snapshot.val());
}

async function submit(db, attempt) {
  const { ownerUid, requestId } = attempt;
  const jobId = aiQueueJobId(ownerUid, requestId);
  const payload = payloadFor(ownerUid, requestId);
  const hash = payloadHash(payload);
  await reserveCapacity(db, { jobId, ownerUid, hash });
  const ticket = await allocateTicket(db);
  const proposed = createAiQueueJob({
    jobId,
    queueKey: queueKey(ticket, jobId),
    ownerUid,
    requestId,
    payloadHash: hash,
    payload,
    bananas: { cost: 1, charged: true },
    reservationId: reservationId(jobId),
    now: 1_000_000 + ticket,
  });
  const transaction = await ref(db, `${QUEUE_PATH}/jobs/${jobId}`).transaction((current) => (
    current || proposed
  ), undefined, false);
  assert.equal(transaction.committed, true, 'idempotent job transaction must commit');

  const persisted = transaction.snapshot.val();
  assert.equal(persisted.jobId, jobId);
  assert.equal(persisted.ownerUid, ownerUid);
  assert.equal(persisted.requestId, requestId);
  assert.equal(persisted.payloadHash, hash, 'duplicate IDs must resolve to identical payloads');
  const created = persisted.queueKey === proposed.queueKey;

  if (created) {
    await ref(db).update({
      [`${QUEUE_PATH}/pending/${persisted.queueKey}`]: jobId,
      [`${STATUS_PATH}/${ownerUid}/${jobId}`]: publicStatus(persisted),
    });
  }

  return {
    created,
    duplicate: !created,
    jobId,
    ownerUid,
    requestId,
    allocatedTicket: ticket,
    persistedQueueKey: persisted.queueKey,
  };
}

async function readServerState(db) {
  const snapshot = await ref(db).get();
  return snapshot.val() || {};
}

async function claimNext(db, provider, workerNumber) {
  const claimId = `claim-${provider}-${workerNumber}-${crypto.randomUUID()}`;
  for (let scan = 0; scan < TOTAL_SLOTS * 2; scan += 1) {
    const pendingSnapshot = await ref(db, `${QUEUE_PATH}/pending`)
      .orderByKey()
      .limitToFirst(1)
      .get();
    if (!pendingSnapshot.exists()) return null;
    const [key, jobId] = Object.entries(pendingSnapshot.val() || {})[0] || [];
    if (!key || !jobId) return null;

    const jobRef = ref(db, `${QUEUE_PATH}/jobs/${jobId}`);
    const knownJob = (await jobRef.get()).val();
    if (!knownJob || knownJob.jobId !== jobId) {
      await ref(db, `${QUEUE_PATH}/pending/${key}`).remove();
      continue;
    }
    const transaction = await jobRef.transaction((current) => (
      claimAiQueueJob(current || knownJob, {
        claimId,
        provider,
        now: 2_000_000 + workerNumber,
        claimTtlMs: 240_000,
      }) || undefined
    ), undefined, false);

    if (transaction.committed) {
      const pointerRef = ref(db, `${QUEUE_PATH}/pending/${key}`);
      const knownPointer = (await pointerRef.get()).val();
      await pointerRef.transaction((current) => (
        (current ?? knownPointer) === jobId ? null : undefined
      ), undefined, false);
      return transaction.snapshot.val();
    }

    const observed = transaction.snapshot.val();
    if (observed && observed.status !== 'queued') {
      const pointerRef = ref(db, `${QUEUE_PATH}/pending/${key}`);
      const knownPointer = (await pointerRef.get()).val();
      await pointerRef.transaction((current) => (
        (current ?? knownPointer) === jobId ? null : undefined
      ), undefined, false);
    }
  }
  throw new Error(`worker ${workerNumber} could not claim a job after bounded contention retries`);
}

async function claimInitialCapacity(serverDbs) {
  const claims = [];
  for (let index = 0; index < TOTAL_SLOTS; index += 1) {
    const db = serverDbs[index % serverDbs.length];
    claims.push(await claimNext(db, providerForSlot(index), index));
  }
  return claims;
}

async function recoverExpiredClaims(db, jobs) {
  const recovered = [];
  for (const job of jobs) {
    const jobRef = ref(db, `${QUEUE_PATH}/jobs/${job.jobId}`);
    const knownJob = (await jobRef.get()).val();
    const recoveryNow = Number(knownJob?.claimExpiresAt || 0) + 1;
    const transaction = await jobRef.transaction((current) => {
      const transition = requeueExpiredAiQueueJob(current || knownJob, {
        now: recoveryNow,
        maxAttempts: 3,
      });
      return transition.action === 'requeued' ? transition.job : undefined;
    }, undefined, false);
    assert.equal(transaction.committed, true, `expired claim ${job.jobId} should requeue`);
    const recoveredJob = transaction.snapshot.val();
    await ref(db, `${QUEUE_PATH}/pending/${recoveredJob.queueKey}`).set(recoveredJob.jobId);
    recovered.push(recoveredJob);
  }
  return recovered;
}

async function completeClaims(db, jobs, clockBase) {
  await Promise.all(jobs.map(async (job, index) => {
    const jobRef = ref(db, `${QUEUE_PATH}/jobs/${job.jobId}`);
    const knownJob = (await jobRef.get()).val();
    const transaction = await jobRef.transaction((current) => (
      completeAiQueueJob(current || knownJob, {
        claimId: job.claimId,
        result: {
          reply: `synthetic emulator result for ${job.requestId}`,
          provider: job.provider,
          model: 'emulator-no-provider',
          modelProfile: 'fast',
        },
        now: clockBase + index,
      }) || undefined
    ), undefined, false);
    assert.equal(transaction.committed, true, `claim ${job.claimId} should complete exactly once`);
    const completed = transaction.snapshot.val();
    await releaseCapacity(db, completed);
    await ref(db, `${STATUS_PATH}/${completed.ownerUid}/${completed.jobId}`).set(publicStatus(completed));
  }));
}

async function repairOneMissingPointerWithContention(serverDbs, job) {
  await ref(serverDbs[0], `${QUEUE_PATH}/pending/${job.queueKey}`).remove();

  const attempts = [];
  await Promise.all(Array.from({ length: serverDbs.length }, async (_, index) => {
      const db = serverDbs[index % serverDbs.length];
      const transaction = await ref(db, `${QUEUE_PATH}/pending/${job.queueKey}`).transaction((current) => {
        if (current == null) return job.jobId;
        return undefined;
      }, undefined, false);
      attempts[index] = { index, committed: transaction.committed, value: transaction.snapshot.val() };
  }));

  assert.equal(attempts.filter((attempt) => attempt.committed).length, 1,
    'exactly one concurrent repair should recreate a missing pointer');
  assert.ok(attempts.every((attempt) => attempt.value === job.jobId),
    'every repair contender must observe the same final pointer');
}

async function drainQueuedJobs(db) {
  const waves = [];
  let completed = 0;
  while (true) {
    const pendingSnapshot = await ref(db, `${QUEUE_PATH}/pending`)
      .orderByKey()
      .limitToFirst(TOTAL_SLOTS)
      .get();
    const entries = Object.entries(pendingSnapshot.val() || {});
    if (!entries.length) break;
    assert.ok(entries.length <= TOTAL_SLOTS, 'a drain wave cannot exceed available slots');

    const candidates = await Promise.all(entries.map(async ([key, jobId]) => ({
      key,
      jobId,
      knownJob: (await ref(db, `${QUEUE_PATH}/jobs/${jobId}`).get()).val(),
    })));
    const providerCounts = { pc: 0, cloudflare: 0, groq: 0 };
    const providerOrder = ['pc', 'cloudflare', 'groq'];
    candidates.forEach((candidate) => {
      const excluded = new Set(candidate.knownJob?.excludedProviders || []);
      candidate.provider = providerOrder.find((provider) => (
        !excluded.has(provider) && providerCounts[provider] < PROVIDER_SLOTS[provider]
      ));
      assert.ok(candidate.provider, `FIFO job ${candidate.jobId} must have an eligible provider slot`);
      providerCounts[candidate.provider] += 1;
    });

    const claimed = await Promise.all(candidates.map(async ({ key, jobId, knownJob, provider }, index) => {
      const claimId = `drain-${waves.length}-${index}-${jobId.slice(0, 8)}`;
      const jobRef = ref(db, `${QUEUE_PATH}/jobs/${jobId}`);
      const transaction = await jobRef.transaction((current) => (
        claimAiQueueJob(current || knownJob, {
          claimId,
          provider,
          now: 4_000_000 + completed + index,
          claimTtlMs: 240_000,
        }) || undefined
      ), undefined, false);
      assert.equal(transaction.committed, true, `FIFO job ${jobId} should be claimable`);
      return { key, job: transaction.snapshot.val() };
    }));

    const pointerDeletes = {};
    claimed.forEach(({ key }) => {
      pointerDeletes[`${QUEUE_PATH}/pending/${key}`] = null;
    });
    await ref(db).update(pointerDeletes);
    await completeClaims(db, claimed.map(({ job }) => job), 5_000_000 + completed);

    const providers = claimed.reduce((counts, { job }) => {
      counts[job.provider] = (counts[job.provider] || 0) + 1;
      return counts;
    }, {});
    assert.ok((providers.pc || 0) <= PROVIDER_SLOTS.pc);
    assert.ok((providers.cloudflare || 0) <= PROVIDER_SLOTS.cloudflare);
    assert.ok((providers.groq || 0) <= PROVIDER_SLOTS.groq);
    waves.push({ size: claimed.length, providers });
    completed += claimed.length;
  }
  return { completed, waves };
}

const startedAt = Date.now();
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  database: {
    rules: readFileSync('database.rules.json', 'utf8'),
  },
});
const serverApps = Array.from({ length: SERVER_CONTEXTS }, (_, index) => initializeApp({
  projectId: PROJECT_ID,
  databaseURL: DATABASE_URL,
}, `ai-queue-contention-${process.pid}-${index}`));
const serverDbs = serverApps.map((app) => getDatabase(app));

try {
  await testEnv.clearDatabase();
  const submissions = makeSubmissions();
  const submissionResults = [];

  await Promise.all(shard(submissions, SERVER_CONTEXTS).map(async (batch, index) => {
      const db = serverDbs[index];
      const results = [];
      for (const attempt of batch) results.push(await submit(db, attempt));
      submissionResults.push(...results);
  }));

  assert.equal(submissionResults.length, TOTAL_SUBMISSIONS);
  assert.equal(submissionResults.filter(({ created }) => created).length, EXPECTED_UNIQUE);
  assert.equal(submissionResults.filter(({ duplicate }) => duplicate).length,
    DUPLICATES_PER_OWNER * 2);
  assert.equal(new Set(submissionResults.map(({ allocatedTicket }) => allocatedTicket)).size,
    TOTAL_SUBMISSIONS, 'all contending ticket transactions must allocate a unique number');

  let state = await readServerState(serverDbs[0]);
  const initialJobs = state.ai_runtime?.text_request_queue_v1?.jobs || {};
  const initialPending = state.ai_runtime?.text_request_queue_v1?.pending || {};
  assert.equal(state.ai_runtime.text_request_queue_v1.meta.nextTicket, TOTAL_SUBMISSIONS);
  assert.equal(Object.keys(initialJobs).length, EXPECTED_UNIQUE);
  assert.equal(Object.keys(initialPending).length, EXPECTED_UNIQUE);
  assert.equal(state.ai_runtime.text_request_queue_v1.capacity.activeCount, EXPECTED_UNIQUE);
  assert.equal(Object.keys(state.ai_runtime.text_request_queue_v1.capacity.reservations).length, EXPECTED_UNIQUE);
  assert.equal(new Set(Object.values(initialPending)).size, EXPECTED_UNIQUE);
  assert.equal(Object.values(initialJobs).filter(({ ownerUid }) => ownerUid === OWNER_A).length,
    UNIQUE_PER_OWNER);
  assert.equal(Object.values(initialJobs).filter(({ ownerUid }) => ownerUid === OWNER_B).length,
    UNIQUE_PER_OWNER);
  Object.entries(initialJobs).forEach(([jobId, job]) => {
    assert.equal(jobId, aiQueueJobId(job.ownerUid, job.requestId));
    assert.equal(initialPending[job.queueKey], jobId);
  });

  const sharedRequestId = 'shared-0000';
  const ownerAJobId = aiQueueJobId(OWNER_A, sharedRequestId);
  const ownerBJobId = aiQueueJobId(OWNER_B, sharedRequestId);
  assert.notEqual(ownerAJobId, ownerBJobId, 'the same request ID must be namespaced by owner');
  const ownerADb = testEnv.authenticatedContext(OWNER_A).database(DATABASE_URL);
  const ownerBDb = testEnv.authenticatedContext(OWNER_B).database(DATABASE_URL);
  const anonymousDb = testEnv.unauthenticatedContext().database(DATABASE_URL);
  await assertSucceeds(ref(ownerADb, `${STATUS_PATH}/${OWNER_A}/${ownerAJobId}`).get());
  await assertSucceeds(ref(ownerBDb, `${STATUS_PATH}/${OWNER_B}/${ownerBJobId}`).get());
  await assertFails(ref(ownerADb, `${STATUS_PATH}/${OWNER_B}/${ownerBJobId}`).get());
  await assertFails(ref(ownerBDb, `${STATUS_PATH}/${OWNER_A}/${ownerAJobId}`).get());
  await assertFails(ref(anonymousDb, `${STATUS_PATH}/${OWNER_A}/${ownerAJobId}`).get());
  await assertFails(ref(ownerADb, `${QUEUE_PATH}/jobs/${ownerAJobId}`).get());
  await assertFails(ref(ownerADb, `${STATUS_PATH}/${OWNER_A}/${ownerAJobId}/status`).set('completed'));
  const ownerProjection = (await ref(ownerADb, `${STATUS_PATH}/${OWNER_A}/${ownerAJobId}`).get()).val();
  assert.equal(JSON.stringify(ownerProjection).includes('private synthetic prompt'), false,
    'owner-readable status must not contain the private queued prompt');

  const sortedInitialJobs = Object.values(initialJobs).sort((left, right) => (
    left.queueKey.localeCompare(right.queueKey)
  ));
  const initialClaims = await claimInitialCapacity(serverDbs);
  assert.equal(initialClaims.length, TOTAL_SLOTS);
  assert.equal(new Set(initialClaims.map(({ jobId }) => jobId)).size, TOTAL_SLOTS);
  assert.deepEqual(
    new Set(initialClaims.map(({ jobId }) => jobId)),
    new Set(sortedInitialJobs.slice(0, TOTAL_SLOTS).map(({ jobId }) => jobId)),
    'the first capacity wave must claim the oldest 90 queue keys',
  );
  assert.deepEqual(initialClaims.reduce((counts, job) => {
    counts[job.provider] = (counts[job.provider] || 0) + 1;
    return counts;
  }, {}), PROVIDER_SLOTS);

  const interrupted = initialClaims
    .slice()
    .sort((left, right) => left.queueKey.localeCompare(right.queueKey))
    .slice(0, 12);
  const uninterrupted = initialClaims.filter((job) => (
    !interrupted.some(({ jobId }) => jobId === job.jobId)
  ));

  await completeClaims(serverDbs[0], uninterrupted, 3_000_000);
  const recovered = await recoverExpiredClaims(serverDbs[0], interrupted);
  assert.deepEqual(
    recovered.map(({ queueKey }) => queueKey).sort(),
    interrupted.map(({ queueKey }) => queueKey).sort(),
    'expired claims must recover with their original FIFO keys',
  );

  state = await readServerState(serverDbs[0]);
  let jobs = state.ai_runtime.text_request_queue_v1.jobs;
  let pending = state.ai_runtime.text_request_queue_v1.pending || {};
  assert.equal(Object.values(jobs).filter(({ status }) => status === 'completed').length,
    TOTAL_SLOTS - interrupted.length);
  assert.equal(Object.values(jobs).filter(({ status }) => status === 'queued').length,
    EXPECTED_UNIQUE - (TOTAL_SLOTS - interrupted.length));
  assert.equal(Object.keys(pending).length,
    EXPECTED_UNIQUE - (TOTAL_SLOTS - interrupted.length));
  const firstRecoveredKeys = Object.keys(pending).sort().slice(0, interrupted.length);
  assert.deepEqual(firstRecoveredKeys, interrupted.map(({ queueKey }) => queueKey).sort(),
    'recovered jobs must return ahead of later submissions');

  const pointerRecoveryJob = Object.values(jobs)
    .filter(({ status }) => status === 'queued')
    .sort((left, right) => right.queueKey.localeCompare(left.queueKey))[0];
  await repairOneMissingPointerWithContention(serverDbs, pointerRecoveryJob);

  const drain = await drainQueuedJobs(serverDbs[0]);
  assert.equal(drain.completed, EXPECTED_UNIQUE - (TOTAL_SLOTS - interrupted.length));
  assert.ok(drain.waves.length >= 1);

  state = await readServerState(serverDbs[0]);
  jobs = state.ai_runtime.text_request_queue_v1.jobs;
  pending = state.ai_runtime.text_request_queue_v1.pending || {};
  assert.equal(Object.keys(pending).length, 0, 'all overflow jobs must leave pending only after completion');
  assert.equal(Object.keys(jobs).length, EXPECTED_UNIQUE, 'no unique job may be dropped during drain');
  assert.equal(Object.values(jobs).filter(({ status }) => status === 'completed').length,
    EXPECTED_UNIQUE);
  assert.equal(Object.values(jobs).some((job) => 'payload' in job), false,
    'terminal jobs must shed private request payloads');
  assert.equal(state.ai_runtime.text_request_queue_v1.capacity.activeCount, 0,
    'every terminal path must release its outstanding-request reservation');
  assert.deepEqual(state.ai_runtime.text_request_queue_v1.capacity.reservations || {}, {});
  assert.equal(Object.keys(state.ai_queue_status?.[OWNER_A] || {}).length, UNIQUE_PER_OWNER);
  assert.equal(Object.keys(state.ai_queue_status?.[OWNER_B] || {}).length, UNIQUE_PER_OWNER);

  console.log(JSON.stringify({
    ok: true,
    mode: 'firebase-rtdb-emulator-only',
    elapsedMs: Date.now() - startedAt,
    submissions: TOTAL_SUBMISSIONS,
    uniqueJobs: EXPECTED_UNIQUE,
    idempotentDuplicates: DUPLICATES_PER_OWNER * 2,
    ticketTransactions: TOTAL_SUBMISSIONS,
    firstCapacityWave: PROVIDER_SLOTS,
    interruptedClaimsRecovered: interrupted.length,
    pointerRepairContenders: serverDbs.length,
    drainWaves: drain.waves,
    finalCompleted: EXPECTED_UNIQUE,
    finalCapacityReservations: 0,
    externalAiCalls: 0,
  }, null, 2));
} finally {
  await testEnv.clearDatabase().catch(() => {});
  await Promise.all(serverApps.map((app) => deleteApp(app).catch(() => {})));
  await testEnv.cleanup();
}
