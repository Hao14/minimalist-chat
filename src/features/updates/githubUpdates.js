import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import UpdatesList from './UpdatesList.jsx';

const updatesRoot = createHostAwareRoot();
let updatesCache = null;
let updatesRequest = null;
let updatesAbortController = null;
let updatesRequestVersion = 0;
const UPDATES_CACHE_TTL_MS = 5 * 60 * 1000;

function updatesViewVisible() {
  const panel = document.getElementById('updates-panel');
  const tab = document.getElementById('tab-changelog');
  const list = document.getElementById('updates-list');
  return Boolean(panel?.classList.contains('open')
    && tab?.getAttribute('aria-selected') === 'true'
    && list?.getAttribute('aria-hidden') !== 'true');
}

function renderUpdates(payload) {
  const list = document.getElementById('updates-list');
  if (!list || !updatesViewVisible()) return;
  list.setAttribute('aria-busy', String(payload.status === 'loading'));
  updatesRoot.render(list, createElement(UpdatesList, {
    ...payload,
    onRetry: () => window.fetchGitHubUpdates?.({ force: true }),
  }));
}

window.stopGitHubUpdates = function stopGitHubUpdates() {
  updatesRequestVersion += 1;
  updatesAbortController?.abort();
  updatesAbortController = null;
  updatesRequest = null;
};

window.fetchGitHubUpdates = function fetchGitHubUpdates({ force = false } = {}) {
  const cacheIsFresh = !force && updatesCache && Date.now() - updatesCache.loadedAt < UPDATES_CACHE_TTL_MS;
  if (cacheIsFresh) {
    renderUpdates({ status: 'ready', commits: updatesCache.commits });
    return Promise.resolve(updatesCache.commits);
  }
  if (updatesRequest) return updatesRequest.promise;

  if (updatesCache?.commits?.length) {
    renderUpdates({ status: 'loading', commits: updatesCache.commits, cached: true });
  } else {
    renderUpdates({ status: 'loading', commits: [] });
  }

  const requestId = ++updatesRequestVersion;
  const controller = new AbortController();
  updatesAbortController = controller;
  const promise = fetch('https://api.github.com/repos/Hao14/minimalist-chat/commits?per_page=15', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('The changelog service did not respond.');
      const commits = await response.json();
      if (!Array.isArray(commits)) throw new Error('The changelog returned an invalid response.');
      if (requestId !== updatesRequestVersion) return updatesCache?.commits || [];

      updatesCache = { commits, loadedAt: Date.now() };
      renderUpdates({ status: 'ready', commits });
      return commits;
    })
    .catch((error) => {
      if (requestId !== updatesRequestVersion || error?.name === 'AbortError') return updatesCache?.commits || [];
      if (updatesCache?.commits?.length) {
        renderUpdates({
          status: 'ready',
          commits: updatesCache.commits,
          cached: true,
          error: error.message || 'Unable to refresh product updates.',
        });
        return updatesCache.commits;
      }
      renderUpdates({ status: 'error', commits: [], error: error.message || 'Unable to refresh product updates.' });
      return [];
    })
    .finally(() => {
      if (updatesRequest?.id === requestId) updatesRequest = null;
      if (updatesAbortController === controller) updatesAbortController = null;
    });
  updatesRequest = { id: requestId, promise };
  return promise;
};
