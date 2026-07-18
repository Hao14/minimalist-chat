import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { Calls } from './Calls.jsx';

const callsRoot = createHostAwareRoot();

export function mountCalls(props) {
  const host = document.getElementById('room-view-calls');
  if (!host) return;
  callsRoot.render(host, createElement(Calls, {
    ...props,
    key: `${props.roomId}:${props.activeChannelId || 'general'}:${props.enableCallChannelsV2 ? 'v2' : 'v1'}`,
  }));
}
