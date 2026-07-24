const DEFAULT_CHANNEL_ID = 'general';

export function normalizedReadChannelId(channelId = DEFAULT_CHANNEL_ID) {
  return String(channelId || DEFAULT_CHANNEL_ID).trim() || DEFAULT_CHANNEL_ID;
}

export function readStatePath(uid, roomId, channelId = DEFAULT_CHANNEL_ID) {
  const safeUid = String(uid || '').trim();
  const safeRoomId = String(roomId || '').trim();
  if (!safeUid || !safeRoomId) return '';
  return `user_room_state/${safeUid}/${safeRoomId}/channels/${normalizedReadChannelId(channelId)}`;
}

export function normalizeReadState(value = {}) {
  return {
    lastReadMessageId: String(value?.lastReadMessageId || ''),
    lastReadAt: Math.max(0, Number(value?.lastReadAt || 0)),
    markedUnreadMessageId: String(value?.markedUnreadMessageId || ''),
    markedUnreadAt: Math.max(0, Number(value?.markedUnreadAt || 0)),
  };
}

function isUnreadMessage(message, state, viewerUid) {
  if (!message?.id || message.uid === viewerUid) return false;
  if (state.markedUnreadMessageId) {
    return String(message.id) >= state.markedUnreadMessageId;
  }
  if (state.lastReadMessageId) {
    return String(message.id) > state.lastReadMessageId;
  }
  return Number(message.timestamp || 0) > state.lastReadAt;
}

export function unreadMessages(messages = [], readState = {}, viewerUid = '') {
  const state = normalizeReadState(readState);
  return messages.filter((message) => isUnreadMessage(message, state, viewerUid));
}

export function unreadSummary(messages = [], readState = {}, viewerUid = '') {
  const unread = unreadMessages(messages, readState, viewerUid);
  return {
    count: unread.length,
    firstMessageId: unread[0]?.id || '',
    latestMessageId: messages.at(-1)?.id || '',
  };
}

export function nextReadState(message, now = Date.now()) {
  if (!message?.id) return normalizeReadState();
  return {
    lastReadMessageId: String(message.id),
    lastReadAt: Math.max(Number(message.timestamp || 0), Number(now || 0)),
    markedUnreadMessageId: '',
    markedUnreadAt: 0,
  };
}

export function nextMarkedUnreadState(message, current = {}, now = Date.now()) {
  const state = normalizeReadState(current);
  if (!message?.id) return state;
  return {
    ...state,
    markedUnreadMessageId: String(message.id),
    markedUnreadAt: Math.max(Number(message.timestamp || 0), Number(now || 0)),
  };
}
