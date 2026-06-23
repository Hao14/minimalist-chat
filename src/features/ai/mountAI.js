import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AI } from './AI.jsx';

let aiRoot = null;

export function mountAI(props) {
  const host = document.getElementById('room-view-ai');
  if (!host) return;
  if (!aiRoot) {
    host.replaceChildren();
    aiRoot = createRoot(host);
  }
  aiRoot.render(createElement(AI, { ...props, key: props.roomId }));
}
