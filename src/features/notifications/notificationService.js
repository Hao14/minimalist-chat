import { limitToLast, onValue, orderByChild, query, ref, remove, update } from 'firebase/database';
import { createElement, useEffect, useMemo, useState } from 'react';
import { db } from '../../lib/firebase.js';
import { getAuthedJsonHeaders } from '../../lib/authToken.js';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import {
  filterActivityNotifications,
  filterRealtimeAlerts,
  groupNotifications,
  isQuietScheduleActive,
  notificationCount,
} from './notificationModel.js';

const h = createElement;
const notificationsRoot = createHostAwareRoot();
const notificationSettingsRoot = createHostAwareRoot();
let latestNotificationGroups = [];
let notificationConnection = { status: 'idle', error: '', updatedAt: 0 };
let notificationListenerStartedAt = 0;
let notificationListenerUid = null;
let notificationUnsubscribe = null;
let activityUnreadCount = 0;
let pmUnreadCount = 0;
const seenNotificationSignatures = new Set();
const MAX_SEEN_NOTIFICATION_SIGNATURES = 500;
const REALTIME_SOUND_TYPES = new Set(['mention', 'message', 'invite', 'friend']);
const NOTIFICATION_MODES = [
  { id: 'all', label: 'All', description: 'Every update' },
  { id: 'mentions', label: 'Mentions', description: 'Direct mentions only' },
  { id: 'digest', label: 'Digest', description: 'Condensed delivery' },
  { id: 'muted', label: 'Muted', description: 'Pause this room' },
];
const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'replies', label: 'Replies' },
  { id: 'invites', label: 'Invites' },
  { id: 'updates', label: 'Updates' },
  { id: 'reports', label: 'Reports' },
  { id: 'announcements', label: 'Announcements' },
];

function syncUpdatesPanelStatus() {
  const status = document.getElementById('updates-panel-status');
  const copy = status?.querySelector('.updates-center-status-copy');
  if (!status || !copy) return;

  const state = notificationConnection.status === 'error'
    ? 'error'
    : notificationConnection.status === 'ready'
      ? 'ready'
      : 'loading';
  status.dataset.state = state;
  if (state === 'error') copy.textContent = 'Offline · Saved activity available';
  else if (state === 'ready') copy.textContent = 'Live · Just now';
  else copy.textContent = 'Live · Checking activity';
}

function syncUpdatesUnreadIndicator(next = {}) {
  if (Number.isFinite(next.activityCount)) activityUnreadCount = Math.max(0, next.activityCount);
  if (Number.isFinite(next.pmUnread)) pmUnreadCount = Math.max(0, next.pmUnread);

  const total = activityUnreadCount + pmUnreadCount;
  const badgeLabel = total > 99 ? '99+' : String(total);
  ['open-updates-btn-desktop', 'open-updates-btn-mobile'].forEach((id) => {
    const trigger = document.getElementById(id);
    if (!trigger) return;
    const baseLabel = trigger.dataset.defaultAriaLabel
      || trigger.getAttribute('aria-label')
      || trigger.title
      || 'Open updates';
    trigger.dataset.defaultAriaLabel = baseLabel.replace(/ \(\d+ unread items?\)$/, '');
    trigger.classList.toggle('has-unread', total > 0);
    trigger.classList.toggle('has-activity-unread', activityUnreadCount > 0);
    trigger.dataset.activityUnread = String(activityUnreadCount);
    trigger.dataset.pmUnread = String(pmUnreadCount);
    if (total > 0) {
      trigger.dataset.unreadCount = badgeLabel;
      trigger.setAttribute('aria-label', `${trigger.dataset.defaultAriaLabel} (${total} unread item${total === 1 ? '' : 's'})`);
    } else {
      delete trigger.dataset.unreadCount;
      trigger.setAttribute('aria-label', trigger.dataset.defaultAriaLabel);
    }
  });
  return true;
}

window.updateUpdatesUnreadIndicator = syncUpdatesUnreadIndicator;

function rememberNotificationSignature(signature) {
  if (seenNotificationSignatures.has(signature)) return false;
  seenNotificationSignatures.add(signature);
  while (seenNotificationSignatures.size > MAX_SEEN_NOTIFICATION_SIGNATURES) {
    const oldest = seenNotificationSignatures.values().next().value;
    if (oldest === undefined) break;
    seenNotificationSignatures.delete(oldest);
  }
  return true;
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entryValue]) => entryValue !== undefined));
}

function notificationEndpoint() {
  return window.NOTIFICATION_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/createNotification';
}

window.createNotification = async function createNotification(targetUid, type, text, opts = {}) {
  try {
    if (!targetUid || targetUid === window.currentUser?.uid) return;

    const { groupId, from, ...meta } = opts;
    const payload = withoutUndefined({
      type,
      text,
      from: from || null,
      senderUid: window.currentUser?.uid || null,
      timestamp: Date.now(),
      ...meta,
    });

    const response = await fetch(notificationEndpoint(), {
      method: 'POST',
      headers: await getAuthedJsonHeaders('Please sign in before sending notifications.'),
      body: JSON.stringify({
        targetUid,
        groupId,
        ...payload,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || `Notification request failed (${response.status})`);
    }
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
    const uid = window.currentUser?.uid;
    if (!uid || !ids.length) return false;
    const changes = Object.fromEntries(ids.map((id) => [`notifications/${uid}/${id}`, null]));
    await update(ref(db), changes);
    return true;
  } catch (error) {
    console.error('Failed to clear notifications', error);
    window.showToast?.('Could not update notifications. Please try again.');
    return false;
  }
};

function notificationTitle(type) {
  if (type === 'message') return ['New message', 'ph-bold ph-chat-circle-text'];
  if (type === 'mention') return ['Mentioned you', 'ph-bold ph-at'];
  if (type === 'reply') return ['New reply', 'ph-bold ph-arrow-bend-up-left'];
  if (type === 'friend') return ['Friend request', 'ph-bold ph-user-plus'];
  if (type === 'invite') return ['Room invite', 'ph-bold ph-envelope-open'];
  if (type === 'room') return ['Room activity', 'ph-bold ph-users-three'];
  if (type === 'report') return ['Report update', 'ph-bold ph-warning-circle'];
  if (type === 'announcement') return ['Announcement', 'ph-bold ph-megaphone'];
  if (type === 'quest') return ['Quest complete', 'ph-bold ph-flag-checkered'];
  if (type === 'levelup') return ['Level up', 'ph-bold ph-trend-up'];
  if (type === 'award') return ['Community award', 'ph-bold ph-medal'];
  if (type === 'badge') return ['Badge earned', 'ph-bold ph-medal'];
  if (type === 'kudos') return ['Kudos', 'ph-bold ph-hands-clapping'];
  if (type === 'follow') return ['New follower', 'ph-bold ph-user-focus'];
  if (type === 'endorse') return ['Skill endorsed', 'ph-bold ph-seal-check'];
  return ['System alert', 'ph-bold ph-bell'];
}

function hasFreshRealtimeAlert(rawNotifications = {}, groups = groupNotifications(rawNotifications)) {
  const prefs = readNotificationPrefs();
  const visibleAlertIds = new Set(
    filterRealtimeAlerts(groups, prefs, activeRoomId())
      .flatMap((group) => group.ids || []),
  );

  let hasFreshAlert = false;
  Object.entries(rawNotifications || {}).forEach(([id, notification]) => {
    const signature = `${id}:${notification?.timestamp || 0}:${notification?.count || 1}:${notification?.text || ''}`;
    const isFresh = (notification?.timestamp || 0) > notificationListenerStartedAt - 3000;
    const isNew = rememberNotificationSignature(signature);
    if (isNew && isFresh && visibleAlertIds.has(id) && REALTIME_SOUND_TYPES.has(notification?.type)) {
      hasFreshAlert = true;
    }
  });
  return hasFreshAlert;
}

function notificationTime(timestamp, today, yesterday) {
  const date = new Date(timestamp);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (date.toDateString() !== today.toDateString()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

function notificationDestination(group) {
  if (group.pmTargetUid) return `Open PM with ${group.pmTargetName || group.from || 'sender'}`;
  if (group.roomId) {
    const channel = group.channelId && group.channelId !== 'general' ? ` · #${group.channelId}` : '';
    return `Open ${group.roomName || 'room'}${channel}`;
  }
  if (group.type === 'friend') return 'Open contacts';
  return 'Activity only';
}

async function openNotification(group) {
  if (group.pmTargetUid) {
    if (typeof window.openPrivateChat !== 'function') {
      window.showToast?.('Private messaging is still loading. Please try again.', false);
      return;
    }
    await Promise.resolve(window.openPrivateChat(group.pmTargetUid, group.pmTargetName || group.from || 'User'));
    if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel({ restoreFocus: false });
    else document.getElementById('updates-panel')?.classList.remove('open');
    await window.clearNotificationGroup?.(group.ids.join(','));
    return;
  }

  if (group.roomId) {
    if (typeof window.switchRoom !== 'function') {
      window.showToast?.('Rooms are still loading. Please try again.', false);
      return;
    }
    window.pendingMessageJump = group.messageId
      ? { roomId: group.roomId, channelId: group.channelId || 'general', messageId: group.messageId }
      : null;
    await Promise.resolve(window.switchRoom(
      group.roomId,
      group.roomName || (group.roomId === 'global' ? 'Global Chat' : 'Room'),
      group.shortId || (group.roomId === 'global' ? 'GLOBAL' : ''),
      { channelId: group.channelId || 'general' },
    ));
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        const chatTab = document.querySelector('.room-tab[data-target="chat"]');
        chatTab?.click();
        window.requestAnimationFrame(() => {
          const focusTarget = document.getElementById('message-input') || chatTab;
          focusTarget?.focus();
          resolve();
        });
      });
    });
    if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel({ restoreFocus: false });
    else document.getElementById('updates-panel')?.classList.remove('open');
    await window.clearNotificationGroup?.(group.ids.join(','));
    return;
  }

  if (group.type === 'friend') {
    if (typeof window.toggleContacts !== 'function' && typeof window.openContactsPanel !== 'function') {
      window.showToast?.('Contacts are still loading. Please try again.', false);
      return;
    }
    if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel({ restoreFocus: false });
    else document.getElementById('updates-panel')?.classList.remove('open');
    if (window.openContactsPanel) window.openContactsPanel();
    else window.toggleContacts?.();
    await window.clearNotificationGroup?.(group.ids.join(','));
    return;
  }

  window.showToast?.('This older notification does not have a destination attached yet.', false);
}

function NotificationItem({ group, onClear, today, yesterday }) {
  let [title, icon] = notificationTitle(group.type);
  const time = notificationTime(group.timestamp, today, yesterday);
  const count = group.count || 1;
  let mainText = group.text;
  const destination = notificationDestination(group);

  if (count > 1 && group.type === 'message') {
    title = 'New messages';
    mainText = `${count} new messages${group.from ? ` from ${group.from}` : ''}`;
  }

  return h(
    'li',
    {
      className: `modern-notif modern-notif-${group.type || 'system'}`,
      'data-notification-ids': group.ids.join(','),
    },
    h('span', { className: 'modern-notif-unread-marker', 'aria-hidden': 'true' }),
    h(
      'button',
      {
        type: 'button',
        className: 'modern-notif-open',
        onClick: () => openNotification(group),
        title: destination,
        'aria-label': `${title}: ${mainText}. ${destination}`,
      },
      h('span', { className: 'modern-notif-icon', 'aria-hidden': 'true' }, h('i', { className: icon })),
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
        h(
          'span',
          { className: 'modern-notif-destination' },
          h('i', { className: 'ph-bold ph-arrow-right', 'aria-hidden': 'true' }),
          destination,
        ),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'notif-close-btn',
        'aria-label': `Clear ${title.toLowerCase()} notification`,
        onClick: (event) => {
          event.stopPropagation();
          onClear(group);
        },
      },
      h('i', { className: 'ph-bold ph-x', 'aria-hidden': 'true' }),
    ),
  );
}

function EmptyNotifications({ filtered = false, onPreferences }) {
  return h(
    'li',
    { className: 'activity-state activity-state-empty' },
    h(
      'span',
      { className: 'activity-state-icon', 'aria-hidden': 'true' },
      h('i', { className: filtered ? 'ph-bold ph-funnel' : 'ph-bold ph-bell-simple' }),
    ),
    h('strong', null, filtered ? 'Nothing in this view' : "You're all caught up"),
    h(
      'p',
      null,
      filtered ? 'Try another filter to see the rest of your activity.' : 'New mentions, replies, invites, and room updates will appear here.',
    ),
    h(
      'div',
      { className: 'activity-state-actions' },
      h('button', { type: 'button', onClick: onPreferences }, 'Notification preferences'),
    ),
  );
}

function NotificationControls({ as = 'li', groupCount, onDndToggle, onKeywordAdd, onKeywordRemove, onMode, onScheduleChange, prefs }) {
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
  const moveDeliveryMode = (event, currentIndex) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = NOTIFICATION_MODES.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % NOTIFICATION_MODES.length;
    else nextIndex = (currentIndex - 1 + NOTIFICATION_MODES.length) % NOTIFICATION_MODES.length;
    const nextMode = NOTIFICATION_MODES[nextIndex];
    onMode(nextMode.id);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-notification-mode="${nextMode.id}"]`)?.focus();
    });
  };

  return h(
    Tag,
    { className: 'notif-control-card' },
    h(
      'div',
      { className: 'notif-control-head' },
      h(
        'div',
        { className: 'notif-control-head-copy' },
        h('strong', { id: 'notification-delivery-heading' }, 'Delivery preferences'),
        h('p', null, 'Choose what can interrupt you. Your activity history always stays available in Updates.'),
      ),
      h('em', { className: 'notif-live-count' }, `${groupCount} saved item${groupCount === 1 ? '' : 's'}`),
    ),
    h(
      'div',
      { className: 'notif-preference-group' },
      h(
        'div',
        { className: 'notif-preference-row' },
        h(
          'div',
          { className: 'notif-preference-copy' },
          h('strong', null, 'Delivery mode'),
          h('small', null, `Applies to ${activeRoomId() === 'global' ? 'Global Chat' : 'this room'} on this device.`),
        ),
        h(
          'div',
          { className: 'notif-delivery-grid', role: 'radiogroup', 'aria-label': 'Delivery mode' },
          NOTIFICATION_MODES.map((mode, index) => h(
            'button',
            {
              type: 'button',
              role: 'radio',
              key: mode.id,
              className: `notif-delivery-option ${prefs.mode === mode.id ? 'active' : ''}`,
              'aria-checked': prefs.mode === mode.id,
              'data-notification-mode': mode.id,
              tabIndex: prefs.mode === mode.id ? 0 : -1,
              title: mode.description,
              onClick: () => onMode(mode.id),
              onKeyDown: (event) => moveDeliveryMode(event, index),
            },
            mode.label,
          )),
        ),
      ),
    ),
    h(
      'div',
      { className: 'notif-preference-group' },
      h(
        'div',
        { className: 'notif-preference-row' },
        h(
          'div',
          { className: 'notif-preference-copy' },
          h('strong', null, 'Do Not Disturb'),
          h('small', null, 'Pause sounds and pop-up alerts until you turn it off.'),
        ),
        h(
          'div',
          { className: 'notif-preference-action' },
          h('button', {
            type: 'button',
            className: 'notif-switch',
            role: 'switch',
            'aria-label': 'Do Not Disturb',
            'aria-checked': prefs.dnd,
            onClick: onDndToggle,
          }),
        ),
      ),
      h(
        'div',
        { className: 'notif-preference-row' },
        h(
          'div',
          { className: 'notif-preference-copy' },
          h('strong', null, 'Quiet hours'),
          h('small', null, 'Automatically pause non-urgent delivery on this device.'),
        ),
        h(
          'div',
          { className: 'notif-quiet-editor' },
          h('button', {
            type: 'button',
            className: 'notif-switch',
            role: 'switch',
            'aria-label': 'Quiet hours schedule',
            'aria-checked': scheduleEnabled,
            onClick: () => onScheduleChange({ ...prefs.schedule, enabled: !scheduleEnabled }),
          }),
          h(
            'div',
            { className: 'notif-quiet-fields' },
            h('input', {
              type: 'time',
              disabled: !scheduleEnabled,
              value: prefs.schedule.start || '22:00',
              'aria-label': 'Quiet hours start time',
              onChange: (event) => onScheduleChange({ ...prefs.schedule, start: event.target.value || '22:00' }),
            }),
            h('span', { 'aria-hidden': 'true' }, 'to'),
            h('input', {
              type: 'time',
              disabled: !scheduleEnabled,
              value: prefs.schedule.end || '07:00',
              'aria-label': 'Quiet hours end time',
              onChange: (event) => onScheduleChange({ ...prefs.schedule, end: event.target.value || '07:00' }),
            }),
          ),
        ),
      ),
    ),
    h(
      'div',
      { className: 'notif-preference-group' },
      h(
        'div',
        { className: 'notif-preference-row' },
        h(
          'div',
          { className: 'notif-preference-copy' },
          h('label', { htmlFor: 'notif-keyword-input' }, 'Keyword alerts'),
          h('small', null, 'Keep a short list of words you do not want to miss in this room.'),
        ),
        h(
          'div',
          { className: 'notif-keyword-editor' },
          h(
            'form',
            { className: 'notif-keyword-form', onSubmit: submitKeyword },
            h('input', {
              id: 'notif-keyword-input',
              value: keywordDraft,
              onChange: (event) => setKeywordDraft(event.target.value),
              placeholder: 'Add a keyword',
              'aria-label': 'Keyword alert',
            }),
            h('button', { type: 'submit' }, 'Add'),
          ),
          prefs.keywords.length ? h(
            'div',
            { className: 'notif-keyword-chips', 'aria-label': 'Saved keyword alerts' },
            prefs.keywords.map((keyword) => h(
              'button',
              { type: 'button', key: keyword, onClick: () => onKeywordRemove(keyword), title: `Remove ${keyword}` },
              keyword,
              h('i', { className: 'ph-bold ph-x', 'aria-hidden': 'true' }),
            )),
          ) : null,
        ),
      ),
    ),
  );
}

function NotificationSettingsPanel({ groups = [] }) {
  const [prefs, setPrefs] = useState(readNotificationPrefs);

  useEffect(() => {
    const syncPreferences = () => setPrefs(readNotificationPrefs());
    window.addEventListener('minimalist:notification-preferences', syncPreferences);
    return () => window.removeEventListener('minimalist:notification-preferences', syncPreferences);
  }, []);

  const refreshActivityFeed = () => window.renderNotificationActivity?.();

  const updateMode = (mode) => {
    localStorage.setItem(roomNotifyKey(), mode);
    setPrefs(readNotificationPrefs());
    refreshActivityFeed();
    window.showToast?.(`${NOTIFICATION_MODES.find((item) => item.id === mode)?.label || 'Notification'} delivery saved.`, false);
  };

  const toggleDnd = () => {
    if (prefs.dnd) localStorage.removeItem('minimalist:dnd');
    else localStorage.setItem('minimalist:dnd', 'on');
    setPrefs(readNotificationPrefs());
    refreshActivityFeed();
    window.syncPrivateMessageDeliveryPreferences?.();
    window.showToast?.(prefs.dnd ? 'Do Not Disturb is off.' : 'Do Not Disturb is on for this device.', false);
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
    window.syncPrivateMessageDeliveryPreferences?.();
    if (schedule.enabled !== prefs.schedule.enabled) {
      window.showToast?.(schedule.enabled ? 'Custom schedule is on.' : 'Custom schedule is off.', false);
    }
  };

  return h(
    'div',
    { className: 'notif-settings-shell' },
    h(NotificationControls, {
      as: 'div',
      groupCount: notificationCount(groups),
      onDndToggle: toggleDnd,
      onKeywordAdd: addKeyword,
      onKeywordRemove: removeKeyword,
      onMode: updateMode,
      onScheduleChange: updateSchedule,
      prefs,
    }),
  );
}

async function openNotificationPreferences() {
  window.closeUpdatesPanel?.({ restoreFocus: false });
  if (typeof window.openSettings !== 'function') {
    window.showToast?.('Settings are still loading. Please try again.', false);
    return;
  }
  await Promise.resolve(window.openSettings());
  window.switchTab?.('pane-notifications', 'tab-btn-notifications');
  window.requestAnimationFrame(() => document.getElementById('tab-btn-notifications')?.focus());
}

function NotificationLoadingState() {
  return h(
    'li',
    { className: 'activity-skeleton-list', role: 'status', 'aria-label': 'Loading notifications' },
    [0, 1, 2].map((index) => h(
      'span',
      { className: 'activity-skeleton-row', key: index, 'aria-hidden': 'true' },
      h('span', { className: 'activity-skeleton-block' }),
      h(
        'span',
        { className: 'activity-skeleton-copy' },
        h('span', { className: 'activity-skeleton-line' }),
        h('span', { className: 'activity-skeleton-line' }),
      ),
    )),
  );
}

function NotificationErrorState({ error }) {
  return h(
    'li',
    { className: 'activity-state activity-state-error', role: 'alert' },
    h('span', { className: 'activity-state-icon', 'aria-hidden': 'true' }, h('i', { className: 'ph-bold ph-cloud-slash' })),
    h('strong', null, "Couldn't refresh activity"),
    h('p', null, error || 'Check your connection. Saved activity will remain available.'),
    h(
      'div',
      { className: 'activity-state-actions' },
      h('button', { type: 'button', onClick: () => window.retryNotificationListener?.() }, 'Retry'),
    ),
  );
}

function NotificationToolbar({ category, clearing, groups, onCategory, onClearAll, prefs }) {
  const total = notificationCount(groups);
  const quietActive = isQuietScheduleActive(prefs.schedule);
  const deliveryLabel = prefs.dnd ? 'Do Not Disturb on' : quietActive ? 'Quiet hours on' : 'Alerts on';

  return h(
    'li',
    { className: 'activity-center-toolbar' },
    h(
      'div',
      { className: 'activity-center-summary' },
      h(
        'div',
        { className: 'activity-center-summary-copy' },
        h('span', { className: 'activity-unread-count' }, `${total} unread`),
        h(
          'span',
          { className: 'activity-delivery-status' },
          h('i', { className: `ph-bold ${prefs.dnd || quietActive ? 'ph-moon' : 'ph-bell-simple-ringing'}`, 'aria-hidden': 'true' }),
          deliveryLabel,
        ),
      ),
      h(
        'div',
        { className: 'activity-center-actions' },
        h(
          'button',
          {
            type: 'button',
            className: `activity-center-action${clearing ? ' is-busy' : ''}`,
            disabled: !total || clearing,
            'aria-label': 'Mark all activity as read',
            onClick: onClearAll,
          },
          h('i', { className: `ph-bold ${clearing ? 'ph-circle-notch' : 'ph-checks'}`, 'aria-hidden': 'true' }),
          h('span', { className: 'activity-center-action-label' }, 'Clear'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'activity-center-action',
            'aria-label': 'Open notification preferences',
            onClick: openNotificationPreferences,
          },
          h('i', { className: 'ph-bold ph-sliders-horizontal', 'aria-hidden': 'true' }),
        ),
      ),
    ),
    h(
      'div',
      { className: 'activity-filter-row', role: 'group', 'aria-label': 'Filter activity' },
      ACTIVITY_FILTERS.map((filter) => h(
        'button',
        {
          type: 'button',
          key: filter.id,
          className: category === filter.id ? 'active' : '',
          'aria-pressed': category === filter.id,
          onClick: () => onCategory(filter.id),
        },
        filter.label,
      )),
    ),
  );
}

function NotificationList({ connection, groups }) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const [category, setCategory] = useState(() => localStorage.getItem('minimalist:activity-filter') || 'all');
  const [clearing, setClearing] = useState(false);
  const [pendingFocus, setPendingFocus] = useState(null);
  const prefs = readNotificationPrefs();
  const visibleGroups = useMemo(() => filterActivityNotifications(groups, category), [groups, category]);
  const quietActive = isQuietScheduleActive(prefs.schedule);

  useEffect(() => {
    if (!pendingFocus) return;
    const clearedStillPresent = groups.some((group) => group.ids?.some((id) => pendingFocus.ids.includes(id)));
    if (clearedStillPresent) return;

    const rows = [...document.querySelectorAll('#notifications-list .modern-notif')];
    const row = rows[Math.min(pendingFocus.index, Math.max(0, rows.length - 1))];
    const focusTarget = row?.querySelector('.notif-close-btn, .modern-notif-open')
      || document.querySelector('#notifications-list .activity-center-action:not([disabled]), #notifications-list .activity-filter-row button.active');
    window.requestAnimationFrame(() => {
      focusTarget?.focus();
      setPendingFocus(null);
    });
  }, [groups, pendingFocus]);

  const updateCategory = (nextCategory) => {
    localStorage.setItem('minimalist:activity-filter', nextCategory);
    setCategory(nextCategory);
  };

  const clearAll = async () => {
    const ids = groups.flatMap((group) => group.ids || []);
    if (!ids.length || clearing) return;
    setClearing(true);
    const cleared = await window.clearNotificationGroup?.(ids.join(','));
    setClearing(false);
    if (cleared) window.showToast?.('Marked all activity as read.', false);
  };

  const clearOne = async (group, index) => {
    setPendingFocus({ ids: group.ids || [], index });
    const cleared = await window.clearNotificationGroup?.((group.ids || []).join(','));
    if (!cleared) setPendingFocus(null);
  };

  const children = [
    h(NotificationToolbar, {
      category,
      clearing,
      groups,
      key: 'toolbar',
      onCategory: updateCategory,
      onClearAll: clearAll,
      prefs,
    }),
  ];

  if (prefs.dnd || quietActive) {
    children.push(h(
      'li',
      { className: 'activity-delivery-note', key: 'delivery-note' },
      h('i', { className: 'ph-bold ph-moon', 'aria-hidden': 'true' }),
      prefs.dnd
        ? 'Do Not Disturb is pausing sounds and pop-up alerts. Your history stays visible.'
        : `Quiet hours are active until ${prefs.schedule.end || '07:00'}. Your history stays visible.`,
    ));
  }

  if (connection.status === 'error' && groups.length) {
    children.push(h(
      'li',
      { className: 'activity-connection-note', key: 'connection-note' },
      h('i', { className: 'ph-bold ph-cloud-slash', 'aria-hidden': 'true' }),
      'You are offline. Showing the most recent saved activity.',
    ));
  }

  if (connection.status === 'loading' && !groups.length) {
    children.push(h(NotificationLoadingState, { key: 'loading' }));
    return children;
  }

  if (connection.status === 'error' && !groups.length) {
    children.push(h(NotificationErrorState, { error: connection.error, key: 'error' }));
    return children;
  }

  if (!visibleGroups.length) {
    children.push(h(EmptyNotifications, {
      filtered: category !== 'all' && groups.length > 0,
      key: 'empty',
      onPreferences: openNotificationPreferences,
    }));
    return children;
  }

  children.push(...visibleGroups.map((group, index) => h(NotificationItem, {
    group,
    key: group.ids.join(','),
    onClear: (selectedGroup) => clearOne(selectedGroup, index),
    today,
    yesterday,
  })));
  return children;
}

function renderNotifications(list) {
  list.setAttribute('aria-busy', String(notificationConnection.status === 'loading'));
  notificationsRoot.render(list, h(NotificationList, {
    connection: notificationConnection,
    groups: latestNotificationGroups,
  }));
}

function notificationActivityVisible() {
  const panel = document.getElementById('updates-panel');
  const tab = document.getElementById('tab-notifications');
  const list = document.getElementById('notifications-list');
  return Boolean(panel?.classList.contains('open')
    && tab?.getAttribute('aria-selected') === 'true'
    && list?.getAttribute('aria-hidden') !== 'true');
}

function renderNotificationActivity() {
  const list = document.getElementById('notifications-list');
  if (!list || !notificationActivityVisible()) return;
  renderNotifications(list);
}

window.renderNotificationActivity = renderNotificationActivity;

window.renderNotificationSettings = function renderNotificationSettings() {
  const root = document.getElementById('notification-settings-root');
  const modal = document.getElementById('settings-modal');
  const pane = document.getElementById('pane-notifications');
  if (!root || modal?.classList.contains('hidden') || pane?.classList.contains('hidden')) return;
  notificationSettingsRoot.render(root, h(NotificationSettingsPanel, {
    groups: latestNotificationGroups,
    key: activeRoomId(),
  }));
};

window.refreshNotificationPreferences = function refreshNotificationPreferences() {
  window.dispatchEvent(new CustomEvent('minimalist:notification-preferences'));
  window.renderNotificationActivity?.();
  window.renderNotificationSettings?.();
  window.syncPrivateMessageDeliveryPreferences?.();
};

window.stopNotificationListener = function stopNotificationListener({ clearState = false } = {}) {
  notificationUnsubscribe?.();
  notificationUnsubscribe = null;
  notificationListenerUid = null;
  notificationListenerStartedAt = 0;
  seenNotificationSignatures.clear();
  if (clearState) {
    latestNotificationGroups = [];
    notificationConnection = { status: 'idle', error: '', updatedAt: 0 };
    syncUpdatesUnreadIndicator({ activityCount: 0 });
    syncUpdatesPanelStatus();
    renderNotificationActivity();
    window.renderNotificationSettings?.();
  }
};

window.listenForNotifications = function listenForNotifications() {
  const uid = window.currentUser?.uid;
  if (!uid) {
    window.stopNotificationListener({ clearState: true });
    return;
  }
  if (notificationListenerUid === uid && notificationUnsubscribe) return;

  const accountChanged = Boolean(notificationListenerUid && notificationListenerUid !== uid);
  window.stopNotificationListener({ clearState: accountChanged });
  notificationListenerUid = uid;
  notificationListenerStartedAt = Date.now();
  notificationConnection = { status: 'loading', error: '', updatedAt: notificationConnection.updatedAt || 0 };
  seenNotificationSignatures.clear();
  syncUpdatesPanelStatus();
  renderNotificationActivity();

  const recentNotifications = query(
    ref(db, `notifications/${uid}`),
    orderByChild('timestamp'),
    limitToLast(100),
  );
  notificationUnsubscribe = onValue(recentNotifications, (snapshot) => {
    if (notificationListenerUid !== uid || window.currentUser?.uid !== uid) return;
    const nextRawNotifications = snapshot.exists() ? snapshot.val() : null;
    const nextGroups = groupNotifications(nextRawNotifications || {});
    const freshRealtimeAlert = hasFreshRealtimeAlert(nextRawNotifications || {}, nextGroups);

    latestNotificationGroups = nextGroups;
    notificationConnection = { status: 'ready', error: '', updatedAt: Date.now() };
    if (freshRealtimeAlert) window.playPing?.();
    syncUpdatesUnreadIndicator({ activityCount: notificationCount(nextGroups) });
    syncUpdatesPanelStatus();
    renderNotificationActivity();
    window.renderNotificationSettings?.();
  }, (error) => {
    if (notificationListenerUid !== uid || window.currentUser?.uid !== uid) return;
    notificationUnsubscribe = null;
    notificationConnection = {
      status: 'error',
      error: error?.message || 'Unable to connect to notifications.',
      updatedAt: notificationConnection.updatedAt || 0,
    };
    syncUpdatesPanelStatus();
    renderNotificationActivity();
  });
};

window.retryNotificationListener = function retryNotificationListener() {
  window.stopNotificationListener({ clearState: false });
  window.listenForNotifications();
};

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) window.stopNotificationListener?.();
});
