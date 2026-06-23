import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { escapeHtml } from '../../lib/text.js';

window.createNotification = async function createNotification(targetUid, type, text, opts = {}) {
  try {
    if (!targetUid || targetUid === window.currentUser?.uid) return;

    const { groupId, from } = opts;
    if (groupId) {
      const key = `${type}_${groupId}`.replace(/[.#$/[\]]/g, '_');
      const notificationRef = ref(db, `notifications/${targetUid}/${key}`);
      const snapshot = await get(notificationRef);
      const count = (snapshot.exists() ? (snapshot.val().count || 1) : 0) + 1;
      await set(notificationRef, { type, text, from: from || null, timestamp: Date.now(), count });
      return;
    }

    await set(push(ref(db, `notifications/${targetUid}`)), { type, text, timestamp: Date.now() });
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
  if (type === 'friend') return ['FRIEND REQUEST', 'ph-bold ph-user-plus'];
  if (type === 'room') return ['ROOM ACTIVITY', 'ph-bold ph-users-three'];
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
      });
    }

    const group = groups.get(key);
    group.count += notification.count || 1;
    group.ids.push(id);
    if ((notification.timestamp || 0) >= group.timestamp) {
      group.timestamp = notification.timestamp || 0;
      group.text = notification.text;
      group.from = notification.from || group.from;
    }
  });

  return [...groups.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function renderNotification(group, today, yesterday) {
  let [title, icon] = notificationTitle(group.type);
  const time = notificationTime(group.timestamp, today, yesterday);
  const count = group.count || 1;
  let mainText = group.text;

  if (count > 1 && group.type === 'message') {
    title = 'NEW MESSAGES';
    mainText = `${count} new messages${group.from ? ` from ${group.from}` : ''}`;
  }

  const countBadge = count > 1
    ? `<span style="background: #FF3B30; color: #fff; font-size: 0.7rem; font-weight: 800; padding: 1px 7px; border-radius: 10px; flex-shrink: 0;">${count}</span>`
    : '';

  return `
    <li class="modern-notif" style="padding: 1.2rem 1.5rem; border-bottom: 2px solid var(--text-color); display: flex; align-items: center; gap: 15px;">
      <i class="${icon}" style="font-size: 1.8rem; color: var(--text-color); flex-shrink: 0;"></i>
      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 10px;">
          <span style="font-size: 0.9rem; font-weight: 800; color: var(--text-color); letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 8px;">${title} ${countBadge}</span>
          <span style="font-size: 0.75rem; font-weight: 800; color: #888; flex-shrink: 0;">${time}</span>
        </div>
        <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(mainText)}</span>
      </div>
      <span onclick="clearNotificationGroup('${group.ids.join(',')}')" class="notif-close-btn" style="font-size: 1.5rem; cursor: pointer; color: var(--text-color); display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 35px; height: 35px; transition: color 0.2s;">
        <i class="ph-bold ph-x"></i>
      </span>
    </li>
  `;
}

window.listenForNotifications = function listenForNotifications() {
  if (!window.currentUser) return;

  onValue(ref(db, `notifications/${window.currentUser.uid}`), (snapshot) => {
    const list = document.getElementById('notifications-list');
    const desktopBell = document.getElementById('open-updates-btn-desktop');
    const mobileBell = document.getElementById('open-updates-btn-mobile');
    if (!list) return;

    if (!snapshot.exists()) {
      if (desktopBell) desktopBell.style.color = 'var(--text-color)';
      if (mobileBell) mobileBell.style.color = 'var(--text-color)';
      list.style.padding = '1.5rem';
      list.innerHTML = `<div style="text-align: center; color: #888; margin-top: 2rem; font-weight: bold;"><i class="ph-bold ph-bell-slash" style="font-size: 3rem; margin-bottom: 1rem; display: block; color: var(--text-color);"></i>You're all caught up!</div>`;
      return;
    }

    if (desktopBell) desktopBell.style.color = '#FF3B30';
    if (mobileBell) mobileBell.style.color = '#FF3B30';
    list.style.padding = '0';
    list.style.gap = '0';

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    list.innerHTML = groupNotifications(snapshot.val())
      .map((group) => renderNotification(group, today, yesterday))
      .join('');
  });
};
