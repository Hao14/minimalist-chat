import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { createElement, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';

const h = createElement;
let notificationsRoot = null;
let notificationSettingsRoot = null;
let latestRawNotifications = null;
const NOTIFICATION_MODES = [
  { id: 'all', label: 'All notifications', icon: 'ph-bell-ringing' },
  { id: 'mentions', label: 'Mentions only', icon: 'ph-at' },
  { id: 'muted', label: 'Mute room', icon: 'ph-bell-slash' },
  { id: 'digest', label: 'Smart digest', icon: 'ph-newspaper' },
];
const ACTIVITY_FILTERS = [
  { id: 'all', label: 'Activity Center' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'replies', label: 'Replies' },
  { id: 'invites', label: 'Invites' },
  { id: 'reports', label: 'Reports' },
  { id: 'updates', label: 'Updates' },
  { id: 'announcements', label: 'Announcements' },
];

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entryValue]) => entryValue !== undefined));
}

window.createNotification = async function createNotification(targetUid, type, text, opts = {}) {
  try {
    if (!targetUid || targetUid === window.currentUser?.uid) return;

    const { groupId, from, ...meta } = opts;
    const payload = withoutUndefined({
      type,
      text,
      from: from || null,
      timestamp: Date.now(),
      ...meta,
    });

    if (groupId) {
      const key = `${type}_${groupId}`.replace(/[.#$/[\]]/g, '_');
      const notificationRef = ref(db, `notifications/${targetUid}/${key}`);
      const snapshot = await get(notificationRef);
      const count = (snapshot.exists() ? (snapshot.val().count || 1) : 0) + 1;
      await set(notificationRef, { ...payload, count });
      return;
    }

    await set(push(ref(db, `notifications/${targetUid}`)), payload);
  } catch (error) {
    console.error('Failed to push notification', error);
  }
};

window.clearNotification = async function clearNotification(notifId) {
  try {
    await remove(ref(db, `notifications/${window.currentUser.uid}/${notifId}`));
  } catch (error) {
    console.error('Failed to clear notification', error);
  }
};

window.clearNotificationGroup = async function clearNotificationGroup(idsCsv) {
  try {
    const ids = (idsCsv || '').split(',').filter(Boolean);
    await Promise.all(ids.map((id) => remove(ref(db, `notifications/${window.currentUser.uid}/${id}`))));
  } catch (error) {
    console.error('Failed to clear notifications', error);
  }
};

function notificationTitle(type) {
  if (type === 'message') return ['NEW MESSAGE', 'ph-bold ph-chat-circle-text'];
  if (type === 'mention') return ['MENTIONED YOU', 'ph-bold ph-at'];
  if (type === 'reply') return ['NEW REPLY', 'ph-bold ph-arrow-bend-up-left'];
  if (type === 'friend') return ['FRIEND REQUEST', 'ph-bold ph-user-plus'];
  if (type === 'invite') return ['ROOM INVITE', 'ph-bold ph-envelope-open'];
  if (type === 'room') return ['ROOM ACTIVITY', 'ph-bold ph-users-three'];
  if (type === 'report') return ['REPORT UPDATE', 'ph-bold ph-warning-circle'];
  if (type === 'announcement') return ['ANNOUNCEMENT', 'ph-bold ph-megaphone'];
  if (type === 'quest') return ['QUEST COMPLETE', 'ph-bold ph-flag-checkered'];
  if (type === 'levelup') return ['LEVEL UP', 'ph-bold ph-trend-up'];
  if (type === 'award') return ['COMMUNITY AWARD', 'ph-bold ph-medal'];
  if (type === 'badge') return ['BADGE EARNED', 'ph-bold ph-medal'];
  if (type === 'kudos') return ['KUDOS', 'ph-bold ph-hands-clapping'];
  if (type === 'follow') return ['NEW FOLLOWER', 'ph-bold ph-user-focus'];
  if (type === 'endorse') return ['SKILL ENDORSED', 'ph-bold ph-seal-check'];
  return ['SYSTEM ALERT', 'ph-bold ph-bell'];
}

function notificationTime(timestamp, today, yesterday) {
  const date = new Date(timestamp);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (date.toDateString() !== today.toDateString()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function groupNotifications(rawNotifications) {
  const groups = new Map();
  Object.entries(rawNotifications).forEach(([id, notification]) => {
    let key;
    if (notification.type === 'message') key = `message::${notification.from || notification.text}`;
    else if (notification.type === 'friend') key = `friend::${notification.from || notification.text}`;
    else key = `id::${id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        type: notification.type,
        from: notification.from || null,
        text: notification.text,
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
    group.count += notification.count || 1;
    group.ids.push(id);
    if ((notification.timestamp || 0) >= group.timestamp) {
      group.timestamp = notification.timestamp || 0;
      group.text = notification.text;
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

  return [...groups.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function activeRoomId() {
  return window.activeRoomId || document.querySelector('.room-item.active')?.dataset?.roomId || 'global';
}

function roomNotifyKey() {
  return `minimalist:notify:${activeRoomId()}`;
}

function keywordKey() {
  return `minimalist:notify-keywords:${activeRoomId()}`;
}

function readJsonList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readSchedule() {
  try {
    return {
      enabled: false,
      start: '22:00',
      end: '07:00',
      ...(JSON.parse(localStorage.getItem('minimalist:notify-schedule') || '{}') || {}),
    };
  } catch {
    return { enabled: false, start: '22:00', end: '07:00' };
  }
}

function readNotificationPrefs() {
  return {
    mode: localStorage.getItem(roomNotifyKey()) || 'all',
    dnd: localStorage.getItem('minimalist:dnd') === 'on',
    keywords: readJsonList(keywordKey()),
    schedule: readSchedule(),
  };
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Math.min(23, Number(match[1]) || 0) * 60 + Math.min(59, Number(match[2]) || 0);
}

function isQuietScheduleActive(schedule = {}) {
  if (schedule.enabled !== true) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes(schedule.start || '22:00');
  const end = timeToMinutes(schedule.end || '07:00');
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function classifyActivity(group) {
  if (group.type === 'mention') return 'mentions';
  if (group.type === 'reply') return 'replies';
  if (['friend', 'invite', 'room'].includes(group.type)) return 'invites';
  if (group.type === 'report') return 'reports';
  if (group.type === 'announcement') return 'announcements';
  if (['badge', 'kudos', 'quest', 'levelup', 'award', 'follow', 'endorse'].includes(group.type)) return 'updates';
  return 'all';
}

function visibleNotifications(groups, prefs, category) {
  if (prefs.dnd || isQuietScheduleActive(prefs.schedule)) return [];
  const currentRoom = activeRoomId();
  let next = groups.filter((group) => {
    if (prefs.mode === 'mentions' && group.type !== 'mention') return false;
    if (prefs.mode === 'muted' && group.roomId && group.roomId === currentRoom) return false;
    if (category !== 'all' && classifyActivity(group) !== category) return false;
    return true;
  });
  if (prefs.mode === 'digest') next = next.slice(0, 6);
  return next;
}

function notificationDestination(group) {
  if (group.pmTargetUid) return `Open PM with ${group.pmTargetName || group.from || 'sender'}`;
  if (group.roomId) {
    const channel = group.channelId && group.channelId !== 'general' ? ` · #${group.channelId}` : '';
    return `Open ${group.roomName || 'room'}${channel}`;
  }
  if (group.type === 'friend') return 'Open contacts';
  return 'No destination attached';
}

async function openNotification(group) {
  if (group.pmTargetUid) {
    window.openPrivateChat?.(group.pmTargetUid, group.pmTargetName || group.from || 'User');
    document.getElementById('updates-panel')?.classList.remove('open');
    await window.clearNotificationGroup?.(group.ids.join(','));
    return;
  }

  if (group.roomId) {
    window.pendingMessageJump = group.messageId
      ? { roomId: group.roomId, channelId: group.channelId || 'general', messageId: group.messageId }
      : null;
    window.switchRoom?.(
      group.roomId,
      group.roomName || (group.roomId === 'global' ? 'Global Chat' : 'Room'),
      group.shortId || (group.roomId === 'global' ? 'GLOBAL' : ''),
      { channelId: group.channelId || 'general' },
    );
    setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 80);
    document.getElementById('updates-panel')?.classList.remove('open');
    await window.clearNotificationGroup?.(group.ids.join(','));
    return;
  }

  if (group.type === 'friend') {
    document.getElementById('updates-panel')?.classList.remove('open');
    if (window.toggleContacts) window.toggleContacts();
    await window.clearNotificationGroup?.(group.ids.join(','));
    return;
  }

  window.showToast?.('This older notification does not have a destination attached yet.', false);
}

function NotificationItem({ group, today, yesterday }) {
  let [title, icon] = notificationTitle(group.type);
  const time = notificationTime(group.timestamp, today, yesterday);
  const count = group.count || 1;
  let mainText = group.text;

  if (count > 1 && group.type === 'message') {
    title = 'NEW MESSAGES';
    mainText = `${count} new messages${group.from ? ` from ${group.from}` : ''}`;
  }

  return h(
    'li',
    {
      className: `modern-notif modern-notif-${group.type || 'system'}`,
    },
    h(
      'button',
      {
        type: 'button',
        className: 'modern-notif-open',
        onClick: () => openNotification(group),
        title: notificationDestination(group),
      },
      h('span', { className: 'modern-notif-icon' }, h('i', { className: icon })),
      h(
        'span',
        {
          className: 'modern-notif-copy',
        },
        h(
          'span',
          {
            className: 'modern-notif-top',
          },
          h('strong', null, title),
          count > 1 ? h('em', null, count) : null,
          h('small', null, time),
        ),
        h('span', { className: 'modern-notif-text' }, mainText),
        h('span', { className: 'modern-notif-destination' }, notificationDestination(group)),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'notif-close-btn',
        'aria-label': 'Clear notification',
        onClick: (event) => {
          event.stopPropagation();
          window.clearNotificationGroup(group.ids.join(','));
        },
      },
      h('i', { className: 'ph-bold ph-x' }),
    ),
  );
}

function EmptyNotifications() {
  return h(
    'li',
    {
      style: {
        textAlign: 'center',
        color: '#888',
        marginTop: '2rem',
        fontWeight: 'bold',
        listStyle: 'none',
      },
    },
    h('i', {
      className: 'ph-bold ph-bell-slash',
      style: {
        fontSize: '3rem',
        marginBottom: '1rem',
        display: 'block',
        color: 'var(--text-color)',
      },
    }),
    "You're all caught up!",
  );
}

function NotificationControls({ as = 'li', category, groupCount, onCategory, onDndToggle, onKeywordAdd, onKeywordRemove, onMode, onScheduleChange, prefs }) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const scheduleEnabled = prefs.schedule.enabled === true;
  const submitKeyword = (event) => {
    event.preventDefault();
    const keyword = keywordDraft.trim().toLowerCase();
    if (!keyword) return;
    onKeywordAdd(keyword);
    setKeywordDraft('');
  };
  const Tag = as;

  return h(
    Tag,
    { className: 'notif-control-card' },
    h(
      'div',
      { className: 'notif-control-head' },
      h('span', null, h('i', { className: 'ph-bold ph-bell-ringing' }), ' Notifications'),
      h('em', null, prefs.dnd ? 'Do Not Disturb on' : `${groupCount} live item${groupCount === 1 ? '' : 's'}`),
    ),
    h(
      'div',
      { className: 'notif-mode-grid', role: 'group', 'aria-label': 'Notification controls' },
      NOTIFICATION_MODES.map((mode) => h(
        'button',
        {
          type: 'button',
          key: mode.id,
          className: `notif-mode-pill ${prefs.mode === mode.id ? 'active' : ''}`,
          onClick: () => onMode(mode.id),
        },
        h('i', { className: `ph-bold ${mode.icon}` }),
        h('span', null, mode.label),
      )),
      h(
        'button',
        {
          type: 'button',
          className: `notif-mode-pill notif-dnd-pill ${prefs.dnd ? 'active' : ''}`,
          'aria-pressed': prefs.dnd,
          onClick: onDndToggle,
        },
        h('i', { className: 'ph-bold ph-moon' }),
        h('span', null, 'Do Not Disturb'),
      ),
    ),
    h(
      'form',
      { className: 'notif-keyword-form', onSubmit: submitKeyword },
      h('label', null, 'Keyword alerts'),
      h('input', {
        value: keywordDraft,
        onChange: (event) => setKeywordDraft(event.target.value),
        placeholder: 'Add keyword…',
      }),
      h('button', { type: 'submit' }, 'Add'),
    ),
    prefs.keywords.length ? h(
      'div',
      { className: 'notif-keyword-chips' },
      prefs.keywords.map((keyword) => h(
        'button',
        { type: 'button', key: keyword, onClick: () => onKeywordRemove(keyword), title: `Remove ${keyword}` },
        keyword,
        h('i', { className: 'ph-bold ph-x' }),
      )),
    ) : null,
    h(
      'div',
      { className: 'notif-schedule-row' },
      h(
        'label',
        {
          className: `notif-mode-pill notif-schedule-pill ${scheduleEnabled ? 'active' : ''}`,
          role: 'switch',
          'aria-checked': scheduleEnabled,
        },
        h('input', {
          type: 'checkbox',
          checked: scheduleEnabled,
          onChange: (event) => onScheduleChange({ ...prefs.schedule, enabled: event.target.checked }),
        }),
        h('i', { className: 'ph-bold ph-clock' }),
        h('span', null, 'Custom schedules'),
      ),
      h('input', {
        type: 'time',
        disabled: !scheduleEnabled,
        value: prefs.schedule.start || '22:00',
        onChange: (event) => onScheduleChange({ ...prefs.schedule, start: event.target.value || '22:00' }),
      }),
      h('input', {
        type: 'time',
        disabled: !scheduleEnabled,
        value: prefs.schedule.end || '07:00',
        onChange: (event) => onScheduleChange({ ...prefs.schedule, end: event.target.value || '07:00' }),
      }),
    ),
    h(
      'div',
      { className: 'notif-filter-row', role: 'tablist', 'aria-label': 'Activity Center filters' },
      ACTIVITY_FILTERS.map((filter) => h(
        'button',
        {
          type: 'button',
          key: filter.id,
          className: category === filter.id ? 'active' : '',
          onClick: () => onCategory(filter.id),
        },
        filter.label,
      )),
    ),
  );
}

function NotificationSettingsPanel({ rawNotifications }) {
  const [prefs, setPrefs] = useState(readNotificationPrefs);
  const [category, setCategory] = useState(localStorage.getItem('minimalist:activity-filter') || 'all');
  const groups = useMemo(() => (rawNotifications ? groupNotifications(rawNotifications) : []), [rawNotifications]);

  const refreshActivityFeed = () => window.renderNotificationActivity?.();

  const updateMode = (mode) => {
    localStorage.setItem(roomNotifyKey(), mode);
    setPrefs(readNotificationPrefs());
    refreshActivityFeed();
    window.showToast?.(`${NOTIFICATION_MODES.find((item) => item.id === mode)?.label || 'Notification setting'} saved.`, false);
  };

  const toggleDnd = () => {
    if (prefs.dnd) localStorage.removeItem('minimalist:dnd');
    else localStorage.setItem('minimalist:dnd', 'on');
    setPrefs(readNotificationPrefs());
    refreshActivityFeed();
    window.showToast?.(prefs.dnd ? 'Do Not Disturb is off.' : 'Do Not Disturb is on for this device.', false);
  };

  const updateCategory = (nextCategory) => {
    localStorage.setItem('minimalist:activity-filter', nextCategory);
    setCategory(nextCategory);
    refreshActivityFeed();
  };

  const addKeyword = (keyword) => {
    const next = [...new Set([...prefs.keywords, keyword])].slice(0, 12);
    localStorage.setItem(keywordKey(), JSON.stringify(next));
    setPrefs(readNotificationPrefs());
    refreshActivityFeed();
    window.showToast?.(`Keyword alert added: ${keyword}`, false);
  };

  const removeKeyword = (keyword) => {
    localStorage.setItem(keywordKey(), JSON.stringify(prefs.keywords.filter((item) => item !== keyword)));
    setPrefs(readNotificationPrefs());
    refreshActivityFeed();
    window.showToast?.(`Keyword alert removed: ${keyword}`, false);
  };

  const updateSchedule = (schedule) => {
    localStorage.setItem('minimalist:notify-schedule', JSON.stringify(schedule));
    setPrefs(readNotificationPrefs());
    refreshActivityFeed();
    if (schedule.enabled !== prefs.schedule.enabled) {
      window.showToast?.(schedule.enabled ? 'Custom schedule is on.' : 'Custom schedule is off.', false);
    }
  };

  return h(
    'div',
    { className: 'notif-settings-shell' },
    h(NotificationControls, {
      as: 'div',
      category,
      groupCount: groups.length,
      onCategory: updateCategory,
      onDndToggle: toggleDnd,
      onKeywordAdd: addKeyword,
      onKeywordRemove: removeKeyword,
      onMode: updateMode,
      onScheduleChange: updateSchedule,
      prefs,
    }),
  );
}

function NotificationList({ rawNotifications }) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const prefs = readNotificationPrefs();
  const category = localStorage.getItem('minimalist:activity-filter') || 'all';
  const groups = useMemo(() => (rawNotifications ? groupNotifications(rawNotifications) : []), [rawNotifications]);
  const visibleGroups = useMemo(() => visibleNotifications(groups, prefs, category), [groups, prefs, category]);

  if (!visibleGroups.length) return h(EmptyNotifications, { key: 'empty' });

  return visibleGroups.map((group) => h(NotificationItem, {
    group,
    key: group.ids.join(','),
    today,
    yesterday,
  }));
}

function renderNotifications(list, rawNotifications) {
  notificationsRoot ||= createRoot(list);
  notificationsRoot.render(h(NotificationList, { rawNotifications }));
}

function renderNotificationActivity() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  renderNotifications(list, latestRawNotifications);
}

window.renderNotificationActivity = renderNotificationActivity;

window.renderNotificationSettings = function renderNotificationSettings() {
  const root = document.getElementById('notification-settings-root');
  if (!root) return;
  notificationSettingsRoot ||= createRoot(root);
  notificationSettingsRoot.render(h(NotificationSettingsPanel, { rawNotifications: latestRawNotifications }));
};

window.listenForNotifications = function listenForNotifications() {
  if (!window.currentUser) return;

  onValue(ref(db, `notifications/${window.currentUser.uid}`), (snapshot) => {
    const list = document.getElementById('notifications-list');
    const desktopBell = document.getElementById('open-updates-btn-desktop');
    const mobileBell = document.getElementById('open-updates-btn-mobile');
    if (!list) return;

    if (!snapshot.exists()) {
      latestRawNotifications = null;
      if (desktopBell) desktopBell.style.color = 'var(--text-color)';
      if (mobileBell) mobileBell.style.color = 'var(--text-color)';
      list.style.padding = '1.5rem';
      renderNotifications(list, null);
      window.renderNotificationSettings?.();
      return;
    }

    latestRawNotifications = snapshot.val();
    if (desktopBell) desktopBell.style.color = '#FF3B30';
    if (mobileBell) mobileBell.style.color = '#FF3B30';
    list.style.padding = '0';
    list.style.gap = '0';

    renderNotifications(list, latestRawNotifications);
    window.renderNotificationSettings?.();
  });
};
