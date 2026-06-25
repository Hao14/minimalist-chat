import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import WelcomeTour from './WelcomeTour.jsx';

// Each step points at a real element. Steps whose target is hidden (e.g. the
// room tool tabs while in Simple Mode) are skipped automatically by the tour.
const TOUR_STEPS = [
  {
    target: '#desktop-room-sidebar',
    placement: 'right',
    emoji: '🚪',
    title: 'Your rooms',
    text: 'Every conversation lives in a room. Hop between them here — favorites stay pinned to the top.',
  },
  {
    target: '#create-room-btn',
    placement: 'right',
    emoji: '➕',
    title: 'Start something new',
    text: 'Spin up a room for a team, class, club, or community in seconds. Make it private or public.',
  },
  {
    target: '#room-sub-nav',
    placement: 'bottom',
    emoji: '🧰',
    title: 'Room tools',
    text: 'Chat is just the start. Docs, tasks, whiteboard, calendar, and an AI assistant all live up here.',
    // These tools only appear in Power Mode, so skip this step in Simple Mode.
    when: () => window.getFeatureMode?.() === 'power',
  },
  {
    target: '#message-input',
    placement: 'top',
    emoji: '✍️',
    title: 'Say hello',
    text: 'Type a message, drop a file, or paste code — Markdown and syntax highlighting just work.',
    // The composer lives in the chat view, so make sure it's active first.
    before: () => window.activateRoomView?.('chat'),
  },
  {
    target: '#open-search-btn',
    placement: 'right',
    emoji: '🔍',
    title: 'Find anything',
    text: 'Search across rooms, people, and messages — everything you have access to, in one place.',
  },
  {
    target: '#open-settings-btn',
    placement: 'right',
    emoji: '⚙️',
    title: 'Make it yours',
    text: 'Themes, your profile, and switching between Simple and Power Mode all live in Settings.',
  },
];

let welcomeRoot = null;

function closeWelcomeTour() {
  document.getElementById('welcome-tour')?.classList.add('hidden');
  try { localStorage.setItem('tourSeen', '1'); } catch { /* storage may be unavailable */ }
}

window.showWelcomeTour = function showWelcomeTour() {
  const overlay = document.getElementById('welcome-tour');
  if (!overlay) return;

  if (!welcomeRoot) welcomeRoot = createRoot(overlay);
  // A fresh key remounts the tour so it always starts at the mode chooser.
  welcomeRoot.render(createElement(WelcomeTour, { key: Date.now(), steps: TOUR_STEPS, onClose: closeWelcomeTour }));
  overlay.classList.remove('hidden');
};

window.maybeShowWelcomeTour = function maybeShowWelcomeTour() {
  if (!sessionStorage.getItem('showWelcomeTour')) return;

  sessionStorage.removeItem('showWelcomeTour');
  setTimeout(() => window.showWelcomeTour(), 600);
};
