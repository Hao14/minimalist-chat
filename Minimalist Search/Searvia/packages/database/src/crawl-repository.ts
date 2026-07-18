import { createHash, randomUUID } from "node:crypto";

import {
  CANONICAL_NORMALIZATION_FAILURE_CODES,
  roleHasCapability,
  type CanonicalNormalizationFailure,
  type CrawlDeadLetterJob,
  type CrawlExecuteJob,
  type CrawlProgressCounters,
  type OrganizationCapability,
  type OrganizationRole,
} from "@searvia/shared-types";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type { SearviaDatabase } from "./client.js";
import { DatabaseDomainError } from "./domain-errors.js";
import type { OrganizationScope } from "./repository.js";
import type {
  WorkerAuditCrawlSnapshot,
  WorkerAuditSnapshotScope,
  WorkerStoredPageObservation,
} from "./worker-runtime.js";
import {
  auditLogs,
  crawlCheckpoints,
  crawlConfigs,
  crawlFrontier,
  crawlPageArtifacts,
  crawlPageExtractions,
  crawlPageHeadings,
  crawlPageImages,
  crawlPageLinks,
  crawlPages,
  crawlPageResources,
  crawlPageStructuredData,
  crawlRobots,
  crawlSitemapEntries,
  crawlSitemaps,
  crawls,
  crawlUsageReservations,
  jobOutbox,
  membershipProjectScopes,
  memberships,
  organizations,
  projects,
  sessions,
  type StoredCrawlConfigSnapshot,
  type StoredFetchTiming,
  type StoredHeaderMap,
  type StoredRedirectHop,
  type StoredSocialMetadata,
} from "./schema.js";

export const CRAWL_TERMINAL_STATUSES = [
  "cancelled",
  "failed",
  "partially_completed",
  "completed",
] as const;

export const CRAWL_ACTIVE_STATUSES = ["queued", "validating", "discovering", "crawling"] as const;
const AUDIT_HISTORY_PAGE_LIMIT = 10_000;
const AUDIT_VISIBLE_TEXT_CHARACTER_LIMIT = 100_000;
const AUDIT_SNAPSHOT_COLLECTION_LIMITS = Object.freeze({
  headings: 25_000,
  links: 25_000,
  resources: 25_000,
});

export interface AuditSnapshotCollectionLimits {
  readonly headings?: number;
  readonly links?: number;
  readonly resources?: number;
}

function auditSnapshotCollectionLimits(
  overrides: AuditSnapshotCollectionLimits | undefined,
): Readonly<Required<AuditSnapshotCollectionLimits>> {
  const bounded: { headings: number; links: number; resources: number } = {
    ...AUDIT_SNAPSHOT_COLLECTION_LIMITS,
  };
  for (const key of Object.keys(bounded) as Array<keyof typeof bounded>) {
    const value = overrides?.[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > AUDIT_SNAPSHOT_COLLECTION_LIMITS[key]) {
      throw new TypeError(
        `Audit snapshot ${key} limit must be between 1 and ${AUDIT_SNAPSHOT_COLLECTION_LIMITS[key]}.`,
      );
    }
    bounded[key] = value;
  }
  return Object.freeze(bounded);
}

function canonicalJson(value: unknown): string {
  function normalize(entry: unknown, seen: Set<object>): unknown {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") {
      return entry;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new TypeError("Canonical JSON numbers must be finite.");
      return entry;
    }
    if (Array.isArray(entry)) {
      if (seen.has(entry)) throw new TypeError("Canonical JSON must not contain cycles.");
      seen.add(entry);
      const normalized = entry.map((item) => normalize(item, seen));
      seen.delete(entry);
      return normalized;
    }
    if (typeof entry === "object") {
      if (seen.has(entry)) throw new TypeError("Canonical JSON must not contain cycles.");
      seen.add(entry);
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(entry).sort()) {
        const item = Reflect.get(entry, key) as unknown;
        if (item === undefined) throw new TypeError("Canonical JSON must not contain undefined.");
        normalized[key] = normalize(item, seen);
      }
      seen.delete(entry);
      return normalized;
    }
    throw new TypeError("Canonical JSON contains an unsupported value.");
  }

  return JSON.stringify(normalize(value, new Set<object>()));
}

function auditCharacterEncodingSource(
  value: string | null,
): "bom" | "http_header" | "meta" | "default" | null {
  switch (value) {
    case "bom":
    case "http_header":
    case "meta":
    case "default":
      return value;
    default:
      return null;
  }
}

export type CrawlTerminalStatus = (typeof CRAWL_TERMINAL_STATUSES)[number];
export type CrawlActiveStatus = (typeof CRAWL_ACTIVE_STATUSES)[number];
export type CrawlStatus = CrawlActiveStatus | CrawlTerminalStatus;

export interface PublicCrawlEntitlement {
  readonly enabled: boolean;
  readonly maximumPages: number;
  readonly maximumActiveCrawlsPerProject: 1;
}

export const PHASE_ONE_PUBLIC_CRAWL_ENTITLEMENT: PublicCrawlEntitlement = Object.freeze({
  enabled: true,
  maximumPages: 100,
  maximumActiveCrawlsPerProject: 1,
});

export interface CrawlProgressRecord {
  readonly id: string;
  readonly projectId: string;
  readonly status: CrawlStatus;
  readonly cancellationRequested: boolean;
  readonly discoveredCount: number;
  readonly processedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly blockedCount: number;
  readonly skippedCount: number;
  readonly extractedPageCount: number;
  readonly extractionFailedCount: number;
  readonly renderedPageCount: number;
  readonly artifactCount: number;
  readonly sitemapCount: number;
  readonly sitemapUrlCount: number;
  readonly bytesReceived: number;
  readonly attemptCount: number;
  readonly completionReason: string | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly traceId: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly lastProgressAt: Date;
}

export interface CreateCrawlResult {
  readonly crawl: CrawlProgressRecord;
  readonly created: boolean;
}

export type CrawlExecutionJobPayload = CrawlExecuteJob;

export type CrawlDeadLetterJobPayload = CrawlDeadLetterJob;

export interface AuditEvaluateJobPayload {
  readonly contractVersion: 1;
  readonly jobType: "audit.evaluate";
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly traceId: string;
  readonly idempotencyKey: string;
  readonly crawlStatus: "partially_completed" | "completed";
  readonly crawlFinishedAt: string;
}

export type CrawlOutboxPayload =
  CrawlExecutionJobPayload | CrawlDeadLetterJobPayload | AuditEvaluateJobPayload;

export interface ClaimedOutboxRecord {
  readonly id: string;
  readonly jobType: "crawl.execute" | "crawl.dead-letter" | "audit.evaluate";
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly idempotencyKey: string;
  readonly traceId: string;
  readonly contractVersion: number;
  readonly payload: CrawlOutboxPayload;
  readonly publishAttemptCount: number;
  readonly claimToken: string;
  readonly leaseExpiresAt: Date;
}

export type CrawlExecutionClaim =
  | Readonly<{ kind: "claimed"; executionToken: string; crawl: WorkerCrawlContext }>
  | Readonly<{ kind: "busy"; retryAfterMs: number }>
  | Readonly<{ kind: "terminal"; status: CrawlTerminalStatus }>
  | Readonly<{ kind: "cancelled" }>;

export type CrawlPreClaimFailureResult =
  | Readonly<{ kind: "retryable" | "already_terminal" | "cancelled" }>
  | Readonly<{ kind: "busy"; retryAfterMs: number }>
  | Readonly<{ kind: "failed"; status: "failed" | "partially_completed" }>;

export interface WorkerCrawlContext {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly traceId: string;
  readonly status: "validating";
  readonly config: StoredCrawlConfigSnapshot;
  readonly counters: CrawlProgressCounters;
}

export interface DiscoveredUrlInput {
  readonly requestedUrl: string;
  readonly discoveredUrl: string;
  readonly normalizedUrl: string;
  readonly urlHash: string;
  readonly origin: string;
  readonly hostname: string;
  readonly depth: number;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly discoveredFromFrontierId: string | null;
}

export interface PageObservationInput {
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
  readonly responseHeaders?: StoredHeaderMap;
  readonly omittedResponseHeaders?: readonly string[];
  readonly contentLength?: number | null;
  readonly responseBytes: number;
  readonly transferSize?: number;
  readonly compression?: string | null;
  readonly cacheHeaders?: StoredHeaderMap;
  readonly securityHeaders?: StoredHeaderMap;
  readonly depth: number;
  readonly redirectChain: readonly StoredRedirectHop[];
  readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId?: string | null;
  readonly timing: StoredFetchTiming | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly outcome: "succeeded" | "failed" | "blocked" | "skipped";
  readonly countsTowardPageLimit?: boolean;
}

export interface RobotsObservationInput {
  readonly origin: string;
  readonly hostname: string;
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly result: "fetched" | "not_found" | "unavailable" | "invalid";
  readonly userAgent: string;
  readonly contentSha256: string | null;
  readonly content: string | null;
  readonly crawlDelayMs: number | null;
  readonly sitemapUrls: readonly string[];
  readonly fetchedAt: Date;
}

export interface CrawlJobScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
}

export interface CrawlExecutionContext extends CrawlJobScope {
  readonly executionToken: string;
}

export interface ResumableFrontierEntry {
  readonly countsTowardPageLimit: boolean;
  readonly depth: number;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly normalizedUrl: string;
  readonly requestedUrl: string;
  readonly urlHash: string;
}

export type PageExtractionSource = "raw" | "rendered";

export interface PageHeadingInput {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly ordinal: number;
  readonly text: string;
}

export interface PageLinkInput {
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

export interface PageImageInput {
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

export interface PageResourceInput {
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

export interface PageStructuredDataInput {
  readonly kind: "json_ld" | "microdata";
  readonly parseStatus: "parsed" | "invalid";
  readonly schemaTypes: readonly string[];
  readonly rawValue: string;
  readonly parsedValue: unknown | null;
  readonly errorMessage: string | null;
  readonly ordinal: number;
}

export interface PageExtractionInput {
  readonly pageId: string;
  readonly source: PageExtractionSource;
  readonly status: "succeeded" | "failed";
  readonly title: string | null;
  readonly documentMetadataComplete?: boolean;
  readonly titleTagCount?: number;
  readonly metaDescription: string | null;
  readonly metaDescriptionTagCount?: number;
  readonly metaRobots: readonly string[];
  readonly xRobotsTag: readonly string[];
  readonly directiveScopePreserved: boolean;
  /** Legacy repository callers default to false; production workers provide this explicitly. */
  readonly linksComplete?: boolean;
  readonly canonicalUrl: string | null;
  readonly canonicalTagCount: number;
  readonly canonicalNormalizationFailure: CanonicalNormalizationFailure | null;
  readonly metaRefreshUrl?: string | null;
  readonly javascriptRedirectUrl?: string | null;
  readonly visibleText: string | null;
  /** Legacy repository callers default to false; production workers provide this explicitly. */
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
  readonly openGraph: StoredSocialMetadata;
  readonly socialCards: StoredSocialMetadata;
  readonly contentHash: string | null;
  readonly domHash: string | null;
  readonly similarityFingerprint: string | null;
  readonly meaningfulContent: boolean;
  readonly clientRendered: boolean;
  readonly renderingErrorType: string | null;
  readonly renderingErrorMessage: string | null;
  readonly headings: readonly PageHeadingInput[];
  readonly links: readonly PageLinkInput[];
  readonly images: readonly PageImageInput[];
  readonly resources: readonly PageResourceInput[];
  readonly structuredData: readonly PageStructuredDataInput[];
  readonly extractedAt: Date;
}

export interface PageArtifactInput {
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

export interface SitemapEntryInput {
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

export interface SitemapObservationInput {
  readonly parentSitemapId: string | null;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string | null;
  readonly urlHash: string;
  readonly source: "robots" | "submitted" | "default" | "nested";
  readonly status: "parsed" | "failed" | "skipped";
  readonly robotsDecision?: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId?: string | null;
  readonly format: "urlset" | "index" | "unknown";
  readonly compression: "identity" | "gzip";
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly transferSize: number;
  readonly contentDigest: string | null;
  readonly depth: number;
  readonly redirectChain: readonly StoredRedirectHop[];
  readonly parseIssues: readonly Readonly<{
    code: string;
    entryIndex: number | null;
    message: string;
  }>[];
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly fetchedAt: Date | null;
  readonly parsedAt: Date | null;
  readonly entries: readonly SitemapEntryInput[];
}

export interface CrawlPageCursor {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly depth: number;
  readonly normalizedUrl: string;
  readonly pageId: string;
}

export interface CrawlPageRecord {
  readonly id: string;
  readonly crawlId: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string | null;
  readonly urlHash: string;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly htmlDetected: boolean | null;
  readonly htmlDetectionSource: "bounded_response_prefix" | null;
  readonly htmlDetectionBytes: number | null;
  readonly responseHeaders: StoredHeaderMap;
  readonly omittedResponseHeaders: readonly string[];
  readonly contentLength: number | null;
  readonly responseBytes: number;
  readonly transferSize: number;
  readonly compression: string | null;
  readonly cacheHeaders: StoredHeaderMap;
  readonly securityHeaders: StoredHeaderMap;
  readonly depth: number;
  readonly redirectChain: readonly StoredRedirectHop[];
  readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly timing: StoredFetchTiming | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly discoverySource: "seed" | "link" | "sitemap" | "robots_sitemap" | "redirect";
  readonly fetchedAt: Date | null;
}

export interface CrawlPageConnection {
  readonly items: readonly CrawlPageRecord[];
  readonly nextCursor: CrawlPageCursor | null;
}

export interface CrawlPageDetailRecord {
  readonly page: CrawlPageRecord;
  readonly extractions: readonly CrawlPageDetailExtractionRecord[];
  readonly artifacts: readonly (typeof crawlPageArtifacts.$inferSelect)[];
  readonly headings: readonly (typeof crawlPageHeadings.$inferSelect)[];
  readonly links: readonly (typeof crawlPageLinks.$inferSelect)[];
  readonly images: readonly (typeof crawlPageImages.$inferSelect)[];
  readonly resources: readonly (typeof crawlPageResources.$inferSelect)[];
  readonly structuredData: readonly (typeof crawlPageStructuredData.$inferSelect)[];
  readonly collectionTruncated: Readonly<{
    headings: boolean;
    links: boolean;
    images: boolean;
    resources: boolean;
    structuredData: boolean;
  }>;
}

export type CrawlPageDetailExtractionRecord = typeof crawlPageExtractions.$inferSelect &
  Readonly<{ visibleTextTruncated: boolean }>;

export interface CrawlSitemapRecord {
  readonly sitemap: Readonly<typeof crawlSitemaps.$inferSelect>;
  readonly entries: readonly (typeof crawlSitemapEntries.$inferSelect)[];
}

type Transaction = Parameters<Parameters<SearviaDatabase["transaction"]>[0]>[0];

const TERMINAL_STATUS_SET = new Set<CrawlStatus>(CRAWL_TERMINAL_STATUSES);
const MAX_SAFE_ERROR_LENGTH = 2_000;
const MAX_PERSISTED_ROBOTS_BYTES = 500_000;
const PAGE_DETAIL_LIMITS = Object.freeze({
  headings: 200,
  links: 100,
  images: 50,
  resources: 100,
  structuredData: 10,
  visibleTextCharacters: 10_000,
});

function boundedRows<T>(
  rows: readonly T[],
  limit: number,
): Readonly<{
  items: readonly T[];
  truncated: boolean;
}> {
  return Object.freeze({
    items: Object.freeze(rows.slice(0, limit)),
    truncated: rows.length > limit,
  });
}

function safeErrorText(value: string): string {
  const normalized = value
    .replace(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, MAX_SAFE_ERROR_LENGTH);
  return normalized.length === 0 ? "No additional details." : normalized;
}

function safeErrorType(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 120);
  return normalized.length === 0 ? "crawl_error" : normalized;
}

async function assertRobotsDecisionProvenance(
  transaction: Transaction,
  context: CrawlJobScope,
  expectedUrl: string,
  decision: "not_checked" | "allowed" | "disallowed",
  observationId: string | null | undefined,
): Promise<void> {
  // Undefined is retained only for pre-provenance repository callers and old
  // rows. The worker contract always supplies this field, including explicit
  // null, so every production write is checked here.
  if (observationId === undefined) return;
  if (observationId === null) {
    if (decision !== "not_checked") {
      throw new TypeError("A conclusive robots decision requires observation provenance.");
    }
    return;
  }
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(expectedUrl).origin;
  } catch {
    throw new TypeError("Robots provenance requires a valid normalized destination URL.");
  }
  const [observation] = await transaction
    .select({ origin: crawlRobots.origin, result: crawlRobots.result })
    .from(crawlRobots)
    .where(
      and(
        eq(crawlRobots.organizationId, context.organizationId),
        eq(crawlRobots.projectId, context.projectId),
        eq(crawlRobots.crawlId, context.crawlId),
        eq(crawlRobots.id, observationId),
      ),
    )
    .limit(1);
  if (observation === undefined) {
    throw new DatabaseDomainError("NOT_FOUND", "Robots observation not found.");
  }
  if (observation.origin !== expectedOrigin) {
    throw new TypeError(
      "Robots observation origin does not match the effective destination origin.",
    );
  }
  const conclusive =
    decision === "not_checked" ||
    (decision === "allowed" &&
      (observation.result === "fetched" || observation.result === "not_found")) ||
    (decision === "disallowed" && observation.result === "fetched");
  if (!conclusive) {
    throw new TypeError(
      "An unavailable robots observation cannot produce a conclusive robots decision.",
    );
  }
}

function pageObservationValues(input: PageObservationInput, now: Date) {
  const htmlDetected = input.htmlDetected ?? null;
  const htmlDetectionSource = input.htmlDetectionSource ?? null;
  const htmlDetectionBytes = input.htmlDetectionBytes ?? null;
  const hasCompleteHtmlDetection =
    htmlDetected !== null &&
    htmlDetectionSource === "bounded_response_prefix" &&
    Number.isInteger(htmlDetectionBytes) &&
    htmlDetectionBytes !== null &&
    htmlDetectionBytes >= 0 &&
    htmlDetectionBytes <= 4_096;
  const hasNoHtmlDetection =
    htmlDetected === null && htmlDetectionSource === null && htmlDetectionBytes === null;
  if (!hasCompleteHtmlDetection && !hasNoHtmlDetection) {
    throw new TypeError(
      "HTML detection requires a bounded response-prefix source and inspected-byte provenance.",
    );
  }
  return {
    requestedUrl: input.requestedUrl,
    normalizedUrl: input.normalizedUrl,
    finalUrl: input.finalUrl,
    urlHash: input.urlHash,
    statusCode: input.statusCode,
    contentType: input.contentType,
    htmlDetected,
    htmlDetectionSource,
    htmlDetectionBytes,
    responseHeaders: input.responseHeaders ?? {},
    omittedResponseHeaders: [...(input.omittedResponseHeaders ?? [])],
    contentLength: input.contentLength ?? null,
    responseBytes: input.responseBytes,
    transferSize: input.transferSize ?? input.responseBytes,
    compression: input.compression ?? null,
    cacheHeaders: input.cacheHeaders ?? {},
    securityHeaders: input.securityHeaders ?? {},
    depth: input.depth,
    redirectChain: input.redirectChain,
    robotsDecision: input.robotsDecision,
    robotsObservationId: input.robotsObservationId ?? null,
    timing: input.timing,
    errorType: input.errorType === null ? null : safeErrorType(input.errorType),
    errorMessage: input.errorMessage === null ? null : safeErrorText(input.errorMessage),
    discoverySource: input.discoverySource,
    fetchedAt: now,
    updatedAt: now,
  };
}

function assertRedirectSignalUrl(name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) return;
  if (value.length > 4_096) throw new TypeError(`${name} cannot exceed 4096 characters.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be a normalized HTTP(S) URL.`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname === "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.href !== value
  ) {
    throw new TypeError(`${name} must be a credential-free HTTP(S) URL.`);
  }
}

function hashIdempotencyKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 128 || /\p{Cc}/u.test(value)) {
    throw new DatabaseDomainError(
      "CONFLICT",
      "The idempotency key must contain 8 to 128 visible characters.",
    );
  }
}

function assertCapability(role: OrganizationRole, capability: OrganizationCapability): void {
  if (!roleHasCapability(role, capability)) {
    throw new DatabaseDomainError("FORBIDDEN", "You do not have permission for this action.");
  }
}

function mapProgress(row: typeof crawls.$inferSelect): CrawlProgressRecord {
  return Object.freeze({
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    cancellationRequested: row.cancellationRequestedAt !== null,
    discoveredCount: row.discoveredCount,
    processedCount: row.processedCount,
    succeededCount: row.succeededCount,
    failedCount: row.failedCount,
    blockedCount: row.blockedCount,
    skippedCount: row.skippedCount,
    extractedPageCount: row.extractedPageCount,
    extractionFailedCount: row.extractionFailedCount,
    renderedPageCount: row.renderedPageCount,
    artifactCount: row.artifactCount,
    sitemapCount: row.sitemapCount,
    sitemapUrlCount: row.sitemapUrlCount,
    bytesReceived: row.bytesReceived,
    attemptCount: row.attemptCount,
    completionReason: row.completionReason,
    errorType: row.errorType,
    errorMessage: row.errorMessage,
    traceId: row.traceId,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    lastProgressAt: row.lastProgressAt,
  });
}

function mapPage(row: typeof crawlPages.$inferSelect): CrawlPageRecord {
  return Object.freeze({
    id: row.id,
    crawlId: row.crawlId,
    requestedUrl: row.requestedUrl,
    normalizedUrl: row.normalizedUrl,
    finalUrl: row.finalUrl,
    urlHash: row.urlHash,
    statusCode: row.statusCode,
    contentType: row.contentType,
    htmlDetected: row.htmlDetected,
    htmlDetectionSource: row.htmlDetectionSource,
    htmlDetectionBytes: row.htmlDetectionBytes,
    responseHeaders: row.responseHeaders,
    omittedResponseHeaders: row.omittedResponseHeaders,
    contentLength: row.contentLength,
    responseBytes: row.responseBytes,
    transferSize: row.transferSize,
    compression: row.compression,
    cacheHeaders: row.cacheHeaders,
    securityHeaders: row.securityHeaders,
    depth: row.depth,
    redirectChain: row.redirectChain,
    robotsDecision: row.robotsDecision,
    robotsObservationId: row.robotsObservationId,
    timing: row.timing,
    errorType: row.errorType,
    errorMessage: row.errorMessage,
    discoverySource: row.discoverySource,
    fetchedAt: row.fetchedAt,
  });
}

function assertCollectionLimit(name: string, length: number, limit: number): void {
  if (length > limit) {
    throw new TypeError(`${name} cannot contain more than ${String(limit)} records.`);
  }
}

const CANONICAL_NORMALIZATION_FAILURE_CODE_SET = new Set<string>(
  CANONICAL_NORMALIZATION_FAILURE_CODES,
);

function assertCanonicalNormalizationProvenance(input: PageExtractionInput): void {
  const failure = input.canonicalNormalizationFailure;
  if (failure !== null && !CANONICAL_NORMALIZATION_FAILURE_CODE_SET.has(failure.code)) {
    throw new TypeError("The canonical normalization failure code is unsupported.");
  }
  if (input.canonicalUrl !== null) {
    let parsed: URL;
    try {
      parsed = new URL(input.canonicalUrl);
    } catch {
      throw new TypeError("The normalized canonical URL is invalid.");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.hostname === "" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new TypeError("The normalized canonical URL must be a credential-free HTTP(S) URL.");
    }
  }
  if (input.canonicalTagCount !== 1) {
    if (failure !== null) {
      throw new TypeError(
        "Canonical normalization failure provenance requires exactly one declaration.",
      );
    }
    return;
  }
  const normalized = input.canonicalUrl !== null;
  const failed = failure !== null;
  if (normalized === failed) {
    throw new TypeError(
      "A single canonical declaration requires either a normalized URL or a structured failure.",
    );
  }
}

function chunk<T>(values: readonly T[], size = 250): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function targetPageIdsByUrlHash(
  transaction: Transaction,
  scope: CrawlJobScope,
  urlHashes: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const uniqueHashes = [...new Set(urlHashes)];
  const result = new Map<string, string>();
  for (const hashBatch of chunk(uniqueHashes)) {
    if (hashBatch.length === 0) continue;
    const pages = await transaction
      .select({ id: crawlPages.id, urlHash: crawlPages.urlHash })
      .from(crawlPages)
      .where(
        and(
          eq(crawlPages.organizationId, scope.organizationId),
          eq(crawlPages.projectId, scope.projectId),
          eq(crawlPages.crawlId, scope.crawlId),
          inArray(crawlPages.urlHash, hashBatch),
        ),
      );
    for (const page of pages) result.set(page.urlHash, page.id);
  }
  return result;
}

async function backfillTargetPageReferences(
  transaction: Transaction,
  scope: CrawlJobScope,
  page: Readonly<{ id: string; urlHash: string }>,
): Promise<void> {
  const tenantTarget = [
    eq(crawlPageLinks.organizationId, scope.organizationId),
    eq(crawlPageLinks.projectId, scope.projectId),
    eq(crawlPageLinks.crawlId, scope.crawlId),
    eq(crawlPageLinks.targetUrlHash, page.urlHash),
    isNull(crawlPageLinks.targetPageId),
  ] as const;
  await transaction
    .update(crawlPageLinks)
    .set({ targetPageId: page.id })
    .where(and(...tenantTarget));
  await transaction
    .update(crawlSitemapEntries)
    .set({ targetPageId: page.id })
    .where(
      and(
        eq(crawlSitemapEntries.organizationId, scope.organizationId),
        eq(crawlSitemapEntries.projectId, scope.projectId),
        eq(crawlSitemapEntries.crawlId, scope.crawlId),
        eq(crawlSitemapEntries.entryType, "url"),
        eq(crawlSitemapEntries.urlHash, page.urlHash),
        isNull(crawlSitemapEntries.targetPageId),
      ),
    );
}

async function reconcileTargetPageReferences(
  transaction: Transaction,
  scope: CrawlJobScope,
): Promise<void> {
  const pages = await transaction
    .select({ id: crawlPages.id, urlHash: crawlPages.urlHash })
    .from(crawlPages)
    .where(
      and(
        eq(crawlPages.organizationId, scope.organizationId),
        eq(crawlPages.projectId, scope.projectId),
        eq(crawlPages.crawlId, scope.crawlId),
      ),
    );
  for (const page of pages) await backfillTargetPageReferences(transaction, scope, page);
}

async function requireFreshScope(
  transaction: Transaction,
  scope: OrganizationScope,
  capability: OrganizationCapability,
  lock = false,
): Promise<OrganizationRole> {
  const now = new Date();
  let query = transaction
    .select({ role: memberships.role })
    .from(sessions)
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, scope.membership.id),
        eq(memberships.organizationId, scope.organization.id),
        eq(memberships.userId, sessions.userId),
        eq(memberships.status, "active"),
      ),
    )
    .innerJoin(
      organizations,
      and(eq(organizations.id, memberships.organizationId), isNull(organizations.deletedAt)),
    )
    .where(
      and(
        eq(sessions.id, scope.sessionId),
        eq(sessions.userId, scope.userId),
        eq(sessions.activeOrganizationId, scope.organization.id),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (lock) {
    query = query.for("share", { of: [sessions, memberships, organizations] }) as typeof query;
  }

  const [actor] = await query;

  if (actor === undefined) {
    throw new DatabaseDomainError("UNAUTHENTICATED", "Your session is no longer active.");
  }

  assertCapability(actor.role, capability);
  return actor.role;
}

async function requireProject(
  transaction: Transaction,
  scope: OrganizationScope,
  projectId: string,
  capability: OrganizationCapability,
  lock = false,
): Promise<typeof projects.$inferSelect> {
  const role = await requireFreshScope(transaction, scope, capability, lock);
  let query = transaction
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, scope.organization.id),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);

  if (lock) {
    query = query.for("update") as typeof query;
  }

  const [project] = await query;
  if (project === undefined) {
    throw new DatabaseDomainError("NOT_FOUND", "Project not found.");
  }

  if (role === "client") {
    const [projectScope] = await transaction
      .select({ projectId: membershipProjectScopes.projectId })
      .from(membershipProjectScopes)
      .where(
        and(
          eq(membershipProjectScopes.organizationId, scope.organization.id),
          eq(membershipProjectScopes.membershipId, scope.membership.id),
          eq(membershipProjectScopes.projectId, projectId),
        ),
      )
      .limit(1);

    if (projectScope === undefined) {
      throw new DatabaseDomainError("NOT_FOUND", "Project not found.");
    }
  }

  return project;
}

async function writeUserAudit(
  transaction: Transaction,
  scope: OrganizationScope,
  event: Readonly<{
    action: string;
    targetId: string;
    traceId: string;
    metadata?: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    organizationId: scope.organization.id,
    actorKind: "user",
    actorUserId: scope.userId,
    actorMembershipId: scope.membership.id,
    action: event.action,
    targetType: "crawl",
    targetId: event.targetId,
    traceId: event.traceId,
    metadata: event.metadata ?? {},
  });
}

async function writeSystemAudit(
  transaction: Transaction,
  input: Readonly<{
    organizationId: string;
    action: string;
    targetId: string;
    traceId: string;
    metadata?: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    organizationId: input.organizationId,
    actorKind: "system",
    actorUserId: null,
    actorMembershipId: null,
    action: input.action,
    targetType: "crawl",
    targetId: input.targetId,
    traceId: input.traceId,
    metadata: input.metadata ?? {},
  });
}

function buildConfigSnapshot(
  project: typeof projects.$inferSelect,
  config: typeof crawlConfigs.$inferSelect,
): StoredCrawlConfigSnapshot {
  return Object.freeze({
    version: config.version,
    startUrl: `${project.normalizedOrigin}/`,
    pageLimit: config.pageLimit,
    maxDepth: config.maxDepth,
    includeSubdomains: config.includeSubdomains,
    respectRobots: true,
    requestDelayMs: config.requestDelayMs,
    concurrency: config.concurrency,
    includePatterns: [...config.includePatterns],
    excludePatterns: [...config.excludePatterns],
    queryPolicy: config.queryPolicy,
    userAgent: config.userAgent,
    redirectLimit: config.redirectLimit,
    maxResponseBytes: config.maxResponseBytes,
    requestTimeoutMs: config.requestTimeoutMs,
    totalTimeoutMs: config.totalTimeoutMs,
    supportedContentTypes: [...config.supportedContentTypes],
    renderingEnabled: config.renderingEnabled,
    submittedSitemapUrls: [...config.submittedSitemapUrls],
  });
}

async function releaseUsage(
  transaction: Transaction,
  scope: CrawlJobScope,
  processedCount: number,
  now: Date,
): Promise<void> {
  await transaction
    .update(crawlUsageReservations)
    .set({
      consumedPages: processedCount,
      status: processedCount > 0 ? "consumed" : "released",
      releasedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(crawlUsageReservations.organizationId, scope.organizationId),
        eq(crawlUsageReservations.projectId, scope.projectId),
        eq(crawlUsageReservations.crawlId, scope.crawlId),
      ),
    );
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureAuditEvaluationOutbox(
  transaction: Transaction,
  crawl: typeof crawls.$inferSelect,
  now: Date,
): Promise<void> {
  if (crawl.status !== "completed" && crawl.status !== "partially_completed") return;
  await reconcileTargetPageReferences(transaction, {
    organizationId: crawl.organizationId,
    projectId: crawl.projectId,
    crawlId: crawl.id,
  });
  if (crawl.finishedAt === null) {
    throw new DatabaseDomainError(
      "CONFLICT",
      "A terminal crawl must have a completion timestamp before audit evaluation is queued.",
    );
  }

  const idempotencyKey = `audit-${crawl.id}`;
  const payload: AuditEvaluateJobPayload = {
    contractVersion: 1,
    jobType: "audit.evaluate",
    organizationId: crawl.organizationId,
    projectId: crawl.projectId,
    crawlId: crawl.id,
    traceId: crawl.traceId,
    idempotencyKey,
    crawlStatus: crawl.status,
    crawlFinishedAt: crawl.finishedAt.toISOString(),
  };

  await transaction
    .insert(jobOutbox)
    .values({
      organizationId: crawl.organizationId,
      projectId: crawl.projectId,
      crawlId: crawl.id,
      jobType: "audit.evaluate",
      contractVersion: 1,
      payload,
      idempotencyKey,
      traceId: crawl.traceId,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [jobOutbox.crawlId, jobOutbox.jobType] });

  const [stored] = await transaction
    .select({
      contractVersion: jobOutbox.contractVersion,
      idempotencyKey: jobOutbox.idempotencyKey,
      organizationId: jobOutbox.organizationId,
      payload: jobOutbox.payload,
      projectId: jobOutbox.projectId,
      traceId: jobOutbox.traceId,
    })
    .from(jobOutbox)
    .where(and(eq(jobOutbox.crawlId, crawl.id), eq(jobOutbox.jobType, "audit.evaluate")))
    .limit(1);
  const storedPayload = stored?.payload;
  if (
    stored === undefined ||
    stored.contractVersion !== 1 ||
    stored.idempotencyKey !== idempotencyKey ||
    stored.organizationId !== crawl.organizationId ||
    stored.projectId !== crawl.projectId ||
    stored.traceId !== crawl.traceId ||
    !isJsonRecord(storedPayload) ||
    storedPayload.contractVersion !== 1 ||
    storedPayload.jobType !== "audit.evaluate" ||
    storedPayload.organizationId !== crawl.organizationId ||
    storedPayload.projectId !== crawl.projectId ||
    storedPayload.crawlId !== crawl.id ||
    storedPayload.traceId !== crawl.traceId ||
    storedPayload.idempotencyKey !== idempotencyKey ||
    storedPayload.crawlStatus !== crawl.status ||
    storedPayload.crawlFinishedAt !== crawl.finishedAt.toISOString()
  ) {
    throw new DatabaseDomainError(
      "CONFLICT",
      "The existing audit evaluation outbox intent conflicts with the completed crawl.",
    );
  }
}

export class SearviaCrawlRepository {
  readonly #db: SearviaDatabase;
  readonly #auditSnapshotCollectionLimits: Readonly<Required<AuditSnapshotCollectionLimits>>;

  constructor(database: SearviaDatabase, limits?: AuditSnapshotCollectionLimits) {
    this.#db = database;
    this.#auditSnapshotCollectionLimits = auditSnapshotCollectionLimits(limits);
  }

  async loadAuditCrawlSnapshot(scope: WorkerAuditSnapshotScope): Promise<WorkerAuditCrawlSnapshot> {
    const [storedCrawl] = await this.#db
      .select({
        crawl: getTableColumns(crawls),
        origin: projects.normalizedOrigin,
      })
      .from(crawls)
      .innerJoin(
        projects,
        and(eq(projects.organizationId, crawls.organizationId), eq(projects.id, crawls.projectId)),
      )
      .where(
        and(
          eq(crawls.organizationId, scope.organizationId),
          eq(crawls.projectId, scope.projectId),
          eq(crawls.id, scope.crawlId),
        ),
      )
      .limit(1);
    if (storedCrawl === undefined) {
      throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
    }
    const crawl = storedCrawl.crawl;
    if (crawl.status !== "completed" && crawl.status !== "partially_completed") {
      throw new DatabaseDomainError(
        "CONFLICT",
        "Only completed or partially completed crawls can be evaluated.",
      );
    }
    if (crawl.startedAt === null || crawl.finishedAt === null) {
      throw new DatabaseDomainError(
        "CONFLICT",
        "The completed crawl is missing required lifecycle timestamps.",
      );
    }

    const tenantCrawl = and(
      eq(crawlPages.organizationId, scope.organizationId),
      eq(crawlPages.projectId, scope.projectId),
      eq(crawlPages.crawlId, scope.crawlId),
    );
    const [
      pages,
      successfulExtractions,
      headings,
      links,
      resources,
      robots,
      sitemaps,
      sitemapEntries,
      historicalPages,
    ] = await Promise.all([
      this.#db
        .select()
        .from(crawlPages)
        .where(tenantCrawl)
        .orderBy(asc(crawlPages.depth), asc(crawlPages.normalizedUrl), asc(crawlPages.id)),
      this.#db
        .select({
          ...getTableColumns(crawlPageExtractions),
          visibleText: sql<
            string | null
          >`left(${crawlPageExtractions.visibleText}, ${AUDIT_VISIBLE_TEXT_CHARACTER_LIMIT})`,
          visibleTextTruncated: sql<boolean>`coalesce(char_length(${crawlPageExtractions.visibleText}), 0) > ${AUDIT_VISIBLE_TEXT_CHARACTER_LIMIT}`,
        })
        .from(crawlPageExtractions)
        .where(
          and(
            eq(crawlPageExtractions.organizationId, scope.organizationId),
            eq(crawlPageExtractions.projectId, scope.projectId),
            eq(crawlPageExtractions.crawlId, scope.crawlId),
            eq(crawlPageExtractions.status, "succeeded"),
          ),
        )
        .orderBy(asc(crawlPageExtractions.pageId), asc(crawlPageExtractions.id)),
      this.#db
        .select(getTableColumns(crawlPageHeadings))
        .from(crawlPageHeadings)
        .innerJoin(
          crawlPageExtractions,
          and(
            eq(crawlPageExtractions.organizationId, crawlPageHeadings.organizationId),
            eq(crawlPageExtractions.projectId, crawlPageHeadings.projectId),
            eq(crawlPageExtractions.crawlId, crawlPageHeadings.crawlId),
            eq(crawlPageExtractions.pageId, crawlPageHeadings.pageId),
            eq(crawlPageExtractions.id, crawlPageHeadings.extractionId),
            eq(crawlPageExtractions.status, "succeeded"),
          ),
        )
        .where(
          and(
            eq(crawlPageHeadings.organizationId, scope.organizationId),
            eq(crawlPageHeadings.projectId, scope.projectId),
            eq(crawlPageHeadings.crawlId, scope.crawlId),
          ),
        )
        .orderBy(
          asc(crawlPageHeadings.pageId),
          asc(crawlPageHeadings.ordinal),
          asc(crawlPageHeadings.id),
        )
        .limit(this.#auditSnapshotCollectionLimits.headings + 1),
      this.#db
        .select(getTableColumns(crawlPageLinks))
        .from(crawlPageLinks)
        .innerJoin(
          crawlPageExtractions,
          and(
            eq(crawlPageExtractions.organizationId, crawlPageLinks.organizationId),
            eq(crawlPageExtractions.projectId, crawlPageLinks.projectId),
            eq(crawlPageExtractions.crawlId, crawlPageLinks.crawlId),
            eq(crawlPageExtractions.pageId, crawlPageLinks.sourcePageId),
            eq(crawlPageExtractions.id, crawlPageLinks.extractionId),
            eq(crawlPageExtractions.source, "raw"),
            eq(crawlPageExtractions.status, "succeeded"),
          ),
        )
        .where(
          and(
            eq(crawlPageLinks.organizationId, scope.organizationId),
            eq(crawlPageLinks.projectId, scope.projectId),
            eq(crawlPageLinks.crawlId, scope.crawlId),
          ),
        )
        .orderBy(
          asc(crawlPageLinks.sourcePageId),
          asc(crawlPageLinks.ordinal),
          asc(crawlPageLinks.id),
        )
        .limit(this.#auditSnapshotCollectionLimits.links + 1),
      this.#db
        .select(getTableColumns(crawlPageResources))
        .from(crawlPageResources)
        .innerJoin(
          crawlPageExtractions,
          and(
            eq(crawlPageExtractions.organizationId, crawlPageResources.organizationId),
            eq(crawlPageExtractions.projectId, crawlPageResources.projectId),
            eq(crawlPageExtractions.crawlId, crawlPageResources.crawlId),
            eq(crawlPageExtractions.pageId, crawlPageResources.pageId),
            eq(crawlPageExtractions.id, crawlPageResources.extractionId),
            eq(crawlPageExtractions.source, "raw"),
            eq(crawlPageExtractions.status, "succeeded"),
          ),
        )
        .where(
          and(
            eq(crawlPageResources.organizationId, scope.organizationId),
            eq(crawlPageResources.projectId, scope.projectId),
            eq(crawlPageResources.crawlId, scope.crawlId),
          ),
        )
        .orderBy(
          asc(crawlPageResources.pageId),
          asc(crawlPageResources.ordinal),
          asc(crawlPageResources.id),
        )
        .limit(this.#auditSnapshotCollectionLimits.resources + 1),
      this.#db
        .select()
        .from(crawlRobots)
        .where(
          and(
            eq(crawlRobots.organizationId, scope.organizationId),
            eq(crawlRobots.projectId, scope.projectId),
            eq(crawlRobots.crawlId, scope.crawlId),
          ),
        )
        .orderBy(asc(crawlRobots.origin), asc(crawlRobots.id)),
      this.#db
        .select()
        .from(crawlSitemaps)
        .where(
          and(
            eq(crawlSitemaps.organizationId, scope.organizationId),
            eq(crawlSitemaps.projectId, scope.projectId),
            eq(crawlSitemaps.crawlId, scope.crawlId),
          ),
        )
        .orderBy(asc(crawlSitemaps.depth), asc(crawlSitemaps.normalizedUrl), asc(crawlSitemaps.id)),
      this.#db
        .select()
        .from(crawlSitemapEntries)
        .where(
          and(
            eq(crawlSitemapEntries.organizationId, scope.organizationId),
            eq(crawlSitemapEntries.projectId, scope.projectId),
            eq(crawlSitemapEntries.crawlId, scope.crawlId),
          ),
        )
        .orderBy(
          asc(crawlSitemapEntries.sitemapId),
          asc(crawlSitemapEntries.ordinal),
          asc(crawlSitemapEntries.id),
        ),
      this.#db
        .select({
          crawlId: crawlPages.crawlId,
          crawlFinishedAt: crawls.finishedAt,
          redirectChain: crawlPages.redirectChain,
          fetchedAt: crawlPages.fetchedAt,
          updatedAt: crawlPages.updatedAt,
        })
        .from(crawlPages)
        .innerJoin(
          crawls,
          and(
            eq(crawls.organizationId, crawlPages.organizationId),
            eq(crawls.projectId, crawlPages.projectId),
            eq(crawls.id, crawlPages.crawlId),
          ),
        )
        .where(
          and(
            eq(crawlPages.organizationId, scope.organizationId),
            eq(crawlPages.projectId, scope.projectId),
            ne(crawlPages.crawlId, scope.crawlId),
            eq(crawls.status, "completed"),
            lt(crawls.finishedAt, crawl.finishedAt),
          ),
        )
        .orderBy(desc(crawls.finishedAt), asc(crawlPages.id))
        .limit(AUDIT_HISTORY_PAGE_LIMIT + 1),
    ]);

    const historicalRedirectsTruncated = historicalPages.length > AUDIT_HISTORY_PAGE_LIMIT;
    const visibleHistoricalPages = historicalPages.slice(0, AUDIT_HISTORY_PAGE_LIMIT);
    const headingsTruncated = headings.length > this.#auditSnapshotCollectionLimits.headings;
    const linksTruncated = links.length > this.#auditSnapshotCollectionLimits.links;
    const resourcesTruncated = resources.length > this.#auditSnapshotCollectionLimits.resources;
    const visibleHeadings = headings.slice(0, this.#auditSnapshotCollectionLimits.headings);
    const visibleLinks = links.slice(0, this.#auditSnapshotCollectionLimits.links);
    const visibleResources = resources.slice(0, this.#auditSnapshotCollectionLimits.resources);
    const malformedHistoricalLifecycle = visibleHistoricalPages.some(
      (page) => page.crawlFinishedAt === null,
    );

    const pageIdByUrlHash = new Map(pages.map((page) => [page.urlHash, page.id]));
    const rawExtractionByPageId = new Map(
      successfulExtractions.filter((row) => row.source === "raw").map((row) => [row.pageId, row]),
    );
    const renderedExtractionByPageId = new Map(
      successfulExtractions
        .filter((row) => row.source === "rendered")
        .map((row) => [row.pageId, row]),
    );
    const headingsByExtractionId = new Map<string, typeof visibleHeadings>();
    for (const heading of visibleHeadings) {
      const grouped = headingsByExtractionId.get(heading.extractionId);
      if (grouped === undefined) headingsByExtractionId.set(heading.extractionId, [heading]);
      else grouped.push(heading);
    }
    const auditExtraction = (extraction: (typeof successfulExtractions)[number]) => {
      const characterEncodingSource = auditCharacterEncodingSource(
        extraction.characterEncodingSource,
      );
      return Object.freeze({
        id: extraction.id,
        source: extraction.source,
        status: "succeeded" as const,
        title: extraction.title,
        documentMetadataComplete: extraction.documentMetadataComplete,
        titleTagCount: extraction.titleTagCount,
        metaDescription: extraction.metaDescription,
        metaDescriptionTagCount: extraction.metaDescriptionTagCount,
        metaRobots: Object.freeze([...extraction.metaRobots]),
        xRobotsTag: Object.freeze([...extraction.xRobotsTag]),
        directiveScopePreserved: extraction.directiveScopePreserved,
        linksComplete:
          extraction.linksComplete &&
          (extraction.source !== "raw" || (!linksTruncated && !resourcesTruncated)),
        canonicalUrl: extraction.canonicalUrl,
        canonicalTagCount: extraction.canonicalTagCount,
        canonicalNormalizationFailure:
          extraction.canonicalNormalizationFailureCode === null
            ? null
            : Object.freeze({ code: extraction.canonicalNormalizationFailureCode }),
        metaRefreshUrl: extraction.metaRefreshUrl,
        javascriptRedirectUrl: extraction.javascriptRedirectUrl,
        visibleText: extraction.visibleText,
        visibleTextComplete: extraction.visibleTextComplete && !extraction.visibleTextTruncated,
        wordCount: extraction.wordCount,
        headings: Object.freeze(
          (headingsByExtractionId.get(extraction.id) ?? []).map((heading) =>
            Object.freeze({
              id: heading.id,
              level: heading.level as 1 | 2 | 3 | 4 | 5 | 6,
              ordinal: heading.ordinal,
              text: heading.text,
            }),
          ),
        ),
        headingsComplete: extraction.headingsComplete && !headingsTruncated,
        htmlLanguage: extraction.htmlLanguage,
        characterEncoding:
          extraction.characterEncoding === null || characterEncodingSource === null
            ? null
            : Object.freeze({
                used: extraction.characterEncoding,
                declared: extraction.characterEncodingDeclared,
                source: characterEncodingSource,
                declarationOffsetBytes: extraction.characterEncodingDeclarationOffset,
              }),
        viewportDeclarations: Object.freeze([...extraction.viewportDeclarations]),
        htmlDoctypePresent: extraction.htmlDoctypePresent,
        openGraph: Object.freeze({ ...extraction.openGraph }),
        socialCards: Object.freeze({ ...extraction.socialCards }),
        iconDeclarationCount: extraction.iconDeclarationCount,
        contentHash: extraction.contentHash,
        domHash: extraction.domHash,
        similarityFingerprint: extraction.similarityFingerprint,
        meaningfulContent: extraction.meaningfulContent,
        clientRendered: extraction.clientRendered,
        extractedAt: extraction.extractedAt.toISOString(),
      });
    };
    const linksByPageId = new Map<string, typeof visibleLinks>();
    for (const link of visibleLinks) {
      const grouped = linksByPageId.get(link.sourcePageId);
      if (grouped === undefined) linksByPageId.set(link.sourcePageId, [link]);
      else grouped.push(link);
    }
    const resourcesByPageId = new Map<string, typeof visibleResources>();
    for (const resource of visibleResources) {
      const grouped = resourcesByPageId.get(resource.pageId);
      if (grouped === undefined) resourcesByPageId.set(resource.pageId, [resource]);
      else grouped.push(resource);
    }
    const robotsById = new Map(robots.map((observation) => [observation.id, observation]));
    const auditRobotsEvidence = (
      expectedUrl: string | null,
      decision: "not_checked" | "allowed" | "disallowed",
      observationId: string | null,
    ) => {
      const observation = observationId === null ? undefined : robotsById.get(observationId);
      let expectedOrigin: string | null = null;
      if (expectedUrl !== null) {
        try {
          expectedOrigin = new URL(expectedUrl).origin;
        } catch {
          // Persisted URL constraints do not prove URL parser compatibility.
        }
      }
      const boundObservation =
        expectedOrigin !== null && observation?.origin === expectedOrigin ? observation : undefined;
      const conclusive =
        (decision === "allowed" &&
          (boundObservation?.result === "fetched" || boundObservation?.result === "not_found")) ||
        (decision === "disallowed" && boundObservation?.result === "fetched");
      return Object.freeze({
        decision: decision === "not_checked" || !conclusive ? ("not-checked" as const) : decision,
        observationId: boundObservation?.id ?? null,
        result: boundObservation?.result ?? null,
      });
    };
    const entriesBySitemapId = new Map<string, typeof sitemapEntries>();
    for (const entry of sitemapEntries) {
      const grouped = entriesBySitemapId.get(entry.sitemapId);
      if (grouped === undefined) entriesBySitemapId.set(entry.sitemapId, [entry]);
      else grouped.push(entry);
    }
    const sitemapPageIds = new Set(
      sitemapEntries.flatMap((entry) =>
        entry.entryType === "url"
          ? [entry.targetPageId ?? pageIdByUrlHash.get(entry.urlHash)].filter(
              (pageId): pageId is string => pageId !== undefined,
            )
          : [],
      ),
    );
    const sitemapUrlHashes = new Set(
      sitemapEntries.flatMap((entry) => (entry.entryType === "url" ? [entry.urlHash] : [])),
    );
    const sitemapUrls = new Set(
      sitemapEntries.flatMap((entry) => (entry.entryType === "url" ? [entry.normalizedLoc] : [])),
    );
    const isHomepage = (page: (typeof pages)[number]): boolean => {
      if (page.discoverySource === "seed") return true;
      for (const candidate of [page.normalizedUrl, page.finalUrl]) {
        if (candidate === null) continue;
        try {
          const url = new URL(candidate);
          if (
            url.origin === storedCrawl.origin &&
            url.pathname === "/" &&
            url.search === "" &&
            url.hash === ""
          ) {
            return true;
          }
        } catch {
          // Persisted URL constraints do not prove URL parser compatibility.
        }
      }
      return false;
    };

    return Object.freeze({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      crawlId: scope.crawlId,
      origin: storedCrawl.origin,
      status: crawl.status,
      startedAt: crawl.startedAt.toISOString(),
      finishedAt: crawl.finishedAt.toISOString(),
      errorType: crawl.errorType,
      configuration: Object.freeze({
        maxDepth: crawl.configSnapshot.maxDepth,
        redirectLimit: crawl.configSnapshot.redirectLimit,
        maxResponseBytes: crawl.configSnapshot.maxResponseBytes,
        queryPolicy: crawl.configSnapshot.queryPolicy,
      }),
      pages: Object.freeze(
        pages.map((page) => {
          const extraction = rawExtractionByPageId.get(page.id);
          const renderedExtraction = renderedExtractionByPageId.get(page.id);
          const pageRobots = auditRobotsEvidence(
            page.normalizedUrl,
            page.robotsDecision,
            page.robotsObservationId,
          );
          const listedInSitemap =
            sitemapPageIds.has(page.id) ||
            sitemapUrlHashes.has(page.urlHash) ||
            sitemapUrls.has(page.normalizedUrl) ||
            (page.finalUrl !== null && sitemapUrls.has(page.finalUrl));
          const homepage = isHomepage(page);
          return Object.freeze({
            id: page.id,
            requestedUrl: page.requestedUrl,
            normalizedUrl: page.normalizedUrl,
            urlHash: page.urlHash,
            finalUrl: page.finalUrl,
            statusCode: page.statusCode,
            contentType: page.contentType,
            htmlDetected: page.htmlDetected,
            htmlDetectionSource: page.htmlDetectionSource,
            htmlDetectionBytes: page.htmlDetectionBytes,
            contentLength: page.contentLength,
            responseBytes: page.responseBytes,
            transferSize: page.transferSize,
            compression: page.compression,
            responseHeaders: page.responseHeaders,
            securityHeaders: page.securityHeaders,
            depth: page.depth,
            redirectChain: Object.freeze([...page.redirectChain]),
            robotsDecision: pageRobots.decision,
            robotsObservationId: pageRobots.observationId,
            robotsResult: pageRobots.result,
            errorType: page.errorType,
            errorMessage: page.errorMessage,
            discoverySource: page.discoverySource,
            observedAt: (page.fetchedAt ?? page.updatedAt).toISOString(),
            extraction: extraction === undefined ? null : auditExtraction(extraction),
            renderedExtraction:
              renderedExtraction === undefined ? null : auditExtraction(renderedExtraction),
            links: Object.freeze(
              (linksByPageId.get(page.id) ?? []).map((link) =>
                Object.freeze({
                  id: link.id,
                  targetPageId:
                    link.targetPageId ?? pageIdByUrlHash.get(link.targetUrlHash) ?? null,
                  targetUrl: link.targetUrl,
                  normalizedTargetUrl: link.normalizedTargetUrl,
                  scope: link.scope,
                  anchorText: link.anchorText,
                  relValues: Object.freeze([...link.relValues]),
                  linkType: link.linkType,
                  discovered: link.discovered,
                  crawlDepth: link.crawlDepth,
                  discoverySource: link.discoverySource,
                  ordinal: link.ordinal,
                }),
              ),
            ),
            resources: Object.freeze(
              (resourcesByPageId.get(page.id) ?? []).map((resource) => {
                const resourceRobots = auditRobotsEvidence(
                  resource.normalizedUrl,
                  resource.robotsDecision,
                  resource.robotsObservationId,
                );
                return Object.freeze({
                  id: resource.id,
                  resourceType: resource.resourceType,
                  sourceUrl: resource.sourceUrl,
                  normalizedUrl: resource.normalizedUrl,
                  scope: resource.scope,
                  robotsDecision: resourceRobots.decision,
                  robotsObservationId: resourceRobots.observationId,
                  robotsResult: resourceRobots.result,
                });
              }),
            ),
            importance: homepage
              ? ("homepage" as const)
              : listedInSitemap
                ? ("important" as const)
                : ("standard" as const),
            indexabilityIntent:
              homepage || listedInSitemap ? ("intended" as const) : ("unknown" as const),
          });
        }),
      ),
      robots: Object.freeze(
        robots.map((observation) =>
          Object.freeze({
            id: observation.id,
            origin: observation.origin,
            requestedUrl: observation.requestedUrl,
            finalUrl: observation.finalUrl,
            statusCode: observation.statusCode,
            result: observation.result,
            userAgent: observation.userAgent,
            content: observation.result === "fetched" ? observation.content : null,
            sitemapUrls: Object.freeze([...observation.sitemapUrls]),
            fetchedAt: observation.fetchedAt.toISOString(),
          }),
        ),
      ),
      sitemaps: Object.freeze(
        sitemaps.map((sitemap) => {
          const sitemapRobots = auditRobotsEvidence(
            sitemap.normalizedUrl,
            sitemap.robotsDecision,
            sitemap.robotsObservationId,
          );
          return Object.freeze({
            id: sitemap.id,
            requestedUrl: sitemap.requestedUrl,
            normalizedUrl: sitemap.normalizedUrl,
            urlHash: sitemap.urlHash,
            finalUrl: sitemap.finalUrl,
            source: sitemap.source,
            status: sitemap.status,
            format: sitemap.format,
            statusCode: sitemap.statusCode,
            robotsDecision: sitemapRobots.decision,
            robotsObservationId: sitemapRobots.observationId,
            robotsResult: sitemapRobots.result,
            contentLength: sitemap.contentLength,
            transferSize: sitemap.transferSize,
            depth: sitemap.depth,
            redirectChain: Object.freeze([...sitemap.redirectChain]),
            parseIssues: Object.freeze([...sitemap.parseIssues]),
            errorType: sitemap.errorType,
            errorMessage: sitemap.errorMessage,
            observedAt: (sitemap.fetchedAt ?? sitemap.parsedAt ?? sitemap.updatedAt).toISOString(),
            entries: Object.freeze(
              (entriesBySitemapId.get(sitemap.id) ?? []).map((entry) =>
                Object.freeze({
                  id: entry.id,
                  entryType: entry.entryType,
                  loc: entry.loc,
                  normalizedLoc: entry.normalizedLoc,
                  targetPageId: entry.targetPageId ?? pageIdByUrlHash.get(entry.urlHash) ?? null,
                }),
              ),
            ),
          });
        }),
      ),
      historicalRedirects: Object.freeze(
        visibleHistoricalPages.flatMap((page) => {
          const crawlFinishedAt = page.crawlFinishedAt?.toISOString();
          if (crawlFinishedAt === undefined) return [];
          return page.redirectChain.flatMap((hop) =>
            hop.statusCode === 302 || hop.statusCode === 307
              ? [
                  Object.freeze({
                    crawlId: page.crawlId,
                    crawlFinishedAt,
                    requestedUrl: hop.requestedUrl,
                    resolvedUrl: hop.resolvedUrl,
                    statusCode: hop.statusCode,
                    observedAt: (page.fetchedAt ?? page.updatedAt).toISOString(),
                  }),
                ]
              : [],
          );
        }),
      ),
      historicalRedirectCoverage: Object.freeze({
        complete: !historicalRedirectsTruncated && !malformedHistoricalLifecycle,
        truncated: historicalRedirectsTruncated,
        pageObservationLimit: AUDIT_HISTORY_PAGE_LIMIT,
        loadedPageObservationCount: visibleHistoricalPages.length,
        loadedCrawlCount: new Set(visibleHistoricalPages.map((page) => page.crawlId)).size,
      }),
    });
  }

  async createCrawl(
    scope: OrganizationScope,
    projectId: string,
    input: Readonly<{
      idempotencyKey: string;
      traceId: string;
      entitlement?: PublicCrawlEntitlement;
      now?: Date;
    }>,
  ): Promise<CreateCrawlResult> {
    validateIdempotencyKey(input.idempotencyKey);
    const idempotencyKeyHash = hashIdempotencyKey(input.idempotencyKey);
    const entitlement = input.entitlement ?? PHASE_ONE_PUBLIC_CRAWL_ENTITLEMENT;
    const now = input.now ?? new Date();

    if (!entitlement.enabled) {
      throw new DatabaseDomainError("FORBIDDEN", "Website crawling is not enabled.");
    }

    return this.#db.transaction(async (transaction) => {
      const project = await requireProject(transaction, scope, projectId, "crawl:start", true);

      const [existing] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, scope.organization.id),
            eq(crawls.projectId, projectId),
            eq(crawls.idempotencyKeyHash, idempotencyKeyHash),
          ),
        )
        .limit(1);

      if (existing !== undefined) {
        return { crawl: mapProgress(existing), created: false };
      }

      const [active] = await transaction
        .select({ id: crawls.id })
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, scope.organization.id),
            eq(crawls.projectId, projectId),
            inArray(crawls.status, CRAWL_ACTIVE_STATUSES),
          ),
        )
        .limit(1);

      if (active !== undefined) {
        throw new DatabaseDomainError("CONFLICT", "A crawl is already active for this project.");
      }

      const [config] = await transaction
        .select()
        .from(crawlConfigs)
        .where(
          and(
            eq(crawlConfigs.organizationId, scope.organization.id),
            eq(crawlConfigs.projectId, projectId),
          ),
        )
        .limit(1)
        .for("update");

      if (config === undefined) {
        throw new DatabaseDomainError("CONFLICT", "Crawl settings are not configured.");
      }

      if (config.pageLimit > entitlement.maximumPages) {
        throw new DatabaseDomainError(
          "FORBIDDEN",
          "The configured page limit exceeds the current crawl entitlement.",
        );
      }

      const crawlId = randomUUID();
      const outboxIdempotencyKey = `crawl-${crawlId}`;
      const configSnapshot = buildConfigSnapshot(project, config);
      const [created] = await transaction
        .insert(crawls)
        .values({
          id: crawlId,
          organizationId: scope.organization.id,
          projectId,
          requestedByMembershipId: scope.membership.id,
          crawlConfigId: config.id,
          configSnapshot,
          status: "queued",
          idempotencyKeyHash,
          traceId: input.traceId,
          lastProgressAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (created === undefined) {
        throw new Error("Crawl creation returned no row.");
      }

      await transaction.insert(crawlUsageReservations).values({
        organizationId: scope.organization.id,
        projectId,
        crawlId,
        reservedPages: config.pageLimit,
        createdAt: now,
        updatedAt: now,
      });

      const payload: CrawlExecutionJobPayload = {
        contractVersion: 1,
        jobType: "crawl.execute",
        organizationId: scope.organization.id,
        projectId,
        crawlId,
        traceId: input.traceId,
        idempotencyKey: outboxIdempotencyKey,
        requestedByMembershipId: scope.membership.id,
        createdAt: now.toISOString(),
        estimatedPages: config.pageLimit,
      };

      await transaction.insert(jobOutbox).values({
        organizationId: scope.organization.id,
        projectId,
        crawlId,
        jobType: "crawl.execute",
        contractVersion: 1,
        payload,
        idempotencyKey: outboxIdempotencyKey,
        traceId: input.traceId,
        createdAt: now,
        updatedAt: now,
      });

      await writeUserAudit(transaction, scope, {
        action: "crawl.created",
        targetId: crawlId,
        traceId: input.traceId,
        metadata: { pageLimit: config.pageLimit, configVersion: config.version },
      });

      return { crawl: mapProgress(created), created: true };
    });
  }

  async listCrawls(
    scope: OrganizationScope,
    projectId: string,
    limit = 20,
  ): Promise<readonly CrawlProgressRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return this.#db.transaction(async (transaction) => {
      await requireProject(transaction, scope, projectId, "crawl:read");
      const rows = await transaction
        .select()
        .from(crawls)
        .where(
          and(eq(crawls.organizationId, scope.organization.id), eq(crawls.projectId, projectId)),
        )
        .orderBy(desc(crawls.createdAt), desc(crawls.id))
        .limit(safeLimit);
      return rows.map(mapProgress);
    });
  }

  async getCrawl(
    scope: OrganizationScope,
    projectId: string,
    crawlId: string,
  ): Promise<CrawlProgressRecord> {
    return this.#db.transaction(async (transaction) => {
      await requireProject(transaction, scope, projectId, "crawl:read");
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, scope.organization.id),
            eq(crawls.projectId, projectId),
            eq(crawls.id, crawlId),
          ),
        )
        .limit(1);
      if (row === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }
      return mapProgress(row);
    });
  }

  async listCrawlPages(
    scope: OrganizationScope,
    projectId: string,
    crawlId: string,
    input: Readonly<{ limit?: number; cursor?: CrawlPageCursor | null }> = {},
  ): Promise<CrawlPageConnection> {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("The crawl page limit must be between 1 and 100.");
    }
    if (
      input.cursor !== undefined &&
      input.cursor !== null &&
      (input.cursor.organizationId !== scope.organization.id ||
        input.cursor.projectId !== projectId ||
        input.cursor.crawlId !== crawlId)
    ) {
      throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
    }

    return this.#db.transaction(async (transaction) => {
      await requireProject(transaction, scope, projectId, "crawl:read");
      const [crawl] = await transaction
        .select({ id: crawls.id })
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, scope.organization.id),
            eq(crawls.projectId, projectId),
            eq(crawls.id, crawlId),
          ),
        )
        .limit(1);
      if (crawl === undefined) throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");

      const cursor = input.cursor;
      const afterCursor =
        cursor === undefined || cursor === null
          ? undefined
          : or(
              gt(crawlPages.depth, cursor.depth),
              and(
                eq(crawlPages.depth, cursor.depth),
                gt(crawlPages.normalizedUrl, cursor.normalizedUrl),
              ),
              and(
                eq(crawlPages.depth, cursor.depth),
                eq(crawlPages.normalizedUrl, cursor.normalizedUrl),
                gt(crawlPages.id, cursor.pageId),
              ),
            );
      const rows = await transaction
        .select()
        .from(crawlPages)
        .where(
          and(
            eq(crawlPages.organizationId, scope.organization.id),
            eq(crawlPages.projectId, projectId),
            eq(crawlPages.crawlId, crawlId),
            afterCursor,
          ),
        )
        .orderBy(asc(crawlPages.depth), asc(crawlPages.normalizedUrl), asc(crawlPages.id))
        .limit(limit + 1);

      const hasNextPage = rows.length > limit;
      const visibleRows = hasNextPage ? rows.slice(0, limit) : rows;
      const last = visibleRows.at(-1);
      return Object.freeze({
        items: Object.freeze(visibleRows.map(mapPage)),
        nextCursor:
          hasNextPage && last !== undefined
            ? Object.freeze({
                organizationId: scope.organization.id,
                projectId,
                crawlId,
                depth: last.depth,
                normalizedUrl: last.normalizedUrl,
                pageId: last.id,
              })
            : null,
      });
    });
  }

  async getCrawlPage(
    scope: OrganizationScope,
    projectId: string,
    crawlId: string,
    pageId: string,
  ): Promise<CrawlPageDetailRecord> {
    return this.#db.transaction(async (transaction) => {
      await requireProject(transaction, scope, projectId, "crawl:read");
      const pageScope = and(
        eq(crawlPages.organizationId, scope.organization.id),
        eq(crawlPages.projectId, projectId),
        eq(crawlPages.crawlId, crawlId),
        eq(crawlPages.id, pageId),
      );
      const [page] = await transaction.select().from(crawlPages).where(pageScope).limit(1);
      if (page === undefined) throw new DatabaseDomainError("NOT_FOUND", "Crawl page not found.");

      const extractions = await transaction
        .select({
          ...getTableColumns(crawlPageExtractions),
          visibleText: sql<
            string | null
          >`left(${crawlPageExtractions.visibleText}, ${PAGE_DETAIL_LIMITS.visibleTextCharacters})`.as(
            "visible_text_preview",
          ),
          visibleTextTruncated:
            sql<boolean>`coalesce(length(${crawlPageExtractions.visibleText}), 0) > ${PAGE_DETAIL_LIMITS.visibleTextCharacters}`.as(
              "visible_text_truncated",
            ),
        })
        .from(crawlPageExtractions)
        .where(
          and(
            eq(crawlPageExtractions.organizationId, scope.organization.id),
            eq(crawlPageExtractions.projectId, projectId),
            eq(crawlPageExtractions.crawlId, crawlId),
            eq(crawlPageExtractions.pageId, pageId),
          ),
        )
        .orderBy(asc(crawlPageExtractions.source), asc(crawlPageExtractions.id))
        .limit(3);
      const extractionIds = extractions.map((extraction) => extraction.id);
      const artifacts = await transaction
        .select()
        .from(crawlPageArtifacts)
        .where(
          and(
            eq(crawlPageArtifacts.organizationId, scope.organization.id),
            eq(crawlPageArtifacts.projectId, projectId),
            eq(crawlPageArtifacts.crawlId, crawlId),
            eq(crawlPageArtifacts.pageId, pageId),
          ),
        )
        .orderBy(asc(crawlPageArtifacts.kind), asc(crawlPageArtifacts.id))
        .limit(3);
      const headings =
        extractionIds.length === 0
          ? []
          : await transaction
              .select()
              .from(crawlPageHeadings)
              .where(
                and(
                  eq(crawlPageHeadings.organizationId, scope.organization.id),
                  eq(crawlPageHeadings.projectId, projectId),
                  eq(crawlPageHeadings.crawlId, crawlId),
                  eq(crawlPageHeadings.pageId, pageId),
                  inArray(crawlPageHeadings.extractionId, extractionIds),
                ),
              )
              .orderBy(asc(crawlPageHeadings.ordinal), asc(crawlPageHeadings.id))
              .limit(PAGE_DETAIL_LIMITS.headings + 1);
      const links =
        extractionIds.length === 0
          ? []
          : await transaction
              .select()
              .from(crawlPageLinks)
              .where(
                and(
                  eq(crawlPageLinks.organizationId, scope.organization.id),
                  eq(crawlPageLinks.projectId, projectId),
                  eq(crawlPageLinks.crawlId, crawlId),
                  eq(crawlPageLinks.sourcePageId, pageId),
                  inArray(crawlPageLinks.extractionId, extractionIds),
                ),
              )
              .orderBy(asc(crawlPageLinks.ordinal), asc(crawlPageLinks.id))
              .limit(PAGE_DETAIL_LIMITS.links + 1);
      const images =
        extractionIds.length === 0
          ? []
          : await transaction
              .select()
              .from(crawlPageImages)
              .where(
                and(
                  eq(crawlPageImages.organizationId, scope.organization.id),
                  eq(crawlPageImages.projectId, projectId),
                  eq(crawlPageImages.crawlId, crawlId),
                  eq(crawlPageImages.pageId, pageId),
                  inArray(crawlPageImages.extractionId, extractionIds),
                ),
              )
              .orderBy(asc(crawlPageImages.ordinal), asc(crawlPageImages.id))
              .limit(PAGE_DETAIL_LIMITS.images + 1);
      const resources =
        extractionIds.length === 0
          ? []
          : await transaction
              .select()
              .from(crawlPageResources)
              .where(
                and(
                  eq(crawlPageResources.organizationId, scope.organization.id),
                  eq(crawlPageResources.projectId, projectId),
                  eq(crawlPageResources.crawlId, crawlId),
                  eq(crawlPageResources.pageId, pageId),
                  inArray(crawlPageResources.extractionId, extractionIds),
                ),
              )
              .orderBy(asc(crawlPageResources.ordinal), asc(crawlPageResources.id))
              .limit(PAGE_DETAIL_LIMITS.resources + 1);
      const structuredData =
        extractionIds.length === 0
          ? []
          : await transaction
              .select()
              .from(crawlPageStructuredData)
              .where(
                and(
                  eq(crawlPageStructuredData.organizationId, scope.organization.id),
                  eq(crawlPageStructuredData.projectId, projectId),
                  eq(crawlPageStructuredData.crawlId, crawlId),
                  eq(crawlPageStructuredData.pageId, pageId),
                  inArray(crawlPageStructuredData.extractionId, extractionIds),
                ),
              )
              .orderBy(asc(crawlPageStructuredData.ordinal), asc(crawlPageStructuredData.id))
              .limit(PAGE_DETAIL_LIMITS.structuredData + 1);

      const boundedHeadings = boundedRows(headings, PAGE_DETAIL_LIMITS.headings);
      const boundedLinks = boundedRows(links, PAGE_DETAIL_LIMITS.links);
      const boundedImages = boundedRows(images, PAGE_DETAIL_LIMITS.images);
      const boundedResources = boundedRows(resources, PAGE_DETAIL_LIMITS.resources);
      const boundedStructuredData = boundedRows(structuredData, PAGE_DETAIL_LIMITS.structuredData);

      return Object.freeze({
        page: mapPage(page),
        extractions: Object.freeze(extractions),
        artifacts: Object.freeze(artifacts),
        headings: boundedHeadings.items,
        links: boundedLinks.items,
        images: boundedImages.items,
        resources: boundedResources.items,
        structuredData: boundedStructuredData.items,
        collectionTruncated: Object.freeze({
          headings: boundedHeadings.truncated,
          links: boundedLinks.truncated,
          images: boundedImages.truncated,
          resources: boundedResources.truncated,
          structuredData: boundedStructuredData.truncated,
        }),
      });
    });
  }

  async listCrawlSitemaps(
    scope: OrganizationScope,
    projectId: string,
    crawlId: string,
  ): Promise<readonly Readonly<typeof crawlSitemaps.$inferSelect>[]> {
    return this.#db.transaction(async (transaction) => {
      await requireProject(transaction, scope, projectId, "crawl:read");
      const [crawl] = await transaction
        .select({ id: crawls.id })
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, scope.organization.id),
            eq(crawls.projectId, projectId),
            eq(crawls.id, crawlId),
          ),
        )
        .limit(1);
      if (crawl === undefined) throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      const rows = await transaction
        .select()
        .from(crawlSitemaps)
        .where(
          and(
            eq(crawlSitemaps.organizationId, scope.organization.id),
            eq(crawlSitemaps.projectId, projectId),
            eq(crawlSitemaps.crawlId, crawlId),
          ),
        )
        .orderBy(asc(crawlSitemaps.depth), asc(crawlSitemaps.normalizedUrl), asc(crawlSitemaps.id));
      return Object.freeze(rows.map((row) => Object.freeze(row)));
    });
  }

  async getCrawlSitemap(
    scope: OrganizationScope,
    projectId: string,
    crawlId: string,
    sitemapId: string,
  ): Promise<CrawlSitemapRecord> {
    return this.#db.transaction(async (transaction) => {
      await requireProject(transaction, scope, projectId, "crawl:read");
      const [sitemap] = await transaction
        .select()
        .from(crawlSitemaps)
        .where(
          and(
            eq(crawlSitemaps.organizationId, scope.organization.id),
            eq(crawlSitemaps.projectId, projectId),
            eq(crawlSitemaps.crawlId, crawlId),
            eq(crawlSitemaps.id, sitemapId),
          ),
        )
        .limit(1);
      if (sitemap === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl sitemap not found.");
      }
      const entries = await transaction
        .select()
        .from(crawlSitemapEntries)
        .where(
          and(
            eq(crawlSitemapEntries.organizationId, scope.organization.id),
            eq(crawlSitemapEntries.projectId, projectId),
            eq(crawlSitemapEntries.crawlId, crawlId),
            eq(crawlSitemapEntries.sitemapId, sitemapId),
          ),
        )
        .orderBy(asc(crawlSitemapEntries.ordinal), asc(crawlSitemapEntries.id));
      return Object.freeze({ sitemap: Object.freeze(sitemap), entries: Object.freeze(entries) });
    });
  }

  async requestCancellation(
    scope: OrganizationScope,
    projectId: string,
    crawlId: string,
    traceId: string,
    now = new Date(),
  ): Promise<CrawlProgressRecord> {
    return this.#db.transaction(async (transaction) => {
      await requireProject(transaction, scope, projectId, "crawl:cancel", true);
      // The publisher always owns the outbox row before touching its crawl.
      // Use the same order here so queued cancellation cannot deadlock with
      // publication acknowledgement or terminal publish failure.
      await transaction
        .select({ id: jobOutbox.id })
        .from(jobOutbox)
        .where(
          and(
            eq(jobOutbox.organizationId, scope.organization.id),
            eq(jobOutbox.projectId, projectId),
            eq(jobOutbox.crawlId, crawlId),
            eq(jobOutbox.jobType, "crawl.execute"),
          ),
        )
        .limit(1)
        .for("update");
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, scope.organization.id),
            eq(crawls.projectId, projectId),
            eq(crawls.id, crawlId),
          ),
        )
        .limit(1)
        .for("update");

      if (row === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }
      if (TERMINAL_STATUS_SET.has(row.status)) {
        return mapProgress(row);
      }

      const immediate = row.status === "queued";
      const [updated] = await transaction
        .update(crawls)
        .set({
          cancellationRequestedAt: row.cancellationRequestedAt ?? now,
          ...(immediate
            ? {
                status: "cancelled" as const,
                finishedAt: now,
                completionReason: "cancelled_before_execution",
                executionToken: null,
                executionLeaseExpiresAt: null,
              }
            : {}),
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, scope.organization.id),
            eq(crawls.projectId, projectId),
            eq(crawls.id, crawlId),
            inArray(crawls.status, CRAWL_ACTIVE_STATUSES),
          ),
        )
        .returning();

      if (updated === undefined) {
        const [current] = await transaction
          .select()
          .from(crawls)
          .where(
            and(
              eq(crawls.organizationId, scope.organization.id),
              eq(crawls.projectId, projectId),
              eq(crawls.id, crawlId),
            ),
          )
          .limit(1);
        if (current === undefined) {
          throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
        }
        return mapProgress(current);
      }

      if (immediate) {
        await transaction
          .update(jobOutbox)
          .set({
            status: "cancelled",
            claimToken: null,
            lockedAt: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(jobOutbox.crawlId, crawlId),
              eq(jobOutbox.jobType, "crawl.execute"),
              inArray(jobOutbox.status, ["pending", "publishing"]),
            ),
          );
        await releaseUsage(
          transaction,
          { organizationId: scope.organization.id, projectId, crawlId },
          0,
          now,
        );
      }

      if (row.cancellationRequestedAt === null) {
        await writeUserAudit(transaction, scope, {
          action: "crawl.cancellation_requested",
          targetId: crawlId,
          traceId,
          metadata: { statusAtRequest: row.status },
        });
      }

      return mapProgress(updated);
    });
  }

  async claimOutboxBatch(
    input: Readonly<{
      limit: number;
      leaseMs: number;
      now?: Date;
      claimToken?: string;
    }>,
  ): Promise<readonly ClaimedOutboxRecord[]> {
    const now = input.now ?? new Date();
    const claimToken = input.claimToken ?? randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + Math.max(1_000, input.leaseMs));
    const limit = Math.max(1, Math.min(input.limit, 100));

    return this.#db.transaction(async (transaction) => {
      await transaction
        .update(jobOutbox)
        .set({
          status: "pending",
          claimToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(jobOutbox.status, "publishing"), lte(jobOutbox.leaseExpiresAt, now)));

      const candidates = await transaction
        .select({ id: jobOutbox.id })
        .from(jobOutbox)
        .where(and(eq(jobOutbox.status, "pending"), lte(jobOutbox.availableAt, now)))
        .orderBy(asc(jobOutbox.availableAt), asc(jobOutbox.createdAt), asc(jobOutbox.id))
        .limit(limit)
        .for("update", { skipLocked: true });

      if (candidates.length === 0) return [];
      const ids = candidates.map((candidate) => candidate.id);
      const claimed = await transaction
        .update(jobOutbox)
        .set({
          status: "publishing",
          claimToken,
          lockedAt: now,
          leaseExpiresAt,
          publishAttemptCount: sql`${jobOutbox.publishAttemptCount} + 1`,
          updatedAt: now,
        })
        .where(and(inArray(jobOutbox.id, ids), eq(jobOutbox.status, "pending")))
        .returning();

      return claimed.map((row) => ({
        id: row.id,
        jobType: row.jobType as "crawl.execute" | "crawl.dead-letter" | "audit.evaluate",
        organizationId: row.organizationId,
        projectId: row.projectId,
        crawlId: row.crawlId,
        idempotencyKey: row.idempotencyKey,
        traceId: row.traceId,
        contractVersion: row.contractVersion,
        payload: row.payload as unknown as CrawlOutboxPayload,
        publishAttemptCount: row.publishAttemptCount,
        claimToken,
        leaseExpiresAt,
      }));
    });
  }

  async recoverExpiredOutboxLeases(now = new Date()): Promise<number> {
    const recovered = await this.#db
      .update(jobOutbox)
      .set({
        status: "pending",
        claimToken: null,
        lockedAt: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobOutbox.status, "publishing"), lte(jobOutbox.leaseExpiresAt, now)))
      .returning({ id: jobOutbox.id });
    return recovered.length;
  }

  async markOutboxPublished(
    outboxId: string,
    claimToken: string,
    queueJobId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.#db.transaction(async (transaction) => {
      const [published] = await transaction
        .update(jobOutbox)
        .set({
          status: "published",
          publishedAt: now,
          claimToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(jobOutbox.id, outboxId),
            eq(jobOutbox.status, "publishing"),
            eq(jobOutbox.claimToken, claimToken),
          ),
        )
        .returning({
          crawlId: jobOutbox.crawlId,
          jobType: jobOutbox.jobType,
          organizationId: jobOutbox.organizationId,
          projectId: jobOutbox.projectId,
        });

      if (published === undefined) return false;
      if (published.jobType === "crawl.execute") {
        if (queueJobId !== published.crawlId) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "The queue job ID does not match the deterministic crawl job ID.",
          );
        }
        await transaction
          .update(crawls)
          .set({ queueJobId, updatedAt: now })
          .where(
            and(
              eq(crawls.organizationId, published.organizationId),
              eq(crawls.projectId, published.projectId),
              eq(crawls.id, published.crawlId),
            ),
          );
      } else if (published.jobType === "audit.evaluate") {
        if (queueJobId !== `audit-${published.crawlId}`) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "The queue job ID does not match the deterministic audit evaluation job ID.",
          );
        }
      }
      return true;
    });
  }

  async releaseOutboxClaim(
    input: Readonly<{
      outboxId: string;
      claimToken: string;
      errorMessage: string;
      retryAt: Date;
      terminal: boolean;
      now?: Date;
    }>,
  ): Promise<boolean> {
    const now = input.now ?? new Date();
    return this.#db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(jobOutbox)
        .set({
          status: input.terminal ? "dead_lettered" : "pending",
          availableAt: input.retryAt,
          claimToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: safeErrorText(input.errorMessage),
          updatedAt: now,
        })
        .where(
          and(
            eq(jobOutbox.id, input.outboxId),
            eq(jobOutbox.status, "publishing"),
            eq(jobOutbox.claimToken, input.claimToken),
          ),
        )
        .returning({
          crawlId: jobOutbox.crawlId,
          jobType: jobOutbox.jobType,
          organizationId: jobOutbox.organizationId,
          projectId: jobOutbox.projectId,
          traceId: jobOutbox.traceId,
        });

      if (updated === undefined) return false;
      if (input.terminal && updated.jobType === "crawl.execute") {
        const [crawl] = await transaction
          .select()
          .from(crawls)
          .where(
            and(
              eq(crawls.organizationId, updated.organizationId),
              eq(crawls.projectId, updated.projectId),
              eq(crawls.id, updated.crawlId),
            ),
          )
          .limit(1)
          .for("update");
        if (crawl !== undefined && !TERMINAL_STATUS_SET.has(crawl.status)) {
          await transaction
            .update(crawls)
            .set({
              status: "failed",
              finishedAt: now,
              executionToken: null,
              executionLeaseExpiresAt: null,
              completionReason: "queue_publish_exhausted",
              errorType: "queue_publish_exhausted",
              errorMessage: safeErrorText(input.errorMessage),
              lastProgressAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(crawls.organizationId, updated.organizationId),
                eq(crawls.projectId, updated.projectId),
                eq(crawls.id, updated.crawlId),
              ),
            );
          await releaseUsage(
            transaction,
            {
              organizationId: updated.organizationId,
              projectId: updated.projectId,
              crawlId: updated.crawlId,
            },
            crawl.processedCount,
            now,
          );
          await writeSystemAudit(transaction, {
            organizationId: updated.organizationId,
            action: "crawl.queue_publish_failed",
            targetId: updated.crawlId,
            traceId: updated.traceId,
            metadata: { outboxId: input.outboxId },
          });
        }
      }
      return true;
    });
  }

  async claimExecution(
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
  ): Promise<CrawlExecutionClaim> {
    const now = input.now ?? new Date();
    const executionToken = input.executionToken ?? randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + Math.max(5_000, input.leaseMs));

    return this.#db.transaction(async (transaction) => {
      if (
        (input.queueJobId !== undefined && input.queueJobId !== input.crawlId) ||
        (input.idempotencyKey !== undefined && input.idempotencyKey !== `crawl-${input.crawlId}`)
      ) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, input.organizationId),
            eq(crawls.projectId, input.projectId),
            eq(crawls.id, input.crawlId),
          ),
        )
        .limit(1)
        .for("update");

      if (row === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }
      if (
        input.queueJobId !== undefined &&
        row.queueJobId !== null &&
        row.queueJobId !== input.queueJobId
      ) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }
      if (
        (input.requestedByMembershipId !== undefined &&
          row.requestedByMembershipId !== input.requestedByMembershipId) ||
        (input.traceId !== undefined && row.traceId !== input.traceId) ||
        (input.estimatedPages !== undefined &&
          row.configSnapshot.pageLimit !== input.estimatedPages)
      ) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }
      if (TERMINAL_STATUS_SET.has(row.status)) {
        return { kind: "terminal", status: row.status as CrawlTerminalStatus };
      }
      if (row.cancellationRequestedAt !== null) {
        await this.#finishCancelled(transaction, row, now, "cancelled_before_worker_claim");
        return { kind: "cancelled" };
      }
      if (
        row.executionToken !== null &&
        row.executionToken !== executionToken &&
        row.executionLeaseExpiresAt !== null &&
        row.executionLeaseExpiresAt > now
      ) {
        return {
          kind: "busy",
          retryAfterMs: Math.max(1, row.executionLeaseExpiresAt.getTime() - now.getTime()),
        };
      }

      const [claimed] = await transaction
        .update(crawls)
        .set({
          status: "validating",
          queueJobId: row.queueJobId ?? input.queueJobId ?? null,
          executionToken,
          executionLeaseExpiresAt: leaseExpiresAt,
          attemptCount:
            row.executionToken === executionToken ? row.attemptCount : row.attemptCount + 1,
          startedAt: row.startedAt ?? now,
          errorType: null,
          errorMessage: null,
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, input.organizationId),
            eq(crawls.projectId, input.projectId),
            eq(crawls.id, row.id),
          ),
        )
        .returning();

      if (claimed === undefined) throw new Error("Crawl execution claim returned no row.");
      return {
        kind: "claimed",
        executionToken,
        crawl: {
          organizationId: claimed.organizationId,
          projectId: claimed.projectId,
          crawlId: claimed.id,
          traceId: claimed.traceId,
          status: "validating",
          config: claimed.configSnapshot,
          counters: {
            discovered: claimed.discoveredCount,
            processed: claimed.processedCount,
            succeeded: claimed.succeededCount,
            failed: claimed.failedCount,
            blocked: claimed.blockedCount,
            skipped: claimed.skippedCount,
            bytesReceived: claimed.bytesReceived,
          },
        },
      };
    });
  }

  async reconcilePreClaimFailure(
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
  ): Promise<CrawlPreClaimFailureResult> {
    const now = input.now ?? new Date();
    return this.#db.transaction(async (transaction) => {
      if (input.queueJobId !== input.crawlId || input.idempotencyKey !== `crawl-${input.crawlId}`) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }

      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, input.organizationId),
            eq(crawls.projectId, input.projectId),
            eq(crawls.id, input.crawlId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        row === undefined ||
        (row.queueJobId !== null && row.queueJobId !== input.queueJobId) ||
        row.requestedByMembershipId !== input.requestedByMembershipId ||
        row.traceId !== input.traceId ||
        row.configSnapshot.pageLimit !== input.estimatedPages
      ) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      }

      if (TERMINAL_STATUS_SET.has(row.status)) {
        await ensureAuditEvaluationOutbox(transaction, row, now);
        return { kind: "already_terminal" };
      }
      if (row.cancellationRequestedAt !== null) {
        await this.#finishCancelled(transaction, row, now, "cancelled_before_worker_claim");
        return { kind: "cancelled" };
      }
      if (
        row.executionToken !== null &&
        row.executionLeaseExpiresAt !== null &&
        row.executionLeaseExpiresAt > now
      ) {
        return {
          kind: "busy",
          retryAfterMs: Math.max(1, row.executionLeaseExpiresAt.getTime() - now.getTime()),
        };
      }

      if (!input.terminal) {
        await transaction
          .update(crawls)
          .set({
            status: "queued",
            queueJobId: row.queueJobId ?? input.queueJobId,
            executionToken: null,
            executionLeaseExpiresAt: null,
            completionReason: "queue_claim_retry_scheduled",
            errorType: safeErrorType(input.errorType),
            errorMessage: safeErrorText(input.errorMessage),
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(crawls.organizationId, input.organizationId),
              eq(crawls.projectId, input.projectId),
              eq(crawls.id, input.crawlId),
            ),
          );
        return { kind: "retryable" };
      }

      const terminalStatus: "failed" | "partially_completed" =
        row.succeededCount > 0 ? "partially_completed" : "failed";
      const [terminalCrawl] = await transaction
        .update(crawls)
        .set({
          status: terminalStatus,
          queueJobId: row.queueJobId ?? input.queueJobId,
          finishedAt: now,
          executionToken: null,
          executionLeaseExpiresAt: null,
          completionReason: "queue_claim_attempts_exhausted",
          errorType: safeErrorType(input.errorType),
          errorMessage: safeErrorText(input.errorMessage),
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, input.organizationId),
            eq(crawls.projectId, input.projectId),
            eq(crawls.id, input.crawlId),
          ),
        )
        .returning();
      if (terminalCrawl === undefined) {
        throw new Error("Pre-claim crawl failure finalization returned no row.");
      }
      await releaseUsage(transaction, input, row.processedCount, now);
      await ensureAuditEvaluationOutbox(transaction, terminalCrawl, now);

      const idempotencyKey = `crawl-dead-${input.crawlId}`;
      const payload: CrawlDeadLetterJobPayload = {
        contractVersion: 1,
        jobType: "crawl.dead-letter",
        organizationId: row.organizationId,
        projectId: row.projectId,
        crawlId: row.id,
        traceId: row.traceId,
        idempotencyKey,
        sourceJobId: row.id,
        finalStatus: terminalStatus,
        attemptsMade: Math.max(1, input.attemptsMade),
        failedAt: now.toISOString(),
        errorType: safeErrorType(input.errorType),
        errorMessage: safeErrorText(input.errorMessage),
      };
      await transaction
        .insert(jobOutbox)
        .values({
          organizationId: row.organizationId,
          projectId: row.projectId,
          crawlId: row.id,
          jobType: "crawl.dead-letter",
          contractVersion: 1,
          payload,
          idempotencyKey,
          traceId: row.traceId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [jobOutbox.crawlId, jobOutbox.jobType] });
      await writeSystemAudit(transaction, {
        organizationId: row.organizationId,
        action: `crawl.${terminalStatus}`,
        targetId: row.id,
        traceId: row.traceId,
        metadata: {
          attemptsMade: Math.max(1, input.attemptsMade),
          completionReason: "queue_claim_attempts_exhausted",
        },
      });
      return { kind: "failed", status: terminalStatus };
    });
  }

  async recordExecutionProgress(
    context: CrawlExecutionContext,
    counters: CrawlProgressCounters,
    leaseMs: number,
    now = new Date(),
  ): Promise<void> {
    const terminalOutcomes =
      counters.succeeded + counters.failed + counters.blocked + counters.skipped;
    if (counters.processed !== terminalOutcomes || counters.processed > counters.discovered) {
      throw new DatabaseDomainError("CONFLICT", "The crawl progress counters are inconsistent.");
    }

    await this.#db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
            gt(crawls.executionLeaseExpiresAt, now),
            inArray(crawls.status, ["validating", "discovering", "crawling"]),
          ),
        )
        .limit(1)
        .for("update");
      if (row === undefined) {
        throw new DatabaseDomainError("CONFLICT", "The crawl execution lease is no longer active.");
      }
      const monotonic =
        counters.discovered >= row.discoveredCount &&
        counters.processed >= row.processedCount &&
        counters.succeeded >= row.succeededCount &&
        counters.failed >= row.failedCount &&
        counters.blocked >= row.blockedCount &&
        counters.skipped >= row.skippedCount &&
        counters.bytesReceived >= row.bytesReceived;
      if (!monotonic) {
        throw new DatabaseDomainError("CONFLICT", "Crawl progress cannot move backwards.");
      }

      await transaction
        .update(crawls)
        .set({
          discoveredCount: counters.discovered,
          processedCount: counters.processed,
          succeededCount: counters.succeeded,
          failedCount: counters.failed,
          blockedCount: counters.blocked,
          skippedCount: counters.skipped,
          bytesReceived: counters.bytesReceived,
          executionLeaseExpiresAt: new Date(now.getTime() + Math.max(5_000, leaseMs)),
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
            gt(crawls.executionLeaseExpiresAt, now),
          ),
        );
    });
  }

  async renewExecutionLease(
    context: CrawlExecutionContext,
    leaseMs: number,
    now = new Date(),
  ): Promise<boolean> {
    const [updated] = await this.#db
      .update(crawls)
      .set({
        executionLeaseExpiresAt: new Date(now.getTime() + Math.max(5_000, leaseMs)),
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(crawls.organizationId, context.organizationId),
          eq(crawls.projectId, context.projectId),
          eq(crawls.id, context.crawlId),
          eq(crawls.executionToken, context.executionToken),
          gt(crawls.executionLeaseExpiresAt, now),
          inArray(crawls.status, ["validating", "discovering", "crawling"]),
        ),
      )
      .returning({ id: crawls.id });
    return updated !== undefined;
  }

  async isCancellationRequested(
    organizationId: string,
    projectId: string,
    crawlId: string,
    executionToken: string,
  ): Promise<boolean> {
    const [row] = await this.#db
      .select({ cancellationRequestedAt: crawls.cancellationRequestedAt })
      .from(crawls)
      .where(
        and(
          eq(crawls.organizationId, organizationId),
          eq(crawls.projectId, projectId),
          eq(crawls.id, crawlId),
          eq(crawls.executionToken, executionToken),
        ),
      )
      .limit(1);
    return row !== undefined && row.cancellationRequestedAt !== null;
  }

  async transitionStage(
    context: CrawlExecutionContext,
    nextStatus: "discovering" | "crawling",
    now = new Date(),
  ): Promise<void> {
    await this.#db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ status: crawls.status, cancellationRequestedAt: crawls.cancellationRequestedAt })
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
            gt(crawls.executionLeaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      if (row === undefined) {
        throw new DatabaseDomainError("CONFLICT", "The crawl execution lease is no longer active.");
      }
      if (row.cancellationRequestedAt !== null) {
        throw new DatabaseDomainError("CONFLICT", "Crawl cancellation was requested.");
      }
      const allowed =
        (row.status === "validating" && nextStatus === "discovering") ||
        (row.status === "discovering" && nextStatus === "crawling") ||
        row.status === nextStatus;
      if (!allowed) {
        throw new DatabaseDomainError("CONFLICT", "Invalid crawl status transition.");
      }
      await transaction
        .update(crawls)
        .set({ status: nextStatus, lastProgressAt: now, updatedAt: now })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        );
    });
  }

  async listResumableFrontier(
    context: CrawlExecutionContext,
    limit: number,
    now = new Date(),
  ): Promise<readonly ResumableFrontierEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
      throw new TypeError("The resumable frontier limit must be between 1 and 100000.");
    }

    return this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);

      // A previous process can disappear after marking a URL as fetching. A
      // newly fenced execution owns the expired crawl lease, so those rows are
      // safe to return to the durable discovered state before hydration.
      await transaction
        .update(crawlFrontier)
        .set({ state: "discovered", startedAt: null, updatedAt: now })
        .where(
          and(
            eq(crawlFrontier.organizationId, context.organizationId),
            eq(crawlFrontier.projectId, context.projectId),
            eq(crawlFrontier.crawlId, context.crawlId),
            eq(crawlFrontier.state, "fetching"),
          ),
        );

      // A process can commit the fetch observation and then disappear before
      // object storage or extraction commits. Requeue only successful HTML
      // pages with incomplete M3 persistence; the existing page row makes the
      // fetch replay idempotent and supplies its stable page ID.
      await transaction
        .update(crawlFrontier)
        .set({
          state: "discovered",
          startedAt: null,
          finishedAt: null,
          errorType: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawlFrontier.organizationId, context.organizationId),
            eq(crawlFrontier.projectId, context.projectId),
            eq(crawlFrontier.crawlId, context.crawlId),
            inArray(crawlFrontier.state, ["fetched", "failed"]),
            sql`exists (
              select 1
              from ${crawlPages} as resumable_page
              where resumable_page.organization_id = ${context.organizationId}::uuid
                and resumable_page.project_id = ${context.projectId}::uuid
                and resumable_page.crawl_id = ${context.crawlId}::uuid
                and resumable_page.frontier_id = ${crawlFrontier.id}
                and resumable_page.status_code is not null
                and lower(split_part(coalesce(resumable_page.content_type, ''), ';', 1)) in ('text/html', 'application/xhtml+xml')
                and (
                  not exists (
                    select 1
                    from ${crawlPageExtractions} as resumable_extract
                    where resumable_extract.organization_id = ${context.organizationId}::uuid
                      and resumable_extract.project_id = ${context.projectId}::uuid
                      and resumable_extract.crawl_id = ${context.crawlId}::uuid
                      and resumable_extract.page_id = resumable_page.id
                      and resumable_extract.source = 'raw'
                  )
                  or not exists (
                    select 1
                    from ${crawlPageArtifacts} as resumable_artifact
                    where resumable_artifact.organization_id = ${context.organizationId}::uuid
                      and resumable_artifact.project_id = ${context.projectId}::uuid
                      and resumable_artifact.crawl_id = ${context.crawlId}::uuid
                      and resumable_artifact.page_id = resumable_page.id
                      and resumable_artifact.kind = 'raw_html'
                  )
                )
            )`,
          ),
        );

      const rows = await transaction
        .select({
          countedPageId: crawlPages.id,
          depth: crawlFrontier.depth,
          discoverySource: crawlFrontier.discoverySource,
          normalizedUrl: crawlFrontier.normalizedUrl,
          requestedUrl: crawlFrontier.requestedUrl,
          urlHash: crawlFrontier.urlHash,
        })
        .from(crawlFrontier)
        .leftJoin(
          crawlPages,
          and(
            eq(crawlPages.organizationId, context.organizationId),
            eq(crawlPages.projectId, context.projectId),
            eq(crawlPages.crawlId, context.crawlId),
            eq(crawlPages.frontierId, crawlFrontier.id),
          ),
        )
        .where(
          and(
            eq(crawlFrontier.organizationId, context.organizationId),
            eq(crawlFrontier.projectId, context.projectId),
            eq(crawlFrontier.crawlId, context.crawlId),
            eq(crawlFrontier.state, "discovered"),
          ),
        )
        .orderBy(asc(crawlFrontier.depth), asc(crawlFrontier.discoveredAt), asc(crawlFrontier.id))
        .limit(limit);

      return Object.freeze(
        rows.map(({ countedPageId, ...row }) =>
          Object.freeze({ ...row, countsTowardPageLimit: countedPageId === null }),
        ),
      );
    });
  }

  async persistDiscoveredUrl(
    context: Readonly<{
      crawlId: string;
      executionToken: string;
      organizationId: string;
      projectId: string;
    }>,
    input: DiscoveredUrlInput,
    now = new Date(),
  ): Promise<
    Readonly<{
      id: string;
      created: boolean;
      state: "discovered" | "fetching" | "fetched" | "blocked" | "failed" | "skipped";
    }>
  > {
    return this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      const [existing] = await transaction
        .select({ id: crawlFrontier.id, state: crawlFrontier.state })
        .from(crawlFrontier)
        .where(
          and(
            eq(crawlFrontier.organizationId, context.organizationId),
            eq(crawlFrontier.projectId, context.projectId),
            eq(crawlFrontier.crawlId, context.crawlId),
            eq(crawlFrontier.urlHash, input.urlHash),
          ),
        )
        .limit(1);
      if (existing !== undefined) return { ...existing, created: false };

      const [created] = await transaction
        .insert(crawlFrontier)
        .values({
          organizationId: context.organizationId,
          projectId: context.projectId,
          crawlId: context.crawlId,
          origin: input.origin,
          hostname: input.hostname,
          requestedUrl: input.requestedUrl,
          discoveredUrl: input.discoveredUrl,
          normalizedUrl: input.normalizedUrl,
          urlHash: input.urlHash,
          depth: input.depth,
          discoverySource: input.discoverySource,
          discoveredFromFrontierId: input.discoveredFromFrontierId,
          discoveredAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [crawlFrontier.crawlId, crawlFrontier.urlHash] })
        .returning({ id: crawlFrontier.id, state: crawlFrontier.state });

      if (created === undefined) {
        const [raced] = await transaction
          .select({ id: crawlFrontier.id, state: crawlFrontier.state })
          .from(crawlFrontier)
          .where(
            and(
              eq(crawlFrontier.organizationId, context.organizationId),
              eq(crawlFrontier.projectId, context.projectId),
              eq(crawlFrontier.crawlId, context.crawlId),
              eq(crawlFrontier.urlHash, input.urlHash),
            ),
          )
          .limit(1);
        if (raced === undefined) throw new Error("Frontier deduplication returned no row.");
        return { ...raced, created: false };
      }

      await transaction
        .update(crawls)
        .set({
          discoveredCount: sql`${crawls.discoveredCount} + 1`,
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        );
      return { ...created, created: true };
    });
  }

  async markFrontierFetching(
    context: CrawlExecutionContext,
    frontierId: string,
    now = new Date(),
  ): Promise<void> {
    await this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      await transaction
        .update(crawlFrontier)
        .set({
          state: "fetching",
          attemptCount: sql`${crawlFrontier.attemptCount} + 1`,
          startedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawlFrontier.organizationId, context.organizationId),
            eq(crawlFrontier.projectId, context.projectId),
            eq(crawlFrontier.crawlId, context.crawlId),
            eq(crawlFrontier.id, frontierId),
          ),
        );
    });
  }

  async persistPageObservation(
    context: Readonly<{
      crawlId: string;
      executionToken: string;
      organizationId: string;
      projectId: string;
    }>,
    input: PageObservationInput,
    now = new Date(),
  ): Promise<
    Readonly<{
      pageId: string;
      created: boolean;
      rawArtifactExists: boolean;
      storedObservation: WorkerStoredPageObservation | null;
    }>
  > {
    const frontierState =
      input.outcome === "succeeded"
        ? "fetched"
        : input.outcome === "failed"
          ? "failed"
          : input.outcome === "blocked"
            ? "blocked"
            : "skipped";
    const observationValues = pageObservationValues(input, now);
    return this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      await assertRobotsDecisionProvenance(
        transaction,
        context,
        input.normalizedUrl,
        input.robotsDecision,
        input.robotsObservationId,
      );
      const [created] = await transaction
        .insert(crawlPages)
        .values({
          organizationId: context.organizationId,
          projectId: context.projectId,
          crawlId: context.crawlId,
          frontierId: input.frontierId,
          ...observationValues,
          createdAt: now,
        })
        .onConflictDoNothing({ target: crawlPages.frontierId })
        .returning({ id: crawlPages.id });

      if (created === undefined) {
        const [existing] = await transaction
          .select({
            id: crawlPages.id,
            requestedUrl: crawlPages.requestedUrl,
            normalizedUrl: crawlPages.normalizedUrl,
            finalUrl: crawlPages.finalUrl,
            urlHash: crawlPages.urlHash,
            statusCode: crawlPages.statusCode,
            contentType: crawlPages.contentType,
            htmlDetected: crawlPages.htmlDetected,
            htmlDetectionSource: crawlPages.htmlDetectionSource,
            htmlDetectionBytes: crawlPages.htmlDetectionBytes,
            responseHeaders: crawlPages.responseHeaders,
            contentLength: crawlPages.contentLength,
            responseBytes: crawlPages.responseBytes,
            transferSize: crawlPages.transferSize,
            compression: crawlPages.compression,
            depth: crawlPages.depth,
            redirectChain: crawlPages.redirectChain,
            timing: crawlPages.timing,
            discoverySource: crawlPages.discoverySource,
          })
          .from(crawlPages)
          .where(
            and(
              eq(crawlPages.organizationId, context.organizationId),
              eq(crawlPages.projectId, context.projectId),
              eq(crawlPages.crawlId, context.crawlId),
              eq(crawlPages.frontierId, input.frontierId),
            ),
          )
          .limit(1);
        if (existing === undefined) throw new Error("Page deduplication returned no row.");
        const [rawArtifact] = await transaction
          .select({ id: crawlPageArtifacts.id })
          .from(crawlPageArtifacts)
          .where(
            and(
              eq(crawlPageArtifacts.organizationId, context.organizationId),
              eq(crawlPageArtifacts.projectId, context.projectId),
              eq(crawlPageArtifacts.crawlId, context.crawlId),
              eq(crawlPageArtifacts.pageId, existing.id),
              eq(crawlPageArtifacts.kind, "raw_html"),
            ),
          )
          .limit(1);
        const rawArtifactExists = rawArtifact !== undefined;
        await transaction
          .update(crawlFrontier)
          .set({
            state: frontierState,
            robotsDecision: input.robotsDecision,
            finishedAt: now,
            errorType: input.errorType === null ? null : safeErrorType(input.errorType),
            errorMessage: input.errorMessage === null ? null : safeErrorText(input.errorMessage),
            updatedAt: now,
          })
          .where(
            and(
              eq(crawlFrontier.organizationId, context.organizationId),
              eq(crawlFrontier.projectId, context.projectId),
              eq(crawlFrontier.crawlId, context.crawlId),
              eq(crawlFrontier.id, input.frontierId),
            ),
          );
        await backfillTargetPageReferences(transaction, context, {
          id: existing.id,
          urlHash: existing.urlHash,
        });
        return Object.freeze({
          pageId: existing.id,
          created: false,
          rawArtifactExists,
          storedObservation: Object.freeze({
            requestedUrl: existing.requestedUrl,
            normalizedUrl: existing.normalizedUrl,
            finalUrl: existing.finalUrl,
            urlHash: existing.urlHash,
            statusCode: existing.statusCode,
            contentType: existing.contentType,
            htmlDetected: existing.htmlDetected,
            htmlDetectionSource: existing.htmlDetectionSource,
            htmlDetectionBytes: existing.htmlDetectionBytes,
            responseHeaders: existing.responseHeaders,
            contentLength: existing.contentLength,
            responseBytes: existing.responseBytes,
            transferSize: existing.transferSize,
            compression: existing.compression,
            depth: existing.depth,
            redirectChain: existing.redirectChain,
            timing: existing.timing,
            discoverySource: existing.discoverySource,
          }),
        });
      }
      await transaction
        .update(crawlFrontier)
        .set({
          state: frontierState,
          robotsDecision: input.robotsDecision,
          finishedAt: now,
          errorType: input.errorType === null ? null : safeErrorType(input.errorType),
          errorMessage: input.errorMessage === null ? null : safeErrorText(input.errorMessage),
          updatedAt: now,
        })
        .where(
          and(
            eq(crawlFrontier.organizationId, context.organizationId),
            eq(crawlFrontier.projectId, context.projectId),
            eq(crawlFrontier.crawlId, context.crawlId),
            eq(crawlFrontier.id, input.frontierId),
          ),
        );

      await backfillTargetPageReferences(transaction, context, {
        id: created.id,
        urlHash: input.urlHash,
      });

      await transaction
        .update(crawls)
        .set({
          processedCount:
            input.countsTowardPageLimit === false
              ? crawls.processedCount
              : sql`${crawls.processedCount} + 1`,
          succeededCount:
            input.countsTowardPageLimit !== false && input.outcome === "succeeded"
              ? sql`${crawls.succeededCount} + 1`
              : crawls.succeededCount,
          failedCount:
            input.countsTowardPageLimit !== false && input.outcome === "failed"
              ? sql`${crawls.failedCount} + 1`
              : crawls.failedCount,
          blockedCount:
            input.countsTowardPageLimit !== false && input.outcome === "blocked"
              ? sql`${crawls.blockedCount} + 1`
              : crawls.blockedCount,
          skippedCount:
            input.countsTowardPageLimit !== false && input.outcome === "skipped"
              ? sql`${crawls.skippedCount} + 1`
              : crawls.skippedCount,
          bytesReceived: sql`${crawls.bytesReceived} + ${input.responseBytes}`,
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        );
      return Object.freeze({
        pageId: created.id,
        created: true,
        rawArtifactExists: false,
        storedObservation: null,
      });
    });
  }

  async replaceIncompletePageObservation(
    context: CrawlExecutionContext,
    pageId: string,
    input: PageObservationInput,
    now = new Date(),
  ): Promise<void> {
    await this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      await assertRobotsDecisionProvenance(
        transaction,
        context,
        input.normalizedUrl,
        input.robotsDecision,
        input.robotsObservationId,
      );
      const [rawArtifact] = await transaction
        .select({ id: crawlPageArtifacts.id })
        .from(crawlPageArtifacts)
        .where(
          and(
            eq(crawlPageArtifacts.organizationId, context.organizationId),
            eq(crawlPageArtifacts.projectId, context.projectId),
            eq(crawlPageArtifacts.crawlId, context.crawlId),
            eq(crawlPageArtifacts.pageId, pageId),
            eq(crawlPageArtifacts.kind, "raw_html"),
          ),
        )
        .limit(1);
      if (rawArtifact !== undefined) {
        throw new DatabaseDomainError(
          "CONFLICT",
          "The page observation became immutable before it could be replaced.",
        );
      }
      const [updated] = await transaction
        .update(crawlPages)
        .set(pageObservationValues(input, now))
        .where(
          and(
            eq(crawlPages.organizationId, context.organizationId),
            eq(crawlPages.projectId, context.projectId),
            eq(crawlPages.crawlId, context.crawlId),
            eq(crawlPages.id, pageId),
            eq(crawlPages.frontierId, input.frontierId),
          ),
        )
        .returning({ id: crawlPages.id });
      if (updated === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Crawl page not found.");
      }
    });
  }

  async persistPageExtraction(
    context: CrawlExecutionContext,
    input: PageExtractionInput,
    now = new Date(),
  ): Promise<Readonly<{ extractionId: string; created: boolean }>> {
    assertCanonicalNormalizationProvenance(input);
    assertRedirectSignalUrl("Meta-refresh redirect URL", input.metaRefreshUrl);
    assertRedirectSignalUrl("JavaScript redirect URL", input.javascriptRedirectUrl);
    if (
      input.status === "failed" &&
      (input.renderingErrorType === null || input.renderingErrorMessage === null)
    ) {
      throw new TypeError("A failed extraction requires bounded error provenance.");
    }
    if (
      input.status === "failed" &&
      ((input.metaRefreshUrl ?? null) !== null || (input.javascriptRedirectUrl ?? null) !== null)
    ) {
      throw new TypeError("A failed extraction cannot persist redirect signals.");
    }
    assertCollectionLimit("Page headings", input.headings.length, 1_000);
    assertCollectionLimit("Page links", input.links.length, 20_000);
    assertCollectionLimit("Page images", input.images.length, 20_000);
    assertCollectionLimit("Page resources", input.resources.length, 20_000);
    assertCollectionLimit("Page structured data", input.structuredData.length, 1_000);

    return this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      const robotsObservationIds = [
        ...new Set(
          input.resources.flatMap((resource) =>
            resource.robotsObservationId === null ? [] : [resource.robotsObservationId],
          ),
        ),
      ];
      const robotsObservationsById = new Map<
        string,
        Readonly<{
          origin: string;
          result: "fetched" | "not_found" | "unavailable" | "invalid";
        }>
      >();
      for (const observationIdBatch of chunk(robotsObservationIds)) {
        const observations = await transaction
          .select({ id: crawlRobots.id, origin: crawlRobots.origin, result: crawlRobots.result })
          .from(crawlRobots)
          .where(
            and(
              eq(crawlRobots.organizationId, context.organizationId),
              eq(crawlRobots.projectId, context.projectId),
              eq(crawlRobots.crawlId, context.crawlId),
              inArray(crawlRobots.id, observationIdBatch),
            ),
          );
        for (const observation of observations) {
          robotsObservationsById.set(
            observation.id,
            Object.freeze({ origin: observation.origin, result: observation.result }),
          );
        }
      }
      for (const resource of input.resources) {
        if (resource.robotsDecision !== "not_checked" && resource.robotsObservationId === null) {
          throw new TypeError("A conclusive resource robots decision requires provenance.");
        }
        if (resource.robotsObservationId === null) continue;
        const observation = robotsObservationsById.get(resource.robotsObservationId);
        if (observation === undefined) {
          throw new DatabaseDomainError("NOT_FOUND", "Robots observation not found.");
        }
        if (resource.normalizedUrl === null) {
          throw new TypeError("Robots resource provenance requires a normalized destination URL.");
        }
        let resourceOrigin: string;
        try {
          resourceOrigin = new URL(resource.normalizedUrl).origin;
        } catch {
          throw new TypeError("Robots resource provenance requires a valid destination URL.");
        }
        if (observation.origin !== resourceOrigin) {
          throw new TypeError(
            "Resource robots observation origin does not match the destination origin.",
          );
        }
        const conclusive =
          (resource.robotsDecision === "allowed" &&
            (observation.result === "fetched" || observation.result === "not_found")) ||
          (resource.robotsDecision === "disallowed" && observation.result === "fetched");
        if (resource.robotsDecision !== "not_checked" && !conclusive) {
          throw new TypeError(
            "An unavailable robots observation cannot produce a conclusive resource decision.",
          );
        }
      }
      const [created] = await transaction
        .insert(crawlPageExtractions)
        .values({
          organizationId: context.organizationId,
          projectId: context.projectId,
          crawlId: context.crawlId,
          pageId: input.pageId,
          source: input.source,
          status: input.status,
          title: input.title,
          documentMetadataComplete:
            input.status === "succeeded" && (input.documentMetadataComplete ?? false),
          titleTagCount: input.titleTagCount ?? 0,
          metaDescription: input.metaDescription,
          metaDescriptionTagCount: input.metaDescriptionTagCount ?? 0,
          metaRobots: [...input.metaRobots],
          xRobotsTag: [...input.xRobotsTag],
          directiveScopePreserved: input.status === "succeeded" && input.directiveScopePreserved,
          linksComplete: input.status === "succeeded" && (input.linksComplete ?? false),
          canonicalUrl: input.canonicalUrl,
          canonicalTagCount: input.canonicalTagCount,
          canonicalNormalizationFailureCode: input.canonicalNormalizationFailure?.code ?? null,
          metaRefreshUrl: input.metaRefreshUrl ?? null,
          javascriptRedirectUrl: input.javascriptRedirectUrl ?? null,
          visibleText: input.visibleText,
          visibleTextComplete: input.status === "succeeded" && (input.visibleTextComplete ?? false),
          wordCount: input.wordCount,
          headingsComplete: input.status === "succeeded" && (input.headingsComplete ?? false),
          htmlLanguage: input.htmlLanguage,
          characterEncoding: input.characterEncoding,
          characterEncodingDeclared: input.characterEncodingDeclared ?? null,
          characterEncodingSource: input.characterEncodingSource ?? null,
          characterEncodingDeclarationOffset: input.characterEncodingDeclarationOffset ?? null,
          viewportDeclarations: [...(input.viewportDeclarations ?? [])],
          htmlDoctypePresent: input.htmlDoctypePresent ?? false,
          iconDeclarationCount: input.iconDeclarationCount ?? 0,
          openGraph: input.openGraph,
          socialCards: input.socialCards,
          contentHash: input.contentHash,
          domHash: input.domHash,
          similarityFingerprint: input.similarityFingerprint,
          meaningfulContent: input.meaningfulContent,
          clientRendered: input.clientRendered,
          renderingErrorType:
            input.renderingErrorType === null ? null : safeErrorType(input.renderingErrorType),
          renderingErrorMessage:
            input.renderingErrorMessage === null
              ? null
              : safeErrorText(input.renderingErrorMessage),
          extractedAt: input.extractedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [crawlPageExtractions.pageId, crawlPageExtractions.source],
        })
        .returning({ id: crawlPageExtractions.id });

      if (created === undefined) {
        const [existing] = await transaction
          .select({
            id: crawlPageExtractions.id,
            status: crawlPageExtractions.status,
            title: crawlPageExtractions.title,
            documentMetadataComplete: crawlPageExtractions.documentMetadataComplete,
            titleTagCount: crawlPageExtractions.titleTagCount,
            metaDescription: crawlPageExtractions.metaDescription,
            metaDescriptionTagCount: crawlPageExtractions.metaDescriptionTagCount,
            contentHash: crawlPageExtractions.contentHash,
            domHash: crawlPageExtractions.domHash,
            similarityFingerprint: crawlPageExtractions.similarityFingerprint,
            metaRobots: crawlPageExtractions.metaRobots,
            xRobotsTag: crawlPageExtractions.xRobotsTag,
            directiveScopePreserved: crawlPageExtractions.directiveScopePreserved,
            linksComplete: crawlPageExtractions.linksComplete,
            canonicalUrl: crawlPageExtractions.canonicalUrl,
            canonicalTagCount: crawlPageExtractions.canonicalTagCount,
            canonicalNormalizationFailureCode:
              crawlPageExtractions.canonicalNormalizationFailureCode,
            metaRefreshUrl: crawlPageExtractions.metaRefreshUrl,
            javascriptRedirectUrl: crawlPageExtractions.javascriptRedirectUrl,
            visibleText: crawlPageExtractions.visibleText,
            visibleTextComplete: crawlPageExtractions.visibleTextComplete,
            wordCount: crawlPageExtractions.wordCount,
            headingsComplete: crawlPageExtractions.headingsComplete,
            htmlLanguage: crawlPageExtractions.htmlLanguage,
            characterEncoding: crawlPageExtractions.characterEncoding,
            characterEncodingDeclared: crawlPageExtractions.characterEncodingDeclared,
            characterEncodingSource: crawlPageExtractions.characterEncodingSource,
            characterEncodingDeclarationOffset:
              crawlPageExtractions.characterEncodingDeclarationOffset,
            viewportDeclarations: crawlPageExtractions.viewportDeclarations,
            htmlDoctypePresent: crawlPageExtractions.htmlDoctypePresent,
            iconDeclarationCount: crawlPageExtractions.iconDeclarationCount,
            openGraph: crawlPageExtractions.openGraph,
            socialCards: crawlPageExtractions.socialCards,
            meaningfulContent: crawlPageExtractions.meaningfulContent,
            clientRendered: crawlPageExtractions.clientRendered,
            renderingErrorType: crawlPageExtractions.renderingErrorType,
            renderingErrorMessage: crawlPageExtractions.renderingErrorMessage,
          })
          .from(crawlPageExtractions)
          .where(
            and(
              eq(crawlPageExtractions.organizationId, context.organizationId),
              eq(crawlPageExtractions.projectId, context.projectId),
              eq(crawlPageExtractions.crawlId, context.crawlId),
              eq(crawlPageExtractions.pageId, input.pageId),
              eq(crawlPageExtractions.source, input.source),
            ),
          )
          .limit(1);
        if (existing === undefined) throw new Error("Extraction deduplication returned no row.");
        if (
          existing.status !== input.status ||
          existing.title !== input.title ||
          existing.documentMetadataComplete !==
            (input.status === "succeeded" && (input.documentMetadataComplete ?? false)) ||
          existing.titleTagCount !== (input.titleTagCount ?? 0) ||
          existing.metaDescription !== input.metaDescription ||
          existing.metaDescriptionTagCount !== (input.metaDescriptionTagCount ?? 0) ||
          existing.contentHash !== input.contentHash ||
          existing.domHash !== input.domHash ||
          existing.similarityFingerprint !== input.similarityFingerprint ||
          existing.directiveScopePreserved !==
            (input.status === "succeeded" && input.directiveScopePreserved) ||
          existing.linksComplete !==
            (input.status === "succeeded" && (input.linksComplete ?? false)) ||
          existing.canonicalUrl !== input.canonicalUrl ||
          existing.canonicalTagCount !== input.canonicalTagCount ||
          existing.canonicalNormalizationFailureCode !==
            (input.canonicalNormalizationFailure?.code ?? null) ||
          existing.metaRefreshUrl !== (input.metaRefreshUrl ?? null) ||
          existing.javascriptRedirectUrl !== (input.javascriptRedirectUrl ?? null) ||
          existing.visibleText !== input.visibleText ||
          existing.visibleTextComplete !==
            (input.status === "succeeded" && (input.visibleTextComplete ?? false)) ||
          existing.wordCount !== input.wordCount ||
          existing.headingsComplete !==
            (input.status === "succeeded" && (input.headingsComplete ?? false)) ||
          existing.htmlLanguage !== input.htmlLanguage ||
          existing.characterEncoding !== input.characterEncoding ||
          existing.characterEncodingDeclared !== (input.characterEncodingDeclared ?? null) ||
          existing.characterEncodingSource !== (input.characterEncodingSource ?? null) ||
          existing.characterEncodingDeclarationOffset !==
            (input.characterEncodingDeclarationOffset ?? null) ||
          JSON.stringify(existing.viewportDeclarations) !==
            JSON.stringify(input.viewportDeclarations ?? []) ||
          existing.htmlDoctypePresent !== (input.htmlDoctypePresent ?? false) ||
          existing.iconDeclarationCount !== (input.iconDeclarationCount ?? 0) ||
          canonicalJson(existing.openGraph) !== canonicalJson(input.openGraph) ||
          canonicalJson(existing.socialCards) !== canonicalJson(input.socialCards) ||
          existing.meaningfulContent !== input.meaningfulContent ||
          existing.clientRendered !== input.clientRendered ||
          existing.renderingErrorType !==
            (input.renderingErrorType === null ? null : safeErrorType(input.renderingErrorType)) ||
          existing.renderingErrorMessage !==
            (input.renderingErrorMessage === null
              ? null
              : safeErrorText(input.renderingErrorMessage)) ||
          JSON.stringify(existing.metaRobots) !== JSON.stringify(input.metaRobots) ||
          JSON.stringify(existing.xRobotsTag) !== JSON.stringify(input.xRobotsTag)
        ) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different extraction already exists for this page source.",
          );
        }
        const [storedHeadings, storedLinks, storedImages, storedResources, storedStructuredData] =
          await Promise.all([
            transaction
              .select({
                level: crawlPageHeadings.level,
                ordinal: crawlPageHeadings.ordinal,
                text: crawlPageHeadings.text,
              })
              .from(crawlPageHeadings)
              .where(
                and(
                  eq(crawlPageHeadings.organizationId, context.organizationId),
                  eq(crawlPageHeadings.projectId, context.projectId),
                  eq(crawlPageHeadings.crawlId, context.crawlId),
                  eq(crawlPageHeadings.pageId, input.pageId),
                  eq(crawlPageHeadings.extractionId, existing.id),
                ),
              )
              .orderBy(asc(crawlPageHeadings.ordinal), asc(crawlPageHeadings.id)),
            transaction
              .select({
                targetFrontierId: crawlPageLinks.targetFrontierId,
                targetUrl: crawlPageLinks.targetUrl,
                normalizedTargetUrl: crawlPageLinks.normalizedTargetUrl,
                targetUrlHash: crawlPageLinks.targetUrlHash,
                scope: crawlPageLinks.scope,
                anchorText: crawlPageLinks.anchorText,
                relValues: crawlPageLinks.relValues,
                linkType: crawlPageLinks.linkType,
                hreflang: crawlPageLinks.hreflang,
                discovered: crawlPageLinks.discovered,
                crawlDepth: crawlPageLinks.crawlDepth,
                discoverySource: crawlPageLinks.discoverySource,
                ordinal: crawlPageLinks.ordinal,
              })
              .from(crawlPageLinks)
              .where(
                and(
                  eq(crawlPageLinks.organizationId, context.organizationId),
                  eq(crawlPageLinks.projectId, context.projectId),
                  eq(crawlPageLinks.crawlId, context.crawlId),
                  eq(crawlPageLinks.sourcePageId, input.pageId),
                  eq(crawlPageLinks.extractionId, existing.id),
                ),
              )
              .orderBy(asc(crawlPageLinks.ordinal), asc(crawlPageLinks.id)),
            transaction
              .select({
                sourceUrl: crawlPageImages.sourceUrl,
                normalizedUrl: crawlPageImages.normalizedUrl,
                urlHash: crawlPageImages.urlHash,
                scope: crawlPageImages.scope,
                altText: crawlPageImages.altText,
                title: crawlPageImages.title,
                width: crawlPageImages.width,
                height: crawlPageImages.height,
                loading: crawlPageImages.loading,
                srcset: crawlPageImages.srcset,
                ordinal: crawlPageImages.ordinal,
              })
              .from(crawlPageImages)
              .where(
                and(
                  eq(crawlPageImages.organizationId, context.organizationId),
                  eq(crawlPageImages.projectId, context.projectId),
                  eq(crawlPageImages.crawlId, context.crawlId),
                  eq(crawlPageImages.pageId, input.pageId),
                  eq(crawlPageImages.extractionId, existing.id),
                ),
              )
              .orderBy(asc(crawlPageImages.ordinal), asc(crawlPageImages.id)),
            transaction
              .select({
                resourceType: crawlPageResources.resourceType,
                sourceUrl: crawlPageResources.sourceUrl,
                normalizedUrl: crawlPageResources.normalizedUrl,
                urlHash: crawlPageResources.urlHash,
                scope: crawlPageResources.scope,
                robotsDecision: crawlPageResources.robotsDecision,
                robotsObservationId: crawlPageResources.robotsObservationId,
                attributes: crawlPageResources.attributes,
                ordinal: crawlPageResources.ordinal,
              })
              .from(crawlPageResources)
              .where(
                and(
                  eq(crawlPageResources.organizationId, context.organizationId),
                  eq(crawlPageResources.projectId, context.projectId),
                  eq(crawlPageResources.crawlId, context.crawlId),
                  eq(crawlPageResources.pageId, input.pageId),
                  eq(crawlPageResources.extractionId, existing.id),
                ),
              )
              .orderBy(asc(crawlPageResources.ordinal), asc(crawlPageResources.id)),
            transaction
              .select({
                kind: crawlPageStructuredData.kind,
                parseStatus: crawlPageStructuredData.parseStatus,
                schemaTypes: crawlPageStructuredData.schemaTypes,
                rawValue: crawlPageStructuredData.rawValue,
                parsedValue: crawlPageStructuredData.parsedValue,
                errorMessage: crawlPageStructuredData.errorMessage,
                ordinal: crawlPageStructuredData.ordinal,
              })
              .from(crawlPageStructuredData)
              .where(
                and(
                  eq(crawlPageStructuredData.organizationId, context.organizationId),
                  eq(crawlPageStructuredData.projectId, context.projectId),
                  eq(crawlPageStructuredData.crawlId, context.crawlId),
                  eq(crawlPageStructuredData.pageId, input.pageId),
                  eq(crawlPageStructuredData.extractionId, existing.id),
                ),
              )
              .orderBy(asc(crawlPageStructuredData.ordinal), asc(crawlPageStructuredData.id)),
          ]);
        const byOrdinal = <T extends { readonly ordinal: number }>(values: readonly T[]): T[] =>
          [...values].sort((left, right) => left.ordinal - right.ordinal);
        if (canonicalJson(storedHeadings) !== canonicalJson(byOrdinal(input.headings))) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different heading observation already exists for this page extraction.",
          );
        }
        const expectedLinks = byOrdinal(input.links).map((link) => ({
          targetFrontierId: link.targetFrontierId,
          targetUrl: link.targetUrl,
          normalizedTargetUrl: link.normalizedTargetUrl,
          targetUrlHash: link.targetUrlHash,
          scope: link.scope,
          anchorText: link.anchorText,
          relValues: [...link.relValues],
          linkType: link.linkType,
          hreflang: link.hreflang,
          discovered: link.discovered,
          crawlDepth: link.crawlDepth,
          discoverySource: link.discoverySource,
          ordinal: link.ordinal,
        }));
        if (canonicalJson(storedLinks) !== canonicalJson(expectedLinks)) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different link observation already exists for this page extraction.",
          );
        }
        if (canonicalJson(storedImages) !== canonicalJson(byOrdinal(input.images))) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different image observation already exists for this page extraction.",
          );
        }
        const expectedResources = [...input.resources]
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((resource) => ({
            resourceType: resource.resourceType,
            sourceUrl: resource.sourceUrl,
            normalizedUrl: resource.normalizedUrl,
            urlHash: resource.urlHash,
            scope: resource.scope,
            robotsDecision: resource.robotsDecision,
            robotsObservationId: resource.robotsObservationId,
            attributes: resource.attributes,
            ordinal: resource.ordinal,
          }));
        if (canonicalJson(storedResources) !== canonicalJson(expectedResources)) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different resource observation already exists for this page extraction.",
          );
        }
        if (
          canonicalJson(storedStructuredData) !== canonicalJson(byOrdinal(input.structuredData))
        ) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different structured-data observation already exists for this page extraction.",
          );
        }
        return Object.freeze({ extractionId: existing.id, created: false });
      }

      const common = {
        organizationId: context.organizationId,
        projectId: context.projectId,
        crawlId: context.crawlId,
        pageId: input.pageId,
        extractionId: created.id,
      } as const;
      const linkedPageIds = await targetPageIdsByUrlHash(
        transaction,
        context,
        input.links.map((link) => link.targetUrlHash),
      );

      for (const batch of chunk(input.headings)) {
        await transaction.insert(crawlPageHeadings).values(
          batch.map((heading) => ({
            ...common,
            level: heading.level,
            ordinal: heading.ordinal,
            text: heading.text,
            createdAt: now,
          })),
        );
      }
      for (const batch of chunk(input.links)) {
        await transaction.insert(crawlPageLinks).values(
          batch.map((link) => ({
            organizationId: context.organizationId,
            projectId: context.projectId,
            crawlId: context.crawlId,
            extractionId: created.id,
            sourcePageId: input.pageId,
            targetFrontierId: link.targetFrontierId,
            targetPageId: linkedPageIds.get(link.targetUrlHash) ?? null,
            targetUrl: link.targetUrl,
            normalizedTargetUrl: link.normalizedTargetUrl,
            targetUrlHash: link.targetUrlHash,
            scope: link.scope,
            anchorText: link.anchorText,
            relValues: [...link.relValues],
            linkType: link.linkType,
            hreflang: link.hreflang,
            discovered: link.discovered,
            crawlDepth: link.crawlDepth,
            discoverySource: link.discoverySource,
            ordinal: link.ordinal,
            createdAt: now,
          })),
        );
      }
      for (const batch of chunk(input.images)) {
        await transaction.insert(crawlPageImages).values(
          batch.map((item) => ({
            ...common,
            sourceUrl: item.sourceUrl,
            normalizedUrl: item.normalizedUrl,
            urlHash: item.urlHash,
            scope: item.scope,
            altText: item.altText,
            title: item.title,
            width: item.width,
            height: item.height,
            loading: item.loading,
            srcset: item.srcset,
            ordinal: item.ordinal,
            createdAt: now,
          })),
        );
      }
      for (const batch of chunk(input.resources)) {
        await transaction.insert(crawlPageResources).values(
          batch.map((item) => ({
            ...common,
            resourceType: item.resourceType,
            sourceUrl: item.sourceUrl,
            normalizedUrl: item.normalizedUrl,
            urlHash: item.urlHash,
            scope: item.scope,
            robotsDecision: item.robotsDecision,
            robotsObservationId: item.robotsObservationId,
            attributes: item.attributes,
            ordinal: item.ordinal,
            createdAt: now,
          })),
        );
      }
      for (const batch of chunk(input.structuredData)) {
        await transaction.insert(crawlPageStructuredData).values(
          batch.map((item) => ({
            ...common,
            kind: item.kind,
            parseStatus: item.parseStatus,
            schemaTypes: [...item.schemaTypes],
            rawValue: item.rawValue,
            parsedValue: item.parsedValue,
            errorMessage: item.errorMessage === null ? null : safeErrorText(item.errorMessage),
            ordinal: item.ordinal,
            createdAt: now,
          })),
        );
      }

      await transaction
        .update(crawls)
        .set({
          extractedPageCount:
            input.source === "raw" && input.status === "succeeded"
              ? sql`${crawls.extractedPageCount} + 1`
              : crawls.extractedPageCount,
          renderedPageCount:
            input.source === "rendered" && input.status === "succeeded"
              ? sql`${crawls.renderedPageCount} + 1`
              : crawls.renderedPageCount,
          extractionFailedCount:
            input.status === "succeeded"
              ? crawls.extractionFailedCount
              : sql`${crawls.extractionFailedCount} + 1`,
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        );
      return Object.freeze({ extractionId: created.id, created: true });
    });
  }

  async persistPageArtifact(
    context: CrawlExecutionContext,
    input: PageArtifactInput,
    now = new Date(),
  ): Promise<Readonly<{ artifactId: string; created: boolean }>> {
    const requiredPrefix = `organizations/${context.organizationId}/projects/${context.projectId}/crawls/${context.crawlId}/pages/${input.pageId}/`;
    const requiredKey = `${requiredPrefix}${input.kind}.html.gz`;
    const storedAt = input.storedAt instanceof Date ? input.storedAt : new Date(input.storedAt);
    if (input.key !== requiredKey || /[\r\n\t]/u.test(input.key)) {
      throw new TypeError("The artifact object key does not match the execution tenant scope.");
    }
    if (Number.isNaN(storedAt.getTime())) throw new TypeError("The artifact storedAt is invalid.");

    return this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      const [created] = await transaction
        .insert(crawlPageArtifacts)
        .values({
          organizationId: context.organizationId,
          projectId: context.projectId,
          crawlId: context.crawlId,
          pageId: input.pageId,
          kind: input.kind === "raw-html" ? "raw_html" : "rendered_html",
          bucket: input.bucket,
          objectKey: input.key,
          objectVersion: input.objectVersion,
          etag: input.etag,
          contentType: input.contentType,
          contentEncoding: input.contentEncoding,
          uncompressedBytes: input.originalBytes,
          storedBytes: input.storedBytes,
          contentSha256: input.contentSha256,
          storageSha256: input.storageSha256,
          storedAt,
          createdAt: now,
        })
        .onConflictDoNothing({ target: [crawlPageArtifacts.pageId, crawlPageArtifacts.kind] })
        .returning({ id: crawlPageArtifacts.id });

      if (created === undefined) {
        const [existing] = await transaction
          .select({
            id: crawlPageArtifacts.id,
            bucket: crawlPageArtifacts.bucket,
            objectKey: crawlPageArtifacts.objectKey,
            contentSha256: crawlPageArtifacts.contentSha256,
            storageSha256: crawlPageArtifacts.storageSha256,
            storedBytes: crawlPageArtifacts.storedBytes,
          })
          .from(crawlPageArtifacts)
          .where(
            and(
              eq(crawlPageArtifacts.organizationId, context.organizationId),
              eq(crawlPageArtifacts.projectId, context.projectId),
              eq(crawlPageArtifacts.crawlId, context.crawlId),
              eq(crawlPageArtifacts.pageId, input.pageId),
              eq(crawlPageArtifacts.kind, input.kind === "raw-html" ? "raw_html" : "rendered_html"),
            ),
          )
          .limit(1);
        if (existing === undefined) throw new Error("Artifact deduplication returned no row.");
        if (
          existing.bucket !== input.bucket ||
          existing.objectKey !== input.key ||
          existing.contentSha256 !== input.contentSha256 ||
          existing.storageSha256 !== input.storageSha256 ||
          existing.storedBytes !== input.storedBytes
        ) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different artifact already exists for this page source.",
          );
        }
        return Object.freeze({ artifactId: existing.id, created: false });
      }

      await transaction
        .update(crawls)
        .set({
          artifactCount: sql`${crawls.artifactCount} + 1`,
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        );
      return Object.freeze({ artifactId: created.id, created: true });
    });
  }

  async persistSitemapObservation(
    context: CrawlExecutionContext,
    input: SitemapObservationInput,
    now = new Date(),
  ): Promise<Readonly<{ sitemapId: string; created: boolean; insertedEntryCount: number }>> {
    assertCollectionLimit("Sitemap entries", input.entries.length, 50_000);
    assertCollectionLimit("Sitemap parse issues", input.parseIssues.length, 1_000);
    if (input.status === "parsed" && !/^[a-f\d]{64}$/u.test(input.contentDigest ?? "")) {
      throw new TypeError("Parsed sitemap observations require a SHA-256 content digest.");
    }
    const urlCount = input.entries.filter((entry) => entry.entryType === "url").length;
    const childSitemapCount = input.entries.length - urlCount;

    return this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      await assertRobotsDecisionProvenance(
        transaction,
        context,
        input.normalizedUrl,
        input.robotsDecision ?? "not_checked",
        input.robotsObservationId,
      );
      const [created] = await transaction
        .insert(crawlSitemaps)
        .values({
          organizationId: context.organizationId,
          projectId: context.projectId,
          crawlId: context.crawlId,
          parentSitemapId: input.parentSitemapId,
          requestedUrl: input.requestedUrl,
          normalizedUrl: input.normalizedUrl,
          finalUrl: input.finalUrl,
          urlHash: input.urlHash,
          source: input.source,
          status: input.status,
          robotsDecision: input.robotsDecision ?? "not_checked",
          robotsObservationId: input.robotsObservationId ?? null,
          format: input.format,
          compression: input.compression,
          statusCode: input.statusCode,
          contentType: input.contentType,
          contentLength: input.contentLength,
          transferSize: input.transferSize,
          contentDigest: input.contentDigest,
          depth: input.depth,
          redirectChain: input.redirectChain,
          parseIssues: input.parseIssues.map((issue) => ({
            code: safeErrorType(issue.code),
            entryIndex: issue.entryIndex,
            message: safeErrorText(issue.message),
          })),
          urlCount,
          childSitemapCount,
          errorType: input.errorType === null ? null : safeErrorType(input.errorType),
          errorMessage: input.errorMessage === null ? null : safeErrorText(input.errorMessage),
          fetchedAt: input.fetchedAt,
          parsedAt: input.parsedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [crawlSitemaps.crawlId, crawlSitemaps.urlHash] })
        .returning({ id: crawlSitemaps.id });

      const sitemapId = created?.id;
      if (sitemapId === undefined) {
        const [existing] = await transaction
          .select({
            id: crawlSitemaps.id,
            status: crawlSitemaps.status,
            robotsDecision: crawlSitemaps.robotsDecision,
            robotsObservationId: crawlSitemaps.robotsObservationId,
            finalUrl: crawlSitemaps.finalUrl,
            contentDigest: crawlSitemaps.contentDigest,
            format: crawlSitemaps.format,
            compression: crawlSitemaps.compression,
            statusCode: crawlSitemaps.statusCode,
            depth: crawlSitemaps.depth,
            urlCount: crawlSitemaps.urlCount,
            childSitemapCount: crawlSitemaps.childSitemapCount,
            errorType: crawlSitemaps.errorType,
            errorMessage: crawlSitemaps.errorMessage,
          })
          .from(crawlSitemaps)
          .where(
            and(
              eq(crawlSitemaps.organizationId, context.organizationId),
              eq(crawlSitemaps.projectId, context.projectId),
              eq(crawlSitemaps.crawlId, context.crawlId),
              eq(crawlSitemaps.urlHash, input.urlHash),
            ),
          )
          .limit(1);
        if (existing === undefined) throw new Error("Sitemap deduplication returned no row.");
        if (
          existing.status !== input.status ||
          existing.robotsDecision !== (input.robotsDecision ?? "not_checked") ||
          existing.robotsObservationId !== (input.robotsObservationId ?? null) ||
          existing.finalUrl !== input.finalUrl ||
          (existing.contentDigest !== null && existing.contentDigest !== input.contentDigest) ||
          existing.format !== input.format ||
          existing.compression !== input.compression ||
          existing.statusCode !== input.statusCode ||
          existing.depth !== input.depth ||
          existing.urlCount !== urlCount ||
          existing.childSitemapCount !== childSitemapCount ||
          existing.errorType !==
            (input.errorType === null ? null : safeErrorType(input.errorType)) ||
          existing.errorMessage !==
            (input.errorMessage === null ? null : safeErrorText(input.errorMessage))
        ) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "A different sitemap observation already exists for this URL.",
          );
        }
        return Object.freeze({ sitemapId: existing.id, created: false, insertedEntryCount: 0 });
      }

      let insertedEntryCount = 0;
      let insertedUrlCount = 0;
      const sitemapTargetPageIds = await targetPageIdsByUrlHash(
        transaction,
        context,
        input.entries.flatMap((entry) => (entry.entryType === "url" ? [entry.urlHash] : [])),
      );
      for (const batch of chunk(input.entries)) {
        const inserted = await transaction
          .insert(crawlSitemapEntries)
          .values(
            batch.map((entry) => ({
              organizationId: context.organizationId,
              projectId: context.projectId,
              crawlId: context.crawlId,
              sitemapId,
              entryType: entry.entryType,
              loc: entry.loc,
              normalizedLoc: entry.normalizedLoc,
              urlHash: entry.urlHash,
              lastmodRaw: entry.lastmodRaw,
              lastmodAt: entry.lastmodAt,
              targetFrontierId: entry.targetFrontierId,
              targetPageId:
                entry.entryType === "url"
                  ? (sitemapTargetPageIds.get(entry.urlHash) ?? null)
                  : null,
              targetSitemapId: entry.targetSitemapId,
              ordinal: entry.ordinal,
              createdAt: now,
            })),
          )
          .onConflictDoNothing({
            target: [
              crawlSitemapEntries.sitemapId,
              crawlSitemapEntries.entryType,
              crawlSitemapEntries.urlHash,
            ],
          })
          .returning({ entryType: crawlSitemapEntries.entryType });
        insertedEntryCount += inserted.length;
        insertedUrlCount += inserted.filter((entry) => entry.entryType === "url").length;
      }

      if (created !== undefined || insertedEntryCount > 0) {
        await transaction
          .update(crawls)
          .set({
            sitemapCount:
              created === undefined ? crawls.sitemapCount : sql`${crawls.sitemapCount} + 1`,
            sitemapUrlCount:
              insertedUrlCount === 0
                ? crawls.sitemapUrlCount
                : sql`${crawls.sitemapUrlCount} + ${insertedUrlCount}`,
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(crawls.organizationId, context.organizationId),
              eq(crawls.projectId, context.projectId),
              eq(crawls.id, context.crawlId),
              eq(crawls.executionToken, context.executionToken),
            ),
          );
      }

      return Object.freeze({
        sitemapId,
        created: created !== undefined,
        insertedEntryCount,
      });
    });
  }

  async persistRobotsObservation(
    context: Readonly<{
      crawlId: string;
      executionToken: string;
      organizationId: string;
      projectId: string;
    }>,
    input: RobotsObservationInput,
    now = new Date(),
  ): Promise<
    Readonly<{
      id: string;
      created: boolean;
      result: "fetched" | "not_found" | "unavailable" | "invalid";
    }>
  > {
    const contentBytes = input.content === null ? 0 : Buffer.byteLength(input.content, "utf8");
    if (contentBytes > MAX_PERSISTED_ROBOTS_BYTES || input.content?.includes("\u0000") === true) {
      throw new TypeError("Robots content must be valid, bounded text.");
    }
    if (
      (input.result === "fetched" &&
        (input.content === null || !/^[a-f\d]{64}$/u.test(input.contentSha256 ?? ""))) ||
      (input.result !== "fetched" && input.content !== null)
    ) {
      throw new TypeError(
        "Only fetched robots observations may persist bounded content and its SHA-256 digest.",
      );
    }
    return this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      const [created] = await transaction
        .insert(crawlRobots)
        .values({
          organizationId: context.organizationId,
          projectId: context.projectId,
          crawlId: context.crawlId,
          origin: input.origin,
          hostname: input.hostname,
          requestedUrl: input.requestedUrl,
          finalUrl: input.finalUrl,
          statusCode: input.statusCode,
          contentType: input.contentType,
          result: input.result,
          userAgent: input.userAgent,
          contentSha256: input.contentSha256,
          content: input.content,
          crawlDelayMs: input.crawlDelayMs,
          sitemapUrls: [...input.sitemapUrls].slice(0, 100),
          fetchedAt: input.fetchedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [crawlRobots.crawlId, crawlRobots.origin] })
        .returning({ id: crawlRobots.id, result: crawlRobots.result });
      if (created !== undefined) {
        return Object.freeze({ ...created, created: true });
      }
      const [existing] = await transaction
        .select({
          id: crawlRobots.id,
          hostname: crawlRobots.hostname,
          requestedUrl: crawlRobots.requestedUrl,
          finalUrl: crawlRobots.finalUrl,
          statusCode: crawlRobots.statusCode,
          contentType: crawlRobots.contentType,
          result: crawlRobots.result,
          userAgent: crawlRobots.userAgent,
          contentSha256: crawlRobots.contentSha256,
          content: crawlRobots.content,
          crawlDelayMs: crawlRobots.crawlDelayMs,
          sitemapUrls: crawlRobots.sitemapUrls,
        })
        .from(crawlRobots)
        .where(
          and(
            eq(crawlRobots.organizationId, context.organizationId),
            eq(crawlRobots.projectId, context.projectId),
            eq(crawlRobots.crawlId, context.crawlId),
            eq(crawlRobots.origin, input.origin),
          ),
        )
        .limit(1);
      if (existing === undefined)
        throw new Error("Robots observation deduplication returned no row.");
      if (
        existing.hostname !== input.hostname ||
        existing.requestedUrl !== input.requestedUrl ||
        existing.finalUrl !== input.finalUrl ||
        existing.statusCode !== input.statusCode ||
        existing.contentType !== input.contentType ||
        existing.result !== input.result ||
        existing.userAgent !== input.userAgent ||
        existing.contentSha256 !== input.contentSha256 ||
        existing.content !== input.content ||
        existing.crawlDelayMs !== input.crawlDelayMs ||
        JSON.stringify(existing.sitemapUrls) !== JSON.stringify(input.sitemapUrls.slice(0, 100))
      ) {
        throw new DatabaseDomainError(
          "CONFLICT",
          "A different robots observation already exists for this crawl origin.",
        );
      }
      return Object.freeze({ id: existing.id, created: false, result: existing.result });
    });
  }

  async saveCheckpoint(
    context: Readonly<{
      crawlId: string;
      executionToken: string;
      organizationId: string;
      projectId: string;
    }>,
    currentDepth: number,
    now = new Date(),
  ): Promise<void> {
    await this.#db.transaction(async (transaction) => {
      await this.#requireExecution(transaction, context, now);
      await transaction
        .insert(crawlCheckpoints)
        .values({
          organizationId: context.organizationId,
          projectId: context.projectId,
          crawlId: context.crawlId,
          currentDepth,
          persistedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: crawlCheckpoints.crawlId,
          set: {
            version: sql`${crawlCheckpoints.version} + 1`,
            currentDepth,
            persistedAt: now,
            updatedAt: now,
          },
        });
    });
  }

  async releaseExecutionForRetry(
    context: CrawlExecutionContext,
    errorType: string,
    errorMessage: string,
    now = new Date(),
  ): Promise<CrawlStatus> {
    return this.#db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
            gt(crawls.executionLeaseExpiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      if (row === undefined) {
        throw new DatabaseDomainError("CONFLICT", "The crawl execution lease is no longer active.");
      }
      if (row.cancellationRequestedAt !== null) {
        await this.#finishCancelled(transaction, row, now, "cancelled_during_retry");
        return "cancelled";
      }
      await transaction
        .update(crawls)
        .set({
          status: "queued",
          executionToken: null,
          executionLeaseExpiresAt: null,
          errorType: safeErrorType(errorType),
          errorMessage: safeErrorText(errorMessage),
          completionReason: "retry_scheduled",
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        );
      return "queued";
    });
  }

  async completeExecution(
    context: CrawlExecutionContext,
    input: Readonly<{
      status: CrawlTerminalStatus;
      completionReason: string;
      errorType?: string | null;
      errorMessage?: string | null;
      now?: Date;
    }>,
  ): Promise<CrawlProgressRecord> {
    const now = input.now ?? new Date();
    return this.#db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
          ),
        )
        .limit(1)
        .for("update");
      if (row === undefined) throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      if (TERMINAL_STATUS_SET.has(row.status)) {
        await ensureAuditEvaluationOutbox(transaction, row, now);
        return mapProgress(row);
      }
      if (row.executionToken !== context.executionToken) {
        throw new DatabaseDomainError("CONFLICT", "The crawl execution lease is no longer active.");
      }
      if (row.executionLeaseExpiresAt === null || row.executionLeaseExpiresAt <= now) {
        throw new DatabaseDomainError("CONFLICT", "The crawl execution lease is no longer active.");
      }

      const terminalStatus =
        row.cancellationRequestedAt !== null
          ? "cancelled"
          : input.status === "failed" && row.succeededCount > 0
            ? "partially_completed"
            : input.status;
      const [updated] = await transaction
        .update(crawls)
        .set({
          status: terminalStatus,
          finishedAt: now,
          executionToken: null,
          executionLeaseExpiresAt: null,
          completionReason:
            terminalStatus === "cancelled"
              ? "cancelled_by_user"
              : safeErrorText(input.completionReason),
          errorType:
            input.errorType === undefined || input.errorType === null
              ? null
              : safeErrorType(input.errorType),
          errorMessage:
            input.errorMessage === undefined || input.errorMessage === null
              ? null
              : safeErrorText(input.errorMessage),
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        )
        .returning();
      if (updated === undefined) throw new Error("Crawl completion returned no row.");
      await releaseUsage(transaction, context, updated.processedCount, now);
      await ensureAuditEvaluationOutbox(transaction, updated, now);
      await writeSystemAudit(transaction, {
        organizationId: updated.organizationId,
        action: `crawl.${terminalStatus}`,
        targetId: context.crawlId,
        traceId: updated.traceId,
        metadata: {
          processedCount: updated.processedCount,
          completionReason: updated.completionReason,
        },
      });
      return mapProgress(updated);
    });
  }

  async finalizeExecutionFailure(
    context: CrawlExecutionContext,
    input: Readonly<{
      attemptsMade: number;
      errorType: string;
      errorMessage: string;
      now?: Date;
    }>,
  ): Promise<"cancelled" | "failed" | "partially_completed"> {
    const now = input.now ?? new Date();
    return this.#db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
            gt(crawls.executionLeaseExpiresAt, now),
            inArray(crawls.status, ["validating", "discovering", "crawling"]),
          ),
        )
        .limit(1)
        .for("update");
      if (row === undefined) {
        throw new DatabaseDomainError("CONFLICT", "The crawl execution lease is no longer active.");
      }

      if (row.cancellationRequestedAt !== null) {
        await this.#finishCancelled(transaction, row, now, "cancelled_during_terminal_failure");
        return "cancelled";
      }

      const terminalStatus = row.succeededCount > 0 ? "partially_completed" : "failed";
      const errorType = safeErrorType(input.errorType);
      const errorMessage = safeErrorText(input.errorMessage);
      const [terminalCrawl] = await transaction
        .update(crawls)
        .set({
          status: terminalStatus,
          finishedAt: now,
          executionToken: null,
          executionLeaseExpiresAt: null,
          completionReason: "queue_attempts_exhausted",
          errorType,
          errorMessage,
          lastProgressAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawls.organizationId, context.organizationId),
            eq(crawls.projectId, context.projectId),
            eq(crawls.id, context.crawlId),
            eq(crawls.executionToken, context.executionToken),
          ),
        )
        .returning();
      if (terminalCrawl === undefined) {
        throw new Error("Crawl failure finalization returned no row.");
      }
      await releaseUsage(transaction, context, row.processedCount, now);
      await ensureAuditEvaluationOutbox(transaction, terminalCrawl, now);

      const attemptsMade = Math.max(1, input.attemptsMade);
      const idempotencyKey = `crawl-dead-${context.crawlId}`;
      const payload: CrawlDeadLetterJobPayload = {
        contractVersion: 1,
        jobType: "crawl.dead-letter",
        organizationId: row.organizationId,
        projectId: row.projectId,
        crawlId: row.id,
        traceId: row.traceId,
        idempotencyKey,
        sourceJobId: row.queueJobId ?? row.id,
        finalStatus: terminalStatus,
        attemptsMade,
        failedAt: now.toISOString(),
        errorType,
        errorMessage,
      };
      await transaction
        .insert(jobOutbox)
        .values({
          organizationId: row.organizationId,
          projectId: row.projectId,
          crawlId: row.id,
          jobType: "crawl.dead-letter",
          contractVersion: 1,
          payload,
          idempotencyKey,
          traceId: row.traceId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [jobOutbox.crawlId, jobOutbox.jobType] });
      await writeSystemAudit(transaction, {
        organizationId: row.organizationId,
        action: `crawl.${terminalStatus}`,
        targetId: row.id,
        traceId: row.traceId,
        metadata: {
          attemptsMade,
          completionReason: "queue_attempts_exhausted",
        },
      });
      return terminalStatus;
    });
  }

  async recordDeadLetter(
    scope: CrawlJobScope,
    input: Readonly<{
      errorType: string;
      errorMessage: string;
      queueJobId?: string;
      attemptsMade?: number;
      now?: Date;
    }>,
  ): Promise<void> {
    const now = input.now ?? new Date();
    await this.#db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, scope.organizationId),
            eq(crawls.projectId, scope.projectId),
            eq(crawls.id, scope.crawlId),
            ...(input.queueJobId === undefined ? [] : [eq(crawls.queueJobId, input.queueJobId)]),
          ),
        )
        .limit(1)
        .for("update");
      if (row === undefined) throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");

      const terminalStatus: CrawlTerminalStatus =
        row.cancellationRequestedAt !== null
          ? "cancelled"
          : row.succeededCount > 0
            ? "partially_completed"
            : "failed";
      let terminalCrawl = row;
      if (!TERMINAL_STATUS_SET.has(row.status)) {
        const [updated] = await transaction
          .update(crawls)
          .set({
            status: terminalStatus,
            finishedAt: now,
            executionToken: null,
            executionLeaseExpiresAt: null,
            completionReason: "queue_attempts_exhausted",
            errorType: safeErrorType(input.errorType),
            errorMessage: safeErrorText(input.errorMessage),
            lastProgressAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(crawls.organizationId, scope.organizationId),
              eq(crawls.projectId, scope.projectId),
              eq(crawls.id, scope.crawlId),
            ),
          )
          .returning();
        if (updated === undefined) throw new Error("Dead-letter finalization returned no row.");
        terminalCrawl = updated;
        await releaseUsage(transaction, scope, row.processedCount, now);
        await writeSystemAudit(transaction, {
          organizationId: row.organizationId,
          action: `crawl.${terminalStatus}`,
          targetId: row.id,
          traceId: row.traceId,
          metadata: {
            attemptsMade: Math.max(1, input.attemptsMade ?? row.attemptCount),
            completionReason: "queue_attempts_exhausted",
          },
        });
      }
      await ensureAuditEvaluationOutbox(transaction, terminalCrawl, now);

      if (terminalCrawl.status === "failed" || terminalCrawl.status === "partially_completed") {
        const idempotencyKey = `crawl-dead-${scope.crawlId}`;
        const payload: CrawlDeadLetterJobPayload = {
          contractVersion: 1,
          jobType: "crawl.dead-letter",
          organizationId: row.organizationId,
          projectId: row.projectId,
          crawlId: scope.crawlId,
          traceId: row.traceId,
          idempotencyKey,
          sourceJobId: scope.crawlId,
          finalStatus: terminalCrawl.status,
          attemptsMade: Math.max(1, input.attemptsMade ?? row.attemptCount),
          failedAt: now.toISOString(),
          errorType: safeErrorType(input.errorType),
          errorMessage: safeErrorText(input.errorMessage),
        };
        await transaction
          .insert(jobOutbox)
          .values({
            organizationId: row.organizationId,
            projectId: row.projectId,
            crawlId: scope.crawlId,
            jobType: "crawl.dead-letter",
            contractVersion: 1,
            payload,
            idempotencyKey,
            traceId: row.traceId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: [jobOutbox.crawlId, jobOutbox.jobType] });
      }
    });
  }

  async #requireExecution(
    transaction: Transaction,
    context: Readonly<{
      crawlId: string;
      executionToken: string;
      organizationId: string;
      projectId: string;
    }>,
    now: Date,
  ): Promise<void> {
    const [row] = await transaction
      .select({ id: crawls.id })
      .from(crawls)
      .where(
        and(
          eq(crawls.id, context.crawlId),
          eq(crawls.organizationId, context.organizationId),
          eq(crawls.projectId, context.projectId),
          eq(crawls.executionToken, context.executionToken),
          gt(crawls.executionLeaseExpiresAt, now),
          inArray(crawls.status, ["validating", "discovering", "crawling"]),
        ),
      )
      .limit(1);
    if (row === undefined) {
      throw new DatabaseDomainError("CONFLICT", "The crawl execution lease is no longer active.");
    }
  }

  async #finishCancelled(
    transaction: Transaction,
    row: typeof crawls.$inferSelect,
    now: Date,
    reason: string,
  ): Promise<void> {
    await transaction
      .update(crawls)
      .set({
        status: "cancelled",
        finishedAt: now,
        executionToken: null,
        executionLeaseExpiresAt: null,
        completionReason: reason,
        lastProgressAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(crawls.organizationId, row.organizationId),
          eq(crawls.projectId, row.projectId),
          eq(crawls.id, row.id),
        ),
      );
    await releaseUsage(
      transaction,
      { organizationId: row.organizationId, projectId: row.projectId, crawlId: row.id },
      row.processedCount,
      now,
    );
  }
}

export function createSearviaCrawlRepository(
  database: SearviaDatabase,
  limits?: AuditSnapshotCollectionLimits,
): SearviaCrawlRepository {
  return new SearviaCrawlRepository(database, limits);
}
