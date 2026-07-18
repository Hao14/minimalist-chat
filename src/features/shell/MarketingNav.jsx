import { useEffect, useRef, useState } from 'react';

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

function CtaArrowIcon() {
  return (
    <svg className="nav-cta-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.5 12h11" fill="none" stroke="currentColor" strokeWidth="2.9" strokeLinecap="round" />
      <path d="m13.5 7.8 4.2 4.2-4.2 4.2" fill="none" stroke="currentColor" strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MarketingNav({ path, loggedIn }) {
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const firstLink = menuRef.current?.querySelector('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    firstLink?.focus();
    const navElement = menuButtonRef.current?.closest('nav');

    const handlePointerDown = (event) => {
      if (navElement?.contains(event.target)) return;
      setMobileOpen(false);
    };

    const handleFocusIn = (event) => {
      if (navElement?.contains(event.target)) return;
      setMobileOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
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
  }, [mobileOpen]);

  return (
    <>
      <BlipLogo />
      <div className="desktop-nav">
        {links.map(([href, label]) => (
          <a href={href} className={isActive(path, href) ? 'active' : ''} aria-current={isActive(path, href) ? 'page' : undefined} key={href}>{label}</a>
        ))}
        <a href="/chat" className={`auth-only ${loggedIn ? '' : 'hidden'}`}>Chat</a>
        <a href="/login" className={`guest-only ${loggedIn ? 'hidden' : ''}`}>Login</a>
        <a href="/login" className={`nav-cta guest-only ${loggedIn ? 'hidden' : ''}`}>
          <span>Sign Up</span>
          <CtaArrowIcon />
        </a>
      </div>
      <button
        ref={menuButtonRef}
        id="mobile-menu-btn"
        className="mobile-only nav-btn"
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="marketing-mobile-nav-links"
        onClick={() => setMobileOpen((open) => !open)}
      >
        MENU
      </button>
      <div
        ref={menuRef}
        id="marketing-mobile-nav-links"
        className={`mobile-only marketing-mobile-nav-links ${mobileOpen ? '' : 'hidden'}`}
        aria-hidden={!mobileOpen}
      >
        {links.map(([href, label]) => (
          <a
            href={href}
            className={`mobile-link ${isActive(path, href) ? 'active' : ''}`}
            aria-current={isActive(path, href) ? 'page' : undefined}
            key={href}
            onClick={() => setMobileOpen(false)}
          >
            {label.toUpperCase()}
          </a>
        ))}
        <a href="/chat" className={`mobile-link auth-only ${loggedIn ? '' : 'hidden'}`} onClick={() => setMobileOpen(false)}>CHAT</a>
        <a href="/login" className={`mobile-link guest-only ${loggedIn ? 'hidden' : ''}`} onClick={() => setMobileOpen(false)}>LOGIN</a>
        <a href="/login" className={`mobile-link mobile-signup-link guest-only ${loggedIn ? 'hidden' : ''}`} onClick={() => setMobileOpen(false)}>
          <span>SIGN UP</span>
          <CtaArrowIcon />
        </a>
      </div>
    </>
  );
}
