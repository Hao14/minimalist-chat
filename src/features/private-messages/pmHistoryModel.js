export const PM_HISTORY_PAGE_SIZE = 80;

export function roomIdFor(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function mergePmMessagePages(...pages) {
  const byId = new Map();

  pages.forEach((page) => {
    (page || []).forEach((message) => {
      if (!message?.id) return;
      byId.set(message.id, message);
    });
  });

  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function pmHistoryCursor(messages = []) {
  return messages[0]?.id || '';
}

export function pmHistoryMayHaveOlder(messageCount, pageSize = PM_HISTORY_PAGE_SIZE) {
  return Number(messageCount || 0) >= pageSize;
}
