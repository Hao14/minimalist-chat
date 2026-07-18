import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  accountPlans,
  faqItems,
  pricingPageMeta,
  roomSubscriptionPlans,
} from '../content/marketingContent.js';
import {
  AUTH_PRESENCE_HINT_EVENT,
  AUTH_PRESENCE_HINT_KEY,
  readAuthPresenceHint,
} from '../lib/authPresenceHint.js';

const MARKETING_REVEAL_SELECTOR = [
  '.lp-hero',
  '.landing-workflow',
  '.landing-signal',
  '.landing-close',
  '.landing-workflow-state',
  '.landing-signal-preview',
  '.landing-plans-rail',
  '.feat-hero',
  '.feat-mode-panel',
  '.feat-nav',
  '.feat-card',
  '.feat-power-tools',
  '.feat-cta',
  '.dl-hero',
  '.dl-highlight',
  '.dl-card',
  '.dl-section',
  '.dl-step',
  '.dl-faq-item',
  '.story-hero',
  '.story-manifesto',
  '.story-card',
  '.story-timeline article',
  '.mkt4-hero',
  '.mkt4-section-heading',
  '.mkt4-explorer',
  '.mkt4-room-flow',
  '.mkt4-platform-workbench',
  '.mkt4-install-rail',
  '.mkt4-story-manifesto',
  '.mkt4-story-stage',
  '.mkt4-principle-row',
  '.mkt4-faq-row',
  '.mkt4-legal-section',
  '.mkt4-close',
].join(',');

const marketingMotionPathKeys = new Set([
  '/',
  '/features',
  '/pricing',
  '/download',
  '/story',
  '/faq',
  '/privacy',
  '/terms',
  '/404',
]);

// Unknown public URLs share the 404 key, keeping this bounded while preventing
// a page's entrance sequence from replaying on every in-app revisit.
const animatedMarketingPaths = new Set();

function marketingMotionPathKey(pathname) {
  return marketingMotionPathKeys.has(pathname) ? pathname : '/404';
}

const marketingNavItems = [
  ['/features', 'Features'],
  ['/download', 'Download'],
  ['/story', 'Story'],
];

function Brand() {
  return (
    <Link to="/" id="nav-logo" aria-label="Minimalist home">
      <div className="mascot-blip"><div className="blip-eye left" /><div className="blip-eye right" /></div>
      <span className="logo-text">MINIMALIST</span>
    </Link>
  );
}

function CtaArrowIcon() {
  return (
    <svg className="nav-cta-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.5 12h11" fill="none" stroke="currentColor" strokeWidth="2.9" strokeLinecap="round" />
      <path d="m13.5 7.8 4.2 4.2-4.2 4.2" fill="none" stroke="currentColor" strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useMarketingMotion() {
  const { pathname } = useLocation();
  const motionPathKey = marketingMotionPathKey(pathname);
  const [playNavigationIntro] = useState(() => (
    !animatedMarketingPaths.has(motionPathKey)
      && !(pathname === '/' && document.getElementById('static-home-shell'))
  ));

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const playRevealMotion = !animatedMarketingPaths.has(motionPathKey);
    animatedMarketingPaths.add(motionPathKey);
    const revealed = new WeakSet();
    let revealOrder = 0;

    const markVisible = (element) => {
      element.classList.add('is-in-view');
    };

    const observer = reduceMotion || !playRevealMotion
      ? null
      : new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          markVisible(entry.target);
          observer.unobserve(entry.target);
        });
      }, {
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.12,
      });

    const attachReveal = () => {
      document.querySelectorAll(MARKETING_REVEAL_SELECTOR).forEach((element) => {
        if (revealed.has(element)) return;
        revealed.add(element);
        element.style.setProperty('--reveal-order', `${revealOrder % 9}`);
        revealOrder += 1;
        if (reduceMotion || !playRevealMotion) {
          markVisible(element);
          return;
        }
        element.classList.add('mkt-reveal');
        observer?.observe(element);
      });
    };

    const onAnchorClick = (event) => {
      const anchor = event.target.closest?.('a[href^="#"]');
      if (!anchor) return;
      const target = document.querySelector(anchor.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    };

    attachReveal();
    document.addEventListener('click', onAnchorClick);
    window.addEventListener(FEATURE_MODE_EVENT, attachReveal);

    return () => {
      observer?.disconnect();
      document.removeEventListener('click', onAnchorClick);
      window.removeEventListener(FEATURE_MODE_EVENT, attachReveal);
    };
  }, [motionPathKey]);

  return playNavigationIntro;
}

function MarketingHeader({ playEntryMotion = false }) {
  const location = useLocation();
  const activePath = location.pathname === '/'
    ? '/'
    : location.pathname.replace(/\/+$/, '');
  const navRef = useRef(null);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authPresentation, setAuthPresentation] = useState(() => {
    const signedIn = readAuthPresenceHint();
    return { resolved: signedIn !== null, signedIn: Boolean(signedIn) };
  });

  useEffect(() => {
    const updatePresentation = (signedIn) => {
      setAuthPresentation({ resolved: true, signedIn: Boolean(signedIn) });
    };
    const handleHint = (event) => updatePresentation(Boolean(event.detail?.present));
    const handleStorage = (event) => {
      if (event.key === AUTH_PRESENCE_HINT_KEY) updatePresentation(event.newValue === '1');
    };
    window.addEventListener(AUTH_PRESENCE_HINT_EVENT, handleHint);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(AUTH_PRESENCE_HINT_EVENT, handleHint);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const showLogin = authPresentation.resolved && !authPresentation.signedIn;

  useEffect(() => {
    if (!menuOpen) return undefined;

    const firstLink = menuRef.current?.querySelector('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    firstLink?.focus();

    const handlePointerDown = (event) => {
      if (navRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };

    const handleFocusIn = (event) => {
      if (navRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <nav
      ref={navRef}
      className={playEntryMotion ? 'marketing-nav-enter' : undefined}
      aria-label="Primary"
    >
      <div className="marketing-nav-shell">
        <Brand />
        <div className="desktop-nav">
          <div className="marketing-nav-links" aria-label="Marketing pages">
            {marketingNavItems.map(([path, label]) => (
              <Link
                key={path}
                to={path}
                className={activePath === path ? 'active' : ''}
                aria-current={activePath === path ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="marketing-nav-actions">
            {showLogin ? <Link to="/login" reloadDocument className="nav-login-link">Log in</Link> : null}
            <Link to="/chat" reloadDocument className="nav-cta">
              <span>Open the app</span>
              <span className="nav-cta-icon"><CtaArrowIcon /></span>
            </Link>
          </div>
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          id="mobile-menu-btn"
          className="mobile-only nav-btn"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="marketing-mobile-nav-links"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span>Menu</span>
          <span className="nav-menu-icon" aria-hidden="true"><i /><i /></span>
        </button>
        <div
          ref={menuRef}
          id="marketing-mobile-nav-links"
          className={`mobile-only marketing-mobile-nav-links ${menuOpen ? 'is-open' : ''}`}
          aria-hidden={!menuOpen}
        >
          {marketingNavItems.map(([path, label]) => (
            <Link
              key={path}
              to={path}
              className={`mobile-link ${activePath === path ? 'active' : ''}`}
              aria-current={activePath === path ? 'page' : undefined}
              tabIndex={menuOpen ? undefined : -1}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
          {showLogin ? <Link to="/login" reloadDocument className="mobile-link" tabIndex={menuOpen ? undefined : -1} onClick={() => setMenuOpen(false)}>Log in</Link> : null}
          <Link to="/chat" reloadDocument className="mobile-link mobile-signup-link" tabIndex={menuOpen ? undefined : -1} onClick={() => setMenuOpen(false)}>
            <span>Open the app</span>
            <span className="nav-cta-icon"><CtaArrowIcon /></span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="footer-shell">
        <div className="footer-brand">
          <Link to="/" className="footer-logo" aria-label="Minimalist home">
            <div className="mascot-blip footer-blip"><div className="blip-eye left" /><div className="blip-eye right" /></div>
            <span>MINIMALIST</span>
          </Link>
          <p>Calm rooms for friends, teams, students, creators, clubs, and communities.</p>
          <Link className="footer-primary-link" to="/chat" reloadDocument>Create your first room <i className="ph-bold ph-arrow-right" /></Link>
        </div>

        <div className="footer-grid" aria-label="Footer navigation">
          <div className="footer-col">
            <h2>Product</h2>
            <Link to="/">Home</Link>
            <Link to="/features">Features</Link>
            <Link to="/download">Download</Link>
            <Link to="/story">Story</Link>
          </div>
          <div className="footer-col">
            <h2>Support</h2>
            <Link to="/faq">FAQ</Link>
            <a href="mailto:support@minimalist.com">Contact</a>
            <a href="https://github.com/Hao14/minimalist-chat/issues" target="_blank" rel="noopener noreferrer">Bug Report</a>
          </div>
          <div className="footer-col">
            <h2>Legal</h2>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <span className="footer-status"><span aria-hidden="true" /> Web app online</span>
        <span>© 2026 Minimalist.chat</span>
        <span>Built for calmer rooms</span>
      </div>
    </footer>
  );
}

const DEFAULT_META_DESCRIPTION = 'Minimalist.chat is the calm, organized rooms platform with Catch-Me-Up digests, focus modes, decisions, action items, scheduled messages, and offline-first reading.';
const DEFAULT_META_TITLE = 'Minimalist.chat | Calm, organized rooms';
const SITE_ORIGIN = 'https://minimalist.chat';
const PAGE_STRUCTURED_DATA_ID = 'minimalist-page-structured-data';
const FAQ_PAGE_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_ORIGIN}/faq#faq`,
  url: `${SITE_ORIGIN}/faq`,
  mainEntity: faqItems.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.answer,
    },
  })),
};

function upsertMeta(selector, createAttrs, valueAttr, value) {
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    Object.entries(createAttrs).forEach(([key, attrValue]) => tag.setAttribute(key, attrValue));
    document.head.appendChild(tag);
  }
  tag.setAttribute(valueAttr, value);
}

function upsertCanonical(href) {
  let tag = document.head.querySelector('link[rel="canonical"]');
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', 'canonical');
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

function applyRobotsMeta(noindex) {
  const existing = document.head.querySelector('meta[name="robots"]');
  if (!noindex) {
    if (existing?.getAttribute('content')?.toLowerCase().includes('noindex')) existing.remove();
    return;
  }

  const tag = existing || document.createElement('meta');
  tag.setAttribute('name', 'robots');
  tag.setAttribute('content', 'noindex,follow');
  if (!existing) document.head.appendChild(tag);
}

function applyPageStructuredData(value) {
  let tag = document.getElementById(PAGE_STRUCTURED_DATA_ID);
  if (!value) {
    tag?.remove();
    return;
  }

  if (!tag) {
    tag = document.createElement('script');
    tag.id = PAGE_STRUCTURED_DATA_ID;
    tag.type = 'application/ld+json';
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify(value).replaceAll('<', '\\u003c');
}

function canonicalUrlForPath(pathname) {
  const trimmedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  return new URL(trimmedPath || '/', SITE_ORIGIN).href;
}

function applyPageMeta({ title, description = DEFAULT_META_DESCRIPTION, canonical = true, noindex = false }) {
  const canonicalUrl = canonicalUrlForPath(window.location.pathname);
  document.title = title || DEFAULT_META_TITLE;
  upsertMeta('meta[name="description"]', { name: 'description' }, 'content', description);
  upsertMeta('meta[property="og:title"]', { property: 'og:title' }, 'content', title || DEFAULT_META_TITLE);
  upsertMeta('meta[property="og:description"]', { property: 'og:description' }, 'content', description);
  upsertMeta('meta[property="og:type"]', { property: 'og:type' }, 'content', 'website');
  if (canonical) upsertMeta('meta[property="og:url"]', { property: 'og:url' }, 'content', canonicalUrl);
  else document.head.querySelector('meta[property="og:url"]')?.remove();
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, 'content', 'Minimalist.chat');
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'content', 'summary');
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, 'content', title || DEFAULT_META_TITLE);
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, 'content', description);
  if (canonical) upsertCanonical(canonicalUrl);
  else document.head.querySelector('link[rel="canonical"]')?.remove();
  applyRobotsMeta(noindex);
}

function MarketingShell({
  title,
  children,
  shape = 'yellow-circle',
  description = DEFAULT_META_DESCRIPTION,
  structuredData = null,
  canonical = true,
  noindex = false,
}) {
  const playNavigationIntro = useMarketingMotion();

  useEffect(() => {
    const oldTitle = document.title;
    const oldClass = document.body.className;
    const oldStyle = document.body.getAttribute('style');
    const previousDescription = document.querySelector('meta[name="description"]')?.getAttribute('content');
    applyPageMeta({ title, description, canonical, noindex });
    applyPageStructuredData(structuredData);
    document.body.className = 'marketing marketing-scroll';
    document.body.removeAttribute('style');
    window.dispatchEvent(new Event('minimalist:marketing-mounted'));
    return () => {
      document.title = oldTitle;
      if (previousDescription) document.querySelector('meta[name="description"]')?.setAttribute('content', previousDescription);
      document.body.className = oldClass;
      if (oldStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', oldStyle);
    };
  }, [title, description, structuredData, canonical, noindex]);

  return (
    <>
      {shape ? <div className={`shape ${shape}`} /> : null}
      <MarketingHeader playEntryMotion={playNavigationIntro} />
      {children}
      <MarketingFooter />
    </>
  );
}

function Toast({ message, onClose, icon = '📦' }) {
  return (
    <div id="brutalist-toast" className={message ? '' : 'toast-hidden'} role="status" aria-live="polite" aria-hidden={!message} hidden={!message}>
      <span id="toast-icon">{icon}</span>
      <span id="toast-message">{message}</span>
      <button type="button" id="toast-close" aria-label="Close notification" tabIndex={message ? 0 : -1} onClick={onClose}>✖</button>
    </div>
  );
}

const landingDemoRooms = [
  { key: 'global', name: 'Global Chat', icon: 'ph-globe', preview: 'Welcome to the server.' },
  { key: 'home', name: 'HOME', icon: 'ph-house', preview: 'AI Agent: Your catch-up is ready.', favorite: true },
];

const landingDemoMessages = {
  global: [
    { id: 'global-1', author: 'Mina', initials: 'MI', time: '10:08 AM', text: 'Welcome! The new room guide is pinned above.' },
    { id: 'global-2', author: 'You', initials: 'YO', time: '10:11 AM', text: 'Perfect — I found everything.', self: true },
  ],
  home: [
    { id: 'home-ai', author: 'AI Agent', initials: 'AA', time: '12:18 AM', text: 'Welcome to HOME. I can summarize the chat, explain shared notes, and turn the conversation into next steps.', ai: true },
    { id: 'home-1', author: 'wane', initials: 'WA', time: '10:01 AM', text: 'I added the study outline and tonight’s checklist.', self: true },
  ],
};

const landingDemoTabs = [
  ['home', 'Home', 'ph-house'],
  ['chat', 'Chat', 'ph-chat-circle-text'],
  ['docs', 'Docs', 'ph-file-text'],
  ['whiteboard', 'Whiteboard', 'ph-palette'],
  ['tasks', 'Tasks', 'ph-check-square'],
  ['events', 'Events', 'ph-calendar-dots'],
  ['calendar', 'Calendar', 'ph-calendar-blank'],
  ['ai', 'AI', 'ph-sparkle'],
  ['calls', 'Calls', 'ph-phone-call'],
];

const landingDemoChannels = ['general', 'banana', 'oops'];

const landingCatchUpItems = [
  'The study outline was added.',
  'Review starts tonight at 7 PM.',
  'One checklist still needs an owner.',
];

const landingQuickReplies = [
  'Thanks, glad to be here.',
  'Can you summarize the room?',
  'Show me the next steps.',
];

const simpleFeatures = [
  'Rooms',
  'Quiet messages',
  'Catch-Me-Up',
  'Offline reading',
  'Search',
];

const powerFeatures = [
  'Decisions',
  'Action Items',
  'Scheduled Messages',
  'Room Templates',
  'Role Onboarding',
  'Events',
  'Wiki',
  'Moderation',
  'Integrations',
  'Room Memory',
];

const FEATURE_MODE_KEY = 'minimalistMarketingMode';
const FEATURE_MODE_EVENT = 'minimalist:marketing-mode';

const featureModeMeta = {
  simple: {
    label: 'Simple Mode',
    shortLabel: 'Simple',
    helper: 'calm essentials',
    title: 'Simple Mode stays quiet by default.',
    copy: 'Visitors see the calm loop first: a room, readable messages, Catch-Me-Up digests, offline-first reading, and search. No wall of tools before they feel organized.',
    list: simpleFeatures,
  },
  power: {
    label: 'Power Mode',
    shortLabel: 'Power',
    helper: 'organized follow-through',
    title: 'Power Mode adds structure when the room grows.',
    copy: 'When groups need depth, Minimalist reveals decisions, action items, scheduled messages, room templates, role onboarding, events, wiki, moderation, integrations, and memory.',
    list: powerFeatures,
  },
};

function normalizeFeatureMode(value) {
  return value === 'power' ? 'power' : 'simple';
}

function readFeatureMode() {
  try {
    return normalizeFeatureMode(window.localStorage.getItem(FEATURE_MODE_KEY));
  } catch {
    return 'simple';
  }
}

function useMarketingFeatureMode() {
  const [mode, setModeState] = useState(readFeatureMode);

  useEffect(() => {
    const syncFromStorage = () => setModeState(readFeatureMode());
    const syncFromEvent = (event) => setModeState(normalizeFeatureMode(event.detail?.mode));

    window.addEventListener('storage', syncFromStorage);
    window.addEventListener(FEATURE_MODE_EVENT, syncFromEvent);
    return () => {
      window.removeEventListener('storage', syncFromStorage);
      window.removeEventListener(FEATURE_MODE_EVENT, syncFromEvent);
    };
  }, []);

  const setMode = (nextMode) => {
    const normalized = normalizeFeatureMode(nextMode);
    setModeState(normalized);
    try {
      window.localStorage.setItem(FEATURE_MODE_KEY, normalized);
    } catch {
      // Ignore private browsing/storage failures; the toggle still works for this session.
    }
    window.dispatchEvent(new CustomEvent(FEATURE_MODE_EVENT, { detail: { mode: normalized } }));
  };

  return [mode, setMode];
}

function handleTabListKeyDown(event, currentIndex, itemCount, onSelect) {
  let nextIndex = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % itemCount;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + itemCount) % itemCount;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = itemCount - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  const tabList = event.currentTarget.closest('[role="tablist"]');
  onSelect(nextIndex);
  window.requestAnimationFrame(() => tabList?.querySelectorAll('[role="tab"]')[nextIndex]?.focus());
}

function FeatureModeSwitch({ mode, onChange, className = '' }) {
  const modes = Object.entries(featureModeMeta);
  return (
    <div className={className} role="group" aria-label="Feature mode">
      {modes.map(([key, meta]) => (
        <button
          type="button"
          className={mode === key ? 'active' : ''}
          aria-label={`${meta.label}: ${meta.helper}`}
          aria-pressed={mode === key}
          onClick={() => onChange(key)}
          key={key}
        >
          <strong>{meta.label}</strong>
          <span>{meta.helper}</span>
        </button>
      ))}
    </div>
  );
}

function PricingPlanRail({ ariaLabel, featureLimit = null, plans, showScope = false }) {
  return (
    <div className="landing-plans-rail" aria-label={ariaLabel}>
      {plans.map((plan) => {
        const planFeatures = showScope ? [plan.scope, ...plan.features] : plan.features;
        const visibleFeatures = Number.isInteger(featureLimit)
          ? planFeatures.slice(0, featureLimit)
          : planFeatures;

        return (
          <article key={plan.id}>
            <span>{plan.name}</span>
            <strong>{plan.displayPrice}</strong>
            <p>{plan.intent}</p>
            <ul>{visibleFeatures.map((feature) => <li key={feature}><i className="ph-bold ph-check" /> {feature}</li>)}</ul>
          </article>
        );
      })}
    </div>
  );
}

const landingWorkflowStates = {
  chat: {
    label: 'Chat',
    caption: 'Talk naturally',
    icon: 'ph-chat-circle-text',
    title: 'The conversation stays readable.',
    copy: 'Messages remain the center of the room, with quieter chrome and the important tools close by.',
  },
  catchup: {
    label: 'Catch-up',
    caption: 'Return to the signal',
    icon: 'ph-newspaper-clipping',
    title: 'The room does the scanning.',
    copy: 'Catch-Me-Up separates key updates, decisions, and loose ends from the raw scroll.',
  },
  tasks: {
    label: 'Tasks',
    caption: 'Move work forward',
    icon: 'ph-check-square',
    title: 'Next steps stay attached to context.',
    copy: 'Turn the useful part of a conversation into a clear task without rebuilding it somewhere else.',
  },
};

const landingSignalFeatures = [
  ['Catch-Me-Up', 'ph-newspaper-clipping'],
  ['Decisions', 'ph-seal-check'],
  ['Tasks', 'ph-check-square'],
  ['Offline reading', 'ph-book-open'],
  ['Room memory', 'ph-brain'],
];

function DemoGlobalRail() {
  return (
    <div className="desktop-demo-global-rail" aria-hidden="true">
      <div className="desktop-demo-mark"><span /><span /></div>
      <i className="ph-bold ph-chat-circle-text is-active" />
      <i className="ph-bold ph-users" />
      <i className="ph-bold ph-sparkle" />
      <i className="ph-bold ph-identification-card" />
      <span className="desktop-demo-rail-spacer" />
      <i className="ph-bold ph-bell" />
      <i className="ph-bold ph-magnifying-glass" />
      <i className="ph-bold ph-gear" />
    </div>
  );
}

function DemoRoomRail({ roomKey, onRoomChange }) {
  return (
    <aside className="desktop-demo-room-rail" aria-label="Demo rooms">
      <div className="desktop-demo-room-rail-head">
        <strong>ROOMS</strong>
        <i className="ph-bold ph-sidebar" aria-hidden="true" />
      </div>
      <div className="desktop-demo-room-search" aria-hidden="true">
        <i className="ph-bold ph-magnifying-glass" />
        <span>Jump to room or channel</span>
        <kbd>Ctrl K</kbd>
      </div>
      <div className="desktop-demo-room-list">
        {landingDemoRooms.map((room) => (
          <button
            type="button"
            className={roomKey === room.key ? 'is-active' : ''}
            aria-pressed={roomKey === room.key}
            onClick={() => onRoomChange(room.key)}
            key={room.key}
          >
            <span className="desktop-demo-room-icon"><i className={`ph-bold ${room.icon}`} /></span>
            <span>
              <strong>{room.name}{room.favorite ? <em aria-label="Favorite room">★</em> : null}</strong>
              <small>{room.preview}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="desktop-demo-room-actions" aria-hidden="true">
        <span>+ New room</span>
        <span>Join</span>
      </div>
    </aside>
  );
}

function DemoRoomTabs({ activeTab, onTabChange }) {
  return (
    <div className="desktop-demo-tabs" role="tablist" aria-label="Demo room views">
      {landingDemoTabs.map(([key, label, icon]) => (
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === key}
          className={activeTab === key ? 'is-active' : ''}
          onClick={() => onTabChange(key)}
          key={key}
        >
          <i className={`ph-bold ${icon}`} />
          <span>{label}</span>
        </button>
      ))}
      <span className="desktop-demo-tab-add" aria-hidden="true">+</span>
    </div>
  );
}

function DemoMessage({ message }) {
  return (
    <article className={`desktop-demo-message ${message.self ? 'is-self' : ''} ${message.ai ? 'is-ai' : ''}`}>
      <span className="desktop-demo-avatar" aria-hidden="true">{message.initials}</span>
      <div className="desktop-demo-message-body">
        <header>
          <strong>{message.author}</strong>
          {message.ai ? <em>✦ AI</em> : null}
          <time>{message.time}</time>
        </header>
        <p>{message.text}</p>
      </div>
    </article>
  );
}

function DemoChatPanel({
  channel,
  draft,
  messages,
  messageViewportRef,
  catchUpCollapsed,
  onChannelChange,
  onDraftChange,
  onSend,
  onQuickReply,
  onToggleCatchUp,
  onCatchUpAction,
}) {
  return (
    <div className="desktop-demo-chat-panel" role="tabpanel" aria-label="Chat">
      <div className="desktop-demo-channels" aria-label="Demo channels">
        <span>CHANNELS</span>
        {landingDemoChannels.map((name) => (
          <button
            type="button"
            className={channel === name ? 'is-active' : ''}
            aria-pressed={channel === name}
            onClick={() => onChannelChange(name)}
            key={name}
          >
            # {name}
          </button>
        ))}
        <button type="button" onClick={() => onCatchUpAction('Channel creation stays inside the full app.')}>+ Channel</button>
      </div>

      <div className="desktop-demo-messages" ref={messageViewportRef} aria-live="polite">
        {messages.map((message) => <DemoMessage message={message} key={message.id} />)}
      </div>

      <section className={`desktop-demo-catchup ${catchUpCollapsed ? 'is-collapsed' : ''}`} aria-label="Room catch-up">
        <div className="desktop-demo-catchup-copy">
          <span>CATCH-UP</span>
          <strong>Room catch-up</strong>
          {catchUpCollapsed ? null : (
            <>
              <small>13 recent messages · 2 people · 4 files</small>
              <p>{landingCatchUpItems[0]}</p>
            </>
          )}
        </div>
        <div className="desktop-demo-catchup-actions">
          <button type="button" onClick={() => onCatchUpAction('Catch-up refreshed with three key updates.')}><i className="ph-bold ph-sparkle" /> Summarize</button>
          <button type="button" onClick={() => onCatchUpAction('task')}><i className="ph-bold ph-check-square" /> Task</button>
          <button type="button" onClick={() => onCatchUpAction('Search opened for this demo room.')}><i className="ph-bold ph-magnifying-glass" /> Search</button>
          <button type="button" onClick={() => onCatchUpAction('You are at the latest message.')}>Latest</button>
          <button type="button" className="desktop-demo-collapse" aria-label={catchUpCollapsed ? 'Expand catch-up' : 'Collapse catch-up'} onClick={onToggleCatchUp}>
            <i className={`ph-bold ph-caret-down${catchUpCollapsed ? ' is-up' : ''}`} />
          </button>
        </div>
      </section>

      <div className="desktop-demo-quick-replies" aria-label="Quick replies">
        <span>QUICK REPLIES</span>
        {landingQuickReplies.map((reply) => (
          <button type="button" onClick={() => onQuickReply(reply)} key={reply}>{reply}</button>
        ))}
      </div>

      <form className="desktop-demo-composer" onSubmit={onSend}>
        <div className="desktop-demo-composer-row">
          <input name="demo-message" value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Message HOME..." aria-label="Type a demo message" />
          <button type="submit" aria-label="Send demo message"><i className="ph-bold ph-paper-plane-tilt" /></button>
        </div>
        <div className="desktop-demo-composer-tools" aria-hidden="true">
          <span><i className="ph-bold ph-paperclip" /></span>
          <span>&lt;/&gt;</span>
          <span>{'{ }'}</span>
          <span><i className="ph-bold ph-chart-bar" /></span>
          <span><i className="ph-bold ph-clock" /></span>
          <em>Enter sends&nbsp;&nbsp; Shift+Enter for new line</em>
        </div>
      </form>
    </div>
  );
}

const demoToolPanels = {
  home: ['Room home', 'A calm overview of the room, members, recent activity, and shared resources.'],
  docs: ['Shared docs', 'Keep outlines and notes beside the conversation that created them.'],
  whiteboard: ['Whiteboard', 'Sketch the next idea together without losing the room context.'],
  events: ['Events', 'Keep room plans and reminders visible to everyone.'],
  calendar: ['Calendar', 'See scheduled messages, deadlines, and events in one place.'],
  ai: ['Room AI', 'Summarize, explain, and turn conversation into next steps.'],
  calls: ['Calls', 'Start a room call when text is not enough.'],
};

function DemoToolPanel({ activeTab, tasks, completedTasks, onToggleTask }) {
  if (activeTab === 'tasks') {
    return (
      <section className="desktop-demo-tool-panel desktop-demo-task-panel" role="tabpanel" aria-label="Tasks">
        <div className="desktop-demo-tool-heading"><span>TASKS</span><h3>Room tasks</h3><p>Next steps stay attached to the conversation.</p></div>
        <div className="desktop-demo-task-list">
          {tasks.map((task) => (
            <label key={task.id}>
              <input type="checkbox" checked={completedTasks.includes(task.id)} onChange={() => onToggleTask(task.id)} />
              <span><strong>{task.text}</strong><small>{task.owner} · Today</small></span>
            </label>
          ))}
        </div>
      </section>
    );
  }

  const [title, copy] = demoToolPanels[activeTab] || demoToolPanels.home;
  return (
    <section className={`desktop-demo-tool-panel is-${activeTab}`} role="tabpanel" aria-label={title}>
      <div className="desktop-demo-tool-heading"><span>{activeTab.toUpperCase()}</span><h3>{title}</h3><p>{copy}</p></div>
      <div className="desktop-demo-tool-canvas" aria-hidden="true">
        <article><i className="ph-bold ph-file-text" /><strong>Study outline</strong><small>Updated today</small></article>
        <article><i className="ph-bold ph-check-square" /><strong>Tonight at 7</strong><small>Shared with HOME</small></article>
      </div>
    </section>
  );
}

function LandingDesktopDemo() {
  const nextMessageId = useRef(0);
  const messageViewportRef = useRef(null);
  const [roomKey, setRoomKey] = useState('home');
  const [activeTab, setActiveTab] = useState('chat');
  const [channel, setChannel] = useState('general');
  const [draft, setDraft] = useState('');
  const [messagesByRoom, setMessagesByRoom] = useState(() => ({
    home: landingDemoMessages.home.map((message) => ({ ...message })),
    global: landingDemoMessages.global.map((message) => ({ ...message })),
  }));
  const [tasks, setTasks] = useState([
    { id: 'task-outline', text: 'Create the deliverables checklist', owner: 'Jordan' },
  ]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [catchUpCollapsed, setCatchUpCollapsed] = useState(false);
  const [status, setStatus] = useState('Live local demo — no account or network required.');
  const messages = messagesByRoom[roomKey];
  const roomName = landingDemoRooms.find((room) => room.key === roomKey)?.name || 'HOME';

  const changeRoom = (nextRoom) => {
    setRoomKey(nextRoom);
    setActiveTab('chat');
    setStatus(`${landingDemoRooms.find((room) => room.key === nextRoom)?.name || 'Room'} opened.`);
  };

  const addLocalMessage = (text) => {
    const clean = text.trim();
    if (!clean) return;
    const message = {
      id: `demo-you-${nextMessageId.current++}`,
      author: 'You',
      initials: 'YO',
      time: 'Now',
      text: clean,
      self: true,
    };
    setMessagesByRoom((current) => ({
      ...current,
      [roomKey]: [...current[roomKey], message].slice(-6),
    }));
    setDraft('');
    setStatus('Message added to the local demo.');
  };

  const sendMessage = (event) => {
    event.preventDefault();
    addLocalMessage(draft);
  };

  const handleCatchUpAction = (action) => {
    if (action !== 'task') {
      setCatchUpCollapsed(false);
      setStatus(action);
      return;
    }
    const source = messages.at(-1)?.text || 'Review the latest room update';
    setTasks((current) => current.some((task) => task.text === source)
      ? current
      : [...current, { id: `task-${nextMessageId.current++}`, text: source, owner: 'You' }]);
    setActiveTab('tasks');
    setStatus('The latest message is now a room task.');
  };

  const toggleTask = (taskId) => {
    setCompletedTasks((current) => current.includes(taskId)
      ? current.filter((id) => id !== taskId)
      : [...current, taskId]);
  };

  const resetDemo = () => {
    setRoomKey('home');
    setActiveTab('chat');
    setChannel('general');
    setDraft('');
    setMessagesByRoom({
      home: landingDemoMessages.home.map((message) => ({ ...message })),
      global: landingDemoMessages.global.map((message) => ({ ...message })),
    });
    setTasks([{ id: 'task-outline', text: 'Create the deliverables checklist', owner: 'Jordan' }]);
    setCompletedTasks([]);
    setCatchUpCollapsed(false);
    setStatus('Demo reset.');
  };

  return (
    <div className="desktop-demo" id="home-live-demo" aria-label="Interactive Minimalist desktop chat demo" tabIndex={-1}>
      <div className="desktop-demo-windowbar">
        <div className="desktop-demo-window-dots" aria-hidden="true"><span /><span /><span /></div>
        <div className="desktop-demo-window-actions">
          <span aria-hidden="true"><i className="ph-bold ph-magnifying-glass" /></span>
          <span className="desktop-demo-profile" aria-hidden="true">WA</span>
          <button type="button" onClick={resetDemo} aria-label="Reset demo"><i className="ph-bold ph-arrow-counter-clockwise" /></button>
        </div>
      </div>
      <div className="desktop-demo-shell">
        <DemoGlobalRail />
        <DemoRoomRail roomKey={roomKey} onRoomChange={changeRoom} />
        <div className="desktop-demo-workspace">
          <header className="desktop-demo-room-header">
            <div><strong>{roomName}</strong>{roomKey === 'home' ? <span>PRIVATE</span> : null}<i className="ph-bold ph-caret-down" /></div>
            <button type="button" onClick={() => setStatus('Search opened for this demo room.')} aria-label="Search demo messages"><i className="ph-bold ph-magnifying-glass" /></button>
          </header>
          <DemoRoomTabs activeTab={activeTab} onTabChange={setActiveTab} />
          {activeTab === 'chat' ? (
            <DemoChatPanel
              channel={channel}
              draft={draft}
              messages={messages}
              messageViewportRef={messageViewportRef}
              catchUpCollapsed={catchUpCollapsed}
              onChannelChange={(nextChannel) => { setChannel(nextChannel); setStatus(`# ${nextChannel} selected.`); }}
              onDraftChange={setDraft}
              onSend={sendMessage}
              onQuickReply={addLocalMessage}
              onToggleCatchUp={() => setCatchUpCollapsed((collapsed) => !collapsed)}
              onCatchUpAction={handleCatchUpAction}
            />
          ) : (
            <DemoToolPanel activeTab={activeTab} tasks={tasks} completedTasks={completedTasks} onToggleTask={toggleTask} />
          )}
        </div>
      </div>
      <p className="desktop-demo-status" aria-live="polite">{status}</p>
    </div>
  );
}

function LandingWorkflowSection() {
  const [activeState, setActiveState] = useState('chat');
  const state = landingWorkflowStates[activeState];

  return (
    <section className="landing-v3-section landing-workflow" id="landing-workflow">
      <div className="landing-section-heading">
        <h2>Conversation that leaves a trail.</h2>
        <p>A message becomes context, a decision, or a next step — without leaving the room.</p>
      </div>
      <div className="landing-workflow-rail" role="tablist" aria-label="Conversation workflow">
        {Object.entries(landingWorkflowStates).map(([key, item]) => (
          <button type="button" role="tab" aria-selected={activeState === key} className={activeState === key ? 'is-active' : ''} onClick={() => setActiveState(key)} key={key}>
            <span><i className={`ph-bold ${item.icon}`} /></span>
            <strong>{item.label}</strong>
            <small>{item.caption}</small>
          </button>
        ))}
      </div>
      <div className={`landing-workflow-state is-${activeState}`} role="tabpanel" aria-live="polite">
        <div className="landing-workflow-state-copy"><h3>{state.title}</h3><p>{state.copy}</p></div>
        <div className="landing-workflow-mini-app" aria-hidden="true">
          <div className="landing-workflow-mini-rail"><span>HOME</span><span># general</span><span># study</span></div>
          {activeState === 'chat' ? (
            <div className="landing-workflow-chat"><p>I added the notes to the pinboard.</p><p>Meeting at 7? I can share the outline.</p><span>Message HOME...</span></div>
          ) : null}
          {activeState === 'catchup' ? (
            <div className="landing-workflow-catchup"><strong>3 key updates</strong>{landingCatchUpItems.map((item) => <p key={item}><i className="ph-bold ph-check" /> {item}</p>)}</div>
          ) : null}
          {activeState === 'tasks' ? (
            <div className="landing-workflow-tasks"><strong>Room tasks</strong><label><input type="checkbox" readOnly /> Create the deliverables checklist</label><label><input type="checkbox" defaultChecked readOnly /> Share the study outline</label></div>
          ) : null}
        </div>
      </div>
      <Link className="landing-text-link" to="/features">See every feature <CtaArrowIcon /></Link>
    </section>
  );
}

function LandingSignalSection() {
  const [mode, setMode] = useState('focus');

  return (
    <section className="landing-v3-section landing-signal">
      <div className="landing-signal-copy">
        <h2>More signal.<br />Less scroll.</h2>
        <p>Choose a quieter room when you need focus. Bring structure back when the group needs it.</p>
        <div className="landing-signal-modes" aria-label="Preview room mode">
          <button type="button" className={mode === 'focus' ? 'is-active' : ''} aria-pressed={mode === 'focus'} onClick={() => setMode('focus')}><i className="ph-bold ph-moon-stars" /> Focus mode</button>
          <button type="button" className={mode === 'organize' ? 'is-active' : ''} aria-pressed={mode === 'organize'} onClick={() => setMode('organize')}><i className="ph-bold ph-list-checks" /> Organize mode</button>
        </div>
        <ul>{landingSignalFeatures.map(([label, icon]) => <li key={label}><i className={`ph-bold ${icon}`} /> {label}</li>)}</ul>
      </div>
      <div className={`landing-signal-preview is-${mode}`} aria-live="polite">
        <div className="landing-signal-preview-top"><strong>HOME</strong><span>{mode === 'focus' ? 'Focus mode' : 'Organize mode'}</span></div>
        {mode === 'focus' ? (
          <div className="landing-signal-focus"><article><strong>AI Agent</strong><p>Here are the three updates that matter today.</p></article><article><strong>wane</strong><p>The outline and checklist are ready for tonight.</p></article></div>
        ) : (
          <div className="landing-signal-organize"><strong>Room catch-up</strong>{landingCatchUpItems.map((item) => <p key={item}><i className="ph-bold ph-check-square" /> {item}</p>)}<button type="button" onClick={() => setMode('focus')}>Return to chat</button></div>
        )}
      </div>
    </section>
  );
}

function LandingPlansSection() {
  return (
    <section className="landing-v3-section landing-close">
      <div className="landing-close-copy">
        <h2>A calmer room is one click away.</h2>
        <Link to="/chat" reloadDocument className="lp-btn lp-btn-primary">Create your first room <CtaArrowIcon /></Link>
        <Link to="/pricing" className="landing-text-link">Compare plans <CtaArrowIcon /></Link>
      </div>
      <PricingPlanRail ariaLabel="Minimalist account plans" featureLimit={3} plans={accountPlans} />
    </section>
  );
}

export function HomePage() {
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) window.location.replace('/chat');
  }, []);

  return (
    <MarketingShell title={DEFAULT_META_TITLE} description={DEFAULT_META_DESCRIPTION} shape={null}>
      <main className="landing-v3">
        <section className="landing-v3-section landing-hero">
          <div className="landing-hero-copy">
            <h1>Catch up in minutes.<br />Stay focused for hours.</h1>
            <p>Calm rooms turn conversation into catch-ups, decisions, and next steps.</p>
            <div className="landing-hero-actions">
              <Link to="/chat" reloadDocument className="lp-btn lp-btn-primary">Open the app <CtaArrowIcon /></Link>
              <a href="#landing-workflow" className="lp-btn lp-btn-secondary">Explore features</a>
            </div>
          </div>
          <div className="landing-hero-grid" aria-hidden="true"><span /></div>
          <LandingDesktopDemo />
        </section>
        <LandingWorkflowSection />
        <LandingSignalSection />
        <LandingPlansSection />
      </main>
    </MarketingShell>
  );
}

export function PricingPage() {
  return (
    <MarketingShell title={pricingPageMeta.title} shape={null} description={pricingPageMeta.description}>
      <main className="marketing-v4">
        <section className="mkt4-hero">
          <div className="mkt4-hero-copy">
            <h1>Plans for your account. Optional plans for a room.</h1>
            <p>An account plan follows one signed-in user across rooms. A room subscription is a separate monthly choice for one private room and assigns benefits only to selected members.</p>
            <div className="mkt4-actions">
              <Link to="/chat" reloadDocument className="mkt4-button is-primary">Start with Base <CtaArrowIcon /></Link>
              <a href="#account-plans" className="mkt4-button">Compare account plans</a>
            </div>
          </div>
          <aside className="mkt4-readiness-console" aria-label="How Minimalist pricing works">
            <div className="mkt4-console-top"><span>HOW PRICING WORKS</span><strong>Two separate choices</strong></div>
            <div className="mkt4-readiness-main">
              <span className="mkt4-readiness-icon"><i className="ph-bold ph-user-circle" /></span>
              <div><small>ACCOUNT PLAN</small><strong>Follows one user</strong><p>Your account limits and features travel with you from room to room.</p></div>
            </div>
            <div className="mkt4-readiness-lines">
              <p><span>Account scope</span><strong>One signed-in user</strong></p>
              <p><span>Room scope</span><strong>One private room</strong></p>
              <p><span>Benefit rule</span><strong>Higher limit stays</strong></p>
            </div>
          </aside>
        </section>

        <section className="mkt4-section" id="account-plans">
          <header className="mkt4-section-heading">
            <div><span>01</span><h2>Account plans.</h2></div>
            <p>Choose the limits and account features that follow you across Minimalist. Base has no recurring account charge; Advanced and Pro are monthly.</p>
          </header>
          <PricingPlanRail ariaLabel="Account plan comparison" plans={accountPlans} showScope />
        </section>

        <section className="mkt4-section" id="room-subscriptions">
          <header className="mkt4-section-heading">
            <div><span>02</span><h2>Optional room subscriptions.</h2></div>
            <p>A room subscription is separate from account billing. It covers one private room, is managed by that room's creator, and assigns benefits only to selected members within the plan limit.</p>
          </header>
          <PricingPlanRail ariaLabel="Room subscription comparison" plans={roomSubscriptionPlans} showScope />
          <article className="mkt4-principle-row">
            <span>NOTE</span>
            <h3>Stronger account benefits stay.</h3>
            <p>For each selected member, Minimalist uses the higher of that person's account limit and the room benefit. Adding a room subscription never lowers an existing account benefit.</p>
          </article>
        </section>

        <MarketingClose title="Start free, then add only what you need." copy="Choose an account plan first. Room subscriptions remain optional and separate." secondaryHref="/faq" secondaryLabel="Read the FAQ" />
      </main>
    </MarketingShell>
  );
}

const simpleFeatureCards = [
  ['Rooms', 'ph-hash', 'Create a shared place for a group, project, class, club, or community without starting from a noisy blank slate.'],
  ['Quiet Messages', 'ph-chat-circle-text', 'The core conversation stays readable with focus, zen, and compact modes close at hand.'],
  ['Catch-Me-Up', 'ph-newspaper-clipping', 'Return to a room and see the decisions, action items, links, and key updates before the raw scroll.'],
  ['Offline Reading', 'ph-cloud-arrow-down', 'Keep important room context available for unreliable connections, commutes, travel, and low-focus moments.'],
  ['Search', 'ph-magnifying-glass', 'Find rooms, messages, files, people, decisions, and resources from one obvious place.'],
];

const powerFeatureCards = [
  ['Decisions', 'ph-seal-check', 'Capture what the group agreed to so the same question does not restart three days later.'],
  ['Action Items', 'ph-check-square', 'Turn conversations into owned next steps and keep follow-through visible to the room.'],
  ['Scheduled Messages', 'ph-clock-countdown', 'Write once, send later, and keep announcements or reminders from interrupting the wrong moment.'],
  ['Room Templates', 'ph-layout', 'Start clubs, classes, projects, creator spaces, and support groups with the right structure already in place.'],
  ['Role Onboarding', 'ph-identification-card', 'Give members, moderators, officers, students, and leads a guided first path through the room.'],
  ['Events', 'ph-calendar-dots', 'Plan room events, reminders, calendars, and deadlines without leaving the shared context.'],
  ['Wiki', 'ph-book-open-text', 'Keep room knowledge, notes, rules, and resources in a living hub.'],
  ['Moderation', 'ph-shield-check', 'Use reports, permissions, audit logs, keyword controls, and safety tools.'],
  ['Integrations', 'ph-plugs-connected', 'Connect workflows through webhooks, channels, and external tools.'],
  ['Room Memory', 'ph-brain', 'Preserve important context so the room remembers what happened and feeds better future digests.'],
];

const powerWorkspaceTools = [
  'Command palette',
  'Global search',
  'Keyboard shortcuts',
  'Workspace switching',
  'Multi-room view',
  'Catch-Me-Up settings',
  'Focus mode',
  'Zen mode',
  'Compact mode',
  'Scheduled send',
  'Template library',
  'Role checklists',
  'Offline queue',
];

function slugifyFeature(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function FeatureRoomPreview({ feature, mode }) {
  const [label, icon] = feature;
  const previewRows = mode === 'simple'
    ? ['Readable conversation', 'Room context', 'The next useful step']
    : ['Decision captured', 'Owner assigned', 'Room memory updated'];

  return (
    <div className="mkt4-feature-preview" aria-hidden="true">
      <div className="mkt4-preview-rail">
        <span className="mkt4-preview-mark"><i /><i /></span>
        <span className="is-active"><i className="ph-bold ph-chat-circle-text" /></span>
        <span><i className="ph-bold ph-users" /></span>
        <span><i className="ph-bold ph-gear" /></span>
      </div>
      <div className="mkt4-preview-room">
        <header><strong>HOME</strong><span>{mode === 'simple' ? 'CALM' : 'POWER'}</span></header>
        <div className="mkt4-preview-feature">
          <span><i className={`ph-bold ${icon}`} /></span>
          <div><small>ACTIVE FEATURE</small><strong>{label}</strong></div>
        </div>
        <div className="mkt4-preview-rows">
          {previewRows.map((row, index) => <p className={index === 1 ? 'is-accent' : ''} key={row}><i className="ph-bold ph-check" /> {row}</p>)}
        </div>
      </div>
    </div>
  );
}

function MarketingClose({ title, copy, secondaryHref = '/download', secondaryLabel = 'Download' }) {
  return (
    <section className="mkt4-close">
      <div><h2>{title}</h2><p>{copy}</p></div>
      <div className="mkt4-actions">
        <Link to="/chat" reloadDocument className="mkt4-button is-primary">Open the app <CtaArrowIcon /></Link>
        <Link to={secondaryHref} className="mkt4-button">{secondaryLabel}</Link>
      </div>
    </section>
  );
}

export function FeaturesPage() {
  const [mode, setMode] = useMarketingFeatureMode();
  const activeMode = featureModeMeta[mode];
  const cards = mode === 'simple' ? simpleFeatureCards : powerFeatureCards;
  const [activeFeatureKey, setActiveFeatureKey] = useState(() => slugifyFeature(simpleFeatureCards[0][0]));
  const activeFeature = cards.find(([label]) => slugifyFeature(label) === activeFeatureKey) || cards[0];

  const changeMode = (nextMode) => {
    setMode(nextMode);
    const nextCards = nextMode === 'simple' ? simpleFeatureCards : powerFeatureCards;
    setActiveFeatureKey(slugifyFeature(nextCards[0][0]));
  };

  return (
    <MarketingShell title="Minimalist | Features" shape={null} description="Explore Minimalist rooms, Catch-Me-Up, focus tools, decisions, action items, scheduling, templates, offline reading, search, and room memory.">
      <main className="marketing-v4 features-v4" data-feature-mode={mode}>
        <section className="mkt4-hero mkt4-features-hero">
          <div className="mkt4-hero-copy">
            <h1>Everything your room needs. Nothing in the way.</h1>
            <p>{activeMode.copy}</p>
            <div className="mkt4-actions">
              <a href="#feature-workbench" className="mkt4-button is-primary">Explore the system <CtaArrowIcon /></a>
              <Link to="/chat" reloadDocument className="mkt4-button">Open the app</Link>
            </div>
          </div>
          <div className="mkt4-hero-console">
            <div className="mkt4-console-top"><span>ROOM SYSTEM</span><strong>{activeMode.shortLabel} mode</strong></div>
            <FeatureModeSwitch mode={mode} onChange={changeMode} className="mkt4-mode-switch" />
            <FeatureRoomPreview feature={activeFeature} mode={mode} />
          </div>
        </section>

        <section className="mkt4-section" id="feature-workbench">
          <header className="mkt4-section-heading">
            <div><span>01</span><h2>Explore the room system.</h2></div>
            <p>Select a capability to see how it fits into a calmer room. Switch modes when the group needs more structure.</p>
          </header>
          <div className="mkt4-explorer">
            <div className="mkt4-explorer-tabs" role="tablist" aria-label={`${activeMode.label} features`}>
              {cards.map(([label, icon], index) => {
                const key = slugifyFeature(label);
                const selected = key === slugifyFeature(activeFeature[0]);
                return (
                  <button
                    type="button"
                    id={`mkt4-feature-tab-${key}`}
                    role="tab"
                    tabIndex={selected ? 0 : -1}
                    aria-selected={selected}
                    aria-controls="mkt4-feature-panel"
                    className={selected ? 'is-active' : ''}
                    onClick={() => setActiveFeatureKey(key)}
                    onKeyDown={(event) => handleTabListKeyDown(event, index, cards.length, (nextIndex) => setActiveFeatureKey(slugifyFeature(cards[nextIndex][0])))}
                    key={label}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span><i className={`ph-bold ${icon}`} /><strong>{label}</strong><CtaArrowIcon />
                  </button>
                );
              })}
            </div>
            <div className="mkt4-explorer-panel" id="mkt4-feature-panel" role="tabpanel" aria-labelledby={`mkt4-feature-tab-${slugifyFeature(activeFeature[0])}`} aria-live="polite">
              <div className="mkt4-explorer-copy">
                <span>{activeMode.label}</span>
                <h3>{activeFeature[0]}</h3>
                <p>{activeFeature[2]}</p>
              </div>
              <FeatureRoomPreview feature={activeFeature} mode={mode} />
            </div>
          </div>
        </section>

        <section className="mkt4-section mkt4-room-flow">
          <header className="mkt4-section-heading">
            <div><span>02</span><h2>{mode === 'simple' ? 'Calm first.' : 'Depth on demand.'}</h2></div>
            <p>{mode === 'simple' ? 'The essentials stay visible and readable from the first message.' : 'Advanced controls stay organized instead of flooding the conversation.'}</p>
          </header>
          <div className="mkt4-flow-list">
            {activeMode.list.map((feature, index) => <div key={feature}><span>{String(index + 1).padStart(2, '0')}</span><strong>{feature}</strong></div>)}
          </div>
          {mode === 'power' ? <div className="mkt4-tool-rail" aria-label="Power-user tools">{powerWorkspaceTools.map((tool) => <span key={tool}>{tool}</span>)}</div> : null}
        </section>

        <MarketingClose title="Start calm. Add power when it earns its place." copy="Create a room, invite your people, and let the structure grow with the conversation." />
      </main>
    </MarketingShell>
  );
}

const downloads = [
  {
    id: 'web',
    name: 'Web App',
    icon: 'ph-globe',
    status: 'Available now',
    meta: 'No install required',
    cta: 'Open Minimalist',
    href: '/chat',
    requirements: ['Works on desktop and mobile browsers', 'Best way to use Minimalist today'],
  },
  {
    id: 'windows',
    name: 'Windows',
    icon: 'ph-windows-logo',
    status: 'Desktop app planned',
    meta: 'Windows 10+ • 64-bit',
    cta: 'Notify me',
    requirements: ['Native notifications', 'Pinned desktop experience'],
  },
  {
    id: 'mac',
    name: 'macOS',
    icon: 'ph-apple-logo',
    status: 'Desktop app planned',
    meta: 'Apple Silicon + Intel',
    cta: 'Notify me',
    requirements: ['macOS 12 Monterey or later', 'Menu bar and system integrations planned'],
  },
  {
    id: 'android',
    name: 'Android',
    icon: 'ph-android-logo',
    status: 'Mobile app planned',
    meta: 'Android 8+',
    cta: 'Notify me',
    requirements: ['Push notifications', 'Share sheet and camera import planned'],
  },
  {
    id: 'ios',
    name: 'iPhone & iPad',
    icon: 'ph-device-mobile',
    status: 'Mobile app planned',
    meta: 'iOS / iPadOS 15+',
    cta: 'Notify me',
    requirements: ['Home Screen app support', 'Native notification polish planned'],
  },
];

const downloadHighlights = [
  ['ph-lightning', 'Launch fast', 'Open the web app instantly and keep your rooms one tap away.'],
  ['ph-cloud-check', 'Same account', 'Your rooms, chats, docs, and settings follow your sign-in.'],
  ['ph-shield-check', 'Built calmer', 'A cleaner workspace than noisy group chats, with power when you need it.'],
];

const installSteps = [
  ['Open', 'Use the web app today from any modern browser.'],
  ['Pin', 'Add it to your desktop, taskbar, dock, or phone Home Screen.'],
  ['Sign in', 'Pick up rooms, messages, files, and settings from one account.'],
];

const downloadFaqs = [
  ['Is there a real installer yet?', 'Not yet. The web app is the production path right now, and native apps are planned.'],
  ['Can I use it on my phone?', 'Yes. Open the web app on mobile, then add it to your Home Screen for an app-like flow.'],
  ['Is it free?', 'Yes. Base is free; Advanced and Pro add higher limits, analytics, video, badges, and power features.'],
  ['Will native apps sync with the web app?', 'Yes. The goal is one account and the same rooms across web, desktop, and mobile.'],
];

function detectedPlatform() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return '';
}

export function DownloadPage() {
  const platform = useMemo(() => detectedPlatform(), []);
  const [toast, setToast] = useState('');
  const [installState, setInstallState] = useState(() => window.getMinimalistInstallState?.() || { canInstall: false, installed: false });
  const [selectedPlatformId, setSelectedPlatformId] = useState(() => platform || 'web');
  const detectedLabel = downloads.find((item) => item.id === platform)?.name;
  const selectedPlatform = downloads.find((item) => item.id === selectedPlatformId) || downloads[0];

  useEffect(() => {
    const syncInstallState = (event) => setInstallState(event.detail || window.getMinimalistInstallState?.() || { canInstall: false, installed: false });
    syncInstallState({});
    window.addEventListener('minimalist:pwa-install-state', syncInstallState);
    return () => window.removeEventListener('minimalist:pwa-install-state', syncInstallState);
  }, []);

  const installApp = async () => {
    const result = await window.promptMinimalistInstall?.();
    if (result?.outcome === 'accepted') setToast('Minimalist is installing.');
    else setToast('Install is available from your browser menu anytime.');
    window.setTimeout(() => setToast(''), 3500);
  };

  const useWebInstead = () => {
    setSelectedPlatformId('web');
    setToast(`${selectedPlatform.name} is planned. The web app is ready now.`);
    window.setTimeout(() => setToast(''), 3500);
  };

  return (
    <MarketingShell title="Minimalist | Download" shape={null} description="Use the Minimalist web app today, install it from a supported browser, and check the roadmap status for desktop and mobile apps.">
      <main className="marketing-v4 download-v4">
        <section className="mkt4-hero mkt4-download-hero">
          <div className="mkt4-hero-copy">
            <h1>Your rooms, ready wherever you open them.</h1>
            <p>Minimalist is ready in the browser today. Native apps are on the roadmap, while the web app already gives you the complete room workspace without waiting.</p>
            <div className="mkt4-actions">
              <Link to="/chat" reloadDocument className="mkt4-button is-primary">Open the web app <CtaArrowIcon /></Link>
              {installState.canInstall ? <button type="button" className="mkt4-button" onClick={installApp}><i className="ph-bold ph-download-simple" /> Install app</button> : <a href="#platforms" className="mkt4-button">Check your device</a>}
            </div>
          </div>
          <aside className="mkt4-readiness-console" aria-label="App readiness">
            <div className="mkt4-console-top"><span>DEVICE CHECK</span><strong>{installState.installed ? 'Installed' : 'Web ready'}</strong></div>
            <div className="mkt4-readiness-main">
              <span className="mkt4-readiness-icon"><i className="ph-bold ph-globe" /></span>
              <div><small>CURRENT BEST OPTION</small><strong>Web App</strong><p>No installer required. Sign in and keep moving.</p></div>
            </div>
            <div className="mkt4-readiness-lines">
              <p><span>Detected device</span><strong>{detectedLabel || 'Modern browser'}</strong></p>
              <p><span>Account sync</span><strong>Ready</strong></p>
              <p><span>Install path</span><strong>{installState.installed ? 'Installed' : installState.canInstall ? 'Available' : 'Browser menu'}</strong></p>
            </div>
          </aside>
        </section>

        <section className="mkt4-benefit-rail" aria-label="Download benefits">
          {downloadHighlights.map(([icon, title, text], index) => <div key={title}><span>{String(index + 1).padStart(2, '0')}</span><i className={`ph-bold ${icon}`} /><strong>{title}</strong><p>{text}</p></div>)}
        </section>

        <section className="mkt4-section" id="platforms">
          <header className="mkt4-section-heading">
            <div><span>01</span><h2>Choose your platform.</h2></div>
            <p>See what is usable now and what is still planned. Minimalist keeps the status explicit.</p>
          </header>
          <div className="mkt4-platform-workbench">
            <div className="mkt4-platform-list" role="tablist" aria-label="Minimalist platforms">
              {downloads.map((item, index) => (
                <button
                  type="button"
                  id={`mkt4-platform-tab-${item.id}`}
                  role="tab"
                  tabIndex={selectedPlatform.id === item.id ? 0 : -1}
                  aria-selected={selectedPlatform.id === item.id}
                  aria-controls="mkt4-platform-detail"
                  className={selectedPlatform.id === item.id ? 'is-active' : ''}
                  onClick={() => setSelectedPlatformId(item.id)}
                  onKeyDown={(event) => handleTabListKeyDown(event, index, downloads.length, (nextIndex) => setSelectedPlatformId(downloads[nextIndex].id))}
                  key={item.id}
                >
                  <i className={`ph-bold ${item.icon}`} /><span><strong>{item.name}</strong><small>{item.meta}</small></span><em>{item.status}</em><CtaArrowIcon />
                </button>
              ))}
            </div>
            <div className="mkt4-platform-detail" id="mkt4-platform-detail" role="tabpanel" aria-labelledby={`mkt4-platform-tab-${selectedPlatform.id}`} aria-live="polite">
              <div className="mkt4-platform-detail-head"><span><i className={`ph-bold ${selectedPlatform.icon}`} /></span><small>{selectedPlatform.status}</small></div>
              <h3>{selectedPlatform.name}</h3>
              <p>{selectedPlatform.meta}</p>
              <ul>{selectedPlatform.requirements.map((requirement) => <li key={requirement}><i className="ph-bold ph-check" /> {requirement}</li>)}</ul>
              {selectedPlatform.href ? (
                <div className="mkt4-actions"><Link to={selectedPlatform.href} reloadDocument className="mkt4-button is-primary">Open Minimalist <CtaArrowIcon /></Link>{installState.canInstall ? <button type="button" className="mkt4-button" onClick={installApp}>Install app</button> : null}</div>
              ) : <button type="button" className="mkt4-button is-primary" onClick={useWebInstead}>Use the web app now <CtaArrowIcon /></button>}
            </div>
          </div>
        </section>

        <section className="mkt4-section">
          <header className="mkt4-section-heading">
            <div><span>02</span><h2>Use it like an app.</h2></div>
            <p>Three quick steps, with the same rooms and settings following your sign-in.</p>
          </header>
          <div className="mkt4-install-rail">
            {installSteps.map(([label, text], index) => <div key={label}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong><p>{text}</p></div></div>)}
          </div>
        </section>

        <section className="mkt4-section mkt4-download-faq">
          <header className="mkt4-section-heading"><div><span>03</span><h2>Download FAQ.</h2></div></header>
          <div className="mkt4-details-list">
            {downloadFaqs.map(([question, answer], index) => <details open={index === 0} key={question}><summary><span>{question}</span><i className="ph-bold ph-plus" /></summary><p>{answer}</p></details>)}
          </div>
        </section>

        <MarketingClose title="Your room is already within reach." copy="Open Minimalist in the browser now, then pin it wherever you work." secondaryHref="/features" secondaryLabel="Explore features" />
      </main>
      <Toast message={toast} onClose={() => setToast('')} />
    </MarketingShell>
  );
}

const storyPrinciples = [
  ['Calm by default', 'The app should feel like opening a quiet room, not walking into a stadium.'],
  ['Power stays tucked away', 'Teams can grow into docs, events, analytics, AI, and moderation without the first screen becoming a cockpit.'],
  ['Memory matters', 'A good room remembers decisions, files, milestones, jokes, rituals, and the people who made it feel alive.'],
];

const storyTimeline = [
  ['01', 'Start with a room', 'Create one shared place for your people.'],
  ['02', 'Let the room take shape', 'Add files, channels, docs, events, and permissions only when the group needs them.'],
  ['03', 'Keep the good stuff', 'Use archives, room memory, summaries, and rituals so the room becomes more valuable over time.'],
];

export function StoryPage() {
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const activeStage = storyTimeline[activeStageIndex];

  return (
    <MarketingShell title="Minimalist | Story" shape={null} description="Why Minimalist is building calmer rooms where conversation, memory, files, events, and decisions can live together without turning into noise.">
      <main className="marketing-v4 story-v4">
        <section className="mkt4-hero mkt4-story-hero">
          <div className="mkt4-hero-copy">
            <h1>Chat should give your group room to breathe.</h1>
            <p>The modern web is crowded. Minimalist is our answer: a calmer rooms platform where conversation, memory, files, events, and decisions can live together without turning into noise.</p>
          </div>
          <div className="mkt4-story-map" aria-label="From noise to a room with memory">
            <div><span>01</span><strong>Noise</strong></div><i />
            <div className="is-active"><span>02</span><strong>Room</strong></div><i />
            <div><span>03</span><strong>Memory</strong></div>
          </div>
        </section>

        <section className="mkt4-story-manifesto">
          <div><h2>Just enough.</h2><span>Our manifesto</span></div>
          <p><strong>Not more. Not less.</strong> Like framing the perfect shot, we strip away the unnecessary background until the essential focus remains: the connection between people.</p>
          <p>Whether you are across the street or across the world, your words take center stage here. No algorithms. No clutter. Just rooms that can become places.</p>
        </section>

        <section className="mkt4-section">
          <header className="mkt4-section-heading">
            <div><span>01</span><h2>A room grows with its people.</h2></div>
            <p>Add structure only when the group has earned a reason for it.</p>
          </header>
          <div className="mkt4-story-stage">
            <div className="mkt4-story-stage-tabs" role="tablist" aria-label="How Minimalist grows with a room">
              {storyTimeline.map(([number, title], index) => (
                <button
                  type="button"
                  id={`mkt4-story-stage-tab-${index}`}
                  role="tab"
                  tabIndex={activeStageIndex === index ? 0 : -1}
                  aria-selected={activeStageIndex === index}
                  aria-controls="mkt4-story-stage-panel"
                  className={activeStageIndex === index ? 'is-active' : ''}
                  onClick={() => setActiveStageIndex(index)}
                  onKeyDown={(event) => handleTabListKeyDown(event, index, storyTimeline.length, setActiveStageIndex)}
                  key={number}
                >
                  <span>{number}</span><strong>{title}</strong><CtaArrowIcon />
                </button>
              ))}
            </div>
            <div className="mkt4-story-stage-panel" id="mkt4-story-stage-panel" role="tabpanel" aria-labelledby={`mkt4-story-stage-tab-${activeStageIndex}`} aria-live="polite">
              <span>{activeStage[0]}</span><h3>{activeStage[1]}</h3><p>{activeStage[2]}</p>
              <div className="mkt4-story-room" aria-hidden="true">
                <span className="mkt4-preview-mark"><i /><i /></span>
                <div><small>HOME</small><strong>{activeStage[1]}</strong><p>{activeStage[2]}</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="mkt4-section mkt4-principles" aria-label="Design principles">
          <header className="mkt4-section-heading"><div><span>02</span><h2>Principles over noise.</h2></div></header>
          {storyPrinciples.map(([title, copy], index) => (
            <article className="mkt4-principle-row" key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{copy}</p></article>
          ))}
        </section>

        <MarketingClose title="Make a place your group wants to return to." copy="Start with one calm room and let it become more useful over time." secondaryHref="/features" secondaryLabel="See the system" />
      </main>
    </MarketingShell>
  );
}

const faqTopics = ['All', 'Basics', 'Features', 'Plans', 'People', 'Privacy'];

export function FaqPage() {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('All');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFaqs = useMemo(() => faqItems.filter((item) => {
    const matchesTopic = topic === 'All' || item.topic === topic;
    const matchesQuery = !normalizedQuery || `${item.question} ${item.answer}`.toLowerCase().includes(normalizedQuery);
    return matchesTopic && matchesQuery;
  }), [normalizedQuery, topic]);

  return (
    <MarketingShell title="Minimalist | Frequently Asked Questions" shape={null} description="Answers about Minimalist rooms, collaboration tools, plans, contacts, and privacy." structuredData={FAQ_PAGE_STRUCTURED_DATA}>
      <main className="marketing-v4 faq-v4">
        <section className="mkt4-hero mkt4-faq-hero">
          <div className="mkt4-hero-copy"><h1>Answers without the scavenger hunt.</h1><p>Search the details, narrow by topic, and open only what you need.</p></div>
          <div className="mkt4-faq-search-panel">
            <label htmlFor="faq-search"><span>SEARCH HELP</span><i className="ph-bold ph-magnifying-glass" /></label>
            <input id="faq-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rooms, plans, privacy..." autoComplete="off" />
            <p aria-live="polite">{filteredFaqs.length} {filteredFaqs.length === 1 ? 'answer' : 'answers'} available</p>
          </div>
        </section>

        <section className="mkt4-section mkt4-faq-section">
          <header className="mkt4-section-heading"><div><span>01</span><h2>Find the right answer.</h2></div><p>Filter the knowledge base without leaving the page.</p></header>
          <div className="mkt4-topic-rail" aria-label="FAQ topics">
            {faqTopics.map((item) => <button type="button" aria-pressed={topic === item} className={topic === item ? 'is-active' : ''} onClick={() => setTopic(item)} key={item}>{item}</button>)}
          </div>
          <div className="mkt4-faq-list">
            {filteredFaqs.map((item, index) => (
              <details className="mkt4-faq-row" open={index === 0 && !normalizedQuery} key={item.question}>
                <summary><span>{item.topic}</span><strong>{item.question}</strong><i className="ph-bold ph-plus" /></summary>
                <p>{item.answer}</p>
              </details>
            ))}
            {filteredFaqs.length === 0 ? <div className="mkt4-faq-empty"><i className="ph-bold ph-magnifying-glass" /><h2>No answers matched.</h2><p>Try another phrase or clear the current topic.</p><button type="button" className="mkt4-button" onClick={() => { setQuery(''); setTopic('All'); }}>Clear filters</button></div> : null}
          </div>
        </section>

        <section className="mkt4-support-strip"><div><h2>Still need help?</h2><p>Talk to a person or report something that is not working.</p></div><div className="mkt4-actions"><a href="mailto:support@minimalist.com" className="mkt4-button is-primary">Email support <CtaArrowIcon /></a><a href="https://github.com/Hao14/minimalist-chat/issues" target="_blank" rel="noopener noreferrer" className="mkt4-button">Report a bug</a></div></section>
      </main>
    </MarketingShell>
  );
}

const privacySections = [
  {
    id: 'information-we-collect',
    title: '1. Information We Collect',
    copy: 'We collect the information needed to provide the service:',
    items: [
      <><strong>Account Data:</strong> Email address, display name, profile details, and authentication identifiers.</>,
      <><strong>Chat Data:</strong> Messages, uploaded files, reactions, room content, and collaboration data.</>,
      <><strong>Billing Data:</strong> Subscription status and Stripe customer identifiers. We do not store raw payment-card numbers.</>,
    ],
  },
  {
    id: 'third-party-services',
    title: '2. Third-Party Services',
    items: [
      <><strong>Google Firebase:</strong> Authentication, real-time data, functions, and file storage.</>,
      <><strong>Stripe:</strong> Secure subscription payment processing.</>,
    ],
  },
  {
    id: 'right-to-deletion',
    title: '3. Your Right to Deletion',
    copy: 'You can permanently delete your account from Settings. This removes your profile and authentication record.',
  },
];

const termsSections = [
  {
    id: 'acceptance',
    title: '1. Acceptance of Terms',
    copy: 'By accessing Minimalist Chat, you agree to these terms. If you do not agree, do not use the service.',
  },
  {
    id: 'user-conduct',
    title: '2. User Conduct & Content',
    copy: 'You are responsible for content you transmit and agree not to:',
    items: [
      <>Upload or share illegal, harmful, or abusive content.</>,
      <>Impersonate another person or entity.</>,
      <>Bypass billing, authentication, or security controls.</>,
    ],
  },
  {
    id: 'subscriptions',
    title: '3. Subscriptions & Refunds',
    copy: 'Paid features are billed through Stripe. Subscriptions renew until cancelled and can be managed through the billing portal.',
  },
];

function LegalDocumentPage({ title, description, sections }) {
  return (
    <MarketingShell title={`Minimalist | ${title}`} shape={null} description={description}>
      <main className="marketing-v4 legal-v4" id="top">
        <section className="mkt4-hero mkt4-legal-hero">
          <div className="mkt4-hero-copy"><h1>{title}</h1><p>Clear, plain-language details for using Minimalist with confidence.</p></div>
          <div className="mkt4-legal-meta"><span>LAST UPDATED</span><strong>June 2026</strong><button type="button" className="mkt4-button" onClick={() => window.print()}><i className="ph-bold ph-file-text" /> Print</button></div>
        </section>
        <div className="mkt4-legal-layout">
          <aside className="mkt4-legal-nav" aria-label={`${title} contents`}>
            <span>ON THIS PAGE</span>
            {sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title.replace(/^\d+\.\s*/, '')}</a>)}
            <a href="#top">Back to top</a>
          </aside>
          <article className="mkt4-legal-document">
            {sections.map((section) => (
              <section className="mkt4-legal-section" id={section.id} key={section.id}>
                <h2>{section.title}</h2>
                {section.copy ? <p>{section.copy}</p> : null}
                {section.items ? <ul>{section.items.map((item, index) => <li key={`${section.id}-${index}`}>{item}</li>)}</ul> : null}
              </section>
            ))}
          </article>
        </div>
      </main>
    </MarketingShell>
  );
}

export function PrivacyPage() {
  return <LegalDocumentPage title="Privacy Policy" description="Read how Minimalist handles account, chat, billing, Firebase, Stripe, and account-deletion data." sections={privacySections} />;
}

export function TermsPage() {
  return <LegalDocumentPage title="Terms of Service" description="Read the Minimalist terms covering acceptance, user conduct, content, subscriptions, and refunds." sections={termsSections} />;
}

export function NotFoundPage() {
  return <MarketingShell title="Minimalist | Not Found" canonical={false} noindex><main className="container not-found-page"><div className="not-found-code">404</div><h1>Page <span>Not Found.</span></h1><p>That page wandered off. Let’s get you back somewhere useful.</p><Link to="/" className="lp-btn lp-btn-primary">Return Home</Link></main></MarketingShell>;
}
