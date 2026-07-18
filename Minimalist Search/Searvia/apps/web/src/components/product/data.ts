export type AuditView =
  | "overview"
  | "issues"
  | "crawled-pages"
  | "internal-links"
  | "sitemaps"
  | "performance"
  | "compare-crawls"
  | "crawl-settings";

export type MainView =
  | AuditView
  | "workspace"
  | "keywords"
  | "competitors"
  | "backlinks"
  | "ai-visibility"
  | "content"
  | "reports"
  | "integrations"
  | "team"
  | "billing"
  | "settings";

export type IssueSeverity = "Critical" | "Warning" | "Notice";
export type IssueStatus = "Open" | "In progress" | "Resolved";

export type Issue = {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: string;
  affected: number;
  change: number;
  owner: string;
  initials: string;
  status: IssueStatus;
  rule: string;
  lifecycle: "New" | "Recurring" | "Improved";
  description: string;
  recommendation: string;
  examples: string[];
};

export type CrawledPage = {
  url: string;
  title: string;
  status: number;
  health: number;
  issues: number;
  depth: number;
  loadTime: string;
  lastCrawled: string;
  indexable: boolean;
  canonical: string;
  words: number;
};

export const auditSubnav: Array<{ id: AuditView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "issues", label: "Issues" },
  { id: "crawled-pages", label: "Crawled Pages" },
  { id: "internal-links", label: "Internal Links" },
  { id: "sitemaps", label: "Sitemaps" },
  { id: "performance", label: "Performance" },
  { id: "compare-crawls", label: "Compare Crawls" },
  { id: "crawl-settings", label: "Crawl Settings" },
];

export const issues: Issue[] = [
  {
    id: "ISSUE-4XX-001",
    title: "4XX page",
    severity: "Critical",
    category: "Crawlability",
    affected: 112,
    change: 12,
    owner: "Maya J.",
    initials: "MJ",
    status: "Open",
    rule: "HTTP status",
    lifecycle: "Recurring",
    description:
      "These URLs return a client error, blocking visitors and crawlers from reaching the intended content.",
    recommendation:
      "Restore pages that should exist, redirect retired URLs to the closest relevant destination, and update every internal link that points to an error.",
    examples: [
      "/resources/seo-checklist",
      "/pricing/enterprise-old",
      "/blog/search-visibility-2024",
    ],
  },
  {
    id: "ISSUE-TITLE-002",
    title: "Title missing",
    severity: "Critical",
    category: "Content",
    affected: 85,
    change: -5,
    owner: "Devon S.",
    initials: "DS",
    status: "Open",
    rule: "Page title",
    lifecycle: "Improved",
    description:
      "Pages without a title give search engines and visitors less context about the page topic.",
    recommendation:
      "Add a concise, unique title that describes the page and reflects the primary search intent.",
    examples: ["/customers", "/docs/api/authentication", "/solutions/agencies"],
  },
  {
    id: "ISSUE-META-003",
    title: "Meta description too long",
    severity: "Warning",
    category: "Content",
    affected: 241,
    change: 18,
    owner: "Chloe L.",
    initials: "CL",
    status: "In progress",
    rule: "Meta description",
    lifecycle: "New",
    description:
      "Long descriptions may be truncated in search results and can weaken the clarity of the snippet.",
    recommendation:
      "Keep important context near the beginning and rewrite descriptions to be distinct, useful, and concise.",
    examples: ["/platform/audits", "/compare/searvia-vs-legacy", "/guides/technical-seo"],
  },
  {
    id: "ISSUE-CANON-004",
    title: "Canonical to 4XX",
    severity: "Critical",
    category: "Indexability",
    affected: 28,
    change: 4,
    owner: "Maya J.",
    initials: "MJ",
    status: "Open",
    rule: "Canonical",
    lifecycle: "Recurring",
    description:
      "The declared canonical destination returns a client error, leaving the preferred page unclear.",
    recommendation:
      "Point the canonical tag to a live, indexable 200-status URL or remove it when the page should self-canonicalize.",
    examples: ["/blog/ai-search", "/product/rank-tracking", "/partners"],
  },
  {
    id: "ISSUE-H1-005",
    title: "H1 duplicate",
    severity: "Warning",
    category: "Content",
    affected: 66,
    change: 6,
    owner: "Devon S.",
    initials: "DS",
    status: "Open",
    rule: "Headings",
    lifecycle: "New",
    description:
      "Multiple pages use the same primary heading, making their individual purpose harder to distinguish.",
    recommendation:
      "Give each page one descriptive H1 that matches its unique topic and the visitor’s expected destination.",
    examples: ["/industries/saas", "/industries/marketplaces", "/industries/fintech"],
  },
  {
    id: "ISSUE-IMG-006",
    title: "Image alt text missing",
    severity: "Warning",
    category: "Accessibility",
    affected: 54,
    change: -9,
    owner: "Chloe L.",
    initials: "CL",
    status: "In progress",
    rule: "Image markup",
    lifecycle: "Improved",
    description:
      "Meaningful images are missing alternative text, limiting context for assistive technology and image search.",
    recommendation:
      "Add short, contextual alt text to informative images and use an empty alt attribute for decorative images.",
    examples: ["/about", "/customers/northstar", "/features/ai-visibility"],
  },
  {
    id: "ISSUE-REDIR-007",
    title: "Redirect chain",
    severity: "Notice",
    category: "Crawlability",
    affected: 31,
    change: -2,
    owner: "Maya J.",
    initials: "MJ",
    status: "Open",
    rule: "Redirects",
    lifecycle: "Improved",
    description:
      "These URLs pass through more than one redirect before reaching their final destination.",
    recommendation:
      "Update links and redirects to point directly to the final live URL whenever possible.",
    examples: ["/login", "/docs", "/blog/category/product"],
  },
  {
    id: "ISSUE-LINK-008",
    title: "Orphan page",
    severity: "Notice",
    category: "Internal links",
    affected: 19,
    change: 3,
    owner: "Devon S.",
    initials: "DS",
    status: "Resolved",
    rule: "Link graph",
    lifecycle: "Recurring",
    description:
      "These discovered URLs receive no crawlable internal links from the rest of the site.",
    recommendation:
      "Add contextual internal links from relevant pages or remove the URL from the sitemap when it should not be found.",
    examples: ["/glossary/crawl-budget", "/events/search-summit", "/templates/audit-brief"],
  },
];

export const crawledPages: CrawledPage[] = [
  {
    url: "https://acme.software/",
    title: "Acme Software — Ship clearer work",
    status: 200,
    health: 98,
    issues: 0,
    depth: 0,
    loadTime: "0.82s",
    lastCrawled: "08:15 AM",
    indexable: true,
    canonical: "https://acme.software/",
    words: 742,
  },
  {
    url: "https://acme.software/platform",
    title: "The Acme platform",
    status: 200,
    health: 91,
    issues: 2,
    depth: 1,
    loadTime: "1.14s",
    lastCrawled: "08:16 AM",
    indexable: true,
    canonical: "https://acme.software/platform",
    words: 1184,
  },
  {
    url: "https://acme.software/pricing",
    title: "Simple pricing for every team",
    status: 200,
    health: 86,
    issues: 3,
    depth: 1,
    loadTime: "1.31s",
    lastCrawled: "08:16 AM",
    indexable: true,
    canonical: "https://acme.software/pricing",
    words: 866,
  },
  {
    url: "https://acme.software/resources/seo-checklist",
    title: "Page not found",
    status: 404,
    health: 28,
    issues: 4,
    depth: 3,
    loadTime: "0.44s",
    lastCrawled: "08:18 AM",
    indexable: false,
    canonical: "—",
    words: 71,
  },
  {
    url: "https://acme.software/blog/ai-search",
    title: "How AI search changes discovery",
    status: 200,
    health: 72,
    issues: 5,
    depth: 2,
    loadTime: "2.08s",
    lastCrawled: "08:19 AM",
    indexable: true,
    canonical: "https://acme.software/blog/ai-search-old",
    words: 1934,
  },
  {
    url: "https://acme.software/docs/api",
    title: "Acme API documentation",
    status: 200,
    health: 94,
    issues: 1,
    depth: 2,
    loadTime: "0.95s",
    lastCrawled: "08:20 AM",
    indexable: true,
    canonical: "https://acme.software/docs/api",
    words: 2550,
  },
];

export const auditHistory = [
  { date: "Apr 21 – Apr 27", health: 76, issues: 601 },
  { date: "Apr 28 – May 4", health: 79, issues: 566 },
  { date: "May 5 – May 11", health: 78, issues: 560 },
  { date: "May 12 – May 18", health: 82, issues: 532 },
];

export const integrationContent = {
  keywords: {
    title: "Keywords",
    eyebrow: "Searvia Keywords",
    description:
      "Connect search performance data to discover terms, group intent, and monitor the queries that lead people to your brand.",
    source: "Google Search Console",
  },
  competitors: {
    title: "Competitors",
    eyebrow: "Searvia Competitors",
    description:
      "Add verified competitors to compare visibility, shared keywords, content coverage, and search movement over time.",
    source: "Search intelligence provider",
  },
  backlinks: {
    title: "Backlinks",
    eyebrow: "Searvia Links",
    description:
      "Connect a backlink index to monitor new and lost links, referring domains, anchor text, and authority signals.",
    source: "Backlink data provider",
  },
  "ai-visibility": {
    title: "AI Visibility",
    eyebrow: "Searvia AI",
    description:
      "Connect an AI monitoring provider to measure brand mentions and citations across supported answer engines.",
    source: "AI visibility provider",
  },
} as const;
