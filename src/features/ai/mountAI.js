import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { AI } from './AI.jsx';

const aiRoot = createHostAwareRoot();

export function mountAI(props) {
  const host = document.getElementById('room-view-ai');
  if (!host) return;
  aiRoot.render(host, createElement(AI, { ...props, key: `${props.roomId || 'global'}:${props.channelId || 'general'}` }));
}
