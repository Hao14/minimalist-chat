import type { CrawlErrorCode } from "./errors.js";

export const CRAWL_STATES = [
  "queued",
  "validating",
  "discovering",
  "crawling",
  "cancelled",
  "failed",
  "partially_completed",
  "completed",
] as const;

export type CrawlState = (typeof CRAWL_STATES)[number];

export const DISCOVERY_SOURCES = ["seed", "link", "redirect", "robots_sitemap", "sitemap"] as const;

export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export type QueryParameterPolicy = "keep" | "ignore_tracking" | "ignore_all";

export interface CrawlScope {
  readonly hostname: string;
  readonly includeSubdomains: boolean;
}

export interface CrawlFetchLimits {
  readonly connectTimeoutMs: number;
  readonly dnsTimeoutMs: number;
  readonly headersTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxEncodedBytes: number;
  readonly maxResponseBytes: number;
  readonly maxResponseHeaderBytes: number;
  readonly redirectLimit: number;
  readonly requestTimeoutMs: number;
}

export type FetchKind = "page" | "robots" | "sitemap";

export interface SafeFetchRequest {
  readonly authorizeRedirect?: (redirect: RedirectHop) => Promise<void>;
  readonly kind: FetchKind;
  readonly scheduleRequest?: <T>(
    request: ScheduledFetchRequest,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly scope: CrawlScope;
  readonly signal?: AbortSignal;
  readonly url: string;
}

export interface RedirectHop {
  readonly fromUrl: string;
  readonly statusCode: number;
  readonly toUrl: string;
}

export interface ScheduledFetchRequest {
  readonly redirect: RedirectHop | null;
  readonly url: string;
}

export interface FetchTiming {
  readonly dnsMs: number;
  readonly downloadMs: number;
  readonly startedAt: string;
  readonly totalMs: number;
  readonly ttfbMs: number;
}

/**
 * Final-response headers that are safe to persist as crawl evidence. Values
 * preserve duplicate fields without exposing credential-bearing headers such
 * as Set-Cookie.
 */
export type SafeResponseHeaders = Readonly<Record<string, readonly string[]>>;

export interface SafeFetchResponse {
  readonly body: Uint8Array | null;
  readonly contentEncoding: string | null;
  readonly contentLength: number | null;
  readonly contentType: string | null;
  readonly finalUrl: string;
  readonly normalizedUrl: string;
  readonly omittedResponseHeaders: readonly string[];
  readonly redirectChain: readonly RedirectHop[];
  readonly responseHeaders: SafeResponseHeaders;
  readonly responseBytes: number;
  readonly requestedUrl: string;
  readonly retryAfterMs: number | null;
  readonly statusCode: number;
  readonly timing: FetchTiming;
  readonly transferBytes: number;
}

export interface SafeHttpClient {
  fetch(request: SafeFetchRequest): Promise<SafeFetchResponse>;
}

export interface DnsAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface DnsResolver {
  lookup(hostname: string): Promise<readonly DnsAddress[]>;
}

export interface FrontierEntry {
  readonly countsTowardPageLimit: boolean;
  readonly depth: number;
  readonly discoverySource: DiscoverySource;
  readonly normalizedUrl: string;
  readonly requestedUrl: string;
  readonly sequence: number;
  readonly urlHash: string;
}

export interface CrawlProgress {
  readonly blocked: number;
  readonly bytes: number;
  readonly discovered: number;
  readonly failed: number;
  readonly processed: number;
  readonly queued: number;
  readonly skipped: number;
  readonly succeeded: number;
}

export interface PersistedFetch {
  readonly body: Uint8Array | null;
  readonly contentEncoding: string | null;
  readonly contentLength: number | null;
  readonly contentType: string | null;
  readonly depth: number;
  readonly discoveredUrls: readonly string[];
  readonly discoverySource: DiscoverySource;
  readonly errorCode: CrawlErrorCode | null;
  readonly errorMessage: string | null;
  readonly fetchKind: Exclude<FetchKind, "robots">;
  readonly finalUrl: string | null;
  readonly normalizedUrl: string;
  readonly omittedResponseHeaders: readonly string[];
  readonly redirectChain: readonly RedirectHop[];
  readonly responseHeaders: SafeResponseHeaders;
  readonly requestedUrl: string;
  readonly responseBytes: number;
  readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly statusCode: number | null;
  readonly timing: FetchTiming | null;
  readonly transferBytes: number;
  readonly urlHash: string;
}

export interface RobotsPersistenceRecord {
  readonly contentBytes: number;
  readonly content: string | null;
  readonly contentDigest: string | null;
  readonly contentType: string | null;
  readonly crawlDelayMs: number | null;
  readonly errorCode: CrawlErrorCode | null;
  readonly finalUrl: string | null;
  readonly hostname: string;
  readonly origin: string;
  readonly requestedUrl: string;
  readonly sitemapUrls: readonly string[];
  readonly state: "parsed" | "unavailable" | "unreachable";
  readonly statusCode: number | null;
  readonly userAgent: string;
}

export interface RobotsPersistenceReceipt {
  readonly observationId: string;
  readonly result: "fetched" | "not_found" | "unavailable" | "invalid";
}

export interface ResourceRobotsObservation {
  readonly decision: "allowed" | "disallowed" | "not_checked";
  readonly observationId: string | null;
  readonly result: "fetched" | "not_found" | "unavailable" | "invalid" | null;
}

export interface PersistedFetchContext {
  observeResourceRobots(url: string): Promise<ResourceRobotsObservation>;
}

export interface PersistedSitemapLocation {
  readonly entryType: "sitemap" | "url";
  readonly lastModified: string | null;
  readonly lastModifiedValid: boolean;
  readonly normalizedUrl: string | null;
  readonly rawUrl: string;
  readonly urlHash: string | null;
}

export interface SitemapPersistenceRecord {
  readonly compression: "gzip" | "identity";
  readonly contentLength: number | null;
  readonly documentDigest: string | null;
  readonly contentType: string | null;
  readonly depth: number;
  readonly errorCode: CrawlErrorCode | null;
  readonly errorMessage: string | null;
  readonly finalUrl: string | null;
  readonly kind: "sitemap_index" | "unknown" | "url_set";
  readonly locations: readonly PersistedSitemapLocation[];
  readonly normalizedUrl: string;
  readonly parentPersistenceId: string | null;
  readonly parseIssues: readonly Readonly<{
    code: string;
    entryIndex: number | null;
    message: string;
  }>[];
  readonly redirectChain: readonly RedirectHop[];
  readonly requestedUrl: string;
  readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
  readonly robotsObservationId: string | null;
  readonly source: "default" | "index" | "robots" | "submitted";
  readonly state: "failed" | "parsed" | "skipped";
  readonly statusCode: number | null;
  readonly transferBytes: number;
  readonly urlHash: string;
}

export interface CrawlPersistencePort {
  discover(entry: FrontierEntry): Promise<boolean>;
  recordFetch(fetch: PersistedFetch, context?: PersistedFetchContext): Promise<void>;
  recordProgress(progress: CrawlProgress): Promise<void>;
  recordRobots(record: RobotsPersistenceRecord): Promise<RobotsPersistenceReceipt>;
  recordSitemap(record: SitemapPersistenceRecord): Promise<Readonly<{ id: string }>>;
  transition(state: CrawlState): Promise<void>;
}

export interface CancellationPort {
  isCancellationRequested(): Promise<boolean>;
}

export interface CrawlClock {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface CrawlTarget {
  readonly crawlId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly startUrl: string;
}
