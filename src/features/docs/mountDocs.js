import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Docs } from './Docs.jsx';

let docsRoot = null;

export function mountDocs(props) {
  const host = document.getElementById('room-view-docs');
  if (!host) return;
  if (!docsRoot) {
    host.replaceChildren();
    docsRoot = createRoot(host);
  }
  docsRoot.render(createElement(Docs, { ...props, key: props.roomId }));
}
