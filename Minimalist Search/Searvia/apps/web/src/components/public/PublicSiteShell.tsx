import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "@/components/info/info-page.module.css";

interface PublicSiteShellProps {
  readonly children: ReactNode;
}

export function PublicSiteShell({ children }: PublicSiteShellProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Searvia home">
          <Image src="/searvia-mark.svg" alt="" width={30} height={30} />
          <span>searvia</span>
        </Link>
        <nav className={styles.nav} aria-label="Page navigation">
          <Link href="/#product">Product</Link>
          <Link href="/#pricing">Pricing</Link>
          <Link href="/security">Security</Link>
          <Link className={styles.signIn} href="/login">
            Sign in
          </Link>
        </nav>
      </header>

      <main>{children}</main>

      <footer className={styles.footer}>
        <span>searvia</span>
        <p>Search visibility, made clear.</p>
        <Link href="/contact">Contact</Link>
      </footer>
    </div>
  );
}
