import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import WelcomeTour from './WelcomeTour.jsx';

window.WELCOME_STEPS = [
  {
    emoji: '👋',
    title: 'Welcome to Rooms!',
    text: "A calm space to chat, collaborate, and connect. Here's a 20-second tour.",
  },
  {
    emoji: '💬',
    title: 'Rooms & chat',
    text: 'Create or join rooms from the sidebar. Each room has chat, docs, a whiteboard, tasks, a calendar, and an AI assistant.',
  },
  {
    emoji: '🏆',
    title: 'Level up',
    text: 'Earn XP across four skill trees, finish daily quests, and climb the leaderboard.',
  },
  {
    emoji: '✨',
    title: "You're all set",
    text: 'Personalize your profile any time from Settings. Enjoy the calm!',
  },
];

let welcomeRoot = null;
let stepIndex = 0;

function closeWelcomeTour() {
  document.getElementById('welcome-tour')?.classList.add('hidden');
  localStorage.setItem('tourSeen', '1');
}

function renderWelcomeTour() {
  const host = document.getElementById('welcome-tour');
  if (!host) return;
  if (!welcomeRoot) welcomeRoot = createRoot(host);

  const step = window.WELCOME_STEPS[stepIndex] || window.WELCOME_STEPS[0];
  welcomeRoot.render(createElement(WelcomeTour, {
    step,
    stepIndex,
    totalSteps: window.WELCOME_STEPS.length,
    onNext: () => {
      if (stepIndex < window.WELCOME_STEPS.length - 1) {
        stepIndex += 1;
        renderWelcomeTour();
        return;
      }
      closeWelcomeTour();
    },
    onSkip: closeWelcomeTour,
  }));
}

window.showWelcomeTour = function showWelcomeTour() {
  const overlay = document.getElementById('welcome-tour');
  if (!overlay) return;

  stepIndex = 0;
  renderWelcomeTour();
  overlay.classList.remove('hidden');
};

window.maybeShowWelcomeTour = function maybeShowWelcomeTour() {
  if (!sessionStorage.getItem('showWelcomeTour')) return;

  sessionStorage.removeItem('showWelcomeTour');
  setTimeout(() => window.showWelcomeTour(), 700);
};
