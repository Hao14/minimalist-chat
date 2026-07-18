import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { RoomHome } from './RoomHome.jsx';

const homeRoot = createHostAwareRoot();

export function mountRoomHome(props) {
  const host = document.getElementById('room-view-home');
  if (!host) return;
  homeRoot.render(host, createElement(RoomHome, { ...props, key: props.roomId }));
}
