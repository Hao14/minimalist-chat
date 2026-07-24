export const ROOM_MESSAGE_KIND = Object.freeze({
  PERSON: 'person',
  AI: 'ai',
  AUTOMATION: 'automation',
});

export function roomMessageKind(message = {}) {
  if (message.aiAgent === true) return ROOM_MESSAGE_KIND.AI;
  if (message.automation === true || message.bot === true) return ROOM_MESSAGE_KIND.AUTOMATION;
  return ROOM_MESSAGE_KIND.PERSON;
}

export function isCurrentUserAuthoredMessage(message = {}, currentUserId = '') {
  return roomMessageKind(message) === ROOM_MESSAGE_KIND.PERSON
    && Boolean(currentUserId)
    && String(message.uid || '') === String(currentUserId);
}
