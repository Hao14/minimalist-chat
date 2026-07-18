import type { CanonicalNormalizationFailure, CrawlProgressCounters } from "@searvia/shared-types";

import { createSearviaAuditRepository } from "./audit-repository.js";
import { createDatabaseClient } from "./client.js";
import { parseDatabaseConfig } from "./config.js";
import { createSearviaCrawlRepository } from "./crawl-repository.js";

export interface WorkerDatabaseConfiguration {
  readonly applicationName: string;
  readonly connectionString: string;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly max: number;
  readonly queryTimeoutMillis: number;
  readonly statementTimeoutMillis: number;
}

export interface WorkerCrawlConfigSnapshot {
  readonly version: number;
  readonly startUrl: string;
  readonly pageLimit: number;
  readonly maxDepth: number;
  readonly includeSubdomains: boolean;
  readonly respectRobots: true;
  readonly requestDelayMs: number;
  readonly concurrency: number;
  readonly includePatterns: readonly string[];
  readonly excludePatterns: readonly string[];
  readonly queryPolicy: "keep" | "ignore_tracking" | "ignore_all";
  readonly userAgent: string;
  readonly redirectLimit: number;
  readonly maxResponseBytes: number;
  readonly requestTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly supportedContentTypes: readonly string[];
  readonly renderingEnabled: boolean;
  readonly submittedSitemapUrls: readonly string[];
}

export interface WorkerExecutionContext {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly executionToken: string;
}

export type WorkerExecutionClaim =
  | Readonly<{
      kind: "claimed";
      executionToken: string;
      crawl: Readonly<{
        organizationId: string;
        projectId: string;
        crawlId: string;
        traceId: string;
        status: "validating";
        config: WorkerCrawlConfigSnapshot;
        counters: CrawlProgressCounters;
      }>;
    }>
  | Readonly<{ kind: "busy"; retryAfterMs: number }>
  | Readonly<{
      kind: "terminal";
      status: "cancelled" | "failed" | "partially_completed" | "completed";
    }>
  | Readonly<{ kind: "cancelled" }>;

export type WorkerPreClaimFailureResult =
  | Readonly<{ kind: "retryable" | "already_terminal" | "cancelled" }>
  | Readonly<{ kind: "busy"; retryAfterMs: number }>
  | Readonly<{ kind: "failed"; status: "failed" | "partially_completed" }>;

export interface WorkerClaimedOutboxRecord {
  readonly id: string;
  readonly jobType: "crawl.execute" | "crawl.dead-letter" | "audit.evaluate";
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly idempotencyKey: string;
  readonly traceId: string;
  readonly contractVersion: number;
  readonly payload: unknown;
  readonly publishAttemptCount: number;
  readonly claimToken: string;
  readonly leaseExpiresAt: Date;
}

export interface WorkerRedirectHop {
  readonly sequence: number;
  readonly requestedUrl: string;
  readonly statusCode: number;
  readonly location: string;
  readonly resolvedUrl: string;
}

export interface WorkerFetchTiming {
  readonly startedAt: string;
  readonly dnsMs: number;
  readonly ttfbMs: number;
  readonly downloadMs: number;
  readonly totalMs: number;
}

/**
 * Stored transport evidence from an earlier page attempt. It becomes immutable
 * once the raw object is durable; before then a worker may replace it only after
 * proving that no page-scoped object exists.
 */
export interface WorkerStoredPageObservation {
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string | null;
  readonly urlHash: string;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly htmlDetected?: boolean | null;
  readonly htmlDetectionSource?: "bounded_response_prefix" | null;
  readonly htmlDetectionBytes?: number | null;
  readonly responseHeaders: Readonly<Record<string, readonly string[]>>;
  readonly contentLength: number | null;
  readonly responseBytes: number;
  readonly transferSize: number;
  readonly compression: string | null;
  readonly depth: number;
  readonly redirectChain: readonly WorkerRedirectHop[];
  readonly timing: WorkerFetchTiming | null;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
}

export interface WorkerPageObservationInput {
  readonly frontierId: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string | null;
  readonly urlHash: string;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly htmlDetected?: boolean | null;
  readonly htmlDetectionSource?: "bounded_response_prefix" | null;
  readonly htmlDetectionBytes?: number | null;
  readonly responseHeaders?: Readonly<Record<string, readonly string[]>>;
  readonly omittedResponseHeaders?: readonly string[];
  readonly contentLength?: number | null;
  readonly responseBytes: number;
  readonly transferSize?: number;
  readonly compression?: string | null;
  readonly cacheHeaders?: Readonly<Record<string, readonly string[]>>;
  readonly securityHeaders?: Readonly<Record<string, readonly string[]>>;
  readonly depth: number;
  readonly redirectChain: readonly WorkerRedirectHop[];
  readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly timing: WorkerFetchTiming | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly outcome: "succeeded" | "failed" | "blocked" | "skipped";
  readonly countsTowardPageLimit?: boolean;
}

export interface WorkerResumableFrontierEntry {
  readonly countsTowardPageLimit: boolean;
  readonly depth: number;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly normalizedUrl: string;
  readonly requestedUrl: string;
  readonly urlHash: string;
}

/**
 * Worker persistence DTOs deliberately live at this Drizzle-free package boundary.
 * Keeping the public `@searvia/database/workers` declaration independent from the
 * repository's table inference prevents consumers from inheriting declarations for
 * every optional Drizzle dialect.
 */
export interface WorkerPageHeadingInput {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly ordinal: number;
  readonly text: string;
}

export interface WorkerPageLinkInput {
  readonly targetFrontierId: string | null;
  readonly targetPageId: string | null;
  readonly targetUrl: string;
  readonly normalizedTargetUrl: string;
  readonly targetUrlHash: string;
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
  readonly hreflang: string | null;
  readonly discovered: boolean;
  readonly crawlDepth: number;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly ordinal: number;
}

export interface WorkerPageImageInput {
  readonly sourceUrl: string | null;
  readonly normalizedUrl: string | null;
  readonly urlHash: string | null;
  readonly scope: "internal" | "external" | null;
  readonly altText: string | null;
  readonly title: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly loading: string | null;
  readonly srcset: string | null;
  readonly ordinal: number;
}

export interface WorkerPageResourceInput {
  readonly resourceType: "script" | "stylesheet" | "iframe" | "form";
  readonly sourceUrl: string | null;
  readonly normalizedUrl: string | null;
  readonly urlHash: string | null;
  readonly scope: "internal" | "external" | null;
  readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly ordinal: number;
}

export interface WorkerPageStructuredDataInput {
  readonly kind: "json_ld" | "microdata";
  readonly parseStatus: "parsed" | "invalid";
  readonly schemaTypes: readonly string[];
  readonly rawValue: string;
  readonly parsedValue: unknown | null;
  readonly errorMessage: string | null;
  readonly ordinal: number;
}

export interface WorkerPageExtractionInput {
  readonly pageId: string;
  readonly source: "raw" | "rendered";
  /** The completed extraction attempt outcome. Failed rows contain no usable audit evidence. */
  readonly status: "succeeded" | "failed";
  readonly title: string | null;
  readonly documentMetadataComplete?: boolean;
  readonly titleTagCount?: number;
  readonly metaDescription: string | null;
  readonly metaDescriptionTagCount?: number;
  readonly metaRobots: readonly string[];
  readonly xRobotsTag: readonly string[];
  readonly directiveScopePreserved: boolean;
  readonly linksComplete: boolean;
  readonly canonicalUrl: string | null;
  readonly canonicalTagCount: number;
  readonly canonicalNormalizationFailure: CanonicalNormalizationFailure | null;
  readonly metaRefreshUrl?: string | null;
  readonly javascriptRedirectUrl?: string | null;
  readonly visibleText: string | null;
  readonly visibleTextComplete?: boolean;
  readonly wordCount: number;
  readonly headingsComplete?: boolean;
  readonly htmlLanguage: string | null;
  readonly characterEncoding: string | null;
  readonly characterEncodingDeclared?: string | null;
  readonly characterEncodingSource?: "bom" | "http_header" | "meta" | "default" | null;
  readonly characterEncodingDeclarationOffset?: number | null;
  readonly viewportDeclarations?: readonly string[];
  readonly htmlDoctypePresent?: boolean;
  readonly iconDeclarationCount?: number;
  readonly openGraph: Readonly<Record<string, readonly string[]>>;
  readonly socialCards: Readonly<Record<string, readonly string[]>>;
  readonly contentHash: string | null;
  readonly domHash: string | null;
  readonly similarityFingerprint: string | null;
  readonly meaningfulContent: boolean;
  readonly clientRendered: boolean;
  readonly renderingErrorType: string | null;
  readonly renderingErrorMessage: string | null;
  readonly headings: readonly WorkerPageHeadingInput[];
  readonly links: readonly WorkerPageLinkInput[];
  readonly images: readonly WorkerPageImageInput[];
  readonly resources: readonly WorkerPageResourceInput[];
  readonly structuredData: readonly WorkerPageStructuredDataInput[];
  readonly extractedAt: Date;
}

export interface WorkerPageArtifactInput {
  readonly pageId: string;
  readonly kind: "raw-html" | "rendered-html";
  readonly bucket: string;
  readonly key: string;
  readonly objectVersion: string | null;
  readonly etag: string | null;
  readonly contentType: string;
  readonly contentEncoding: "gzip";
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly contentSha256: string;
  readonly storageSha256: string;
  readonly storedAt: Date | string;
}

export interface WorkerSitemapEntryInput {
  readonly entryType: "url" | "sitemap";
  readonly loc: string;
  readonly normalizedLoc: string;
  readonly urlHash: string;
  readonly lastmodRaw: string | null;
  readonly lastmodAt: Date | null;
  readonly targetFrontierId: string | null;
  readonly targetPageId: string | null;
  readonly targetSitemapId: string | null;
  readonly ordinal: number;
}

export interface WorkerSitemapObservationInput {
  readonly parentSitemapId: string | null;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string | null;
  readonly urlHash: string;
  readonly source: "robots" | "submitted" | "default" | "nested";
  readonly status: "parsed" | "failed" | "skipped";
  readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly format: "urlset" | "index" | "unknown";
  readonly compression: "identity" | "gzip";
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly transferSize: number;
  readonly contentDigest: string | null;
  readonly depth: number;
  readonly redirectChain: readonly WorkerRedirectHop[];
  readonly parseIssues: readonly Readonly<{
    code: string;
    entryIndex: number | null;
    message: string;
  }>[];
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly fetchedAt: Date | null;
  readonly parsedAt: Date | null;
  readonly entries: readonly WorkerSitemapEntryInput[];
}

export interface WorkerAuditRuleVersionRegistration {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly defaultSeverity:
    "critical" | "high" | "medium" | "low" | "opportunity" | "manual-review";
  readonly defaultConfidence: "high" | "medium" | "low";
  readonly scope: "page" | "site";
  readonly deterministic: boolean;
  readonly eligibilityDescription: string;
  readonly requiredData: readonly string[];
  readonly explanation: string;
  readonly expectedValue: string;
  readonly recommendedFix: string;
  readonly verificationMethod: string;
  readonly impactAreas: readonly string[];
  readonly responsibleOwner: string;
  readonly firstSupportedVersion: string;
}

export interface WorkerAuditEvaluationResultInput {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly scope: "page" | "site";
  readonly scopeKey: string;
  readonly pageId?: string | null;
  readonly normalizedUrl?: string | null;
  readonly eligibility: "eligible" | "ineligible" | "unavailable";
  readonly status:
    "passed" | "failed" | "warning" | "opportunity" | "manual-review" | "not-checked";
  readonly severity: "critical" | "high" | "medium" | "low" | "opportunity" | "manual-review";
  readonly confidence: "high" | "medium" | "low" | null;
  readonly missingData?: readonly string[];
  readonly notEvaluatedReasonCode?: string | null;
  readonly notEvaluatedReason?: string | null;
  readonly evidenceVersion?: number;
  readonly evidence: readonly unknown[];
  readonly detectedValue?: unknown;
  readonly expectedValue?: unknown;
  readonly explanation: string;
  readonly recommendedFix: string;
}

export interface WorkerPersistAuditEvaluationReportInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly engineVersion: number;
  readonly definitions: readonly WorkerAuditRuleVersionRegistration[];
  readonly results: readonly WorkerAuditEvaluationResultInput[];
  readonly now?: Date;
}

export interface WorkerAuditEvaluationRunRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly engineVersion: number;
  readonly catalogHash: string;
  readonly reportHash: string;
  readonly reportHashIntegrity: "verified" | "legacy-unverifiable";
  readonly status: "completed" | "partially-completed";
  readonly resultCount: number;
  readonly eligibleCount: number;
  readonly evaluatedCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly warningCount: number;
  readonly opportunityCount: number;
  readonly manualReviewCount: number;
  readonly notCheckedCount: number;
  readonly ruleErrorCount: number;
  readonly snapshotAt: Date;
  readonly finishedAt: Date;
}

export interface WorkerAuditSnapshotScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
}

export interface WorkerAuditPageExtraction {
  readonly id: string;
  readonly source: "raw" | "rendered";
  /** Non-null audit extractions are always proven successful by the database adapter. */
  readonly status: "succeeded";
  readonly title: string | null;
  readonly documentMetadataComplete: boolean;
  readonly titleTagCount: number;
  readonly metaDescription: string | null;
  readonly metaDescriptionTagCount: number;
  readonly metaRobots: readonly string[];
  readonly xRobotsTag: readonly string[];
  readonly directiveScopePreserved: boolean;
  readonly linksComplete: boolean;
  readonly canonicalUrl: string | null;
  readonly canonicalTagCount: number;
  readonly canonicalNormalizationFailure: CanonicalNormalizationFailure | null;
  readonly metaRefreshUrl: string | null;
  readonly javascriptRedirectUrl: string | null;
  readonly visibleText: string | null;
  readonly visibleTextComplete: boolean;
  readonly wordCount: number;
  readonly headings: readonly Readonly<{
    id: string;
    level: 1 | 2 | 3 | 4 | 5 | 6;
    ordinal: number;
    text: string;
  }>[];
  readonly headingsComplete: boolean;
  readonly htmlLanguage: string | null;
  readonly characterEncoding: Readonly<{
    used: string;
    declared: string | null;
    source: "bom" | "http_header" | "meta" | "default";
    declarationOffsetBytes: number | null;
  }> | null;
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
  readonly extractedAt: string;
}

export interface WorkerAuditPageLink {
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

export interface WorkerAuditPageResource {
  readonly id: string;
  readonly resourceType: "script" | "stylesheet" | "iframe" | "form";
  readonly sourceUrl: string | null;
  readonly normalizedUrl: string | null;
  readonly scope: "internal" | "external" | null;
  readonly robotsDecision: "not-checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly robotsResult: "fetched" | "not_found" | "unavailable" | "invalid" | null;
}

export interface WorkerAuditPageObservation {
  readonly id: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
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
  readonly responseHeaders: Readonly<Record<string, readonly string[]>>;
  readonly securityHeaders: Readonly<Record<string, readonly string[]>>;
  readonly depth: number;
  readonly redirectChain: readonly WorkerRedirectHop[];
  readonly robotsDecision: "not-checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly robotsResult: "fetched" | "not_found" | "unavailable" | "invalid" | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly observedAt: string;
  readonly extraction: WorkerAuditPageExtraction | null;
  readonly renderedExtraction: WorkerAuditPageExtraction | null;
  readonly links: readonly WorkerAuditPageLink[];
  readonly resources: readonly WorkerAuditPageResource[];
  readonly importance: "homepage" | "important" | "standard";
  readonly indexabilityIntent: "intended" | "unknown";
}

export interface WorkerAuditRobotsObservation {
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

export interface WorkerAuditSitemapEntry {
  readonly id: string;
  readonly entryType: "url" | "sitemap";
  readonly loc: string;
  readonly normalizedLoc: string;
  readonly targetPageId: string | null;
}

export interface WorkerAuditSitemapObservation {
  readonly id: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly urlHash: string;
  readonly finalUrl: string | null;
  readonly source: "robots" | "submitted" | "default" | "nested";
  readonly status: "parsed" | "failed" | "skipped";
  readonly robotsDecision: "not-checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly robotsResult: "fetched" | "not_found" | "unavailable" | "invalid" | null;
  readonly format: "urlset" | "index" | "unknown";
  readonly statusCode: number | null;
  readonly contentLength: number | null;
  readonly transferSize: number;
  readonly depth: number;
  readonly redirectChain: readonly WorkerRedirectHop[];
  readonly parseIssues: readonly Readonly<{
    code: string;
    entryIndex: number | null;
    message: string;
  }>[];
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly observedAt: string;
  readonly entries: readonly WorkerAuditSitemapEntry[];
}

export interface WorkerAuditHistoricalRedirectObservation {
  readonly crawlId: string;
  readonly crawlFinishedAt: string;
  readonly requestedUrl: string;
  readonly resolvedUrl: string;
  readonly statusCode: 302 | 307;
  readonly observedAt: string;
}

export interface WorkerAuditHistoricalRedirectCoverage {
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly pageObservationLimit: number;
  readonly loadedPageObservationCount: number;
  readonly loadedCrawlCount: number;
}

/**
 * Drizzle-free evaluation snapshot. Its shape intentionally matches the
 * audit engine contract without making the database package depend on it.
 */
export interface WorkerAuditCrawlSnapshot {
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
  readonly pages: readonly WorkerAuditPageObservation[];
  readonly robots: readonly WorkerAuditRobotsObservation[];
  readonly sitemaps: readonly WorkerAuditSitemapObservation[];
  readonly historicalRedirects: readonly WorkerAuditHistoricalRedirectObservation[];
  readonly historicalRedirectCoverage: WorkerAuditHistoricalRedirectCoverage;
}

export interface CrawlWorkerRepository {
  claimOutboxBatch(
    input: Readonly<{
      limit: number;
      leaseMs: number;
      now?: Date;
      claimToken?: string;
    }>,
  ): Promise<readonly WorkerClaimedOutboxRecord[]>;
  recoverExpiredOutboxLeases(now?: Date): Promise<number>;
  markOutboxPublished(
    outboxId: string,
    claimToken: string,
    queueJobId: string,
    now?: Date,
  ): Promise<boolean>;
  releaseOutboxClaim(
    input: Readonly<{
      outboxId: string;
      claimToken: string;
      errorMessage: string;
      retryAt: Date;
      terminal: boolean;
      now?: Date;
    }>,
  ): Promise<boolean>;
  claimExecution(
    input: Readonly<{
      organizationId: string;
      projectId: string;
      crawlId: string;
      queueJobId?: string;
      requestedByMembershipId?: string;
      traceId?: string;
      idempotencyKey?: string;
      estimatedPages?: number;
      executionToken?: string;
      leaseMs: number;
      now?: Date;
    }>,
  ): Promise<WorkerExecutionClaim>;
  reconcilePreClaimFailure(
    input: Readonly<{
      organizationId: string;
      projectId: string;
      crawlId: string;
      queueJobId: string;
      requestedByMembershipId: string;
      traceId: string;
      idempotencyKey: string;
      estimatedPages: number;
      attemptsMade: number;
      errorType: string;
      errorMessage: string;
      terminal: boolean;
      now?: Date;
    }>,
  ): Promise<WorkerPreClaimFailureResult>;
  isCancellationRequested(
    organizationId: string,
    projectId: string,
    crawlId: string,
    executionToken: string,
  ): Promise<boolean>;
  recordExecutionProgress(
    context: WorkerExecutionContext,
    counters: CrawlProgressCounters,
    leaseMs: number,
    now?: Date,
  ): Promise<void>;
  renewExecutionLease(
    context: WorkerExecutionContext,
    leaseMs: number,
    now?: Date,
  ): Promise<boolean>;
  transitionStage(
    context: WorkerExecutionContext,
    nextStatus: "discovering" | "crawling",
    now?: Date,
  ): Promise<void>;
  listResumableFrontier(
    context: WorkerExecutionContext,
    limit: number,
    now?: Date,
  ): Promise<readonly WorkerResumableFrontierEntry[]>;
  persistDiscoveredUrl(
    context: WorkerExecutionContext,
    input: Readonly<{
      requestedUrl: string;
      discoveredUrl: string;
      normalizedUrl: string;
      urlHash: string;
      origin: string;
      hostname: string;
      depth: number;
      discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
      discoveredFromFrontierId: string | null;
    }>,
    now?: Date,
  ): Promise<
    Readonly<{
      id: string;
      created: boolean;
      state: "discovered" | "fetching" | "fetched" | "blocked" | "failed" | "skipped";
    }>
  >;
  persistPageObservation(
    context: WorkerExecutionContext,
    input: Readonly<WorkerPageObservationInput>,
    now?: Date,
  ): Promise<
    Readonly<{
      pageId: string;
      created: boolean;
      rawArtifactExists: boolean;
      storedObservation: WorkerStoredPageObservation | null;
    }>
  >;
  replaceIncompletePageObservation(
    context: WorkerExecutionContext,
    pageId: string,
    input: Readonly<WorkerPageObservationInput>,
    now?: Date,
  ): Promise<void>;
  persistPageExtraction(
    context: WorkerExecutionContext,
    input: WorkerPageExtractionInput,
    now?: Date,
  ): Promise<Readonly<{ extractionId: string; created: boolean }>>;
  persistPageArtifact(
    context: WorkerExecutionContext,
    input: WorkerPageArtifactInput,
    now?: Date,
  ): Promise<Readonly<{ artifactId: string; created: boolean }>>;
  persistSitemapObservation(
    context: WorkerExecutionContext,
    input: WorkerSitemapObservationInput,
    now?: Date,
  ): Promise<Readonly<{ sitemapId: string; created: boolean; insertedEntryCount: number }>>;
  persistRobotsObservation(
    context: WorkerExecutionContext,
    input: Readonly<{
      origin: string;
      hostname: string;
      requestedUrl: string;
      finalUrl: string | null;
      statusCode: number | null;
      contentType: string | null;
      result: "fetched" | "not_found" | "unavailable" | "invalid";
      userAgent: string;
      contentSha256: string | null;
      content: string | null;
      crawlDelayMs: number | null;
      sitemapUrls: readonly string[];
      fetchedAt: Date;
    }>,
    now?: Date,
  ): Promise<
    Readonly<{
      id: string;
      created: boolean;
      result: "fetched" | "not_found" | "unavailable" | "invalid";
    }>
  >;
  saveCheckpoint(context: WorkerExecutionContext, currentDepth: number, now?: Date): Promise<void>;
  releaseExecutionForRetry(
    context: WorkerExecutionContext,
    errorType: string,
    errorMessage: string,
    now?: Date,
  ): Promise<unknown>;
  completeExecution(
    context: WorkerExecutionContext,
    input: Readonly<{
      status: "cancelled" | "failed" | "partially_completed" | "completed";
      completionReason: string;
      errorType?: string | null;
      errorMessage?: string | null;
      now?: Date;
    }>,
  ): Promise<unknown>;
  finalizeExecutionFailure(
    context: WorkerExecutionContext,
    input: Readonly<{
      attemptsMade: number;
      errorType: string;
      errorMessage: string;
      now?: Date;
    }>,
  ): Promise<"cancelled" | "failed" | "partially_completed">;
  recordDeadLetter(
    scope: Readonly<{ organizationId: string; projectId: string; crawlId: string }>,
    input: Readonly<{
      errorType: string;
      errorMessage: string;
      queueJobId?: string;
      attemptsMade?: number;
      now?: Date;
    }>,
  ): Promise<void>;
}

export interface WorkerDatabaseRuntime {
  readonly repository: CrawlWorkerRepository;
  loadAuditCrawlSnapshot(scope: WorkerAuditSnapshotScope): Promise<WorkerAuditCrawlSnapshot>;
  hasTerminalAuditEvaluationRun(scope: WorkerAuditSnapshotScope): Promise<boolean>;
  persistAuditEvaluationReport(
    input: WorkerPersistAuditEvaluationReportInput,
  ): Promise<WorkerAuditEvaluationRunRecord>;
  checkHealth(): Promise<Readonly<{ latencyMs: number; status: "ok" }>>;
  close(): Promise<void>;
}

export function createWorkerDatabaseRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  applicationName: string,
): WorkerDatabaseRuntime {
  const client = createDatabaseClient(parseDatabaseConfig(environment, applicationName));
  const crawlRepository = createSearviaCrawlRepository(client.db);
  const repository: CrawlWorkerRepository = crawlRepository;
  const auditRepository = createSearviaAuditRepository(client.db);
  return Object.freeze({
    repository,
    loadAuditCrawlSnapshot: (scope: WorkerAuditSnapshotScope) =>
      crawlRepository.loadAuditCrawlSnapshot(scope),
    hasTerminalAuditEvaluationRun: (scope: WorkerAuditSnapshotScope) =>
      auditRepository.hasTerminalEvaluationRun(scope),
    persistAuditEvaluationReport: (input: WorkerPersistAuditEvaluationReportInput) =>
      auditRepository.persistEvaluationReport(input),
    checkHealth: () => client.checkHealth(),
    close: () => client.close(),
  });
}
