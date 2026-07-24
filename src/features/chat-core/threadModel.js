export function threadRootIdForMessage(message = {}) {
  return String(message.threadRootId || message.id || '');
}

export function messagesForThread(messages = [], rootId = '') {
  const normalizedRootId = String(rootId || '');
  if (!normalizedRootId) return [];
  return messages.filter((message) => (
    message.id === normalizedRootId
    || String(message.threadRootId || '') === normalizedRootId
  ));
}

export function buildThreadSummaries(messages = [], follows = {}, readAtByRoot = {}, viewerUid = '') {
  const byRoot = new Map();

  messages.forEach((message) => {
    if (!message?.id) return;
    const rootId = threadRootIdForMessage(message);
    const existing = byRoot.get(rootId) || {
      rootId,
      root: null,
      replies: [],
      latestAt: 0,
    };
    if (message.id === rootId) existing.root = message;
    else existing.replies.push(message);
    existing.latestAt = Math.max(existing.latestAt, Number(message.timestamp || 0));
    byRoot.set(rootId, existing);
  });

  return [...byRoot.values()]
    .filter((thread) => thread.replies.length > 0 || follows?.[thread.rootId])
    .map((thread) => {
      const readAt = Number(readAtByRoot?.[thread.rootId] || 0);
      const unreadCount = thread.replies.filter((reply) => (
        reply.uid !== viewerUid && Number(reply.timestamp || 0) > readAt
      )).length;
      return {
        ...thread,
        followed: follows?.[thread.rootId] === true || follows?.[thread.rootId]?.followed === true,
        replyCount: thread.replies.length,
        unreadCount,
      };
    })
    .sort((left, right) => right.latestAt - left.latestAt);
}
