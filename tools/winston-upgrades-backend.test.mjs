import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  WINSTON_CONVERSATION_LIMIT,
  WINSTON_FEEDBACK_MAX_RECORDS,
  WINSTON_FEEDBACK_TTL_MS,
  WINSTON_SCHEDULE_LIMIT,
  buildWinstonMemorySuggestion,
  canonicalWinstonScheduleId,
  canonicalizeWinstonScheduleRecords,
  containsSensitiveMemory,
  isWinstonMemorySuggestionApprovalClaimable,
  nextWinstonScheduleRun,
  pruneWinstonFeedbackRecords,
  publicWinstonConversation,
  reserveWinstonWorkspaceSearchAdmission,
  resolveWinstonConversationWrite,
  resolveWinstonModelProfile,
  sanitizeWinstonConversation,
  sanitizeWinstonFeedback,
  sanitizeWinstonLiveTool,
  sanitizeWinstonSchedule,
  winstonMemoryDedupeKey,
  zonedLocalToEpoch,
} = require('../functions/ai-winston-contracts.js');
const {
  buildCompleteTaskProposal,
  buildCreateEventProposal,
  buildSetReminderProposal,
  buildUpdateEventProposal,
  parseAiWorkspaceActionIntent,
  publicAiAction,
} = require('../functions/ai-agent-contracts.js');

test('private conversation contracts accept the client alias and remain bounded', () => {
  const now = Date.parse('2026-07-22T12:00:00Z');
  const conversation = sanitizeWinstonConversation({
    messages: [
      { role: 'user', content: 'Plan the launch.' },
      { role: 'assistant', content: 'Here is a short plan.' },
    ],
  }, { now });
  assert.equal(conversation.roomId, 'global');
  assert.equal(conversation.turns.length, 2);
  assert.ok(conversation.turns.every((turn) => /^turn_[a-f0-9]{32}$/.test(turn.id)));
  assert.match(conversation.summary, /Winston: Here is a short plan/);

  const stored = { ...conversation, createdAt: now, turnCount: conversation.turns.length, revision: 3 };
  const publicValue = publicWinstonConversation(stored, 'conversation_123456', { includeTurns: true });
  assert.deepEqual(publicValue.messages, publicValue.turns);
  assert.equal(publicValue.turnCount, 2);
  assert.equal(publicValue.revision, 3);
  assert.equal(Object.hasOwn(publicValue, 'ownerUid'), false);
  assert.equal(WINSTON_CONVERSATION_LIMIT, 50);
});

test('conversation revisions reject stale divergence and preserve idempotent turn identity', () => {
  const now = 2_000;
  const input = sanitizeWinstonConversation({
    title: 'Launch',
    roomId: 'global',
    baseRevision: 0,
    turns: [
      { id: 'prompt_12345678', role: 'user', content: 'Plan launch.', createdAt: 100 },
      { id: 'reply_12345678', role: 'assistant', content: 'Ready.', createdAt: 200 },
    ],
  }, { now });
  const { baseRevision, ...snapshot } = input;
  const created = resolveWinstonConversationWrite(null, snapshot, { baseRevision, now });
  assert.equal(created.outcome, 'write');
  assert.equal(created.value.revision, 1);
  assert.deepEqual(created.value.turns.map(({ id }) => id), ['prompt_12345678', 'reply_12345678']);

  const retry = resolveWinstonConversationWrite(created.value, snapshot, { baseRevision: 0, now: now + 1 });
  assert.equal(retry.outcome, 'idempotent');
  assert.equal(retry.value.revision, 1);

  const divergent = sanitizeWinstonConversation({
    ...snapshot,
    baseRevision: 0,
    turns: [...snapshot.turns, {
      id: 'prompt_87654321',
      role: 'user',
      content: 'Add milestones.',
      createdAt: 300,
    }],
  }, { now: now + 2 });
  const { baseRevision: staleRevision, ...divergentSnapshot } = divergent;
  assert.equal(resolveWinstonConversationWrite(
    created.value,
    divergentSnapshot,
    { baseRevision: staleRevision, now: now + 2 },
  ).outcome, 'conflict');
  const advanced = resolveWinstonConversationWrite(
    created.value,
    divergentSnapshot,
    { baseRevision: 1, now: now + 2 },
  );
  assert.equal(advanced.outcome, 'write');
  assert.equal(advanced.value.revision, 2);

  assert.throws(() => sanitizeWinstonConversation({
    turns: [
      { id: 'duplicate_123', role: 'user', content: 'One' },
      { id: 'duplicate_123', role: 'assistant', content: 'Two' },
    ],
  }), /turn IDs must be unique/i);

  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(source, /resolveWinstonConversationWrite\(current, input, \{ baseRevision, now \}\)/);
  assert.match(source, /WINSTON_CONVERSATION_CONFLICT/);
  assert.match(source, /currentRevision: err\.currentRevision/);
});

test('auto model selection resolves to a canonical profile before routing', () => {
  assert.deepEqual(resolveWinstonModelProfile('auto', [{ role: 'user', content: 'Hello Winston' }]), {
    requestedProfile: 'auto',
    modelProfile: 'fast',
    automatic: true,
    reason: 'short_request',
  });
  const smart = resolveWinstonModelProfile('auto', [{
    role: 'user',
    content: 'Analyze the trade-offs and create a comprehensive strategy.',
  }]);
  assert.equal(smart.modelProfile, 'smart');
  assert.equal(smart.requestedProfile, 'auto');
  assert.deepEqual(resolveWinstonModelProfile('fast', []), {
    requestedProfile: 'fast',
    modelProfile: 'fast',
    automatic: false,
    reason: 'user_selected',
  });
  assert.throws(() => resolveWinstonModelProfile('unbounded', []), /auto.*fast.*smart/i);
});

test('proactive schedules normalize client aliases and calculate a future run', () => {
  const now = Date.parse('2026-07-22T07:00:00Z');
  const schedule = sanitizeWinstonSchedule({
    kind: 'daily-briefing',
    enabled: true,
    time: '08:00',
    timezone: 'UTC',
    days: [3],
    roomIds: ['global', 'room_123456'],
  }, { now });
  assert.equal(schedule.kind, 'daily_digest');
  assert.equal(schedule.localTime, '08:00');
  assert.equal(schedule.timeZone, 'UTC');
  assert.deepEqual(schedule.selectedRoomIds, ['global', 'room_123456']);
  assert.equal(schedule.nextRunAt, Date.parse('2026-07-22T08:00:00Z'));
  assert.equal(nextWinstonScheduleRun({ ...schedule, enabled: false }, now), 0);
});

test('same-kind schedules migrate deterministically to one canonical record', () => {
  const now = 5_000;
  assert.equal(WINSTON_SCHEDULE_LIMIT, 3);
  assert.equal(canonicalWinstonScheduleId('daily_digest'), 'winston_daily_digest');
  const canonical = {
    kind: 'daily_digest',
    enabled: true,
    localTime: '08:00',
    updatedAt: 1_000,
    revision: 3,
  };
  const newestLegacy = {
    ...canonical,
    localTime: '09:30',
    updatedAt: 3_000,
    revision: 2,
  };
  const plan = canonicalizeWinstonScheduleRecords({
    winston_daily_digest: canonical,
    legacy_daily_123: { ...canonical, updatedAt: 2_000, revision: 7 },
    legacy_daily_456: newestLegacy,
    malformed_schedule: { kind: 'unknown', updatedAt: 4_000 },
  }, { now });

  assert.deepEqual(Object.keys(plan.records), ['winston_daily_digest']);
  assert.equal(plan.records.winston_daily_digest.localTime, '09:30');
  assert.equal(plan.records.winston_daily_digest.updatedAt, now);
  assert.equal(plan.records.winston_daily_digest.revision, 8);
  assert.equal(plan.aliases.legacy_daily_123, 'winston_daily_digest');
  assert.equal(plan.aliases.legacy_daily_456, 'winston_daily_digest');
  assert.deepEqual(
    [...plan.removedIds].sort(),
    ['legacy_daily_123', 'legacy_daily_456', 'malformed_schedule'].sort(),
  );

  const stable = canonicalizeWinstonScheduleRecords({
    winston_daily_digest: plan.records.winston_daily_digest,
  }, { now: now + 1 });
  assert.deepEqual(stable.records.winston_daily_digest, plan.records.winston_daily_digest);
});

test('proactive schedule dates are converted from the configured local timezone', () => {
  assert.equal(zonedLocalToEpoch({
    year: 2026,
    month: 7,
    day: 22,
    hour: 10,
    minute: 0,
  }, 'America/Los_Angeles'), Date.parse('2026-07-22T17:00:00Z'));
  assert.equal(zonedLocalToEpoch({
    year: 2026,
    month: 7,
    day: 22,
    hour: 23,
    minute: 59,
  }, 'America/Los_Angeles'), Date.parse('2026-07-23T06:59:00Z'));

  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('function winstonProactiveItemTimestamp');
  const end = source.indexOf('\nasync function loadWinstonProactiveItems', start);
  assert.ok(start >= 0 && end > start);
  const converter = source.slice(start, end);
  assert.match(converter, /zonedLocalToEpoch\(/);
  assert.doesNotMatch(converter, /Date\.parse/);
  assert.match(source, /winstonProactiveItemTimestamp\('task', task, schedule\.timeZone\)/);
  assert.match(source, /winstonProactiveItemTimestamp\('event', event, schedule\.timeZone\)/);
});

test('feedback is privacy-safe metadata and never retains prompt or response text', () => {
  const feedback = sanitizeWinstonFeedback({
    helpful: false,
    messageId: 'request_123456',
    reason: 'accuracy',
    provider: 'local',
    model: 'smart',
    prompt: 'private prompt',
    response: 'private response',
  });
  assert.deepEqual(Object.keys(feedback).sort(), [
    'category',
    'modelProfile',
    'rating',
    'requestHash',
    'route',
  ]);
  assert.equal(feedback.rating, 'not_helpful');
  assert.equal(feedback.category, 'accuracy');
  assert.equal(feedback.requestHash.length, 64);
  assert.doesNotMatch(JSON.stringify(feedback), /private prompt|private response|request_123456/);
});

test('feedback retention is time-bounded and capped per account', () => {
  const now = 2_000_000_000_000;
  const records = Object.fromEntries(Array.from({ length: 205 }, (_, index) => [
    index.toString(16).padStart(64, '0'),
    { rating: 'helpful', createdAt: now - index },
  ]));
  records.f = { rating: 'helpful', createdAt: now };
  records['f'.repeat(64)] = {
    rating: 'not_helpful',
    createdAt: now - WINSTON_FEEDBACK_TTL_MS - 1,
  };
  const retained = pruneWinstonFeedbackRecords(records, { now });
  assert.equal(Object.keys(retained).length, WINSTON_FEEDBACK_MAX_RECORDS);
  assert.equal(Object.hasOwn(retained, 'f'), false);
  assert.equal(Object.hasOwn(retained, 'f'.repeat(64)), false);
  assert.ok(Object.values(retained).every((record) => record.createdAt > now - WINSTON_FEEDBACK_TTL_MS));

  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function saveWinstonFeedback');
  const end = source.indexOf('\nasync function listWinstonMemorySuggestions', start);
  assert.ok(start >= 0 && end > start);
  const save = source.slice(start, end);
  assert.match(save, /consumeWinstonFeedbackRateLimit\(uid, now\)/);
  assert.match(save, /feedbackRoot\.transaction/);
  assert.match(save, /pruneWinstonFeedbackRecords/);
  assert.match(save, /expiresAt: now \+ WINSTON_FEEDBACK_TTL_MS/);
});

test('memory suggestions are deterministic, pending-only, and reject secrets', () => {
  const first = buildWinstonMemorySuggestion({
    uid: 'user_123456',
    requestId: 'request_123456',
    roomId: 'room_123456',
    messages: [{ role: 'user', content: 'Please remember that I prefer short bullet points for this room.' }],
    now: 1000,
  });
  assert.equal(first.scope, 'room');
  assert.equal(first.status, 'pending');
  assert.equal(first.roomId, 'room_123456');
  assert.equal(first.id, buildWinstonMemorySuggestion({
    uid: 'user_123456',
    requestId: 'request_123456',
    roomId: 'room_123456',
    messages: [{ role: 'user', content: 'Please remember that I prefer short bullet points for this room.' }],
    now: 1000,
  }).id);
  assert.equal(winstonMemoryDedupeKey('Use short bullets.'), winstonMemoryDedupeKey(' use short bullets '));
  assert.equal(containsSensitiveMemory('My API key is secret'), true);
  assert.equal(buildWinstonMemorySuggestion({
    uid: 'user_123456',
    requestId: 'request_654321',
    messages: [{ role: 'user', content: 'Remember that my password is hunter2' }],
  }), null);
});

test('memory approval leases expire into a safe, idempotent retry path', () => {
  const uid = 'user_123456';
  const now = 10_000;
  const base = { ownerUid: uid, expiresAt: now + 60_000 };
  assert.equal(isWinstonMemorySuggestionApprovalClaimable({
    ...base,
    status: 'pending',
  }, { uid, now }), true);
  assert.equal(isWinstonMemorySuggestionApprovalClaimable({
    ...base,
    status: 'approving',
    approvalLeaseExpiresAt: now + 1,
  }, { uid, now }), false);
  assert.equal(isWinstonMemorySuggestionApprovalClaimable({
    ...base,
    status: 'approving',
    approvalLeaseExpiresAt: now,
  }, { uid, now }), true);
  assert.equal(isWinstonMemorySuggestionApprovalClaimable({
    ...base,
    status: 'approved',
  }, { uid, now }), false);
  assert.equal(isWinstonMemorySuggestionApprovalClaimable({
    ...base,
    ownerUid: 'other_user',
    status: 'pending',
  }, { uid, now }), false);
  assert.equal(isWinstonMemorySuggestionApprovalClaimable({
    ...base,
    expiresAt: now,
    status: 'pending',
  }, { uid, now }), false);

  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function approveWinstonMemorySuggestion');
  const end = source.indexOf('\nasync function dismissWinstonMemorySuggestion', start);
  assert.ok(start >= 0 && end > start);
  const approval = source.slice(start, end);
  assert.match(approval, /assertUniqueWinstonMemory\(uid, input\.text, memoryId\)/);
  assert.match(approval, /id !== memoryId/);
  assert.match(approval, /sameOwnedMemory/);
  assert.match(approval, /WINSTON_MEMORY_APPROVAL_INCOMPLETE/);
});

test('live tools accept only bounded weather and webpage metadata requests', () => {
  assert.deepEqual(sanitizeWinstonLiveTool({ tool: 'weather', location: 'Oakland, CA' }), {
    tool: 'weather',
    location: 'Oakland, CA',
  });
  assert.deepEqual(sanitizeWinstonLiveTool({ tool: 'webpage', url: 'https://example.com/page' }), {
    tool: 'webpage',
    url: 'https://example.com/page',
  });
  assert.throws(() => sanitizeWinstonLiveTool({ tool: 'search', query: 'news' }), /unknown/i);
  assert.throws(() => sanitizeWinstonLiveTool({ tool: 'weather', location: '' }), /city|place/i);
});

test('backend live tools return the reply required by the frontend handoff', () => {
  const backend = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const frontend = fs.readFileSync(new URL('../src/features/ai/winstonServices.js', import.meta.url), 'utf8');
  const weatherStart = backend.indexOf('async function runWinstonWeatherTool');
  const liveEnd = backend.indexOf('\nfunction aiAgentPrivateRef', weatherStart);
  assert.ok(weatherStart >= 0 && liveEnd > weatherStart);
  const liveBackend = backend.slice(weatherStart, liveEnd);
  assert.match(liveBackend, /tool: 'weather'[\s\S]*?reply:/);
  assert.match(liveBackend, /tool: 'webpage'[\s\S]*?reply:/);
  assert.match(liveBackend, /provider: 'open-meteo'/);
  assert.match(liveBackend, /provider: 'safe-webpage-metadata'/);
  assert.match(liveBackend, /Safe link preview \(metadata only\)/);
  assert.match(liveBackend, /Published description:/);
  assert.match(liveBackend, /did not read or summarize the full page/);
  assert.match(liveBackend, /kind: 'link_preview'/);
  assert.match(liveBackend, /contentScope: 'metadata_only'/);
  assert.match(liveBackend, /fullPageRead: false/);
  assert.match(frontend, /const reply = cleanText\(data\?\.reply, 12_000\)/);
  assert.match(frontend, /if \(!reply\) return null/);
  assert.match(frontend, /return \{\s*reply,/);
});

test('calendar, reminder, and task intents produce confirmation-only proposals', () => {
  const uid = 'user_123456';
  const requestId = 'request_123456';
  const roomId = 'room_123456';
  const now = Date.parse('2026-07-22T12:00:00Z');

  const createIntent = parseAiWorkspaceActionIntent([{
    role: 'user',
    content: 'Create an event called Design review on 2026-07-25 at 10:30 for 45 minutes',
  }], { roomId, now });
  assert.equal(createIntent.type, 'create_event');
  const created = buildCreateEventProposal({ uid, requestId, roomId, event: createIntent, now });
  assert.equal(created.requiresConfirmation, true);
  assert.equal(created.status, 'proposed');

  const update = buildUpdateEventProposal({
    uid,
    requestId,
    roomId,
    eventId: 'event_123456',
    eventTitle: 'Design review',
    eventDate: '2026-07-25',
    eventTime: '10:30',
    patch: { date: '2026-07-26', time: '11:00' },
    now,
  });
  assert.deepEqual(update.payload.expectedEvent, {
    title: 'Design review',
    date: '2026-07-25',
    time: '10:30',
  });
  assert.equal(buildUpdateEventProposal({
    uid,
    requestId,
    roomId,
    eventId: 'event_123456',
    eventTitle: 'Design review',
    patch: { date: '2026-07-26', time: '11:00' },
    now,
  }), null);
  const reminder = buildSetReminderProposal({
    uid,
    requestId,
    roomId,
    text: 'send the notes',
    dueAt: now + 60_000,
    now,
  });
  const completion = buildCompleteTaskProposal({
    uid,
    requestId,
    roomId,
    taskId: 'task_123456',
    taskText: 'Send the notes',
    now,
  });
  for (const proposal of [update, reminder, completion]) {
    assert.equal(proposal.requiresConfirmation, true);
    assert.equal(proposal.status, 'proposed');
    assert.equal(proposal.expiresAt > proposal.createdAt, true);
  }

  const publicReminder = publicAiAction({
    ...reminder,
    status: 'confirmed',
    result: {
      reminderId: 'reminder_123456',
      roomId,
      dueAt: now + 60_000,
      privatePayload: 'must-not-leak',
    },
  });
  assert.equal(Object.hasOwn(publicReminder, 'payload'), false);
  assert.equal(Object.hasOwn(publicReminder.result, 'privatePayload'), false);
});

test('event updates bind confirmation to the exact prior date and time', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const buildStart = source.indexOf('async function buildAndPersistAiActions');
  const buildEnd = source.indexOf('\nasync function buildAndPersistWinstonMemorySuggestions', buildStart);
  assert.ok(buildStart >= 0 && buildEnd > buildStart);
  const proposalWiring = source.slice(buildStart, buildEnd);
  assert.match(proposalWiring, /eventDate: event\.date/);
  assert.match(proposalWiring, /eventTime: event\.time/);

  const executeStart = source.indexOf('async function executeUpdateEventAiAction');
  const executeEnd = source.indexOf('\nasync function executeSetReminderAiAction', executeStart);
  assert.ok(executeStart >= 0 && executeEnd > executeStart);
  const execute = source.slice(executeStart, executeEnd);
  assert.match(execute, /expectedEvent/);
  assert.match(execute, /currentDate === date && currentTime === targetTime/);
  assert.match(execute, /currentDate !== expectedDate \|\| currentTime !== expectedTime/);
  assert.ok(
    execute.indexOf('currentDate === date && currentTime === targetTime')
      < execute.indexOf('currentDate !== expectedDate || currentTime !== expectedTime'),
    'an exact already-applied retry must be accepted before stale-state rejection'
  );
});

test('absolute reminders require an explicit offset instead of silently assuming UTC', () => {
  const now = Date.parse('2026-07-22T12:00:00Z');
  const withoutOffset = parseAiWorkspaceActionIntent([{
    role: 'user',
    content: 'Remind me to join standup on 2026-07-25 09:00',
  }], { roomId: 'global', now });
  assert.equal(withoutOffset, null);

  const dateOnly = parseAiWorkspaceActionIntent([{
    role: 'user',
    content: 'Remind me to join standup on 2026-07-25',
  }], { roomId: 'global', now });
  assert.equal(dateOnly, null);

  const withOffset = parseAiWorkspaceActionIntent([{
    role: 'user',
    content: 'Remind me to join standup on 2026-07-25 09:00 -07:00',
  }], { roomId: 'global', now });
  assert.equal(withOffset.type, 'set_reminder');
  assert.equal(withOffset.dueAt, Date.parse('2026-07-25T09:00:00-07:00'));

  const relative = parseAiWorkspaceActionIntent([{
    role: 'user',
    content: 'Remind me to join standup in 30 minutes',
  }], { roomId: 'global', now });
  assert.equal(relative.type, 'set_reminder');
  assert.equal(relative.dueAt, now + 30 * 60 * 1000);

  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(source, /Absolute reminder times require an explicit UTC offset/);
  assert.match(source, /ask a clarification question; never assume UTC/);
});

test('runtime wiring keeps workspace search authorized, bounded, and SSRF-safe', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const between = (startNeedle, endNeedle) => {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0 && end > start, `${startNeedle} must precede ${endNeedle}`);
    return source.slice(start, end);
  };

  const candidates = between(
    'async function loadAuthorizedWinstonWorkspaceCandidates',
    '\nfunction winstonSemanticEmbedder',
  );
  assert.match(candidates, /authorizedWinstonWorkspaceRoomIds\(uid, selectedRoomIds\)/);
  assert.match(candidates, /requireRoomAccess\(uid, roomId\)/);
  assert.match(candidates, /readBoundedAiCandidates\(messagePath, 'timestamp', 30\)/);
  assert.match(candidates, /interleaved\.length < 192/);

  const search = between(
    'async function loadAuthorizedWinstonWorkspaceSearch',
    '\nasync function runWinstonWeatherTool',
  );
  assert.ok(search.indexOf('loadAuthorizedWinstonWorkspaceCandidates') < search.indexOf('rankAiSemanticCandidates'));
  assert.match(search, /maxCandidates: 96/);
  assert.match(search, /source: safeSources\[index\]/);

  const liveTool = between('async function runWinstonLiveTool', '\nfunction aiAgentPrivateRef');
  assert.match(liveTool, /fetchSafeLinkPreview\(input\.url\)/);
  assert.doesNotMatch(liveTool, /fetch\(input\.url/);

  assert.match(source, /action === 'workspace-search'/);
  assert.match(source, /action === 'live-tool'/);
  assert.match(source, /requestedModelProfile: payload\.requestedModelProfile === 'auto'/);
});

test('workspace search admission bounds per-user rate and concurrency', () => {
  const now = 1_000;
  const options = {
    now,
    windowMs: 10_000,
    rateLimit: 3,
    concurrencyLimit: 2,
    leaseMs: 1_000,
  };
  const first = reserveWinstonWorkspaceSearchAdmission(null, {
    ...options,
    token: 'search_token_123456',
  });
  assert.equal(first.admitted, true);
  assert.equal(first.state.count, 1);

  const replay = reserveWinstonWorkspaceSearchAdmission(first.state, {
    ...options,
    token: 'search_token_123456',
  });
  assert.equal(replay.admitted, true);
  assert.equal(replay.reused, true);
  assert.equal(replay.state.count, 1);

  const second = reserveWinstonWorkspaceSearchAdmission(first.state, {
    ...options,
    token: 'search_token_654321',
  });
  assert.equal(second.admitted, true);
  const concurrent = reserveWinstonWorkspaceSearchAdmission(second.state, {
    ...options,
    token: 'search_token_777777',
  });
  assert.deepEqual(
    { admitted: concurrent.admitted, reason: concurrent.reason },
    { admitted: false, reason: 'concurrency_limited' },
  );

  const afterLease = reserveWinstonWorkspaceSearchAdmission(second.state, {
    ...options,
    now: now + 1_001,
    token: 'search_token_777777',
  });
  assert.equal(afterLease.admitted, true);
  assert.equal(afterLease.state.count, 3);
  const rateLimited = reserveWinstonWorkspaceSearchAdmission(afterLease.state, {
    ...options,
    now: now + 1_002,
    token: 'search_token_888888',
  });
  assert.deepEqual(
    { admitted: rateLimited.admitted, reason: rateLimited.reason },
    { admitted: false, reason: 'rate_limited' },
  );

  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const branchStart = source.indexOf("if (action === 'workspace-search')");
  const branchEnd = source.indexOf("if (action === 'live-tool')", branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  const branch = source.slice(branchStart, branchEnd);
  assert.ok(
    branch.indexOf('acquireWinstonWorkspaceSearchAdmission')
      < branch.indexOf('loadAuthorizedWinstonWorkspaceSearch'),
  );
  assert.match(branch, /finally \{/);
  assert.match(branch, /releaseWinstonWorkspaceSearchAdmission/);
});

test('proactive dispatch is Pro-only, deterministic, and does not call an AI model', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function dispatchWinstonProactiveSchedule');
  const end = source.indexOf('\nasync function dispatchDueWinstonReminder', start);
  assert.ok(start >= 0 && end > start);
  const dispatch = source.slice(start, end);
  assert.match(dispatch, /await userTier\(uid\)\) !== 'pro'/);
  assert.match(dispatch, /type: 'winston'/);
  assert.match(dispatch, /action: 'open_winston'/);
  assert.match(dispatch, /notificationId = `winston_\$\{indexId\.slice/);
  assert.match(dispatch, /claimExpiresAt: now \+ 2 \* 60 \* 1000/);
  assert.doesNotMatch(dispatch, /callAiModel|chargeBananas/);

  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.deepEqual(rules.ai_runtime.proactive_schedule_index_v1['.indexOn'], ['nextRunAt']);
  assert.deepEqual(rules.ai_runtime.winston_reminder_index_v1['.indexOn'], ['dueAt']);
  assert.equal(rules.ai_agent_private['.read'], false);
  assert.equal(rules.ai_agent_private['.write'], false);
});

test('schedule and reminder dual writes are atomic or repaired idempotently', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const functionSource = (name, nextName) => {
    const start = source.indexOf(`async function ${name}`);
    const end = source.indexOf(`\nasync function ${nextName}`, start + 1);
    assert.ok(start >= 0 && end > start, `${name} must precede ${nextName}`);
    return source.slice(start, end);
  };

  const saveSchedule = functionSource('saveWinstonSchedule', 'deleteWinstonSchedule');
  assert.match(saveSchedule, /canonicalWinstonScheduleId\(schedule\.kind\)/);
  assert.match(saveSchedule, /acquireWinstonScheduleMutationLock\(uid, now\)/);
  assert.match(saveSchedule, /reconcileWinstonSchedulesLocked\(uid, now\)/);
  assert.match(saveSchedule, /plan\.aliases\[requestedId\]/);
  assert.match(saveSchedule, /!requestedCanonicalId \|\| !plan\.records\[canonicalId\]/);
  assert.match(saveSchedule, /requestedCanonicalId !== canonicalId/);
  assert.match(saveSchedule, /admin\.database\(\)\.ref\(\)\.update\(\{/);
  assert.match(saveSchedule, /schedules\/\$\{canonicalId\}`\]: stored/);
  assert.match(saveSchedule, /winstonScheduleIndexId\(uid, canonicalId\)/);
  assert.doesNotMatch(saveSchedule, /\.push\(\)/);

  const deleteSchedule = functionSource('deleteWinstonSchedule', 'saveWinstonFeedback');
  assert.match(deleteSchedule, /acquireWinstonScheduleMutationLock\(uid\)/);
  assert.match(deleteSchedule, /const targetIds = kind/);
  assert.match(deleteSchedule, /admin\.database\(\)\.ref\(\)\.update\(updates\)/);
  assert.match(deleteSchedule, /schedules\/\$\{targetId\}`\] = null/);
  assert.match(deleteSchedule, /winstonScheduleIndexId\(uid, targetId\)/);
  assert.match(deleteSchedule, /winstonScheduleIndexId\(uid, legacyId\)/);

  const reconcile = functionSource('reconcileWinstonSchedulesLocked', 'listWinstonSchedules');
  assert.match(reconcile, /canonicalizeWinstonScheduleRecords\(source, \{ now \}\)/);
  assert.match(reconcile, /schedules\/\$\{id\}`\] = null/);
  assert.match(reconcile, /winstonScheduleIndexRecord\(uid, id, schedule\)/);
  assert.match(reconcile, /winstonScheduleIndexId\(uid, legacyId\)/);
  assert.match(reconcile, /scheduleAliases/);
  assert.match(reconcile, /AI_WINSTON_SCHEDULE_ALIAS_LIMIT/);
  assert.match(deleteSchedule, /aliases\[id\]\?\.kind/);

  const createReminder = functionSource('executeSetReminderAiAction', 'executeCompleteTaskAiAction');
  assert.match(createReminder, /admin\.database\(\)\.ref\(\)\.update\(\{/);
  assert.match(createReminder, /\[`user_reminders\/\$\{uid\}\/\$\{reminderId\}`\]: reminder/);
  assert.match(createReminder, /\[`\$\{AI_WINSTON_REMINDER_INDEX_PATH\}\/\$\{winstonScheduleIndexId\(uid, reminderId\)\}`\]/);
  assert.match(createReminder, /else if \(!Number\(existing\.firedAt \|\| 0\)\)[\s\S]*Repair the dispatch index idempotently/);

  const scheduleDispatch = functionSource('dispatchWinstonProactiveSchedule', 'removeMatchingWinstonReminderIndex');
  assert.match(
    scheduleDispatch,
    /Number\(schedule\.revision \|\| 0\) !== Number\(indexRecord\.revision \|\| 0\)[\s\S]*repairWinstonScheduleIndex\(indexId, uid, scheduleId, schedule\)/
  );
  assert.match(scheduleDispatch, /if \(!update\.committed\)[\s\S]*repairWinstonScheduleIndex\(indexId, uid, scheduleId, currentSchedule\)/);
  assert.ok(
    scheduleDispatch.indexOf('const update = await scheduleReference.transaction') <
      scheduleDispatch.indexOf('await indexReference.set({ uid, scheduleId, nextRunAt, revision })'),
    'the schedule record must advance before its index'
  );
  assert.match(scheduleDispatch, /retained for repair/);

  const reminderStart = source.indexOf('async function dispatchDueWinstonReminder');
  const reminderEnd = source.indexOf('\nexports.winstonProactiveDispatch = functions', reminderStart + 1);
  assert.ok(reminderStart >= 0 && reminderEnd > reminderStart);
  const reminderDispatch = source.slice(reminderStart, reminderEnd);
  assert.match(reminderDispatch, /claimId, claimExpiresAt: now \+ 2 \* 60 \* 1000/);
  assert.match(reminderDispatch, /repairWinstonReminderIndex\(indexId, uid, reminderId, reminder\)/);
  assert.ok(
    reminderDispatch.indexOf('notifications/${uid}/${notificationId}`')
      < reminderDispatch.indexOf('const fired = await reference.transaction'),
    'the deterministic notification must be durable before the reminder is marked fired'
  );
  assert.match(reminderDispatch, /transaction\(\(current\) => current \|\| \{/);
  assert.match(reminderDispatch, /if \(!fired\.committed[\s\S]*repairWinstonReminderIndex\(indexId, uid, reminderId, currentReminder\)/);

  const proactiveExportStart = source.indexOf('exports.winstonProactiveDispatch = functions');
  const reminderExportStart = source.indexOf('exports.winstonReminderDispatch = functions', proactiveExportStart);
  const gatewayStart = source.indexOf('exports.aiGateway = functions', reminderExportStart);
  assert.ok(proactiveExportStart >= 0 && reminderExportStart > proactiveExportStart && gatewayStart > reminderExportStart);
  const proactiveExport = source.slice(proactiveExportStart, reminderExportStart);
  const reminderExport = source.slice(reminderExportStart, gatewayStart);
  assert.match(proactiveExport, /\.pubsub\.schedule\('every 15 minutes'\)/);
  assert.match(proactiveExport, /AI_PROACTIVE_SCHEDULE_INDEX_PATH/);
  assert.doesNotMatch(proactiveExport, /dispatchDueWinstonReminder|AI_WINSTON_REMINDER_INDEX_PATH/);
  assert.match(reminderExport, /\.pubsub\.schedule\('every 1 minutes'\)/);
  assert.match(reminderExport, /AI_WINSTON_REMINDER_INDEX_PATH/);
  assert.match(reminderExport, /dispatchDueWinstonReminder/);
  assert.doesNotMatch(reminderExport, /dispatchWinstonProactiveSchedule|AI_PROACTIVE_SCHEDULE_INDEX_PATH/);
});
