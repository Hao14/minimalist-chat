import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  applyServerReplyContext,
  buildModerationEvidence,
  createModerationReport,
  evaluateMessageModeration,
  moderationReportId,
  sanitizeModeratedMessageInput,
  sanitizeModerationReportInput,
  transitionModerationReport,
} = require('../functions/moderation-contracts.js');
const {
  mergedRoomModerationConfig,
  roomModerationRole,
} = require('../functions/room-moderation.js');

const reporterUid = 'reporter-user';
const authorUid = 'author-user';
const moderatorUid = 'moderator-user';
const roomId = 'room_123456';

function reportFixture() {
  const input = sanitizeModerationReportInput({
    category: 'harassment',
    reason: 'This message targets another member repeatedly.',
    idempotencyKey: 'report-attempt-0001',
    subject: {
      type: 'message',
      messageId: 'message_123456',
      channelId: 'general',
    },
  });
  const evidence = buildModerationEvidence({
    subject: input.subject,
    message: {
      uid: authorUid,
      name: 'Author',
      text: 'Captured message text',
      timestamp: 100,
      attachedFile: {
        url: 'https://cdn.example.test/file.txt',
        name: 'file.txt',
        type: 'text/plain',
        size: 12,
      },
    },
    capturedAt: 200,
  });
  return createModerationReport({
    roomId,
    reporterUid,
    input,
    evidence,
    now: 200,
  });
}

test('report input validates category, reason, subject, and idempotency', () => {
  const input = sanitizeModerationReportInput({
    category: 'spam',
    reason: 'Repeated unsolicited advertisements.',
    idempotencyKey: 'report-key-1234',
    subject: { type: 'user', targetUid: authorUid },
  });
  assert.equal(input.category, 'spam');
  assert.equal(input.subject.targetUid, authorUid);

  assert.throws(
    () => sanitizeModerationReportInput({
      ...input,
      category: 'dislike',
      idempotencyKey: 'report-key-1234',
    }),
    (error) => error.code === 'MODERATION_REPORT_CATEGORY_INVALID' && error.status === 400,
  );
  assert.throws(
    () => sanitizeModerationReportInput({
      ...input,
      reason: 'short',
      idempotencyKey: 'report-key-1234',
    }),
    (error) => error.code === 'MODERATION_TEXT_TOO_SHORT',
  );
  assert.throws(
    () => sanitizeModerationReportInput({
      ...input,
      idempotencyKey: 'bad key',
    }),
    (error) => error.code === 'MODERATION_IDEMPOTENCY_INVALID',
  );
});

test('report IDs are deterministic and evidence is an immutable hashed snapshot', () => {
  const report = reportFixture();
  const expectedId = moderationReportId({
    reporterUid,
    roomId,
    idempotencyKey: 'report-attempt-0001',
  });
  assert.equal(report.reportId, expectedId);
  assert.match(report.evidence.hash, /^[a-f0-9]{64}$/);
  assert.equal(report.evidence.message.text, 'Captured message text');
  assert.equal(report.state.status, 'open');

  const createdEvent = Object.values(report.audit)[0];
  assert.equal(createdEvent.type, 'created');
  assert.equal(createdEvent.previousHash, '');
  assert.equal(report.auditHead, createdEvent.hash);

  const retry = reportFixture();
  assert.deepEqual(retry, report);
});

test('moderator transitions append a chained audit without changing evidence', () => {
  const report = reportFixture();
  const originalEvidence = structuredClone(report.evidence);
  const originalAudit = structuredClone(report.audit);

  const assigned = transitionModerationReport(report, {
    type: 'transition',
    actorUid: moderatorUid,
    idempotencyKey: 'assign-attempt-0001',
    status: 'triaged',
    assignedTo: moderatorUid,
    now: 300,
  });
  assert.equal(assigned.changed, true);
  assert.equal(assigned.record.state.status, 'triaged');
  assert.equal(assigned.record.state.assignedTo, moderatorUid);
  assert.deepEqual(assigned.record.evidence, originalEvidence);
  assert.deepEqual(
    Object.fromEntries(Object.entries(assigned.record.audit).slice(0, 1)),
    originalAudit,
  );
  assert.equal(assigned.event.previousHash, report.auditHead);
  assert.equal(assigned.record.auditHead, assigned.event.hash);

  const idempotent = transitionModerationReport(assigned.record, {
    type: 'transition',
    actorUid: moderatorUid,
    idempotencyKey: 'assign-attempt-0001',
    status: 'triaged',
    assignedTo: moderatorUid,
    now: 999,
  });
  assert.equal(idempotent.changed, false);
  assert.deepEqual(idempotent.record, assigned.record);

  const resolved = transitionModerationReport(assigned.record, {
    type: 'transition',
    actorUid: moderatorUid,
    idempotencyKey: 'resolve-attempt-0001',
    status: 'resolved',
    resolutionCode: 'warning',
    resolutionNote: 'The author was warned.',
    now: 400,
  });
  assert.equal(resolved.record.state.status, 'resolved');
  assert.equal(resolved.record.state.resolutionCode, 'warning');
  assert.deepEqual(resolved.record.evidence, originalEvidence);

  assert.throws(
    () => transitionModerationReport(resolved.record, {
      type: 'transition',
      actorUid: moderatorUid,
      idempotencyKey: 'invalid-transition-0001',
      status: 'triaged',
      now: 500,
    }),
    (error) => error.code === 'MODERATION_REPORT_TRANSITION_INVALID' && error.status === 409,
  );
});

test('appeals are reporter-owned and require an explicit moderator decision', () => {
  const resolved = transitionModerationReport(reportFixture(), {
    type: 'transition',
    actorUid: moderatorUid,
    idempotencyKey: 'resolve-attempt-0002',
    status: 'resolved',
    resolutionCode: 'no_action',
    now: 300,
  }).record;

  assert.throws(
    () => transitionModerationReport(resolved, {
      type: 'appeal',
      actorUid: authorUid,
      idempotencyKey: 'appeal-attempt-0001',
      reason: 'I believe the evidence was interpreted incorrectly.',
      now: 400,
    }),
    (error) => error.code === 'MODERATION_APPEAL_FORBIDDEN' && error.status === 403,
  );

  const appealed = transitionModerationReport(resolved, {
    type: 'appeal',
    actorUid: reporterUid,
    idempotencyKey: 'appeal-attempt-0001',
    reason: 'I believe the evidence was interpreted incorrectly.',
    now: 400,
  }).record;
  assert.equal(appealed.state.status, 'appealed');
  assert.equal(appealed.appeal.status, 'pending');
  assert.equal(appealed.appeal.fromStatus, 'resolved');

  const accepted = transitionModerationReport(appealed, {
    type: 'appeal_decision',
    actorUid: moderatorUid,
    idempotencyKey: 'appeal-decision-0001',
    decision: 'accept',
    note: 'A second review is appropriate.',
    now: 500,
  }).record;
  assert.equal(accepted.appeal.status, 'accepted');
  assert.equal(accepted.state.status, 'investigating');
  assert.equal(accepted.state.resolutionCode, '');
  assert.equal(Object.keys(accepted.audit).length, 4);
});

test('content policy blocks terms, links, character flood, caps, and mention bursts', () => {
  const baseConfig = {
    enabled: true,
    blockedTerms: ['scam'],
    blockLinks: true,
    blockCaps: true,
    blockFlood: true,
    maxMentions: 2,
  };
  const cases = [
    ['This looks like a scam to me.', 'blocked_term'],
    ['Visit https://example.test now', 'links_blocked'],
    ['Nooooooooo way', 'character_flood'],
    ['THIS MESSAGE IS ALMOST ENTIRELY CAPITAL LETTERS', 'excessive_caps'],
    ['@one @two @three please review', 'mention_limit'],
  ];
  for (const [text, code] of cases) {
    const result = evaluateMessageModeration({ text, config: baseConfig, now: 1000 });
    assert.equal(result.allowed, false, text);
    assert.equal(result.code, code, text);
    assert.equal(result.nextState, null, text);
  }
});

test('slow mode, rate windows, and duplicate-message flood use server state', () => {
  const slow = evaluateMessageModeration({
    text: 'A valid message',
    config: { enabled: true, slowModeSeconds: 5 },
    state: { lastAcceptedAt: 1000 },
    now: 3000,
  });
  assert.equal(slow.code, 'slow_mode');
  assert.equal(slow.retryAfterSeconds, 3);

  const rate = evaluateMessageModeration({
    text: 'Another valid message',
    config: {
      enabled: true,
      rateLimitCount: 2,
      rateLimitWindowSeconds: 10,
    },
    state: { windowStartedAt: 1000, windowCount: 2 },
    now: 2000,
  });
  assert.equal(rate.code, 'rate_limit');
  assert.equal(rate.retryAfterSeconds, 9);

  const config = {
    enabled: true,
    repeatLimit: 2,
    repeatWindowSeconds: 60,
  };
  const first = evaluateMessageModeration({ text: 'same message', config, now: 1000 });
  const second = evaluateMessageModeration({
    text: 'same message',
    config,
    state: first.nextState,
    now: 2000,
  });
  const third = evaluateMessageModeration({
    text: 'same message',
    config,
    state: second.nextState,
    now: 3000,
  });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.code, 'repeated_message');
});

test('server message sanitizer owns identity and rejects insecure attachments', () => {
  const message = sanitizeModeratedMessageInput({
    uid: 'forged-user',
    name: 'Forged',
    tier: 'pro',
    timestamp: 1,
    text: 'Hello room',
    attachedFile: {
      url: 'https://cdn.example.test/hello.txt',
      name: 'hello.txt',
      type: 'text/plain',
      size: 12,
      textPreview: 'hello',
    },
    replyTo: {
      id: 'message_654321',
      name: 'Original author',
      text: 'Original message',
      roomId: 'forged-room',
    },
  }, {
    uid: reporterUid,
    name: 'Reporter',
    photoUrl: 'https://cdn.example.test/avatar.png',
    tier: 'free',
    roomId,
    channelId: 'general',
  }, 500);
  assert.equal(message.uid, reporterUid);
  assert.equal(message.name, 'Reporter');
  assert.equal(message.tier, 'free');
  assert.equal(message.timestamp, 500);
  assert.deepEqual(message.replyTo, { id: 'message_654321' });
  assert.equal(message.attachedFile.textPreview, 'hello');

  const threaded = applyServerReplyContext(message, {
    uid: authorUid,
    name: 'Trusted parent author',
    text: 'Trusted parent text',
    threadRootId: 'message_root_0001',
  }, {
    parentMessageId: 'message_654321',
    roomId,
    channelId: 'general',
  });
  assert.equal(threaded.threadRootId, 'message_root_0001');
  assert.equal(threaded.threadParentId, 'message_654321');
  assert.deepEqual(threaded.replyTo, {
    id: 'message_654321',
    uid: authorUid,
    name: 'Trusted parent author',
    text: 'Trusted parent text',
    roomId,
    channelId: 'general',
  });

  assert.throws(
    () => sanitizeModeratedMessageInput({
      text: '',
      attachedImage: 'http://127.0.0.1/private',
    }, {
      uid: reporterUid,
      name: 'Reporter',
      roomId,
      channelId: 'general',
    }),
    (error) => error.code === 'MODERATION_ATTACHMENT_URL_INVALID',
  );
});

test('owner and explicit moderator authorization is narrow and legacy-compatible', () => {
  const room = {
    creatorId: 'owner-user',
    members: {
      'owner-user': true,
      [moderatorUid]: true,
      'member-user': true,
    },
    moderators: { [moderatorUid]: true },
    memberPermissions: {
      'member-user': { chat: true },
    },
  };
  assert.deepEqual(roomModerationRole('owner-user', room), {
    isMember: true,
    isModerator: true,
    isOwner: true,
    role: 'owner',
  });
  assert.equal(roomModerationRole(moderatorUid, room).role, 'moderator');
  assert.equal(roomModerationRole('member-user', room).role, 'member');
  assert.equal(roomModerationRole('outsider-user', room).role, 'none');
  assert.equal(roomModerationRole('member-user', {
    ...room,
    memberPermissions: {
      'member-user': { manageBots: true, manageChannels: true },
    },
  }).role, 'member');

  const legacy = mergedRoomModerationConfig({
    bots: {
      autoModeration: {
        enabled: true,
        blockedWords: 'spam, scam',
        blockLinks: true,
      },
    },
    moderation: {
      enforceServer: true,
      slowModeSeconds: 3,
    },
  });
  assert.equal(legacy.enabled, true);
  assert.equal(legacy.enforceServer, true);
  assert.deepEqual(legacy.blockedTerms, ['spam', 'scam']);
  assert.equal(legacy.slowModeSeconds, 3);
});
