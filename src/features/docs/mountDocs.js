import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { Docs } from './Docs.jsx';

const docsRoot = createHostAwareRoot();

export function mountDocs(props) {
  const host = document.getElementById('room-view-docs');
  if (!host) return;
  docsRoot.render(host, createElement(Docs, { ...props, key: props.roomId }));
}
