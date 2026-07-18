import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { Search } from './Search.jsx';

function handleSearchBackdropClick(event) {
  if (event.target === event.currentTarget) {
    window.dispatchEvent(new CustomEvent('minimalist:close-search'));
  }
}

const searchRoot = createHostAwareRoot({
  onAttach: (host) => host.addEventListener('click', handleSearchBackdropClick),
  onDetach: (host) => host.removeEventListener('click', handleSearchBackdropClick),
});

export function mountSearch(props) {
  const host = document.getElementById('search-modal');
  if (!host) return;
  searchRoot.render(host, createElement(Search, props));
}
