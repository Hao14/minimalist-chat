import { createHash } from "node:crypto";

import type {
  AuditCrawlSnapshot,
  AuditPageExtraction,
  AuditPageObservation,
  AuditRedirectHop,
  AuditRobotsObservation,
  AuditSitemapObservation,
  HistoricalRedirectObservation,
} from "../src/index.js";

export const OBSERVED_AT = "2026-07-16T12:00:00.000Z";
const HASH_A = "a".repeat(64);

export function extraction(overrides: Partial<AuditPageExtraction> = {}): AuditPageExtraction {
  return Object.freeze({
    id: "extract-home",
    source: "raw",
    status: "succeeded",
    title: "Example home",
    documentMetadataComplete: true,
    titleTagCount: 1,
    metaDescription: "A complete example description with enough detail for deterministic checks.",
    metaDescriptionTagCount: 1,
    metaRobots: Object.freeze(["index", "follow"]),
    xRobotsTag: Object.freeze([]),
    canonicalUrl: "https://example.com/",
    canonicalTagCount: 1,
    canonicalNormalizationFailure: null,
    metaRefreshUrl: null,
    javascriptRedirectUrl: null,
    visibleText: "A useful example page with enough meaningful content for deterministic checks.",
    visibleTextComplete: true,
    wordCount: 120,
    headings: Object.freeze([
      Object.freeze({ id: "heading-home", level: 1, ordinal: 0, text: "Example home" }),
    ]),
    headingsComplete: true,
    htmlLanguage: "en",
    characterEncoding: Object.freeze({
      used: "utf-8",
      declared: "utf-8",
      source: "meta",
      declarationOffsetBytes: 128,
    }),
    viewportDeclarations: Object.freeze(["width=device-width, initial-scale=1"]),
    htmlDoctypePresent: true,
    openGraph: Object.freeze({
      "og:title": Object.freeze(["Example home"]),
      "og:type": Object.freeze(["website"]),
      "og:url": Object.freeze(["https://example.com/"]),
      "og:image": Object.freeze(["https://example.com/share.png"]),
    }),
    socialCards: Object.freeze({}),
    iconDeclarationCount: 1,
    contentHash: HASH_A,
    domHash: "b".repeat(64),
    similarityFingerprint: "0000000000000000",
    meaningfulContent: true,
    clientRendered: false,
    directiveScopePreserved: true,
    linksComplete: true,
    extractedAt: OBSERVED_AT,
    ...overrides,
  });
}

export function page(overrides: Partial<AuditPageObservation> = {}): AuditPageObservation {
  const normalizedUrl = overrides.normalizedUrl ?? "https://example.com/";
  return Object.freeze({
    id: "page-home",
    requestedUrl: "https://example.com/",
    normalizedUrl,
    urlHash: createHash("sha256").update(normalizedUrl).digest("hex"),
    finalUrl: "https://example.com/",
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    htmlDetected: true,
    htmlDetectionSource: "bounded_response_prefix",
    htmlDetectionBytes: 4_096,
    contentLength: 4_000,
    responseBytes: 5_000,
    transferSize: 2_000,
    compression: "gzip",
    responseHeaders: Object.freeze({ "content-type": Object.freeze(["text/html; charset=utf-8"]) }),
    securityHeaders: Object.freeze({
      "strict-transport-security": Object.freeze(["max-age=31536000; includeSubDomains"]),
    }),
    depth: 0,
    redirectChain: Object.freeze([]),
    robotsDecision: "allowed",
    errorType: null,
    errorMessage: null,
    discoverySource: "seed",
    observedAt: OBSERVED_AT,
    extraction: extraction(),
    renderedExtraction: null,
    links: Object.freeze([]),
    resources: Object.freeze([]),
    importance: "homepage",
    indexabilityIntent: "intended",
    ...overrides,
  });
}

export function redirect(overrides: Partial<AuditRedirectHop> = {}): AuditRedirectHop {
  return Object.freeze({
    sequence: 0,
    requestedUrl: "https://example.com/old",
    statusCode: 301,
    location: "/new",
    resolvedUrl: "https://example.com/new",
    ...overrides,
  });
}

export function robots(overrides: Partial<AuditRobotsObservation> = {}): AuditRobotsObservation {
  return Object.freeze({
    id: "robots-home",
    origin: "https://example.com",
    requestedUrl: "https://example.com/robots.txt",
    finalUrl: "https://example.com/robots.txt",
    statusCode: 200,
    result: "fetched",
    userAgent: "SearviaBot/1.0",
    content: "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n",
    sitemapUrls: Object.freeze(["https://example.com/sitemap.xml"]),
    fetchedAt: OBSERVED_AT,
    ...overrides,
  });
}

export function sitemap(overrides: Partial<AuditSitemapObservation> = {}): AuditSitemapObservation {
  const normalizedUrl = overrides.normalizedUrl ?? "https://example.com/sitemap.xml";
  return Object.freeze({
    id: "sitemap-home",
    requestedUrl: "https://example.com/sitemap.xml",
    normalizedUrl,
    urlHash: createHash("sha256").update(normalizedUrl).digest("hex"),
    finalUrl: "https://example.com/sitemap.xml",
    source: "robots",
    status: "parsed",
    robotsDecision: "allowed",
    robotsObservationId: "robots-home",
    robotsResult: "fetched",
    format: "urlset",
    statusCode: 200,
    contentLength: 300,
    transferSize: 300,
    depth: 0,
    redirectChain: Object.freeze([]),
    parseIssues: Object.freeze([]),
    errorType: null,
    errorMessage: null,
    observedAt: OBSERVED_AT,
    entries: Object.freeze([
      Object.freeze({
        id: "sitemap-entry-home",
        entryType: "url",
        loc: "https://example.com/",
        normalizedLoc: "https://example.com/",
        targetPageId: "page-home",
      }),
    ]),
    ...overrides,
  });
}

export function historicalRedirect(
  overrides: Partial<HistoricalRedirectObservation> = {},
): HistoricalRedirectObservation {
  return Object.freeze({
    crawlId: "historical-crawl-a",
    crawlFinishedAt: "2026-07-01T12:05:00.000Z",
    requestedUrl: "https://example.com/old",
    resolvedUrl: "https://example.com/new",
    statusCode: 302,
    observedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  });
}

export function snapshot(overrides: Partial<AuditCrawlSnapshot> = {}): AuditCrawlSnapshot {
  return Object.freeze({
    organizationId: "organization-a",
    projectId: "project-a",
    crawlId: "crawl-a",
    origin: "https://example.com",
    status: "completed",
    startedAt: "2026-07-16T11:59:00.000Z",
    finishedAt: OBSERVED_AT,
    errorType: null,
    configuration: Object.freeze({
      maxDepth: 5,
      redirectLimit: 5,
      maxResponseBytes: 5_000_000,
      queryPolicy: "keep",
    }),
    pages: Object.freeze([page()]),
    robots: Object.freeze([robots()]),
    sitemaps: Object.freeze([sitemap()]),
    historicalRedirects: Object.freeze([]),
    historicalRedirectCoverage: Object.freeze({
      complete: true,
      truncated: false,
      pageObservationLimit: 10_000,
      loadedPageObservationCount: 0,
      loadedCrawlCount: 0,
    }),
    ...overrides,
  });
}

export interface RuleFixtureSet {
  readonly passing: AuditCrawlSnapshot;
  readonly failing: AuditCrawlSnapshot;
  readonly boundary: AuditCrawlSnapshot;
  readonly boundaryStatus: "not-checked" | "passed";
}

export function fixtureSet(
  input: Omit<RuleFixtureSet, "boundaryStatus"> & { boundaryStatus?: "not-checked" | "passed" },
): RuleFixtureSet {
  return Object.freeze({ ...input, boundaryStatus: input.boundaryStatus ?? "not-checked" });
}
