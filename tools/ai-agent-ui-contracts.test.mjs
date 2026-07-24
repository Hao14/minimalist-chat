import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAiGatewayActionPayload,
  buildAiGatewayChatPayload,
  buildAiGatewayStatusPayload,
  buildPersonalAiMemoryPayload,
} from '../src/features/ai/gatewayPayload.js';
import {
  AI_SOURCE_OPEN_EVENT,
  aiActionPresentation,
  aiActionSuccessMessage,
  answerAiClarification,
  appendBoundedAiHistory,
  buildRoomInstantSnapshot,
  confirmedAiActionFromResponse,
  createLocalAiMemory,
  deleteLocalAiMemory,
  latestPendingAiClarification,
  loadAiRoutingPolicy,
  normalizeAiActions,
  normalizeAiClarification,
  normalizeAiSources,
  openAiActionContext,
  openAiSourceContext,
  prepareAiImageAttachment,
  relevantAiMemories,
  resolveAiHistoryClarification,
  saveAiRoutingPolicy,
  sourceOpenDetail,
} from '../src/features/ai/aiAgentUi.js';
import { parseAiClarificationResponse } from '../src/features/ai/localAiClient.js';

const aiSource = readFileSync(new URL('../src/features/ai/AI.jsx', import.meta.url), 'utf8');
const aiControlsSource = readFileSync(new URL('../src/features/ai/AiAgentControls.jsx', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../src/features/ai/localAiClient.js', import.meta.url), 'utf8');
const contactsSource = readFileSync(new URL('../src/features/contacts/contactsService.js', import.meta.url), 'utf8');
const privateMessagesSource = readFileSync(new URL('../src/features/private-messages/PrivateMessages.jsx', import.meta.url), 'utf8');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('routing policy is explicit, persistent, and defaults to balanced', () => {
  const storage = memoryStorage();
  assert.equal(loadAiRoutingPolicy(storage), 'balanced');
  assert.equal(saveAiRoutingPolicy('local-only', storage), 'local-only');
  assert.equal(loadAiRoutingPolicy(storage), 'local-only');
  assert.equal(saveAiRoutingPolicy('untrusted-provider', storage), 'balanced');
  assert.deepEqual(buildAiGatewayStatusPayload('fast', { wake: true, routingPolicy: 'local-only' }), {
    action: 'status',
    modelProfile: 'fast',
    routingPolicy: 'local-only',
    wake: true,
  });
});

test('AI surfaces keep balanced overflow routing without exposing a local-only switch', () => {
  assert.match(aiSource, /const BALANCED_AI_ROUTING_POLICY = 'balanced'/);
  assert.doesNotMatch(aiSource, /AiPrivacyControl|changeRoutingPolicy|Turn on Local only/);
  assert.doesNotMatch(aiControlsSource, /AiPrivacyControl|Keep AI requests on this PC only/);
});

test('AI history remains bounded during long sessions', () => {
  const history = Array.from({ length: 50 }, (_, index) => ({ id: String(index), role: 'user', content: String(index) }));
  const bounded = appendBoundedAiHistory(history, { id: 'last', role: 'assistant', content: 'done' });
  assert.equal(bounded.length, 36);
  assert.equal(bounded.at(-1).id, 'last');
  assert.equal(bounded[0].id, '15');
});

test('instant room snapshot keeps unpunctuated message history concise', () => {
  const longMessage = Array.from({ length: 80 }, (_, index) => `update${index}`).join(' ');
  const snapshot = buildRoomInstantSnapshot({
    messages: [
      { text: longMessage },
      { text: 'The team confirmed Friday as the launch date.' },
      { text: 'Hao will verify the production checklist before noon.' },
    ],
  }, 3);
  assert.ok(snapshot.length <= 3);
  assert.ok(snapshot.every((sentence) => sentence.length <= 220));
  assert.match(snapshot[0], /…$/);
});

test('instant room snapshot bounds oversized punctuated room content before scoring', () => {
  const hostileMessage = Array.from({ length: 5_000 }, (_, index) => `Sentence ${index} contains enough words to qualify for the room preview.`).join(' ');
  const snapshot = buildRoomInstantSnapshot({ messages: [{ text: hostileMessage }] }, 4);
  assert.ok(snapshot.length <= 4);
  assert.ok(snapshot.every((sentence) => sentence.length <= 220));
});

test('source normalization preserves only validated opaque navigation fields', () => {
  const [source] = normalizeAiSources([{
    id: '[S1]',
    type: 'message',
    roomId: 'room_1',
    channelId: 'general',
    itemId: 'message-4',
    label: 'Launch decision',
    excerpt: 'Ship Friday.',
    url: 'https://malicious.example',
    path: 'rooms_data/private',
  }]);
  assert.deepEqual(sourceOpenDetail(source), {
    id: 'S1',
    type: 'message',
    roomId: 'room_1',
    itemId: 'message-4',
    channelId: 'general',
    timestamp: 0,
  });
  assert.equal(Object.hasOwn(source, 'url'), false);
  assert.equal(Object.hasOwn(source, 'path'), false);
});

test('message evidence dispatches the safe event and uses exact jumpToMessage fields', () => {
  const events = [];
  const jumps = [];
  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const windowTarget = {
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) { events.push(event); return true; },
    jumpToMessage(value) { jumps.push(value); },
  };
  const result = openAiSourceContext({
    id: 'S2', type: 'message', roomId: 'room-2', channelId: 'announcements', itemId: 'msg-9', label: 'Update',
  }, windowTarget, {});
  assert.deepEqual(result, { opened: true, exact: true });
  assert.deepEqual(jumps, [{ roomId: 'room-2', channelId: 'announcements', messageId: 'msg-9' }]);
  assert.equal(events[0].type, AI_SOURCE_OPEN_EVENT);
  assert.deepEqual(events[0].detail, {
    id: 'S2', type: 'message', roomId: 'room-2', itemId: 'msg-9', channelId: 'announcements', timestamp: 0,
  });
});

test('non-message evidence opens only a known room tab target', () => {
  const selectors = [];
  let clicks = 0;
  class FakeCustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  const windowTarget = {
    activeRoomId: 'room-2',
    CustomEvent: FakeCustomEvent,
    dispatchEvent: () => true,
  };
  const documentTarget = {
    querySelector(selector) {
      selectors.push(selector);
      return { click: () => { clicks += 1; } };
    },
  };
  assert.deepEqual(openAiSourceContext({
    id: 'S3', type: 'task', roomId: 'room-2', itemId: 'task-4', label: 'Ship it',
  }, windowTarget, documentTarget), { opened: true, exact: false });
  assert.deepEqual(selectors, ['.room-tab[data-target="tasks"]']);
  assert.equal(clicks, 1);
});

test('event evidence opens the authorized room Events view', () => {
  const selectors = [];
  let clicks = 0;
  const result = openAiSourceContext({
    id: 'S4',
    type: 'event',
    roomId: 'room-2',
    itemId: 'event-7',
    label: 'Launch kickoff',
  }, {
    activeRoomId: 'room-2',
    CustomEvent: class FakeCustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail; }
    },
    dispatchEvent: () => true,
  }, {
    querySelector(selector) {
      selectors.push(selector);
      return { click: () => { clicks += 1; } };
    },
  });
  assert.deepEqual(result, { opened: true, exact: false });
  assert.deepEqual(selectors, ['.room-tab[data-target="events"]']);
  assert.equal(clicks, 1);
});

test('create-task actions preserve non-repeatable server states and reject other tool types', () => {
  const actions = normalizeAiActions([
    { id: 'a1', type: 'create_task', roomId: 'global', title: 'Ship it', requiresConfirmation: true, status: 'confirming' },
    { id: 'a2', type: 'create_task', roomId: 'global', title: 'Old task', requiresConfirmation: true, status: 'expired' },
    { id: 'a3', type: 'delete_room', roomId: 'global', title: 'Unsafe', requiresConfirmation: true },
  ]);
  assert.deepEqual(actions.map(({ id, status }) => ({ id, status })), [
    { id: 'a1', status: 'confirming' },
    { id: 'a2', status: 'expired' },
  ]);
});

test('Winston social actions accept only typed confirmed results and strip server-private fields', () => {
  const actions = normalizeAiActions([
    {
      id: 'create-room-action',
      type: 'create_room',
      title: 'Create Launch Room',
      description: 'Create a private room and invite accepted friends.',
      requiresConfirmation: true,
      status: 'confirmed',
      result: {
        roomId: 'room_launch',
        roomName: 'Launch Room',
        shortId: 'LAUNCH42',
        inviteCode: 'invite_42',
        invitedCount: 99,
        invitedNames: ['Ari', 'ari', 'Bo', ...Array.from({ length: 30 }, (_, index) => `Friend ${index}`)],
        inviteUrl: 'https://malicious.example/invite',
        friendUids: ['private-user-id'],
      },
    },
    {
      id: 'invite-action',
      type: 'invite_friends',
      roomId: 'room_launch',
      title: 'Invite Ari and Bo',
      requiresConfirmation: true,
      status: 'confirmed',
      result: {
        roomId: 'room_launch',
        roomName: 'Launch Room',
        inviteCode: 'invite_42',
        invitedCount: 2,
        invitedNames: ['Ari', 'Bo'],
      },
    },
    {
      id: 'call-action',
      type: 'start_friend_call',
      title: 'Call Ari',
      requiresConfirmation: true,
      status: 'confirmed',
      result: {
        threadId: 'ari-user_me-user',
        targetUid: 'ari-user',
        targetName: 'Ari',
        callIntentExpiresAt: 9_000,
        microphoneToken: 'must-not-cross-the-client-contract',
      },
    },
    {
      id: 'proposed-call',
      type: 'start_friend_call',
      title: 'Call Bo',
      requiresConfirmation: true,
      status: 'proposed',
      result: {
        threadId: 'bo-user_me-user',
        targetUid: 'bo-user',
        targetName: 'Bo',
        callIntentExpiresAt: 9_000,
      },
    },
  ]);

  assert.deepEqual(actions.map(({ type }) => type), [
    'create_room',
    'invite_friends',
    'start_friend_call',
    'start_friend_call',
  ]);
  assert.deepEqual(actions[0].result, {
    roomId: 'room_launch',
    roomName: 'Launch Room',
    shortId: 'LAUNCH42',
    inviteCode: 'invite_42',
    invitedCount: 20,
    invitedNames: ['Ari', 'Bo', ...Array.from({ length: 18 }, (_, index) => `Friend ${index}`)],
  });
  assert.deepEqual(actions[1].result.invitedNames, ['Ari', 'Bo']);
  assert.deepEqual(actions[2].result, {
    threadId: 'ari-user_me-user',
    targetUid: 'ari-user',
    targetName: 'Ari',
    callIntentExpiresAt: 9_000,
  });
  assert.equal(Object.hasOwn(actions[3], 'result'), false, 'a proposed action cannot smuggle a completed result');
});

test('Winston social action normalization rejects missing scope, confirmation, or complete result data', () => {
  const normalized = normalizeAiActions([
    { id: 'missing-room', type: 'invite_friends', title: 'Invite Ari', requiresConfirmation: true },
    { id: 'not-confirmable', type: 'create_room', title: 'Create room', requiresConfirmation: false },
    {
      id: 'bad-call-result',
      type: 'start_friend_call',
      title: 'Call Ari',
      requiresConfirmation: true,
      status: 'confirmed',
      result: { threadId: 'ari_me', targetUid: 'ari', targetName: 'Ari' },
    },
    { id: 'unsafe', type: 'add_room_member', title: 'Force add member', requiresConfirmation: true },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 'bad-call-result');
  assert.equal(Object.hasOwn(normalized[0], 'result'), false);
});

test('Winston social action copy states the accepted-friend boundary', () => {
  assert.match(aiActionPresentation('invite_friends').constraint, /accepted friends/i);
  assert.match(aiActionPresentation('start_friend_call').constraint, /accepted friends/i);
  assert.match(aiActionPresentation('start_friend_call').constraint, /after you confirm/i);
  assert.equal(aiActionPresentation('delete_room'), null);
  assert.equal(aiActionSuccessMessage({
    id: 'invite-action',
    type: 'invite_friends',
    roomId: 'room_launch',
    title: 'Invite friends',
    requiresConfirmation: true,
    status: 'confirmed',
    result: {
      roomId: 'room_launch', roomName: 'Launch Room', inviteCode: 'invite_42',
      invitedCount: 2, invitedNames: ['Ari', 'Bo'],
    },
  }), '2 friends invited. Ari, Bo.');
});

test('confirmed Winston actions are bound to the proposed id and type', () => {
  const expected = {
    id: 'call-action', type: 'start_friend_call', title: 'Call Ari',
    requiresConfirmation: true, status: 'proposed',
  };
  const confirmed = {
    ...expected,
    status: 'confirmed',
    result: {
      threadId: 'ari-user_me-user', targetUid: 'ari-user', targetName: 'Ari', callIntentExpiresAt: 9_000,
    },
  };
  assert.deepEqual(confirmedAiActionFromResponse({ action: confirmed }, expected), normalizeAiActions([confirmed])[0]);
  assert.equal(confirmedAiActionFromResponse({ action: { ...confirmed, id: 'other-action' } }, expected), null);
  assert.equal(confirmedAiActionFromResponse({ action: { ...confirmed, type: 'create_room' } }, expected), null);
  assert.equal(confirmedAiActionFromResponse({ action: { ...confirmed, status: 'confirming' } }, expected), null);
});

test('confirmed room and invite actions open only their scoped destination', async () => {
  const switched = [];
  const selectors = [];
  let chatClicks = 0;
  const windowTarget = {
    activeRoomId: 'global',
    switchRoom: async (...args) => switched.push(args),
  };
  const documentTarget = {
    querySelector(selector) {
      selectors.push(selector);
      return { click: () => { chatClicks += 1; } };
    },
  };
  const created = {
    id: 'create-room-action', type: 'create_room', title: 'Create Launch Room',
    requiresConfirmation: true, status: 'confirmed',
    result: { roomId: 'room_launch', roomName: 'Launch Room', shortId: 'LAUNCH42', inviteCode: 'invite_42' },
  };
  const invited = {
    id: 'invite-action', type: 'invite_friends', roomId: 'room_launch', title: 'Invite Ari',
    requiresConfirmation: true, status: 'confirmed',
    result: { roomId: 'room_launch', roomName: 'Launch Room', inviteCode: 'invite_42', invitedCount: 1, invitedNames: ['Ari'] },
  };

  assert.deepEqual(await openAiActionContext(created, null, { documentTarget, windowTarget }), {
    opened: true, roomId: 'room_launch', tabOpened: false,
  });
  assert.deepEqual(switched, [['room_launch', 'Launch Room', 'LAUNCH42']]);
  assert.equal(selectors.length, 0);

  windowTarget.activeRoomId = 'room_launch';
  assert.deepEqual(await openAiActionContext(invited, null, { documentTarget, windowTarget }), {
    opened: true, roomId: 'room_launch', tabOpened: true,
  });
  assert.deepEqual(selectors, ['.room-tab[data-target="chat"]']);
  assert.equal(chatClicks, 1);
});

test('friend call handoff runs once only for a confirmed, unexpired server result', async () => {
  const calls = [];
  const windowTarget = {
    startPrivateCallWithFriend: async (intent) => {
      calls.push(intent);
      return true;
    },
  };
  const proposed = {
    id: 'call-action', type: 'start_friend_call', title: 'Call Ari',
    requiresConfirmation: true, status: 'proposed',
  };
  const confirmed = {
    ...proposed,
    status: 'confirmed',
    result: {
      threadId: 'ari-user_me-user', targetUid: 'ari-user', targetName: 'Ari', callIntentExpiresAt: 9_000,
    },
  };

  assert.deepEqual(await openAiActionContext(proposed, { action: confirmed }, { now: 8_000, windowTarget }), {
    opened: true, targetUid: 'ari-user',
  });
  assert.deepEqual(calls, [{
    threadId: 'ari-user_me-user', targetUid: 'ari-user', targetName: 'Ari', callIntentExpiresAt: 9_000,
  }]);

  assert.deepEqual(await openAiActionContext(proposed, { action: confirmed }, { now: 9_000, windowTarget }), {
    opened: false, reason: 'expired-call-intent',
  });
  assert.deepEqual(await openAiActionContext(proposed, null, { now: 8_000, windowTarget }), {
    opened: false, reason: 'unconfirmed',
  });
  assert.equal(calls.length, 1, 'expired and unconfirmed actions must not reach browser call startup');
});

test('action cards lock confirm, dismiss, and open submissions per proposal', () => {
  assert.match(aiControlsSource, /const submitLocksRef = useRef\(new Set\(\)\)/);
  assert.ok(
    aiControlsSource.indexOf('submitLocksRef.current.has(action.id)')
      < aiControlsSource.indexOf('const result = await onConfirm(action)'),
    'the per-action lock must be checked before confirmation',
  );
  assert.ok(
    aiControlsSource.indexOf('submitLocksRef.current.add(action.id)')
      < aiControlsSource.indexOf('const result = await onConfirm(action)'),
    'the per-action lock must be acquired before confirmation',
  );
  assert.match(aiControlsSource, /if \(action\.type === 'start_friend_call'\) \{[\s\S]*?await onOpen\?\.\(action, result\)/);
  assert.equal((aiControlsSource.match(/const submitLocksRef = useRef\(new Set\(\)\)/g) || []).length, 1);
});

test('contacts mutations use the authenticated friendship endpoint and never raw friend writes', () => {
  assert.match(contactsSource, /cloudfunctions\.net\/manageFriendship/);
  assert.match(contactsSource, /headers: await getAuthedJsonHeaders\('Please sign in before managing contacts\.'\)/);
  assert.match(contactsSource, /body: JSON\.stringify\(\{ action, targetUid: normalizedTargetUid \}\)/);
  assert.match(contactsSource, /manageFriendship\('send', targetUid\)/);
  assert.match(contactsSource, /manageFriendship\('accept', targetUid\)/);
  assert.match(contactsSource, /manageFriendship\('remove', targetUid\)/);
  assert.doesNotMatch(
    contactsSource,
    /\b(?:set|update|remove|runTransaction)\s*\(\s*ref\(\s*db\s*,\s*[`'"]friends\//,
    'contact UI must not write a friends projection directly',
  );
});

test('clarification interactions are strictly bounded and become one answered choice', () => {
  const clarification = normalizeAiClarification({
    id: 'clarify-1',
    type: 'clarification',
    question: 'Which calendar should I use?',
    options: [
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'Work' },
      { id: 'room', label: 'This room' },
      { id: 'extra-1', label: 'Shared' },
      { id: 'extra-2', label: 'Archive' },
    ],
    allowFreeText: true,
    unsafeAction: { type: 'create_task' },
  });
  assert.deepEqual(clarification, {
    id: 'clarify-1',
    type: 'clarification',
    question: 'Which calendar should I use?',
    options: [
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'Work' },
      { id: 'room', label: 'This room' },
      { id: 'extra-1', label: 'Shared' },
      { id: 'extra-2', label: 'Archive' },
    ],
    allowFreeText: true,
    status: 'pending',
    selectedOptionId: '',
    selectedLabel: '',
  });
  assert.equal(Object.hasOwn(clarification, 'unsafeAction'), false);
  assert.equal(normalizeAiClarification({
    type: 'clarification', question: 'Still editable?', options: ['Yes', 'No'], allowFreeText: false,
  }).allowFreeText, true);
  assert.equal(normalizeAiClarification({
    type: 'clarification', question: 'Duplicate?', options: ['Work', 'work'],
  }), null);
  assert.equal(normalizeAiClarification({
    type: 'clarification', question: 'Too many?', options: ['1', '2', '3', '4', '5', '6'],
  }), null);
  assert.equal(normalizeAiClarification({
    type: 'clarification', question: 'x'.repeat(241), options: ['Yes', 'No'],
  }), null);
  const citationFree = normalizeAiClarification({
    type: 'clarification', question: 'Which room [S1](https://example.test/fake)?', options: ['Current [S2](https://example.test/fake)', 'Another'],
  });
  assert.equal(citationFree.question, 'Which room?');
  assert.deepEqual(citationFree.options.map((option) => option.label), ['Current', 'Another']);
  assert.equal(normalizeAiClarification({ type: 'clarification', question: 'Only one?', options: ['One'] }), null);
  assert.equal(normalizeAiClarification({ type: 'write', question: 'Unsafe?', options: ['Yes', 'No'] }), null);

  const answered = answerAiClarification(clarification, { id: 'work', label: 'Work' });
  assert.equal(answered.status, 'answered');
  assert.equal(answered.selectedLabel, 'Work');
  assert.deepEqual(answerAiClarification(answered, { id: 'personal', label: 'Personal' }), answered);
});

test('direct local clarification markers are hidden from partials and normalized at completion', () => {
  const start = '[[MINIMALIST_CLARIFICATION]]';
  const end = '[[/MINIMALIST_CLARIFICATION]]';
  assert.deepEqual(parseAiClarificationResponse(`Which room?\n${start.slice(0, 12)}`, { partial: true }), {
    reply: 'Which room?',
    interaction: null,
  });
  const parsed = parseAiClarificationResponse(`Which room?\n${start}\n{"question":"Which room?","options":["Current room",{"label":"Another room"}],"allowFreeText":true}\n${end}`);
  assert.equal(parsed.reply, 'Which room?');
  assert.equal(parsed.interaction.type, 'clarification');
  assert.match(parsed.interaction.id, /^clarification-/);
  assert.deepEqual(parsed.interaction.options.map((option) => option.label), ['Current room', 'Another room']);
  assert.equal(parsed.interaction.allowFreeText, true);

  const malformed = parseAiClarificationResponse(`Safe text\n${start}\n{bad json}\n${end}`);
  assert.deepEqual(malformed, { reply: 'Safe text', interaction: null });

  const questionFallback = parseAiClarificationResponse(`${start}\n{"question":"Which calendar?","options":["Work","Personal"],"allowFreeText":false}\n${end}`);
  assert.equal(questionFallback.reply, 'Which calendar?');
  assert.equal(questionFallback.interaction.allowFreeText, true);

  const trailingText = parseAiClarificationResponse(`Choose now.\n${start}\n{"question":"Which one?","options":["A","B"]}\n${end}\nUnexpected tail`);
  assert.equal(trailingText.interaction, null);
  assert.equal(trailingText.reply, 'Choose now.');

  const multiple = parseAiClarificationResponse(`Choose.\n${start}\n{"question":"First?","options":["A","B"]}\n${end}\n${start}\n{"question":"Second?","options":["C","D"]}\n${end}`);
  assert.equal(multiple.interaction, null);
  assert.equal(multiple.reply, 'Choose.');
});

test('only the latest unanswered clarification can resolve, including typed free text', () => {
  const interaction = (id, question) => normalizeAiClarification({
    id, type: 'clarification', question, options: ['First', 'Second'], allowFreeText: false,
  });
  const history = [
    { id: 'older', role: 'assistant', content: 'Older?', interaction: interaction('old-i', 'Older?') },
    { id: 'latest', role: 'assistant', content: 'Latest?', interaction: interaction('new-i', 'Latest?'), originPromptId: 'prompt-image' },
  ];
  assert.equal(latestPendingAiClarification(history).messageId, 'latest');
  assert.equal(resolveAiHistoryClarification(history, 'No', { messageId: 'older', freeText: true }), history);
  const resolved = resolveAiHistoryClarification(history, 'A custom answer', { messageId: 'latest', freeText: true });
  assert.equal(resolved[1].interaction.status, 'answered');
  assert.equal(resolved[1].interaction.selectedOptionId, '');
  assert.equal(resolved[1].interaction.selectedLabel, 'A custom answer');
  assert.equal(latestPendingAiClarification([...history, { id: 'followup', role: 'user', content: 'Something else' }]), null);
});

test('both AI surfaces retain and render one-shot clarification follow-ups', () => {
  assert.equal((aiSource.match(/interaction: result\.interaction \|\| null/g) || []).length, 2);
  assert.equal((aiSource.match(/<AiClarificationCard/g) || []).length, 2);
  assert.equal((aiSource.match(/resolveAiHistoryClarification\(/g) || []).length, 2);
  assert.equal((aiSource.match(/originPromptId: promptId/g) || []).length, 2);
  assert.match(aiSource, /requestAttachmentsRef\.current\.get\(message\.originPromptId\)/);
  assert.match(aiSource, /requestMode: message\.requestMode/);
  assert.match(aiSource, /selectedRoomIds: message\.selectedRoomIds/);
  assert.match(aiSource, /resolveClarification: false/);
  assert.match(aiSource, /activeClarification\?\.messageId !== message\.id/);
  assert.match(aiSource, /editPromptRef\.current/);
  assert.match(aiControlsSource, /submitLockRef\.current/);
  assert.match(aiControlsSource, /Type another answer/);
  assert.match(aiControlsSource, /role="group"/);
});

test('gateway chat payload carries local-only, selected rooms, and one raw-base64 image', () => {
  const payload = buildAiGatewayChatPayload({
    mode: 'personal',
    requestMode: 'briefing',
    roomId: 'room-1',
    selectedRoomIds: ['room-1', 'global', 'room-1', 'room-2'],
    routingPolicy: 'local-only',
    attachment: { name: 'board.png', mimeType: 'image/png', image: 'aGVsbG8=' },
    messages: [{ role: 'user', content: 'Brief me' }],
    modelProfile: 'fast',
  });
  assert.equal(payload.mode, 'briefing');
  assert.equal(payload.requestMode, 'briefing');
  assert.equal(payload.routingPolicy, 'local-only');
  assert.deepEqual(payload.selectedRoomIds, ['room-1', 'global', 'room-2']);
  assert.deepEqual(payload.attachment, { name: 'board.png', mimeType: 'image/png', image: 'aGVsbG8=' });
  assert.equal(buildAiGatewayChatPayload({ attachment: { mimeType: 'image/png', image: 'data:image/png;base64,abc' } }).attachment, undefined);
});

test('action and memory payloads expose only typed confirmation CRUD contracts', () => {
  assert.deepEqual(buildAiGatewayActionPayload('confirm-action', 'action-1'), { action: 'confirm-action', actionId: 'action-1' });
  assert.deepEqual(buildAiGatewayActionPayload('dismiss-action', 'action-2'), { action: 'dismiss-action', actionId: 'action-2' });
  assert.deepEqual(buildPersonalAiMemoryPayload('memory-delete', { memoryId: 'memory-1' }), { action: 'memory-delete', memoryId: 'memory-1' });
  assert.deepEqual(buildPersonalAiMemoryPayload('memory-create', { memory: { text: 'Use checklists', scope: 'room', roomId: 'room-1' } }), {
    action: 'memory-create',
    memory: { text: 'Use checklists', scope: 'room', roomId: 'room-1', provenance: 'Saved explicitly by you' },
  });
});

test('local structured memory requires explicit create calls and respects scope and expiry', () => {
  const storage = memoryStorage();
  const personal = createLocalAiMemory({ text: 'Keep replies short', scope: 'personal' }, storage);
  const room = createLocalAiMemory({ text: 'Friday is launch day', scope: 'room', roomId: 'room-1' }, storage);
  const expired = createLocalAiMemory({ text: 'Old preference', scope: 'personal', expiresAt: Date.now() - 1 }, storage);
  assert.deepEqual(relevantAiMemories(expired.memories, 'room-1').map((memory) => memory.text), ['Friday is launch day', 'Keep replies short']);
  assert.equal(deleteLocalAiMemory(room.memory.id, storage).some((memory) => memory.id === room.memory.id), false);
  assert.ok(personal.memory.id);
});

test('image preparation sends supported optimized data as raw base64', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const attachment = await prepareAiImageAttachment({
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  });
  assert.equal(attachment.mimeType, 'image/jpeg');
  assert.equal(attachment.image, 'AQIDBA==');
  assert.equal(attachment.image.startsWith('data:'), false);
});

test('UI wiring consumes genuine partials and authoritatively cancels accepted jobs', () => {
  assert.match(clientSource, /status\?\.partialReply \|\| status\?\.partial/);
  assert.match(clientSource, /buildAiGatewayCancelPayload\(id\)/);
  assert.match(aiSource, /cancelQueuedAiRequest\(\{ config, jobId: request\.jobId \}\)/);
  assert.match(aiSource, /if \(result\.cancelled\)/);
  assert.match(aiSource, /This request is already running, so it will finish safely\./);
  assert.match(aiSource, /onProgress: \(progress\) =>/);
  assert.doesNotMatch(aiSource, /split\(['"] ['"]\).*setTimeout|fake.*stream/i);
});
