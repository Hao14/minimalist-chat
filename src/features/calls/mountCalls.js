import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Calls } from './Calls.jsx';

let callsRoot = null;

export function mountCalls(props) {
  const host = document.getElementById('room-view-calls');
  if (!host) return;
  if (!callsRoot) {
    host.replaceChildren();
    callsRoot = createRoot(host);
  }
  callsRoot.render(createElement(Calls, {
    ...props,
    key: `${props.roomId}:${props.activeChannelId || 'general'}:${props.enableCallChannelsV2 ? 'v2' : 'v1'}`,
  }));
}
