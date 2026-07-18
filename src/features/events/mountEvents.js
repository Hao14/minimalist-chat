import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { Events } from './Events.jsx';

const eventsRoot = createHostAwareRoot();

export function mountEvents(props) {
  const host = document.getElementById('room-view-events');
  if (!host) return;
  eventsRoot.render(host, createElement(Events, props));
}
