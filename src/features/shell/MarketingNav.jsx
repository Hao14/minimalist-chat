import { useState } from 'react';

const links = [
  ['/', 'Home'],
  ['/features', 'Features'],
  ['/download', 'Download'],
  ['/story', 'Story'],
];

function isActive(path, href) {
  return href === '/' ? (path === '/' || path === '/index') : path === href;
}

function BlipLogo() {
  return (
    <a href="/" id="nav-logo">
      <div className="mascot-blip">
        <div className="blip-eye left" />
        <div className="blip-eye right" />
      </div>
      <span className="logo-text">MINIMALIST</span>
    </a>
  );
}

export function MarketingNav({ path, loggedIn }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <BlipLogo />
      <div className="desktop-nav">
        {links.map(([href, label]) => (
          <a href={href} className={isActive(path, href) ? 'active' : ''} key={href}>{label}</a>
        ))}
        <a href="/chat" className={`auth-only ${loggedIn ? '' : 'hidden'}`}>Chat</a>
        <a href="/login" className={`guest-only ${loggedIn ? 'hidden' : ''}`}>Login</a>
        <a href="/login" className={`nav-cta guest-only ${loggedIn ? 'hidden' : ''}`}>Sign Up</a>
      </div>
      <button id="mobile-menu-btn" className="mobile-only nav-btn" type="button" onClick={() => setMobileOpen((open) => !open)}>
        MENU
      </button>
      <div id="mobile-nav-links" className={`mobile-only ${mobileOpen ? '' : 'hidden'}`}>
        {links.map(([href, label]) => (
          <a href={href} className={`mobile-link ${isActive(path, href) ? 'active' : ''}`} key={href}>
            {label.toUpperCase()}
          </a>
        ))}
        <a href="/chat" className={`mobile-link auth-only ${loggedIn ? '' : 'hidden'}`}>CHAT</a>
        <a href="/login" className={`mobile-link guest-only ${loggedIn ? 'hidden' : ''}`}>LOGIN</a>
        <a href="/login" className={`mobile-link guest-only ${loggedIn ? 'hidden' : ''}`}>SIGN UP</a>
      </div>
    </>
  );
}
