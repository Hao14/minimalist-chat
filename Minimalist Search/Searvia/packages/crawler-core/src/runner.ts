import { createHash } from "node:crypto";

import { CrawlError, isCrawlError, throwIfAborted } from "./errors.js";
import { extractPage } from "./extraction.js";
import {
  BreadthFirstFrontier,
  HostRequestScheduler,
  systemCrawlClock,
  type FrontierCandidate,
  type FrontierLimits,
} from "./frontier.js";
import { createRobotsService, type RobotsPolicy } from "./robots.js";
import { isRetryableHttpStatus, SEARVIA_CRAWLER_USER_AGENT } from "./safe-http.js";
import { parseSitemapDocument, SitemapTraversal } from "./sitemap.js";
import type {
  CancellationPort,
  CrawlClock,
  CrawlPersistencePort,
  CrawlProgress,
  CrawlScope,
  CrawlState,
  CrawlTarget,
  FetchKind,
  FrontierEntry,
  PersistedFetch,
  PersistedFetchContext,
  RobotsPersistenceReceipt,
  SafeFetchResponse,
  SafeHttpClient,
} from "./types.js";
import { hashNormalizedUrl, isUrlInScope, normalizeCrawlUrl } from "./url.js";

export interface CrawlRunnerConfig extends FrontierLimits {
  readonly cancellationPollMs: number;
  readonly concurrency: number;
  readonly includeSubdomains: boolean;
  readonly maxRetries: number;
  readonly maxSitemapUrls: number;
  readonly maxSitemaps: number;
  readonly maxSitemapDepth: number;
  readonly requestDelayMs: number;
  readonly respectRobots: boolean;
  readonly submittedSitemapUrls: readonly string[];
  readonly supportedContentTypes: readonly string[];
  readonly totalDeadlineMs: number;
}

export interface CrawlRunnerDependencies {
  readonly cancellation: CancellationPort;
  readonly client: SafeHttpClient;
  readonly clock?: CrawlClock;
  readonly persistence: CrawlPersistencePort;
  readonly random?: () => number;
}

export interface CrawlRunInput {
  readonly config: CrawlRunnerConfig;
  readonly initialDiscoveredCount?: number;
  readonly initialProcessedCount?: number;
  readonly resumeEntries?: readonly FrontierCandidate[];
  readonly signal?: AbortSignal;
  readonly target: CrawlTarget;
}

export interface CrawlRunResult {
  readonly errorCode: string | null;
  readonly progress: CrawlProgress;
  readonly state: Extract<CrawlState, "cancelled" | "completed" | "failed" | "partially_completed">;
}

export interface CrawlRunner {
  run(input: CrawlRunInput): Promise<CrawlRunResult>;
}

function validateConfig(config: CrawlRunnerConfig): void {
  if (!config.respectRobots) throw new TypeError("M2 crawls must respect robots.txt.");
  const contentTypes = new Set(config.supportedContentTypes);
  if (
    contentTypes.size === 0 ||
    contentTypes.size !== config.supportedContentTypes.length ||
    [...contentTypes].some(
      (contentType) =>
        !["application/xhtml+xml", "application/xml", "text/html", "text/xml"].includes(
          contentType,
        ),
    )
  ) {
    throw new TypeError("Crawl supportedContentTypes contains an invalid or unsupported value.");
  }
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 8) {
    throw new TypeError("Crawl concurrency must be between 1 and 8.");
  }
  if (
    !Number.isInteger(config.requestDelayMs) ||
    config.requestDelayMs < 0 ||
    config.requestDelayMs > 60_000
  ) {
    throw new TypeError("Crawl delay must be between 0 and 60000 ms.");
  }
  if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0 || config.maxRetries > 5) {
    throw new TypeError("Crawl maxRetries must be between 0 and 5.");
  }
  if (!Number.isInteger(config.maxSitemaps) || config.maxSitemaps < 1 || config.maxSitemaps > 100) {
    throw new TypeError("Crawl maxSitemaps must be between 1 and 100.");
  }
  if (
    !Number.isInteger(config.maxSitemapDepth) ||
    config.maxSitemapDepth < 0 ||
    config.maxSitemapDepth > 10
  ) {
    throw new TypeError("Crawl maxSitemapDepth must be between 0 and 10.");
  }
  if (
    !Number.isInteger(config.maxSitemapUrls) ||
    config.maxSitemapUrls < 1 ||
    config.maxSitemapUrls > 50_000
  ) {
    throw new TypeError("Crawl maxSitemapUrls must be between 1 and 50000.");
  }
  if (
    config.submittedSitemapUrls.length > 20 ||
    config.submittedSitemapUrls.some((url) => {
      try {
        normalizeCrawlUrl(url);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new TypeError("Crawl submitted sitemap URLs are invalid or exceed the limit of 20.");
  }
  if (
    !Number.isInteger(config.totalDeadlineMs) ||
    config.totalDeadlineMs < 1_000 ||
    config.totalDeadlineMs > 60 * 60 * 1_000
  ) {
    throw new TypeError("Crawl totalDeadlineMs must be between 1000 and 3600000.");
  }
  if (
    !Number.isInteger(config.cancellationPollMs) ||
    config.cancellationPollMs < 50 ||
    config.cancellationPollMs > 10_000
  ) {
    throw new TypeError("Crawl cancellationPollMs must be between 50 and 10000.");
  }
}

function frozenProgress(progress: CrawlProgress): CrawlProgress {
  return Object.freeze({ ...progress });
}

function persistedResponse(
  entry: FrontierEntry,
  response: SafeFetchResponse,
  robotsDecision: "not_checked" | "allowed" | "disallowed",
  robotsObservationId: string | null,
  fetchKind: Exclude<FetchKind, "robots">,
  discoveredUrls: readonly string[] = [],
): PersistedFetch {
  return Object.freeze({
    body: response.body,
    contentEncoding: response.contentEncoding,
    contentLength: response.contentLength,
    contentType: response.contentType,
    depth: entry.depth,
    discoveredUrls: Object.freeze([...discoveredUrls]),
    discoverySource: entry.discoverySource,
    errorCode: null,
    errorMessage: null,
    fetchKind,
    finalUrl: response.finalUrl,
    normalizedUrl: entry.normalizedUrl,
    omittedResponseHeaders: response.omittedResponseHeaders,
    redirectChain: response.redirectChain,
    responseHeaders: response.responseHeaders,
    requestedUrl: entry.requestedUrl,
    responseBytes: response.responseBytes,
    robotsDecision,
    robotsObservationId,
    statusCode: response.statusCode,
    timing: response.timing,
    transferBytes: response.transferBytes,
    urlHash: entry.urlHash,
  });
}

function persistedError(
  entry: FrontierEntry,
  error: CrawlError,
  robotsDecision: "not_checked" | "allowed" | "disallowed",
  robotsObservationId: string | null,
  fetchKind: Exclude<FetchKind, "robots">,
): PersistedFetch {
  return Object.freeze({
    body: null,
    contentEncoding: null,
    contentLength: null,
    contentType: null,
    depth: entry.depth,
    discoveredUrls: [],
    discoverySource: entry.discoverySource,
    errorCode: error.code,
    errorMessage: error.message,
    fetchKind,
    finalUrl: null,
    normalizedUrl: entry.normalizedUrl,
    omittedResponseHeaders: [],
    redirectChain: [],
    responseHeaders: {},
    requestedUrl: entry.requestedUrl,
    responseBytes: 0,
    robotsDecision,
    robotsObservationId,
    statusCode: null,
    timing: null,
    transferBytes: 0,
    urlHash: entry.urlHash,
  });
}

export function createCrawlRunner(dependencies: CrawlRunnerDependencies): CrawlRunner {
  const clock = dependencies.clock ?? systemCrawlClock;
  const random = dependencies.random ?? Math.random;

  return Object.freeze({
    async run(input: CrawlRunInput): Promise<CrawlRunResult> {
      validateConfig(input.config);
      const supportedContentTypes = new Set(input.config.supportedContentTypes);
      const robotsService = createRobotsService(
        dependencies.client,
        "SearviaBot",
        SEARVIA_CRAWLER_USER_AGENT,
        { clock, maxRetries: input.config.maxRetries, random },
      );
      const controller = new AbortController();
      const signals =
        input.signal === undefined ? [controller.signal] : [input.signal, controller.signal];
      const signal = AbortSignal.any(signals);
      const deadlineTimer = setTimeout(() => {
        controller.abort(
          new CrawlError("request_timeout", "The total crawl deadline was exceeded.", {
            transient: true,
          }),
        );
      }, input.config.totalDeadlineMs);
      deadlineTimer.unref();
      let cancellationCheckInFlight = false;
      const cancellationTimer = setInterval(() => {
        if (cancellationCheckInFlight || controller.signal.aborted) return;
        cancellationCheckInFlight = true;
        void dependencies.cancellation
          .isCancellationRequested()
          .then((cancelled) => {
            if (cancelled) {
              controller.abort(new CrawlError("cancelled", "The crawl was cancelled."));
            }
          })
          .catch((error: unknown) => {
            controller.abort(
              new CrawlError("network_error", "The cancellation state could not be read.", {
                cause: error,
                transient: true,
              }),
            );
          })
          .finally(() => {
            cancellationCheckInFlight = false;
          });
      }, input.config.cancellationPollMs);
      cancellationTimer.unref();

      const progress: {
        blocked: number;
        bytes: number;
        discovered: number;
        failed: number;
        processed: number;
        queued: number;
        skipped: number;
        succeeded: number;
      } = {
        blocked: 0,
        bytes: 0,
        discovered: input.initialDiscoveredCount ?? 0,
        failed: 0,
        processed: 0,
        queued: 0,
        skipped: 0,
        succeeded: 0,
      };
      let robotsUnreachable = false;
      let robotsErrorCode: string | null = null;
      let crawlFailures = 0;

      const transition = async (state: CrawlState): Promise<void> => {
        throwIfAborted(signal);
        await dependencies.persistence.transition(state);
      };
      const assertNotCancelled = async (): Promise<void> => {
        throwIfAborted(signal);
        if (await dependencies.cancellation.isCancellationRequested()) {
          controller.abort(new CrawlError("cancelled", "The crawl was cancelled."));
          throwIfAborted(signal);
        }
      };

      try {
        await assertNotCancelled();
        await transition("validating");
        const seedUrl = normalizeCrawlUrl(input.target.startUrl, {
          queryPolicy: input.config.queryPolicy,
        });
        const seed = new URL(seedUrl);
        const scope: CrawlScope = Object.freeze({
          hostname: seed.hostname.replace(/^\[|\]$/gu, ""),
          includeSubdomains: input.config.includeSubdomains,
        });
        const frontier = new BreadthFirstFrontier(scope, input.config, {
          discoveredCount: input.initialDiscoveredCount ?? 0,
          processedCount: input.initialProcessedCount ?? 0,
        });

        await transition("discovering");
        type ObservedRobotsPolicy = RobotsPolicy &
          Readonly<{ persistence: RobotsPersistenceReceipt }>;
        const robotsPolicies = new Map<string, Promise<ObservedRobotsPolicy>>();
        const robotsFor = (url: string): Promise<ObservedRobotsPolicy> => {
          const parsed = new URL(url);
          const origin = parsed.origin;
          const existing = robotsPolicies.get(origin);
          if (existing !== undefined) return existing;
          const hostScope: CrawlScope = Object.freeze({
            hostname: parsed.hostname.replace(/^\[|\]$/gu, ""),
            includeSubdomains: false,
          });
          const pending = robotsService
            .fetchPolicy(origin, hostScope, signal)
            .then(async (policy) => {
              progress.bytes += policy.contentBytes;
              const persistence = await dependencies.persistence.recordRobots({
                contentBytes: policy.contentBytes,
                content: policy.content,
                contentDigest: policy.contentDigest,
                contentType: policy.contentType,
                crawlDelayMs: policy.crawlDelayMs,
                errorCode: policy.errorCode,
                finalUrl: policy.finalUrl,
                hostname: policy.hostname,
                origin: policy.origin,
                requestedUrl: policy.requestedUrl,
                sitemapUrls: policy.sitemapUrls,
                state: policy.state,
                statusCode: policy.statusCode,
                userAgent: policy.userAgent,
              });
              if (persistence.result === "unavailable" || persistence.result === "invalid") {
                robotsUnreachable = true;
                robotsErrorCode ??= policy.errorCode ?? "robots_unreachable";
              } else if (persistence.result === "fetched" && (policy.crawlDelayMs ?? 0) > 60_000) {
                robotsUnreachable = true;
                robotsErrorCode ??= "crawl_limit";
              }
              return Object.freeze({ ...policy, persistence });
            });
          robotsPolicies.set(origin, pending);
          return pending;
        };
        const robotsDecisionFor = (
          policy: ObservedRobotsPolicy,
          url: string,
        ): "not_checked" | "allowed" | "disallowed" => {
          if (policy.persistence.result === "not_found") return "allowed";
          if (policy.persistence.result !== "fetched") return "not_checked";
          if (!policy.allows(url)) return "disallowed";
          if ((policy.crawlDelayMs ?? 0) > 60_000) return "not_checked";
          return "allowed";
        };
        const robotsBlockMessage = (policy: ObservedRobotsPolicy, url: string): string => {
          if (policy.persistence.result !== "fetched") {
            return "The robots policy was unavailable, so the request was blocked fail-closed.";
          }
          if ((policy.crawlDelayMs ?? 0) > 60_000) {
            return "The robots crawl delay exceeds the supported bound, so the request was blocked fail-closed.";
          }
          if (!policy.allows(url)) return "The URL is explicitly disallowed by robots.txt.";
          return "The robots decision was unavailable, so the request was blocked fail-closed.";
        };
        class RobotsBlockedCrawlError extends CrawlError {
          readonly robotsDecision: "not_checked" | "allowed" | "disallowed";
          readonly robotsObservationId: string | null;
          readonly robotsOrigin: string;

          constructor(policy: ObservedRobotsPolicy, url: string) {
            const robotsDecision = robotsDecisionFor(policy, url);
            const code =
              robotsDecision === "disallowed"
                ? "robots_disallowed"
                : policy.persistence.result === "fetched" && (policy.crawlDelayMs ?? 0) > 60_000
                  ? "crawl_limit"
                  : (policy.errorCode ?? "robots_unreachable");
            super(code, robotsBlockMessage(policy, url));
            this.name = "RobotsBlockedCrawlError";
            this.robotsDecision = robotsDecision;
            this.robotsObservationId = policy.persistence.observationId;
            this.robotsOrigin = policy.origin;
          }
        }
        const boundRobotsBlock = (
          block: RobotsBlockedCrawlError | null,
          normalizedUrl: string,
        ): Readonly<{
          decision: "not_checked" | "allowed" | "disallowed";
          observationId: string | null;
        }> | null => {
          if (block === null) return null;
          return block.robotsOrigin === new URL(normalizedUrl).origin
            ? Object.freeze({
                decision: block.robotsDecision,
                observationId: block.robotsObservationId,
              })
            : Object.freeze({ decision: "not_checked" as const, observationId: null });
        };
        const robots = await robotsFor(seedUrl);
        const persistedFetchContext: PersistedFetchContext = Object.freeze({
          async observeResourceRobots(url: string) {
            const policyPromise = robotsPolicies.get(new URL(url).origin);
            if (policyPromise === undefined) {
              // Extraction must never expand crawl egress solely to support an
              // audit rule. An origin without an already-observed policy stays
              // explicitly unavailable until normal frontier work observes it.
              return Object.freeze({
                decision: "not_checked" as const,
                observationId: null,
                result: null,
              });
            }
            const policy = await policyPromise;
            return Object.freeze({
              decision: robotsDecisionFor(policy, url),
              observationId: policy.persistence.observationId,
              result: policy.persistence.result,
            });
          },
        });

        const addCandidate = async (
          candidate: FrontierCandidate,
          restore = false,
        ): Promise<boolean> => {
          const result = restore ? frontier.restore(candidate) : frontier.add(candidate);
          if (!result.accepted) {
            progress.skipped += 1;
            return result.reason === "duplicate";
          }
          const persisted = await dependencies.persistence.discover(result.entry);
          if (!persisted) {
            frontier.discardPersisted(result.entry);
          }
          progress.discovered = frontier.discoveredCount;
          progress.queued = frontier.queuedCount;
          return persisted;
        };

        for (const entry of input.resumeEntries ?? []) {
          await addCandidate(entry, true);
        }

        const seedRobotsDecision = robotsDecisionFor(robots, seedUrl);
        if (seedRobotsDecision === "allowed") {
          await addCandidate({ depth: 0, discoverySource: "seed", requestedUrl: seedUrl });
        } else {
          const seedEntry: FrontierEntry = Object.freeze({
            countsTowardPageLimit: true,
            depth: 0,
            discoverySource: "seed",
            normalizedUrl: seedUrl,
            requestedUrl: seedUrl,
            sequence: 0,
            urlHash: hashNormalizedUrl(seedUrl),
          });
          progress.blocked += 1;
          progress.processed += 1;
          await dependencies.persistence.recordFetch(
            persistedError(
              seedEntry,
              new RobotsBlockedCrawlError(robots, seedUrl),
              seedRobotsDecision,
              robots.persistence.observationId,
              "page",
            ),
            persistedFetchContext,
          );
        }

        const schedulers = new Map<string, HostRequestScheduler>();
        const schedulerFor = (url: string, policy: RobotsPolicy): HostRequestScheduler => {
          const origin = new URL(url).origin;
          const existing = schedulers.get(origin);
          if (existing !== undefined) return existing;
          const effectiveDelayMs = Math.max(
            input.config.requestDelayMs,
            Math.min(policy.crawlDelayMs ?? 0, 60_000),
          );
          const scheduler = new HostRequestScheduler(
            clock,
            input.config.concurrency,
            effectiveDelayMs,
          );
          schedulers.set(origin, scheduler);
          return scheduler;
        };

        const fetchWithRetries = async (
          url: string,
          kind: FetchKind,
          policy: RobotsPolicy,
        ): Promise<SafeFetchResponse> => {
          let attempt = 0;
          for (;;) {
            await assertNotCancelled();
            try {
              const response = await dependencies.client.fetch({
                async authorizeRedirect(redirect) {
                  const redirectPolicy = await robotsFor(redirect.toUrl);
                  if (robotsDecisionFor(redirectPolicy, redirect.toUrl) !== "allowed") {
                    throw new RobotsBlockedCrawlError(redirectPolicy, redirect.toUrl);
                  }
                },
                kind,
                async scheduleRequest(scheduled, operation) {
                  const scheduledPolicy =
                    scheduled.redirect === null ? policy : await robotsFor(scheduled.url);
                  return schedulerFor(scheduled.url, scheduledPolicy).run(
                    new URL(scheduled.url).hostname,
                    operation,
                    signal,
                  );
                },
                scope,
                signal,
                url,
              });
              if (isRetryableHttpStatus(response.statusCode) && attempt < input.config.maxRetries) {
                const baseDelay = Math.min(250 * 2 ** attempt, 5_000);
                const jitter = Math.floor(baseDelay * 0.2 * Math.max(0, Math.min(1, random())));
                await clock.sleep(response.retryAfterMs ?? baseDelay + jitter, signal);
                attempt += 1;
                continue;
              }
              return response;
            } catch (error) {
              if (!isCrawlError(error)) throw error;
              const crawlError = error;
              if (!crawlError.transient || attempt >= input.config.maxRetries) throw crawlError;
              const baseDelay = Math.min(250 * 2 ** attempt, 5_000);
              const jitter = Math.floor(baseDelay * 0.2 * Math.max(0, Math.min(1, random())));
              await clock.sleep(baseDelay + jitter, signal);
              attempt += 1;
            }
          }
        };

        const sitemapTraversal = new SitemapTraversal({
          maxDepth: input.config.maxSitemapDepth,
          maxFiles: input.config.maxSitemaps,
        });
        const sitemapPersistenceIds = new Map<string, string>();
        const addSitemap = (
          requestedUrl: string,
          discoverySource: "default" | "index" | "robots" | "submitted",
          depth = 0,
          parentSitemapUrl: string | null = null,
        ): void => {
          let normalizedUrl: string;
          try {
            normalizedUrl = normalizeCrawlUrl(requestedUrl);
          } catch {
            return;
          }
          if (!isUrlInScope(normalizedUrl, scope)) return;
          sitemapTraversal.add({
            depth,
            discoverySource,
            parentSitemapUrl,
            requestedUrl: normalizedUrl,
          });
        };

        for (const submitted of input.config.submittedSitemapUrls) {
          addSitemap(submitted, "submitted");
        }
        for (const declared of robots.sitemapUrls) addSitemap(declared, "robots");

        let persistedSitemapUrlCount = 0;
        for (;;) {
          await assertNotCancelled();
          const sitemap = sitemapTraversal.next();
          if (sitemap === null) break;
          if (sitemapPersistenceIds.has(sitemap.normalizedUrl)) continue;
          const parentPersistenceId =
            sitemap.parentSitemapUrl === null
              ? null
              : (sitemapPersistenceIds.get(normalizeCrawlUrl(sitemap.parentSitemapUrl)) ?? null);
          const sitemapPolicy = await robotsFor(sitemap.normalizedUrl);
          const sitemapRobotsDecision = robotsDecisionFor(sitemapPolicy, sitemap.normalizedUrl);
          if (sitemapRobotsDecision !== "allowed") {
            const persisted = await dependencies.persistence.recordSitemap({
              compression: "identity",
              contentLength: null,
              documentDigest: null,
              contentType: null,
              depth: sitemap.depth,
              errorCode: new RobotsBlockedCrawlError(sitemapPolicy, sitemap.normalizedUrl).code,
              errorMessage: robotsBlockMessage(sitemapPolicy, sitemap.normalizedUrl),
              finalUrl: null,
              kind: "unknown",
              locations: [],
              normalizedUrl: sitemap.normalizedUrl,
              parentPersistenceId,
              parseIssues: [],
              redirectChain: [],
              requestedUrl: sitemap.requestedUrl,
              robotsDecision: sitemapRobotsDecision,
              robotsObservationId: sitemapPolicy.persistence.observationId,
              source: sitemap.discoverySource,
              state: "skipped",
              statusCode: null,
              transferBytes: 0,
              urlHash: sitemap.urlHash,
            });
            sitemapPersistenceIds.set(sitemap.normalizedUrl, persisted.id);
            continue;
          }

          let response: SafeFetchResponse;
          try {
            response = await fetchWithRetries(sitemap.normalizedUrl, "sitemap", sitemapPolicy);
          } catch (error) {
            if (!isCrawlError(error)) throw error;
            if (error.code === "cancelled") throw error;
            const robotsBlock = error instanceof RobotsBlockedCrawlError ? error : null;
            const boundBlock = boundRobotsBlock(robotsBlock, sitemap.normalizedUrl);
            const persisted = await dependencies.persistence.recordSitemap({
              compression: "identity",
              contentLength: null,
              documentDigest: null,
              contentType: null,
              depth: sitemap.depth,
              errorCode: error.code,
              errorMessage: error.message,
              finalUrl: null,
              kind: "unknown",
              locations: [],
              normalizedUrl: sitemap.normalizedUrl,
              parentPersistenceId,
              parseIssues: [],
              redirectChain: [],
              requestedUrl: sitemap.requestedUrl,
              robotsDecision: boundBlock?.decision ?? sitemapRobotsDecision,
              robotsObservationId:
                boundBlock === null
                  ? sitemapPolicy.persistence.observationId
                  : boundBlock.observationId,
              source: sitemap.discoverySource,
              state: "failed",
              statusCode: null,
              transferBytes: 0,
              urlHash: sitemap.urlHash,
            });
            sitemapPersistenceIds.set(sitemap.normalizedUrl, persisted.id);
            continue;
          }

          progress.bytes += response.responseBytes;
          let document: ReturnType<typeof parseSitemapDocument>;
          try {
            document = parseSitemapDocument(
              {
                body: response.body ?? new Uint8Array(),
                contentEncoding: response.contentEncoding,
                contentType: response.contentType,
                depth: sitemap.depth,
                discoverySource: sitemap.discoverySource,
                finalUrl: response.finalUrl,
                redirectChain: response.redirectChain,
                requestedUrl: sitemap.requestedUrl,
                statusCode: response.statusCode,
                transferBytes: response.transferBytes,
              },
              {
                maxCompressedBytes: Math.min(
                  10 * 1_024 * 1_024,
                  Math.max(1_024, input.config.maxSitemapUrls * 200),
                ),
                maxDecompressedBytes: 10 * 1_024 * 1_024,
                maxEntries: input.config.maxSitemapUrls,
              },
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "The sitemap could not be parsed.";
            const persisted = await dependencies.persistence.recordSitemap({
              compression:
                response.contentEncoding?.includes("gzip") === true ? "gzip" : "identity",
              contentLength: response.contentLength,
              documentDigest:
                response.body === null
                  ? null
                  : createHash("sha256").update(response.body).digest("hex"),
              contentType: response.contentType,
              depth: sitemap.depth,
              errorCode: "parse_error",
              errorMessage: message,
              finalUrl: response.finalUrl,
              kind: "unknown",
              locations: [],
              normalizedUrl: sitemap.normalizedUrl,
              parentPersistenceId,
              parseIssues: [],
              redirectChain: response.redirectChain,
              requestedUrl: sitemap.requestedUrl,
              robotsDecision: sitemapRobotsDecision,
              robotsObservationId: sitemapPolicy.persistence.observationId,
              source: sitemap.discoverySource,
              state: "failed",
              statusCode: response.statusCode,
              transferBytes: response.transferBytes,
              urlHash: sitemap.urlHash,
            });
            sitemapPersistenceIds.set(sitemap.normalizedUrl, persisted.id);
            sitemapPersistenceIds.set(normalizeCrawlUrl(response.finalUrl), persisted.id);
            continue;
          }

          const remainingSitemapUrls = Math.max(
            0,
            input.config.maxSitemapUrls - persistedSitemapUrlCount,
          );
          const retainedLocations =
            document.kind === "url_set"
              ? document.locations.slice(0, remainingSitemapUrls)
              : document.locations.slice(0, input.config.maxSitemaps);
          if (document.kind === "url_set") persistedSitemapUrlCount += retainedLocations.length;

          const persisted = await dependencies.persistence.recordSitemap({
            compression: document.compression,
            contentLength: response.contentLength,
            documentDigest: document.contentDigest,
            contentType: document.contentType,
            depth: document.depth,
            errorCode: document.state === "invalid" ? "parse_error" : null,
            errorMessage:
              document.issues.length === 0
                ? null
                : document.issues
                    .map((issue) => issue.message)
                    .join(" ")
                    .slice(0, 2_000),
            finalUrl: document.finalUrl,
            kind: document.kind,
            locations: retainedLocations.map((location) => ({
              entryType: document.kind === "sitemap_index" ? "sitemap" : "url",
              lastModified: location.lastModified,
              lastModifiedValid: location.lastModifiedValid,
              normalizedUrl: location.normalizedUrl,
              rawUrl: location.rawUrl,
              urlHash: location.urlHash,
            })),
            normalizedUrl: sitemap.normalizedUrl,
            parentPersistenceId,
            parseIssues: document.issues,
            redirectChain: document.redirectChain,
            requestedUrl: document.requestedUrl,
            robotsDecision: sitemapRobotsDecision,
            robotsObservationId: sitemapPolicy.persistence.observationId,
            source: document.discoverySource,
            state: document.state === "parsed" ? "parsed" : "failed",
            statusCode: document.statusCode,
            transferBytes: response.transferBytes,
            urlHash: sitemap.urlHash,
          });
          sitemapPersistenceIds.set(sitemap.normalizedUrl, persisted.id);
          sitemapPersistenceIds.set(normalizeCrawlUrl(document.finalUrl), persisted.id);

          // Commit the immutable sitemap snapshot before mutating the crawl
          // frontier. A changed replay therefore conflicts without leaking URLs
          // from a different document. If the process stops after this commit,
          // the same-digest idempotent replay continues with these discoveries.
          if (document.state === "parsed") {
            if (document.kind === "sitemap_index") {
              for (const location of retainedLocations) {
                addSitemap(
                  location.normalizedUrl ?? location.rawUrl,
                  "index",
                  document.depth + 1,
                  document.finalUrl,
                );
              }
            } else if (document.kind === "url_set") {
              for (const location of retainedLocations) {
                if (location.normalizedUrl === null) continue;
                await addCandidate({
                  depth: 0,
                  discoverySource: "sitemap",
                  requestedUrl: location.normalizedUrl,
                });
              }
            }
          }
        }

        await transition("crawling");
        for (;;) {
          await assertNotCancelled();
          const batch = frontier.nextBatch(input.config.concurrency);
          progress.queued = frontier.queuedCount;
          if (batch.length === 0) break;

          const settledBatch = await Promise.allSettled(
            batch.map(async (entry) => {
              await assertNotCancelled();
              const entryRobots = await robotsFor(entry.normalizedUrl);
              const entryRobotsDecision = robotsDecisionFor(entryRobots, entry.normalizedUrl);
              if (entryRobotsDecision !== "allowed") {
                progress.blocked += 1;
                progress.processed += 1;
                await dependencies.persistence.recordFetch(
                  persistedError(
                    entry,
                    new RobotsBlockedCrawlError(entryRobots, entry.normalizedUrl),
                    entryRobotsDecision,
                    entryRobots.persistence.observationId,
                    "page",
                  ),
                  persistedFetchContext,
                );
                return;
              }

              let response: SafeFetchResponse;
              try {
                response = await fetchWithRetries(entry.normalizedUrl, "page", entryRobots);
              } catch (error) {
                if (!isCrawlError(error)) throw error;
                if (error.code === "cancelled") throw error;
                progress.processed += 1;
                const robotsBlock = error instanceof RobotsBlockedCrawlError ? error : null;
                const boundBlock = boundRobotsBlock(robotsBlock, entry.normalizedUrl);
                if (robotsBlock !== null) progress.blocked += 1;
                else {
                  progress.failed += 1;
                  crawlFailures += 1;
                }
                await dependencies.persistence.recordFetch(
                  persistedError(
                    entry,
                    error,
                    boundBlock?.decision ?? entryRobotsDecision,
                    boundBlock === null
                      ? entryRobots.persistence.observationId
                      : boundBlock.observationId,
                    "page",
                  ),
                  persistedFetchContext,
                );
                return;
              }

              progress.processed += 1;
              progress.bytes += response.responseBytes;
              const contentTypeAllowed =
                response.contentType !== null && supportedContentTypes.has(response.contentType);
              if (response.statusCode >= 400) progress.failed += 1;
              else if (!contentTypeAllowed) progress.skipped += 1;
              else progress.succeeded += 1;
              if (isRetryableHttpStatus(response.statusCode)) crawlFailures += 1;
              const discoveredUrls: string[] = [];
              if (
                contentTypeAllowed &&
                response.body !== null &&
                response.statusCode >= 200 &&
                response.statusCode < 300 &&
                response.contentType !== null &&
                ["application/xhtml+xml", "text/html"].includes(response.contentType)
              ) {
                try {
                  const extraction = extractPage(
                    {
                      contentType: response.contentType,
                      depth: entry.depth,
                      finalUrl: response.finalUrl,
                      headers: response.responseHeaders,
                      includeSubdomains: input.config.includeSubdomains,
                      normalizedUrl: entry.normalizedUrl,
                      raw: { body: response.body, kind: "raw" },
                      redirectChain: response.redirectChain,
                      requestedUrl: entry.requestedUrl,
                      responseBytes: response.responseBytes,
                      scopeHostname: scope.hostname,
                      statusCode: response.statusCode,
                      transferSize: response.transferBytes,
                    },
                    {
                      maxDocumentBytes: Math.max(2 * 1_024 * 1_024, response.body.byteLength),
                      maxExtractedItems: input.config.maxDiscoveredUrls,
                    },
                  );
                  const links = new Set<string>();
                  for (const extractedLink of extraction.raw.links) {
                    if (
                      extractedLink.internal !== true ||
                      extractedLink.normalizedTargetUrl === null
                    ) {
                      continue;
                    }
                    links.add(
                      normalizeCrawlUrl(extractedLink.normalizedTargetUrl, {
                        queryPolicy: input.config.queryPolicy,
                      }),
                    );
                  }
                  for (const link of links) {
                    if (
                      await addCandidate({
                        depth: entry.depth + 1,
                        discoverySource: "link",
                        requestedUrl: link,
                      })
                    ) {
                      discoveredUrls.push(link);
                    }
                  }
                } catch (error) {
                  // A deterministic extraction safety limit must not discard the
                  // fetched response or turn the whole queue job into a retry loop.
                  // The worker persists the page artifact and extraction failure.
                  if (!(error instanceof TypeError)) throw error;
                }
              }
              const persisted = persistedResponse(
                entry,
                response,
                entryRobotsDecision,
                entryRobots.persistence.observationId,
                "page",
                discoveredUrls,
              );
              await dependencies.persistence.recordFetch(
                contentTypeAllowed || response.statusCode >= 400
                  ? persisted
                  : Object.freeze({
                      ...persisted,
                      errorCode: "unsupported_content_type" as const,
                      errorMessage:
                        "The response content type is outside the configured page allowlist.",
                    }),
                persistedFetchContext,
              );
            }),
          );
          const rejected = settledBatch.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          );
          if (rejected !== undefined) throw rejected.reason;
          progress.discovered = frontier.discoveredCount;
          progress.queued = frontier.queuedCount;
          await dependencies.persistence.recordProgress(frozenProgress(progress));
        }

        const state: CrawlRunResult["state"] =
          crawlFailures > 0 || robotsUnreachable
            ? progress.succeeded > 0
              ? "partially_completed"
              : "failed"
            : "completed";
        await dependencies.persistence.recordProgress(frozenProgress(progress));
        await dependencies.persistence.transition(state);
        return Object.freeze({
          errorCode: robotsUnreachable ? robotsErrorCode : null,
          progress: frozenProgress(progress),
          state,
        });
      } catch (error) {
        if (!isCrawlError(error)) throw error;
        const crawlError = error;
        const state: CrawlRunResult["state"] =
          crawlError.code === "cancelled"
            ? "cancelled"
            : progress.succeeded > 0
              ? "partially_completed"
              : "failed";
        try {
          await dependencies.persistence.recordProgress(frozenProgress(progress));
        } catch {
          // The original failure remains the stable result; the worker logs persistence failure.
        }
        try {
          await dependencies.persistence.transition(state);
        } catch {
          // The original failure remains the stable result; the worker logs persistence failure.
        }
        return Object.freeze({
          errorCode: crawlError.code,
          progress: frozenProgress(progress),
          state,
        });
      } finally {
        clearInterval(cancellationTimer);
        clearTimeout(deadlineTimer);
      }
    },
  });
}
