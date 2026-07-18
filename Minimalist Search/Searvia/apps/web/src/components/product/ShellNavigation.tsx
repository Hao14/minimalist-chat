import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Bot,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  CreditCard,
  Database,
  FileChartColumn,
  FileText,
  KeyRound,
  LayoutDashboard,
  Link2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plug2,
  ScanSearch,
  Search,
  Settings,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { auditSubnav, type MainView } from "./data";
import styles from "./searvia-product.module.css";

type NavigationProps = {
  activeView: MainView;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onNavigate: (view: MainView) => void;
  onToggleCollapsed: () => void;
};

type PrimaryNavigationItem = {
  id: MainView;
  label: string;
  icon: LucideIcon;
};

const overviewItem: PrimaryNavigationItem = {
  id: "workspace",
  label: "Overview",
  icon: LayoutDashboard,
};

const primaryItems: PrimaryNavigationItem[] = [
  overviewItem,
  { id: "keywords", label: "Keywords", icon: KeyRound },
  { id: "competitors", label: "Competitors", icon: UsersRound },
  { id: "backlinks", label: "Backlinks", icon: Link2 },
  { id: "ai-visibility", label: "AI Visibility", icon: Bot },
  { id: "content", label: "Content", icon: FileText },
  { id: "reports", label: "Reports", icon: FileChartColumn },
  { id: "integrations", label: "Integrations", icon: Plug2 },
  { id: "team", label: "Team", icon: UsersRound },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "settings", label: "Settings", icon: Settings },
];

const auditViews = new Set(auditSubnav.map((item) => item.id));

export function ProductSidebar({
  activeView,
  collapsed,
  mobileOpen,
  onCloseMobile,
  onNavigate,
  onToggleCollapsed,
}: NavigationProps) {
  const auditOpen = auditViews.has(activeView as (typeof auditSubnav)[number]["id"]);

  const navigate = (view: MainView) => {
    onNavigate(view);
    onCloseMobile();
  };

  return (
    <>
      <button
        className={`${styles.mobileScrim} ${mobileOpen ? styles.mobileScrimVisible : ""}`}
        type="button"
        aria-label="Close navigation"
        onClick={onCloseMobile}
      />
      <aside
        className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""} ${
          mobileOpen ? styles.sidebarMobileOpen : ""
        }`}
        aria-label="Primary navigation"
      >
        <div className={styles.brandRow}>
          <button
            type="button"
            className={styles.wordmarkButton}
            aria-label="Open Searvia overview"
            onClick={() => navigate("workspace")}
          >
            <span className={styles.brandMark} aria-hidden="true">
              s
            </span>
            <span className={styles.wordmark}>searvia</span>
          </button>
          <button
            type="button"
            className={styles.mobileClose}
            aria-label="Close navigation"
            onClick={onCloseMobile}
          >
            <X size={18} />
          </button>
        </div>

        <nav className={styles.navScroll}>
          <NavigationButton
            item={overviewItem}
            active={activeView === "workspace"}
            collapsed={collapsed}
            onClick={() => navigate("workspace")}
          />

          <button
            type="button"
            className={`${styles.navItem} ${auditOpen ? styles.navItemParentActive : ""}`}
            aria-current={auditOpen ? "page" : undefined}
            onClick={() => navigate("overview")}
            title={collapsed ? "Site Audit" : undefined}
          >
            <ScanSearch size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Site Audit</span>
            <span className={styles.navChevron} aria-hidden="true">
              {auditOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>

          {auditOpen && !collapsed ? (
            <div className={styles.subnav} aria-label="Site Audit sections">
              {auditSubnav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.subnavItem} ${activeView === item.id ? styles.subnavItemActive : ""}`}
                  aria-current={activeView === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.navDivider} />
          {primaryItems.slice(1, 7).map((item) => (
            <NavigationButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              collapsed={collapsed}
              onClick={() => navigate(item.id)}
            />
          ))}
          <div className={styles.navDivider} />
          {primaryItems.slice(7).map((item) => (
            <NavigationButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              collapsed={collapsed}
              onClick={() => navigate(item.id)}
            />
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          {!collapsed ? (
            <div className={styles.demoCard}>
              <div className={styles.demoCardTitle}>
                <Database size={16} aria-hidden="true" />
                <strong>Demo data</strong>
              </div>
              <p>This is sample data for demonstration.</p>
            </div>
          ) : (
            <div className={styles.demoDot} title="Demo data">
              <Database size={17} aria-hidden="true" />
              <span className={styles.srOnly}>Demo data</span>
            </div>
          )}
          <button
            type="button"
            className={styles.collapseButton}
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span className={styles.navLabel}>{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function NavigationButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: (typeof primaryItems)[number];
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
    >
      <Icon size={18} aria-hidden="true" />
      <span className={styles.navLabel}>{item.label}</span>
    </button>
  );
}

export function ProductTopbar({
  onOpenMobile,
  onOpenCommand,
}: {
  onOpenMobile: () => void;
  onOpenCommand: () => void;
}) {
  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.mobileMenu}
        aria-label="Open navigation"
        onClick={onOpenMobile}
      >
        <Menu size={20} />
      </button>
      <button type="button" className={styles.workspaceSwitch} aria-label="Switch workspace">
        <span className={styles.workspaceAvatar}>A</span>
        <span className={styles.workspaceName}>Acme Software</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button type="button" className={styles.commandButton} onClick={onOpenCommand}>
        <Search size={18} aria-hidden="true" />
        <span>Search anything...</span>
        <kbd>⌘ K</kbd>
      </button>
      <div className={styles.topbarActions}>
        <button type="button" className={styles.topbarIcon} aria-label="Notifications">
          <Bell size={19} />
          <span className={styles.notificationCount}>3</span>
        </button>
        <button type="button" className={styles.topbarIcon} aria-label="Help and support">
          <CircleHelp size={19} />
        </button>
        <button type="button" className={styles.profileButton} aria-label="Open account menu">
          <span>AK</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: MainView) => void;
}) {
  if (!open) return null;

  const shortcuts: Array<{ label: string; detail: string; view: MainView; icon: LucideIcon }> = [
    {
      label: "Site Audit overview",
      detail: "Open current crawl",
      view: "overview",
      icon: ScanSearch,
    },
    { label: "Crawled pages", detail: "Inspect a URL", view: "crawled-pages", icon: FileText },
    {
      label: "AI Visibility",
      detail: "Integration required",
      view: "ai-visibility",
      icon: Sparkles,
    },
  ];

  return (
    <div className={styles.modalLayer} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.commandPalette}
        role="dialog"
        aria-modal="true"
        aria-label="Search Searvia"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.commandInput}>
          <Search size={19} aria-hidden="true" />
          <input autoFocus aria-label="Search Searvia" placeholder="Search pages and actions..." />
          <button type="button" aria-label="Close search" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <p className={styles.commandHeading}>Quick access</p>
        <div className={styles.commandResults}>
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <button
                key={shortcut.view}
                type="button"
                onClick={() => {
                  onNavigate(shortcut.view);
                  onClose();
                }}
              >
                <span className={styles.commandResultIcon}>
                  <Icon size={17} />
                </span>
                <span>
                  <strong>{shortcut.label}</strong>
                  <small>{shortcut.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
