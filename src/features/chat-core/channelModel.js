export const CHANNEL_MODES = Object.freeze([
  Object.freeze({ id: 'chat', label: 'Chat', icon: 'ph-chats-circle' }),
  Object.freeze({ id: 'announcements', label: 'Announcements', icon: 'ph-megaphone' }),
  Object.freeze({ id: 'help', label: 'Help queue', icon: 'ph-lifebuoy' }),
]);

const channelModeIds = new Set(CHANNEL_MODES.map(({ id }) => id));

export function normalizeChannelMode(value) {
  const mode = String(value || 'chat').trim().toLowerCase();
  return channelModeIds.has(mode) ? mode : 'chat';
}

export function normalizeChannel(channelId, value = {}) {
  const id = String(channelId || value.id || 'general');
  return {
    id,
    name: String(value.name || id),
    mode: normalizeChannelMode(value.mode),
    postRole: String(value.postRole || ''),
  };
}

export function canPostToChannel(channel = {}, { uid = '', creatorId = '', role = '' } = {}) {
  const normalized = normalizeChannel(channel.id, channel);
  if (normalized.mode !== 'announcements' && !normalized.postRole) return true;
  if (uid && uid === creatorId) return true;
  if (role === 'owner' || role === 'admin' || role === 'moderator') return true;
  return Boolean(normalized.postRole && role === normalized.postRole);
}
