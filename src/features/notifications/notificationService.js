import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { createElement, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../lib/firebase.js';

const h = createElement;
let notificationsRoot = null;

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
      className: 'modern-notif',
      style: {
        padding: '1.2rem 1.5rem',
        borderBottom: '2px solid var(--text-color)',
        display: 'flex',
        alignItems: 'center',
        gap: 15,
      },
    },
    h('i', {
      className: icon,
      style: {
        fontSize: '1.8rem',
        color: 'var(--text-color)',
        flexShrink: 0,
      },
    }),
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 4,
            gap: 10,
          },
        },
        h(
          'span',
          {
            style: {
              fontSize: '0.9rem',
              fontWeight: 800,
              color: 'var(--text-color)',
              letterSpacing: '0.5px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            },
          },
          title,
          count > 1
            ? h(
              'span',
              {
                style: {
                  background: '#FF3B30',
                  color: '#fff',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '1px 7px',
                  borderRadius: 10,
                  flexShrink: 0,
                },
              },
              count,
            )
            : null,
        ),
        h(
          'span',
          {
            style: {
              fontSize: '0.75rem',
              fontWeight: 800,
              color: '#888',
              flexShrink: 0,
            },
          },
          time,
        ),
      ),
      h(
        'span',
        {
          style: {
            fontSize: '0.95rem',
            fontWeight: 600,
            color: 'var(--text-color)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        mainText,
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'notif-close-btn',
        'aria-label': 'Clear notification',
        onClick: () => window.clearNotificationGroup(group.ids.join(',')),
        style: {
          fontSize: '1.5rem',
          cursor: 'pointer',
          color: 'var(--text-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 35,
          height: 35,
          transition: 'color 0.2s',
          border: 0,
          background: 'transparent',
          boxShadow: 'none',
          margin: 0,
          padding: 0,
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

function NotificationList({ rawNotifications }) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = useMemo(() => (rawNotifications ? groupNotifications(rawNotifications) : []), [rawNotifications]);

  if (!groups.length) return h(EmptyNotifications);

  return groups.map((group) => h(NotificationItem, {
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
      renderNotifications(list, null);
      return;
    }

    if (desktopBell) desktopBell.style.color = '#FF3B30';
    if (mobileBell) mobileBell.style.color = '#FF3B30';
    list.style.padding = '0';
    list.style.gap = '0';

    renderNotifications(list, snapshot.val());
  });
};
