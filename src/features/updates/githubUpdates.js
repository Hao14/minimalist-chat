import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import UpdatesList from './UpdatesList.jsx';

let updatesRoot = null;

function renderUpdates(payload) {
  const list = document.getElementById('updates-list');
  if (!list) return;
  if (!updatesRoot) updatesRoot = createRoot(list);
  updatesRoot.render(createElement(UpdatesList, payload));
}

window.fetchGitHubUpdates = async function fetchGitHubUpdates() {
  renderUpdates({ status: 'loading' });

  try {
    const response = await fetch('https://api.github.com/repos/Hao14/minimalist-chat/commits?per_page=15');
    if (!response.ok) throw new Error('Failed to fetch GitHub data');

    const commits = await response.json();
    renderUpdates({ status: 'ready', commits });
  } catch (error) {
    renderUpdates({ status: 'error', error: error.message || 'CONNECTION FAILED.' });
  }
};
