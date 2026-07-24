import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  downloadPageContent,
  featuresPageContent,
  homePageContent,
  storyPageContent,
} from '../content/publicMarketingContent.js';
import {
  AUTH_PRESENCE_HINT_EVENT,
  AUTH_PRESENCE_HINT_KEY,
  readAuthPresenceHint,
} from '../lib/authPresenceHint.js';
import './faqTerms.css';
import './marketingV5.css';
import './helpCenter.css';

const MarketingFaqContent = lazy(() => import('./MarketingFaqContent.jsx'));
const MarketingLegalContent = lazy(() => import('./MarketingLegalContent.jsx'));
const MarketingPricingContent = lazy(() => import('./MarketingPricingContent.jsx'));

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
  '[data-marketing-reveal]',
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
  ['/pricing', 'Pricing'],
  ['/download', 'Download'],
  ['/story', 'Story'],
];

const mobileMarketingNavGroups = [
  {
    id: 'marketing-mobile-discover',
    label: 'Discover',
    items: [
      ['/', 'Home', 'ph-house'],
      ['/features', 'Features', 'ph-sparkle'],
      ['/pricing', 'Pricing', 'ph-currency-circle-dollar'],
    ],
  },
  {
    id: 'marketing-mobile-resources',
    label: 'Resources',
    items: [
      ['/download', 'Download', 'ph-download-simple'],
      ['/story', 'Story', 'ph-book-open-text'],
      ['/faq', 'FAQ', 'ph-info'],
    ],
  },
];

const mobileMarketingPolicyItems = [
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
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
  const [suppressInitialHomeReveal] = useState(() => (
    pathname === '/' && Boolean(document.getElementById('static-home-shell'))
  ));
  const [playNavigationIntro] = useState(() => (
    !animatedMarketingPaths.has(motionPathKey)
      && !suppressInitialHomeReveal
  ));

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const playRevealMotion = !suppressInitialHomeReveal && !animatedMarketingPaths.has(motionPathKey);
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
      const hash = anchor.getAttribute('href');
      const target = document.querySelector(hash);
      if (!target) return;
      event.preventDefault();
      if (window.location.hash !== hash) window.history.pushState(null, '', hash);
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
  }, [motionPathKey, suppressInitialHomeReveal]);

  return playNavigationIntro;
}

function MarketingHeader({ playEntryMotion = false }) {
  const location = useLocation();
  const activePath = location.pathname === '/'
    ? '/'
    : location.pathname.replace(/\/+$/, '');
  const navRef = useRef(null);
  const menuButtonRef = useRef(null);
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

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 901px)');
    const handleDesktopChange = (event) => {
      if (event.matches) setMenuOpen(false);
    };
    desktopQuery.addEventListener('change', handleDesktopChange);
    return () => desktopQuery.removeEventListener('change', handleDesktopChange);
  }, []);

  return (
    <nav
      ref={navRef}
      className={`marketing-site-nav${playEntryMotion ? ' marketing-nav-enter' : ''}`}
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
          <span>{menuOpen ? 'Close' : 'Menu'}</span>
          <span className="nav-menu-icon" aria-hidden="true"><i /><i /></span>
        </button>
        <div
          id="marketing-mobile-nav-links"
          className={`mobile-only marketing-mobile-nav-links ${menuOpen ? 'is-open' : ''}`}
          role="group"
          aria-labelledby="marketing-mobile-nav-title"
          aria-hidden={!menuOpen}
        >
          <header className="mobile-nav-panel-heading">
            <span>Menu</span>
            <strong id="marketing-mobile-nav-title">Explore Minimalist</strong>
          </header>

          <div className="mobile-nav-scroll-region">
            <div className="mobile-nav-groups">
              {mobileMarketingNavGroups.map((group) => (
                <section className="mobile-nav-group" aria-labelledby={group.id} key={group.id}>
                  <h2 id={group.id}>{group.label}</h2>
                  <div className="mobile-nav-group-links">
                    {group.items.map(([path, label, icon]) => (
                      <Link
                        key={path}
                        to={path}
                        className={`mobile-link ${activePath === path ? 'active' : ''}`}
                        aria-current={activePath === path ? 'page' : undefined}
                        tabIndex={menuOpen ? undefined : -1}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span className="mobile-nav-link-icon" aria-hidden="true"><i className={`ph-bold ${icon}`} /></span>
                        <span>{label}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="mobile-nav-policy-links" aria-label="Policies">
              {mobileMarketingPolicyItems.map(([path, label]) => (
                <Link
                  key={path}
                  to={path}
                  className={`mobile-nav-policy-link ${activePath === path ? 'active' : ''}`}
                  aria-current={activePath === path ? 'page' : undefined}
                  tabIndex={menuOpen ? undefined : -1}
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className={`mobile-nav-action-zone${showLogin ? ' has-login' : ''}`}>
            {showLogin ? <Link to="/login" reloadDocument className="mobile-link mobile-login-link" tabIndex={menuOpen ? undefined : -1} onClick={() => setMenuOpen(false)}>Log in</Link> : null}
            <Link to="/chat" reloadDocument className="mobile-link mobile-signup-link" tabIndex={menuOpen ? undefined : -1} onClick={() => setMenuOpen(false)}>
              <span>Open the app</span>
              <span className="nav-cta-icon"><CtaArrowIcon /></span>
            </Link>
          </div>
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
          <Link className="footer-primary-link" to="/chat" reloadDocument>Create your first room <i className="ph-bold ph-arrow-right" aria-hidden="true" /></Link>
        </div>

        <div className="footer-grid" aria-label="Footer navigation">
          <div className="footer-col">
            <h2>Product</h2>
            <Link to="/">Home</Link>
            <Link to="/features">Features</Link>
            <Link to="/pricing">Pricing</Link>
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

const DEFAULT_META_DESCRIPTION = homePageContent.meta.description;
const DEFAULT_META_TITLE = homePageContent.meta.title;
const SITE_ORIGIN = 'https://minimalist.chat';
const PAGE_STRUCTURED_DATA_ID = 'minimalist-page-structured-data';

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

function Toast({ message, onClose, icon = 'ph-package' }) {
  return (
    <div id="brutalist-toast" className={message ? '' : 'toast-hidden'} role="status" aria-live="polite" aria-hidden={!message} hidden={!message}>
      <span id="toast-icon"><i className={`ph-bold ${icon}`} aria-hidden="true" /></span>
      <span id="toast-message">{message}</span>
      <button type="button" id="toast-close" aria-label="Close notification" tabIndex={message ? 0 : -1} onClick={onClose}>
        <i className="ph-bold ph-x" aria-hidden="true" />
      </button>
    </div>
  );
}

const landingDemoRooms = [
  { key: 'global', name: 'Global Chat', icon: 'ph-globe', preview: 'Welcome to the server.' },
  { key: 'home', name: 'HOME', icon: 'ph-house', preview: 'AI Agent: Your catch-up is ready.', favorite: true },
];

const landingDemoMessages = {
  global: [
    { id: 'global-1', author: 'Mina', initials: 'MI', time: '10:08 AM', dateTime: '10:08', text: 'Welcome! The new room guide is pinned above.' },
    { id: 'global-2', author: 'You', initials: 'YO', time: '10:11 AM', dateTime: '10:11', text: 'Perfect — I found everything.', self: true },
  ],
  home: [
    { id: 'home-ai', author: 'AI Agent', initials: 'AA', time: '12:18 AM', dateTime: '00:18', text: 'Welcome to HOME. I can summarize the chat, explain shared notes, and turn the conversation into next steps.', ai: true },
    { id: 'home-1', author: 'wane', initials: 'WA', time: '10:01 AM', dateTime: '10:01', text: 'I added the study outline and tonight’s checklist.', self: true },
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
  'Readable chat',
  'Catch-Me-Up',
  'Search',
  'Notifications',
];

const powerFeatures = [
  'Tasks',
  'Docs',
  'Whiteboards',
  'Events',
  'Calls',
  'Permissions',
  'Moderation',
  'Analytics',
  'AI workflows',
  'Calendar tools',
];

const FEATURE_MODE_KEY = 'minimalistMarketingMode';
const FEATURE_MODE_EVENT = 'minimalist:marketing-mode';

const featureModeMeta = {
  simple: {
    label: 'Calm mode',
    shortLabel: 'Calm',
    helper: 'Chat, catch-up, search, and notifications.',
    title: 'Calm mode keeps the room readable.',
    copy: 'Conversation, Catch-Me-Up, notifications, and search stay close without turning the room into a wall of controls.',
    list: simpleFeatures,
  },
  power: {
    label: 'Power mode',
    shortLabel: 'Power',
    helper: 'Tasks, documents, events, calls, permissions, and AI.',
    title: 'Power mode adds organized follow-through.',
    copy: 'Decisions, tasks, docs, events, calls, moderation, integrations, and permissions appear when a group needs more structure.',
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

const pricingPlanPresentation = Object.freeze({
  base: Object.freeze({
    bestFor: 'Small groups trying a calm shared room.',
    cta: 'Start free',
  }),
  advanced: Object.freeze({
    bestFor: 'Active collaborators who need practical upload and screen-sharing headroom.',
    cta: 'Choose Advanced',
    recommended: true,
  }),
  pro: Object.freeze({
    bestFor: 'Power users who want unlimited rooms, analytics, video, and Winston.',
    cta: 'Choose Pro',
  }),
  'base-room': Object.freeze({
    bestFor: 'Rooms that rely on each member’s existing account benefits.',
    cta: 'Create a room',
  }),
  'advanced-room': Object.freeze({
    bestFor: 'Growing private rooms assigning stronger benefits to up to 20 people.',
    cta: 'Choose Advanced Room',
    recommended: true,
  }),
  'pro-room': Object.freeze({
    bestFor: 'Larger private rooms assigning top room benefits to up to 50 people.',
    cta: 'Choose Pro Room',
  }),
});

export function PricingPlanRail({ ariaLabel, featureLimit = null, plans, showScope = false }) {
  return (
    <div className="landing-plans-rail" aria-label={ariaLabel}>
      {plans.map((plan) => {
        const planFeatures = showScope ? [plan.scope, ...plan.features] : plan.features;
        const visibleFeatures = Number.isInteger(featureLimit)
          ? planFeatures.slice(0, featureLimit)
          : planFeatures;
        const presentation = pricingPlanPresentation[plan.id] || {
          bestFor: plan.intent,
          cta: `Choose ${plan.name}`,
        };

        return (
          <article className={presentation.recommended ? 'is-recommended' : ''} key={plan.id}>
            <div className="landing-plan-heading">
              <span>{plan.name}</span>
              {presentation.recommended ? (
                <em><i className="ph-bold ph-star" aria-hidden="true" /> Recommended</em>
              ) : null}
            </div>
            <strong>{plan.displayPrice}</strong>
            <p className="landing-plan-best-for"><span>Best for</span>{presentation.bestFor}</p>
            <ul>{visibleFeatures.map((feature) => <li key={feature}><i className="ph-bold ph-check" aria-hidden="true" /> {feature}</li>)}</ul>
            <Link
              to="/chat"
              reloadDocument
              className={`landing-plan-cta${presentation.recommended ? ' is-primary' : ''}`}
            >
              {presentation.cta} <CtaArrowIcon />
            </Link>
          </article>
        );
      })}
    </div>
  );
}

export function LandingOutcomeVisual({ staticMotion = false }) {
  return (
    <aside className={`home-outcome-visual${staticMotion ? ' is-static' : ''}`} aria-label="A conversation becomes a decision and an assigned task">
      <header>
        <span><i className="ph-bold ph-hash" aria-hidden="true" /> Product launch</span>
        <small>Context stays attached</small>
      </header>
      <div className="home-outcome-flow">
        <div className="home-outcome-step is-conversation">
          <i className="ph-bold ph-chats-circle" aria-hidden="true" />
          <span><small>Conversation</small><strong>“Let’s ship Friday.”</strong></span>
        </div>
        <span className="home-outcome-connector" aria-hidden="true"><i /></span>
        <div className="home-outcome-step is-decision">
          <i className="ph-bold ph-seal-check" aria-hidden="true" />
          <span><small>Decision</small><strong>Friday launch approved</strong></span>
        </div>
        <span className="home-outcome-connector" aria-hidden="true"><i /></span>
        <div className="home-outcome-step is-task">
          <i className="ph-bold ph-check-square" aria-hidden="true" />
          <span><small>Task</small><strong>Publish the launch page</strong><em>Jordan · Today</em></span>
        </div>
      </div>
      <footer><i className="ph-bold ph-link" aria-hidden="true" /> One room, one useful thread of work.</footer>
    </aside>
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
  ['Tasks', 'ph-check-square'],
  ['Docs', 'ph-file-text'],
  ['Events', 'ph-calendar-dots'],
  ['Search', 'ph-magnifying-glass'],
];

function DemoGlobalRail() {
  return (
    <div className="desktop-demo-global-rail" aria-hidden="true">
      <div className="desktop-demo-mark"><span /><span /></div>
      <i className="ph-bold ph-chat-circle-text is-active" aria-hidden="true" />
      <i className="ph-bold ph-users" aria-hidden="true" />
      <i className="ph-bold ph-sparkle" aria-hidden="true" />
      <i className="ph-bold ph-identification-card" aria-hidden="true" />
      <span className="desktop-demo-rail-spacer" />
      <i className="ph-bold ph-bell" aria-hidden="true" />
      <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
      <i className="ph-bold ph-gear" aria-hidden="true" />
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
        <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
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
            <span className="desktop-demo-room-icon"><i className={`ph-bold ${room.icon}`} aria-hidden="true" /></span>
            <span>
              <strong>
                {room.name}
                {room.favorite ? <em aria-label="Favorite room"><i className="ph-bold ph-star" aria-hidden="true" /></em> : null}
              </strong>
              <small>{room.preview}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="desktop-demo-room-actions" aria-hidden="true">
        <span><i className="ph-bold ph-plus" aria-hidden="true" /> New room</span>
        <span>Join</span>
      </div>
    </aside>
  );
}

function DemoRoomTabs({ activeTab, onTabChange, tasksTabRef }) {
  return (
    <div className="desktop-demo-tabs" role="tablist" aria-label="Demo room views" aria-orientation="horizontal">
      {landingDemoTabs.map(([key, label, icon], index) => (
        <button
          type="button"
          id={`home-demo-tab-${key}`}
          role="tab"
          tabIndex={activeTab === key ? 0 : -1}
          aria-selected={activeTab === key}
          aria-controls="home-demo-panel"
          className={activeTab === key ? 'is-active' : ''}
          ref={key === 'tasks' ? tasksTabRef : undefined}
          onClick={() => onTabChange(key)}
          onKeyDown={(event) => handleTabListKeyDown(event, index, landingDemoTabs.length, (nextIndex) => onTabChange(landingDemoTabs[nextIndex][0]))}
          key={key}
        >
          <i className={`ph-bold ${icon}`} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
      <span className="desktop-demo-tab-add" aria-hidden="true"><i className="ph-bold ph-plus" /></span>
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
          {message.ai ? <em><i className="ph-bold ph-sparkle" aria-hidden="true" /> AI</em> : null}
          {message.dateTime
            ? <time dateTime={message.dateTime}>{message.time}</time>
            : <span className="desktop-demo-relative-time">{message.time}</span>}
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
  composerInputRef,
  catchUpCollapsed,
  taskConfirmationOpen,
  taskDraft,
  taskTriggerRef,
  onChannelChange,
  onDraftChange,
  onSend,
  onQuickReply,
  onToggleCatchUp,
  onCatchUpAction,
  onTaskDraftChange,
  onConfirmTask,
  onCancelTask,
}) {
  return (
    <div
      className="desktop-demo-chat-panel"
      id="home-demo-panel"
      role="tabpanel"
      aria-labelledby="home-demo-tab-chat"
      aria-label="Chat"
      tabIndex={0}
    >
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
        <button type="button" onClick={() => onCatchUpAction('Channel creation stays inside the full app.')}>
          <i className="ph-bold ph-plus" aria-hidden="true" /> Channel
        </button>
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
          <button type="button" onClick={() => onCatchUpAction('Catch-up refreshed with three key updates.')}><i className="ph-bold ph-sparkle" aria-hidden="true" /> Summarize</button>
          <button ref={taskTriggerRef} type="button" onClick={() => onCatchUpAction('task')}><i className="ph-bold ph-check-square" aria-hidden="true" /> Task</button>
          <button type="button" onClick={() => onCatchUpAction('Search opened for this demo room.')}><i className="ph-bold ph-magnifying-glass" aria-hidden="true" /> Search</button>
          <button type="button" onClick={() => onCatchUpAction('You are at the latest message.')}><i className="ph-bold ph-arrow-down" aria-hidden="true" /> Latest</button>
          <button type="button" className="desktop-demo-collapse" aria-label={catchUpCollapsed ? 'Expand catch-up' : 'Collapse catch-up'} onClick={onToggleCatchUp}>
            <i className={`ph-bold ph-caret-down${catchUpCollapsed ? ' is-up' : ''}`} aria-hidden="true" />
          </button>
        </div>
        {taskConfirmationOpen ? (
          <form className="desktop-demo-task-confirm" aria-label="Confirm demo task" onSubmit={onConfirmTask}>
            <label>
              <span>Task title</span>
              <input value={taskDraft} onChange={(event) => onTaskDraftChange(event.target.value)} autoFocus />
            </label>
            <button type="submit" disabled={!taskDraft.trim()}><i className="ph-bold ph-check" aria-hidden="true" /> Add task</button>
            <button type="button" onClick={onCancelTask}>Cancel</button>
          </form>
        ) : null}
      </section>

      <div className="desktop-demo-quick-replies" aria-label="Quick replies">
        <span>QUICK REPLIES</span>
        {landingQuickReplies.map((reply) => (
          <button type="button" onClick={() => onQuickReply(reply)} key={reply}>{reply}</button>
        ))}
      </div>

      <form className="desktop-demo-composer" onSubmit={onSend}>
        <div className="desktop-demo-composer-row">
          <input ref={composerInputRef} name="demo-message" value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Message HOME..." aria-label="Type a demo message" />
          <button type="submit" aria-label="Send demo message" disabled={!draft.trim()}><i className="ph-bold ph-paper-plane-tilt" aria-hidden="true" /></button>
        </div>
        <div className="desktop-demo-composer-tools" aria-hidden="true">
          <span><i className="ph-bold ph-paperclip" aria-hidden="true" /></span>
          <span><i className="ph-bold ph-code" aria-hidden="true" /></span>
          <span><i className="ph-bold ph-brackets-curly" aria-hidden="true" /></span>
          <span><i className="ph-bold ph-chart-bar" aria-hidden="true" /></span>
          <span><i className="ph-bold ph-clock" aria-hidden="true" /></span>
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
  calendar: ['Calendar', 'See deadlines and room events in one place.'],
  ai: ['Room AI', 'Summarize, explain, and turn conversation into next steps.'],
  calls: ['Calls', 'Start a room call when text is not enough.'],
};

function DemoToolPanel({ activeTab, tasks, completedTasks, onToggleTask }) {
  if (activeTab === 'tasks') {
    return (
      <section
        className="desktop-demo-tool-panel desktop-demo-task-panel"
        id="home-demo-panel"
        role="tabpanel"
        aria-labelledby="home-demo-tab-tasks"
        aria-label="Tasks"
        tabIndex={0}
      >
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
    <section
      className={`desktop-demo-tool-panel is-${activeTab}`}
      id="home-demo-panel"
      role="tabpanel"
      aria-labelledby={`home-demo-tab-${activeTab}`}
      aria-label={title}
      tabIndex={0}
    >
      <div className="desktop-demo-tool-heading"><span>{activeTab.toUpperCase()}</span><h3>{title}</h3><p>{copy}</p></div>
      <div className="desktop-demo-tool-canvas" aria-hidden="true">
        <article><i className="ph-bold ph-file-text" aria-hidden="true" /><strong>Study outline</strong><small>Updated today</small></article>
        <article><i className="ph-bold ph-check-square" aria-hidden="true" /><strong>Tonight at 7</strong><small>Shared with HOME</small></article>
      </div>
    </section>
  );
}

function LandingDesktopDemo() {
  const nextMessageId = useRef(0);
  const messageViewportRef = useRef(null);
  const composerInputRef = useRef(null);
  const taskTriggerRef = useRef(null);
  const tasksTabRef = useRef(null);
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
  const [taskConfirmationOpen, setTaskConfirmationOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [status, setStatus] = useState('Live local demo — no account or network required.');
  const messages = messagesByRoom[roomKey];
  const roomName = landingDemoRooms.find((room) => room.key === roomKey)?.name || 'HOME';

  const changeRoom = (nextRoom) => {
    setRoomKey(nextRoom);
    setActiveTab('chat');
    setTaskConfirmationOpen(false);
    setTaskDraft('');
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

  const chooseQuickReply = (reply) => {
    setDraft(reply);
    setStatus('Quick reply added to the draft. Review it, then send when ready.');
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const handleCatchUpAction = (action) => {
    if (action !== 'task') {
      setTaskConfirmationOpen(false);
      setTaskDraft('');
      setCatchUpCollapsed(false);
      setStatus(action);
      return;
    }
    const source = messages.at(-1)?.text || 'Review the latest room update';
    setTaskDraft(source);
    setTaskConfirmationOpen(true);
    setCatchUpCollapsed(false);
    setStatus('Review the task title before adding it to the local demo.');
  };

  const confirmCatchUpTask = (event) => {
    event.preventDefault();
    const clean = taskDraft.trim();
    if (!clean) return;
    const alreadyExists = tasks.some((task) => task.text === clean);
    if (!alreadyExists) {
      setTasks((current) => [...current, { id: `task-${nextMessageId.current++}`, text: clean, owner: 'You' }]);
    }
    setTaskConfirmationOpen(false);
    setTaskDraft('');
    setActiveTab('tasks');
    setStatus(alreadyExists ? 'That room task already exists.' : 'Task added to the local demo.');
    window.requestAnimationFrame(() => tasksTabRef.current?.focus());
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
    setTaskConfirmationOpen(false);
    setTaskDraft('');
    setStatus('Demo reset.');
  };

  return (
    <div className="desktop-demo" id="home-live-demo" aria-label="Interactive Minimalist desktop chat demo" tabIndex={-1}>
      <div className="desktop-demo-windowbar">
        <div className="desktop-demo-window-dots" aria-hidden="true"><span /><span /><span /></div>
        <div className="desktop-demo-window-actions">
          <span aria-hidden="true"><i className="ph-bold ph-magnifying-glass" /></span>
          <span className="desktop-demo-profile" aria-hidden="true">WA</span>
          <button type="button" onClick={resetDemo} aria-label="Reset demo"><i className="ph-bold ph-arrow-counter-clockwise" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="desktop-demo-shell">
        <DemoGlobalRail />
        <DemoRoomRail roomKey={roomKey} onRoomChange={changeRoom} />
        <div className="desktop-demo-workspace">
          <header className="desktop-demo-room-header">
            <div><strong>{roomName}</strong>{roomKey === 'home' ? <span>PRIVATE</span> : null}<i className="ph-bold ph-caret-down" aria-hidden="true" /></div>
            <button type="button" onClick={() => setStatus('Search opened for this demo room.')} aria-label="Search demo messages"><i className="ph-bold ph-magnifying-glass" aria-hidden="true" /></button>
          </header>
          <DemoRoomTabs activeTab={activeTab} onTabChange={setActiveTab} tasksTabRef={tasksTabRef} />
          {activeTab === 'chat' ? (
            <DemoChatPanel
              channel={channel}
              draft={draft}
              messages={messages}
              messageViewportRef={messageViewportRef}
              composerInputRef={composerInputRef}
              catchUpCollapsed={catchUpCollapsed}
              taskConfirmationOpen={taskConfirmationOpen}
              taskDraft={taskDraft}
              taskTriggerRef={taskTriggerRef}
              onChannelChange={(nextChannel) => { setChannel(nextChannel); setStatus(`# ${nextChannel} selected.`); }}
              onDraftChange={setDraft}
              onSend={sendMessage}
              onQuickReply={chooseQuickReply}
              onToggleCatchUp={() => setCatchUpCollapsed((collapsed) => !collapsed)}
              onCatchUpAction={handleCatchUpAction}
              onTaskDraftChange={setTaskDraft}
              onConfirmTask={confirmCatchUpTask}
              onCancelTask={() => {
                setTaskConfirmationOpen(false);
                setTaskDraft('');
                setStatus('Task creation canceled.');
                window.requestAnimationFrame(() => taskTriggerRef.current?.focus());
              }}
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

function LandingMobileDemo() {
  const [activeCard, setActiveCard] = useState(0);
  const trackRef = useRef(null);
  const previewLabels = ['Conversation', 'Decision', 'Task'];

  const updateActiveCard = () => {
    const track = trackRef.current;
    if (!track) return;
    const cards = [...track.querySelectorAll('.home-mobile-demo-card')];
    let nextIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    cards.forEach((card, index) => {
      const distance = Math.abs(card.offsetLeft - track.scrollLeft);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nextIndex = index;
      }
    });
    setActiveCard((current) => (current === nextIndex ? current : nextIndex));
  };

  return (
    <section className="home-mobile-demo" aria-label="Compact mobile product preview">
      <div className="home-mobile-demo-intro">
        <strong>Minimalist on mobile</strong>
        <span>Swipe through conversation, decision, and task.</span>
      </div>
      <div className="home-mobile-demo-track" onScroll={updateActiveCard} ref={trackRef} tabIndex={0}>
        <article className="home-mobile-demo-card" aria-label="Conversation preview">
          <header>
            <i className="ph-bold ph-arrow-left" aria-hidden="true" />
            <span><strong># Product Launch</strong><small>8 members</small></span>
            <i className="ph-bold ph-dots-three-vertical" aria-hidden="true" />
          </header>
          <div className="home-mobile-demo-pin">
            <i className="ph-bold ph-push-pin" aria-hidden="true" />
            <span>Launch plan v2 is in the docs.</span>
          </div>
          <div className="home-mobile-demo-messages">
            <div><span className="is-maya">MP</span><p><strong>Maya Patel <small>9:32 AM</small></strong>Here’s the latest plan. Let me know what you think.</p></div>
            <div><span className="is-jordan">JL</span><p><strong>Jordan Lee <small>9:35 AM</small></strong>Looks good. Shall we lock this in?</p></div>
            <div><span className="is-maya">MP</span><p><strong>Maya Patel <small>9:36 AM</small></strong>Yes, let’s ship Friday.</p></div>
          </div>
          <footer><i className="ph-bold ph-paperclip" aria-hidden="true" /><span>Message # Product Launch</span><i className="ph-bold ph-paper-plane-tilt" aria-hidden="true" /></footer>
        </article>

        <article className="home-mobile-demo-card is-decision" aria-label="Decision preview">
          <header>
            <i className="ph-bold ph-arrow-left" aria-hidden="true" />
            <span><strong># Product Launch</strong><small>Decision saved</small></span>
            <i className="ph-bold ph-dots-three-vertical" aria-hidden="true" />
          </header>
          <div className="home-mobile-demo-focus-icon"><i className="ph-bold ph-seal-check" aria-hidden="true" /></div>
          <div className="home-mobile-demo-focus-copy">
            <small>DECISION</small>
            <strong>Launch Friday</strong>
            <p>The agreement stays connected to the conversation that produced it.</p>
          </div>
          <div className="home-mobile-demo-context"><i className="ph-bold ph-link" aria-hidden="true" /><span>3 source messages</span><i className="ph-bold ph-caret-right" aria-hidden="true" /></div>
        </article>

        <article className="home-mobile-demo-card is-task" aria-label="Task preview">
          <header>
            <i className="ph-bold ph-arrow-left" aria-hidden="true" />
            <span><strong># Product Launch</strong><small>Task created</small></span>
            <i className="ph-bold ph-dots-three-vertical" aria-hidden="true" />
          </header>
          <div className="home-mobile-demo-focus-icon"><i className="ph-bold ph-check-square" aria-hidden="true" /></div>
          <div className="home-mobile-demo-focus-copy">
            <small>NEXT STEP</small>
            <strong>Publish the launch page</strong>
            <p>Assigned to Jordan with the decision and source messages still attached.</p>
          </div>
          <div className="home-mobile-demo-context"><i className="ph-bold ph-calendar-blank" aria-hidden="true" /><span>Due today</span><i className="ph-bold ph-user-circle" aria-hidden="true" /></div>
        </article>
      </div>
      <div className="home-mobile-demo-dots" aria-label={`Showing ${previewLabels[activeCard]} preview`} role="status">
        {previewLabels.map((label, index) => (
          <span
            aria-current={index === activeCard ? 'step' : undefined}
            aria-label={`${label} preview`}
            className={index === activeCard ? 'is-active' : ''}
            key={label}
            role="img"
          />
        ))}
      </div>
    </section>
  );
}

function LandingWorkflowSection() {
  const [activeState, setActiveState] = useState('chat');
  const state = landingWorkflowStates[activeState];
  const workflowEntries = Object.entries(landingWorkflowStates);

  return (
    <section className="landing-v3-section landing-workflow mv5-section" id="landing-workflow" data-marketing-reveal>
      <div className="landing-section-heading mv5-section-heading">
        <div><span>01</span><h2>{homePageContent.workflow.title}</h2></div>
        <p>{homePageContent.workflow.copy}</p>
      </div>
      <div className="landing-workflow-rail" role="tablist" aria-label="Conversation workflow">
        {workflowEntries.map(([key, item], index) => (
          <button
            type="button"
            id={`home-workflow-tab-${key}`}
            role="tab"
            tabIndex={activeState === key ? 0 : -1}
            aria-selected={activeState === key}
            aria-controls="home-workflow-panel"
            className={activeState === key ? 'is-active' : ''}
            onClick={() => setActiveState(key)}
            onKeyDown={(event) => handleTabListKeyDown(event, index, workflowEntries.length, (nextIndex) => setActiveState(workflowEntries[nextIndex][0]))}
            key={key}
          >
            <span><i className={`ph-bold ${item.icon}`} aria-hidden="true" /></span>
            <strong>{item.label}</strong>
            <small>{item.caption}</small>
          </button>
        ))}
      </div>
      <div className={`landing-workflow-state is-${activeState}`} id="home-workflow-panel" role="tabpanel" aria-labelledby={`home-workflow-tab-${activeState}`} aria-live="polite">
        <div className="landing-workflow-state-copy"><h3>{state.title}</h3><p>{state.copy}</p></div>
        <div className="landing-workflow-mini-app" aria-hidden="true">
          <div className="landing-workflow-mini-rail"><span>HOME</span><span># general</span><span># study</span></div>
          {activeState === 'chat' ? (
            <div className="landing-workflow-chat"><p>I added the notes to the pinboard.</p><p>Meeting at 7? I can share the outline.</p><span>Message HOME...</span></div>
          ) : null}
          {activeState === 'catchup' ? (
            <div className="landing-workflow-catchup"><strong>3 key updates</strong>{landingCatchUpItems.map((item) => <p key={item}><i className="ph-bold ph-check" aria-hidden="true" /> {item}</p>)}</div>
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
    <section className="landing-v3-section landing-signal mv5-section" data-marketing-reveal>
      <div className="landing-signal-copy">
        <span className="mv5-section-number">02</span>
        <h2>{homePageContent.signal.title}</h2>
        <p>{homePageContent.signal.copy}</p>
        <div className="landing-signal-modes" aria-label="Preview room mode">
          <button type="button" className={mode === 'focus' ? 'is-active' : ''} aria-pressed={mode === 'focus'} onClick={() => setMode('focus')}><i className="ph-bold ph-moon-stars" aria-hidden="true" /> Quiet view</button>
          <button type="button" className={mode === 'organize' ? 'is-active' : ''} aria-pressed={mode === 'organize'} onClick={() => setMode('organize')}><i className="ph-bold ph-list-checks" aria-hidden="true" /> Catch-up view</button>
        </div>
        <ul>{landingSignalFeatures.map(([label, icon]) => <li key={label}><i className={`ph-bold ${icon}`} aria-hidden="true" /> {label}</li>)}</ul>
      </div>
      <div className={`landing-signal-preview is-${mode}`} aria-live="polite">
        <div className="landing-signal-preview-top"><strong>HOME</strong><span>{mode === 'focus' ? 'Quiet view' : 'Catch-up view'}</span></div>
        {mode === 'focus' ? (
          <div className="landing-signal-focus"><article><strong>AI Agent</strong><p>Here are the three updates that matter today.</p></article><article><strong>wane</strong><p>The outline and checklist are ready for tonight.</p></article></div>
        ) : (
          <div className="landing-signal-organize"><strong>Room catch-up</strong>{landingCatchUpItems.map((item) => <p key={item}><i className="ph-bold ph-check-square" aria-hidden="true" /> {item}</p>)}<button type="button" onClick={() => setMode('focus')}>Return to chat</button></div>
        )}
      </div>
    </section>
  );
}

function LandingPlansSection() {
  return (
    <section className="landing-v3-section landing-close home-v5-close" data-marketing-reveal>
      <div className="landing-close-copy">
        <h2>{homePageContent.close.title}</h2>
        <p>{homePageContent.close.copy}</p>
      </div>
      <div className="landing-hero-actions">
        <Link to={homePageContent.close.primaryAction.href} reloadDocument className="lp-btn lp-btn-primary">{homePageContent.close.primaryAction.label} <CtaArrowIcon /></Link>
        <Link to="/pricing" className="landing-text-link">Compare plans <CtaArrowIcon /></Link>
      </div>
    </section>
  );
}

export function HomePage() {
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) window.location.replace('/chat');
  }, []);

  return (
    <MarketingShell title={DEFAULT_META_TITLE} description={DEFAULT_META_DESCRIPTION} shape={null}>
      <main className="landing-v3 marketing-v5 home-v5" data-marketing-home>
        <section className="landing-v3-section landing-hero mv5-hero" data-marketing-reveal>
          <div className="landing-hero-copy">
            <h1>{homePageContent.hero.title}</h1>
            <p>{homePageContent.hero.copy}</p>
            <div className="landing-hero-actions">
              <Link to={homePageContent.hero.actions[0].href} reloadDocument className="lp-btn lp-btn-primary">{homePageContent.hero.actions[0].label} <CtaArrowIcon /></Link>
              <a href={homePageContent.hero.actions[1].href} className="lp-btn lp-btn-secondary">{homePageContent.hero.actions[1].label}</a>
            </div>
          </div>
          <LandingOutcomeVisual />
        </section>
        <section className="landing-v3-section home-v5-demo" aria-label="Minimalist product preview" data-marketing-reveal>
          <LandingDesktopDemo />
          <LandingMobileDemo />
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
    <MarketingPricingContent
      shellComponent={MarketingShell}
      ctaArrowIcon={CtaArrowIcon}
      pricingPlanRail={PricingPlanRail}
      marketingClose={MarketingClose}
    />
  );
}

const featureGroupIcons = Object.freeze({
  communicate: 'ph-chat-circle-text',
  'catch-up': 'ph-newspaper-clipping',
  create: 'ph-file-text',
  plan: 'ph-check-square',
  meet: 'ph-video-camera',
  search: 'ph-magnifying-glass',
  moderate: 'ph-shield-check',
  ai: 'ph-sparkle',
});

const featureStatusCopy = Object.freeze({
  available: 'Available now',
  beta: 'Availability varies',
  planned: 'Not in the current release',
});

const marketingFeatureCatalog = featuresPageContent.overview.map((overview) => {
  const groupFeatures = overview.featureIds
    .map((featureId) => featuresPageContent.catalog.find((feature) => feature.id === featureId))
    .filter(Boolean);
  const currentFeatures = groupFeatures.filter((feature) => feature.status !== 'planned');
  return {
    key: overview.id,
    group: overview.title,
    name: overview.benefit,
    icon: featureGroupIcons[overview.id] || 'ph-squares-four',
    plan: overview.plan,
    media: overview.media,
    mediaAlt: overview.mediaAlt,
    mediaPosition: overview.mediaPosition,
    simple: {
      title: overview.benefit,
      copy: overview.summary,
      points: currentFeatures.slice(0, 3).map((feature) => feature.title),
    },
    power: {
      title: overview.benefit,
      copy: overview.summary,
      points: groupFeatures.slice(0, 3).map((feature) => `${feature.title} · ${featureStatusCopy[feature.status]}`),
    },
  };
});

const featuredWorkflowKeys = Object.freeze(['catch-up', 'plan', 'create', 'meet']);
const featuredWorkflowCatalog = featuredWorkflowKeys
  .map((key) => marketingFeatureCatalog.find((feature) => feature.key === key))
  .filter(Boolean);

function planBadgeClass(plan) {
  return `features-plan-badge is-${String(plan || '').toLowerCase().replace(/\s+/g, '-')}`;
}

function FeatureRoomPreview({ feature }) {
  return (
    <figure className="mkt4-feature-preview">
      <img
        src={feature.media}
        alt={feature.mediaAlt}
        loading="lazy"
        decoding="async"
        style={{ objectPosition: feature.mediaPosition }}
      />
      <figcaption><span>Product capture</span><strong>{feature.group}</strong></figcaption>
    </figure>
  );
}

function FeatureOverview({ activeFeatureKey, onSelect }) {
  return (
    <section className="features-v5-overview" id="feature-groups" aria-label="Feature overview" data-marketing-reveal>
      <div className="features-v5-overview-grid">
        {marketingFeatureCatalog.map((feature) => (
          <a
            href="#feature-workbench"
            className={feature.key === activeFeatureKey ? 'is-active' : ''}
            aria-current={feature.key === activeFeatureKey ? 'true' : undefined}
            onClick={() => onSelect(feature.key)}
            key={feature.key}
          >
            <i className={`ph-bold ${feature.icon}`} aria-hidden="true" />
            <span><strong>{feature.group}</strong><small>{feature.name}</small></span>
            <em className={planBadgeClass(feature.plan)}>{feature.plan}</em>
          </a>
        ))}
      </div>
      <p className="features-v5-plan-note">{featuresPageContent.statusIntro}</p>
    </section>
  );
}

function FeatureWorkflowGallery({ onSelect }) {
  return (
    <section className="mkt4-section features-v5-gallery" data-marketing-reveal>
      <header className="mkt4-section-heading">
        <div><span>02</span><h2>See the work, not an icon.</h2></div>
        <p>Real product crops show how Catch-Up, Tasks, Docs, and Events behave before you open the full explorer.</p>
      </header>
      <div className="features-v5-gallery-grid">
        {featuredWorkflowCatalog.map((feature) => (
          <a
            href="#feature-workbench"
            className={`features-v5-gallery-card is-${feature.key}`}
            onClick={() => onSelect(feature.key)}
            key={feature.key}
          >
            <span className="features-v5-gallery-copy">
              <small>{feature.group}</small>
              <strong>{feature.name}</strong>
              <em className={planBadgeClass(feature.plan)}>{feature.plan}</em>
            </span>
            <span className="features-v5-gallery-media">
              <img src={feature.media} alt={feature.mediaAlt} loading="lazy" decoding="async" style={{ objectPosition: feature.mediaPosition }} />
            </span>
          </a>
        ))}
      </div>
    </section>
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
  const [activeFeatureKey, setActiveFeatureKey] = useState('catch-up');
  const activeFeature = marketingFeatureCatalog.find((feature) => feature.key === activeFeatureKey) || marketingFeatureCatalog[0];
  const activeDetail = activeFeature[mode];

  return (
    <MarketingShell title={featuresPageContent.meta.title} shape={null} description={featuresPageContent.meta.description}>
      <main className="marketing-v4 marketing-v5 features-v5" data-feature-mode={mode}>
        <section className="mkt4-hero mkt4-features-hero mv5-hero" data-marketing-reveal>
          <div className="mkt4-hero-copy">
            <h1>{featuresPageContent.hero.title}</h1>
          </div>
          <div className="features-v5-hero-side">
            <p>{featuresPageContent.hero.copy}</p>
            <FeatureModeSwitch mode={mode} onChange={setMode} className="mkt4-mode-switch" />
            <div className="mkt4-actions">
              <a href="#feature-workbench" className="mkt4-button is-primary">Explore the system <CtaArrowIcon /></a>
              <Link to="/chat" reloadDocument className="mkt4-button">Open the app</Link>
            </div>
          </div>
        </section>

        <FeatureOverview activeFeatureKey={activeFeature.key} onSelect={setActiveFeatureKey} />

        <FeatureWorkflowGallery onSelect={setActiveFeatureKey} />

        <section className="mkt4-section features-v5-workbench" id="feature-workbench" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>03</span><h2>Explore each purpose.</h2></div>
            <p>Select a workflow to see its outcome, plan guide, current availability, and the product surface behind it.</p>
          </header>
          <div className="mkt4-explorer">
            <div className="mkt4-explorer-tabs" role="tablist" aria-orientation="horizontal" aria-label={`${activeMode.label} features`}>
              {marketingFeatureCatalog.map((feature, index) => {
                const selected = feature.key === activeFeature.key;
                return (
                  <button
                    type="button"
                    id={`mkt4-feature-tab-${feature.key}`}
                    role="tab"
                    tabIndex={selected ? 0 : -1}
                    aria-selected={selected}
                    aria-controls="mkt4-feature-panel"
                    className={selected ? 'is-active' : ''}
                    onClick={() => setActiveFeatureKey(feature.key)}
                    onKeyDown={(event) => handleTabListKeyDown(event, index, marketingFeatureCatalog.length, (nextIndex) => setActiveFeatureKey(marketingFeatureCatalog[nextIndex].key))}
                    key={feature.key}
                  >
                    <i className={`ph-bold ${feature.icon}`} aria-hidden="true" />
                    <span><small>{feature.group}</small><strong>{feature.name}</strong></span>
                  </button>
                );
              })}
            </div>
            <div className="mkt4-explorer-panel" id="mkt4-feature-panel" role="tabpanel" aria-labelledby={`mkt4-feature-tab-${activeFeature.key}`} aria-live="polite">
              <div className="mkt4-explorer-copy">
                <span>{activeMode.label} · {activeFeature.group} <em className={planBadgeClass(activeFeature.plan)}>{activeFeature.plan}</em></span>
                <h3>{activeDetail.title}</h3>
                <p>{activeDetail.copy}</p>
                <ul>{activeDetail.points.map((point) => <li key={point}><i className="ph-bold ph-check" aria-hidden="true" /> {point}</li>)}</ul>
              </div>
              <FeatureRoomPreview feature={activeFeature} />
            </div>
          </div>
        </section>

        <section className="mkt4-section mkt4-room-flow" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>04</span><h2>{mode === 'simple' ? 'The essentials stay obvious.' : 'The deeper tools stay organized.'}</h2></div>
            <p>{activeMode.copy}</p>
          </header>
          <div className="mkt4-flow-list">
            {activeMode.list.map((feature, index) => <div key={feature}><span>{String(index + 1).padStart(2, '0')}</span><strong>{feature}</strong></div>)}
          </div>
        </section>

        <MarketingClose title="Start with a room. Add depth when it helps." copy="Create a calm place for your people, then let the useful structure grow with the conversation." />
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
    availability: 'available',
    meta: 'Works in a modern browser',
    cta: 'Open Minimalist',
    href: '/chat',
    requirements: ['Use the room workspace without a separate installer', 'Install or pin it when your browser offers that option'],
  },
  {
    id: 'windows',
    name: 'Windows',
    icon: 'ph-windows-logo',
    status: 'Not announced',
    availability: 'not-announced',
    meta: 'No public Windows release date',
    requirements: ['Use the web app on Windows today', 'Any future native release will be listed here'],
  },
  {
    id: 'mac',
    name: 'macOS',
    icon: 'ph-apple-logo',
    status: 'Not announced',
    availability: 'not-announced',
    meta: 'No public macOS release date',
    requirements: ['Use the web app on macOS today', 'Any future native release will be listed here'],
  },
  {
    id: 'android',
    name: 'Android',
    icon: 'ph-android-logo',
    status: 'Not announced',
    availability: 'not-announced',
    meta: 'No public Android release date',
    requirements: ['Use the mobile web app today', 'No production Android download is currently published'],
  },
  {
    id: 'ios',
    name: 'iPhone & iPad',
    icon: 'ph-device-mobile',
    status: 'Not announced',
    availability: 'not-announced',
    meta: 'No public iOS or iPadOS release date',
    requirements: ['Use the mobile web app today', 'No production App Store download is currently published'],
  },
];

const downloadHighlights = [
  ['ph-globe', 'Web app available', 'Open Minimalist on desktop or mobile without waiting for a native release.'],
  ['ph-cloud-check', 'Account-backed rooms', 'Signed-in room data is available anywhere the supported web app is available.'],
  ['ph-download-simple', 'Install when offered', 'Supported browsers can add an app-like shortcut for a faster return.'],
];

const installSteps = [
  ['Open', 'Use the web app today from any modern browser.'],
  ['Install or pin', 'Use the browser install control, taskbar, dock, or Home Screen when supported.'],
  ['Sign in', 'Pick up rooms, messages, files, and settings from one account.'],
];

const downloadFaqs = [
  ['Is there a native installer?', 'No production desktop or mobile store download is currently published. The web app is the available path today.'],
  ['Can I use it on my phone?', 'Yes. Open the web app on mobile, then add it to your Home Screen for an app-like flow.'],
  ['Is it free?', 'Yes. Base is free; Advanced and Pro add higher limits, analytics, video, badges, and power features.'],
  ['What stays on this device?', 'The browser keeps local session, preference, cache, and install data. Signed-in room content is stored through Minimalist services and can be available in another supported browser.'],
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
  const toastTimerRef = useRef(null);
  const [installState, setInstallState] = useState(() => window.getMinimalistInstallState?.() || { canInstall: false, installed: false });
  const [selectedPlatformId, setSelectedPlatformId] = useState('web');
  const detectedLabel = downloads.find((item) => item.id === platform)?.name;
  const selectedPlatform = downloads.find((item) => item.id === selectedPlatformId) || downloads[0];

  useEffect(() => {
    const syncInstallState = (event) => setInstallState(event.detail || window.getMinimalistInstallState?.() || { canInstall: false, installed: false });
    syncInstallState({});
    window.addEventListener('minimalist:pwa-install-state', syncInstallState);
    return () => {
      window.removeEventListener('minimalist:pwa-install-state', syncInstallState);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (message) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast('');
      toastTimerRef.current = null;
    }, 3500);
  };

  const installApp = async () => {
    const result = await window.promptMinimalistInstall?.();
    if (result?.outcome === 'accepted') showToast('Minimalist is installing.');
    else showToast('Use your browser menu to install or pin Minimalist when supported.');
  };

  const useWebInstead = () => {
    setSelectedPlatformId('web');
    showToast(`${selectedPlatform.name} has no public native release. The web app is ready now.`);
  };

  return (
    <MarketingShell title={downloadPageContent.meta.title} shape={null} description={downloadPageContent.meta.description}>
      <main className="marketing-v4 marketing-v5 download-v5">
        <section className="mkt4-hero mkt4-download-hero mv5-hero" data-marketing-reveal>
          <div className="mkt4-hero-copy">
            <h1>{downloadPageContent.hero.title}</h1>
            <p>{downloadPageContent.hero.copy}</p>
            <div className="mkt4-actions">
              <Link to="/chat" reloadDocument className="mkt4-button is-primary">Open the web app <CtaArrowIcon /></Link>
              {installState.canInstall ? <button type="button" className="mkt4-button" onClick={installApp}><i className="ph-bold ph-download-simple" aria-hidden="true" /> Install app</button> : <a href="#platforms" className="mkt4-button">See availability</a>}
            </div>
          </div>
          <aside className="mkt4-readiness-console" aria-label="App readiness">
            <div className="mkt4-console-top"><span>DEVICE CHECK</span><strong>{installState.installed ? 'Installed' : 'Web ready'}</strong></div>
            <div className="mkt4-readiness-main">
              <span className="mkt4-readiness-icon"><i className="ph-bold ph-globe" aria-hidden="true" /></span>
              <div><small>CURRENT BEST OPTION</small><strong>Web App</strong><p>No installer required. Sign in and keep moving.</p></div>
            </div>
            <div className="mkt4-readiness-lines">
              <p><span>Detected device</span><strong>{detectedLabel || 'Modern browser'}</strong></p>
              <p><span>Account sync</span><strong>Ready</strong></p>
              <p><span>Install path</span><strong>{installState.installed ? 'Installed' : installState.canInstall ? 'Available' : 'Browser menu'}</strong></p>
            </div>
          </aside>
        </section>

        <section className="mkt4-benefit-rail" aria-label="Download benefits" data-marketing-reveal>
          {downloadHighlights.map(([icon, title, text], index) => <div key={title}><span>{String(index + 1).padStart(2, '0')}</span><i className={`ph-bold ${icon}`} aria-hidden="true" /><strong>{title}</strong><p>{text}</p></div>)}
        </section>

        <section className="mkt4-section" id="platforms" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>01</span><h2>Availability, clearly labeled.</h2></div>
            <p>The web app is available now. Other platforms have no public native release or release date.</p>
          </header>
          <div className="mkt4-platform-workbench">
            <div className="mkt4-platform-list" role="tablist" aria-orientation="vertical" aria-label="Minimalist platforms">
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
                  <i className={`ph-bold ${item.icon}`} aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.meta}</small></span><em>{item.status}</em><CtaArrowIcon />
                </button>
              ))}
            </div>
            <div className="mkt4-platform-detail" id="mkt4-platform-detail" role="tabpanel" aria-labelledby={`mkt4-platform-tab-${selectedPlatform.id}`} aria-live="polite">
              <div className="mkt4-platform-detail-head"><span><i className={`ph-bold ${selectedPlatform.icon}`} aria-hidden="true" /></span><small>{selectedPlatform.status}</small></div>
              <h3>{selectedPlatform.name}</h3>
              <p>{selectedPlatform.meta}</p>
              <ul>{selectedPlatform.requirements.map((requirement) => <li key={requirement}><i className="ph-bold ph-check" aria-hidden="true" /> {requirement}</li>)}</ul>
              {selectedPlatform.href ? (
                <div className="mkt4-actions"><Link to={selectedPlatform.href} reloadDocument className="mkt4-button is-primary">Open Minimalist <CtaArrowIcon /></Link>{installState.canInstall ? <button type="button" className="mkt4-button" onClick={installApp}>Install app</button> : null}</div>
              ) : <button type="button" className="mkt4-button is-primary" onClick={useWebInstead}>Open the web option <CtaArrowIcon /></button>}
            </div>
          </div>
        </section>

        <section className="mkt4-section" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>02</span><h2>Use it like an app.</h2></div>
            <p>Three quick steps, with the same rooms and settings following your sign-in.</p>
          </header>
          <div className="mkt4-install-rail">
            {installSteps.map(([label, text], index) => <div key={label}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong><p>{text}</p></div></div>)}
          </div>
        </section>

        <section className="mkt4-section download-v5-storage" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>03</span><h2>What follows you. What stays local.</h2></div>
            <p>Signed-in room content is service-backed. Your browser also keeps local state to make the installed or pinned experience work.</p>
          </header>
          <div className="download-v5-storage-grid">
            <article><i className="ph-bold ph-cloud-check" aria-hidden="true" /><h3>Available after sign-in</h3><p>Rooms, messages, files, docs, tasks, events, and supported account settings.</p></article>
            <article><i className="ph-bold ph-device-mobile" aria-hidden="true" /><h3>Kept by this browser</h3><p>Session state, local preferences, app cache, and install or Home Screen state.</p></article>
          </div>
        </section>

        <section className="mkt4-section mkt4-download-faq" data-marketing-reveal>
          <header className="mkt4-section-heading"><div><span>04</span><h2>Download FAQ.</h2></div></header>
          <div className="mkt4-details-list">
            {downloadFaqs.map(([question, answer], index) => <details open={index === 0} key={question}><summary><span>{question}</span><i className="ph-bold ph-plus" aria-hidden="true" /></summary><p>{answer}</p></details>)}
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
  ['Structure when useful', 'Tasks, docs, events, calls, and moderation should appear because a room needs them—not because a dashboard has space.'],
  ['Context that serves people', 'Catch-ups, search, files, and shared work should help people move forward without pretending to remember everything for them.'],
];

const storyTimeline = [
  ['01', 'Everything competes', 'Messages, tabs, pings, and tools arrive faster than people can turn them into shared understanding.'],
  ['02', 'A room creates space', 'One place gathers the right people, conversation, files, and tools. The chatter quiets and the group can focus.'],
  ['03', 'Context becomes useful', 'Search, catch-ups, tasks, docs, and events help the room carry important context into the next moment.'],
];

export function StoryPage() {
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const activeStage = storyTimeline[activeStageIndex];

  return (
    <MarketingShell title={storyPageContent.meta.title} shape={null} description={storyPageContent.meta.description}>
      <main className="marketing-v4 marketing-v5 story-v5">
        <section className="mkt4-hero mkt4-story-hero mv5-hero" data-marketing-reveal>
          <div className="mkt4-hero-copy">
            <h1>{storyPageContent.hero.title}</h1>
            <p>{storyPageContent.hero.copy}</p>
          </div>
          <div className="mkt4-story-map" aria-label="From noise to useful context">
            <div><span>01</span><strong>Noise</strong></div><i aria-hidden="true" />
            <div className="is-active"><span>02</span><strong>Room</strong></div><i aria-hidden="true" />
            <div><span>03</span><strong>Context</strong></div>
          </div>
        </section>

        <section className="mkt4-story-manifesto story-v5-note" data-marketing-reveal>
          <div><h2>A short note.</h2><span>Why this exists</span></div>
          <p><strong>We did not set out to build another feed.</strong> Minimalist is organized around rooms and the people inside them—not an engagement-ranked social stream.</p>
          <p>Tools should get out of the way. Rooms should feel quiet, not empty. Useful context should lighten the load, not track people.</p>
        </section>

        <section className="mkt4-section" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>01</span><h2>From noise to room to context.</h2></div>
            <p>Three steps define the product: protect the conversation, add structure when it helps, and make returning easier.</p>
          </header>
          <div className="mkt4-story-stage">
            <div className="mkt4-story-stage-tabs" role="tablist" aria-orientation="vertical" aria-label="How Minimalist turns noise into useful context">
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

        <section className="mkt4-section mkt4-principles" aria-label="Design principles" data-marketing-reveal>
          <header className="mkt4-section-heading"><div><span>02</span><h2>Principles over noise.</h2></div></header>
          {storyPrinciples.map(([title, copy], index) => (
            <article className="mkt4-principle-row" key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{copy}</p></article>
          ))}
        </section>

        <blockquote className="story-v5-quote" data-marketing-reveal>
          <span aria-hidden="true">“</span>
          <p>The goal is not to do more in less time. It is to do what matters with a clearer mind.</p>
          <cite>Minimalist manifesto</cite>
        </blockquote>

        <MarketingClose title="A calmer way to work starts here." copy="Open one room for your people and let useful structure earn its place." secondaryHref="/features" secondaryLabel="See the system" />
      </main>
    </MarketingShell>
  );
}

export function FaqPage() {
  return <MarketingFaqContent MarketingShell={MarketingShell} CtaArrowIcon={CtaArrowIcon} />;
}

export function PrivacyPage() {
  return (
    <MarketingLegalContent
      page="privacy"
      shellComponent={MarketingShell}
      ctaArrowIcon={CtaArrowIcon}
    />
  );
}

export function TermsPage() {
  return (
    <MarketingLegalContent
      page="terms"
      shellComponent={MarketingShell}
      ctaArrowIcon={CtaArrowIcon}
    />
  );
}

export function NotFoundPage() {
  return <MarketingShell title="Minimalist | Not Found" canonical={false} noindex><main className="container not-found-page"><div className="not-found-code">404</div><h1>Page <span>Not Found.</span></h1><p>That page wandered off. Let’s get you back somewhere useful.</p><Link to="/" className="lp-btn lp-btn-primary">Return Home</Link></main></MarketingShell>;
}
