import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { Whiteboard } from './Whiteboard.jsx';

const whiteboardRoot = createHostAwareRoot();

export function mountWhiteboard(props) {
  const host = document.getElementById('room-view-whiteboard');
  if (!host) return;
  whiteboardRoot.render(host, createElement(Whiteboard, { ...props, key: props.roomId || 'global' }));
}
