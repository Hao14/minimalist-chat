import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Calendar } from './Calendar.jsx';

let calendarRoot = null;

export function mountCalendar(props) {
  const host = document.getElementById('room-view-calendar');
  if (!host) return;
  if (!calendarRoot) {
    host.replaceChildren();
    calendarRoot = createRoot(host);
  }
  calendarRoot.render(createElement(Calendar, { ...props, key: props.roomId }));
}
