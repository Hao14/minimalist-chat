import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomHome } from './RoomHome.jsx';

let homeRoot = null;

export function mountRoomHome(props) {
  const host = document.getElementById('room-view-home');
  if (!host) return;
  if (!homeRoot) {
    host.replaceChildren();
    homeRoot = createRoot(host);
  }
  homeRoot.render(createElement(RoomHome, { ...props, key: props.roomId }));
}
