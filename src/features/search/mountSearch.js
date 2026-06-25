import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Search } from './Search.jsx';

let searchRoot = null;

export function mountSearch(props) {
  const host = document.getElementById('search-modal');
  if (!host) return;
  if (!searchRoot) {
    host.replaceChildren();
    host.addEventListener('click', (event) => {
      if (event.target === host) {
        window.dispatchEvent(new CustomEvent('minimalist:close-search'));
      }
    });
    searchRoot = createRoot(host);
  }
  searchRoot.render(createElement(Search, props));
}
