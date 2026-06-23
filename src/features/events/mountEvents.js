import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Events } from './Events.jsx';

let eventsRoot = null;

export function mountEvents(props) {
  const host = document.getElementById('room-view-events');
  if (!host) return;
  if (!eventsRoot) {
    host.replaceChildren();
    eventsRoot = createRoot(host);
  }
  eventsRoot.render(createElement(Events, props));
}
