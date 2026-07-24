import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  WINSTON_MODEL_MODES,
  createWinstonConversation,
  createWinstonFeedback,
  deleteLocalWinstonSchedule,
  detectWinstonLiveTool,
  loadLocalWinstonConversations,
  loadLocalWinstonSchedule,
  loadWinstonConversationDeleteTombstones,
  loadWinstonMemorySuggestions,
  loadWinstonModelMode,
  loadWinstonSavedResponses,
  mergeSavedWinstonConversation,
  mergeWinstonConversations,
  normalizeWinstonConversation,
  normalizeWinstonSchedule,
  normalizeWorkspaceSearchResults,
  reconcileConflictedWinstonConversation,
  reconcileHydratedWinstonConversation,
  removeWinstonConversationDeleteTombstone,
  resolveWinstonModelProfile as resolveClientModelProfile,
  runWinstonLiveTool,
  saveLocalWinstonConversations,
  saveLocalWinstonSchedule,
  saveWinstonConversationDeleteTombstone,
  saveWinstonConversationToServer,
  saveWinstonModelMode,
  saveWinstonScheduleToServer,
  searchLocalWinstonContext,
  suggestWinstonMemory,
  toggleWinstonSavedResponse,
  winstonConversationSyncFingerprint,
  winstonLiveToolFailureMessage,
} from '../src/features/ai/winstonServices.js';
import {
  aiActionPresentation,
  normalizeAiActions,
  openAiActionContext,
} from '../src/features/ai/aiAgentUi.js';
import { buildAiGatewayChatPayload } from '../src/features/ai/gatewayPayload.js';
import { getLocalAiConfig } from '../src/features/ai/localAiClient.js';

const require = createRequire(import.meta.url);
const winstonContracts = require('../functions/ai-winston-contracts.js');
const aiActionContracts = require('../functions/ai-agent-contracts.js');

const enhancementSource = fs.readFileSync(
  new URL('../src/features/ai/WinstonEnhancements.jsx', import.meta.url),
  'utf8',
);
const aiSource = fs.readFileSync(
  new URL('../src/features/ai/AI.jsx', import.meta.url),
  'utf8',
);
const gatewaySource = fs.readFileSync(
  new URL('../functions/index.js', import.meta.url),
  'utf8',
);

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }

  clear() {
    this.#values.clear();
  }
}

function installBrowserStubs({ uid = 'user_contract_123' } = {}) {
  const previous = {
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
  };
  const localStorage = new MemoryStorage();
  globalThis.localStorage = localStorage;
  globalThis.window = {
    activeRoomId: 'global',
    currentUser: {
      uid,
      getIdToken: async () => 'test-id-token',
    },
    location: { hostname: 'localhost' },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  return {
    localStorage,
    restore() {
      if (previous.fetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previous.fetch;
      if (previous.localStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous.localStorage;
      if (previous.window === undefined) delete globalThis.window;
      else globalThis.window = previous.window;
    },
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('Auto model selection is available and agrees on everyday versus complex requests', () => {
  assert.deepEqual(WINSTON_MODEL_MODES.map(({ id }) => id), ['auto', 'fast', 'smart']);

  assert.equal(resolveClientModelProfile('What time is the meeting?', { mode: 'auto' }), 'fast');
  assert.equal(
    resolveClientModelProfile('Analyze the trade-offs and write a detailed proposal with sources.', { mode: 'auto' }),
    'smart',
  );
  assert.equal(resolveClientModelProfile('Anything', { mode: 'fast' }), 'fast');
  assert.equal(resolveClientModelProfile('Anything', { mode: 'smart' }), 'smart');

  assert.deepEqual(
    winstonContracts.resolveWinstonModelProfile('auto', [{ role: 'user', content: 'What time is the meeting?' }]),
    {
      requestedProfile: 'auto',
      modelProfile: 'fast',
      automatic: true,
      reason: 'short_request',
    },
  );
  assert.equal(
    winstonContracts.resolveWinstonModelProfile('auto', [{
      role: 'user',
      content: 'Analyze the trade-offs and prepare a comprehensive strategy.',
    }]).modelProfile,
    'smart',
  );
  assert.equal(winstonContracts.resolveWinstonModelProfile('fast', []).automatic, false);
  assert.throws(
    () => winstonContracts.resolveWinstonModelProfile('unbounded', []),
    /auto.*fast.*smart/i,
  );

  const storage = new MemoryStorage();
  assert.equal(loadWinstonModelMode(storage), 'auto');
  assert.equal(saveWinstonModelMode('smart', storage), 'smart');
  assert.equal(loadWinstonModelMode(storage), 'smart');
  assert.equal(saveWinstonModelMode('unsupported', storage), 'auto');
});

test('personal Winston preserves Auto through local config and the authenticated gateway payload', () => {
  const browser = installBrowserStubs();
  try {
    const config = getLocalAiConfig({
      gatewayEndpoint: 'https://gateway.example.test',
      modelProfile: 'fast',
      requestedModelProfile: 'auto',
    });
    assert.equal(config.modelProfile, 'fast', 'local readiness still uses a concrete installed profile');
    assert.equal(config.requestedModelProfile, 'auto', 'the user selection remains distinct for server routing');

    const payload = buildAiGatewayChatPayload({
      mode: 'personal',
      roomId: 'global',
      channelId: 'general',
      messages: [{ role: 'user', content: 'Analyze the options.' }],
      modelProfile: config.requestedModelProfile,
      requestId: 'request_123456',
    });
    assert.equal(payload.mode, 'personal');
    assert.equal(payload.modelProfile, 'auto');
  } finally {
    browser.restore();
  }
});

test('local Winston conversations persist per account, merge by server identity, and retain response metadata', () => {
  const browser = installBrowserStubs();
  try {
    const conversation = {
      ...createWinstonConversation('Launch follow-up'),
      id: 'conversation_local_123',
      updatedAt: 20,
      messages: [
        {
          id: 'prompt_12345678',
          role: 'user',
          content: 'Please remember that launch reviews happen on Friday.',
          createdAt: 10,
        },
        {
          id: 'reply_12345678',
          role: 'assistant',
          content: 'I can suggest that as a memory.',
          createdAt: 20,
          provider: 'ollama-bridge',
          modelProfile: 'fast',
          sources: [{ id: 'S1', type: 'event', roomId: 'global', itemId: 'event_123456' }],
          memorySuggestions: [{
            id: 'memory_suggestion_123',
            text: 'Launch reviews happen on Friday',
            scope: 'personal',
            expiresAt: 999,
          }],
        },
      ],
    };

    const saved = saveLocalWinstonConversations([conversation]);
    const loaded = loadLocalWinstonConversations();
    assert.equal(saved.length, 1);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, conversation.id);
    assert.equal(loaded[0].messages[1].provider, 'ollama-bridge');
    assert.deepEqual(loaded[0].messages[1].memorySuggestions, [{
      id: 'memory_suggestion_123',
      text: 'Launch reviews happen on Friday',
      scope: 'personal',
      expiresAt: 999,
    }]);

    globalThis.window.currentUser.uid = 'other_user_123';
    assert.equal(loadLocalWinstonConversations().length, 1);
    assert.notEqual(loadLocalWinstonConversations()[0].id, conversation.id);

    const local = normalizeWinstonConversation({
      ...conversation,
      serverId: 'server_conversation_123',
      updatedAt: 20,
    });
    const remote = normalizeWinstonConversation({
      ...conversation,
      id: 'server_conversation_123',
      serverId: 'server_conversation_123',
      title: 'Remote title wins',
      updatedAt: 30,
    });
    const merged = mergeWinstonConversations([local], [remote]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, 'Remote title wins');
  } finally {
    browser.restore();
  }
});

test('local conversation storage is globally bounded and UI persistence is debounced', () => {
  const browser = installBrowserStubs();
  try {
    const oversized = Array.from({ length: 10 }, (_, conversationIndex) => normalizeWinstonConversation({
      id: `conversation_bound_${conversationIndex}`,
      title: `Bounded ${conversationIndex}`,
      updatedAt: 1_000 - conversationIndex,
      messages: Array.from({ length: 36 }, (_, messageIndex) => ({
        id: `message_${conversationIndex}_${messageIndex}_bounded`,
        role: messageIndex % 2 ? 'assistant' : 'user',
        content: `${conversationIndex}:${messageIndex} ${'x'.repeat(5_950)}`,
        createdAt: messageIndex + 1,
      })),
    }));
    saveLocalWinstonConversations(oversized);
    const raw = browser.localStorage.getItem(
      'minimalist.winston.conversations.v2:user_contract_123',
    );
    assert.ok(raw.length < 800_000, `expected bounded local payload, received ${raw.length} chars`);
    assert.match(enhancementSource, /localSaveTimerRef/);
    assert.match(enhancementSource, /setTimeout\(\(\) => \{\s*saveLocalWinstonConversations/);
  } finally {
    browser.restore();
  }
});

test('conversation save serializes server turns and maps the server record back to the local thread', async () => {
  const browser = installBrowserStubs();
  const requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      const stored = winstonContracts.sanitizeWinstonConversation(body.conversation, { now: 500 });
      return jsonResponse({
        conversation: {
          ...winstonContracts.publicWinstonConversation({
            ...stored,
            createdAt: 400,
            turnCount: stored.turns.length,
          }, 'server_conversation_123', { includeTurns: true }),
          revision: 4,
        },
      });
    };

    const local = normalizeWinstonConversation({
      id: 'local_conversation_123',
      title: 'Room plan',
      roomId: 'global',
      createdAt: 100,
      updatedAt: 200,
      revision: 3,
      messages: [
        { id: 'prompt_12345678', role: 'user', content: 'Plan the room.', createdAt: 100 },
        { id: 'reply_12345678', role: 'assistant', content: 'Here is the plan.', createdAt: 200 },
      ],
    });
    const saved = await saveWinstonConversationToServer({
      config: { profileEndpoint: 'https://profile.example.test' },
      conversation: local,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.action, 'conversation-save');
    assert.equal('messages' in requests[0].body.conversation, false);
    assert.equal(requests[0].body.conversation.baseRevision, 3);
    assert.deepEqual(
      requests[0].body.conversation.turns.map(({ id, role, content }) => ({ id, role, content })),
      [
        { id: 'prompt_12345678', role: 'user', content: 'Plan the room.' },
        { id: 'reply_12345678', role: 'assistant', content: 'Here is the plan.' },
      ],
    );
    assert.equal(saved.id, local.id);
    assert.equal(saved.serverId, 'server_conversation_123');
    assert.equal(saved.revision, 4);
    assert.deepEqual(saved.messages.map(({ content }) => content), ['Plan the room.', 'Here is the plan.']);
  } finally {
    browser.restore();
  }
});

test('conversation metadata refresh retains the bounded local transcript', () => {
  const local = normalizeWinstonConversation({
    id: 'local_conversation_456',
    serverId: 'server_conversation_456',
    title: 'Local title',
    roomId: 'global',
    createdAt: 10,
    updatedAt: 20,
    messages: [
      { id: 'prompt_45678901', role: 'user', content: 'Keep this local turn.', createdAt: 11 },
      { id: 'reply_45678901', role: 'assistant', content: 'It is retained.', createdAt: 12 },
    ],
  });
  const remoteMetadata = normalizeWinstonConversation({
    id: 'server_conversation_456',
    serverId: 'server_conversation_456',
    title: 'Server title',
    roomId: 'global',
    createdAt: 10,
    updatedAt: 30,
    turnCount: 2,
  });

  const [merged] = mergeWinstonConversations([local], [remoteMetadata]);
  assert.equal(merged.id, local.id);
  assert.equal(merged.serverId, remoteMetadata.serverId);
  assert.equal(merged.title, 'Server title');
  assert.deepEqual(
    merged.messages.map(({ content }) => content),
    ['Keep this local turn.', 'It is retained.'],
  );
});

test('startup and selected-conversation hydration preserve in-flight prompts and renames', () => {
  const baselineMetadata = normalizeWinstonConversation({
    id: 'local_conversation_789',
    serverId: 'server_conversation_789',
    title: 'Existing conversation',
    roomId: 'global',
    createdAt: 10,
    updatedAt: 20,
    turnCount: 1,
  });
  const remoteFull = normalizeWinstonConversation({
    id: 'server_conversation_789',
    serverId: 'server_conversation_789',
    title: 'Existing conversation',
    roomId: 'global',
    createdAt: 10,
    updatedAt: 30,
    turns: [
      { id: 'prompt_remote_789', role: 'user', content: 'Earlier server turn.', createdAt: 15 },
    ],
  });
  const promptedDuringStartup = normalizeWinstonConversation({
    ...baselineMetadata,
    title: 'Prompted while loading',
    updatedAt: 40,
    messages: [
      { id: 'prompt_local_789', role: 'user', content: 'New prompt during startup.', createdAt: 40 },
    ],
  });

  const startupResult = reconcileHydratedWinstonConversation(
    promptedDuringStartup,
    remoteFull,
    baselineMetadata,
  );
  assert.equal(startupResult.clean, false);
  assert.equal(startupResult.conversation.title, 'Prompted while loading');
  assert.deepEqual(
    startupResult.conversation.messages.map(({ content }) => content),
    ['Earlier server turn.', 'New prompt during startup.'],
  );

  const selectedBaseline = normalizeWinstonConversation({
    ...remoteFull,
    id: 'local_conversation_789',
  });
  const renamedDuringSelection = normalizeWinstonConversation({
    ...selectedBaseline,
    title: 'Renamed while loading',
    updatedAt: 50,
  });
  const refreshedRemote = normalizeWinstonConversation({
    ...remoteFull,
    title: 'Remote refresh title',
    updatedAt: 45,
    messages: [
      ...remoteFull.messages,
      { id: 'reply_remote_789', role: 'assistant', content: 'New server response.', createdAt: 35 },
    ],
  });
  const selectionResult = reconcileHydratedWinstonConversation(
    renamedDuringSelection,
    refreshedRemote,
    selectedBaseline,
  );
  assert.equal(selectionResult.clean, false);
  assert.equal(selectionResult.conversation.title, 'Renamed while loading');
  assert.deepEqual(
    selectionResult.conversation.messages.map(({ content }) => content),
    ['Earlier server turn.', 'New server response.'],
  );
});

test('a stale conversation save acknowledgement merges identity without replacing newer turns', () => {
  const sent = normalizeWinstonConversation({
    id: 'local_conversation_save_race',
    title: 'Initial title',
    roomId: 'global',
    createdAt: 100,
    updatedAt: 200,
    messages: [
      { id: 'prompt_save_race', role: 'user', content: 'First prompt.', createdAt: 200 },
    ],
  });
  const current = normalizeWinstonConversation({
    ...sent,
    title: 'Renamed after send',
    updatedAt: 300,
    messages: [
      ...sent.messages,
      { id: 'reply_save_race', role: 'assistant', content: 'New reply.', createdAt: 300 },
    ],
  });
  const saved = normalizeWinstonConversation({
    ...sent,
    id: 'server_conversation_save_race',
    serverId: 'server_conversation_save_race',
    title: 'Initial title',
    updatedAt: 250,
  });

  const acknowledged = mergeSavedWinstonConversation(sent, sent, saved);
  const merged = mergeSavedWinstonConversation(current, sent, saved);
  assert.equal(merged.serverId, 'server_conversation_save_race');
  assert.equal(merged.title, 'Renamed after send');
  assert.deepEqual(
    merged.messages.map(({ content }) => content),
    ['First prompt.', 'New reply.'],
  );
  assert.notEqual(
    winstonConversationSyncFingerprint(merged),
    winstonConversationSyncFingerprint(acknowledged),
    'the newer local snapshot remains dirty for a follow-up save',
  );
});

test('conversation conflicts keep both branches and advance to the loaded server revision', () => {
  const local = normalizeWinstonConversation({
    id: 'local_conflict_123',
    serverId: 'server_conflict_123',
    revision: 2,
    title: 'My local title',
    updatedAt: 30,
    messages: [
      { id: 'prompt_local_conflict', role: 'user', content: 'Local branch.', createdAt: 30 },
    ],
  });
  const remote = normalizeWinstonConversation({
    id: 'server_conflict_123',
    serverId: 'server_conflict_123',
    revision: 3,
    title: 'Remote title',
    updatedAt: 40,
    turns: [
      { id: 'prompt_remote_conflict', role: 'user', content: 'Remote branch.', createdAt: 35 },
    ],
  });
  const reconciled = reconcileConflictedWinstonConversation(local, remote);
  assert.equal(reconciled.id, local.id);
  assert.equal(reconciled.serverId, remote.serverId);
  assert.equal(reconciled.revision, 3);
  assert.equal(reconciled.title, 'My local title');
  assert.deepEqual(
    reconciled.messages.map(({ content }) => content),
    ['Remote branch.', 'Local branch.'],
  );
  assert.match(enhancementSource, /WINSTON_CONVERSATION_CONFLICT/);
  assert.match(enhancementSource, /reconcileConflictedWinstonConversation/);
});

test('conversation delete tombstones persist until the server deletion is confirmed', () => {
  const browser = installBrowserStubs();
  try {
    saveWinstonConversationDeleteTombstone({
      localId: 'local_conversation_delete',
      serverId: 'server_conversation_delete',
    });
    assert.deepEqual(
      loadWinstonConversationDeleteTombstones().map(({ localId, serverId }) => ({ localId, serverId })),
      [{
        localId: 'local_conversation_delete',
        serverId: 'server_conversation_delete',
      }],
    );
    removeWinstonConversationDeleteTombstone({
      localId: 'local_conversation_delete',
      serverId: 'server_conversation_delete',
    });
    assert.deepEqual(loadWinstonConversationDeleteTombstones(), []);
  } finally {
    browser.restore();
  }
});

test('conversation persistence scans every dirty thread and flushes pending work on lifecycle exit', () => {
  assert.match(enhancementSource, /conversations\.forEach\(\(conversation\) =>/);
  assert.match(enhancementSource, /saveTimersRef\.current\.set\(conversation\.id/);
  assert.match(enhancementSource, /flushDirtyConversations/);
  assert.match(enhancementSource, /addEventListener\?\.\('pagehide'/);
  assert.match(enhancementSource, /persistConversation\(conversation,\s*\{\s*updateUi:\s*false\s*\}\)/);
  assert.match(enhancementSource, /deletedConversationIdsRef\.current\.add\(conversationId\)/);
  assert.match(
    enhancementSource,
    /deletedConversationIdsRef\.current\.has\(sentConversation\.id\)[\s\S]*deleteServerConversation/,
  );
  assert.match(enhancementSource, /const visibleRemote = remote\.filter/);
  assert.match(enhancementSource, /saveWinstonConversationDeleteTombstone/);
  assert.match(enhancementSource, /removeWinstonConversationDeleteTombstone/);
});

test('proactive schedule aliases migrate locally and the server round-trip keeps time, zone, days, and rooms', async () => {
  const browser = installBrowserStubs();
  const requests = [];
  try {
    const migrated = normalizeWinstonSchedule({
      id: 'schedule_123456',
      enabled: true,
      time: '07:45',
      timezone: 'America/Los_Angeles',
      roomIds: ['global', 'room_123456', 'global'],
      kind: 'daily-briefing',
    });
    assert.equal(migrated.localTime, '07:45');
    assert.equal(migrated.timeZone, 'America/Los_Angeles');
    assert.deepEqual(migrated.selectedRoomIds, ['global', 'room_123456']);
    assert.equal(migrated.kind, 'daily_digest');

    saveLocalWinstonSchedule(migrated);
    assert.deepEqual(loadLocalWinstonSchedule(), migrated);
    assert.equal(deleteLocalWinstonSchedule().enabled, false);

    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      const stored = winstonContracts.sanitizeWinstonSchedule(body.schedule, {
        now: Date.parse('2026-07-22T12:00:00Z'),
      });
      return jsonResponse({
        schedule: winstonContracts.publicWinstonSchedule({
          ...stored,
          createdAt: 100,
        }, 'schedule_123456'),
      });
    };

    const saved = await saveWinstonScheduleToServer({
      config: { profileEndpoint: 'https://profile.example.test' },
      schedule: {
        enabled: true,
        localTime: '07:45',
        timeZone: 'America/Los_Angeles',
        days: [1, 3, 5],
        selectedRoomIds: ['global', 'room_123456'],
        kind: 'daily_digest',
        lookAheadHours: 48,
      },
    });
    assert.equal(requests[0].body.action, 'schedule-save');
    assert.deepEqual(requests[0].body.schedule, {
      id: '',
      enabled: true,
      localTime: '07:45',
      timeZone: 'America/Los_Angeles',
      days: [1, 3, 5],
      selectedRoomIds: ['global', 'room_123456'],
      kind: 'daily_digest',
      lookAheadHours: 48,
      nextRunAt: 0,
    });
    assert.equal(saved.id, 'schedule_123456');
    assert.equal(saved.localTime, '07:45');
    assert.equal(saved.timeZone, 'America/Los_Angeles');
    assert.deepEqual(saved.days, [1, 3, 5]);
    assert.deepEqual(saved.selectedRoomIds, ['global', 'room_123456']);
  } finally {
    browser.restore();
  }
});

test('memory suggestions require explicit durable language, reject secrets, and stay pending until approval', () => {
  const now = 1_000;
  const suggestion = winstonContracts.buildWinstonMemorySuggestion({
    uid: 'user_123456',
    requestId: 'request_123456',
    roomId: 'room_123456',
    now,
    messages: [{ role: 'user', content: 'Please remember that I prefer bullet lists for this room.' }],
  });
  assert.ok(suggestion);
  assert.equal(suggestion.text, 'I prefer bullet lists');
  assert.equal(suggestion.scope, 'room');
  assert.equal(suggestion.roomId, 'room_123456');
  assert.equal(suggestion.status, 'pending');
  assert.equal(suggestion.expiresAt, now + winstonContracts.WINSTON_MEMORY_SUGGESTION_TTL_MS);
  assert.match(suggestion.id, /^[a-f0-9]{64}$/);

  const publicSuggestion = winstonContracts.publicWinstonMemorySuggestion(suggestion);
  assert.equal('dedupeKey' in publicSuggestion, false);
  assert.equal(publicSuggestion.status, 'pending');
  assert.equal(
    winstonContracts.winstonMemoryDedupeKey('  I prefer BULLET lists!  '),
    winstonContracts.winstonMemoryDedupeKey('i prefer bullet lists'),
  );
  assert.equal(winstonContracts.buildWinstonMemorySuggestion({
    uid: 'user_123456',
    requestId: 'request_123456',
    messages: [{ role: 'user', content: 'My temporary thought is that Friday looks busy.' }],
  }), null);
  assert.equal(winstonContracts.buildWinstonMemorySuggestion({
    uid: 'user_123456',
    requestId: 'request_123456',
    messages: [{ role: 'user', content: 'Remember that my API key is abc-123.' }],
  }), null);

  const clientSuggestion = suggestWinstonMemory('Please remember that I prefer bullet lists.', []);
  assert.equal(clientSuggestion.text, 'I prefer bullet lists');
  assert.equal(suggestWinstonMemory('Please remember that I prefer bullet lists.', [
    { text: 'I prefer bullet lists' },
  ]), null);
});

test('pending server memory suggestions can be recovered in Winston settings', async () => {
  const browser = installBrowserStubs();
  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.action, 'memory-suggestion-list');
      return jsonResponse({
        memorySuggestions: [
          {
            id: 'a'.repeat(64),
            text: 'Use concise bullet lists',
            scope: 'room',
            roomId: 'room_original_123',
            status: 'pending',
            expiresAt: Date.now() + 60_000,
          },
          {
            id: 'b'.repeat(64),
            text: 'Already dismissed',
            scope: 'personal',
            status: 'dismissed',
          },
        ],
      });
    };
    const suggestions = await loadWinstonMemorySuggestions({
      config: { profileEndpoint: 'https://profile.example.test' },
    });
    assert.deepEqual(suggestions, [{
      id: 'a'.repeat(64),
      text: 'Use concise bullet lists',
      scope: 'room',
      roomId: 'room_original_123',
      expiresAt: suggestions[0].expiresAt,
    }]);
    assert.match(aiSource, /WinstonPendingMemorySuggestions/);
    assert.match(enhancementSource, /suggestion\.roomId \|\| roomId/);
  } finally {
    browser.restore();
  }
});

test('negative feedback reaches the server contract while raw prompts, replies, IDs, and free text stay out of storage', async () => {
  const browser = installBrowserStubs();
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      const stored = winstonContracts.sanitizeWinstonFeedback({
        ...requestBody.feedback,
        prompt: 'private prompt text',
        reply: 'private reply text',
        reason: 'private free-form feedback text',
      });
      return jsonResponse({ feedback: { id: 'feedback_123456', ...stored } });
    };

    await createWinstonFeedback({
      config: { profileEndpoint: 'https://profile.example.test' },
      feedback: {
        messageId: 'message_123456',
        conversationId: 'conversation_123456',
        rating: 'not-helpful',
        reason: 'The accuracy needs work',
        provider: 'ollama-bridge',
        modelProfile: 'smart',
        prompt: 'must not be sent',
        reply: 'must not be sent',
      },
    });

    assert.equal(requestBody.action, 'feedback-create');
    assert.deepEqual(requestBody.feedback, {
      requestId: 'message_123456',
      rating: 'not_helpful',
      category: 'accuracy',
      modelProfile: 'smart',
      route: 'local',
    });

    const stored = winstonContracts.sanitizeWinstonFeedback({
      ...requestBody.feedback,
      prompt: 'private prompt text',
      reply: 'private reply text',
      reason: 'private free-form feedback text',
    });
    assert.deepEqual(Object.keys(stored), [
      'rating',
      'category',
      'requestHash',
      'modelProfile',
      'route',
    ]);
    assert.match(stored.requestHash, /^[a-f0-9]{64}$/);
    assert.notEqual(stored.requestHash, requestBody.feedback.requestId);
    assert.doesNotMatch(JSON.stringify(stored), /message_123456|private prompt|private reply|free-form/i);
  } finally {
    browser.restore();
  }
});

test('semantic and local workspace result normalization keeps only safe citation fields', () => {
  const normalized = normalizeWorkspaceSearchResults([{
    id: 'S1',
    title: 'Launch plan',
    excerpt: 'The launch moved to Friday.',
    score: 99,
    privatePath: '/aiAgentPrivate/user/secret',
    source: {
      id: 'S1',
      type: 'document',
      roomId: 'room_123456',
      channelId: 'general',
      itemId: 'document_123456',
      label: 'Launch plan',
      excerpt: 'The launch moved to Friday.',
      timestamp: 123,
      privatePath: '/docs/private',
      ownerUid: 'other-user',
    },
  }]);
  assert.deepEqual(normalized, [{
    id: 'S1',
    title: 'Launch plan',
    excerpt: 'The launch moved to Friday.',
    score: 1,
    source: {
      id: 'S1',
      type: 'document',
      roomId: 'room_123456',
      itemId: 'document_123456',
      channelId: 'general',
      label: 'Launch plan',
      excerpt: 'The launch moved to Friday.',
      timestamp: 123,
    },
  }]);
  assert.doesNotMatch(JSON.stringify(normalized), /privatePath|ownerUid|aiAgentPrivate/);

  const local = searchLocalWinstonContext('launch Friday', {
    messages: [{ id: 'message_123456', name: 'Ari', text: 'The launch moved to Friday.', at: 50 }],
    tasks: [{ id: 'task_123456', text: 'Order coffee', createdAt: 60 }],
    events: [],
    docs: [],
  }, 'room_123456');
  assert.equal(local.length, 1);
  assert.equal(local[0].source.type, 'message');
  assert.equal(local[0].source.roomId, 'room_123456');
  assert.equal(local[0].source.itemId, 'message_123456');
});

test('live tools detect bounded public requests, reject local URLs, and serialize the gateway contract', async () => {
  assert.deepEqual(detectWinstonLiveTool('/weather: San Jose, CA'), {
    tool: 'weather',
    input: { location: 'San Jose, CA' },
  });
  assert.deepEqual(detectWinstonLiveTool('/preview https://example.com/report#section'), {
    tool: 'webpage',
    input: { mode: 'preview', url: 'https://example.com/report' },
  });
  assert.equal(detectWinstonLiveTool('Please summarize https://example.com/report'), null);
  assert.equal(detectWinstonLiveTool('/preview http://example.com/report'), null);
  assert.equal(detectWinstonLiveTool('/preview https://example.com:8443/report'), null);
  assert.equal(detectWinstonLiveTool('Summarize http://127.0.0.1:8080/admin'), null);
  assert.equal(detectWinstonLiveTool('Summarize http://192.168.1.5/private'), null);
  assert.equal(detectWinstonLiveTool('/search: arbitrary web search'), null);
  assert.match(winstonLiveToolFailureMessage({ tool: 'weather' }), /will not guess/i);
  assert.match(winstonLiveToolFailureMessage({ tool: 'webpage' }), /link preview/i);
  assert.match(aiSource, /extendedToolRequest && !liveToolResult/);
  assert.match(aiSource, /status: 'error'/);
  assert.match(aiSource, /\/preview https:\/\/…/);

  const browser = installBrowserStubs();
  const requests = [];
  try {
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse({
        reply: 'San Jose is sunny.',
        provider: 'weather-tool',
        sources: [{
          id: 'S1',
          type: 'document',
          roomId: 'global',
          itemId: 'weather_123456',
          label: 'Weather source',
          excerpt: 'Sunny',
        }],
      });
    };
    const result = await runWinstonLiveTool({
      config: { gatewayEndpoint: 'https://gateway.example.test' },
      request: detectWinstonLiveTool('/weather San Jose, CA'),
    });
    assert.deepEqual(requests[0], {
      action: 'live-tool',
      tool: 'weather',
      input: { location: 'San Jose, CA' },
    });
    assert.equal(result.reply, 'San Jose is sunny.');
    assert.equal(result.sources[0].id, 'S1');
  } finally {
    browser.restore();
  }
});

test('all four expanded workspace actions survive the server-to-client confirmation contract', async () => {
  const confirmedActions = [
    {
      id: 'a'.repeat(64),
      type: 'create_event',
      title: 'Create event: Launch review',
      roomId: 'room_123456',
      result: {
        eventId: 'event_123456',
        roomId: 'room_123456',
        title: 'Launch review',
        date: '2026-07-30',
        time: '09:00',
      },
    },
    {
      id: 'b'.repeat(64),
      type: 'update_event',
      title: 'Update event: Launch review',
      roomId: 'room_123456',
      result: {
        eventId: 'event_123456',
        roomId: 'room_123456',
        title: 'Launch review',
        date: '2026-07-31',
        time: '10:00',
      },
    },
    {
      id: 'c'.repeat(64),
      type: 'set_reminder',
      title: 'Set reminder: Bring notes',
      roomId: 'room_123456',
      result: {
        reminderId: 'reminder_123456',
        roomId: 'room_123456',
        dueAt: 2_000_000_000_000,
      },
    },
    {
      id: 'd'.repeat(64),
      type: 'complete_task',
      title: 'Complete task: Draft notes',
      roomId: 'room_123456',
      result: {
        taskId: 'task_123456',
        roomId: 'room_123456',
        completedAt: 1_999_999_999_000,
      },
    },
  ].map((action) => aiActionContracts.publicAiAction({
    ...action,
    description: 'Only after confirmation.',
    requiresConfirmation: true,
    status: 'confirmed',
    expiresAt: 2_000_000_100_000,
  }));

  const clientActions = normalizeAiActions(confirmedActions);
  assert.deepEqual(clientActions.map(({ type }) => type), [
    'create_event',
    'update_event',
    'set_reminder',
    'complete_task',
  ]);
  assert.ok(clientActions.every(({ result }) => result));
  assert.ok(clientActions.every(({ type }) => aiActionPresentation(type)));

  const tabClicks = [];
  const documentTarget = {
    querySelector(selector) {
      return { click: () => tabClicks.push(selector) };
    },
  };
  const windowTarget = {
    activeRoomId: 'room_123456',
  };
  assert.equal((await openAiActionContext(clientActions[0], null, { documentTarget, windowTarget })).opened, true);
  assert.equal((await openAiActionContext(clientActions[1], null, { documentTarget, windowTarget })).opened, true);
  assert.equal((await openAiActionContext(clientActions[2], null, { documentTarget, windowTarget })).opened, true);
  assert.equal((await openAiActionContext(clientActions[3], null, { documentTarget, windowTarget })).opened, true);
  assert.deepEqual(tabClicks, [
    '.room-tab[data-target="events"]',
    '.room-tab[data-target="events"]',
    '.room-tab[data-target="events"]',
    '.room-tab[data-target="tasks"]',
  ]);
});

test('response controls, upgrade panels, Auto wiring, and gateway dispatch stay connected', () => {
  assert.match(enhancementSource, /aria-label="Winston conversations"/);
  assert.match(enhancementSource, /aria-label="Search your workspace"/);
  assert.match(enhancementSource, /aria-label="Proactive Winston briefings"/);
  assert.match(enhancementSource, /aria-label="Memory suggestion"/);
  assert.match(enhancementSource, /aria-label="Winston response actions"/);
  assert.match(enhancementSource, /navigator\.clipboard\.writeText\(message\.content\)/);
  assert.match(enhancementSource, /speechSynthesis\.speak\(utterance\)/);
  assert.match(enhancementSource, /toggleWinstonSavedResponse\(message\)/);
  assert.match(enhancementSource, /createWinstonFeedback\(/);
  assert.match(enhancementSource, /title="Helpful"/);
  assert.match(enhancementSource, /title="Not helpful"/);

  assert.match(aiSource, /useWinstonConversations\(/);
  assert.match(aiSource, /modelProfile:\s*configuredModelProfile/);
  assert.match(aiSource, /requestedModelProfile:\s*modelMode/);
  assert.match(aiSource, /requestedModelMode:\s*modelMode/);
  assert.match(aiSource, /Array\.isArray\(result\.memorySuggestions\)/);
  assert.match(aiSource, /memorySuggestions,\s*\r?\n\s*originPromptId/);
  assert.match(aiSource, /WinstonConversationDrawer/);
  assert.match(aiSource, /WinstonWorkspaceSearchPanel/);
  assert.match(aiSource, /WinstonProactiveSettings/);
  assert.match(aiSource, /WinstonSavedResponses/);
  assert.match(aiSource, /AssistantResponseToolbar/);

  assert.match(gatewaySource, /action === 'workspace-search'/);
  assert.match(gatewaySource, /action === 'live-tool'/);
  assert.match(gatewaySource, /memorySuggestions/);
  assert.match(gatewaySource, /resolveWinstonModelProfile\(/);
});

test('conversation and workspace search controls keep their compact semantic grouping', () => {
  assert.match(
    enhancementSource,
    /className="pa-conversation-toolbar" role="toolbar" aria-label="Conversation controls"/,
  );
  assert.match(
    enhancementSource,
    /<input type="search"[\s\S]{0,240}placeholder="Search conversations"/,
  );
  assert.match(
    enhancementSource,
    /<form className="pa-workspace-query" role="search" onSubmit=\{runSearch\}>/,
  );
  assert.match(
    enhancementSource,
    /className="pa-workspace-query-submit"\s+type="submit"\s+disabled=\{!query\.trim\(\) \|\| state === 'loading' \|\| disabled\}/,
  );
  assert.match(enhancementSource, /role="status"/);
});

test('saved responses toggle without retaining unbounded or server-private message fields', () => {
  const browser = installBrowserStubs();
  try {
    const message = {
      id: 'reply_12345678',
      content: 'x'.repeat(7_000),
      provider: 'ollama-bridge',
      model: 'qwen',
      prompt: 'private prompt',
      sources: [{ secret: true }],
    };
    assert.deepEqual(toggleWinstonSavedResponse(message), { saved: true });
    const stored = JSON.parse(browser.localStorage.getItem(
      'minimalist.winston.saved-responses.v1:user_contract_123',
    ));
    assert.equal(stored.length, 1);
    assert.ok(stored[0].content.length <= 6_000);
    assert.deepEqual(Object.keys(stored[0]), ['id', 'content', 'provider', 'model', 'savedAt']);
    assert.equal(loadWinstonSavedResponses()[0].content, stored[0].content);
    assert.match(enhancementSource, /aria-label="Saved Winston responses"/);
    assert.deepEqual(toggleWinstonSavedResponse(message), { saved: false });
  } finally {
    browser.restore();
  }
});
