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

let wtStep = 0;

function renderWtStep() {
  const step = window.WELCOME_STEPS[wtStep];
  if (!step) return;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('wt-emoji', step.emoji);
  setText('wt-title', step.title);
  setText('wt-text', step.text);

  const last = wtStep === window.WELCOME_STEPS.length - 1;
  const next = document.getElementById('wt-next');
  if (next) next.textContent = last ? 'Enter Rooms' : (wtStep === 0 ? 'Take a quick tour' : 'Next');

  const skip = document.getElementById('wt-skip');
  if (skip) skip.style.display = last ? 'none' : '';

  const dots = document.getElementById('wt-dots');
  if (dots) {
    dots.innerHTML = window.WELCOME_STEPS.map(
      (_, index) => `<span class="wt-dot ${index === wtStep ? 'on' : ''}"></span>`,
    ).join('');
  }
}

function closeWelcomeTour() {
  document.getElementById('welcome-tour')?.classList.add('hidden');
  localStorage.setItem('tourSeen', '1');
}

window.showWelcomeTour = function showWelcomeTour() {
  const overlay = document.getElementById('welcome-tour');
  if (!overlay) return;

  wtStep = 0;
  renderWtStep();
  overlay.classList.remove('hidden');
};

document.getElementById('wt-next')?.addEventListener('click', () => {
  if (wtStep < window.WELCOME_STEPS.length - 1) {
    wtStep += 1;
    renderWtStep();
    return;
  }

  closeWelcomeTour();
});

document.getElementById('wt-skip')?.addEventListener('click', closeWelcomeTour);

window.maybeShowWelcomeTour = function maybeShowWelcomeTour() {
  if (!sessionStorage.getItem('showWelcomeTour')) return;

  sessionStorage.removeItem('showWelcomeTour');
  setTimeout(() => window.showWelcomeTour(), 700);
};
