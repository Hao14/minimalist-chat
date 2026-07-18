"use client";

import { FolderKanban, LayoutDashboard, Settings2, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

import styles from "./application-shell.module.css";

const navigationItems = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/projects", label: "Projects", icon: FolderKanban },
  { href: "/app/settings/team", label: "Team", icon: UsersRound },
  { href: "/app/settings", label: "Settings", icon: Settings2 },
] as const;

function getActiveIndex(pathname: string) {
  if (pathname.startsWith("/app/settings/team")) return 2;
  if (pathname.startsWith("/app/settings")) return 3;
  if (pathname.startsWith("/app/projects")) return 1;
  return 0;
}

export function ApplicationNavigation() {
  const pathname = usePathname();
  const activeIndex = getActiveIndex(pathname);
  const navigationStyle = { "--active-navigation-index": activeIndex } as CSSProperties;

  return (
    <nav className={styles.navigation} aria-label="Application sections" style={navigationStyle}>
      {navigationItems.map((item, index) => {
        const Icon = item.icon;
        const isActive = index === activeIndex;

        return (
          <Link
            className={
              isActive
                ? `${styles.navigationLink} ${styles.navigationActive}`
                : styles.navigationLink
            }
            href={item.href}
            key={item.href}
            aria-current={isActive ? "page" : undefined}
            style={{ "--navigation-item-index": index } as CSSProperties}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>{item.label}</span>
            <i className={styles.navigationSignal} aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
