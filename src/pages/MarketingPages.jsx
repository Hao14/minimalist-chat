import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase.js';

function Brand() {
  return (
    <Link to="/" id="nav-logo" aria-label="Minimalist home">
      <div className="mascot-blip"><div className="blip-eye left" /><div className="blip-eye right" /></div>
      <span className="logo-text">MINIMALIST</span>
    </Link>
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
    <footer>
      <div className="footer-links">
        <Link to="/faq">FAQ</Link>
        <Link to="/terms">Terms of Service</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <a href="mailto:support@minimalist.com">Contact</a>
        <a href="https://github.com/Hao14/minimalist-chat/issues" target="_blank" rel="noopener noreferrer">Bug Report</a>
      </div>
      <div className="footer-info">SYSTEM TIME: {clock || 'LOADING...'}</div>
    </footer>
  );
}

function MarketingShell({ title, children, shape = 'yellow-circle' }) {
  useEffect(() => {
    const oldTitle = document.title;
    const oldClass = document.body.className;
    const oldStyle = document.body.getAttribute('style');
    document.title = title;
    document.body.className = 'marketing';
    document.body.removeAttribute('style');
    return () => {
      document.title = oldTitle;
      document.body.className = oldClass;
      if (oldStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', oldStyle);
    };
  }, [title]);

  return (
    <>
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

export function HomePage() {
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) window.location.replace('/chat');
  }, []);

  return (
    <MarketingShell title="Minimalist | Chat">
      <main className="container fade-in-up lp-hero">
        <div className="lp-hero-text">
          <h1>Less is <span>More.</span></h1>
          <p className="fade-in-up delay-1">Welcome to a space unburdened by noise. Connect deeply, speak freely, and experience communication in its purest form.</p>
          <div className="lp-cta fade-in-up delay-2">
            <a href="/chat" className="lp-btn lp-btn-primary">Get Started <i className="ph-bold ph-arrow-right" /></a>
            <Link to="/download" className="lp-btn lp-btn-secondary"><i className="ph-bold ph-download-simple" /> Download</Link>
          </div>
        </div>
        <div className="lp-preview fade-in-up delay-2" aria-hidden="true">
          <div className="cp-card">
            <div className="cp-head">
              <div className="cp-ava">M</div>
              <div className="cp-meta"><span className="cp-name">Maya Chen</span><span className="cp-status"><span className="cp-dot" /> online</span></div>
              <div className="cp-actions"><i className="ph-bold ph-phone" /><i className="ph-bold ph-video-camera" /></div>
            </div>
            <div className="cp-body">
              <div className="cp-msg cp-in cp-a1">Hey! Did you see the new AI summaries? 🎉</div>
              <div className="cp-msg cp-out cp-a2">Yes — it recapped the whole thread instantly 🔥</div>
              <div className="cp-msg cp-in cp-a3">Hop on a quick call?<span className="cp-react">👍 3</span></div>
              <div className="cp-typing cp-a4"><span /><span /><span /></div>
            </div>
          </div>
        </div>
      </main>
    </MarketingShell>
  );
}

const featureGroups = [
  ['Messaging', 'ph-chats-circle', [
    ['Real-time chat', 'ph-chats-circle', 'Instant messages that sync live across every device.'],
    ['Encrypted private messages', 'ph-lock-key', 'Optional shared-passphrase encryption for direct messages.'],
    ['Threads', 'ph-tree-structure', 'Keep focused side-conversations without cluttering the room.'],
    ['Reactions', 'ph-smiley', 'React with any emoji — tap to add, tap to remove.'],
    ['File sharing', 'ph-paperclip', 'Share images and files inline like a team chat.'],
    ['GIF support', 'ph-gif', 'Drop in the perfect GIF for any moment.'],
    ['Emoji picker', 'ph-sticker', 'A rich, searchable picker with hundreds of emojis.'],
    ['Message editing', 'ph-pencil-simple', 'Fix a typo — edits update live for everyone.'],
    ['Message deletion', 'ph-trash', 'Remove a message you no longer want to share.'],
    ['Pins', 'ph-push-pin', 'Pin the messages that matter so they are easy to find.'],
    ['Bookmarks', 'ph-bookmark-simple', 'Save any message privately to revisit later.'],
  ]],
  ['Community', 'ph-users-three', [
    ['Public rooms', 'ph-globe', 'Open spaces anyone can discover and join.'],
    ['Private rooms', 'ph-lock', 'Invite-only spaces for your inner circle.'],
    ['Groups', 'ph-users-three', 'Organize people around shared interests.'],
    ['Channels', 'ph-hash', 'Dedicated channels keep topics tidy.'],
    ['Announcements', 'ph-megaphone', 'Broadcast important updates to everyone at once.'],
    ['Roles', 'ph-identification-badge', 'Assign roles and flair to recognize members.'],
    ['Permissions', 'ph-shield-check', 'Fine-grained control over who can do what.'],
  ]],
  ['AI', 'ph-sparkle', [
    ['AI Assistant', 'ph-sparkle', 'Ask anything about your room — grounded in real context.'],
    ['Personal AI Agent', 'ph-sparkle', 'Pro users get a private assistant with saved preferences.'],
    ['AI Summaries', 'ph-list-bullets', 'Catch up on long threads in seconds.'],
    ['Translation', 'ph-translate', 'Talk across languages without missing a beat.'],
    ['Smart Replies', 'ph-lightning', 'Quick, context-aware reply suggestions.'],
    ['Code Assistant', 'ph-code', 'Explain, format, and improve code in chat.'],
    ['Content Generation', 'ph-magic-wand', 'Draft messages, summaries, and posts instantly.'],
  ]],
  ['Collaboration', 'ph-video-camera', [
    ['Voice Calls', 'ph-phone', 'Crystal-clear voice with a tap.'],
    ['Video Calls', 'ph-video-camera', 'Face-to-face from any device.'],
    ['Screen Sharing', 'ph-monitor-arrow-up', 'Show your screen while you talk.'],
    ['Live Events', 'ph-broadcast', 'Host sessions for your whole community.'],
    ['Whiteboard', 'ph-palette', 'Brainstorm together on a shared canvas.'],
    ['Collaborative Notes', 'ph-note-pencil', 'Live documents everyone can edit at once.'],
  ]],
  ['Productivity', 'ph-check-square', [
    ['Tasks', 'ph-check-square', 'Shared to-dos to keep your group on track.'],
    ['Calendar', 'ph-calendar', 'A weekly calendar with Google sync.'],
    ['Reminders', 'ph-bell-ringing', 'Never miss a deadline or event.'],
    ['Polls', 'ph-chart-bar', 'Make decisions together, fast.'],
    ['Events', 'ph-calendar-dots', 'Plan and RSVP to room events.'],
    ['Bookmarks', 'ph-bookmark-simple', 'Keep your important messages one tap away.'],
  ]],
  ['Personalization', 'ph-paint-brush', [
    ['Themes', 'ph-paint-brush', 'Light, dark, and gray — your call.'],
    ['Custom Profiles', 'ph-user-circle', 'Avatar, banner, bio, links, and flair.'],
    ['Custom Status', 'ph-smiley', "Let people know what you're up to."],
    ['Appearance', 'ph-sliders', 'Tune the look to your taste.'],
    ['Notification Controls', 'ph-bell', 'Stay informed on your terms.'],
  ]],
];

export function FeaturesPage() {
  return (
    <MarketingShell title="Minimalist | Features" shape="outline-square">
      <main className="container feat-page">
        <div className="feat-hero"><h1>Everything you need. <span>One place.</span></h1><p>From real-time messaging to AI and collaboration — Rooms brings your whole community together.</p><a href="/chat" className="lp-btn lp-btn-primary feat-start">Get Started <i className="ph-bold ph-arrow-right" /></a></div>
        <div className="feat-nav">
          {featureGroups.map(([name]) => <a key={name} href={`#feature-${name.toLowerCase()}`} className="feat-nav-chip">{name}</a>)}
        </div>
        {featureGroups.map(([name, icon, features]) => (
          <section className="feat-cat" id={`feature-${name.toLowerCase()}`} key={name}>
            <h2 className="feat-cat-title"><i className={`ph-bold ${icon}`} /> {name}</h2>
            <div className="feat-grid">
              {features.map(([label, itemIcon, description]) => <div className="feat-card" key={label}><div className="feat-ico"><i className={`ph-bold ${itemIcon}`} /></div><h3>{label}</h3><p>{description}</p></div>)}
            </div>
          </section>
        ))}
        <div className="feat-cta"><h2>Ready to dive in?</h2><div className="lp-cta centered"><a href="/chat" className="lp-btn lp-btn-primary">Get Started <i className="ph-bold ph-arrow-right" /></a><Link to="/download" className="lp-btn lp-btn-secondary"><i className="ph-bold ph-download-simple" /> Download</Link></div></div>
      </main>
    </MarketingShell>
  );
}

const downloads = [
  ['windows', 'Windows', 'ph-windows-logo', 'Version 1.0 • 64-bit', ['Download for Windows'], ['Windows 10 or later', '4 GB RAM • 200 MB disk']],
  ['mac', 'macOS', 'ph-apple-logo', 'Version 1.0 • Universal', ['Apple Silicon', 'Intel'], ['macOS 12 Monterey or later', 'Apple Silicon & Intel supported']],
  ['android', 'Android', 'ph-android-logo', 'Version 1.0', ['Google Play', 'Direct APK'], ['Android 8.0 or later']],
  ['ios', 'iPhone & iPad', 'ph-app-store-logo', 'Version 1.0', ['App Store'], ['iOS / iPadOS 15 or later']],
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
  const detectedLabel = downloads.find(([id]) => id === platform)?.[1];

  const comingSoon = (label) => {
    setToast(`${label} app is coming soon! Use the web app for now.`);
    window.setTimeout(() => setToast(''), 3500);
  };

  return (
    <MarketingShell title="Minimalist | Download" shape="outline-square">
      <main className="container dl-page">
        <div className="dl-hero"><h1>Download Rooms <span>Everywhere.</span></h1><p>Stay connected across every device. One account, every platform.</p>{detectedLabel && <p className="dl-detected">We detected {detectedLabel} — your recommended download is highlighted below.</p>}</div>
        <div className="dl-grid">
          {downloads.map(([id, name, icon, meta, buttons, requirements]) => <div className={`dl-card ${id === platform ? 'recommended' : ''}`} key={id}>{id === platform && <div className="dl-badge">Recommended</div>}<div className="dl-card-icon"><i className={`ph-bold ${icon}`} /></div><h2>{name}</h2><p className="dl-meta">{meta}</p>{buttons.map((label, index) => <button type="button" className={`dl-btn ${index ? 'dl-btn-ghost' : ''}`} key={label} onClick={() => comingSoon(label)}>{label}</button>)}<ul className="dl-reqs">{requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></div>)}
        </div>
        <div className="dl-section"><h2 className="dl-section-title">Installation</h2><div className="dl-install">{[['Download', 'Pick your platform above — we highlight the one that matches your device.'], ['Install', 'Open the installer or store page and follow the prompts.'], ['Sign in', 'Use one account and pick up exactly where you left off.']].map(([label, text], index) => <div className="dl-step" key={label}><span className="dl-step-n">{index + 1}</span><div><strong>{label}</strong><p>{text}</p></div></div>)}</div></div>
        <div className="dl-section"><h2 className="dl-section-title">Download FAQ</h2><div className="dl-faq"><div className="dl-faq-item"><h3>Is it free?</h3><p>Yes — the apps are free. Optional Advanced and Pro tiers raise upload limits, room creation caps, analytics, calls, and badges.</p></div><div className="dl-faq-item"><h3>Do I need separate accounts?</h3><p>No. One account works across web, desktop, and mobile.</p></div><div className="dl-faq-item"><h3>No app for my platform?</h3><p>You can always <a href="/chat">open the web app</a>.</p></div></div></div>
      </main>
      <Toast message={toast} onClose={() => setToast('')} />
    </MarketingShell>
  );
}

export function StoryPage() {
  return (
    <MarketingShell title="Minimalist | Story" shape="yellow-square">
      <main className="container fade-in-up story-page">
        <h1>Just <span>Enough.</span></h1>
        <p>The modern web is crowded. We built this platform with a singular goal: to strip away the distractions and leave only what matters.</p>
        <p><strong>Not more. Not less.</strong> Like framing the perfect shot, we believe in stripping away the unnecessary background elements until only the essential focus remains—the connection between people.</p>
        <p>Whether you are across the street or across the world, your words take center stage here. No algorithms. No clutter. Just pure conversation.</p>
      </main>
    </MarketingShell>
  );
}

const faqItems = [
  ['What is Minimalist Chat?', 'Minimalist Chat is a real-time messaging app built around rooms. Every room combines conversation, collaborative documents, a shared whiteboard, tasks, events, and AI tools.'],
  ['How do I create or join a room?', 'Open the room sidebar and use Create to start a room, or Join to enter with an invite link or code.'],
  ['What are Docs and the Whiteboard?', 'Collaborative Docs update live for everyone, while the Shared Whiteboard provides draggable sticky notes for brainstorming.'],
  ['What do the Advanced and Pro tiers include?', 'Base includes 10MB files, 500MB/day, custom accent themes, and up to 3 created rooms. Advanced raises that to 700MB files, 1.5GB/day, 5 created rooms, and an Advanced badge. Pro raises it to 3GB files, 9GB/day, unlimited rooms, room analytics, video calls, offline viewing, a personal AI agent, and a Pro badge.'],
  ['How do I add friends and send private messages?', 'Open Contacts to search people, send requests, and start private conversations.'],
  ['Is my data private?', 'Account and message data are handled according to the Privacy Policy. You can delete your account from Settings.'],
];

function InfoPage({ title, eyebrow, children }) {
  return <MarketingShell title={`Minimalist | ${title}`}><main className="container fade-in-up info-page"><h1>{title.split(' ')[0]} <span>{title.split(' ').slice(1).join(' ')}</span></h1><p className="info-eyebrow">{eyebrow}</p><div className="info-stack">{children}</div></main></MarketingShell>;
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
