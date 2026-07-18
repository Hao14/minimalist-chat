import type { CanonicalNormalizationFailure } from "@searvia/shared-types";

export type AuditHeaderMap = Readonly<Record<string, readonly string[]>>;

export interface AuditRedirectHop {
  readonly sequence: number;
  readonly requestedUrl: string;
  readonly statusCode: number;
  readonly location: string;
  readonly resolvedUrl: string;
}

export interface AuditPageExtraction {
  readonly id: string;
  readonly source: "raw" | "rendered";
  /** A non-null extraction is usable only when its persisted attempt succeeded. */
  readonly status: "succeeded";
  readonly title: string | null;
  /** True only when bounded document metadata counts/signals were preserved by the extractor. */
  readonly documentMetadataComplete: boolean;
  readonly titleTagCount: number;
  readonly metaDescription: string | null;
  readonly metaDescriptionTagCount: number;
  readonly metaRobots: readonly string[];
  readonly xRobotsTag: readonly string[];
  readonly canonicalUrl: string | null;
  readonly canonicalTagCount: number;
  readonly canonicalNormalizationFailure: CanonicalNormalizationFailure | null;
  readonly metaRefreshUrl: string | null;
  readonly javascriptRedirectUrl: string | null;
  readonly visibleText: string | null;
  /** True only when the complete extracted visible text survived persistence bounds. */
  readonly visibleTextComplete: boolean;
  readonly wordCount: number;
  readonly headings: readonly AuditPageHeading[];
  readonly headingsComplete: boolean;
  readonly htmlLanguage: string | null;
  readonly characterEncoding: AuditCharacterEncoding | null;
  readonly viewportDeclarations: readonly string[];
  readonly htmlDoctypePresent: boolean;
  readonly openGraph: Readonly<Record<string, readonly string[]>>;
  readonly socialCards: Readonly<Record<string, readonly string[]>>;
  readonly iconDeclarationCount: number;
  readonly contentHash: string | null;
  readonly domHash: string | null;
  readonly similarityFingerprint: string | null;
  readonly meaningfulContent: boolean;
  readonly clientRendered: boolean;
  /** Whether persisted directives were filtered with their original crawler ownership intact. */
  readonly directiveScopePreserved: boolean;
  /** Whether all parseable navigation links survived extraction and persistence bounds. */
  readonly linksComplete: boolean;
  readonly extractedAt: string;
}

export interface AuditPageHeading {
  readonly id: string;
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly ordinal: number;
  readonly text: string;
}

export interface AuditCharacterEncoding {
  readonly used: string;
  readonly declared: string | null;
  readonly source: "bom" | "http_header" | "meta" | "default";
  /** Ending byte offset of a meta declaration when known; null for BOM/header/default or legacy data. */
  readonly declarationOffsetBytes: number | null;
}

export interface AuditPageLink {
  readonly id: string;
  readonly targetPageId: string | null;
  readonly targetUrl: string;
  readonly normalizedTargetUrl: string;
  readonly scope: "internal" | "external";
  readonly anchorText: string | null;
  readonly relValues: readonly string[];
  readonly linkType:
    | "anchor"
    | "area"
    | "canonical"
    | "hreflang"
    | "pagination"
    | "form_action"
    | "iframe"
    | "other";
  readonly discovered: boolean;
  readonly crawlDepth: number;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly ordinal: number;
}

export interface AuditPageResource {
  readonly id: string;
  readonly resourceType: "script" | "stylesheet" | "iframe" | "form";
  readonly sourceUrl: string | null;
  readonly normalizedUrl: string | null;
  readonly scope: "internal" | "external" | null;
  readonly robotsDecision?: "allowed" | "disallowed" | "not-checked";
  readonly robotsObservationId?: string | null;
  readonly robotsResult?: "fetched" | "not_found" | "unavailable" | "invalid" | null;
}

export interface AuditPageObservation {
  readonly id: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  /** SHA-256 identity computed and persisted by the crawler before audit evaluation. */
  readonly urlHash: string;
  readonly finalUrl: string | null;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly htmlDetected: boolean | null;
  readonly htmlDetectionSource: "bounded_response_prefix" | null;
  readonly htmlDetectionBytes: number | null;
  readonly contentLength: number | null;
  readonly responseBytes: number;
  readonly transferSize: number;
  readonly compression: string | null;
  readonly responseHeaders: AuditHeaderMap;
  readonly securityHeaders: AuditHeaderMap;
  readonly depth: number;
  readonly redirectChain: readonly AuditRedirectHop[];
  readonly robotsDecision: "not-checked" | "allowed" | "disallowed";
  readonly robotsObservationId?: string | null;
  readonly robotsResult?: "fetched" | "not_found" | "unavailable" | "invalid" | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly observedAt: string;
  /** Successful raw extraction used by objective transport/HTML/graph rules. */
  readonly extraction: AuditPageExtraction | null;
  /** Successful optional rendered extraction, when one was persisted for this page. */
  readonly renderedExtraction: AuditPageExtraction | null;
  readonly links: readonly AuditPageLink[];
  readonly resources: readonly AuditPageResource[];
  readonly importance: "homepage" | "important" | "standard";
  readonly indexabilityIntent: "intended" | "not-intended" | "unknown";
}

export interface AuditRobotsObservation {
  readonly id: string;
  readonly origin: string;
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly statusCode: number | null;
  readonly result: "fetched" | "not_found" | "unavailable" | "invalid";
  readonly userAgent: string;
  readonly content: string | null;
  readonly sitemapUrls: readonly string[];
  readonly fetchedAt: string;
}

export interface AuditSitemapEntry {
  readonly id: string;
  readonly entryType: "url" | "sitemap";
  readonly loc: string;
  readonly normalizedLoc: string;
  readonly targetPageId: string | null;
}

export interface AuditSitemapObservation {
  readonly id: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  /** SHA-256 identity computed and persisted by the crawler before audit evaluation. */
  readonly urlHash: string;
  readonly finalUrl: string | null;
  readonly source: "robots" | "submitted" | "default" | "nested";
  readonly status: "parsed" | "failed" | "skipped";
  readonly robotsDecision?: "not-checked" | "allowed" | "disallowed";
  readonly robotsObservationId?: string | null;
  readonly robotsResult?: "fetched" | "not_found" | "unavailable" | "invalid" | null;
  readonly format: "urlset" | "index" | "unknown";
  readonly statusCode: number | null;
  readonly contentLength: number | null;
  readonly transferSize: number;
  readonly depth: number;
  readonly redirectChain: readonly AuditRedirectHop[];
  readonly parseIssues: readonly Readonly<{
    code: string;
    entryIndex: number | null;
    message: string;
  }>[];
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly observedAt: string;
  readonly entries: readonly AuditSitemapEntry[];
}

export interface HistoricalRedirectObservation {
  readonly crawlId: string;
  readonly crawlFinishedAt: string;
  readonly requestedUrl: string;
  readonly resolvedUrl: string;
  readonly statusCode: 302 | 307;
  readonly observedAt: string;
}

export interface HistoricalRedirectCoverage {
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly pageObservationLimit: number;
  readonly loadedPageObservationCount: number;
  readonly loadedCrawlCount: number;
}

export interface AuditCrawlSnapshot {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly origin: string;
  readonly status: "completed" | "partially_completed";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly errorType: string | null;
  readonly configuration: Readonly<{
    maxDepth: number;
    redirectLimit: number;
    maxResponseBytes: number;
    queryPolicy: "keep" | "ignore_tracking" | "ignore_all";
  }>;
  readonly pages: readonly AuditPageObservation[];
  readonly robots: readonly AuditRobotsObservation[];
  readonly sitemaps: readonly AuditSitemapObservation[];
  readonly historicalRedirects: readonly HistoricalRedirectObservation[];
  readonly historicalRedirectCoverage: HistoricalRedirectCoverage;
}
