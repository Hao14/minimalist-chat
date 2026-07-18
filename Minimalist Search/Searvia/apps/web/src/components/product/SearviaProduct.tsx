"use client";

import { useEffect, useState } from "react";
import type { AuditView, MainView } from "./data";
import { CommandPalette, ProductSidebar, ProductTopbar } from "./ShellNavigation";
import { SiteAuditViews, type CrawlState } from "./SiteAuditViews";
import { IntegrationRequiredView, UtilityView, WorkspaceView } from "./WorkspaceViews";
import styles from "./searvia-product.module.css";

const auditViews = new Set<MainView>([
  "overview",
  "issues",
  "crawled-pages",
  "internal-links",
  "sitemaps",
  "performance",
  "compare-crawls",
  "crawl-settings",
]);

const integrationViews = new Set<MainView>([
  "keywords",
  "competitors",
  "backlinks",
  "ai-visibility",
]);

const viewLabels: Record<MainView, string> = {
  workspace: "Workspace overview",
  overview: "Site Audit overview",
  issues: "Site Audit issues",
  "crawled-pages": "Crawled pages",
  "internal-links": "Internal links",
  sitemaps: "Sitemaps",
  performance: "Performance",
  "compare-crawls": "Compare crawls",
  "crawl-settings": "Crawl settings",
  keywords: "Keywords",
  competitors: "Competitors",
  backlinks: "Backlinks",
  "ai-visibility": "AI Visibility",
  content: "Content",
  reports: "Reports",
  integrations: "Integrations",
  team: "Team",
  billing: "Billing",
  settings: "Workspace settings",
};

function ProductMotionNetwork() {
  return (
    <div className={styles.productMotionNetwork} aria-hidden="true">
      <span className={styles.shellTopRoute}>
        <i />
      </span>
    </div>
  );
}

export default function SearviaProduct() {
  const [activeView, setActiveView] = useState<MainView>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [crawlState, setCrawlState] = useState<CrawlState>("running");
  const [crawlProgress, setCrawlProgress] = useState(62);

  useEffect(() => {
    if (crawlState !== "running" || activeView !== "overview") return;

    const interval = window.setInterval(() => {
      setCrawlProgress((current) => Math.min(100, current + 1));
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeView, crawlState]);

  useEffect(() => {
    if (crawlState !== "running" || crawlProgress < 100) return;
    const completionFrame = window.requestAnimationFrame(() => setCrawlState("complete"));
    return () => window.cancelAnimationFrame(completionFrame);
  }, [crawlProgress, crawlState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = (view: MainView) => {
    setActiveView(view);
    setMobileOpen(false);
  };

  const runAudit = () => {
    setCrawlProgress(2);
    setCrawlState("running");
  };

  return (
    <div
      className={styles.productRoot}
      data-active-view={activeView}
      data-crawl-state={crawlState}
      data-motion-overlays="off"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
    >
      <ProductMotionNetwork />
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {viewLabels[activeView]} view selected
      </p>
      <ProductSidebar
        activeView={activeView}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onNavigate={navigate}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
      <div
        className={`${styles.productMain} ${sidebarCollapsed ? styles.productMainCollapsed : ""}`}
      >
        <ProductTopbar
          onOpenMobile={() => setMobileOpen(true)}
          onOpenCommand={() => setCommandOpen(true)}
        />
        <main className={styles.productContent}>
          <div className={styles.viewStage} data-view={activeView}>
            {auditViews.has(activeView) ? (
              <SiteAuditViews
                view={activeView as AuditView}
                crawlState={crawlState}
                crawlProgress={crawlProgress}
                onRunAudit={runAudit}
                onPauseAudit={() => setCrawlState("paused")}
                onResumeAudit={() => setCrawlState("running")}
                onCancelAudit={() => setCrawlState("cancelled")}
              />
            ) : null}
            {activeView === "workspace" ? <WorkspaceView onNavigate={navigate} /> : null}
            {integrationViews.has(activeView) ? (
              <IntegrationRequiredView
                view={activeView as "keywords" | "competitors" | "backlinks" | "ai-visibility"}
              />
            ) : null}
            {activeView === "content" ||
            activeView === "reports" ||
            activeView === "integrations" ||
            activeView === "team" ||
            activeView === "billing" ||
            activeView === "settings" ? (
              <UtilityView view={activeView} />
            ) : null}
          </div>
        </main>
      </div>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onNavigate={navigate}
      />
    </div>
  );
}
