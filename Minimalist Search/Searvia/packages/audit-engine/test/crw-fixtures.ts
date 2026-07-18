import { createHash } from "node:crypto";

import type {
  AuditCrawlSnapshot,
  AuditPageExtraction,
  AuditPageLink,
  AuditPageObservation,
  AuditRobotsObservation,
  AuditSitemapObservation,
} from "../src/snapshot.js";

const STARTED_AT = "2026-07-16T10:00:00.000Z";
const OBSERVED_AT = "2026-07-16T10:01:00.000Z";
const FINISHED_AT = "2026-07-16T10:02:00.000Z";
const ORIGIN = "https://example.test";

export type CrwRuleId =
  | "CRW-001"
  | "CRW-002"
  | "CRW-003"
  | "CRW-004"
  | "CRW-005"
  | "CRW-006"
  | "CRW-007"
  | "CRW-008"
  | "CRW-009"
  | "CRW-010"
  | "CRW-011"
  | "CRW-012"
  | "CRW-013"
  | "CRW-014"
  | "CRW-015";

export interface CrwRuleFixtureSet {
  readonly passing: AuditCrawlSnapshot;
  readonly failing: AuditCrawlSnapshot;
  readonly boundary: AuditCrawlSnapshot;
}

function extraction(overrides: Partial<AuditPageExtraction> = {}): AuditPageExtraction {
  return Object.freeze({
    id: "extraction-1",
    source: "raw",
    status: "succeeded",
    title: "Example page",
    documentMetadataComplete: true,
    titleTagCount: 1,
    metaDescription: "A useful example description for deterministic fixture coverage.",
    metaDescriptionTagCount: 1,
    metaRobots: [],
    xRobotsTag: [],
    canonicalUrl: null,
    canonicalTagCount: 0,
    canonicalNormalizationFailure: null,
    visibleText:
      "This is a complete example page with useful public information for visitors and crawlers.",
    visibleTextComplete: true,
    wordCount: 14,
    headings: [{ id: "heading-1", level: 1, ordinal: 0, text: "Example page" }],
    headingsComplete: true,
    htmlLanguage: "en",
    characterEncoding: {
      used: "utf-8",
      declared: "utf-8",
      source: "http_header",
      declarationOffsetBytes: null,
    },
    viewportDeclarations: ["width=device-width, initial-scale=1"],
    htmlDoctypePresent: true,
    openGraph: {},
    socialCards: {},
    iconDeclarationCount: 1,
    contentHash: "a".repeat(64),
    domHash: "b".repeat(64),
    similarityFingerprint: "0123456789abcdef",
    meaningfulContent: true,
    clientRendered: false,
    directiveScopePreserved: true,
    linksComplete: true,
    extractedAt: OBSERVED_AT,
    ...overrides,
  });
}

function page(overrides: Partial<AuditPageObservation> = {}): AuditPageObservation {
  const id = overrides.id ?? "page-1";
  const normalizedUrl = overrides.normalizedUrl ?? `${ORIGIN}/${id}`;
  return Object.freeze({
    id,
    requestedUrl: normalizedUrl,
    normalizedUrl,
    urlHash: createHash("sha256").update(normalizedUrl).digest("hex"),
    finalUrl: normalizedUrl,
    statusCode: 200,
    contentType: "text/html",
    contentLength: 1_024,
    responseBytes: 1_024,
    transferSize: 512,
    compression: "gzip",
    responseHeaders: {},
    securityHeaders: {},
    depth: 1,
    redirectChain: [],
    robotsDecision: "allowed",
    errorType: null,
    errorMessage: null,
    discoverySource: "link",
    observedAt: OBSERVED_AT,
    extraction: extraction({ id: `extraction-${id}` }),
    renderedExtraction: null,
    links: [],
    resources: [],
    importance: "standard",
    indexabilityIntent: "intended",
    ...overrides,
  });
}

function link(target: AuditPageObservation, overrides: Partial<AuditPageLink> = {}): AuditPageLink {
  return Object.freeze({
    id: `link-to-${target.id}`,
    targetPageId: target.id,
    targetUrl: target.normalizedUrl,
    normalizedTargetUrl: target.normalizedUrl,
    scope: "internal",
    anchorText: "Example link",
    relValues: [],
    linkType: "anchor",
    discovered: true,
    crawlDepth: target.depth,
    discoverySource: "link",
    ordinal: 0,
    ...overrides,
  });
}

function sitemap(overrides: Partial<AuditSitemapObservation> = {}): AuditSitemapObservation {
  const normalizedUrl = overrides.normalizedUrl ?? `${ORIGIN}/sitemap.xml`;
  return Object.freeze({
    id: "sitemap-1",
    requestedUrl: `${ORIGIN}/sitemap.xml`,
    normalizedUrl,
    urlHash: createHash("sha256").update(normalizedUrl).digest("hex"),
    finalUrl: `${ORIGIN}/sitemap.xml`,
    source: "default",
    status: "parsed",
    robotsDecision: "allowed",
    robotsObservationId: "robots-1",
    robotsResult: "fetched",
    format: "urlset",
    statusCode: 200,
    contentLength: 256,
    transferSize: 256,
    depth: 0,
    redirectChain: [],
    parseIssues: [],
    errorType: null,
    errorMessage: null,
    observedAt: OBSERVED_AT,
    entries: [],
    ...overrides,
  });
}

function robots(overrides: Partial<AuditRobotsObservation> = {}): AuditRobotsObservation {
  return Object.freeze({
    id: "robots-1",
    origin: ORIGIN,
    requestedUrl: `${ORIGIN}/robots.txt`,
    finalUrl: `${ORIGIN}/robots.txt`,
    statusCode: 200,
    result: "fetched",
    userAgent: "SearviaBot",
    content: "User-agent: SearviaBot\nAllow: /",
    sitemapUrls: [],
    fetchedAt: OBSERVED_AT,
    ...overrides,
  });
}

function snapshot(overrides: Partial<AuditCrawlSnapshot> = {}): AuditCrawlSnapshot {
  return Object.freeze({
    organizationId: "organization-1",
    projectId: "project-1",
    crawlId: "crawl-1",
    origin: ORIGIN,
    status: "completed",
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    errorType: null,
    configuration: Object.freeze({
      maxDepth: 5,
      redirectLimit: 5,
      maxResponseBytes: 2_000_000,
      queryPolicy: "ignore_tracking",
    }),
    pages: [],
    robots: [],
    sitemaps: [],
    historicalRedirects: [],
    historicalRedirectCoverage: {
      complete: true,
      truncated: false,
      pageObservationLimit: 10_000,
      loadedPageObservationCount: 0,
      loadedCrawlCount: 0,
    },
    ...overrides,
  });
}

function seed(overrides: Partial<AuditPageObservation> = {}): AuditPageObservation {
  return page({
    id: "homepage",
    requestedUrl: `${ORIGIN}/`,
    normalizedUrl: `${ORIGIN}/`,
    finalUrl: `${ORIGIN}/`,
    depth: 0,
    discoverySource: "seed",
    importance: "homepage",
    ...overrides,
  });
}

function linkedTargetSnapshot(targetOverrides: Partial<AuditPageObservation>): AuditCrawlSnapshot {
  const target = page({ id: "target", normalizedUrl: `${ORIGIN}/target`, ...targetOverrides });
  const source = seed({ links: [link(target)] });
  return snapshot({ pages: [source, target] });
}

function directiveSnapshot(
  extractionOverrides: Partial<AuditPageExtraction>,
  pageOverrides: Partial<AuditPageObservation> = {},
): AuditCrawlSnapshot {
  return snapshot({
    pages: [
      page({
        id: "directive-page",
        normalizedUrl: `${ORIGIN}/directive-page`,
        extraction: extraction({ id: "directive-extraction", ...extractionOverrides }),
        ...pageOverrides,
      }),
    ],
  });
}

function queryVariantSnapshot(count: number, status: AuditCrawlSnapshot["status"] = "completed") {
  return snapshot({
    status,
    pages: Array.from({ length: count }, (_, index) =>
      page({
        id: `variant-${index}`,
        normalizedUrl: `${ORIGIN}/products?page=${index + 1}`,
      }),
    ),
  });
}

const crw001: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({ pages: [seed()] }),
  failing: snapshot({
    pages: [
      seed({
        finalUrl: null,
        statusCode: null,
        contentType: null,
        errorType: "dns_failure",
        errorMessage: "The hostname did not resolve.",
        extraction: null,
      }),
    ],
  }),
  boundary: snapshot(),
});

const crw002: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({ pages: [seed()] }),
  failing: snapshot({ pages: [seed({ statusCode: 503 })] }),
  boundary: snapshot(),
});

const crw003: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({ pages: [page()] }),
  failing: snapshot({
    pages: [
      page({
        finalUrl: null,
        statusCode: null,
        contentType: null,
        errorType: "request_timeout",
        errorMessage: "The request timed out.",
        extraction: null,
      }),
    ],
  }),
  boundary: snapshot({
    pages: [
      page({
        finalUrl: null,
        statusCode: null,
        contentType: null,
        errorType: null,
        extraction: null,
      }),
    ],
  }),
});

const crw004: CrwRuleFixtureSet = Object.freeze({
  passing: linkedTargetSnapshot({ statusCode: 200 }),
  failing: linkedTargetSnapshot({ statusCode: 404 }),
  boundary: linkedTargetSnapshot({
    finalUrl: null,
    statusCode: null,
    contentType: null,
    errorType: "network_error",
    extraction: null,
  }),
});

const crw005: CrwRuleFixtureSet = Object.freeze({
  passing: linkedTargetSnapshot({ statusCode: 200 }),
  failing: linkedTargetSnapshot({ statusCode: 503 }),
  boundary: linkedTargetSnapshot({
    finalUrl: null,
    statusCode: null,
    contentType: null,
    errorType: "network_error",
    extraction: null,
  }),
});

const crw006: CrwRuleFixtureSet = Object.freeze({
  passing: directiveSnapshot({
    title: "Contact our support team",
    visibleText: "Contact our support team for product assistance and account questions.",
    wordCount: 11,
  }),
  failing: directiveSnapshot({
    title: "Page not found | Example",
    visibleText: "Page not found. The requested page does not exist.",
    wordCount: 9,
  }),
  boundary: snapshot({
    pages: [page({ id: "soft-404-boundary", extraction: null })],
  }),
});

const crw007: CrwRuleFixtureSet = Object.freeze({
  passing: directiveSnapshot({ metaRobots: ["index", "follow"] }),
  failing: directiveSnapshot({ metaRobots: ["noindex", "follow"] }),
  boundary: directiveSnapshot({}, { indexabilityIntent: "unknown" }),
});

const crw008: CrwRuleFixtureSet = Object.freeze({
  passing: directiveSnapshot({ xRobotsTag: ["index", "follow"] }),
  failing: directiveSnapshot({ xRobotsTag: ["noindex", "follow"] }),
  boundary: directiveSnapshot({}, { indexabilityIntent: "unknown" }),
});

const crw009: CrwRuleFixtureSet = Object.freeze({
  passing: directiveSnapshot({ metaRobots: ["index"], xRobotsTag: ["index"] }),
  failing: directiveSnapshot({ metaRobots: ["index", "follow"], xRobotsTag: ["noindex"] }),
  boundary: snapshot({ pages: [page({ id: "directive-boundary", extraction: null })] }),
});

const crw010: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({
    pages: [
      page({
        importance: "important",
        robotsDecision: "allowed",
        robotsObservationId: "robots-1",
        robotsResult: "fetched",
      }),
    ],
    robots: [robots()],
  }),
  failing: snapshot({
    pages: [
      page({
        importance: "important",
        robotsDecision: "disallowed",
        robotsObservationId: "robots-1",
        robotsResult: "fetched",
        statusCode: null,
        finalUrl: null,
        extraction: null,
        errorType: "robots_disallowed",
      }),
    ],
    robots: [robots({ content: "User-agent: SearviaBot\nDisallow: /page-1" })],
  }),
  boundary: snapshot({ pages: [page({ importance: "standard" })] }),
});

const crw011: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({ robots: [robots()], sitemaps: [sitemap()] }),
  failing: snapshot({
    robots: [robots({ content: "User-agent: SearviaBot\nDisallow: /sitemap.xml" })],
    sitemaps: [
      sitemap({
        finalUrl: null,
        status: "failed",
        statusCode: null,
        robotsDecision: "disallowed",
        robotsObservationId: "robots-1",
        robotsResult: "fetched",
        errorType: "robots_disallowed",
        errorMessage: "The sitemap is disallowed by robots.txt.",
      }),
    ],
  }),
  boundary: snapshot(),
});

const orphanTarget = page({
  id: "orphan-target",
  normalizedUrl: `${ORIGIN}/orphan-target`,
  discoverySource: "sitemap",
});
const orphanSitemap = sitemap({
  entries: [
    Object.freeze({
      id: "sitemap-entry-orphan",
      entryType: "url",
      loc: orphanTarget.normalizedUrl,
      normalizedLoc: orphanTarget.normalizedUrl,
      targetPageId: orphanTarget.id,
    }),
  ],
});
const linkedOrphanSource = seed({ links: [link(orphanTarget)] });

const crw012: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({
    pages: [linkedOrphanSource, orphanTarget],
    sitemaps: [orphanSitemap],
  }),
  failing: snapshot({ pages: [seed(), orphanTarget], sitemaps: [orphanSitemap] }),
  boundary: snapshot({
    status: "partially_completed",
    pages: [seed(), orphanTarget],
    sitemaps: [orphanSitemap],
  }),
});

const crw013: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({ pages: [page({ importance: "important", depth: 2 })] }),
  failing: snapshot({ pages: [page({ importance: "important", depth: 4 })] }),
  boundary: snapshot({ pages: [page({ importance: "standard", discoverySource: "link" })] }),
});

const crw014: CrwRuleFixtureSet = Object.freeze({
  passing: queryVariantSnapshot(3),
  failing: queryVariantSnapshot(10),
  boundary: queryVariantSnapshot(3, "partially_completed"),
});

const crw015: CrwRuleFixtureSet = Object.freeze({
  passing: snapshot({
    pages: [page({ id: "about", normalizedUrl: `${ORIGIN}/about`, contentType: "text/html" })],
  }),
  failing: snapshot({
    pages: [
      page({
        id: "feed",
        normalizedUrl: `${ORIGIN}/feed`,
        contentType: "application/json",
        extraction: null,
        errorType: "unsupported_content_type",
      }),
    ],
  }),
  boundary: snapshot({
    pages: [
      page({
        id: "data",
        normalizedUrl: `${ORIGIN}/data`,
        contentType: null,
        extraction: null,
      }),
    ],
  }),
});

export const CRW_RULE_FIXTURES = Object.freeze({
  "CRW-001": crw001,
  "CRW-002": crw002,
  "CRW-003": crw003,
  "CRW-004": crw004,
  "CRW-005": crw005,
  "CRW-006": crw006,
  "CRW-007": crw007,
  "CRW-008": crw008,
  "CRW-009": crw009,
  "CRW-010": crw010,
  "CRW-011": crw011,
  "CRW-012": crw012,
  "CRW-013": crw013,
  "CRW-014": crw014,
  "CRW-015": crw015,
} satisfies Readonly<Record<CrwRuleId, CrwRuleFixtureSet>>);
