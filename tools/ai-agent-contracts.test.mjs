import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AI_CLARIFICATION_MARKER_END,
  AI_CLARIFICATION_MARKER_START,
  AI_CLARIFICATION_MAX_OPTION_CHARS,
  AI_CLARIFICATION_MAX_OPTIONS,
  AI_CLARIFICATION_MAX_QUESTION_CHARS,
  AI_CLARIFICATION_MIN_OPTIONS,
  AI_CLARIFICATION_SAFE_FALLBACK,
  AI_ACTION_MAX_INVITEES,
  AI_ACTION_TYPES,
  aiProviderExclusionsForPolicy,
  buildCreateRoomProposal,
  buildCreateTaskProposal,
  buildInviteFriendsProposal,
  buildStartFriendCallProposal,
  normalizeAiRoutingPolicy,
  parseAiSocialActionIntent,
  parseAiClarificationReply,
  publicAiAction,
  sanitizeAiClarificationInteraction,
  sanitizeAiClarificationPartialReply,
  sanitizeAiImageAttachment,
  sanitizeAiMemoryInput,
  sanitizeAiPreloadMetadata,
  sanitizeSelectedRoomIds,
  validateAiReplyCitations
} = require('../functions/ai-agent-contracts.js');
const { buildAiRoomContextBundle } = require('../functions/ai-context.js');

test('routing policy is explicit and local-only excludes every cloud tier', () => {
  assert.equal(normalizeAiRoutingPolicy(), 'balanced');
  assert.equal(normalizeAiRoutingPolicy('auto'), 'balanced');
  assert.equal(normalizeAiRoutingPolicy('local-only'), 'local-only');
  assert.deepEqual(aiProviderExclusionsForPolicy('local-only'), ['cloudflare-workers-ai', 'groq']);
  assert.throws(() => normalizeAiRoutingPolicy('cloud-please'), /balanced.*local-only/i);
});

test('briefing rooms are deduplicated, validated, and capped', () => {
  assert.deepEqual(sanitizeSelectedRoomIds(['global', 'room_123456', 'global']), ['global', 'room_123456']);
  assert.throws(() => sanitizeSelectedRoomIds([]), /at least one/i);
  assert.throws(() => sanitizeSelectedRoomIds(Array.from({ length: 9 }, (_, index) => `room_${100000 + index}`)), /at most 8/i);
  assert.throws(() => sanitizeSelectedRoomIds(['rooms/private/path']), /invalid/i);
});

test('server-built source bundle retains opaque navigation fields and exact citations', () => {
  const bundle = buildAiRoomContextBundle({
    roomId: 'room_123456',
    channelId: 'ops_123456',
    roomName: 'Operations',
    query: 'launch',
    messages: [{ id: 'msg_123456', name: 'Ari', text: 'Launch moved to Friday.', timestamp: 42 }],
    tasks: [{ id: 'task_123456', text: 'Prepare launch notes', createdAt: 40 }]
  });
  assert.match(bundle.context, /\[S\d+\]/);
  const message = bundle.sources.find((source) => source.type === 'message');
  assert.deepEqual(
    { roomId: message.roomId, channelId: message.channelId, itemId: message.itemId },
    { roomId: 'room_123456', channelId: 'ops_123456', itemId: 'msg_123456' }
  );

  const validated = validateAiReplyCitations('Friday is confirmed [S2](https://fake.invalid/path). Fake [S999].', bundle.sources);
  assert.doesNotMatch(validated.reply, /S999/);
  assert.doesNotMatch(validated.reply, /fake\.invalid/);
  assert.ok(validated.sources.every((source) => validated.reply.includes(`[${source.id}]`)));
  assert.ok(validated.sources.every((source) => !('path' in source)));

  const crowded = buildAiRoomContextBundle({
    roomId: 'room_123456',
    maxChars: 1200,
    maxSources: 32,
    tasks: Array.from({ length: 20 }, (_, index) => ({ id: `task_${100000 + index}`, text: `Task ${index} ${'detail '.repeat(12)}`, createdAt: index })),
    messages: Array.from({ length: 40 }, (_, index) => ({ id: `msg_${100000 + index}`, name: 'Member', text: `Message ${index} ${'context '.repeat(14)}`, timestamp: index })),
  });
  assert.ok(crowded.sources.every((source) => crowded.context.includes(`[${source.id}]`)), 'manifest may only include evidence present in the final prompt');
});

test('event lookup returns bounded event evidence with safe navigation metadata', () => {
  const bundle = buildAiRoomContextBundle({
    roomId: 'room_123456',
    roomName: 'Launch Room',
    query: 'kickoff',
    events: [{
      id: 'event_123456',
      title: 'Launch kickoff',
      date: '2026-07-25',
      time: '10:00',
      location: 'HQ',
      createdAt: 1_234,
      privatePath: 'must-not-leak',
    }],
  });
  const event = bundle.sources.find((source) => source.type === 'event');
  assert.deepEqual(event, {
    id: 'S1',
    type: 'event',
    roomId: 'room_123456',
    channelId: 'general',
    itemId: 'event_123456',
    label: 'Launch kickoff',
    timestamp: 1_234,
    excerpt: '2026-07-25 10:00 Launch kickoff — HQ',
  });
  assert.match(bundle.context, /Events:[\s\S]*\[S1\].*Launch kickoff/);
  assert.equal(Object.hasOwn(event, 'privatePath'), false);
});

test('strict trailing clarification marker becomes a server-owned interaction', () => {
  const parsed = parseAiClarificationReply(`Which calendar should I use?\n\n${AI_CLARIFICATION_MARKER_START}\n${JSON.stringify({
    question: 'Which calendar should I use?',
    options: ['Personal', { id: 'model-controlled', label: 'Work' }, 'This room'],
    allowFreeText: false,
    id: 'also-model-controlled',
    authorizesWrite: true,
  })}\n${AI_CLARIFICATION_MARKER_END}`);

  assert.equal(parsed.reply, 'Which calendar should I use?');
  assert.match(parsed.interaction.id, /^clarification_[a-f0-9]{24}$/);
  assert.equal(parsed.interaction.type, 'clarification');
  assert.equal(parsed.interaction.allowFreeText, true, 'the model cannot disable typed answers');
  assert.deepEqual(parsed.interaction.options.map((option) => option.label), ['Personal', 'Work', 'This room']);
  assert.ok(parsed.interaction.options.every((option) => /^option_\d_[a-f0-9]{16}$/.test(option.id)));
  assert.ok(parsed.interaction.options.every((option) => option.id !== 'model-controlled'));
  assert.equal('authorizesWrite' in parsed.interaction, false);
  assert.doesNotMatch(parsed.reply, /MINIMALIST_CLARIFICATION|allowFreeText/);
});

test('clarification parser restores the validated question when visible prose omits it', () => {
  const marker = `${AI_CLARIFICATION_MARKER_START}\n${JSON.stringify({
    question: 'Which date should I schedule?',
    options: ['Today', 'Tomorrow'],
    allowFreeText: true,
  })}\n${AI_CLARIFICATION_MARKER_END}`;
  assert.equal(parseAiClarificationReply(marker).reply, 'Which date should I schedule?');
  assert.equal(
    parseAiClarificationReply(`I need one detail.\n\n${marker}`).reply,
    'I need one detail.\n\nWhich date should I schedule?'
  );
});

test('malformed or non-trailing clarification markers are stripped and never become interactions', () => {
  const malformed = parseAiClarificationReply(
    `I need one detail.\n${AI_CLARIFICATION_MARKER_START}\n{not-json}\n${AI_CLARIFICATION_MARKER_END}`
  );
  assert.deepEqual(malformed, { reply: 'I need one detail.', interaction: null });

  const trailingText = parseAiClarificationReply(
    `Visible\n${AI_CLARIFICATION_MARKER_START}\n{"question":"Where?","options":["Here","There"]}\n${AI_CLARIFICATION_MARKER_END}\nunsafe trailing text`
  );
  assert.deepEqual(trailingText, { reply: 'Visible', interaction: null });
  assert.doesNotMatch(trailingText.reply, /unsafe|MINIMALIST/);
});

test('malformed marker-only model output becomes a safe nonempty completed reply', () => {
  const invalidReplies = [
    '',
    AI_CLARIFICATION_MARKER_START.slice(0, -3),
    `${AI_CLARIFICATION_MARKER_START}\n{not-json}\n${AI_CLARIFICATION_MARKER_END}`,
    `${AI_CLARIFICATION_MARKER_START}\n${JSON.stringify({ question: 'Which room?', options: ['Only one'] })}\n${AI_CLARIFICATION_MARKER_END}`,
    `${AI_CLARIFICATION_MARKER_START}\n${JSON.stringify({ question: '', options: ['One', 'Two'] })}\n${AI_CLARIFICATION_MARKER_END}`,
  ];
  for (const modelReply of invalidReplies) {
    const parsed = parseAiClarificationReply(modelReply);
    assert.equal(parsed.reply, AI_CLARIFICATION_SAFE_FALLBACK);
    assert.equal(parsed.interaction, null);
    assert.ok(parsed.reply.trim().length > 0);
    assert.doesNotMatch(parsed.reply, /MINIMALIST_CLARIFICATION|not-json|"options"/);
  }
});

test('clarification question and option bounds are strict and deterministic', () => {
  const valid = sanitizeAiClarificationInteraction({
    question: 'Q'.repeat(AI_CLARIFICATION_MAX_QUESTION_CHARS),
    options: Array.from({ length: AI_CLARIFICATION_MAX_OPTIONS }, (_, index) => `${index}-${'O'.repeat(AI_CLARIFICATION_MAX_OPTION_CHARS - 2)}`),
    allowFreeText: true,
  });
  assert.ok(valid);
  assert.equal(valid.options.length, AI_CLARIFICATION_MAX_OPTIONS);
  assert.deepEqual(valid, sanitizeAiClarificationInteraction(valid), 'server-generated IDs are deterministic');

  assert.equal(sanitizeAiClarificationInteraction({ question: 'Q'.repeat(AI_CLARIFICATION_MAX_QUESTION_CHARS + 1), options: ['A', 'B'] }), null);
  assert.equal(sanitizeAiClarificationInteraction({ question: 'Question?', options: ['A', 'O'.repeat(AI_CLARIFICATION_MAX_OPTION_CHARS + 1)] }), null);
  assert.equal(sanitizeAiClarificationInteraction({ question: 'Question?', options: Array(AI_CLARIFICATION_MIN_OPTIONS - 1).fill('A') }), null);
  assert.equal(sanitizeAiClarificationInteraction({ question: 'Question?', options: Array.from({ length: AI_CLARIFICATION_MAX_OPTIONS + 1 }, (_, index) => String(index)) }), null);
  assert.equal(sanitizeAiClarificationInteraction({ question: 'Question?', options: ['Same', ' same '] }), null);
  assert.equal(sanitizeAiClarificationInteraction({ question: 'Question?', options: ['A', 'B'], allowFreeText: false }).allowFreeText, true);
  assert.equal(sanitizeAiClarificationInteraction({ question: 'Question?', options: ['A', 'B'], allowFreeText: 'no' }).allowFreeText, true);
});

test('clarification questions and choices cannot carry source markers or citation links', () => {
  const interaction = sanitizeAiClarificationInteraction({
    question: 'Which source [S999](https://fake.invalid/path)?',
    options: ['Use [S1]', { label: 'Ignore [S999](https://fake.invalid)' }],
  });
  assert.equal(interaction.question, 'Which source?');
  assert.deepEqual(interaction.options.map((option) => option.label), ['Use', 'Ignore']);
  assert.doesNotMatch(JSON.stringify(interaction), /\[S\d+\]|fake\.invalid/);

  const parsed = parseAiClarificationReply(
    `Which source [S999](https://fake.invalid/path)?\n${AI_CLARIFICATION_MARKER_START}\n${JSON.stringify({
      question: 'Which source [S999](https://fake.invalid/path)?',
      options: ['Use [S1]', 'Ignore [S999]'],
    })}\n${AI_CLARIFICATION_MARKER_END}`
  );
  const cited = validateAiReplyCitations(parsed.reply, []);
  assert.equal(cited.reply, 'Which source?');
  assert.doesNotMatch(cited.reply, /\[S\d+\]|fake\.invalid/);
});

test('stream-safe clarification sanitizer withholds marker bodies and every partial prefix', () => {
  assert.equal(sanitizeAiClarificationPartialReply('Normal visible reply'), 'Normal visible reply');
  for (let length = 1; length <= AI_CLARIFICATION_MARKER_START.length; length += 1) {
    const partial = `Visible question\n\n${AI_CLARIFICATION_MARKER_START.slice(0, length)}`;
    assert.equal(sanitizeAiClarificationPartialReply(partial), 'Visible question');
  }
  assert.equal(
    sanitizeAiClarificationPartialReply(`Visible question\n\n${AI_CLARIFICATION_MARKER_START}\n{"question":"partial`),
    'Visible question'
  );
});

test('memory cards require explicit bounded input and valid scope', () => {
  const personal = sanitizeAiMemoryInput({ text: ' Prefer short answers. ', scope: 'personal', provenance: 'Saved by me' }, { now: 1000 });
  assert.equal(personal.text, 'Prefer short answers.');
  assert.equal(personal.scope, 'personal');
  const room = sanitizeAiMemoryInput({ text: 'Use the weekly template.', scope: 'room', roomId: 'room_123456', expiresAt: 2000 }, { now: 1000 });
  assert.equal(room.roomId, 'room_123456');
  assert.throws(() => sanitizeAiMemoryInput({ text: 'x', scope: 'room' }), /roomId/i);
  assert.throws(() => sanitizeAiMemoryInput({ text: 'x', scope: 'automatic' }), /scope/i);
  assert.throws(() => sanitizeAiMemoryInput({ text: 'x', expiresAt: 900 }, { now: 1000 }), /future/i);
});

test('image input validates raw base64, MIME, byte limit, and magic signature', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]).toString('base64');
  const attachment = sanitizeAiImageAttachment({ name: 'photo.jpg', mimeType: 'image/jpeg', image: jpeg });
  assert.equal(attachment.size, 5);
  assert.throws(() => sanitizeAiImageAttachment({ mimeType: 'image/jpeg', image: `data:image/jpeg;base64,${jpeg}` }), /raw base64/i);
  assert.throws(() => sanitizeAiImageAttachment({ mimeType: 'image/png', image: jpeg }), /MIME type/i);
  assert.throws(() => sanitizeAiImageAttachment({ mimeType: 'image/gif', image: jpeg }), /JPEG, PNG, or WebP/i);
});

test('create-task tool only creates a typed confirmation proposal', () => {
  const proposal = buildCreateTaskProposal({
    uid: 'user_123456',
    requestId: 'request_123456',
    roomId: 'room_123456',
    messages: [{ role: 'user', content: 'Create a task to prepare the launch notes' }],
    now: 1000
  });
  assert.equal(proposal.type, 'create_task');
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.payload.text, 'prepare the launch notes');
  assert.equal(buildCreateTaskProposal({
    uid: 'user_123456', requestId: 'request_654321', roomId: 'room_123456',
    messages: [{ role: 'user', content: "Don't create a task to prepare the launch notes" }]
  }), null);
});

test('social action intent parsing returns names and scope, never trusted contact ids', () => {
  assert.deepEqual(parseAiSocialActionIntent([
    { role: 'user', content: 'Create a private room called Launch Crew and invite Ari and Bo' },
  ], { roomId: 'global' }), {
    type: 'create_room',
    roomName: 'Launch Crew',
    roomType: 'friends',
    requestedNames: ['Ari', 'Bo'],
    resolutionRequired: false,
  });
  assert.deepEqual(parseAiSocialActionIntent([
    { role: 'user', content: 'Invite Ari and Bo to this room' },
  ], { roomId: 'room_123456' }), {
    type: 'invite_friends',
    roomId: 'room_123456',
    requestedNames: ['Ari', 'Bo'],
  });
  assert.deepEqual(parseAiSocialActionIntent([
    { role: 'user', content: 'Call Ari' },
  ]), {
    type: 'start_friend_call',
    requestedNames: ['Ari'],
  });
  assert.equal(parseAiSocialActionIntent([
    { role: 'user', content: 'Do not call Ari' },
  ]), null);
  assert.equal(parseAiSocialActionIntent([
    { role: 'user', content: 'Create a room' },
  ]), null, 'missing room names must clarify instead of proposing a mutation');
  assert.deepEqual(parseAiSocialActionIntent([
    { role: 'user', content: 'Invite everyone to this room' },
  ], { roomId: 'room_123456' }), {
    type: 'invite_friends',
    roomId: 'room_123456',
    requestedNames: [],
    resolutionRequired: true,
  });
  assert.equal(parseAiSocialActionIntent([
    { role: 'user', content: 'Look up events next week' },
  ], { roomId: 'room_123456' }), null, 'read-only event lookup is evidence, not a confirmation action');
});

test('room creation proposals are deterministic, bounded, and always require confirmation', () => {
  const contacts = Array.from({ length: AI_ACTION_MAX_INVITEES + 4 }, (_, index) => ({
    uid: `friend_${String(index).padStart(3, '0')}`,
    name: `Friend ${index}`,
  }));
  const proposal = buildCreateRoomProposal({
    uid: 'user_123456',
    requestId: 'request_123456',
    roomName: 'Launch Crew',
    roomType: 'friends',
    contacts,
    now: 1_000,
  });
  assert.equal(proposal.type, 'create_room');
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.payload.name, 'Launch Crew');
  assert.equal(proposal.payload.roomType, 'friends');
  assert.equal(proposal.payload.inviteeUids.length, AI_ACTION_MAX_INVITEES);
  assert.equal(proposal.expiresAt > proposal.createdAt, true);
  assert.equal(buildCreateRoomProposal({
    uid: 'user_123456', requestId: 'request_123456', roomName: 'Launch Crew', contacts, now: 2_000,
  }).id, proposal.id, 'retries use the same server action id');
  assert.equal(buildCreateRoomProposal({
    uid: 'user_123456', requestId: 'request_654321', roomName: '', contacts,
  }), null);
});

test('invite and call proposals can only be built from resolved contact records', () => {
  const friend = { uid: 'friend_123456', name: 'Ari' };
  const invite = buildInviteFriendsProposal({
    uid: 'user_123456', requestId: 'request_invite', roomId: 'room_123456', contacts: [friend], now: 1_000,
  });
  assert.equal(invite.type, 'invite_friends');
  assert.equal(invite.roomId, 'room_123456');
  assert.deepEqual(invite.payload, {
    roomId: 'room_123456',
    targetUids: ['friend_123456'],
    targetNames: ['Ari'],
  });
  assert.equal(invite.requiresConfirmation, true);
  assert.equal(buildInviteFriendsProposal({
    uid: 'user_123456', requestId: 'request_invite', roomId: 'global', contacts: [friend],
  }), null);
  assert.equal(buildInviteFriendsProposal({
    uid: 'user_123456', requestId: 'request_invite', roomId: 'room_123456', contacts: [],
  }), null);

  const call = buildStartFriendCallProposal({
    uid: 'user_123456', requestId: 'request_call', contact: friend, now: 1_000,
  });
  assert.equal(call.type, 'start_friend_call');
  assert.equal(call.requiresConfirmation, true);
  assert.deepEqual(call.payload, { targetUid: 'friend_123456', targetName: 'Ari' });
  assert.equal(buildStartFriendCallProposal({
    uid: 'user_123456', requestId: 'request_call', contact: { uid: 'bad/path', name: 'Mallory' },
  }), null);
});

test('public Winston social actions expose only allowlisted result fields', () => {
  assert.deepEqual(AI_ACTION_TYPES, [
    'create_task',
    'create_room',
    'invite_friends',
    'start_friend_call',
    'create_event',
    'update_event',
    'set_reminder',
    'complete_task',
  ]);
  const id = 'a'.repeat(64);
  const publicCall = publicAiAction({
    id,
    ownerUid: 'private-owner',
    type: 'start_friend_call',
    title: 'Call Ari',
    description: 'Confirm the call.',
    requiresConfirmation: true,
    status: 'confirmed',
    payload: { targetUid: 'should-not-leak-from-payload' },
    result: {
      threadId: 'friend_123456_user_123456',
      targetUid: 'friend_123456',
      targetName: 'Ari',
      callIntentExpiresAt: 5_000,
      microphoneToken: 'secret',
    },
    expiresAt: 4_000,
  });
  assert.deepEqual(publicCall, {
    id,
    type: 'start_friend_call',
    title: 'Call Ari',
    description: 'Confirm the call.',
    requiresConfirmation: true,
    status: 'confirmed',
    roomId: '',
    expiresAt: 4_000,
    result: {
      threadId: 'friend_123456_user_123456',
      targetUid: 'friend_123456',
      targetName: 'Ari',
      callIntentExpiresAt: 5_000,
    },
  });
  assert.equal(Object.hasOwn(publicCall, 'payload'), false);
  assert.equal(Object.hasOwn(publicCall, 'ownerUid'), false);
});

test('friendship accept loads the stored pair before applying its transition', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const timeoutMatch = source.match(/const FRIENDSHIP_FUNCTION_TIMEOUT_SECONDS = (\d+);/);
  const leaseMatch = source.match(/const FRIENDSHIP_LOCK_TTL_MS = (\d+);/);
  assert.ok(timeoutMatch && leaseMatch, 'friendship deadline and lease must be explicit');
  assert.ok(
    Number(leaseMatch[1]) > Number(timeoutMatch[1]) * 1000,
    'the lock lease must outlive the Cloud Function deadline',
  );
  const endpointStart = source.indexOf('exports.manageFriendship =');
  const endpointEnd = source.indexOf('\nexports.', endpointStart + 1);
  assert.ok(endpointStart >= 0 && endpointEnd > endpointStart, 'manageFriendship endpoint must exist');
  const endpoint = source.slice(endpointStart, endpointEnd);
  assert.doesNotMatch(
    endpoint,
    /transitionFriendshipPair\(null\s*,/,
    'accept must not be rejected against an artificial empty pair before stored state is loaded',
  );
  assert.ok(
    endpoint.indexOf('const [pairSnapshot, mineSnapshot, theirsSnapshot]')
      < endpoint.indexOf('transitionFriendshipPair(currentPair'),
    'the canonical pair and legacy projections must be loaded before the transition',
  );
  assert.match(
    endpoint,
    /\.runWith\(\{ timeoutSeconds: FRIENDSHIP_FUNCTION_TIMEOUT_SECONDS \}\)/,
    'the runtime must terminate a stale request before its lease can expire',
  );
  assert.match(
    source,
    /current\?\.claimId !== lock\.claimId\s*\|\| Number\(current\?\.expiresAt \|\| 0\) <= now/,
    'an expired owner must not revive its lease before writing',
  );
  const updateAt = endpoint.indexOf('await admin.database().ref().update({');
  const renewAt = endpoint.lastIndexOf('await renewFriendshipMutationLock(lock);', updateAt);
  const releaseAt = endpoint.indexOf('await releaseFriendshipMutationLock(lock);', updateAt);
  const successAt = endpoint.indexOf('return res.status(200).json({', releaseAt);
  assert.ok(
    renewAt >= 0 && updateAt > renewAt && releaseAt > updateAt && successAt > releaseAt,
    'the claim must be renewed before fan-out and released before a successful response',
  );
  const catchAt = endpoint.indexOf('} catch (error) {');
  const catchReleaseAt = endpoint.indexOf('await releaseFriendshipMutationLock(lock);', catchAt);
  const errorAt = endpoint.indexOf('return res.status(error.status || 500).json({', catchReleaseAt);
  assert.ok(
    catchAt >= 0 && catchReleaseAt > catchAt && errorAt > catchReleaseAt,
    'the pair lock must be released before an error response permits a retry',
  );
});

test('social confirmations revalidate friendship, room permission, quota, and one-shot state', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const between = (startNeedle, endNeedle) => {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0 && end > start, `${startNeedle} must precede ${endNeedle}`);
    return source.slice(start, end);
  };

  const friendGuard = between(
    'async function requireAcceptedFriendTargets',
    '\nfunction roomMemberCanInvite',
  );
  assert.match(friendGuard, /friends\/\$\{uid\}\/\$\{targetUid\}/);
  assert.match(friendGuard, /friends\/\$\{targetUid\}\/\$\{uid\}/);
  assert.match(friendGuard, /mine\.val\(\) !== 'accepted' \|\| theirs\.val\(\) !== 'accepted'/);
  assert.match(friendGuard, /user_directory\/\$\{targetUid\}/);

  const createRoom = between(
    'async function executeCreateRoomAiAction',
    '\nasync function executeInviteFriendsAiAction',
  );
  assert.match(createRoom, /requireAcceptedFriendTargets\(uid, inviteeUids, \{ allowEmpty: true \}\)/);
  assert.ok(
    createRoom.indexOf('acquireAiRoomCreationLock(uid)')
      < createRoom.indexOf('requireAiRoomCreationCapacity(uid)'),
    'room quota must be checked while holding the per-user creation lock',
  );
  assert.ok(
    createRoom.indexOf('requireAiRoomCreationCapacity(uid)')
      < createRoom.indexOf('roomReference.transaction'),
    'quota must be checked before creating the room',
  );
  assert.match(createRoom, /finally \{[\s\S]*?releaseAiRoomCreationLock\(creationLock\)/);
  assert.match(createRoom, /roomReference\.transaction/);
  assert.match(createRoom, /roomInviteMessageUpdate/);

  const inviteFriends = between(
    'async function executeInviteFriendsAiAction',
    '\nasync function executeStartFriendCallAiAction',
  );
  assert.ok(
    inviteFriends.indexOf('requireRoomInviteAccess') < inviteFriends.indexOf('requireAcceptedFriendTargets'),
    'room access and invite permission must be checked before friend invite writes',
  );
  assert.match(inviteFriends, /!Object\.prototype\.hasOwnProperty\.call\(room\.members \|\| \{\}, target\.uid\)/);

  const friendCall = between(
    'async function executeStartFriendCallAiAction',
    '\nasync function finalizeAiActionConfirmation',
  );
  assert.match(friendCall, /requireAcceptedFriendTargets\(uid, \[targetUid\]\)/);
  assert.match(friendCall, /callIntentExpiresAt: now \+ 60 \* 1000/);
  assert.doesNotMatch(friendCall, /pm_calls\//, 'server confirmation produces a short browser intent, not a media call');

  const finalize = between(
    'async function finalizeAiActionConfirmation',
    '\nasync function releaseAiActionConfirmationClaim',
  );
  assert.match(finalize, /current\.status !== 'confirming' \|\| current\.confirmClaimId !== claimId/);
  assert.match(finalize, /delete next\.payload/);
  assert.match(finalize, /delete next\.confirmClaimId/);

  const confirm = between('async function confirmAiAction', '\nasync function dismissAiAction');
  assert.match(confirm, /if \(action\.status === 'confirmed'\) return publicAiAction\(action\)/);
  assert.match(confirm, /executeCreateRoomAiAction/);
  assert.match(confirm, /executeInviteFriendsAiAction/);
  assert.match(confirm, /executeStartFriendCallAiAction/);
  assert.match(confirm, /await releaseAiActionConfirmationClaim\(reference, uid, claimId\)/);
});

test('social capability and cross-room event lookup reads remain bounded', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const sliceFunction = (startNeedle, endNeedle) => {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const contacts = sliceFunction(
    'async function loadAcceptedFriendContacts',
    '\nasync function resolveRequestedFriendContacts',
  );
  assert.match(contacts, /orderByValue\(\)[\s\S]*?equalTo\('accepted'\)[\s\S]*?limitToFirst\(candidateLimit \+ 1\)/);
  assert.doesNotMatch(contacts, /ref\('user_directory'\)\.once/);
  assert.match(contacts, /reciprocalSnapshot\.val\(\) !== 'accepted'/);

  const boundedRoomEvents = sliceFunction(
    'async function loadBoundedAuthorizedRoomEvents',
    '\nasync function loadWinstonEventLookupContext',
  );
  assert.match(boundedRoomEvents, /roomReference\.child\('creatorId'\)\.once\('value'\)/);
  assert.match(boundedRoomEvents, /roomReference\.child\(`members\/\$\{uid\}`\)\.once\('value'\)/);
  assert.match(boundedRoomEvents, /roomReference\.child\('name'\)\.once\('value'\)/);
  assert.doesNotMatch(
    boundedRoomEvents,
    /roomReference\.once\('value'\)/,
    'event lookup must not download an entire room metadata record',
  );
  assert.match(boundedRoomEvents, /roomReference\.child\('events'\)/);
  assert.match(boundedRoomEvents, /eventReference\.orderByChild\('date'\)/);
  assert.match(boundedRoomEvents, /limitToLast\(8\)/);
  assert.match(boundedRoomEvents, /limitToFirst\(8\)/);
  assert.match(boundedRoomEvents, /limitToLast\(16\)/);
  assert.match(boundedRoomEvents, /limitToFirst\(16\)/);

  const events = sliceFunction(
    'async function loadWinstonEventLookupContext',
    '\nasync function persistAiActionProposal',
  );
  assert.match(events, /user_rooms\/\$\{uid\}/);
  assert.match(events, /limitToLast\(40\)/);
  assert.match(events, /candidateRoomIds\.map[\s\S]*?loadBoundedAuthorizedRoomEvents/);
  assert.doesNotMatch(events, /ref\('rooms_meta'\)\.once/);
  assert.match(events, /maxEvents: Math\.min\(24, available\)/);
});

test('personal event lookup reserves aligned base-room source IDs before appending event evidence', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const sliceFunction = (startNeedle, endNeedle) => {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0 && end > start, `${startNeedle} must precede ${endNeedle}`);
    return source.slice(start, end);
  };

  const builder = sliceFunction(
    'async function buildServerOwnedAiChat',
    '\nfunction queuedAiPayload',
  );
  assert.match(
    builder,
    /loadAiRoomContextBundle\([\s\S]*?mode === 'personal' && winstonEventLookupIntent\(query\)[\s\S]*?\{ maxSources: 8 \}/,
    'the builder-owned room bundle must cap its sources before event evidence is appended',
  );
  assert.ok(
    builder.indexOf('{ maxSources: 8 }') < builder.indexOf('loadWinstonEventLookupContext'),
    'base-room evidence must be budgeted before cross-room event sources are numbered',
  );

  const request = sliceFunction(
    'async function runServerOwnedAi',
    '\nasync function executeClaimedAiQueueJob',
  );
  assert.match(request, /const contextQuery = aiQueryFromConversation\(convo\)/);
  assert.match(
    request,
    /loadAiRoomContextBundle\([\s\S]*?contextQuery,[\s\S]*?mode === 'personal' && winstonEventLookupIntent\(contextQuery\) \? \{ maxSources: 8 \} : \{\}/,
    'preloaded room context must use the same event source reservation as the builder',
  );

  const vision = sliceFunction(
    'async function runLocalVisionAi',
    '\nasync function buildServerOwnedAiChat',
  );
  assert.match(
    vision,
    /loadAiRoomContextBundle\([\s\S]*?mode === 'personal' && winstonEventLookupIntent\(query\) \? \{ maxSources: 8 \} : \{\}/,
    'vision requests must preserve the same source-ID alignment',
  );

  const crowded = buildAiRoomContextBundle({
    roomId: 'room_123456',
    roomName: 'Busy Room',
    query: 'events',
    maxSources: 8,
    messages: Array.from({ length: 20 }, (_, index) => ({
      id: `msg_${100000 + index}`,
      name: 'Member',
      text: `Event planning note ${index}`,
      timestamp: index,
    })),
  });
  assert.equal(crowded.sources.length, 8);
  assert.ok(crowded.sources.every((item) => crowded.context.includes(`[${item.id}]`)));
  assert.doesNotMatch(crowded.context, /\[S(?:9|[1-9]\d+)\]/);
});

test('wake preload metadata is allowlisted, non-billable, and model-bound', () => {
  assert.deepEqual(sanitizeAiPreloadMetadata({
    ok: true,
    model: 'qwen3:14b',
    route: 'local-preload',
    billable: false,
    keepAlive: '120m',
    loadDurationMs: 702.8,
  }, 'qwen3:14b'), {
    warmed: true,
    model: 'qwen3:14b',
    route: 'local-preload',
    billable: false,
    keepAlive: '120m',
    loadDurationMs: 702,
  });
  assert.throws(() => sanitizeAiPreloadMetadata({
    ok: true, model: 'different-model', route: 'local-preload', billable: false,
  }, 'qwen3:14b'), /invalid preload metadata/i);
  assert.throws(() => sanitizeAiPreloadMetadata({
    ok: true, model: 'qwen3:14b', route: 'cloud', billable: true,
  }, 'qwen3:14b'), /invalid preload metadata/i);
});

test('memory and action records are denied to raw RTDB clients', () => {
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.equal(rules.ai_agent_private['.read'], false);
  assert.equal(rules.ai_agent_private['.write'], false);
  assert.deepEqual(rules.ai_agent_private.$uid.memories['.indexOn'], ['createdAt', 'expiresAt', 'dedupeKey']);
});

test('gateway wiring keeps old reply shape and adds gated capabilities', () => {
  const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(source, /action === 'confirm-action'/);
  assert.match(source, /action === 'memory-create'/);
  assert.match(source, /mode === 'briefing'/);
  assert.match(source, /loadAiRoomContextBundle\(\s*uid,\s*roomId,\s*'general'/);
  assert.match(source, /routingPolicy === 'local-only'/);
  assert.match(source, /function acquireAiProviderLease\(\{ excludedProviders = \[\], routingPolicy = 'balanced' \}/);
  assert.match(source, /providerRouterReadiness\(routingPolicy\)/);
  assert.match(source, /routingPolicy: candidate\.job\?\.payload\?\.routingPolicy/);
  assert.match(source, /selectedRoutingPolicy === 'local-only' \? 'ollama-bridge' : ''/);
  assert.match(source, /if \(localOnly \|\| !canFallbackAfterBridgeError\(error\)\) throw error/);
  assert.match(source, /runLocalVisionAi/);
  assert.match(source, /sources: cited\.sources/);
  assert.equal(
    (source.match(/let finalReply = cited\.reply/g) || []).length,
    3,
    'vision, direct, and queued paths must begin with the cited reply before plan/verification processing',
  );
  assert.match(source, /reply: finalReply/);
  assert.match(source, /buildVerifiedAnswerReport\(\{\s*answer: finalReply/);
  assert.match(source, /interaction: parsedReply\.interaction/);
  assert.match(source, /const parsedReply = parseAiClarificationReply\(modelResult\.reply\)/);
  assert.match(source, /const interaction = sanitizeAiClarificationInteraction\(result\?\.interaction\) \|\| parsedReply\.interaction/);
  assert.match(
    source,
    /const partial = sanitizeWinstonPlanPartialReply\(\s*sanitizeAiClarificationPartialReply\(value\)/,
  );
  assert.equal((source.match(/if \(!parsedReply\.interaction\) \{/g) || []).length, 3, 'all inference paths suppress actions while clarifying');
  assert.match(source, /partialReply: partial/);
  assert.match(source, /fetchWithTimeout\(`\$\{origin\}\/api\/preload`/);
  assert.match(source, /JSON\.stringify\(\{ model: profile\.model \}\)/);
});
