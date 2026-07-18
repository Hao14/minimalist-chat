import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { RoomPages } from './RoomPages.jsx';

const pagesRoot = createHostAwareRoot();

export function mountRoomPages(props) {
  const host = document.getElementById('room-pages-dynamic');
  const menuHost = document.getElementById('room-add-page-menu');
  if (!host) return;
  pagesRoot.render(host, createElement(RoomPages, { ...props, key: props.roomId, menuHost }));
}
