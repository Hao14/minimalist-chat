import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase.js';

const MARKETING_REVEAL_SELECTOR = [
  '.lp-hero',
  '.home-section',
  '.home-use-card',
  '.home-demo-card',
  '.home-trust-card',
  '.home-price-card',
  '.home-mode-card',
  '.home-cinematic-hero',
  '.home-cinema-card',
  '.home-compact-showcase',
  '.home-proof-panel',
  '.home-different-grid > div',
  '.home-faq-list details',
  '.home-final-cta',
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
].join(',');

const MARKETING_TILT_SELECTOR = [
  '.home-preview-card',
  '.home-use-card',
  '.home-demo-card',
  '.home-trust-card',
  '.home-price-card',
  '.home-cinema-card',
  '.home-proof-panel',
  '.feat-card',
  '.dl-card',
  '.dl-device-card',
  '.story-card',
].join(',');

const MARKETING_MORPH_PATHS = [
  'M20 42 C20 18 38 10 62 10 C88 10 104 26 104 50 C104 74 86 90 60 90 L24 90 C20 90 20 86 20 82 Z',
  'M16 48 C16 24 33 12 58 12 C86 12 108 28 108 53 C108 78 86 88 62 88 L27 88 C18 88 16 80 16 74 Z',
  'M22 38 C22 18 44 8 68 14 C91 20 108 37 104 60 C100 83 78 92 54 86 L25 86 C20 86 22 78 22 72 Z',
  'M18 44 C18 23 36 10 64 11 C94 12 108 31 106 54 C104 76 84 91 58 90 L24 90 C18 90 18 84 18 78 Z',
];

function Brand() {
  return (
    <Link to="/" id="nav-logo" aria-label="Minimalist home">
      <div className="mascot-blip"><div className="blip-eye left" /><div className="blip-eye right" /></div>
      <span className="logo-text">MINIMALIST</span>
    </Link>
  );
}

function useMarketingMotion() {
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const root = document.documentElement;
    const revealed = new WeakSet();
    const tilted = new WeakSet();
    const tiltCleanups = [];
    let revealOrder = 0;
    let scrollRaf = 0;
    let pointerRaf = 0;
    let latestPointer = { x: 50, y: 50 };

    const markVisible = (element) => {
      element.classList.add('is-in-view');
    };

    const observer = reduceMotion
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
        element.classList.add('mkt-reveal');
        element.style.setProperty('--reveal-order', `${revealOrder % 9}`);
        revealOrder += 1;
        if (reduceMotion) markVisible(element);
        else observer?.observe(element);
      });
    };

    const attachTilt = () => {
      if (reduceMotion) return;
      document.querySelectorAll(MARKETING_TILT_SELECTOR).forEach((element) => {
        if (tilted.has(element)) return;
        tilted.add(element);

        const onMove = (event) => {
          const rect = element.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) - 0.5;
          const y = ((event.clientY - rect.top) / rect.height) - 0.5;
          element.style.setProperty('--tilt-x', `${(-y * 5).toFixed(2)}deg`);
          element.style.setProperty('--tilt-y', `${(x * 6).toFixed(2)}deg`);
          element.style.setProperty('--tilt-glow-x', `${((x + 0.5) * 100).toFixed(1)}%`);
          element.style.setProperty('--tilt-glow-y', `${((y + 0.5) * 100).toFixed(1)}%`);
          element.classList.add('is-tilting');
        };

        const onLeave = () => {
          element.style.removeProperty('--tilt-x');
          element.style.removeProperty('--tilt-y');
          element.style.removeProperty('--tilt-glow-x');
          element.style.removeProperty('--tilt-glow-y');
          element.classList.remove('is-tilting');
        };

        element.addEventListener('pointermove', onMove);
        element.addEventListener('pointerleave', onLeave);
        tiltCleanups.push(() => {
          element.removeEventListener('pointermove', onMove);
          element.removeEventListener('pointerleave', onLeave);
        });
      });
    };

    const updateScroll = () => {
      scrollRaf = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / max));
      const compactThreshold = Math.min(220, window.innerHeight * 0.24);
      root.style.setProperty('--mkt-scroll', progress.toFixed(4));
      root.style.setProperty('--mkt-scroll-pct', `${(progress * 100).toFixed(2)}%`);
      root.style.setProperty('--mkt-scroll-y', `${window.scrollY.toFixed(0)}px`);
      root.style.setProperty('--mkt-morph-progress', `${Math.round(progress * 100)}`);
      root.classList.toggle('marketing-scrolled', window.scrollY > compactThreshold);
    };

    const requestScrollUpdate = () => {
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(updateScroll);
    };

    const onPointerMove = (event) => {
      latestPointer = {
        x: (event.clientX / Math.max(1, window.innerWidth)) * 100,
        y: (event.clientY / Math.max(1, window.innerHeight)) * 100,
      };
      if (pointerRaf) return;
      pointerRaf = window.requestAnimationFrame(() => {
        pointerRaf = 0;
        root.style.setProperty('--mkt-pointer-x', `${latestPointer.x.toFixed(2)}%`);
        root.style.setProperty('--mkt-pointer-y', `${latestPointer.y.toFixed(2)}%`);
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

    const applyMotion = () => {
      attachReveal();
      attachTilt();
    };

    const mutationObserver = new MutationObserver(() => window.requestAnimationFrame(applyMotion));
    const main = document.querySelector('main');
    if (main) mutationObserver.observe(main, { childList: true, subtree: true });

    applyMotion();
    updateScroll();
    window.addEventListener('scroll', requestScrollUpdate, { passive: true });
    window.addEventListener('resize', requestScrollUpdate, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('click', onAnchorClick);
    window.addEventListener(FEATURE_MODE_EVENT, applyMotion);

    return () => {
      observer?.disconnect();
      mutationObserver.disconnect();
      tiltCleanups.forEach((cleanup) => cleanup());
      window.removeEventListener('scroll', requestScrollUpdate);
      window.removeEventListener('resize', requestScrollUpdate);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('click', onAnchorClick);
      window.removeEventListener(FEATURE_MODE_EVENT, applyMotion);
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
      if (pointerRaf) window.cancelAnimationFrame(pointerRaf);
      root.classList.remove('marketing-scrolled');
    };
  }, []);
}

function MarketingMotionLayer() {
  const [pathIndex, setPathIndex] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return undefined;

    let raf = 0;
    const updateFromScroll = () => {
      raf = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / max));
      setPathIndex(Math.min(MARKETING_MORPH_PATHS.length - 1, Math.floor(progress * MARKETING_MORPH_PATHS.length)));
    };
    const requestUpdate = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateFromScroll);
    };
    const timer = window.setInterval(() => {
      setPathIndex((current) => (current + 1) % MARKETING_MORPH_PATHS.length);
    }, 3600);

    updateFromScroll();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', requestUpdate);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="mkt-motion-layer" aria-hidden="true">
      <div className="mkt-scroll-progress" />
      <div className="mkt-cursor-glow" />
      <svg className="mkt-morph-blob" viewBox="0 0 120 100" focusable="false">
        <path d={MARKETING_MORPH_PATHS[pathIndex]} />
        <circle cx="52" cy="48" r="4" />
        <circle cx="74" cy="48" r="4" />
      </svg>
    </div>
  );
}

function MarketingHeader() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const navItems = [
    ['/', 'Home'],
    ['/features', 'Features'],
    ['/download', 'Download'],
    ['/story', 'Story'],
  ];

  return (
    <nav>
      <Brand />
      <div className="desktop-nav">
        {navItems.map(([path, label]) => (
          <Link key={path} to={path} className={location.pathname === path ? 'active' : ''}>{label}</Link>
        ))}
        {user ? <a href="/chat">Chat</a> : <Link to="/login">Login</Link>}
        {!user && <Link to="/login" className="nav-cta">Sign Up</Link>}
      </div>
      <button
        type="button"
        id="mobile-menu-btn"
        className="mobile-only nav-btn"
        aria-expanded={menuOpen}
        aria-controls="mobile-nav-links"
        onClick={() => setMenuOpen((open) => !open)}
      >
        MENU
      </button>
      <div id="mobile-nav-links" className={`mobile-only ${menuOpen ? '' : 'hidden'}`}>
        {navItems.map(([path, label]) => <Link key={path} to={path} className="mobile-link" onClick={() => setMenuOpen(false)}>{label.toUpperCase()}</Link>)}
        {user ? <a href="/chat" className="mobile-link">CHAT</a> : <Link to="/login" className="mobile-link">LOGIN</Link>}
      </div>
    </nav>
  );
}

function MarketingFooter() {
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-US', { hour12: true, timeZoneName: 'short' }));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <footer className="marketing-footer">
      <div className="footer-shell">
        <div className="footer-brand">
          <Link to="/" className="footer-logo" aria-label="Minimalist home">
            <div className="mascot-blip footer-blip"><div className="blip-eye left" /><div className="blip-eye right" /></div>
            <span>MINIMALIST</span>
          </Link>
          <p>Calm rooms for friends, teams, students, creators, clubs, and communities.</p>
          <a className="footer-primary-link" href="/chat">Create your first room <i className="ph-bold ph-arrow-right" /></a>
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
        <span>SYSTEM TIME: {clock || 'LOADING...'}</span>
      </div>
    </footer>
  );
}

const DEFAULT_META_DESCRIPTION = 'Minimalist.chat is a calmer rooms platform for friends, teams, students, creators, clubs, and communities — organized chat without the noise.';
const DEFAULT_META_TITLE = 'Minimalist.chat | Calm rooms for real communities';

function upsertMeta(selector, createAttrs, valueAttr, value) {
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    Object.entries(createAttrs).forEach(([key, attrValue]) => tag.setAttribute(key, attrValue));
    document.head.appendChild(tag);
  }
  tag.setAttribute(valueAttr, value);
}

function applyPageMeta({ title, description = DEFAULT_META_DESCRIPTION }) {
  document.title = title || DEFAULT_META_TITLE;
  upsertMeta('meta[name="description"]', { name: 'description' }, 'content', description);
  upsertMeta('meta[property="og:title"]', { property: 'og:title' }, 'content', title || DEFAULT_META_TITLE);
  upsertMeta('meta[property="og:description"]', { property: 'og:description' }, 'content', description);
  upsertMeta('meta[property="og:type"]', { property: 'og:type' }, 'content', 'website');
  upsertMeta('meta[property="og:url"]', { property: 'og:url' }, 'content', window.location.href);
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, 'content', 'Minimalist.chat');
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'content', 'summary');
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, 'content', title || DEFAULT_META_TITLE);
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, 'content', description);
}

function MarketingShell({ title, children, shape = 'yellow-circle', description = DEFAULT_META_DESCRIPTION }) {
  useMarketingMotion();

  useEffect(() => {
    const oldTitle = document.title;
    const oldClass = document.body.className;
    const oldStyle = document.body.getAttribute('style');
    const previousDescription = document.querySelector('meta[name="description"]')?.getAttribute('content');
    applyPageMeta({ title, description });
    document.body.className = 'marketing marketing-scroll';
    document.body.removeAttribute('style');
    return () => {
      document.title = oldTitle;
      if (previousDescription) document.querySelector('meta[name="description"]')?.setAttribute('content', previousDescription);
      document.body.className = oldClass;
      if (oldStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', oldStyle);
    };
  }, [title, description]);

  return (
    <>
      <MarketingMotionLayer />
      <div className={`shape ${shape}`} />
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </>
  );
}

function Toast({ message, onClose, icon = '📦' }) {
  return (
    <div id="brutalist-toast" className={message ? '' : 'toast-hidden'} role="status" aria-live="polite">
      <span id="toast-icon">{icon}</span>
      <span id="toast-message">{message}</span>
      <button type="button" id="toast-close" aria-label="Close notification" onClick={onClose}>✖</button>
    </div>
  );
}

const homepageUseCases = [
  ['Friend groups', 'ph-smiley', 'Plans, photos, and daily check-ins in one calm place — not five scattered threads.'],
  ['Study groups', 'ph-graduation-cap', 'Share notes, schedule sessions, pin resources, and keep discussions organized.'],
  ['Creator communities', 'ph-broadcast', 'Give fans a close, organized home with channels, events, and easy moderation.'],
  ['Startup teams', 'ph-rocket-launch', 'Chat, docs, tasks, and decisions together — without drowning in noise.'],
  ['Gaming communities', 'ph-game-controller', 'Squad up with channels, calls, clips, events, and room lore.'],
  ['Clubs', 'ph-users-three', 'Keep announcements, events, files, and votes tidy for every member.'],
  ['Support groups', 'ph-heart', 'A private, gentle space with reporting, permissions, and care built in.'],
];

const demoRooms = [
  {
    name: 'Study Room',
    icon: 'ph-graduation-cap',
    members: '24 members',
    mood: 'quiet focus',
    lines: ['Pinned: finals checklist', 'Mina shared biology notes', 'AI summary ready for chapter 8'],
  },
  {
    name: 'Creator Community',
    icon: 'ph-broadcast',
    members: '1.2k members',
    mood: 'organized buzz',
    lines: ['Poll: next stream topic?', 'Best Of Archive updated', 'Room Prestige: rising'],
  },
  {
    name: 'Project Team',
    icon: 'ph-kanban',
    members: '8 members',
    mood: 'clear momentum',
    lines: ['Decision captured: ship beta Friday', 'Reminder set for design review', 'Docs: roadmap edited live'],
  },
];

const guidedRoomSeed = [
  { from: 'Maya', text: 'I added the notes to the pinboard.' },
  { from: 'Alex', text: 'Meeting at 7?' },
  { from: 'Jordan', text: 'Can someone make a checklist?' },
];

const guidedSteps = [
  { key: 'send', label: 'Send a message', icon: 'ph-paper-plane-tilt' },
  { key: 'pin', label: 'Pin it', icon: 'ph-push-pin' },
  { key: 'task', label: 'Make it a task', icon: 'ph-check-square' },
  { key: 'memory', label: 'Save to memory', icon: 'ph-brain' },
];

const simpleFeatures = [
  'Rooms',
  'Messages',
  'Files',
  'Search',
  'Settings',
];

const powerFeatures = [
  'Tasks',
  'Polls',
  'Events',
  'Wiki',
  'Analytics',
  'Moderation',
  'Integrations',
  'Room Memory',
  'Time Capsules',
  'Best Of Archive',
];

const FEATURE_MODE_KEY = 'minimalistMarketingMode';
const FEATURE_MODE_EVENT = 'minimalist:marketing-mode';

const featureModeMeta = {
  simple: {
    label: 'Simple Mode',
    shortLabel: 'Simple',
    helper: '5 essentials',
    title: 'Simple Mode keeps the site quiet.',
    copy: 'Visitors see the core room experience first: rooms, messages, files, search, and settings. No wall of tools before they understand the feeling.',
    list: simpleFeatures,
  },
  power: {
    label: 'Power Mode',
    shortLabel: 'Power',
    helper: 'full platform',
    title: 'Power Mode opens the full platform.',
    copy: 'When people want depth, the page reveals tasks, polls, events, wiki, analytics, moderation, integrations, room memory, time capsules, and archives.',
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

function FeatureModeSwitch({ mode, onChange, className = '' }) {
  return (
    <div className={className} role="tablist" aria-label="Feature mode">
      {Object.entries(featureModeMeta).map(([key, meta]) => (
        <button
          type="button"
          className={mode === key ? 'active' : ''}
          aria-label={`${meta.label}: ${meta.helper}`}
          aria-selected={mode === key}
          role="tab"
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

const trustItems = [
  ['Privacy controls', 'ph-lock-key', 'Private rooms, encrypted PM mode, and clear invite boundaries.'],
  ['Moderation', 'ph-shield-check', 'Reporting, mutes, room permissions, audit logs, and safety controls.'],
  ['Account security', 'ph-fingerprint', '2FA-ready account flows, secure auth, and a visible security center path.'],
  ['Transparency', 'ph-clipboard-text', 'Audit logs and member controls help communities understand what changed.'],
];

const pricingCards = [
  ['Base', '$0', 'For starting a small room', ['10MB per file', '500MB daily uploads', 'Create up to 3 rooms', '720p/30 screen share']],
  ['Advanced', '$1.99/mo', 'For active groups', ['700MB per file', '1.5GB daily uploads', 'Create up to 5 rooms', '1080p/60 screen share', 'Advanced badge']],
  ['Pro', '$3.99/mo', 'For growing communities', ['3GB per file', '9GB daily uploads', 'Unlimited rooms', 'Analytics + video calls', 'Personal AI agent']],
];

const homeFaq = [
  ['Is it free?', 'Yes. Base is free, with optional Advanced and Pro upgrades for bigger uploads, more rooms, analytics, calls, and AI.'],
  ['Can I create private rooms?', 'Yes. Rooms can be private and invite-based, with permissions for who can chat, upload, call, create channels, and manage settings.'],
  ['Can I invite people?', 'Yes. Share a join link, invite by room code, or forward an invite through private messages.'],
  ['Is my data private?', 'Minimalist.chat is built around private spaces, reporting, account deletion, secure auth, and moderation tools.'],
  ['Can I use it for teams?', 'Yes. Teams can use rooms, channels, docs, tasks, events, files, calls, analytics, and audit logs.'],
];

const homeStoryChapters = [
  {
    eyebrow: '01 · Calm first',
    title: 'The room opens simple.',
    copy: 'People see the conversation, files, search, and settings first. The page moves like the app: clean, readable, and intentionally quiet.',
    metric: '5 essentials',
    chips: ['Rooms', 'Messages', 'Files', 'Search', 'Settings'],
  },
  {
    eyebrow: '02 · Power appears',
    title: 'Tools reveal only when the room needs them.',
    copy: 'Tasks, polls, docs, events, analytics, moderation, integrations, room memory, and time capsules stay tucked away until the group grows.',
    metric: '10+ power tools',
    chips: ['Tasks', 'Polls', 'Events', 'Wiki', 'AI', 'Moderation'],
  },
  {
    eyebrow: '03 · Memory builds',
    title: 'The room becomes a place.',
    copy: 'Best Of Archive, Room Lore, milestones, prestige, celebrations, and community legacy make the room feel alive without adding clutter.',
    metric: 'living history',
    chips: ['Room Memory', 'Best Of', 'Lore', 'Milestones'],
  },
];

function InteractiveChatPreview() {
  const idRef = useRef(0);
  const windowRef = useRef(null);
  const [messages, setMessages] = useState(() => guidedRoomSeed.map((m, i) => ({ id: `seed-${i}`, ...m })));
  const [draft, setDraft] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [memorySaved, setMemorySaved] = useState(false);
  const [done, setDone] = useState({ send: false, pin: false, task: false, memory: false });
  const [notice, setNotice] = useState('Try it live — send a message, then act on it.');

  const activeMessage = messages.find((m) => m.id === activeId) || null;
  const allDone = done.send && done.pin && done.task && done.memory;
  const currentStep = guidedSteps.find((s) => !done[s.key])?.key;

  useEffect(() => {
    if (windowRef.current) windowRef.current.scrollTop = windowRef.current.scrollHeight;
  }, [messages, tasks, memorySaved, pinned]);

  const sendMessage = (event) => {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    const id = `you-${idRef.current++}`;
    setMessages((cur) => [...cur, { id, from: 'You', text: clean, self: true }].slice(-7));
    setActiveId(id);
    setDraft('');
    setDone((d) => ({ ...d, send: true }));
    setNotice('Nice — now pin it, make it a task, or save it to memory.');
  };

  const withActive = (run) => () => {
    if (!activeMessage) {
      setNotice('Send a message first — then the room tools light up.');
      return;
    }
    run(activeMessage);
  };

  const actions = [
    { key: 'pin', label: 'Pin', icon: 'ph-push-pin', run: withActive((m) => {
      setPinned(m.text);
      setDone((d) => ({ ...d, pin: true }));
      setNotice('Pinned to the room — everyone sees it up top.');
    }) },
    { key: 'task', label: 'Task', icon: 'ph-check-square', run: withActive((m) => {
      setTasks((cur) => [...cur.filter((t) => t.text !== m.text), { id: m.id, text: m.text }].slice(-3));
      setDone((d) => ({ ...d, task: true }));
      setNotice('Turned into a task on the room board.');
    }) },
    { key: 'memory', label: 'Memory', icon: 'ph-brain', run: withActive((m) => {
      setMemorySaved(true);
      setDone((d) => ({ ...d, memory: true }));
      setNotice('Saved to Room Memory — the room will remember this.');
    }) },
    { key: 'poll', label: 'Poll', icon: 'ph-chart-bar', run: () => setNotice('Poll drafted: “When should we meet?”') },
    { key: 'invite', label: 'Invite', icon: 'ph-user-plus', run: () => setNotice('Invite link copied for the room.') },
  ];

  return (
    <div className="idemo-card" id="home-live-demo" aria-label="Interactive room demo">
      <span className="idemo-glow" aria-hidden="true" />
      <div className="idemo-top">
        <div className="idemo-room">
          <span className="idemo-live-dot" aria-hidden="true" />
          <strong>Study Room</strong>
          <span className="idemo-room-meta">24 online</span>
        </div>
        <span className="idemo-live"><i className="ph-bold ph-broadcast" /> Live demo</span>
      </div>

      <ol className="idemo-steps" aria-label="Demo walkthrough">
        {guidedSteps.map((step) => (
          <li key={step.key} className={done[step.key] ? 'done' : (step.key === currentStep ? 'current' : '')}>
            <span className="idemo-step-ico"><i className={`ph-bold ${done[step.key] ? 'ph-check' : step.icon}`} /></span>
            <em>{step.label}</em>
          </li>
        ))}
      </ol>

      {pinned ? (
        <div className="idemo-pinned" role="status">
          <i className="ph-bold ph-push-pin" />
          <span>{pinned}</span>
          <small>Pinned</small>
        </div>
      ) : null}

      <div className="idemo-window" ref={windowRef}>
        {messages.map((m) => (
          <div className={`idemo-msg ${m.self ? 'self' : ''} ${m.id === activeId ? 'active' : ''}`} key={m.id}>
            <span className="idemo-from">{m.from}</span>
            <p>{m.text}</p>
          </div>
        ))}
        {tasks.length ? (
          <div className="idemo-tasks" aria-label="Tasks created">
            {tasks.map((t) => (
              <div className="idemo-task" key={t.id}>
                <i className="ph-bold ph-check-square" />
                <span>{t.text}</span>
                <small>Task</small>
              </div>
            ))}
          </div>
        ) : null}
        {memorySaved ? (
          <div className="idemo-memory" role="status">
            <i className="ph-bold ph-brain" />
            <span>Saved to Room Memory</span>
          </div>
        ) : null}
      </div>

      <div className={`idemo-actions ${activeMessage ? '' : 'idle'}`} aria-label="Room tools">
        {actions.map((a) => (
          <button type="button" key={a.key} className={`idemo-act ${done[a.key] ? 'done' : ''}`} onClick={a.run}>
            <i className={`ph-bold ${a.icon}`} /> {a.label}
          </button>
        ))}
      </div>

      <form className="idemo-form" onSubmit={sendMessage}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message…" aria-label="Type a demo message" />
        <button type="submit" aria-label="Send"><i className="ph-bold ph-paper-plane-tilt" /></button>
      </form>

      <p className={`idemo-note ${allDone ? 'win' : ''}`}>
        {allDone ? '🎉 That’s a whole room running itself — ready to make yours?' : notice}
      </p>
      {allDone ? <a href="/chat" className="lp-btn lp-btn-primary idemo-cta">Create your first room <i className="ph-bold ph-arrow-right" /></a> : null}
    </div>
  );
}

function ModeToggleSection() {
  const [mode, setMode] = useMarketingFeatureMode();
  const activeMode = featureModeMeta[mode];

  return (
    <section className="home-section home-mode-section">
      <div className="home-section-head">
        <span className="home-kicker">Minimalist when you want it</span>
        <h2>Clean by default. Powerful when the room grows.</h2>
      </div>
      <div className="home-mode-card">
        <FeatureModeSwitch mode={mode} onChange={setMode} className="home-mode-toggle" />
        <div className="home-mode-copy">
          <h3>{activeMode.title}</h3>
          <p>{activeMode.copy}</p>
          <ul>
            {activeMode.list.map((feature) => <li key={feature}><i className="ph-bold ph-check" /> {feature}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) window.location.replace('/chat');
  }, []);

  return (
    <MarketingShell
      title={DEFAULT_META_TITLE}
      description={DEFAULT_META_DESCRIPTION}
    >
      <main className="container fade-in-up home-page home-cinematic-page">
        <section className="lp-hero home-cinematic-hero">
          <div className="lp-hero-text home-cinematic-copy">
            <span className="home-kicker">Rooms without the noise</span>
            <h1>One calm room can hold a whole community.</h1>
            <p className="fade-in-up delay-1">Minimalist.chat turns group chat into a shared room for messages, files, events, decisions, and memory — without making the first screen feel like a cockpit.</p>
            <div className="lp-cta fade-in-up delay-2">
              <a href="/chat" className="lp-btn lp-btn-primary">Create your first room <i className="ph-bold ph-arrow-right" /></a>
              <a href="#home-live-demo" className="lp-btn lp-btn-secondary">Try demo room</a>
            </div>
            <div className="home-proof-row" aria-label="Platform highlights">
              <span>Simple by default</span>
              <span>Power on demand</span>
              <span>Private or public</span>
              <span>Built-in memory</span>
            </div>
          </div>
          <div className="home-cinematic-preview">
            <InteractiveChatPreview />
          </div>
        </section>

        <section className="home-section home-scroll-story" id="room-story">
          <div className="home-story-copy">
            <span className="home-kicker">Compact scroll story</span>
            <h2>The homepage now behaves like the product.</h2>
            <p>Instead of listing every feature, the page shows the feeling: a room starts quiet, then unlocks depth as people actually need it.</p>
          </div>
          <div className="home-story-panels">
            {homeStoryChapters.map((chapter) => (
              <article className="home-cinema-card" key={chapter.title}>
                <div>
                  <span className="home-chapter-index">{chapter.eyebrow}</span>
                  <h3>{chapter.title}</h3>
                  <p>{chapter.copy}</p>
                </div>
                <strong>{chapter.metric}</strong>
                <div className="home-cinema-chips">
                  {chapter.chips.map((chip) => <span key={chip}>{chip}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>

        <ModeToggleSection />

        <section className="home-section home-compact-showcase" id="demo-rooms">
          <div className="home-section-head">
            <span className="home-kicker">Who it is for</span>
            <h2>A calmer room for every kind of group.</h2>
          </div>
          <div className="home-compact-rail" aria-label="Use cases">
            {homepageUseCases.map(([label, icon, copy]) => (
              <article className="home-use-card" key={label}>
                <i className={`ph-bold ${icon}`} />
                <h3>{label}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
          <div className="home-room-strip" aria-label="Demo room examples">
            {demoRooms.map((room) => (
              <article className="home-demo-card" key={room.name}>
                <div className="home-demo-icon"><i className={`ph-bold ${room.icon}`} /></div>
                <h3>{room.name}</h3>
                <p>{room.members} · {room.mood}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-section home-compact-proof">
          <div className="home-proof-panel">
            <span className="home-kicker">Trust</span>
            <h2>Freedom, with control.</h2>
            <div className="home-trust-mini-grid">
              {trustItems.map(([label, icon, copy]) => (
                <article className="home-trust-card" key={label}>
                  <i className={`ph-bold ${icon}`} />
                  <div>
                    <h3>{label}</h3>
                    <p>{copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="home-proof-panel">
            <span className="home-kicker">Pricing</span>
            <h2>Upgrade only when the room needs more.</h2>
            <div className="home-price-compact-grid">
              {pricingCards.map(([name, price, intent, features]) => (
                <article className={`home-price-card ${name === 'Pro' ? 'featured' : ''}`} key={name}>
                  <span>{intent}</span>
                  <h3>{name}</h3>
                  <strong>{price}</strong>
                  <p>{features.slice(0, 3).join(' · ')}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-final-cta">
          <h2>Create a room. Invite your people. Let it grow only as much as it needs to.</h2>
          <a href="/chat" className="lp-btn lp-btn-primary">Create your first room <i className="ph-bold ph-arrow-right" /></a>
          <div className="home-faq-pills" aria-label="Quick FAQ">
            {homeFaq.slice(0, 4).map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}

const simpleFeatureCards = [
  ['Rooms', 'ph-hash', 'Create a shared place for a group, project, class, club, or community.'],
  ['Messages', 'ph-chat-circle-text', 'Real-time conversation stays readable, direct, and calm.'],
  ['Files', 'ph-paperclip', 'Share images, docs, notes, and resources without hunting through the chat later.'],
  ['Search', 'ph-magnifying-glass', 'Find rooms, messages, files, people, and resources from one obvious place.'],
  ['Settings', 'ph-sliders-horizontal', 'Control your profile, room preferences, appearance, and notifications.'],
];

const powerFeatureCards = [
  ['Tasks', 'ph-check-square', 'Turn conversations into shared action items and keep work moving.'],
  ['Polls', 'ph-chart-bar', 'Make decisions together without derailing the room.'],
  ['Events', 'ph-calendar-dots', 'Plan room events, reminders, calendars, and deadlines.'],
  ['Wiki', 'ph-book-open-text', 'Keep room knowledge, notes, rules, and resources in a living hub.'],
  ['Analytics', 'ph-chart-line-up', 'Understand room health, activity, contribution, and momentum.'],
  ['Moderation', 'ph-shield-check', 'Use reports, permissions, audit logs, keyword controls, and safety tools.'],
  ['Integrations', 'ph-plugs-connected', 'Connect workflows through webhooks, channels, and external tools.'],
  ['Room Memory', 'ph-brain', 'Preserve important context so the room remembers what happened.'],
  ['Time Capsules', 'ph-hourglass-high', 'Lock memories, announcements, or moments for future reveal.'],
  ['Best Of Archive', 'ph-trophy', 'Collect the highlights, decisions, wins, and room lore that define a community.'],
];

const powerWorkspaceTools = [
  'Command palette',
  'Global search',
  'Keyboard shortcuts',
  'Workspace switching',
  'Multi-room view',
  'Focus mode',
  'Zen mode',
  'Compact mode',
  'Resizable layouts',
  'Pop-out windows',
];

function slugifyFeature(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function FeaturesPage() {
  const [mode, setMode] = useMarketingFeatureMode();
  const activeMode = featureModeMeta[mode];
  const cards = mode === 'simple' ? simpleFeatureCards : powerFeatureCards;

  return (
    <MarketingShell title="Minimalist | Features" shape="outline-square">
      <main className="container feat-page feature-mode-page" data-feature-mode={mode}>
        <div className="feat-hero">
          <span className="home-kicker">Simple when you want it. Powerful when you need it.</span>
          <h1>{mode === 'simple' ? 'A clean room, not a control panel.' : 'The full platform, when the room grows.'}</h1>
          <p>{activeMode.copy}</p>
          <div className="feat-orbit-map" aria-hidden="true">
            <span className="orbit-core">{mode === 'simple' ? 'Simple' : 'Power'}</span>
            <span>Rooms</span>
            <span>Docs</span>
            <span>Tasks</span>
            <span>AI</span>
          </div>
          <a href="/chat" className="lp-btn lp-btn-primary feat-start">Create your first room <i className="ph-bold ph-arrow-right" /></a>
        </div>

        <section className="feat-mode-panel" aria-label="Feature mode selector">
          <div>
            <span className="home-kicker">Current site mode</span>
            <h2>{activeMode.title}</h2>
            <p>{mode === 'simple'
              ? 'The page intentionally stays small: the five things most groups need to understand before joining.'
              : 'The page expands into the deeper room system from the product vision, without burying the simple promise.'}
            </p>
          </div>
          <FeatureModeSwitch mode={mode} onChange={setMode} className="feat-mode-switch" />
        </section>

        <div className="feat-nav">
          {cards.map(([name]) => <a key={name} href={`#feature-${slugifyFeature(name)}`} className="feat-nav-chip">{name}</a>)}
        </div>

        <section className="feat-cat" aria-label={`${activeMode.label} feature list`}>
          <h2 className="feat-cat-title">
            <i className={`ph-bold ${mode === 'simple' ? 'ph-leaf' : 'ph-lightning'}`} /> {activeMode.label}
          </h2>
          <div className="feat-grid">
            {cards.map(([label, itemIcon, description]) => (
              <div className="feat-card" id={`feature-${slugifyFeature(label)}`} key={label}>
                <div className="feat-ico"><i className={`ph-bold ${itemIcon}`} /></div>
                <h3>{label}</h3>
                <p>{description}</p>
              </div>
            ))}
          </div>
        </section>

        {mode === 'power' && (
          <section className="feat-power-tools">
            <span className="home-kicker">Power-user workspace</span>
            <h2>Built for people who live in rooms all day.</h2>
            <p>Power Mode also makes room for the pro workflow tools already in the platform vision.</p>
            <div className="feat-chip-grid">
              {powerWorkspaceTools.map((tool) => <span key={tool}>{tool}</span>)}
            </div>
          </section>
        )}

        <div className="feat-cta"><h2>Ready to dive in?</h2><div className="lp-cta centered"><a href="/chat" className="lp-btn lp-btn-primary">Create your first room <i className="ph-bold ph-arrow-right" /></a><Link to="/download" className="lp-btn lp-btn-secondary"><i className="ph-bold ph-download-simple" /> Download</Link></div></div>
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
  const detectedLabel = downloads.find((item) => item.id === platform)?.name;
  const recommendedId = platform || 'web';

  const comingSoon = (label) => {
    setToast(`${label} is coming soon. Use the web app for now.`);
    window.setTimeout(() => setToast(''), 3500);
  };

  return (
    <MarketingShell title="Minimalist | Download" shape="outline-square">
      <main className="container dl-page">
        <section className="dl-hero">
          <div className="dl-hero-copy">
            <span className="home-kicker">Download Minimalist</span>
            <h1>Use your rooms <span>anywhere.</span></h1>
            <p>Minimalist is ready in the browser today. Native apps are on the roadmap, but the web app already gives you the clean room workspace without waiting.</p>
            <div className="lp-cta">
              <a href="/chat" className="lp-btn lp-btn-primary">Open Web App <i className="ph-bold ph-arrow-right" /></a>
              <a href="#platforms" className="lp-btn lp-btn-secondary"><i className="ph-bold ph-devices" /> View Platforms</a>
            </div>
            {detectedLabel && <p className="dl-detected">Detected: {detectedLabel}. The matching platform card is highlighted below.</p>}
          </div>
          <aside className="dl-device-card" aria-label="Download status">
            <div className="dl-device-top">
              <span>Current best option</span>
              <strong>Web App</strong>
            </div>
            <div className="dl-device-screen">
              <div className="dl-window-bar"><span /><span /><span /></div>
              <div className="dl-sync-orbit" aria-hidden="true"><span /><span /><span /></div>
              <div className="dl-mini-room active"><i className="ph-bold ph-chat-circle" /> Global Chat</div>
              <div className="dl-mini-room"><i className="ph-bold ph-file-text" /> Docs</div>
              <div className="dl-mini-room"><i className="ph-bold ph-lock-key" /> Vault</div>
            </div>
            <p>No installer needed. Sign in and keep moving.</p>
          </aside>
        </section>

        <section className="dl-highlights" aria-label="Download benefits">
          {downloadHighlights.map(([icon, title, text]) => (
            <div className="dl-highlight" key={title}>
              <i className={`ph-bold ${icon}`} />
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
          ))}
        </section>

        <div className="dl-grid">
          {downloads.map((item) => (
            <article className={`dl-card ${item.id === recommendedId ? 'recommended' : ''}`} id={item.id === 'web' ? 'platforms' : undefined} key={item.id}>
              {item.id === recommendedId && <div className="dl-badge">Recommended</div>}
              <div className="dl-card-head">
                <div className="dl-card-icon"><i className={`ph-bold ${item.icon}`} /></div>
                <span>{item.status}</span>
              </div>
              <h2>{item.name}</h2>
              <p className="dl-meta">{item.meta}</p>
              {item.href ? (
                <a className="dl-btn" href={item.href}>{item.cta}</a>
              ) : (
                <button type="button" className="dl-btn dl-btn-ghost" onClick={() => comingSoon(item.name)}>{item.cta}</button>
              )}
              <ul className="dl-reqs">{item.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
            </article>
          ))}
        </div>

        <div className="dl-section">
          <h2 className="dl-section-title">Use it like an app</h2>
          <div className="dl-install">
            {installSteps.map(([label, text], index) => <div className="dl-step" key={label}><span className="dl-step-n">{index + 1}</span><div><strong>{label}</strong><p>{text}</p></div></div>)}
          </div>
        </div>

        <div className="dl-section">
          <h2 className="dl-section-title">Download FAQ</h2>
          <div className="dl-faq">
            {downloadFaqs.map(([question, answer]) => <div className="dl-faq-item" key={question}><h3>{question}</h3><p>{answer}</p></div>)}
          </div>
        </div>
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
  return (
    <MarketingShell title="Minimalist | Story" shape="yellow-square">
      <main className="container fade-in-up story-page">
        <section className="story-hero">
          <span className="home-kicker">The story</span>
          <h1>We are building chat that gives your group room to breathe.</h1>
          <p>The modern web is crowded. Minimalist is our answer: a calmer rooms platform where conversation, memory, files, events, and decisions can live together without turning into noise.</p>
          <div className="story-breathe-map" aria-hidden="true">
            <span>Noise</span>
            <i />
            <strong>Room</strong>
            <i />
            <span>Memory</span>
          </div>
        </section>

        <section className="story-manifesto">
          <div>
            <span className="story-label">Manifesto</span>
            <h2>Just enough.</h2>
          </div>
          <p><strong>Not more. Not less.</strong> Like framing the perfect shot, we strip away the unnecessary background until the essential focus remains: the connection between people.</p>
          <p>Whether you are across the street or across the world, your words take center stage here. No algorithms. No clutter. Just rooms that can become places.</p>
        </section>

        <section className="story-grid" aria-label="Design principles">
          {storyPrinciples.map(([title, copy]) => (
            <article className="story-card" key={title}>
              <span>{title}</span>
              <p>{copy}</p>
            </article>
          ))}
        </section>

        <section className="story-timeline" aria-label="How Minimalist grows with a room">
          {storyTimeline.map(([number, title, copy]) => (
            <article key={number}>
              <strong>{number}</strong>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </section>
      </main>
    </MarketingShell>
  );
}

const faqItems = [
  ['What is Minimalist Chat?', 'Minimalist Chat is a real-time messaging app built around rooms. Every room combines conversation, collaborative documents, a shared whiteboard, tasks, events, and AI tools.'],
  ['How do I create or join a room?', 'Open the room sidebar and use Create to start a room, or Join to enter with an invite link or code.'],
  ['What are Docs and the Whiteboard?', 'Collaborative Docs update live for everyone, while the Shared Whiteboard provides draggable sticky notes for brainstorming.'],
  ['What do the Advanced and Pro tiers include?', 'Base includes 10MB files, 500MB/day, custom accent themes, up to 3 created rooms, and 720p/30fps screen sharing. Advanced raises that to 700MB files, 1.5GB/day, 5 created rooms, 1080p/60fps screen sharing, and an Advanced badge. Pro raises it to 3GB files, 9GB/day, unlimited rooms, room analytics, video calls, system-limit screen sharing, offline viewing, a personal AI agent, and a Pro badge.'],
  ['How do I add friends and send private messages?', 'Open Contacts to search people, send requests, and start private conversations.'],
  ['Is my data private?', 'Account and message data are handled according to the Privacy Policy. You can delete your account from Settings.'],
];

function InfoPage({ title, eyebrow, children }) {
  const [firstWord, ...rest] = title.split(' ');
  const restTitle = rest.join(' ');

  return (
    <MarketingShell title={`Minimalist | ${title}`}>
      <main className="container fade-in-up info-page">
        <section className="info-hero">
          <span className="home-kicker">{eyebrow}</span>
          <h1>{firstWord} {restTitle && <span>{restTitle}</span>}</h1>
          <p>Clear, plain-language details for using Minimalist with confidence.</p>
        </section>
        <div className="info-layout">
          <aside className="info-sidebar" aria-label={`${title} summary`}>
            <span>Minimalist</span>
            <strong>{title}</strong>
            <p>{eyebrow}</p>
          </aside>
          <div className="info-stack">{children}</div>
        </div>
      </main>
    </MarketingShell>
  );
}

export function FaqPage() {
  return <InfoPage title="Frequently Asked Questions" eyebrow="Everything you need to know">{faqItems.map(([question, answer]) => <section className="info-section" key={question}><h2>{question}</h2><p>{answer}</p></section>)}<section className="info-section"><h2>Still need help?</h2><p>Email <a href="mailto:support@minimalist.com">support@minimalist.com</a> or file a <a href="https://github.com/Hao14/minimalist-chat/issues" target="_blank" rel="noopener noreferrer">bug report</a>.</p></section></InfoPage>;
}

export function PrivacyPage() {
  return <InfoPage title="Privacy Policy" eyebrow="Last Updated: June 2026"><section className="info-section"><h2>1. Information We Collect</h2><p>We collect the information needed to provide the service:</p><ul><li><strong>Account Data:</strong> Email address, display name, profile details, and authentication identifiers.</li><li><strong>Chat Data:</strong> Messages, uploaded files, reactions, room content, and collaboration data.</li><li><strong>Billing Data:</strong> Subscription status and Stripe customer identifiers. We do not store raw payment-card numbers.</li></ul></section><section className="info-section"><h2>2. Third-Party Services</h2><ul><li><strong>Google Firebase:</strong> Authentication, real-time data, functions, and file storage.</li><li><strong>Stripe:</strong> Secure subscription payment processing.</li></ul></section><section className="info-section"><h2>3. Your Right to Deletion</h2><p>You can permanently delete your account from Settings. This removes your profile and authentication record.</p></section></InfoPage>;
}

export function TermsPage() {
  return <InfoPage title="Terms of Service" eyebrow="Last Updated: June 2026"><section className="info-section"><h2>1. Acceptance of Terms</h2><p>By accessing Minimalist Chat, you agree to these terms. If you do not agree, do not use the service.</p></section><section className="info-section"><h2>2. User Conduct & Content</h2><p>You are responsible for content you transmit and agree not to:</p><ul><li>Upload or share illegal, harmful, or abusive content.</li><li>Impersonate another person or entity.</li><li>Bypass billing, authentication, or security controls.</li></ul></section><section className="info-section"><h2>3. Subscriptions & Refunds</h2><p>Paid features are billed through Stripe. Subscriptions renew until cancelled and can be managed through the billing portal.</p></section></InfoPage>;
}

export function NotFoundPage() {
  return <MarketingShell title="Minimalist | Not Found"><main className="container not-found-page"><div className="not-found-code">404</div><h1>Page <span>Not Found.</span></h1><p>That page wandered off. Let’s get you back somewhere useful.</p><Link to="/" className="lp-btn lp-btn-primary">Return Home</Link></main></MarketingShell>;
}
