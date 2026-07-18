"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";

import { brandConfig } from "@/config/brand";
import styles from "./MarketingHome.module.css";

const navigationLinks = [
  { href: "#product", label: "Product" },
  { href: "#audit", label: "Solutions" },
  { href: "#workflow", label: "Resources" },
  { href: "#pricing", label: "Pricing" },
];

export function Navigation() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <header className={styles.navigation} aria-label="Primary navigation">
      <span className={styles.navigationSignal} aria-hidden="true">
        <span />
      </span>
      <div className={styles.navigationInner}>
        <Link className={styles.wordmark} href="/" aria-label="Searvia home">
          {brandConfig.wordmark}
        </Link>

        <nav className={styles.desktopNav} aria-label="Main links">
          {navigationLinks.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.desktopActions}>
          <Link className={styles.signInLink} href="/login">
            Sign in
          </Link>
          <Link className={styles.navCta} href="/signup">
            {brandConfig.callsToAction.primary}
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>

        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={isOpen}
          aria-controls="mobile-navigation"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <X aria-hidden="true" size={24} /> : <Menu aria-hidden="true" size={25} />}
          <span>{isOpen ? "Close" : "Menu"}</span>
        </button>
      </div>

      <nav
        id="mobile-navigation"
        className={`${styles.mobileNav} ${isOpen ? styles.mobileNavOpen : ""}`}
        aria-label="Mobile links"
        aria-hidden={!isOpen}
      >
        <div className={styles.mobileNavInner}>
          {navigationLinks.map((link) => (
            <Link href={link.href} key={link.href} onClick={closeMenu}>
              {link.label}
            </Link>
          ))}
          <div className={styles.mobileNavActions}>
            <Link href="/login" onClick={closeMenu}>
              Sign in
            </Link>
            <Link className={styles.navCta} href="/signup" onClick={closeMenu}>
              {brandConfig.callsToAction.primary}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
