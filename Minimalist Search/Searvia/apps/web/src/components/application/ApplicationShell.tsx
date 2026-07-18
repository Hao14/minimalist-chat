import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { ApplicationNavigation } from "./ApplicationNavigation";
import { SignOutButton } from "./SignOutButton";
import styles from "./application-shell.module.css";

type ApplicationShellProps = {
  children: ReactNode;
  user: Readonly<{ name: string; email: string }>;
  organization: Readonly<{ name: string; role: string }> | null;
};

export function ApplicationShell({ children, user, organization }: ApplicationShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#application-content">
        Skip to application content
      </a>

      <aside className={styles.sidebar} aria-label="Searvia application navigation">
        <div className={styles.sidebarHeading}>
          <Link className={styles.wordmark} href="/" aria-label="Searvia home">
            searvia
          </Link>
          <span className={styles.foundationBadge}>
            <span aria-hidden="true" />
            {organization === null ? "Onboarding" : organization.role}
          </span>
        </div>

        <ApplicationNavigation />

        <div className={styles.sidebarNote}>
          <strong>{organization?.name ?? "Workspace not created"}</strong>
          <p>{user.email}</p>
          <SignOutButton />
        </div>

        <Link className={styles.publicLink} href="/">
          Public website
          <ArrowUpRight aria-hidden="true" size={16} />
        </Link>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <span>{organization?.name ?? "Set up your workspace"}</span>
            <p>Signed in as {user.name}</p>
          </div>
          <p className={styles.dataNotice}>Tenant-scoped session</p>
          <div className={styles.topbarSignal} aria-hidden="true">
            <span className={styles.topbarSignalNode} />
            <span className={styles.topbarPacket} />
            <span className={styles.topbarPacketSecondary} />
          </div>
        </header>

        <main className={styles.content} id="application-content" tabIndex={-1}>
          <div className={styles.workspaceField} aria-hidden="true">
            <span />
            <span />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
