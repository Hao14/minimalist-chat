import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Whiteboard } from './Whiteboard.jsx';

let whiteboardRoot = null;

export function mountWhiteboard(props) {
  const host = document.getElementById('room-view-whiteboard');
  if (!host) return;
  if (!whiteboardRoot) {
    host.replaceChildren();
    whiteboardRoot = createRoot(host);
  }
  whiteboardRoot.render(createElement(Whiteboard, props));
}
