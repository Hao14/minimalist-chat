"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bot,
  Check,
  CircleDot,
  CreditCard,
  Database,
  FileChartColumn,
  FileText,
  Globe2,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  Plug2,
  ScanSearch,
  Settings,
  ShieldCheck,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { integrationContent, type MainView } from "./data";
import styles from "./searvia-product.module.css";

export function WorkspaceView({ onNavigate }: { onNavigate: (view: MainView) => void }) {
  return (
    <section className={styles.workspacePage}>
      <div className={styles.workspaceHero}>
        <div>
          <span className={styles.demoLabel}>
            <Database size={13} />
            Demo workspace
          </span>
          <h1>Good morning, Alex.</h1>
          <p>
            Acme Software is easier to discover than last week. Your site health rose 4 points,
            while 14 critical issues still need attention.
          </p>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => onNavigate("overview")}
        >
          <ScanSearch size={16} />
          Open Site Audit
        </button>
      </div>
      <div className={styles.workspaceMetricBand}>
        <div>
          <span>Site Health</span>
          <strong>
            82<small>/100</small>
          </strong>
          <em className={styles.textGood}>+4 this week</em>
        </div>
        <div>
          <span>Crawled pages</span>
          <strong>1,248</strong>
          <em>Latest crawl</em>
        </div>
        <div>
          <span>Critical issues</span>
          <strong className={styles.textDanger}>14</strong>
          <em className={styles.textGood}>3 fewer</em>
        </div>
        <div>
          <span>Integrations</span>
          <strong>
            0<small>/4</small>
          </strong>
          <em>Connect sources</em>
        </div>
      </div>
      <div className={styles.workspaceColumns}>
        <section className={styles.workspaceAuditCard}>
          <div className={styles.panelTitleRow}>
            <div>
              <span className={styles.sectionIcon}>
                <ScanSearch size={18} />
              </span>
              <h2>Site Audit</h2>
            </div>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => onNavigate("overview")}
            >
              View audit
              <ArrowRight size={15} />
            </button>
          </div>
          <div className={styles.healthVisual}>
            <div>
              <span>82</span>
              <small>Good</small>
            </div>
            <div>
              <strong>Visibility path</strong>
              <p>Health improved across the latest two crawls.</p>
              <span className={styles.miniPath}>
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
          <div className={styles.workspaceIssueRows}>
            <span>
              <CircleDot />
              4XX pages<strong>112 URLs</strong>
            </span>
            <span>
              <CircleDot />
              Missing titles<strong>85 URLs</strong>
            </span>
            <span>
              <CircleDot />
              Long descriptions<strong>241 URLs</strong>
            </span>
          </div>
        </section>
        <section className={styles.workspaceSources}>
          <div className={styles.panelTitleRow}>
            <h2>Visibility sources</h2>
            <span>0 of 4 connected</span>
          </div>
          <p>Connect data providers to expand this workspace beyond the crawl.</p>
          <SourceRow
            icon={KeyRound}
            label="Search performance"
            action={() => onNavigate("keywords")}
          />
          <SourceRow
            icon={UsersRound}
            label="Competitor intelligence"
            action={() => onNavigate("competitors")}
          />
          <SourceRow icon={Link2} label="Backlink index" action={() => onNavigate("backlinks")} />
          <SourceRow
            icon={Bot}
            label="AI answer monitoring"
            action={() => onNavigate("ai-visibility")}
          />
        </section>
      </div>
    </section>
  );
}

function SourceRow({
  icon: Icon,
  label,
  action,
}: {
  icon: LucideIcon;
  label: string;
  action: () => void;
}) {
  return (
    <button type="button" className={styles.sourceRow} onClick={action}>
      <span>
        <Icon size={16} />
        {label}
      </span>
      <small>Integration required</small>
      <ArrowRight size={15} />
    </button>
  );
}

export function IntegrationRequiredView({ view }: { view: keyof typeof integrationContent }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const content = integrationContent[view];
  const Icon =
    view === "keywords"
      ? KeyRound
      : view === "competitors"
        ? UsersRound
        : view === "backlinks"
          ? Link2
          : Bot;

  return (
    <section className={styles.integrationPage}>
      <div className={styles.integrationHeading}>
        <div>
          <span className={styles.moduleName}>{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
        </div>
        <span className={styles.demoLabel}>
          <Database size={13} />
          Demo data unavailable
        </span>
      </div>
      <div className={styles.integrationEmpty}>
        <div className={styles.integrationGraphic} aria-hidden="true">
          <span>
            <Icon size={28} />
          </span>
          <i />
          <span>
            <Plug2 size={25} />
          </span>
        </div>
        <span className={styles.requiredLabel}>
          <LockKeyhole size={14} />
          Integration required
        </span>
        <h2>Connect {content.source}</h2>
        <p>
          This module needs a live data source. Searvia will not invent rankings, links, competitor
          metrics, mentions, or citations for this demo.
        </p>
        <button type="button" className={styles.primaryButton} onClick={() => setSetupOpen(true)}>
          <Plug2 size={16} />
          Review connection
        </button>
        <small>You’ll choose scopes and authorize the provider before any data is imported.</small>
      </div>
      <div className={styles.integrationPromise}>
        <span>
          <ShieldCheck size={16} />
          <strong>Read-only by default</strong>
          <small>Requested scopes are shown before authorization.</small>
        </span>
        <span>
          <Zap size={16} />
          <strong>No placeholder metrics</strong>
          <small>Results appear only after a successful sync.</small>
        </span>
        <span>
          <Globe2 size={16} />
          <strong>Project-scoped</strong>
          <small>Imported data stays within Acme Software.</small>
        </span>
      </div>
      {setupOpen ? (
        <div
          className={styles.modalLayer}
          role="presentation"
          onMouseDown={() => setSetupOpen(false)}
        >
          <section
            className={styles.setupModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.setupModalHeader}>
              <span>
                <Icon size={20} />
              </span>
              <div>
                <small>Connection preview</small>
                <h2 id="connection-title">{content.source}</h2>
              </div>
              <button
                type="button"
                aria-label="Close connection preview"
                onClick={() => setSetupOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className={styles.setupSteps}>
              <span>
                <i>
                  <Check size={13} />
                </i>
                <strong>Choose provider</strong>
                <small>{content.source}</small>
              </span>
              <span>
                <i>2</i>
                <strong>Authorize access</strong>
                <small>Not available in this product demo</small>
              </span>
              <span>
                <i>3</i>
                <strong>Import data</strong>
                <small>Begins only after authorization</small>
              </span>
            </div>
            <div className={styles.honestNotice}>
              <LockKeyhole size={17} />
              <p>
                <strong>No connection will be made here.</strong>
                <br />
                This demo shows the required state without requesting credentials or simulating
                provider data.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSetupOpen(false)}
              >
                Close preview
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

const utilityContent: Record<
  Exclude<
    MainView,
    | "workspace"
    | "overview"
    | "issues"
    | "crawled-pages"
    | "internal-links"
    | "sitemaps"
    | "performance"
    | "compare-crawls"
    | "crawl-settings"
    | keyof typeof integrationContent
  >,
  { title: string; description: string; icon: LucideIcon; items: string[] }
> = {
  content: {
    title: "Content",
    description: "Turn verified visibility gaps into a focused editorial queue.",
    icon: FileText,
    items: ["Content opportunities", "Briefs", "Published updates"],
  },
  reports: {
    title: "Reports",
    description: "Package crawl and visibility data for teams and clients.",
    icon: FileChartColumn,
    items: ["Weekly visibility summary", "Technical audit", "Executive snapshot"],
  },
  integrations: {
    title: "Integrations",
    description: "Manage the verified data sources available to this workspace.",
    icon: Plug2,
    items: [
      "Search performance",
      "Competitor intelligence",
      "Backlink index",
      "AI answer monitoring",
    ],
  },
  team: {
    title: "Team",
    description: "Control who can view, triage, and manage Acme Software.",
    icon: UsersRound,
    items: ["Alex Kim · Owner", "Maya Jordan · Editor", "Devon Shaw · Viewer"],
  },
  billing: {
    title: "Billing",
    description: "Review the demo plan and usage model for this workspace.",
    icon: CreditCard,
    items: ["Demo plan", "1,248 crawled pages", "No payment method"],
  },
  settings: {
    title: "Workspace settings",
    description: "Manage project identity, notifications, and workspace defaults.",
    icon: Settings,
    items: ["Project profile", "Notifications", "Access and security"],
  },
};

export function UtilityView({ view }: { view: keyof typeof utilityContent }) {
  const content = utilityContent[view];
  const Icon = content.icon;
  return (
    <section className={styles.utilityPage}>
      <div className={styles.utilityIntro}>
        <span className={styles.sectionIcon}>
          <Icon size={20} />
        </span>
        <h1>{content.title}</h1>
        <p>{content.description}</p>
        <span className={styles.demoLabel}>
          <Database size={13} />
          Demo workspace
        </span>
      </div>
      <div className={styles.utilityList}>
        {content.items.map((item, index) => (
          <button type="button" key={item}>
            <span>
              <strong>{item}</strong>
              <small>
                {index === 0 ? "Available in this demo workspace" : "Configuration preview"}
              </small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      <div className={styles.utilityNotice}>
        <Mail size={18} />
        <div>
          <strong>Changes stay local to the demo</strong>
          <p>
            No invitations, emails, payments, provider connections, or external updates are sent
            from this experience.
          </p>
        </div>
      </div>
    </section>
  );
}
