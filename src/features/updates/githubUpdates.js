import { escapeHtml } from '../../lib/text.js';

window.fetchGitHubUpdates = async function fetchGitHubUpdates() {
  const list = document.getElementById('updates-list');
  if (!list) return;

  list.innerHTML = '<li style="padding: 2rem; text-align: center; font-weight: 800; animation: textPulse 1.5s infinite;">PULLING COMMITS...</li>';

  try {
    const response = await fetch('https://api.github.com/repos/Hao14/minimalist-chat/commits?per_page=15');
    if (!response.ok) throw new Error('Failed to fetch GitHub data');

    const commits = await response.json();
    list.innerHTML = commits.map((commitObj) => {
      const message = commitObj.commit?.message || 'Update';
      const msgLines = message.split('\n');
      const description = msgLines.slice(1).join('\n').trim();
      const descHtml = description ? `<div class="update-desc">${escapeHtml(description)}</div>` : '';
      const authorName = commitObj.commit?.author?.name || 'Dev';
      const avatar = commitObj.author?.avatar_url || 'https://ui-avatars.com/api/?name=Dev&background=000&color=FFD700';
      const date = commitObj.commit?.author?.date ? new Date(commitObj.commit.author.date) : new Date();

      return `<li class="update-card fade-in-up"><div class="update-date">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div><div class="update-title">${escapeHtml(msgLines[0])}</div>${descHtml}<div class="update-author"><img src="${escapeHtml(avatar)}" alt=""> ${escapeHtml(authorName)}</div></li>`;
    }).join('');
  } catch {
    list.innerHTML = '<li style="padding: 2rem; text-align: center; color: red; border: 4px solid red; font-weight: bold;">CONNECTION FAILED.</li>';
  }
};
