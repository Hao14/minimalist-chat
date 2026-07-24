import { useLayoutEffect } from 'react';

function reducedMotionQuery(query, reduced) {
  return {
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  };
}

export default function StoryEnvironment({ children, context }) {
  const theme = context.globals.theme || 'light';
  const reduced = context.globals.reducedMotion === 'reduce'
    || context.parameters.prefersReducedMotion === 'reduce';

  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const originalMatchMedia = window.matchMedia?.bind(window);
    const originalCapacitor = window.Capacitor;

    body.classList.remove('dark-mode', 'codex-mode', 'modern-mode');
    if (theme === 'dark') body.classList.add('dark-mode');
    if (theme === 'codex') body.classList.add('dark-mode', 'codex-mode');
    root.classList.toggle('prefers-reduced-motion', reduced);

    window.Capacitor = {
      ...originalCapacitor,
      isNativePlatform: () => false,
    };
    window.matchMedia = (query) => {
      if (String(query).includes('prefers-reduced-motion')) {
        return reducedMotionQuery(String(query), reduced);
      }
      return originalMatchMedia
        ? originalMatchMedia(query)
        : reducedMotionQuery(String(query), false);
    };

    return () => {
      body.classList.remove('dark-mode', 'codex-mode', 'modern-mode');
      root.classList.remove('prefers-reduced-motion');
      if (originalMatchMedia) window.matchMedia = originalMatchMedia;
      else delete window.matchMedia;
      if (originalCapacitor === undefined) delete window.Capacitor;
      else window.Capacitor = originalCapacitor;
    };
  }, [reduced, theme]);

  return (
    <div
      className="storybook-environment"
      data-reduced-motion={reduced ? 'true' : 'false'}
      data-theme={theme}
    >
      {children}
    </div>
  );
}
