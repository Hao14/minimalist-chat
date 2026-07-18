const CATEGORY_DEFINITIONS = [
  {
    id: 'communication',
    label: 'Communication',
    icon: 'ph-chats',
    description: 'Messaging and room sharing.',
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    icon: 'ph-shapes',
    description: 'Shared docs and whiteboards.',
  },
  {
    id: 'calls',
    label: 'Calls & sharing',
    icon: 'ph-phone-call',
    description: 'Voice, video, and screen share.',
  },
  {
    id: 'membership',
    label: 'Membership & channels',
    icon: 'ph-users-three',
    description: 'Invites and room channels.',
  },
  {
    id: 'administration',
    label: 'Room administration',
    icon: 'ph-sliders-horizontal',
    description: 'Manage channels, apps, and connections.',
  },
];

const PERMISSION_DEFINITIONS = [
  {
    key: 'chat',
    label: 'Chat',
    category: 'communication',
    icon: 'ph-chat-circle-text',
    description: 'Send messages in this room.',
    defaultValue: true,
  },
  {
    key: 'files',
    label: 'Files',
    category: 'communication',
    icon: 'ph-paperclip',
    description: 'Upload files to room conversations.',
    defaultValue: true,
  },
  {
    key: 'polls',
    label: 'Polls',
    category: 'communication',
    icon: 'ph-chart-bar',
    description: 'Create polls for room members.',
    defaultValue: true,
  },
  {
    key: 'reminders',
    label: 'Reminders',
    category: 'communication',
    icon: 'ph-alarm',
    description: 'Create shared room reminders.',
    defaultValue: true,
  },
  {
    key: 'docs',
    label: 'Docs',
    category: 'collaboration',
    icon: 'ph-file-text',
    description: 'Create and edit room documents.',
    defaultValue: true,
  },
  {
    key: 'whiteboard',
    label: 'Whiteboard',
    category: 'collaboration',
    icon: 'ph-palette',
    description: 'Use the shared room whiteboard.',
    defaultValue: true,
  },
  {
    key: 'calls',
    label: 'Voice calls',
    category: 'calls',
    icon: 'ph-phone-call',
    description: 'Join voice calls in this room.',
    defaultValue: true,
  },
  {
    key: 'video',
    label: 'Video calls',
    category: 'calls',
    icon: 'ph-video-camera',
    description: 'Use a camera in room calls when the room plan supports video.',
    defaultValue: true,
  },
  {
    key: 'screenShare',
    label: 'Screen share',
    category: 'calls',
    icon: 'ph-monitor-arrow-up',
    description: 'Share a screen in calls when the room plan supports it.',
    defaultValue: true,
  },
  {
    key: 'invites',
    label: 'Invites',
    category: 'membership',
    icon: 'ph-user-plus',
    description: 'Invite people to this room.',
    defaultValue: true,
  },
  {
    key: 'createChannels',
    label: 'Create channels',
    category: 'membership',
    icon: 'ph-plus',
    description: 'Create new channels in this room.',
    defaultValue: true,
  },
  {
    key: 'manageChannels',
    label: 'Manage channels',
    category: 'administration',
    icon: 'ph-hash',
    description: 'Delete and administer room channels.',
    defaultValue: false,
  },
  {
    key: 'manageBots',
    label: 'Manage apps',
    category: 'administration',
    icon: 'ph-cpu',
    description: 'Install, configure, and remove room apps and bots.',
    defaultValue: false,
  },
  {
    key: 'manageConnections',
    label: 'Manage connections',
    category: 'administration',
    icon: 'ph-plugs-connected',
    description: 'Configure external room connections such as webhooks and calendars.',
    defaultValue: false,
  },
];

function permissionInputIdFromKey(key) {
  return `perm-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export const ROOM_PERMISSION_DEFINITIONS = Object.freeze(
  PERMISSION_DEFINITIONS.map((definition) => Object.freeze({
    ...definition,
    inputId: permissionInputIdFromKey(definition.key),
  })),
);

export const ROOM_PERMISSION_KEYS = Object.freeze(
  ROOM_PERMISSION_DEFINITIONS.map(({ key }) => key),
);

export const ROOM_PERMISSION_REGISTRY = Object.freeze(
  Object.fromEntries(ROOM_PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition])),
);

export const ROOM_PERMISSION_LABELS = Object.freeze(
  Object.fromEntries(ROOM_PERMISSION_DEFINITIONS.map(({ key, label }) => [key, label])),
);

export const ROOM_PERMISSION_DEFAULTS = Object.freeze(
  Object.fromEntries(ROOM_PERMISSION_DEFINITIONS.map(({ key, defaultValue }) => [key, defaultValue])),
);

export const ROOM_PERMISSION_CATEGORIES = Object.freeze(
  CATEGORY_DEFINITIONS.map((category) => {
    const keys = Object.freeze(
      ROOM_PERMISSION_DEFINITIONS
        .filter((permission) => permission.category === category.id)
        .map(({ key }) => key),
    );

    return Object.freeze({ ...category, keys, permissionKeys: keys });
  }),
);

export const LEGACY_WEBHOOK_PERMISSION_KEY = 'webhooks';
export const LEGACY_WEBHOOK_FALLBACK_KEYS = Object.freeze(['manageBots', 'manageConnections']);

const ROOM_PERMISSION_KEY_SET = new Set(ROOM_PERMISSION_KEYS);
const LEGACY_WEBHOOK_FALLBACK_KEY_SET = new Set(LEGACY_WEBHOOK_FALLBACK_KEYS);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function asPermissionRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function isRoomPermissionKey(key) {
  return ROOM_PERMISSION_KEY_SET.has(key);
}

export function permissionInputId(key) {
  return ROOM_PERMISSION_REGISTRY[key]?.inputId || '';
}

export function legacyWebhookPermissionFallback(values, key) {
  const source = asPermissionRecord(values);
  if (!LEGACY_WEBHOOK_FALLBACK_KEY_SET.has(key) || !hasOwn(source, LEGACY_WEBHOOK_PERMISSION_KEY)) {
    return undefined;
  }
  return source[LEGACY_WEBHOOK_PERMISSION_KEY] === true;
}

/**
 * Reads an explicit sparse value. `undefined` means the permission is inherited.
 * Older rooms stored one `webhooks` value, which maps to both newer management keys.
 */
export function readPermissionOverride(overrides, key) {
  if (!isRoomPermissionKey(key)) return undefined;
  const source = asPermissionRecord(overrides);
  if (hasOwn(source, key)) return source[key] !== false;
  return legacyWebhookPermissionFallback(source, key);
}

export function permissionEnabled(permissions, key) {
  if (!isRoomPermissionKey(key)) return false;
  return readPermissionOverride(permissions, key) ?? ROOM_PERMISSION_DEFAULTS[key];
}

export function effectivePermissionEnabled(permissions, memberOverrides, key) {
  const memberValue = readPermissionOverride(memberOverrides, key);
  return memberValue ?? permissionEnabled(permissions, key);
}

export function effectiveMemberPermissionEnabled(roomData, key, uid) {
  const room = asPermissionRecord(roomData);
  const overridesByMember = asPermissionRecord(room.memberPermissions);
  const memberOverrides = uid ? overridesByMember[uid] : undefined;
  return effectivePermissionEnabled(room.permissions, memberOverrides, key);
}

export function effectivePermissionMap(permissions, memberOverrides) {
  return Object.fromEntries(
    ROOM_PERMISSION_KEYS.map((key) => [
      key,
      effectivePermissionEnabled(permissions, memberOverrides, key),
    ]),
  );
}

/**
 * Keeps only recognized explicit overrides and migrates the legacy `webhooks`
 * fallback into the two permissions it represented. Missing keys stay inherited.
 */
export function normalizeSparsePermissionOverrides(overrides) {
  const normalized = {};
  ROOM_PERMISSION_KEYS.forEach((key) => {
    const value = readPermissionOverride(overrides, key);
    if (value !== undefined) normalized[key] = value;
  });
  return normalized;
}

export function permissionSummary(permissions, memberOverrides) {
  const effective = effectivePermissionMap(permissions, memberOverrides);
  return ROOM_PERMISSION_KEYS.reduce((summary, key) => {
    if (effective[key]) summary.allowed += 1;
    else summary.restricted += 1;
    return summary;
  }, { allowed: 0, restricted: 0 });
}
