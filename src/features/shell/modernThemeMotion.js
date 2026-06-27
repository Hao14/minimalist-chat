const REVEAL_SELECTORS = [
  '#desktop-room-sidebar .room-item',
  '#room-sub-nav .room-tab',
  '#main-chat-area .room-view.active > *',
  '.rh-stat',
  '.rh-panel',
  '.rh-resource-box',
  '.rh-event',
  '.doc-card',
  '.docs-google-editor',
  '.task-column',
  '.event-card',
  '.cal-day',
  '.call-card',
  '.vault-card',
  '.vault-library',
  '.vault-redesign > *',
  '.settings-card',
  '.updates-panel-card',
  '.quest-card',
  '.leaderboard-card',
  '.recognition-card',
].join(',');

const isModernTheme = () => document.body.classList.contains('modern-mode');

export function initModernThemeMotion() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  const body = document.body;
  const reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduceMotion = () => Boolean(reduceMotionQuery?.matches);

  let enabled = false;
  let revealTimer = 0;
  let tabRail = null;
  let resizeObserver = null;
  let revealObserver = null;
  let mutationObserver = null;
  let themeObserver = null;

  const syncStaticAmbientVars = () => {
    root.style.setProperty('--modern-pointer-x', '72vw');
    root.style.setProperty('--modern-pointer-y', '14vh');
    root.style.setProperty('--modern-pointer-x-pct', '72%');
    root.style.setProperty('--modern-pointer-y-pct', '14%');
    root.style.setProperty('--modern-tilt-x', '0');
    root.style.setProperty('--modern-tilt-y', '0');
    root.style.setProperty('--modern-tab-pointer-x', '-999px');
    root.style.setProperty('--modern-tab-pointer-y', '50%');
    root.style.setProperty('--modern-aurora-angle', '0deg');
    root.style.setProperty('--modern-pulse', '0.35');
  };

  const detachTabRail = () => {
    resizeObserver?.disconnect();
    tabRail = null;
    resizeObserver = null;
  };

  const attachTabRail = () => {
    const nextRail = document.getElementById('room-sub-nav');
    if (!nextRail || nextRail === tabRail) return;
    detachTabRail();
    tabRail = nextRail;
    tabRail.style.setProperty('--modern-tab-pointer-x', '-999px');
    tabRail.style.setProperty('--modern-tab-pointer-y', '50%');

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        tabRail?.style.setProperty('--modern-tab-width', `${tabRail.clientWidth}px`);
      });
      resizeObserver.observe(tabRail);
    }
  };

  const setupRevealObserver = () => {
    revealObserver?.disconnect();

    if (reduceMotion() || !enabled) return;

    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('modern-reveal-in');
            revealObserver?.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );

    const targets = Array.from(document.querySelectorAll(REVEAL_SELECTORS))
      .filter((element) => element instanceof HTMLElement && !element.closest('[hidden]'));

    targets.forEach((element, index) => {
      element.classList.add('modern-reveal-target');
      element.style.setProperty('--modern-reveal-delay', `${Math.min(index, 12) * 22}ms`);
      revealObserver.observe(element);
    });
  };

  const scheduleRevealSetup = () => {
    window.clearTimeout(revealTimer);
    revealTimer = window.setTimeout(() => {
      attachTabRail();
      setupRevealObserver();
    }, 90);
  };

  const start = () => {
    if (enabled || !isModernTheme()) return;
    // Skip the ambient-motion machinery on phones (the rAF loop + reveal/mutation
    // observers add scroll overhead, and mobile.css hides the effects they drive).
    if (window.matchMedia?.('(max-width: 768px)')?.matches) return;
    enabled = true;
    body.classList.add('modern-motion-ready');
    window.addEventListener('resize', syncStaticAmbientVars, { passive: true });
    syncStaticAmbientVars();
    attachTabRail();
    scheduleRevealSetup();

    mutationObserver = new MutationObserver(scheduleRevealSetup);
    mutationObserver.observe(document.getElementById('root') || body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  };

  const stop = () => {
    if (!enabled) return;
    enabled = false;
    body.classList.remove('modern-motion-ready');
    window.removeEventListener('resize', syncStaticAmbientVars);
    window.clearTimeout(revealTimer);
    mutationObserver?.disconnect();
    mutationObserver = null;
    revealObserver?.disconnect();
    revealObserver = null;
    detachTabRail();
  };

  const syncThemeState = () => {
    if (isModernTheme()) start();
    else stop();
  };

  themeObserver = new MutationObserver(syncThemeState);
  themeObserver.observe(body, { attributes: true, attributeFilter: ['class'] });

  reduceMotionQuery?.addEventListener?.('change', () => {
    stop();
    syncThemeState();
  });

  syncThemeState();

  return () => {
    stop();
    themeObserver?.disconnect();
  };
}
