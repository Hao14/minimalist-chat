"use client";

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CirclePause,
  CirclePlay,
  CircleStop,
  Clock3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Filter,
  Gauge,
  Globe2,
  Info,
  Link2,
  ListFilter,
  MoreVertical,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import {
  auditHistory,
  crawledPages,
  issues,
  type AuditView,
  type CrawledPage,
  type Issue,
  type IssueSeverity,
  type IssueStatus,
} from "./data";
import styles from "./searvia-product.module.css";

export type CrawlState = "running" | "paused" | "cancelled" | "complete";

type SiteAuditViewsProps = {
  view: AuditView;
  crawlState: CrawlState;
  crawlProgress: number;
  onRunAudit: () => void;
  onPauseAudit: () => void;
  onResumeAudit: () => void;
  onCancelAudit: () => void;
};

const totalPages = 1248;

export function SiteAuditViews({
  view,
  crawlState,
  crawlProgress,
  onRunAudit,
  onPauseAudit,
  onResumeAudit,
  onCancelAudit,
}: SiteAuditViewsProps) {
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [selectedPage, setSelectedPage] = useState<CrawledPage | null>(null);

  return (
    <>
      <SiteAuditHeader onRunAudit={onRunAudit} />

      {view === "overview" ? (
        <>
          <MetricBand />
          <div className={styles.overviewGrid}>
            <IssuesPanel compact onSelectIssue={setSelectedIssue} />
            <CrawlProgressPanel
              state={crawlState}
              progress={crawlProgress}
              onPause={onPauseAudit}
              onResume={onResumeAudit}
              onCancel={onCancelAudit}
              onRun={onRunAudit}
            />
          </div>
        </>
      ) : null}

      {view === "issues" ? (
        <section className={styles.pagePanel} aria-labelledby="issues-page-title">
          <div className={styles.sectionIntro}>
            <div>
              <h2 id="issues-page-title">All issues</h2>
              <p>Prioritize technical and content problems found in the latest crawl.</p>
            </div>
            <div className={styles.summaryChips} aria-label="Issue summary">
              <span className={styles.summaryCritical}>
                <AlertCircle size={14} />
                14 critical
              </span>
              <span>
                <AlertTriangle size={14} />
                126 warnings
              </span>
              <span>
                <Info size={14} />
                392 notices
              </span>
            </div>
          </div>
          <IssuesPanel onSelectIssue={setSelectedIssue} />
        </section>
      ) : null}

      {view === "crawled-pages" ? <CrawledPagesView onSelectPage={setSelectedPage} /> : null}
      {view === "compare-crawls" ? <CrawlComparison /> : null}
      {view === "crawl-settings" ? <CrawlSettings /> : null}
      {view === "internal-links" ? <InternalLinksView /> : null}
      {view === "sitemaps" ? <SitemapsView /> : null}
      {view === "performance" ? <PerformanceView /> : null}

      <IssueDetailDrawer issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
      <PageDetailDrawer page={selectedPage} onClose={() => setSelectedPage(null)} />
    </>
  );
}

function SiteAuditHeader({ onRunAudit }: { onRunAudit: () => void }) {
  return (
    <div className={styles.auditHeader}>
      <div>
        <h1>Site Audit</h1>
        <div className={styles.headerControls}>
          <button type="button" className={styles.controlButton}>
            <CalendarDays size={16} aria-hidden="true" />
            <span>May 12 – May 18, 2026</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <span className={styles.demoLabel}>
            <Database size={13} aria-hidden="true" />
            Demo data
          </span>
        </div>
      </div>
      <div className={styles.auditActions}>
        <button type="button" className={styles.textButton}>
          <CircleHelp size={16} aria-hidden="true" />
          How this score works
        </button>
        <button type="button" className={styles.secondaryButton}>
          <Download size={16} aria-hidden="true" />
          Export
        </button>
        <button type="button" className={styles.primaryButton} onClick={onRunAudit}>
          <Play size={16} />
          Run new audit
        </button>
      </div>
    </div>
  );
}

function MetricBand() {
  return (
    <section className={styles.metricBand} aria-label="Site audit summary">
      <div className={styles.metricRow}>
        <Metric label="Site Health" value="82" suffix="/ 100" tone="health" detail="Good" />
        <Metric label="Crawled pages" value="1,248" detail="100% of 1,248" />
        <Metric
          label="Critical issues"
          value="14"
          tone="danger"
          detail="3 vs May 5 – May 11, 2026"
          direction="down"
        />
        <Metric
          label="Total issues"
          value="532"
          detail="28 vs May 5 – May 11, 2026"
          direction="down"
        />
        <div className={styles.auditMeta}>
          <span>
            <ShieldCheck size={15} /> <strong>Source:</strong> Site Audit Crawler
          </span>
          <span>
            <Bot size={15} /> <strong>User agent:</strong> SearviaBot/2.0
          </span>
          <span>
            <Clock3 size={15} /> <strong>Crawl start:</strong> May 18, 2026, 08:14 AM
          </span>
          <span>
            <Globe2 size={15} /> <strong>Coverage:</strong> Primary domain
          </span>
        </div>
      </div>
      <VisibilityPath />
    </section>
  );
}

function Metric({
  label,
  value,
  suffix,
  detail,
  direction,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  direction?: "up" | "down";
  tone?: "health" | "danger";
}) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>
        {label}
        <Info size={13} aria-hidden="true" />
      </div>
      <div className={`${styles.metricValue} ${tone === "danger" ? styles.metricValueDanger : ""}`}>
        {value} {suffix ? <small>{suffix}</small> : null}
      </div>
      {tone === "health" ? (
        <div className={styles.healthBar}>
          <span />
        </div>
      ) : null}
      <div className={`${styles.metricDetail} ${direction ? styles.metricTrend : ""}`}>
        {tone === "health" ? <span className={styles.healthDot} /> : null}
        {direction === "down" ? <ArrowDown size={12} aria-hidden="true" /> : null}
        <span>{detail}</span>
      </div>
    </div>
  );
}

function VisibilityPath() {
  return (
    <div className={styles.visibilityPath}>
      <div className={styles.pathDrawing} aria-hidden="true">
        <svg viewBox="0 0 1200 58" preserveAspectRatio="none">
          <path d="M0 10 H610 C650 10 650 30 690 30 H790 C825 30 825 10 865 10 H1200" />
          <path d="M0 31 H610 C650 31 650 51 690 51 H790 C825 51 825 31 865 31 H1200" />
        </svg>
      </div>
      <div className={styles.pathLabels}>
        <div className={styles.pathTitle}>
          <Sparkles size={14} aria-hidden="true" />
          <span>Visibility path</span>
        </div>
        {auditHistory.map((audit, index) => (
          <div
            key={audit.date}
            className={`${styles.pathPoint} ${index === auditHistory.length - 1 ? styles.pathPointActive : ""}`}
          >
            <span className={styles.pathPin} aria-hidden="true" />
            <span>{audit.date}</span>
            <small>Health {audit.health}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssuesPanel({
  compact = false,
  onSelectIssue,
}: {
  compact?: boolean;
  onSelectIssue: (issue: Issue) => void;
}) {
  const [severity, setSeverity] = useState("All");
  const [category, setCategory] = useState("All");
  const [lifecycle, setLifecycle] = useState("All");
  const [query, setQuery] = useState("");
  const [statusByIssue, setStatusByIssue] = useState<Record<string, IssueStatus>>({});
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredIssues = useMemo(
    () =>
      issues.filter((issue) => {
        if (severity !== "All" && issue.severity !== severity) return false;
        if (category !== "All" && issue.category !== category) return false;
        if (lifecycle !== "All" && issue.lifecycle !== lifecycle) return false;
        if (!deferredQuery) return true;
        return `${issue.title} ${issue.id} ${issue.category}`.toLowerCase().includes(deferredQuery);
      }),
    [category, deferredQuery, lifecycle, severity],
  );

  const shownIssues = compact ? filteredIssues.slice(0, 5) : filteredIssues;
  const filtersActive =
    severity !== "All" || category !== "All" || lifecycle !== "All" || query !== "";
  const clearFilters = () => {
    setSeverity("All");
    setCategory("All");
    setLifecycle("All");
    setQuery("");
  };

  return (
    <section
      className={`${styles.issuesPanel} ${compact ? styles.issuesPanelCompact : ""}`}
      aria-labelledby={compact ? "overview-issues" : "all-issues"}
    >
      <div className={styles.panelTitleRow}>
        <h2 id={compact ? "overview-issues" : "all-issues"}>
          Issues <span>532</span>
        </h2>
      </div>
      <div className={styles.filterBar}>
        <FilterSelect
          label="Severity"
          value={severity}
          onChange={setSeverity}
          options={["All", "Critical", "Warning", "Notice"]}
        />
        <FilterSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={[
            "All",
            "Crawlability",
            "Content",
            "Indexability",
            "Accessibility",
            "Internal links",
          ]}
        />
        <FilterSelect
          label="Lifecycle"
          value={lifecycle}
          onChange={setLifecycle}
          options={["All", "New", "Recurring", "Improved"]}
        />
        <label className={styles.filterSearch}>
          <Search size={16} aria-hidden="true" />
          <span className={styles.srOnly}>Filter issues</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by URL or issue..."
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={14} />
            </button>
          ) : null}
        </label>
        <button type="button" className={styles.ruleButton}>
          <ListFilter size={15} aria-hidden="true" />
          Rule
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {filtersActive ? (
          <button type="button" className={styles.clearButton} onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
        <button
          type="button"
          className={styles.filterSettings}
          aria-label="Configure issue columns"
        >
          <Settings2 size={17} />
        </button>
      </div>

      {shownIssues.length ? (
        <>
          <div className={styles.issueTableWrap}>
            <table className={styles.issueTable}>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Issue</th>
                  <th>Category</th>
                  <th>Affected URLs</th>
                  <th>Change</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownIssues.map((issue) => (
                  <tr key={issue.id}>
                    <td>
                      <SeverityLabel severity={issue.severity} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.issueTitleButton}
                        onClick={() => onSelectIssue(issue)}
                      >
                        <strong>{issue.title}</strong>
                        <small>{issue.id}</small>
                      </button>
                    </td>
                    <td>{issue.category}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => onSelectIssue(issue)}
                      >
                        {issue.affected}
                      </button>
                    </td>
                    <td>
                      <ChangeLabel value={issue.change} />
                    </td>
                    <td>
                      <span className={styles.owner}>
                        <span>{issue.initials}</span>
                        {issue.owner}
                      </span>
                    </td>
                    <td>
                      <StatusSelect
                        value={statusByIssue[issue.id] ?? issue.status}
                        onChange={(value) =>
                          setStatusByIssue((current) => ({ ...current, [issue.id]: value }))
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.rowAction}
                        aria-label={`More actions for ${issue.title}`}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.issueMobileList}>
            {shownIssues.map((issue) => (
              <button
                type="button"
                key={issue.id}
                className={styles.issueMobileRow}
                onClick={() => onSelectIssue(issue)}
              >
                <span className={styles.issueMobileTop}>
                  <SeverityLabel severity={issue.severity} />
                  <ChangeLabel value={issue.change} />
                </span>
                <strong>{issue.title}</strong>
                <small>
                  {issue.id} · {issue.category}
                </small>
                <span className={styles.issueMobileMeta}>
                  <span>{issue.affected} URLs</span>
                  <span>{statusByIssue[issue.id] ?? issue.status}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyFilter}>
          <Filter size={22} aria-hidden="true" />
          <strong>No issues match these filters</strong>
          <p>Try widening the severity, category, lifecycle, or search terms.</p>
          <button type="button" className={styles.secondaryButton} onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      <div className={styles.tableFooter}>
        <span>
          Showing {shownIssues.length ? 1 : 0} to {shownIssues.length} of{" "}
          {filteredIssues.length || 0} matching issues
        </span>
        <div className={styles.pagination} aria-label="Pagination">
          <button type="button" aria-label="Previous page" disabled>
            <ChevronLeft size={15} />
          </button>
          <button type="button" className={styles.pageActive} aria-current="page">
            1
          </button>
          <button type="button">2</button>
          <button type="button">3</button>
          <span>…</span>
          <button type="button">107</button>
          <button type="button" aria-label="Next page">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterSelect}>
      <span className={styles.srOnly}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "All" ? label : option}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}

function SeverityLabel({ severity }: { severity: IssueSeverity }) {
  const Icon =
    severity === "Critical" ? AlertCircle : severity === "Warning" ? AlertTriangle : Info;
  return (
    <span className={`${styles.severity} ${styles[`severity${severity.replace(" ", "")}`]}`}>
      <Icon size={15} aria-hidden="true" />
      {severity}
    </span>
  );
}

function ChangeLabel({ value }: { value: number }) {
  const improved = value < 0;
  return (
    <span className={`${styles.change} ${improved ? styles.changeGood : styles.changeBad}`}>
      {improved ? (
        <ArrowDown size={13} aria-hidden="true" />
      ) : (
        <ArrowUp size={13} aria-hidden="true" />
      )}
      {Math.abs(value)}
    </span>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: IssueStatus;
  onChange: (value: IssueStatus) => void;
}) {
  return (
    <label className={`${styles.statusSelect} ${styles[`status${value.replace(" ", "")}`]}`}>
      <span className={styles.srOnly}>Issue status</span>
      <select value={value} onChange={(event) => onChange(event.target.value as IssueStatus)}>
        <option>Open</option>
        <option>In progress</option>
        <option>Resolved</option>
      </select>
      <ChevronDown size={12} aria-hidden="true" />
    </label>
  );
}

const crawlStages = [
  { label: "Queued", threshold: 2 },
  { label: "Discovering URLs", threshold: 10 },
  { label: "Crawling", threshold: 68 },
  { label: "Rendering", threshold: 78 },
  { label: "Extracting data", threshold: 87 },
  { label: "Running rules", threshold: 94 },
  { label: "Calculating scores", threshold: 99 },
  { label: "Complete", threshold: 100 },
] as const;

function CrawlProgressPanel({
  state,
  progress,
  onPause,
  onResume,
  onCancel,
  onRun,
}: {
  state: CrawlState;
  progress: number;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRun: () => void;
}) {
  const currentStageIndex = crawlStages.findIndex((stage) => progress <= stage.threshold);
  const pagesDone = Math.round(totalPages * (progress / 100));
  const stateLabel =
    state === "running"
      ? "Live"
      : state === "paused"
        ? "Paused"
        : state === "complete"
          ? "Complete"
          : "Cancelled";

  return (
    <aside className={styles.crawlPanel} aria-label="Crawl progress" aria-live="polite">
      <div className={styles.crawlPanelHeader}>
        <h2>
          Crawl progress <Activity size={15} aria-hidden="true" />
        </h2>
        <span className={`${styles.liveLabel} ${styles[`crawl${state}`]}`}>
          <span />
          {stateLabel}
        </span>
      </div>
      <ol className={styles.crawlStages}>
        {crawlStages.map((stage, index) => {
          const complete = progress > stage.threshold || state === "complete";
          const active =
            index === currentStageIndex && state !== "cancelled" && state !== "complete";
          return (
            <li
              key={stage.label}
              className={active ? styles.stageActive : complete ? styles.stageComplete : ""}
            >
              <span className={styles.stageIcon} aria-hidden="true">
                {complete ? <Check size={14} /> : active ? index + 1 : index + 1}
              </span>
              <div className={styles.stageBody}>
                <div className={styles.stageRow}>
                  <span>{stage.label}</span>
                  <small>
                    {active
                      ? `${progress}%`
                      : complete && index < 2
                        ? totalPages.toLocaleString()
                        : "—"}
                  </small>
                </div>
                {active ? (
                  <>
                    <div className={styles.progressTrack}>
                      <span style={{ transform: `scaleX(${progress / 100})` }} />
                    </div>
                    <div className={styles.progressMeta}>
                      <span>
                        {pagesDone.toLocaleString()} of {totalPages.toLocaleString()} pages
                      </span>
                      <span>32m elapsed</span>
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className={styles.crawlActions}>
        {state === "running" ? (
          <button type="button" className={styles.secondaryButton} onClick={onPause}>
            <CirclePause size={16} />
            Pause
          </button>
        ) : state === "paused" ? (
          <button type="button" className={styles.primaryButton} onClick={onResume}>
            <CirclePlay size={16} />
            Resume
          </button>
        ) : (
          <button type="button" className={styles.primaryButton} onClick={onRun}>
            <RefreshCw size={16} />
            Run again
          </button>
        )}
        <button
          type="button"
          className={styles.dangerButton}
          onClick={onCancel}
          disabled={state === "cancelled" || state === "complete"}
        >
          <CircleStop size={16} />
          Cancel
        </button>
      </div>
      <div className={styles.crawlId}>
        <span>Crawl ID: crawl_20260518_0814_7f3a2c</span>
        <button type="button" aria-label="Copy crawl ID">
          <Copy size={14} />
        </button>
      </div>
    </aside>
  );
}

function CrawledPagesView({ onSelectPage }: { onSelectPage: (page: CrawledPage) => void }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const pages = useMemo(
    () =>
      crawledPages.filter((page) => {
        if (statusFilter === "Healthy" && page.health < 90) return false;
        if (statusFilter === "Has issues" && page.issues === 0) return false;
        if (statusFilter === "4XX" && page.status < 400) return false;
        return !deferredQuery || `${page.url} ${page.title}`.toLowerCase().includes(deferredQuery);
      }),
    [deferredQuery, statusFilter],
  );

  return (
    <section className={styles.pagePanel} aria-labelledby="crawled-pages-heading">
      <div className={styles.sectionIntro}>
        <div>
          <h2 id="crawled-pages-heading">Crawled pages</h2>
          <p>Inspect crawl, indexability, content, and performance signals URL by URL.</p>
        </div>
        <span className={styles.resultCount}>{totalPages.toLocaleString()} pages</span>
      </div>
      <div className={styles.pageToolbar}>
        <label className={styles.largeSearch}>
          <Search size={17} aria-hidden="true" />
          <span className={styles.srOnly}>Search crawled pages</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by URL or title..."
          />
        </label>
        <FilterSelect
          label="Page health"
          value={statusFilter}
          onChange={setStatusFilter}
          options={["All", "Healthy", "Has issues", "4XX"]}
        />
        <button type="button" className={styles.secondaryButton}>
          <Download size={16} />
          Export
        </button>
      </div>
      <div className={styles.pageTableWrap}>
        <table className={styles.pageTable}>
          <thead>
            <tr>
              <th>Page</th>
              <th>Status</th>
              <th>Health</th>
              <th>Issues</th>
              <th>Depth</th>
              <th>Load time</th>
              <th>Last crawled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.url}>
                <td>
                  <button
                    type="button"
                    className={styles.pageUrlButton}
                    onClick={() => onSelectPage(page)}
                  >
                    <strong>{page.title}</strong>
                    <small>{page.url}</small>
                  </button>
                </td>
                <td>
                  <span
                    className={`${styles.httpStatus} ${page.status >= 400 ? styles.httpStatusError : ""}`}
                  >
                    {page.status >= 400 ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
                    {page.status}
                  </span>
                </td>
                <td>
                  <HealthScore value={page.health} />
                </td>
                <td>{page.issues}</td>
                <td>{page.depth}</td>
                <td>{page.loadTime}</td>
                <td>{page.lastCrawled}</td>
                <td>
                  <button
                    type="button"
                    className={styles.rowAction}
                    aria-label={`Inspect ${page.url}`}
                    onClick={() => onSelectPage(page)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.pageMobileList}>
        {pages.map((page) => (
          <button type="button" key={page.url} onClick={() => onSelectPage(page)}>
            <span>
              <strong>{page.title}</strong>
              <small>{page.url}</small>
            </span>
            <span className={styles.pageMobileStats}>
              <span className={page.status >= 400 ? styles.textDanger : styles.textGood}>
                {page.status}
              </span>
              <span>Health {page.health}</span>
              <span>{page.issues} issues</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function HealthScore({ value }: { value: number }) {
  return (
    <span
      className={`${styles.healthScore} ${value < 50 ? styles.healthScoreBad : value < 80 ? styles.healthScoreWarn : ""}`}
    >
      <span style={{ width: `${value}%` }} />
      {value}
    </span>
  );
}

function CrawlComparison() {
  const [left, setLeft] = useState("May 5 – May 11, 2026");
  const [right, setRight] = useState("May 12 – May 18, 2026");
  const rows = [
    { label: "Site Health", before: 78, after: 82, type: "score" },
    { label: "Critical issues", before: 17, after: 14, type: "issues" },
    { label: "Total issues", before: 560, after: 532, type: "issues" },
    { label: "Crawled pages", before: 1216, after: 1248, type: "pages" },
  ];

  return (
    <section className={styles.pagePanel} aria-labelledby="compare-crawls-heading">
      <div className={styles.sectionIntro}>
        <div>
          <h2 id="compare-crawls-heading">Compare crawls</h2>
          <p>See what improved, regressed, or appeared between two crawl snapshots.</p>
        </div>
        <button type="button" className={styles.secondaryButton}>
          <Download size={16} />
          Export comparison
        </button>
      </div>
      <div className={styles.compareSelectors}>
        <label>
          <span>Earlier crawl</span>
          <select value={left} onChange={(event) => setLeft(event.target.value)}>
            <option>May 5 – May 11, 2026</option>
            <option>Apr 28 – May 4, 2026</option>
          </select>
        </label>
        <ArrowRight size={18} aria-hidden="true" />
        <label>
          <span>Later crawl</span>
          <select value={right} onChange={(event) => setRight(event.target.value)}>
            <option>May 12 – May 18, 2026</option>
            <option>May 5 – May 11, 2026</option>
          </select>
        </label>
      </div>
      <div className={styles.comparisonBand}>
        {rows.map((row) => {
          const delta = row.after - row.before;
          const improved = row.type === "issues" ? delta < 0 : delta > 0;
          return (
            <div key={row.label} className={styles.comparisonMetric}>
              <span>{row.label}</span>
              <div>
                <strong>{row.before.toLocaleString()}</strong>
                <ArrowRight size={15} />
                <strong>{row.after.toLocaleString()}</strong>
              </div>
              <small className={improved ? styles.textGood : styles.textDanger}>
                {improved ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                {Math.abs(delta).toLocaleString()} {improved ? "improved" : "regressed"}
              </small>
            </div>
          );
        })}
      </div>
      <div className={styles.compareColumns}>
        <div className={styles.compareChart}>
          <div className={styles.panelTitleRow}>
            <h3>Health trend</h3>
            <span className={styles.demoLabel}>4 crawls</span>
          </div>
          <div className={styles.barChart} aria-label="Health scores by crawl">
            {auditHistory.map((audit) => (
              <div key={audit.date}>
                <span className={styles.barValue}>{audit.health}</span>
                <span className={styles.bar} style={{ height: `${audit.health}%` }} />
                <small>{audit.date.replace(" – ", "–").replace(/Apr |May /g, "")}</small>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.changeList}>
          <h3>What changed</h3>
          <ChangeItem
            icon={CheckCircle2}
            tone="good"
            title="39 issues resolved"
            detail="Most improvement came from missing titles and redirect chains."
          />
          <ChangeItem
            icon={AlertCircle}
            tone="bad"
            title="11 new issues"
            detail="4XX pages and duplicate headings need attention."
          />
          <ChangeItem
            icon={FileText}
            tone="neutral"
            title="32 more pages crawled"
            detail="New documentation and resource pages entered the crawl."
          />
        </div>
      </div>
    </section>
  );
}

function ChangeItem({
  icon: Icon,
  tone,
  title,
  detail,
}: {
  icon: typeof CheckCircle2;
  tone: "good" | "bad" | "neutral";
  title: string;
  detail: string;
}) {
  return (
    <div className={`${styles.changeItem} ${styles[`changeItem${tone}`]}`}>
      <span>
        <Icon size={17} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function CrawlSettings() {
  const [saved, setSaved] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [externalLinks, setExternalLinks] = useState(false);
  const [respectRobots, setRespectRobots] = useState(true);

  const save = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <section className={styles.settingsPage} aria-labelledby="crawl-settings-heading">
      <div className={styles.sectionIntro}>
        <div>
          <h2 id="crawl-settings-heading">Crawl settings</h2>
          <p>Control how Searvia discovers, renders, and evaluates pages for this project.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={save}>
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? "Settings saved" : "Save changes"}
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <SettingsSection
          title="Crawl scope"
          description="Choose where the crawler starts and what it may follow."
        >
          <label className={styles.formField}>
            <span>Start URL</span>
            <input defaultValue="https://acme.software/" />
          </label>
          <div className={styles.formGrid}>
            <label className={styles.formField}>
              <span>Crawl limit</span>
              <div className={styles.inputSuffix}>
                <input type="number" defaultValue="5000" min="1" />
                <span>pages</span>
              </div>
            </label>
            <label className={styles.formField}>
              <span>Max crawl depth</span>
              <select defaultValue="10">
                <option>5</option>
                <option>10</option>
                <option>Unlimited</option>
              </select>
            </label>
          </div>
        </SettingsSection>
        <SettingsSection
          title="Crawler behavior"
          description="Tune rendering and discovery for this audit."
        >
          <ToggleSetting
            checked={rendering}
            onChange={setRendering}
            title="JavaScript rendering"
            detail="Render client-side content before rules run."
          />
          <ToggleSetting
            checked={respectRobots}
            onChange={setRespectRobots}
            title="Respect robots.txt"
            detail="Follow directives published by the site."
          />
          <ToggleSetting
            checked={externalLinks}
            onChange={setExternalLinks}
            title="Crawl external links"
            detail="Check linked domains for status codes only."
          />
        </SettingsSection>
        <SettingsSection
          title="URL rules"
          description="Exclude paths that should not consume crawl capacity."
        >
          <label className={styles.formField}>
            <span>Excluded path patterns</span>
            <textarea defaultValue={"/account/*\n/checkout/*\n?preview=*"} rows={4} />
            <small>One wildcard pattern per line.</small>
          </label>
        </SettingsSection>
      </form>
    </section>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className={styles.settingsSection}>
      <legend>{title}</legend>
      <p>{description}</p>
      <div className={styles.settingsFields}>{children}</div>
    </fieldset>
  );
}

function ToggleSetting({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className={styles.toggleSetting}>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.toggleTrack} aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

function InternalLinksView() {
  return (
    <AuditDataView
      icon={Link2}
      title="Internal links"
      description="Understand how authority and discovery flow through Acme Software."
      stats={[
        { label: "Internal links", value: "18,642", detail: "+416 this crawl" },
        { label: "Orphan pages", value: "19", detail: "3 new" },
        { label: "Avg. links per page", value: "14.9", detail: "+0.2" },
      ]}
    >
      <div className={styles.simpleList}>
        <SimpleRow label="Pages with no incoming links" value="19" tone="bad" />
        <SimpleRow label="Links pointing to redirects" value="82" tone="warn" />
        <SimpleRow label="Links pointing to 4XX pages" value="112" tone="bad" />
        <SimpleRow label="Pages more than 3 clicks deep" value="143" tone="neutral" />
      </div>
    </AuditDataView>
  );
}

function SitemapsView() {
  return (
    <AuditDataView
      icon={FileCode2}
      title="Sitemaps"
      description="Validate declared URLs and compare sitemap coverage with the crawl."
      stats={[
        { label: "Submitted URLs", value: "1,304", detail: "2 sitemap files" },
        { label: "Valid URLs", value: "1,238", detail: "94.9% valid" },
        { label: "Errors", value: "66", detail: "Needs review" },
      ]}
    >
      <div className={styles.sitemapRows}>
        <SimpleRow label="/sitemap.xml" value="1,248 URLs" tone="good" />
        <SimpleRow label="/blog-sitemap.xml" value="56 URLs" tone="warn" />
      </div>
    </AuditDataView>
  );
}

function PerformanceView() {
  return (
    <AuditDataView
      icon={Gauge}
      title="Performance"
      description="Review lab signals collected during rendered crawling."
      stats={[
        { label: "Fast pages", value: "74%", detail: "924 pages" },
        { label: "Needs improvement", value: "21%", detail: "262 pages" },
        { label: "Slow pages", value: "5%", detail: "62 pages" },
      ]}
    >
      <div className={styles.performanceMeters}>
        <PerformanceMeter label="Largest Contentful Paint" value="2.1s" width="71%" tone="good" />
        <PerformanceMeter label="Interaction to Next Paint" value="184ms" width="63%" tone="good" />
        <PerformanceMeter label="Cumulative Layout Shift" value="0.14" width="52%" tone="warn" />
      </div>
    </AuditDataView>
  );
}

function AuditDataView({
  icon: Icon,
  title,
  description,
  stats,
  children,
}: {
  icon: typeof Link2;
  title: string;
  description: string;
  stats: Array<{ label: string; value: string; detail: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.pagePanel} aria-labelledby={`${title.replace(" ", "-")}-heading`}>
      <div className={styles.sectionIntro}>
        <div>
          <span className={styles.sectionIcon}>
            <Icon size={18} />
          </span>
          <h2 id={`${title.replace(" ", "-")}-heading`}>{title}</h2>
          <p>{description}</p>
        </div>
        <button type="button" className={styles.secondaryButton}>
          <Download size={16} />
          Export
        </button>
      </div>
      <div className={styles.dataStats}>
        {stats.map((stat) => (
          <div key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small>{stat.detail}</small>
          </div>
        ))}
      </div>
      <div className={styles.dataBody}>{children}</div>
    </section>
  );
}

function SimpleRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "warn" | "neutral";
}) {
  const Icon =
    tone === "good"
      ? CheckCircle2
      : tone === "bad"
        ? AlertCircle
        : tone === "warn"
          ? AlertTriangle
          : Info;
  return (
    <div className={styles.simpleRow}>
      <span>
        <Icon size={16} className={styles[`tone${tone}`]} />
        {label}
      </span>
      <strong>{value}</strong>
      <button type="button" aria-label={`View ${label}`}>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

function PerformanceMeter({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: string;
  width: string;
  tone: "good" | "warn";
}) {
  return (
    <div className={styles.performanceMeter}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div>
        <span className={tone === "good" ? styles.meterGood : styles.meterWarn} style={{ width }} />
      </div>
    </div>
  );
}

function IssueDetailDrawer({ issue, onClose }: { issue: Issue | null; onClose: () => void }) {
  return (
    <Drawer
      open={Boolean(issue)}
      onClose={onClose}
      title={issue?.title ?? "Issue detail"}
      {...(issue?.id ? { eyebrow: issue.id } : {})}
    >
      {issue ? (
        <>
          <div className={styles.drawerBadges}>
            <SeverityLabel severity={issue.severity} />
            <span className={styles.lifecycleLabel}>{issue.lifecycle}</span>
          </div>
          <DrawerSection title="Why this matters">
            <p>{issue.description}</p>
          </DrawerSection>
          <div className={styles.drawerStats}>
            <div>
              <span>Affected URLs</span>
              <strong>{issue.affected}</strong>
            </div>
            <div>
              <span>Change</span>
              <strong className={issue.change < 0 ? styles.textGood : styles.textDanger}>
                {issue.change > 0 ? "+" : ""}
                {issue.change}
              </strong>
            </div>
            <div>
              <span>Owner</span>
              <strong>{issue.owner}</strong>
            </div>
          </div>
          <DrawerSection title="Recommended fix">
            <div className={styles.recommendation}>
              <Zap size={17} />
              <p>{issue.recommendation}</p>
            </div>
          </DrawerSection>
          <DrawerSection title="Example URLs">
            <div className={styles.urlList}>
              {issue.examples.map((url) => (
                <button type="button" key={url}>
                  <span>{url}</span>
                  <ExternalLink size={14} />
                </button>
              ))}
            </div>
          </DrawerSection>
          <div className={styles.drawerFooter}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>
              Close
            </button>
            <button type="button" className={styles.primaryButton}>
              <CheckCircle2 size={16} />
              Mark in progress
            </button>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

function PageDetailDrawer({ page, onClose }: { page: CrawledPage | null; onClose: () => void }) {
  return (
    <Drawer
      open={Boolean(page)}
      onClose={onClose}
      title={page?.title ?? "Page detail"}
      eyebrow="Crawled page"
    >
      {page ? (
        <>
          <div className={styles.pageDrawerUrl}>
            <Globe2 size={16} />
            <span>{page.url}</span>
            <button type="button" aria-label="Open page">
              <ExternalLink size={14} />
            </button>
          </div>
          <div className={styles.drawerStats}>
            <div>
              <span>Status</span>
              <strong className={page.status >= 400 ? styles.textDanger : styles.textGood}>
                {page.status}
              </strong>
            </div>
            <div>
              <span>Health</span>
              <strong>{page.health}/100</strong>
            </div>
            <div>
              <span>Issues</span>
              <strong>{page.issues}</strong>
            </div>
          </div>
          <DrawerSection title="Crawl details">
            <dl className={styles.detailList}>
              <div>
                <dt>Indexable</dt>
                <dd>{page.indexable ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Depth</dt>
                <dd>{page.depth}</dd>
              </div>
              <div>
                <dt>Load time</dt>
                <dd>{page.loadTime}</dd>
              </div>
              <div>
                <dt>Word count</dt>
                <dd>{page.words.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Last crawled</dt>
                <dd>{page.lastCrawled}</dd>
              </div>
            </dl>
          </DrawerSection>
          <DrawerSection title="Canonical">
            <div className={styles.codeValue}>{page.canonical}</div>
          </DrawerSection>
          <DrawerSection title="Signals">
            <div className={styles.signalList}>
              <span>
                <CheckCircle2 size={15} />
                HTTPS detected
              </span>
              <span>
                <CheckCircle2 size={15} />
                Viewport configured
              </span>
              <span className={page.issues ? styles.signalWarn : ""}>
                {page.issues ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                {page.issues ? `${page.issues} issues require review` : "No issues detected"}
              </span>
            </div>
          </DrawerSection>
          <div className={styles.drawerFooter}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>
              Close
            </button>
            <button type="button" className={styles.primaryButton}>
              <ExternalLink size={16} />
              Open live page
            </button>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${styles.drawerLayer} ${open ? styles.drawerLayerOpen : ""}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={styles.drawerScrim}
        aria-label="Close details"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <aside className={styles.detailDrawer} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.drawerHeader}>
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </div>
        <div className={styles.drawerContent}>{children}</div>
      </aside>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.drawerSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
