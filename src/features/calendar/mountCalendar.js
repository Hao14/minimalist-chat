import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { Calendar } from './Calendar.jsx';

const calendarRoot = createHostAwareRoot();

export function mountCalendar(props) {
  const host = document.getElementById('room-view-calendar');
  if (!host) return;
  calendarRoot.render(host, createElement(Calendar, { ...props, key: props.roomId }));
}
