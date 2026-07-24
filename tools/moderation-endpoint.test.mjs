import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createRoomModerationHandler,
} = require('../functions/room-moderation.js');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeSnapshot {
  constructor(value) {
    this.value = clone(value);
  }

  exists() {
    return this.value !== undefined && this.value !== null;
  }

  val() {
    return clone(this.value);
  }
}

class FakeReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  async once() {
    return new FakeSnapshot(this.database.get(this.path));
  }

  async set(value) {
    this.database.set(this.path, value);
  }

  async transaction(update) {
    const current = clone(this.database.get(this.path));
    const next = update(current);
    if (next === undefined) {
      return { committed: false, snapshot: new FakeSnapshot(current) };
    }
    this.database.set(this.path, next);
    return { committed: true, snapshot: new FakeSnapshot(next) };
  }
}

class FakeDatabase {
  constructor(seed = {}) {
    this.root = clone(seed);
  }

  ref(path) {
    return new FakeReference(this, path);
  }

  get(path) {
    return String(path || '')
      .split('/')
      .filter(Boolean)
      .reduce((value, key) => value?.[key], this.root);
  }

  set(path, value) {
    const parts = String(path || '').split('/').filter(Boolean);
    let cursor = this.root;
    parts.slice(0, -1).forEach((key) => {
      if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
      cursor = cursor[key];
    });
    cursor[parts.at(-1)] = clone(value);
  }
}

function request(body, authUid) {
  return {
    method: 'POST',
    body,
    authUid,
    get(name) {
      if (String(name).toLowerCase() === 'origin') return 'https://minimalist.chat';
      return '';
    },
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

function endpointFixture() {
  const database = new FakeDatabase({
    rooms_meta: {
      room_123456: {
        creatorId: 'owner-user',
        members: {
          'owner-user': true,
          'reporter-user': true,
          'author-user': true,
          'moderator-user': true,
        },
        moderators: {
          'moderator-user': true,
        },
        permissions: { chat: true },
        memberPermissions: {},
        channels: {
          general: { name: 'General' },
        },
        moderation: {
          enabled: true,
          enforceServer: true,
          blockedTerms: 'scam',
          maxMentions: 3,
          rateLimitCount: 10,
          rateLimitWindowSeconds: 10,
        },
      },
    },
    rooms_data: {
      room_123456: {
        messages: {
          message_123456: {
            uid: 'author-user',
            name: 'Author',
            text: 'Evidence captured by the server.',
            timestamp: 100,
          },
        },
      },
    },
    users: {
      'reporter-user': {
        displayName: 'Reporter',
        isMuted: false,
        tier: 'free',
      },
      'author-user': {
        displayName: 'Author',
        isMuted: false,
        tier: 'free',
      },
      'moderator-user': {
        displayName: 'Moderator',
        isMuted: false,
        tier: 'free',
      },
      'member-user': {
        displayName: 'Member',
        isMuted: false,
        tier: 'free',
      },
    },
    user_directory: {
      'reporter-user': { name: 'Reporter' },
      'author-user': { name: 'Author' },
      'moderator-user': { name: 'Moderator' },
    },
  });
  const handler = createRoomModerationHandler({
    admin: { database: () => database },
    requireFirebaseUser: async (req) => ({ uid: req.authUid, name: req.authUid }),
    setCors: () => {},
    allowedCorsOrigin: () => 'https://minimalist.chat',
  });
  return { database, handler };
}

async function invoke(handler, body, uid) {
  const res = response();
  await handler(request(body, uid), res);
  return res;
}

test('report endpoint freezes evidence, retries idempotently, and enforces moderator transitions', async () => {
  const { database, handler } = endpointFixture();
  const createBody = {
    action: 'report-create',
    roomId: 'room_123456',
    idempotencyKey: 'report-create-0001',
    category: 'harassment',
    reason: 'The message repeatedly targets another room member.',
    subject: {
      type: 'message',
      channelId: 'general',
      messageId: 'message_123456',
    },
  };

  const created = await invoke(handler, createBody, 'reporter-user');
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.idempotent, false);
  assert.equal(created.body.report.state.status, 'open');
  assert.equal(created.body.report.evidence.message.text, 'Evidence captured by the server.');
  assert.match(created.body.report.evidence.hash, /^[a-f0-9]{64}$/);
  const reportId = created.body.report.id;

  database.set(
    'rooms_data/room_123456/messages/message_123456/text',
    'The live message changed after the report.',
  );
  const retried = await invoke(handler, createBody, 'reporter-user');
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.body.idempotent, true);
  assert.equal(
    retried.body.report.evidence.message.text,
    'Evidence captured by the server.',
    'an idempotent retry must not replace the original evidence snapshot',
  );
  database.set(
    'rooms_data/room_123456/messages/message_123456',
    null,
  );
  const retriedAfterDeletion = await invoke(handler, createBody, 'reporter-user');
  assert.equal(retriedAfterDeletion.statusCode, 200);
  assert.equal(retriedAfterDeletion.body.idempotent, true);
  assert.equal(
    retriedAfterDeletion.body.report.evidence.message.text,
    'Evidence captured by the server.',
    'an idempotent retry must return frozen evidence after the live message is deleted',
  );

  const forbidden = await invoke(handler, {
    action: 'report-transition',
    roomId: 'room_123456',
    reportId,
    idempotencyKey: 'transition-0001',
    status: 'resolved',
    resolutionCode: 'warning',
  }, 'reporter-user');
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.body.code, 'MODERATION_MODERATOR_REQUIRED');

  const resolved = await invoke(handler, {
    action: 'report-transition',
    roomId: 'room_123456',
    reportId,
    idempotencyKey: 'transition-0001',
    status: 'resolved',
    assignedTo: 'moderator-user',
    resolutionCode: 'warning',
    resolutionNote: 'The author received a warning.',
  }, 'moderator-user');
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.report.state.status, 'resolved');
  assert.equal(resolved.body.report.state.assignedTo, 'moderator-user');
  assert.equal(resolved.body.report.audit.length, 2);
  assert.equal(
    resolved.body.report.audit[1].previousHash,
    resolved.body.report.audit[0].hash,
  );
  assert.equal(
    resolved.body.report.evidence.message.text,
    'Evidence captured by the server.',
  );
});

test('appeal endpoint is reporter-owned and moderator decisions append state', async () => {
  const { handler } = endpointFixture();
  const created = await invoke(handler, {
    action: 'report-create',
    roomId: 'room_123456',
    idempotencyKey: 'report-create-0002',
    category: 'spam',
    reason: 'This account keeps sending the same advertisement.',
    subject: {
      type: 'message',
      channelId: 'general',
      messageId: 'message_123456',
    },
  }, 'reporter-user');
  const reportId = created.body.report.id;
  await invoke(handler, {
    action: 'report-transition',
    roomId: 'room_123456',
    reportId,
    idempotencyKey: 'transition-0002',
    status: 'dismissed',
    resolutionCode: 'insufficient_evidence',
  }, 'moderator-user');

  const appealed = await invoke(handler, {
    action: 'report-appeal',
    roomId: 'room_123456',
    reportId,
    idempotencyKey: 'appeal-create-0002',
    reason: 'Additional context makes the repeated behavior clear.',
  }, 'reporter-user');
  assert.equal(appealed.statusCode, 200);
  assert.equal(appealed.body.report.state.status, 'appealed');
  assert.equal(appealed.body.report.appeal.status, 'pending');

  const decided = await invoke(handler, {
    action: 'appeal-decide',
    roomId: 'room_123456',
    reportId,
    idempotencyKey: 'appeal-decision-0002',
    decision: 'accept',
    note: 'Reopening for a second review.',
  }, 'moderator-user');
  assert.equal(decided.statusCode, 200);
  assert.equal(decided.body.report.state.status, 'investigating');
  assert.equal(decided.body.report.appeal.status, 'accepted');
  assert.equal(decided.body.report.audit.length, 4);
});

test('message-send owns identity, reserves moderation state, and blocks policy matches', async () => {
  const { database, handler } = endpointFixture();
  const sent = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_send_0001',
    message: {
      uid: 'forged-user',
      name: 'Forged identity',
      tier: 'pro',
      text: 'A clean server-moderated message.',
      replyTo: {
        id: 'message_123456',
        uid: 'forged-parent-user',
        name: 'Forged parent author',
        text: 'Forged parent text',
      },
    },
  }, 'reporter-user');
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.body.message.uid, 'reporter-user');
  assert.equal(sent.body.message.name, 'Reporter');
  assert.equal(sent.body.message.tier, 'free');
  assert.equal(sent.body.message.moderation.serverEnforced, true);
  assert.equal(sent.body.message.threadRootId, 'message_123456');
  assert.equal(sent.body.message.threadParentId, 'message_123456');
  assert.deepEqual(sent.body.message.replyTo, {
    id: 'message_123456',
    uid: 'author-user',
    name: 'Author',
    text: 'Evidence captured by the server.',
    roomId: 'room_123456',
    channelId: 'general',
  });
  assert.equal(
    database.get('room_moderation/room_123456/messageState/reporter-user/general/lastReservationId'),
    'message_send_0001',
  );

  const retried = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_send_0001',
    message: { text: 'A different retry payload must not replace the first.' },
  }, 'reporter-user');
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.body.idempotent, true);
  assert.equal(retried.body.message.text, 'A clean server-moderated message.');

  const blocked = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_send_0002',
    message: { text: 'This is a scam link pitch.' },
  }, 'reporter-user');
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, 'blocked_term');
  assert.equal(blocked.body.moderation.allowed, false);
  assert.equal(
    database.get('rooms_data/room_123456/messages/message_send_0002'),
    undefined,
  );

  const missingParent = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_send_0003',
    message: {
      text: 'Reply to a missing parent.',
      replyTo: { id: 'message_missing_0001' },
    },
  }, 'reporter-user');
  assert.equal(missingParent.statusCode, 404);
  assert.equal(missingParent.body.code, 'MODERATION_REPLY_TARGET_NOT_FOUND');
});

test('message-edit is idempotent and policy checked', async () => {
  const { database, handler } = endpointFixture();
  database.set('rooms_data/room_123456/messages/message_edit_0001', {
    uid: 'reporter-user',
    name: 'Reporter',
    text: 'Original clean text.',
    timestamp: 100,
  });

  const edited = await invoke(handler, {
    action: 'message-edit',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_edit_0001',
    idempotencyKey: 'message-edit-key-0001',
    text: 'Updated clean text.',
  }, 'reporter-user');
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.body.message.text, 'Updated clean text.');
  assert.equal(edited.body.message.edited, true);

  const retried = await invoke(handler, {
    action: 'message-edit',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_edit_0001',
    idempotencyKey: 'message-edit-key-0001',
    text: 'A retry cannot replace the accepted edit.',
  }, 'reporter-user');
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.body.idempotent, true);
  assert.equal(retried.body.message.text, 'Updated clean text.');

  const blocked = await invoke(handler, {
    action: 'message-edit',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_edit_0001',
    idempotencyKey: 'message-edit-key-0002',
    text: 'Replace this with scam content.',
  }, 'reporter-user');
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, 'blocked_term');
  assert.equal(
    database.get('rooms_data/room_123456/messages/message_edit_0001/text'),
    'Updated clean text.',
  );
});

test('message-send enforces announcement and owner-only channel roles on the server', async () => {
  const { database, handler } = endpointFixture();
  database.set('rooms_meta/room_123456/members/member-user', true);
  database.set('rooms_meta/room_123456/channels/announcements', {
    name: 'Announcements',
    mode: 'announcements',
  });
  database.set('rooms_meta/room_123456/channels/owners', {
    name: 'Owners',
    mode: 'chat',
    postRole: 'owner',
  });

  const memberDenied = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'announcements',
    messageId: 'message_announce_0001',
    message: { text: 'A member cannot bypass announcement policy.' },
  }, 'member-user');
  assert.equal(memberDenied.statusCode, 403);
  assert.equal(memberDenied.body.code, 'MODERATION_CHANNEL_POST_ROLE_DENIED');

  const moderatorSent = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'announcements',
    messageId: 'message_announce_0002',
    message: { text: 'A moderator announcement.' },
  }, 'moderator-user');
  assert.equal(moderatorSent.statusCode, 200);
  assert.equal(moderatorSent.body.message.text, 'A moderator announcement.');

  const moderatorOwnerDenied = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'owners',
    messageId: 'message_owner_0001',
    message: { text: 'Moderator is not the owner.' },
  }, 'moderator-user');
  assert.equal(moderatorOwnerDenied.statusCode, 403);
  assert.equal(moderatorOwnerDenied.body.code, 'MODERATION_CHANNEL_POST_ROLE_DENIED');

  const ownerSent = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'owners',
    messageId: 'message_owner_0002',
    message: { text: 'Owner-only update.' },
  }, 'owner-user');
  assert.equal(ownerSent.statusCode, 200);
});

test('server-enforced sends reject banned and muted accounts', async () => {
  const { database, handler } = endpointFixture();
  database.set('rooms_meta/room_123456/members/banned-user', true);
  database.set('rooms_meta/room_123456/members/muted-user', true);
  database.set('users/banned-user', {
    displayName: 'Banned',
    isBanned: true,
    isMuted: false,
  });
  database.set('users/muted-user', {
    displayName: 'Muted',
    isBanned: false,
    isMuted: true,
  });

  const banned = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_banned_0001',
    message: { text: 'A banned account cannot use the server endpoint.' },
  }, 'banned-user');
  assert.equal(banned.statusCode, 403);
  assert.equal(banned.body.code, 'MODERATION_ACCOUNT_BANNED');

  const muted = await invoke(handler, {
    action: 'message-send',
    roomId: 'room_123456',
    channelId: 'general',
    messageId: 'message_muted_0001',
    message: { text: 'A muted account cannot use the server endpoint.' },
  }, 'muted-user');
  assert.equal(muted.statusCode, 403);
  assert.equal(muted.body.code, 'MODERATION_ACCOUNT_MUTED');
});
