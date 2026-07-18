export function groupNotifications(rawNotifications = {}) {
  const groups = new Map();

  Object.entries(rawNotifications || {}).forEach(([id, notification = {}]) => {
    let key;
    if (notification.type === 'message') key = `message::${notification.from || notification.text || id}`;
    else if (notification.type === 'friend') key = `friend::${notification.from || notification.text || id}`;
    else key = `id::${id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        type: notification.type || 'system',
        from: notification.from || null,
        text: notification.text || 'New activity',
        timestamp: notification.timestamp || 0,
        count: 0,
        ids: [],
        action: notification.action || '',
        roomId: notification.roomId || '',
        roomName: notification.roomName || '',
        shortId: notification.shortId || '',
        channelId: notification.channelId || '',
        messageId: notification.messageId || '',
        pmTargetUid: notification.pmTargetUid || '',
        pmTargetName: notification.pmTargetName || notification.from || '',
        contactUid: notification.contactUid || notification.fromUid || '',
        category: notification.category || notification.type || 'system',
      });
    }

    const group = groups.get(key);
    group.count += Math.max(1, Number(notification.count) || 1);
    group.ids.push(id);
    if ((notification.timestamp || 0) >= group.timestamp) {
      group.timestamp = notification.timestamp || 0;
      group.text = notification.text || group.text;
      group.from = notification.from || group.from;
      group.action = notification.action || group.action;
      group.roomId = notification.roomId || group.roomId;
      group.roomName = notification.roomName || group.roomName;
      group.shortId = notification.shortId || group.shortId;
      group.channelId = notification.channelId || group.channelId;
      group.messageId = notification.messageId || group.messageId;
      group.pmTargetUid = notification.pmTargetUid || group.pmTargetUid;
      group.pmTargetName = notification.pmTargetName || notification.from || group.pmTargetName;
      group.contactUid = notification.contactUid || notification.fromUid || group.contactUid;
      group.category = notification.category || notification.type || group.category;
    }
  });

  return [...groups.values()].sort((left, right) => right.timestamp - left.timestamp);
}

export function notificationCount(groups = []) {
  return groups.reduce((total, group) => total + Math.max(1, Number(group.count) || 1), 0);
}

export function classifyActivity(group = {}) {
  if (group.type === 'mention') return 'mentions';
  if (group.type === 'reply') return 'replies';
  if (['friend', 'invite', 'room'].includes(group.type)) return 'invites';
  if (group.type === 'report') return 'reports';
  if (group.type === 'announcement') return 'announcements';
  if (['badge', 'kudos', 'quest', 'levelup', 'award', 'follow', 'endorse'].includes(group.type)) return 'updates';
  return 'all';
}

export function filterActivityNotifications(groups = [], category = 'all') {
  if (!category || category === 'all') return groups;
  return groups.filter((group) => classifyActivity(group) === category);
}

export function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Math.min(23, Number(match[1]) || 0) * 60 + Math.min(59, Number(match[2]) || 0);
}

export function isQuietScheduleActive(schedule = {}, now = new Date()) {
  if (schedule.enabled !== true) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes(schedule.start || '22:00');
  const end = timeToMinutes(schedule.end || '07:00');
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function filterRealtimeAlerts(groups = [], prefs = {}, currentRoomId = 'global', now = new Date()) {
  if (prefs.dnd || isQuietScheduleActive(prefs.schedule, now)) return [];

  const keywords = (prefs.keywords || [])
    .map((keyword) => String(keyword || '').trim().toLowerCase())
    .filter(Boolean);
  const matchesKeyword = (group) => {
    if (!keywords.length) return false;
    const searchable = [group.text, group.from, group.roomName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return keywords.some((keyword) => searchable.includes(keyword));
  };

  let next = groups.filter((group) => {
    if (prefs.mode === 'mentions' && group.type !== 'mention' && !matchesKeyword(group)) return false;
    if (prefs.mode === 'muted' && group.roomId && group.roomId === currentRoomId) return false;
    return true;
  });

  if (prefs.mode === 'digest') next = next.slice(0, 6);
  return next;
}
