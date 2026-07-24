const NOTIFICATION_LABELS = Object.freeze({
  all: 'All notifications',
  mentions: 'Mentions',
  muted: 'Muted',
  digest: 'Digest',
});

export function roomPurpose(roomId, room = {}) {
  const purpose = String(room.topic || room.description || '').replace(/\s+/g, ' ').trim();
  if (purpose) return purpose.slice(0, 180);
  if (roomId === 'global') return 'A shared place for the whole community.';
  return 'Room purpose not set yet.';
}

export function roomPrivacyLabel(roomId, room = {}) {
  if (roomId === 'global' || room.public === true) return 'Public';
  if (room.discovery?.enabled === true) return 'Discoverable';
  return 'Private';
}

export function notificationModeLabel(mode = 'all', dnd = false) {
  if (dnd) return 'Do not disturb';
  return NOTIFICATION_LABELS[mode] || NOTIFICATION_LABELS.all;
}

export function countOnlineRoomMembers(roomId, members = {}, presence = {}) {
  const memberIds = roomId === 'global' ? null : new Set(Object.keys(members || {}));
  return Object.entries(presence || {}).reduce((count, [uid, status]) => {
    if (status?.state !== 'online') return count;
    if (memberIds && !memberIds.has(uid)) return count;
    return count + 1;
  }, 0);
}

export function buildRoomHeaderDetails(roomId, room = {}, presence = {}, notificationMode = 'all', dnd = false) {
  return {
    purpose: roomPurpose(roomId, room),
    privacy: roomPrivacyLabel(roomId, room),
    onlineCount: countOnlineRoomMembers(roomId, room.members, presence),
    notification: notificationModeLabel(notificationMode, dnd),
  };
}
