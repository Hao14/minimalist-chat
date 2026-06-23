import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomPages } from './RoomPages.jsx';

let pagesRoot = null;

export function mountRoomPages(props) {
  const host = document.getElementById('room-pages-dynamic');
  const menuHost = document.getElementById('room-add-page-menu');
  if (!host) return;
  if (!pagesRoot) {
    host.replaceChildren();
    pagesRoot = createRoot(host);
  }
  pagesRoot.render(createElement(RoomPages, { ...props, key: props.roomId, menuHost }));
}
