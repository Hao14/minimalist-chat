import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'chat-app-356c1';
const DATABASE_URL = `https://${PROJECT_ID}-default-rtdb.firebaseio.com`;

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  database: {
    rules: readFileSync('database.rules.json', 'utf8'),
  },
});

function dbFor(uid) {
  return testEnv.authenticatedContext(uid, {
    email: `${uid}@example.test`,
    email_verified: true,
  }).database(DATABASE_URL);
}

function adminDb() {
  return testEnv.authenticatedContext('rules-admin').database(DATABASE_URL);
}

function ref(db, path) {
  return db.ref(path);
}

async function pass(name, promise) {
  await promise;
  console.log(`PASS ${name}`);
}

async function seedUser(admin, uid, extra = {}) {
  await ref(admin, `users/${uid}`).set({
    displayName: uid,
    shortId: uid.slice(0, 8).toUpperCase(),
    tier: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    stripePriceId: null,
    stripeCancelAtPeriodEnd: null,
    stripeCurrentPeriodEnd: null,
    stripeUpdatedAt: null,
    isBanned: false,
    isMuted: false,
    admin: false,
    isAdmin: false,
    role: null,
    ...extra,
  });
}

async function seedRoom(admin, roomId, ownerUid, extra = {}) {
  await ref(admin, `rooms_meta/${roomId}`).set({
    name: roomId,
    creatorId: ownerUid,
    integrationInstanceId: `instance-${roomId}-0001`,
    shortId: roomId.toUpperCase().slice(0, 12),
    members: {
      [ownerUid]: true,
    },
    permissions: {},
    memberPermissions: {},
    ...extra,
  });
}

try {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.database(DATABASE_URL);
    await seedUser(admin, 'owner-user');
    await seedUser(admin, 'member-user');
    await seedUser(admin, 'outsider-user');
    await seedUser(admin, 'banned-user', { isBanned: true });
    await seedUser(admin, 'muted-user', { isMuted: true });
    await ref(admin, 'friends').update({
      'member-user/owner-user': 'accepted',
      'owner-user/member-user': 'accepted',
      'member-user/outsider-user': 'accepted',
      'outsider-user/member-user': 'accepted',
      // A stale, one-sided projection must never authorize a call.
      'member-user/banned-user': 'accepted',
      // A real pending pair exercises that acceptance is server-only.
      'member-user/muted-user': 'pending_received',
      'muted-user/member-user': 'pending_sent',
    });
    await ref(admin, 'notifications/member-user/existing-note').set({
      type: 'mention',
      text: 'Existing server-created notification',
      senderUid: 'owner-user',
      timestamp: 1,
    });
    await ref(admin, `ai_runtime/text_request_queue_v1/jobs/${'a'.repeat(64)}`).set({
      jobId: 'a'.repeat(64),
      ownerUid: 'member-user',
      status: 'queued',
      payload: { messages: [{ role: 'user', content: 'private prompt' }] },
    });
    await ref(admin, `ai_runtime/text_request_queue_v1/admissions/${'a'.repeat(64)}`).set({
      jobId: 'a'.repeat(64),
      ownerUid: 'member-user',
      status: 'charged',
      payload: { messages: [{ role: 'user', content: 'private admitting prompt' }] },
      claimExpiresAt: Date.now() + 240000,
    });
    await ref(admin, `ai_queue_status/member-user/${'a'.repeat(64)}`).set({
      jobId: 'a'.repeat(64),
      requestId: 'request-queue-0001',
      status: 'queued',
      position: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await seedRoom(admin, 'private-room', 'owner-user');
    await seedRoom(admin, 'public-room', 'owner-user', { public: true });
    await seedRoom(admin, 'validation-room', 'owner-user', {
      members: {
        'owner-user': true,
        'member-user': true,
      },
    });
    await seedRoom(admin, 'discovery-room', 'owner-user', {
      discovery: {
        enabled: true,
        blurb: 'Public preview only',
      },
      webhook: {
        url: 'https://example.test/secret-webhook',
        channelId: 'general',
        updatedAt: 1,
        updatedBy: 'owner-user',
      },
      bots: {
        autoModeration: {
          enabled: true,
        },
      },
      logs: {
        log1: {
          text: 'private audit trail',
          timestamp: 1,
        },
      },
    });
    await seedRoom(admin, 'call-room', 'owner-user', {
      members: {
        'owner-user': true,
        'member-user': true,
      },
      permissions: {
        calls: true,
        video: false,
        screenShare: false,
      },
      memberPermissions: {},
      connections: {
        webhook: {
          type: 'outgoing_webhook',
          provider: 'generic',
          maskedUrl: 'https://hooks.example.test/••••',
          destinationHost: 'hooks.example.test',
          channelId: 'general',
          connected: true,
          status: 'untested',
          revision: 'revision-call-room-0001',
          updatedAt: 1,
          updatedBy: 'owner-user',
        },
      },
    });
    await ref(admin, 'room_integration_secrets/call-room/webhook').set({
      url: 'https://hooks.example.test/private-token',
      channelId: 'general',
      roomInstanceId: 'instance-call-room-0001',
      revision: 'revision-call-room-0001',
      updatedAt: 1,
      updatedBy: 'owner-user',
    });
    await seedRoom(admin, 'restricted-room', 'owner-user', {
      members: {
        'owner-user': true,
        'member-user': true,
      },
      permissions: {
        chat: false,
        createChannels: false,
        manageChannels: false,
        webhooks: false,
      },
      memberPermissions: {},
      channels: {
        existing: {
          name: 'existing',
          by: 'owner-user',
          createdAt: 1,
        },
      },
    });
  });

  const owner = dbFor('owner-user');
  const member = dbFor('member-user');
  const outsider = dbFor('outsider-user');
  const fresh = dbFor('fresh-user');
  const bundledBadgeUser = dbFor('bundled-badge-user');
  const privilegedCreateUser = dbFor('privileged-create-user');
  const banned = dbFor('banned-user');
  const muted = dbFor('muted-user');
  const siteAdmin = dbFor('WsREhwYvPxaCSAjz0aqvwAU1leg2');
  const anonymous = testEnv.unauthenticatedContext().database(DATABASE_URL);
  const queueJobId = 'a'.repeat(64);

  await pass('direct client friend request projection write is denied', assertFails(
    ref(member, 'friends/member-user/direct-send-user').set('pending_sent'),
  ));
  await pass('direct client friendship acceptance projection write is denied', assertFails(
    ref(member, 'friends/member-user/muted-user').set('accepted'),
  ));
  await pass('direct client friendship removal projection write is denied', assertFails(
    ref(member, 'friends/member-user/owner-user').remove(),
  ));
  await pass('direct client reciprocal friend projection write is denied', assertFails(
    ref(member, 'friends/owner-user/member-user').set('accepted'),
  ));

  await pass('queue owner can read only the sanitized status mirror', assertSucceeds(
    ref(member, `ai_queue_status/member-user/${queueJobId}`).get(),
  ));
  await pass('another user cannot read a queue status mirror', assertFails(
    ref(outsider, `ai_queue_status/member-user/${queueJobId}`).get(),
  ));
  await pass('site admin cannot bypass queue status ownership', assertFails(
    ref(siteAdmin, `ai_queue_status/member-user/${queueJobId}`).get(),
  ));
  await pass('anonymous client cannot read a queue status mirror', assertFails(
    ref(anonymous, `ai_queue_status/member-user/${queueJobId}`).get(),
  ));
  await pass('queue owner cannot write the server status mirror', assertFails(
    ref(member, `ai_queue_status/member-user/${queueJobId}/status`).set('completed'),
  ));
  await pass('queue owner cannot read private job payloads', assertFails(
    ref(member, `ai_runtime/text_request_queue_v1/jobs/${queueJobId}`).get(),
  ));
  await pass('site admin cannot read private job payloads', assertFails(
    ref(siteAdmin, `ai_runtime/text_request_queue_v1/jobs/${queueJobId}`).get(),
  ));
  await pass('queue owner cannot read private admission payloads', assertFails(
    ref(member, `ai_runtime/text_request_queue_v1/admissions/${queueJobId}`).get(),
  ));
  await pass('queue owner cannot write private queue state', assertFails(
    ref(member, `ai_runtime/text_request_queue_v1/pending/ticket-1`).set(queueJobId),
  ));

  const fullPublicDirectoryProfile = {
    displayName: 'Member User',
    photoUrl: 'https://example.test/member-avatar.png',
    shortId: 'MEMBER1',
    username: 'member-user',
    pronouns: 'they/them',
    bio: 'Testing the authenticated chat directory contract.',
    status: 'Available',
    flair: 'QA',
    themeColor: '#FFD700',
    updatedAt: 1,
  };

  await pass('user can write full public directory client payload', assertSucceeds(
    ref(member, 'user_directory/member-user').set(fullPublicDirectoryProfile),
  ));
  await pass('user cannot write another user public directory row', assertFails(
    ref(member, 'user_directory/outsider-user').set({
      ...fullPublicDirectoryProfile,
      displayName: 'Cross-user overwrite',
    }),
  ));

  const ownRoomIndexRow = {
    name: 'Private Room',
    shortId: 'PRIVATE1',
    lastMessage: 'Latest room activity',
    creatorId: 'owner-user',
    updatedAt: 2,
  };

  await pass('user can write own room index row', assertSucceeds(
    ref(member, 'user_rooms/member-user/private-room').set(ownRoomIndexRow),
  ));
  await pass('user can read own room index', assertSucceeds(
    ref(member, 'user_rooms/member-user').get(),
  ));
  await pass('user cannot read another user room index', assertFails(
    ref(member, 'user_rooms/outsider-user').get(),
  ));
  await pass('user cannot write another user room index row', assertFails(
    ref(member, 'user_rooms/outsider-user/private-room').set(ownRoomIndexRow),
  ));
  await pass('user can persist own performance settings', assertSucceeds(
    ref(member, 'users/member-user/performanceSettings').set({
      mode: 'auto',
      lowPerformanceMode: false,
      hardwareAccelerationMode: false,
      autoPerformanceMode: true,
      updatedAt: 2,
    }),
  ));

  await pass('new user can create profile without bundled badges', assertSucceeds(ref(fresh, 'users/fresh-user').set({
    displayName: 'Fresh User',
    photoUrl: '',
    shortId: 'FRESH1',
    themeColor: '#FFD700',
    bio: "I'm new here!",
    pronouns: '',
    createdAt: '2026-06-29T00:00:00.000Z',
  })));
  await pass('new user cannot create profile with bundled welcome badge', assertFails(ref(bundledBadgeUser, 'users/bundled-badge-user').set({
    displayName: 'Bundled Badge',
    shortId: 'BUNDLE1',
    badges: {
      welcome: 1,
    },
  })));
  await pass('new user cannot create profile with protected admin flag', assertFails(ref(privilegedCreateUser, 'users/privileged-create-user').set({
    displayName: 'Privileged Create',
    shortId: 'PRIV1',
    admin: true,
  })));
  await pass('new user can add welcome badge after profile create', assertSucceeds(ref(fresh, 'users/fresh-user/badges/welcome').set(1)));
  await pass('new user can delete own profile with badge present', assertSucceeds(ref(fresh, 'users/fresh-user').remove()));

  await pass('user can self-award welcome badge', assertSucceeds(ref(member, 'users/member-user/badges/welcome').set(1)));
  await pass('user cannot self-award founder badge', assertFails(ref(member, 'users/member-user/badges/founder').set(2)));
  await pass('user cannot self-award top contributor badge', assertFails(ref(member, 'users/member-user/badges/top_contributor').set(3)));

  const atomicKudosWrite = (targetUid, timestamp) => ({
    [`users/member-user/kudosGiven/${targetUid}`]: timestamp,
    [`users/${targetUid}/kudosFrom/member-user`]: timestamp,
    [`users/${targetUid}/kudos`]: { '.sv': { increment: 1 } },
  });
  await pass('kudos proof, sender index, and count increment atomically', assertSucceeds(
    member.ref().update(atomicKudosWrite('outsider-user', 10)),
  ));
  await pass('duplicate kudos atomic update is denied', assertFails(
    member.ref().update(atomicKudosWrite('outsider-user', 11)),
  ));
  await pass('self kudos atomic update is denied', assertFails(
    member.ref().update(atomicKudosWrite('member-user', 12)),
  ));
  await pass('kudos count cannot change without a new giver proof', assertFails(
    ref(member, 'users/owner-user/kudos').set(1),
  ));

  await pass('global message write by normal user', assertSucceeds(ref(member, 'messages/global-ok').set({
    text: 'hello global',
    uid: 'member-user',
    timestamp: 1,
  })));
  await pass('global message accepts a constrained HTTPS link preview', assertSucceeds(ref(member, 'messages/global-preview-ok').set({
    text: 'https://example.com/story',
    uid: 'member-user',
    timestamp: 2,
    linkPreview: {
      url: 'https://example.com/story',
      domain: 'example.com',
      title: 'Example story',
      description: 'A safe compact preview.',
    },
  })));
  await pass('global link preview rejects non-HTTPS destinations', assertFails(ref(member, 'messages/global-preview-http').set({
    text: 'unsafe preview',
    uid: 'member-user',
    timestamp: 3,
    linkPreview: { url: 'http://127.0.0.1/private', domain: '127.0.0.1', title: 'Unsafe' },
  })));
  await pass('global link preview rejects undeclared metadata fields', assertFails(ref(member, 'messages/global-preview-extra').set({
    text: 'extra preview data',
    uid: 'member-user',
    timestamp: 4,
    linkPreview: { url: 'https://example.com', domain: 'example.com', title: 'Example', image: 'https://example.com/tracker.png' },
  })));
  await pass('global poll message write by normal user', assertSucceeds(ref(member, 'messages/global-poll-ok').set({
    text: 'Vote on this',
    uid: 'member-user',
    timestamp: 10,
    poll: {
      question: 'Ship it?',
      options: {
        0: { id: 'yes', text: 'Yes' },
        1: { id: 'no', text: 'No' },
      },
    },
  })));
  await pass('global bot UID spoof denied for normal user', assertFails(ref(member, 'messages/global-bot-spoof').set({
    text: 'fake bot',
    uid: 'bot-stock-price-bot',
    timestamp: 11,
    bot: true,
  })));
  await pass('global bot-style notice allowed when owned by requester', assertSucceeds(ref(member, 'messages/global-bot-owned').set({
    text: 'stock quote',
    uid: 'member-user',
    name: 'Stock Price Bot',
    timestamp: 12,
    bot: true,
    requestedBy: 'member-user',
  })));
  await pass('global automation cannot claim another requester', assertFails(ref(member, 'messages/global-bot-requester-spoof').set({
    text: 'forged automation attribution',
    uid: 'member-user',
    timestamp: 13,
    bot: true,
    automation: true,
    requestedBy: 'outsider-user',
  })));
  await pass('global room activity separator accepts a constrained event', assertSucceeds(ref(member, 'messages/global-activity-ok').set({
    text: '',
    uid: 'member-user',
    timestamp: 14,
    automation: true,
    requestedBy: 'member-user',
    activityEvent: { type: 'poll_closed', label: 'Poll closed', detail: 'Launch date' },
  })));
  await pass('global room activity separator rejects unknown event types', assertFails(ref(member, 'messages/global-activity-bad').set({
    text: '',
    uid: 'member-user',
    timestamp: 15,
    automation: true,
    requestedBy: 'member-user',
    activityEvent: { type: 'permission_changed', label: 'Permissions changed' },
  })));
  await pass('global message owner can edit own message', assertSucceeds(ref(member, 'messages/global-ok').update({
    text: 'hello global edited',
    edited: true,
  })));
  await pass('global message cannot be rewritten by another user', assertFails(ref(outsider, 'messages/global-ok').update({
    text: 'hijacked',
  })));
  await pass('global message cannot be deleted by another user', assertFails(ref(outsider, 'messages/global-ok').remove()));
  await pass('global message reaction allowed for another signed-in user', assertSucceeds(ref(outsider, 'messages/global-ok/reactions/outsider-user/thumbs-up').set(true)));
  await pass('global message second reaction allowed for same user', assertSucceeds(ref(outsider, 'messages/global-ok/reactions/outsider-user/heart').set(true)));
  await pass('global message one reaction removable for same user', assertSucceeds(ref(outsider, 'messages/global-ok/reactions/outsider-user/thumbs-up').remove()));
  await pass('global message reaction false value denied', assertFails(ref(outsider, 'messages/global-ok/reactions/outsider-user/smirk').set(false)));
  await pass('global poll vote allowed before close', assertSucceeds(ref(outsider, 'messages/global-poll-ok/poll/votes/outsider-user').set('yes')));
  await pass('global poll close denied for non-author', assertFails(ref(outsider, 'messages/global-poll-ok/poll/closed').set(true)));
  await pass('global poll close allowed for author', assertSucceeds(ref(member, 'messages/global-poll-ok/poll/closed').set(true)));
  await pass('global poll closedAt allowed for author', assertSucceeds(ref(member, 'messages/global-poll-ok/poll/closedAt').set(99)));
  await pass('global poll vote denied after close', assertFails(ref(member, 'messages/global-poll-ok/poll/votes/member-user').set('no')));
  await pass('global channel typing allowed for self', assertSucceeds(ref(member, 'typing/global/general/member-user').set('Member')));
  await pass('global channel typing cannot spoof another user', assertFails(ref(member, 'typing/global/general/outsider-user').set('Member')));

  await pass('global message denied for banned user', assertFails(ref(banned, 'messages/global-banned').set({
    text: 'nope',
    uid: 'banned-user',
    timestamp: 2,
  })));

  await pass('global message denied for muted user', assertFails(ref(muted, 'messages/global-muted').set({
    text: 'nope',
    uid: 'muted-user',
    timestamp: 3,
  })));

  await pass('private room message denied before membership', assertFails(ref(member, 'rooms_data/private-room/messages/no-member').set({
    text: 'should fail',
    uid: 'member-user',
    timestamp: 4,
  })));
  await pass('private room channel typing denied before membership', assertFails(ref(member, 'typing/private-room/general/member-user').set('Member')));

  await pass('owner can add room member', assertSucceeds(ref(owner, 'rooms_meta/private-room/members/member-user').set(true)));
  await pass('private room channel typing allowed for member', assertSucceeds(ref(member, 'typing/private-room/general/member-user').set('Member')));
  await pass('private room channel typing remove allowed for member', assertSucceeds(ref(member, 'typing/private-room/general/member-user').remove()));
  await pass('private room message allowed for member', assertSucceeds(ref(member, 'rooms_data/private-room/messages/member-ok').set({
    text: 'hello room',
    uid: 'member-user',
    timestamp: 5,
  })));
  await pass('private room message accepts a constrained link preview', assertSucceeds(ref(member, 'rooms_data/private-room/messages/member-preview-ok').set({
    text: 'https://example.com/room',
    uid: 'member-user',
    timestamp: 5,
    linkPreview: { url: 'https://example.com/room', domain: 'example.com', title: 'Room link' },
  })));
  await pass('private room poll message allowed for member', assertSucceeds(ref(member, 'rooms_data/private-room/messages/room-poll-ok').set({
    text: 'Room poll',
    uid: 'member-user',
    timestamp: 6,
    poll: {
      question: 'Meet today?',
      options: {
        0: { id: 'yes', text: 'Yes' },
        1: { id: 'later', text: 'Later' },
      },
    },
  })));
  await pass('room channel message allowed for member', assertSucceeds(ref(member, 'rooms_data/private-room/channels/general/messages/channel-member-ok').set({
    text: 'hello channel',
    uid: 'member-user',
    timestamp: 7,
  })));
  await pass('room channel message accepts a constrained link preview', assertSucceeds(ref(member, 'rooms_data/private-room/channels/general/messages/channel-preview-ok').set({
    text: 'https://example.com/channel',
    uid: 'member-user',
    timestamp: 7,
    linkPreview: { url: 'https://example.com/channel', domain: 'example.com', title: 'Channel link' },
  })));
  await pass('room channel accepts a constrained activity separator', assertSucceeds(ref(member, 'rooms_data/private-room/channels/general/messages/channel-activity-ok').set({
    text: '',
    uid: 'member-user',
    timestamp: 8,
    automation: true,
    requestedBy: 'member-user',
    activityEvent: { type: 'poll_closed', label: 'Poll closed', detail: 'Channel poll' },
  })));
  await pass('room channel poll message allowed for member', assertSucceeds(ref(member, 'rooms_data/private-room/channels/general/messages/channel-poll-ok').set({
    text: 'Channel poll',
    uid: 'member-user',
    timestamp: 8,
    poll: {
      question: 'Use channel poll?',
      options: {
        0: { id: 'yes', text: 'Yes' },
        1: { id: 'later', text: 'Later' },
      },
    },
  })));
  await pass('room bot UID spoof denied for member', assertFails(ref(member, 'rooms_data/private-room/messages/member-bot-spoof').set({
    text: 'fake room bot',
    uid: 'minimalist-ai-agent',
    timestamp: 13,
    bot: true,
  })));
  await pass('room automation cannot claim another requester', assertFails(ref(member, 'rooms_data/private-room/messages/member-bot-requester-spoof').set({
    text: 'forged room automation attribution',
    uid: 'member-user',
    timestamp: 14,
    bot: true,
    automation: true,
    requestedBy: 'owner-user',
  })));
  await pass('room activity separator accepts a task-created event', assertSucceeds(ref(member, 'rooms_data/private-room/messages/task-activity-ok').set({
    text: '',
    uid: 'member-user',
    timestamp: 15,
    automation: true,
    requestedBy: 'member-user',
    activityEvent: { type: 'task_created', label: 'Task created', detail: 'Write launch notes' },
  })));
  await pass('room activity separator rejects undeclared fields', assertFails(ref(member, 'rooms_data/private-room/messages/task-activity-extra').set({
    text: '',
    uid: 'member-user',
    timestamp: 16,
    automation: true,
    requestedBy: 'member-user',
    activityEvent: { type: 'task_created', label: 'Task created', url: 'https://example.com' },
  })));
  await pass('room message owner can edit own message', assertSucceeds(ref(member, 'rooms_data/private-room/messages/member-ok').update({
    text: 'hello room edited',
    edited: true,
  })));
  await pass('room message cannot be rewritten by another member', assertFails(ref(owner, 'rooms_data/private-room/messages/member-ok').update({
    text: 'owner hijack',
  })));
  await pass('room message reaction allowed for room member', assertSucceeds(ref(owner, 'rooms_data/private-room/messages/member-ok/reactions/owner-user/heart').set(true)));
  await pass('room message second reaction allowed for room member', assertSucceeds(ref(owner, 'rooms_data/private-room/messages/member-ok/reactions/owner-user/thumbs-up').set(true)));
  await pass('room message reaction denied for non-member', assertFails(ref(outsider, 'rooms_data/private-room/messages/member-ok/reactions/outsider-user/heart').set(true)));
  await pass('room poll vote allowed before close', assertSucceeds(ref(owner, 'rooms_data/private-room/messages/room-poll-ok/poll/votes/owner-user').set('yes')));
  await pass('room poll close denied for non-author', assertFails(ref(owner, 'rooms_data/private-room/messages/room-poll-ok/poll/closed').set(true)));
  await pass('room poll close allowed for author', assertSucceeds(ref(member, 'rooms_data/private-room/messages/room-poll-ok/poll/closed').set(true)));
  await pass('room poll closedAt allowed for author', assertSucceeds(ref(member, 'rooms_data/private-room/messages/room-poll-ok/poll/closedAt').set(100)));
  await pass('room poll vote denied after close', assertFails(ref(member, 'rooms_data/private-room/messages/room-poll-ok/poll/votes/member-user').set('later')));
  await pass('room channel message reaction allowed for room member', assertSucceeds(ref(owner, 'rooms_data/private-room/channels/general/messages/channel-member-ok/reactions/owner-user/heart').set(true)));
  await pass('room channel message second reaction allowed for room member', assertSucceeds(ref(owner, 'rooms_data/private-room/channels/general/messages/channel-member-ok/reactions/owner-user/thumbs-up').set(true)));
  await pass('room channel message reaction denied for non-member', assertFails(ref(outsider, 'rooms_data/private-room/channels/general/messages/channel-member-ok/reactions/outsider-user/heart').set(true)));
  await pass('room channel poll vote allowed before close', assertSucceeds(ref(owner, 'rooms_data/private-room/channels/general/messages/channel-poll-ok/poll/votes/owner-user').set('yes')));
  await pass('room channel poll close denied for non-author', assertFails(ref(owner, 'rooms_data/private-room/channels/general/messages/channel-poll-ok/poll/closed').set(true)));
  await pass('room channel poll close allowed for author', assertSucceeds(ref(member, 'rooms_data/private-room/channels/general/messages/channel-poll-ok/poll/closed').set(true)));
  await pass('room channel poll closedAt allowed for author', assertSucceeds(ref(member, 'rooms_data/private-room/channels/general/messages/channel-poll-ok/poll/closedAt').set(101)));
  await pass('room channel poll vote denied after close', assertFails(ref(member, 'rooms_data/private-room/channels/general/messages/channel-poll-ok/poll/votes/member-user').set('later')));
  await pass('room owner can moderate-delete channel message', assertSucceeds(ref(owner, 'rooms_data/private-room/channels/general/messages/channel-member-ok').remove()));
  await pass('room owner can moderate-delete member message', assertSucceeds(ref(owner, 'rooms_data/private-room/messages/member-ok').remove()));
  await pass('room member cannot change server moderation policy', assertFails(
    ref(member, 'rooms_meta/private-room/moderation/enforceServer').set(true),
  ));
  await pass('room owner cannot save undeclared moderation settings', assertFails(
    ref(owner, 'rooms_meta/private-room/moderation').set({
      enabled: true,
      enforceServer: true,
      secretAction: 'delete-everything',
    }),
  ));
  await pass('room owner can configure bounded server moderation', assertSucceeds(
    ref(owner, 'rooms_meta/private-room/moderation').set({
      enabled: true,
      enforceServer: true,
      blockedTerms: 'spam, scam',
      blockLinks: true,
      blockCaps: true,
      blockFlood: true,
      maxMentions: 8,
      slowModeSeconds: 2,
      rateLimitCount: 10,
      rateLimitWindowSeconds: 10,
      repeatLimit: 2,
      repeatWindowSeconds: 60,
      updatedAt: 200,
      updatedBy: 'owner-user',
    }),
  ));
  await pass('room owner can assign an explicit moderator', assertSucceeds(
    ref(owner, 'rooms_meta/private-room/moderators/member-user').set(true),
  ));
  await pass('room owner can grant the scoped moderation permission', assertSucceeds(
    ref(owner, 'rooms_meta/private-room/memberPermissions/member-user/moderate').set(true),
  ));
  await pass('server-enforced room rejects direct client message creation', assertFails(
    ref(member, 'rooms_data/private-room/messages/direct-bypass').set({
      text: 'bypass attempt',
      uid: 'member-user',
      timestamp: 102,
    }),
  ));
  await pass('server-enforced room rejects direct channel message creation', assertFails(
    ref(member, 'rooms_data/private-room/channels/general/messages/direct-channel-bypass').set({
      text: 'channel bypass attempt',
      uid: 'member-user',
      timestamp: 103,
    }),
  ));
  await pass('server-enforced room rejects direct edits that could bypass policy', assertFails(
    ref(member, 'rooms_data/private-room/messages/member-preview-ok').update({
      text: 'edited after server enforcement',
      edited: true,
    }),
  ));
  await pass('server enforcement preserves scoped reaction writes', assertSucceeds(
    ref(member, 'rooms_data/private-room/messages/member-preview-ok/reactions/member-user/shield').set(true),
  ));
  await pass('room moderation report queue is not directly readable by members', assertFails(
    ref(member, 'room_moderation/private-room/reports').get(),
  ));
  await pass('room moderation report queue is not directly readable by owners', assertFails(
    ref(owner, 'room_moderation/private-room/reports').get(),
  ));
  await pass('room moderation report queue rejects direct client writes', assertFails(
    ref(member, 'room_moderation/private-room/reports/forged-report').set({
      reporterUid: 'member-user',
      state: { status: 'resolved' },
    }),
  ));

  await pass('member can create valid room task', assertSucceeds(ref(member, 'room_tasks/private-room/task-ok').set({
    text: 'Review mobile chat layout',
    status: 'todo',
    done: false,
    priority: 'medium',
    by: 'member-user',
    byName: 'Member',
    assignee: 'member-user',
    assigneeName: 'Member',
    createdAt: 80,
  })));
  await pass('room task unknown field denied', assertFails(ref(member, 'room_tasks/private-room/task-ok').update({
    admin: true,
  })));
  await pass('room task wrong creator denied', assertFails(ref(member, 'room_tasks/private-room/task-spoof').set({
    text: 'Spoof owner',
    status: 'todo',
    done: false,
    priority: 'medium',
    by: 'owner-user',
    createdAt: 81,
  })));

  await pass('member can create valid room doc', assertSucceeds(ref(member, 'room_docs/private-room/doc-ok').set({
    title: 'Room QA',
    content: 'Mobile-first notes',
    emoji: '📄',
    tags: {
      0: 'qa',
    },
    by: 'member-user',
    byName: 'Member',
    createdAt: 82,
    updatedAt: 82,
  })));
  await pass('room doc unknown field denied', assertFails(ref(member, 'room_docs/private-room/doc-ok').update({
    admin: true,
  })));
  await pass('room doc oversized content denied', assertFails(ref(member, 'room_docs/private-room/doc-large').set({
    title: 'Too large',
    content: 'x'.repeat(60001),
    by: 'member-user',
    createdAt: 83,
    updatedAt: 83,
  })));
  await pass('room doc wrong author denied', assertFails(ref(member, 'room_docs/private-room/doc-spoof').set({
    title: 'Spoof author',
    content: 'Nope',
    by: 'owner-user',
    createdAt: 84,
    updatedAt: 84,
  })));

  await pass('room message denied when chat permission is disabled', assertFails(ref(member, 'rooms_data/restricted-room/messages/chat-disabled').set({
    text: 'blocked by room permission',
    uid: 'member-user',
    timestamp: 51,
  })));

  await pass('owner can grant member chat override', assertSucceeds(ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/chat').set(true)));
  await pass('member chat override allows room message', assertSucceeds(ref(member, 'rooms_data/restricted-room/messages/chat-override-ok').set({
    text: 'allowed by member override',
    uid: 'member-user',
    timestamp: 52,
  })));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await ref(context.database(DATABASE_URL), 'rooms_meta/restricted-room/muted/member-user').set(Date.now() + 60_000);
  });
  await pass('room mute denies member message even with chat override', assertFails(ref(member, 'rooms_data/restricted-room/messages/room-muted').set({
    text: 'blocked by room mute',
    uid: 'member-user',
    timestamp: 53,
  })));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await ref(context.database(DATABASE_URL), 'rooms_meta/restricted-room/muted/member-user').remove();
  });

  await pass('member cannot create channel without permission', assertFails(ref(member, 'rooms_meta/restricted-room/channels/member-channel').set({
    name: 'member-channel',
    by: 'member-user',
    createdAt: 54,
  })));
  await pass('owner can grant create channel override', assertSucceeds(ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/createChannels').set(true)));
  await pass('member can create channel with override', assertSucceeds(ref(member, 'rooms_meta/restricted-room/channels/member-channel').set({
    name: 'member-channel',
    by: 'member-user',
    createdAt: 55,
  })));
  await pass('member cannot delete channel without manage override', assertFails(ref(member, 'rooms_meta/restricted-room/channels/existing').remove()));
  await pass('owner can grant manage channel override', assertSucceeds(ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/manageChannels').set(true)));
  await pass('member can delete channel with manage override', assertSucceeds(ref(member, 'rooms_meta/restricted-room/channels/existing').remove()));

  await pass('missing webhook permission defaults to deny', assertFails(ref(member, 'rooms_meta/call-room/webhook').set({
    url: 'https://example.test/default-deny',
    channelId: 'general',
    updatedAt: 55,
    updatedBy: 'member-user',
  })));
  await pass('missing bot permission defaults to deny', assertFails(ref(member, 'rooms_meta/call-room/bots').set({
    stockTracker: {
      enabled: true,
      updatedAt: 55,
      updatedBy: 'member-user',
    },
  })));
  await pass('room owner cannot read server webhook secret', assertFails(
    ref(owner, 'room_integration_secrets/call-room/webhook').get(),
  ));
  await pass('room member cannot read server webhook secret', assertFails(
    ref(member, 'room_integration_secrets/call-room/webhook').get(),
  ));
  await pass('room owner cannot write server webhook secret', assertFails(
    ref(owner, 'room_integration_secrets/call-room/webhook').set({
      url: 'https://example.test/replacement-secret',
      channelId: 'general',
    }),
  ));
  await pass('room member can read masked webhook connection status', assertSucceeds(
    ref(member, 'rooms_meta/call-room/connections/webhook').get(),
  ));
  await pass('masked webhook metadata rejects a raw URL field', assertFails(
    ref(owner, 'rooms_meta/call-room/connections/webhook/url').set('https://example.test/raw-secret'),
  ));

  await pass('member cannot update webhook without override', assertFails(ref(member, 'rooms_meta/restricted-room/webhook').set({
    url: 'https://example.test/webhook',
    channelId: 'general',
    updatedAt: 56,
    updatedBy: 'member-user',
  })));
  await pass('owner can grant legacy webhook override', assertSucceeds(ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/webhooks').set(true)));
  await pass('legacy raw webhook writes stay locked after permission override', assertFails(ref(member, 'rooms_meta/restricted-room/webhook').set({
    url: 'https://example.test/webhook',
    channelId: 'general',
    updatedAt: 57,
    updatedBy: 'member-user',
  })));
  await pass('legacy webhook override allows bot management when new key is absent', assertSucceeds(ref(member, 'rooms_meta/restricted-room/bots').set({
    autoModeration: {
      enabled: true,
      updatedAt: 58,
      updatedBy: 'member-user',
    },
  })));
  await pass('explicit manageConnections deny overrides legacy webhook allow', assertSucceeds(
    ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/manageConnections').set(false),
  ));
  await pass('member connection write denied by explicit manageConnections override', assertFails(
    ref(member, 'rooms_meta/restricted-room/webhook/channelId').set('general'),
  ));
  await pass('owner can grant manageConnections override', assertSucceeds(
    ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/manageConnections').set(true),
  ));
  await pass('member cannot bypass HTTP connection manager with manageConnections override', assertFails(
    ref(member, 'rooms_meta/restricted-room/webhook/channelId').set('general'),
  ));
  await pass('room owner cannot replace server integration instance', assertFails(
    ref(owner, 'rooms_meta/restricted-room/integrationInstanceId').set('instance-replacement-0001'),
  ));
  await pass('room owner cannot create a new raw legacy webhook', assertFails(
    ref(owner, 'rooms_meta/restricted-room/webhook').set({
      url: 'https://example.test/raw-owner-secret',
      channelId: 'general',
      updatedAt: 59,
      updatedBy: 'owner-user',
    }),
  ));
  await pass('explicit manageBots deny overrides legacy webhook allow', assertSucceeds(
    ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/manageBots').set(false),
  ));
  await pass('member bot write denied by explicit manageBots override', assertFails(
    ref(member, 'rooms_meta/restricted-room/bots/autoModeration/enabled').set(false),
  ));
  await pass('owner can grant manageBots override', assertSucceeds(
    ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/manageBots').set(true),
  ));
  await pass('member can manage known bot with manageBots override', assertSucceeds(
    ref(member, 'rooms_meta/restricted-room/bots/autoModeration/enabled').set(false),
  ));
  await pass('member can remove one installed bot without touching siblings', assertSucceeds(
    ref(member, 'rooms_meta/restricted-room/bots/autoModeration').remove(),
  ));
  await pass('unknown room bot is rejected', assertFails(
    ref(member, 'rooms_meta/restricted-room/bots/untrustedBot').set({ enabled: true }),
  ));
  await pass('room bot rejects unexpected configuration fields', assertFails(
    ref(member, 'rooms_meta/restricted-room/bots/stockTracker').set({
      enabled: true,
      unexpectedSecret: 'not allowed',
    }),
  ));
  await pass('room bot rejects oversized symbol configuration', assertFails(
    ref(member, 'rooms_meta/restricted-room/bots/stockTracker').set({
      enabled: true,
      symbols: 'A'.repeat(241),
    }),
  ));

  const completePermissionPolicy = {
    chat: false,
    files: true,
    polls: true,
    reminders: true,
    docs: true,
    whiteboard: true,
    calls: true,
    video: true,
    screenShare: true,
    invites: true,
    createChannels: false,
    manageChannels: false,
    manageBots: false,
    manageConnections: false,
    updatedAt: 100,
    updatedBy: 'owner-user',
  };
  await pass('owner can save the complete validated permission policy', assertSucceeds(
    ref(owner, 'rooms_meta/restricted-room/permissions').set(completePermissionPolicy),
  ));
  await pass('room permission policy rejects unknown fields', assertFails(
    ref(owner, 'rooms_meta/restricted-room/permissions/arbitraryPermission').set(true),
  ));
  await pass('member permission override rejects unknown fields', assertFails(
    ref(owner, 'rooms_meta/restricted-room/memberPermissions/member-user/arbitraryPermission').set(true),
  ));

  await pass('member cannot rewrite private membership row', assertFails(ref(member, 'rooms_meta/private-room/members/member-user').set({
    name: 'renamed',
  })));

  await pass('member can self-leave private room', assertSucceeds(ref(member, 'rooms_meta/private-room/members/member-user').remove()));
  await pass('member cannot message after self-leave', assertFails(ref(member, 'rooms_data/private-room/messages/after-leave').set({
    text: 'should fail',
    uid: 'member-user',
    timestamp: 6,
  })));

  await pass('outsider cannot self-join private room', assertFails(ref(outsider, 'rooms_meta/private-room/members/outsider-user').set(true)));
  await pass('outsider can self-join public room', assertSucceeds(ref(outsider, 'rooms_meta/public-room/members/outsider-user').set(true)));
  await pass('discoverable room full metadata denied to outsider', assertFails(ref(outsider, 'rooms_meta/discovery-room').get()));
  await pass('discoverable room safe preview field readable to outsider', assertSucceeds(ref(outsider, 'rooms_meta/discovery-room/name').get()));
  await pass('discoverable room members hidden from outsider', assertFails(ref(outsider, 'rooms_meta/discovery-room/members').get()));
  await pass('discoverable room webhook hidden from outsider', assertFails(ref(outsider, 'rooms_meta/discovery-room/webhook').get()));

  await pass('PM message create allowed for sender in thread', assertSucceeds(ref(member, 'private_messages/member-user_outsider-user/pm-1').set({
    uid: 'member-user',
    text: 'hello private',
    readBy: {
      'member-user': 70,
    },
    timestamp: 70,
  })));
  await pass('PM message cannot be rewritten by sender after delivery', assertFails(ref(member, 'private_messages/member-user_outsider-user/pm-1').update({
    text: 'rewritten later',
  })));
  await pass('PM message cannot be rewritten by recipient', assertFails(ref(outsider, 'private_messages/member-user_outsider-user/pm-1').update({
    text: 'recipient rewrite',
  })));
  await pass('PM read receipt allowed for recipient', assertSucceeds(ref(outsider, 'private_messages/member-user_outsider-user/pm-1/readBy/outsider-user').set(71)));
  await pass('PM room invite shape allowed for sender', assertSucceeds(ref(member, 'private_messages/member-user_outsider-user/pm-invite').set({
    uid: 'member-user',
    text: 'Room invite: Private\nhttps://example.test/join/CODE',
    type: 'room_invite',
    roomId: 'private-room',
    roomName: 'Private',
    inviteLink: 'https://example.test/join/CODE',
    readBy: {
      'member-user': 72,
    },
    timestamp: 72,
  })));
  await pass('structured PM call history event allowed for its thread', assertSucceeds(ref(member, 'private_messages/member-user_outsider-user/pm-call').set({
    uid: 'member-user',
    text: 'Voice call',
    type: 'direct_call',
    roomId: 'member-user_outsider-user',
    callCreatedAt: Date.now(),
    readBy: {
      'member-user': 72,
    },
    timestamp: 72,
  })));
  await pass('structured PM call event cannot point at another thread', assertFails(ref(member, 'private_messages/member-user_outsider-user/pm-call-spoof').set({
    uid: 'member-user',
    text: 'Voice call',
    type: 'direct_call',
    roomId: 'owner-user_member-user',
    callCreatedAt: Date.now(),
    readBy: {
      'member-user': 72,
    },
    timestamp: 72,
  })));
  await pass('PM unknown fields denied', assertFails(ref(member, 'private_messages/member-user_outsider-user/pm-bad').set({
    uid: 'member-user',
    text: 'bad shape',
    readBy: {
      'member-user': 73,
    },
    timestamp: 73,
    admin: true,
  })));
  await pass('recipient inbox write denied to sender client', assertFails(ref(member, 'inbox/outsider-user/member-user').set({
    fromName: 'Member',
    senderUid: 'member-user',
    timestamp: 74,
    lastText: 'unsolicited',
    read: false,
  })));
  await pass('own inbox mirror write allowed for signed-in user', assertSucceeds(ref(member, 'inbox/member-user/outsider-user').set({
    fromName: 'Outsider',
    senderUid: 'outsider-user',
    timestamp: 75,
    lastText: 'local mirror',
    read: true,
  })));
  await pass('cross-user notification write denied to sender client', assertFails(ref(member, 'notifications/outsider-user/spam').set({
    type: 'mention',
    text: 'unsolicited notification',
    senderUid: 'member-user',
    timestamp: 76,
  })));
  await pass('own notification client create denied', assertFails(ref(member, 'notifications/member-user/new-note').set({
    type: 'mention',
    text: 'self-created notification',
    senderUid: 'member-user',
    timestamp: 77,
  })));
  await pass('own notification delete allowed', assertSucceeds(ref(member, 'notifications/member-user/existing-note').remove()));
  await pass('own push token child write allowed', assertSucceeds(ref(member, 'push_tokens/member-user/device-token').set({
    token: 'a'.repeat(40),
    updatedAt: 78,
    userAgent: 'Rules smoke',
    platform: 'test',
  })));
  await pass('own push token whole-subtree overwrite denied', assertFails(ref(member, 'push_tokens/member-user').set({
    secondDevice: {
      token: 'b'.repeat(40),
      updatedAt: 79,
    },
  })));
  await pass('own push token whole-subtree delete allowed', assertSucceeds(ref(member, 'push_tokens/member-user').remove()));
  await pass('cross-user push token delete denied', assertFails(ref(member, 'push_tokens/outsider-user').remove()));

  const directCallPath = 'pm_calls/member-user_outsider-user';
  const directCallCreatedAt = Date.now();
  const farFutureCallAt = Date.now() + 120_000;
  const oneSidedFriendCallAt = Date.now();
  const oneSidedFriendCall = {
    status: 'ringing',
    type: 'voice',
    roomId: 'banned-user_member-user',
    hostUid: 'member-user',
    callerUid: 'member-user',
    callerName: 'Member',
    callerPhotoUrl: '',
    calleeUid: 'banned-user',
    calleeName: 'Banned',
    calleePhotoUrl: '',
    createdAt: oneSidedFriendCallAt,
    expiresAt: oneSidedFriendCallAt + 35_000,
    participants: {
      'member-user': {
        uid: 'member-user',
        name: 'Member',
        photoUrl: '',
        joinedAt: oneSidedFriendCallAt,
        lastSeen: oneSidedFriendCallAt,
        micOn: true,
      },
    },
  };
  await pass('PM call creation requires reciprocal accepted friendship', assertFails(
    ref(member, 'pm_calls/banned-user_member-user').set(oneSidedFriendCall),
  ));
  await pass('PM call friendship cannot be bypassed with atomic child writes', assertFails(member.ref().update(
    Object.fromEntries(Object.entries(oneSidedFriendCall).map(([field, value]) => [
      `pm_calls/banned-user_member-user/${field}`,
      value,
    ])),
  )));
  await pass('PM call creation rejects far-future ringing timestamps', assertFails(ref(member, 'pm_calls/member-user_owner-user').set({
    status: 'ringing',
    type: 'voice',
    roomId: 'member-user_owner-user',
    hostUid: 'member-user',
    callerUid: 'member-user',
    callerName: 'Member',
    callerPhotoUrl: '',
    calleeUid: 'owner-user',
    calleeName: 'Owner',
    calleePhotoUrl: '',
    createdAt: farFutureCallAt,
    expiresAt: farFutureCallAt + 35_000,
    participants: {
      'member-user': {
        uid: 'member-user',
        name: 'Member',
        photoUrl: '',
        joinedAt: farFutureCallAt,
        lastSeen: farFutureCallAt,
        micOn: true,
      },
    },
  })));
  const expiringCallAt = Date.now();
  await pass('short PM call can be created for expiry enforcement', assertSucceeds(ref(member, 'pm_calls/member-user_owner-user').set({
    status: 'ringing',
    type: 'voice',
    roomId: 'member-user_owner-user',
    hostUid: 'member-user',
    callerUid: 'member-user',
    callerName: 'Member',
    callerPhotoUrl: '',
    calleeUid: 'owner-user',
    calleeName: 'Owner',
    calleePhotoUrl: '',
    createdAt: expiringCallAt,
    expiresAt: expiringCallAt + 2_000,
    participants: {
      'member-user': {
        uid: 'member-user',
        name: 'Member',
        photoUrl: '',
        joinedAt: expiringCallAt,
        lastSeen: expiringCallAt,
        micOn: true,
      },
    },
  })));
  await new Promise((resolve) => setTimeout(resolve, 2_150));
  await pass('callee cannot accept an expired PM call', assertFails(ref(owner, 'pm_calls/member-user_owner-user/status').set('active')));
  await pass('either participant can clean up an expired ringing call', assertSucceeds(ref(owner, 'pm_calls/member-user_owner-user').remove()));
  const removedFriendCallAt = Date.now();
  await pass('reciprocal friends can create a ringing call before friendship removal', assertSucceeds(ref(member, 'pm_calls/member-user_owner-user').set({
    status: 'ringing',
    type: 'voice',
    roomId: 'member-user_owner-user',
    hostUid: 'member-user',
    callerUid: 'member-user',
    callerName: 'Member',
    callerPhotoUrl: '',
    calleeUid: 'owner-user',
    calleeName: 'Owner',
    calleePhotoUrl: '',
    createdAt: removedFriendCallAt,
    expiresAt: removedFriendCallAt + 35_000,
    participants: {
      'member-user': {
        uid: 'member-user',
        name: 'Member',
        photoUrl: '',
        joinedAt: removedFriendCallAt,
        lastSeen: removedFriendCallAt,
        micOn: true,
      },
    },
  })));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.database(DATABASE_URL);
    await ref(admin, 'friends/member-user/owner-user').remove();
    await ref(admin, 'friends/owner-user/member-user').remove();
  });
  await pass('callee cannot accept a ringing PM call after reciprocal friendship is removed', assertFails(
    ref(owner, 'pm_calls/member-user_owner-user/status').set('active'),
  ));
  await pass('caller can terminate a ringing PM call after friendship is removed', assertSucceeds(
    ref(member, 'pm_calls/member-user_owner-user').update({ status: 'cancelled', endedAt: Date.now() }),
  ));
  await pass('either participant can clean up terminal PM call state after unfriend', assertSucceeds(
    ref(owner, 'pm_calls/member-user_owner-user').remove(),
  ));
  await pass('PM caller can create a constrained ringing call', assertSucceeds(ref(member, directCallPath).set({
    status: 'ringing',
    type: 'voice',
    roomId: 'member-user_outsider-user',
    hostUid: 'member-user',
    callerUid: 'member-user',
    callerName: 'Member',
    callerPhotoUrl: '',
    calleeUid: 'outsider-user',
    calleeName: 'Outsider',
    calleePhotoUrl: '',
    createdAt: directCallCreatedAt,
    expiresAt: directCallCreatedAt + 35_000,
    participants: {
      'member-user': {
        uid: 'member-user',
        name: 'Member',
        photoUrl: '',
        joinedAt: directCallCreatedAt,
        lastSeen: directCallCreatedAt,
        micOn: true,
      },
    },
  })));
  await pass('third party cannot read a PM call', assertFails(ref(owner, directCallPath).get()));
  await pass('caller cannot spoof callee participant', assertFails(ref(member, `${directCallPath}/participants/outsider-user`).set({
    uid: 'outsider-user',
    name: 'Outsider',
    photoUrl: '',
    joinedAt: 81,
    lastSeen: 81,
    micOn: true,
  })));
  await pass('caller cannot accept their own outgoing PM call', assertFails(ref(member, `${directCallPath}/status`).set('active')));
  await pass('callee cannot cancel caller-owned ringing call', assertFails(ref(outsider, `${directCallPath}/status`).set('cancelled')));
  await pass('callee can accept and add only their participant', assertSucceeds(ref(outsider, directCallPath).update({
    status: 'active',
    acceptedAt: 82,
    startedAt: 82,
    'participants/outsider-user': {
      uid: 'outsider-user',
      name: 'Outsider',
      photoUrl: '',
      joinedAt: 82,
      lastSeen: 82,
      micOn: true,
    },
  })));
  await pass('PM participant cannot add undeclared privilege fields', assertFails(ref(member, `${directCallPath}/participants/member-user`).update({
    admin: true,
    lastSeen: 83,
  })));
  await pass('accepted PM participant can signal the other participant', assertSucceeds(ref(member, `${directCallPath}/signals/outsider-user/signal-1`).set({
    from: 'member-user',
    kind: 'cand',
    cand: {
      candidate: 'candidate:1 1 UDP 1 127.0.0.1 9000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    },
    ts: 83,
  })));
  await pass('PM signaling rejects undeclared payload fields', assertFails(ref(member, `${directCallPath}/signals/outsider-user/signal-extra`).set({
    from: 'member-user',
    kind: 'cand',
    cand: {
      candidate: 'candidate:2 1 UDP 1 127.0.0.1 9001 typ host',
    },
    ts: 84,
    extra: true,
  })));
  await pass('third party cannot inject PM call signaling', assertFails(ref(owner, `${directCallPath}/signals/member-user/signal-bad`).set({
    from: 'owner-user',
    kind: 'cand',
    cand: {
      candidate: 'candidate:bad',
    },
    ts: 84,
  })));
  await pass('callee can end an accepted PM call', assertSucceeds(ref(outsider, directCallPath).update({
    status: 'ended',
    endedAt: 85,
  })));
  const replacementCallAt = Date.now();
  await pass('either participant can replace terminal PM call state with a new call', assertSucceeds(ref(outsider, directCallPath).set({
    status: 'ringing',
    type: 'voice',
    roomId: 'member-user_outsider-user',
    hostUid: 'outsider-user',
    callerUid: 'outsider-user',
    callerName: 'Outsider',
    callerPhotoUrl: '',
    calleeUid: 'member-user',
    calleeName: 'Member',
    calleePhotoUrl: '',
    createdAt: replacementCallAt,
    expiresAt: replacementCallAt + 35_000,
    participants: {
      'outsider-user': {
        uid: 'outsider-user',
        name: 'Outsider',
        photoUrl: '',
        joinedAt: replacementCallAt,
        lastSeen: replacementCallAt,
        micOn: true,
      },
    },
  })));
  await pass('callee cannot delete a live ringing PM call', assertFails(ref(member, directCallPath).remove()));
  await pass('replacement caller can cancel ringing call', assertSucceeds(ref(outsider, directCallPath).update({
    status: 'cancelled',
    endedAt: Date.now(),
  })));
  await pass('either participant can clean up terminal PM call state', assertSucceeds(ref(member, directCallPath).remove()));

  await pass('member can start voice call when calls are enabled', assertSucceeds(ref(member, 'room_calls/call-room').update({
    status: 'active',
    roomId: 'call-room',
    type: 'voice',
    hostUid: 'member-user',
    hostName: 'Member',
    startedAt: 20,
  })));
  await pass('member can join voice call participant list', assertSucceeds(ref(member, 'room_calls/call-room/participants/member-user').set({
    uid: 'member-user',
    name: 'Member',
    photoUrl: '',
    micOn: true,
    camOn: false,
    screenOn: false,
    joinedAt: 21,
    lastSeen: 21,
  })));
  await pass('member cannot upgrade call to video without video permission', assertFails(ref(member, 'room_calls/call-room/type').set('video')));
  await pass('member cannot set camera on without video permission', assertFails(ref(member, 'room_calls/call-room/participants/member-user').update({
    camOn: true,
    lastSeen: 22,
  })));
  await pass('member cannot screen share without screenShare permission', assertFails(ref(member, 'room_calls/call-room/participants/member-user').update({
    screenOn: true,
    screenStreamId: 'screen-stream',
    lastSeen: 23,
  })));
  await pass('owner can grant video and screen-share member overrides', assertSucceeds(
    ref(owner, 'rooms_meta/call-room/memberPermissions/member-user').update({
      video: true,
      screenShare: true,
    }),
  ));
  await pass('video override can allow video when the room default denies it', assertSucceeds(
    ref(member, 'room_calls/call-room/type').set('video'),
  ));
  await pass('video override can allow camera state when the room default denies it', assertSucceeds(
    ref(member, 'room_calls/call-room/participants/member-user').update({
      camOn: true,
      lastSeen: 24,
    }),
  ));
  await pass('screen-share override can allow sharing when the room default denies it', assertSucceeds(
    ref(member, 'room_calls/call-room/participants/member-user').update({
      screenOn: true,
      screenStreamId: 'screen-stream',
      lastSeen: 25,
    }),
  ));

  await pass('room invite create allowed for owner', assertSucceeds(ref(owner, 'room_invites/CODE123').set({
    roomId: 'private-room',
    inviterUid: 'owner-user',
    createdAt: 10,
  })));

  await pass('room invite refresh allowed for same inviter and room', assertSucceeds(ref(owner, 'room_invites/CODE123').set({
    roomId: 'private-room',
    inviterUid: 'owner-user',
    createdAt: 11,
  })));

  await pass('room invite cannot be retargeted by same inviter', assertFails(ref(owner, 'room_invites/CODE123').set({
    roomId: 'public-room',
    inviterUid: 'owner-user',
    createdAt: 12,
  })));

  await pass('room member can write a legacy-compatible activity log', assertSucceeds(
    ref(member, 'rooms_meta/validation-room/logs/legacy-log').set({
      text: 'Member joined the room.',
      timestamp: 100,
    }),
  ));
  await pass('room member can write a structured activity log', assertSucceeds(
    ref(member, 'rooms_meta/validation-room/logs/structured-log').set({
      eventCode: 'member_joined',
      eventVersion: 1,
      eventArgs: { actor: 'Member' },
      text: 'Member joined the room.',
      timestamp: 101,
    }),
  ));
  await pass('room activity rejects unknown event codes', assertFails(
    ref(member, 'rooms_meta/validation-room/logs/unknown-event').set({
      eventCode: 'made_up',
      eventVersion: 1,
      eventArgs: { actor: 'Member' },
      text: 'Made up event.',
      timestamp: 102,
    }),
  ));
  await pass('room activity rejects undeclared fields', assertFails(
    ref(member, 'rooms_meta/validation-room/logs/extra-field').set({
      text: 'Unexpected field.',
      timestamp: 103,
      secret: 'not allowed',
    }),
  ));

  await pass('user can write bounded presence state', assertSucceeds(
    ref(member, 'presence/member-user').set({ state: 'online', lastChanged: 200 }),
  ));
  await pass('presence rejects unsupported state', assertFails(
    ref(member, 'presence/member-user').set({ state: 'busy', lastChanged: 201 }),
  ));
  await pass('presence rejects undeclared fields', assertFails(
    ref(member, 'presence/member-user').set({ state: 'offline', lastChanged: 202, device: 'hidden' }),
  ));

  await pass('user can save a bounded room preference', assertSucceeds(
    ref(member, 'user_room_preferences/member-user/validation-room').set({ favorite: true, favoriteAt: 300, updatedAt: 300 }),
  ));
  await pass('room preference rejects undeclared fields', assertFails(
    ref(member, 'user_room_preferences/member-user/validation-room').update({ label: 'overshared' }),
  ));

  await pass('member can persist a bounded per-channel read cursor', assertSucceeds(
    ref(member, 'user_room_state/member-user/validation-room/channels/general').set({
      lastReadMessageId: 'message-100',
      lastReadAt: 400,
      markedUnreadMessageId: 'message-090',
      markedUnreadAt: 350,
    }),
  ));
  await pass('read cursor rejects undeclared client fields', assertFails(
    ref(member, 'user_room_state/member-user/validation-room/channels/general').update({
      hiddenMessageIds: { secret: true },
    }),
  ));
  await pass('outsider cannot write a cursor for a private room', assertFails(
    ref(outsider, 'user_room_state/outsider-user/validation-room/channels/general').set({
      lastReadAt: 401,
    }),
  ));
  await pass('user cannot read another account read cursor', assertFails(
    ref(owner, 'user_room_state/member-user/validation-room').get(),
  ));

  await pass('member can follow and mark a private-room thread read', assertSucceeds(
    ref(member, 'thread_follows/member-user/validation-room/general/message-100').set({
      followed: true,
      followedAt: 410,
    }),
  ));
  await pass('member can save the private-room thread read time', assertSucceeds(
    ref(member, 'thread_reads/member-user/validation-room/general/message-100').set(411),
  ));
  await pass('thread follow rejects undeclared fields', assertFails(
    ref(member, 'thread_follows/member-user/validation-room/general/message-101').set({
      followed: true,
      followedAt: 412,
      notifyEveryone: true,
    }),
  ));
  await pass('outsider cannot follow a private-room thread', assertFails(
    ref(outsider, 'thread_follows/outsider-user/validation-room/general/message-100').set({
      followed: true,
      followedAt: 413,
    }),
  ));

  await pass('owner can create an announcement channel with a moderator posting role', assertSucceeds(
    ref(owner, 'rooms_meta/validation-room/channels/announcements').set({
      name: 'announcements',
      by: 'owner-user',
      createdAt: 420,
      mode: 'announcements',
      postRole: 'moderator',
    }),
  ));
  await pass('channel rejects unsupported modes', assertFails(
    ref(owner, 'rooms_meta/validation-room/channels/unsafe-mode').set({
      name: 'unsafe-mode',
      by: 'owner-user',
      createdAt: 421,
      mode: 'broadcast-everything',
    }),
  ));
  await pass('regular member cannot bypass announcement posting role via RTDB', assertFails(
    ref(member, 'rooms_data/validation-room/channels/announcements/messages/member-announcement').set({
      text: 'Bypass attempt',
      uid: 'member-user',
      timestamp: 422,
    }),
  ));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.database(DATABASE_URL);
    await ref(admin, 'rooms_meta/validation-room/moderators/member-user').set(true);
  });
  await pass('room moderator can post in an announcement channel', assertSucceeds(
    ref(member, 'rooms_data/validation-room/channels/announcements/messages/moderator-announcement').set({
      text: 'Moderator update',
      uid: 'member-user',
      timestamp: 423,
    }),
  ));

  await pass('owner can create an event for member RSVP coverage', assertSucceeds(
    ref(owner, 'rooms_meta/validation-room/events/event-1').set({
      title: 'Launch review',
      date: '2026-07-24',
      time: '10:00',
      timezone: 'America/Los_Angeles',
      createdAt: 430,
      createdBy: 'owner-user',
    }),
  ));
  await pass('member can RSVP to a room event', assertSucceeds(
    ref(member, 'rooms_meta/validation-room/events/event-1/rsvps/member-user').set({
      name: 'Member',
      status: 'going',
      updatedAt: 431,
    }),
  ));
  await pass('event RSVP rejects unsupported status', assertFails(
    ref(member, 'rooms_meta/validation-room/events/event-1/rsvps/member-user').update({
      status: 'invited-everyone',
      updatedAt: 432,
    }),
  ));
  await pass('outsider cannot RSVP to a private room event', assertFails(
    ref(outsider, 'rooms_meta/validation-room/events/event-1/rsvps/outsider-user').set({
      name: 'Outsider',
      status: 'going',
      updatedAt: 433,
    }),
  ));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.database(DATABASE_URL);
    await ref(admin, 'user_scheduled_messages/member-user/scheduled-1').set({
      text: 'Server projection',
      roomId: 'validation-room',
      channelId: 'general',
      deliverAt: 500,
      status: 'pending',
    });
    await ref(admin, 'scheduled_room_messages/validation-room/scheduled-1').set({
      ownerUid: 'member-user',
      text: 'Server-only body',
    });
    await ref(admin, 'rooms_data/validation-room/messages/expired-poll').set({
      text: 'Expired poll',
      uid: 'member-user',
      timestamp: 434,
      poll: {
        question: 'Too late?',
        options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }],
        closesAt: Date.now() - 1,
      },
    });
  });
  await pass('user can read the server-owned scheduled message projection', assertSucceeds(
    ref(member, 'user_scheduled_messages/member-user').get(),
  ));
  await pass('client cannot forge a scheduled message projection', assertFails(
    ref(member, 'user_scheduled_messages/member-user/forged').set({
      text: 'Forged',
      status: 'pending',
      deliverAt: 501,
    }),
  ));
  await pass('other users cannot read a scheduled message projection', assertFails(
    ref(owner, 'user_scheduled_messages/member-user').get(),
  ));
  await pass('clients cannot read server scheduled message bodies', assertFails(
    ref(member, 'scheduled_room_messages/validation-room/scheduled-1').get(),
  ));
  await pass('poll vote is denied after its scheduled close time', assertFails(
    ref(member, 'rooms_data/validation-room/messages/expired-poll/poll/votes/member-user').set('yes'),
  ));

  await pass('user can save a bounded reminder', assertSucceeds(
    ref(member, 'user_reminders/member-user/reminder-1').set({
      text: 'Review the launch plan',
      dueAt: 500,
      roomId: 'validation-room',
      createdAt: 400,
      source: 'chat',
    }),
  ));
  await pass('reminder rejects oversized text', assertFails(
    ref(member, 'user_reminders/member-user/reminder-2').set({
      text: 'x'.repeat(181),
      dueAt: 500,
      roomId: 'validation-room',
      createdAt: 400,
      source: 'chat',
    }),
  ));

  await pass('user can reserve bounded upload usage', assertSucceeds(
    ref(member, 'upload_usage/member-user/2026-07-22').set(1024),
  ));
  await pass('upload usage rejects negative bytes', assertFails(
    ref(member, 'upload_usage/member-user/2026-07-22').set(-1),
  ));
  await pass('upload usage rejects values above the safety ceiling', assertFails(
    ref(member, 'upload_usage/member-user/2026-07-22').set(21474836481),
  ));

  console.log('\nRTDB rules smoke tests passed.');
} finally {
  await testEnv.cleanup();
}
