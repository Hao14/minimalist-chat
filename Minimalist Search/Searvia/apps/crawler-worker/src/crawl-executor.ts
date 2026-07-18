import {
  applicableRobotsDirectives,
  createCrawlRunner,
  createSafeHttpClient,
  evaluateRenderingNeed,
  extractPage,
  hashNormalizedUrl,
  isUrlInScope,
  normalizeCrawlUrl,
  sniffHtmlDocument,
  type CrawlPersistencePort,
  type CrawlState,
  type FrontierEntry,
  type HtmlDocumentExtraction,
  type JsonValue,
  type PageExtractionResult,
  type PersistedFetch,
  type PersistedFetchContext,
  type RobotsPersistenceRecord,
  type RobotsPersistenceReceipt,
  type ResourceRobotsObservation,
  type SitemapPersistenceRecord,
} from "@searvia/crawler-core";
import type {
  CrawlWorkerRepository,
  WorkerExecutionContext,
  WorkerFetchTiming,
  WorkerPageObservationInput,
  WorkerRedirectHop,
  WorkerStoredPageObservation,
} from "@searvia/database/workers";
import type { CrawlProgressCounters } from "@searvia/shared-types";

import {
  ArtifactStorageError,
  type PageArtifactStore,
  type StoredPageArtifact,
} from "./artifact-storage.js";
import type { DatabaseCrawlProcessingPersistence } from "./database-adapter.js";
import {
  CrawlExecutionError,
  type AuthorizedCrawlExecution,
  type CrawlExecutionHooks,
  type CrawlExecutionResult,
  type CrawlExecutor,
} from "./processor.js";
import type { BoundedBrowserRenderer, BrowserRenderingError } from "./renderer.js";

type PageExtractionPersistenceInput = Parameters<CrawlWorkerRepository["persistPageExtraction"]>[1];
type PageLinkPersistenceInput = PageExtractionPersistenceInput["links"][number];
type PageResourcePersistenceInput = PageExtractionPersistenceInput["resources"][number];
type PageStructuredDataPersistenceInput = PageExtractionPersistenceInput["structuredData"][number];
type SitemapObservationPersistenceInput = Parameters<
  CrawlWorkerRepository["persistSitemapObservation"]
>[1];

export interface CrawlPageRenderer {
  render: BoundedBrowserRenderer["render"];
  close(): Promise<void>;
}

export interface SafeDatabaseCrawlExecutorOptions {
  readonly artifactStore: PageArtifactStore;
  readonly renderer?: CrawlPageRenderer;
  readonly workerRenderingEnabled: boolean;
}

const CACHE_HEADERS = new Set([
  "age",
  "cache-control",
  "etag",
  "expires",
  "last-modified",
  "pragma",
  "surrogate-control",
  "vary",
]);
const SECURITY_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "origin-agent-cluster",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "x-permitted-cross-domain-policies",
]);

function fetchOutcome(fetch: PersistedFetch): "succeeded" | "failed" | "blocked" | "skipped" {
  if (fetch.robotsDecision !== "allowed" || fetch.errorCode === "robots_disallowed") {
    return "blocked";
  }
  if (fetch.errorCode === "unsupported_content_type") return "skipped";
  if (fetch.errorCode !== null || fetch.statusCode === null || fetch.statusCode >= 400) {
    return "failed";
  }
  return "succeeded";
}

function storedTiming(fetch: PersistedFetch): WorkerFetchTiming | null {
  if (fetch.timing === null) return null;
  return Object.freeze({
    startedAt: fetch.timing.startedAt,
    dnsMs: Math.max(0, Math.round(fetch.timing.dnsMs)),
    ttfbMs: Math.max(0, Math.round(fetch.timing.ttfbMs)),
    downloadMs: Math.max(0, Math.round(fetch.timing.downloadMs)),
    totalMs: Math.max(0, Math.round(fetch.timing.totalMs)),
  });
}

function storedRedirects(
  fetch: Pick<PersistedFetch, "redirectChain">,
): readonly WorkerRedirectHop[] {
  return fetch.redirectChain.map((hop, sequence) =>
    Object.freeze({
      sequence,
      requestedUrl: hop.fromUrl,
      statusCode: hop.statusCode,
      location: hop.toUrl,
      resolvedUrl: hop.toUrl,
    }),
  );
}

function selectedHeaders(
  headers: PersistedFetch["responseHeaders"],
  selected: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers)
        .filter(([name]) => selected.has(name.toLowerCase()))
        .map(([name, values]) => [name.toLowerCase(), Object.freeze([...values])]),
    ),
  );
}

function metadataRecord(metadata: HtmlDocumentExtraction["openGraph"]): Readonly<{
  values: Readonly<Record<string, readonly string[]>>;
  complete: boolean;
}> {
  const result: Record<string, readonly string[]> = {};
  const persistedEntryBytes = new Map<string, number>();
  let persistedBytes = 2;
  let complete = true;
  for (const property of metadata) {
    const key = truncateUtf8Bytes(property.key, 512);
    const values = property.values.slice(0, 16).map((value) => truncateUtf8Bytes(value, 4_096));
    if (
      Buffer.byteLength(property.key, "utf8") > 512 ||
      property.values.length > 16 ||
      property.values.some((value) => Buffer.byteLength(value, "utf8") > 4_096)
    ) {
      complete = false;
    }
    const entryBytes =
      Buffer.byteLength(JSON.stringify(key), "utf8") +
      2 +
      Buffer.byteLength(JSON.stringify(values), "utf8") +
      Math.max(0, values.length - 1);
    const previousEntryBytes = persistedEntryBytes.get(key);
    const candidateBytes =
      previousEntryBytes === undefined
        ? persistedBytes + (persistedEntryBytes.size === 0 ? 0 : 2) + entryBytes
        : persistedBytes - previousEntryBytes + entryBytes;
    if (candidateBytes > 120_000) {
      complete = false;
      break;
    }
    result[key] = Object.freeze(values);
    persistedEntryBytes.set(key, entryBytes);
    persistedBytes = candidateBytes;
  }
  return Object.freeze({ values: Object.freeze(result), complete });
}

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function truncateCharacters(value: string, maximumCharacters: number): string {
  return [...value].slice(0, maximumCharacters).join("");
}

function containsAtMostCharacters(value: string, maximumCharacters: number): boolean {
  const characters = value[Symbol.iterator]();
  for (let count = 0; count <= maximumCharacters; count += 1) {
    if (characters.next().done === true) return true;
  }
  return false;
}

function truncateUtf8Bytes(value: string, maximumBytes: number): string {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maximumBytes) return value;
  return encoded
    .subarray(0, maximumBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

function boundedUrl(value: string | null): string | null {
  return value !== null && value.length <= 4_096 ? value : null;
}

function boundedTokens(values: readonly string[], maximum = 64): readonly string[] {
  return boundedTokensWithCompleteness(values, maximum).values;
}

function boundedTokensWithCompleteness(
  values: readonly string[],
  maximum = 64,
): Readonly<{ values: readonly string[]; complete: boolean }> {
  const bounded = values
    .slice(0, maximum)
    .map((value) => truncateUtf8Bytes(value, 120))
    .filter(Boolean);
  return Object.freeze({
    values: Object.freeze(bounded),
    complete:
      values.length <= maximum && values.every((value) => Buffer.byteLength(value, "utf8") <= 120),
  });
}

function attributes(
  values: Readonly<Record<string, string | number | boolean | null>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)
        .map(([key, value]) => [key, truncateUtf8Bytes(String(value), 8_192)]),
    ),
  );
}

function jsonSchemaTypes(value: JsonValue | null): readonly string[] {
  if (value === null) return [];
  const found = new Set<string>();
  const pending: JsonValue[] = [value];
  let visited = 0;
  while (pending.length > 0 && visited < 1_000) {
    const current = pending.pop();
    if (current === undefined || current === null || typeof current !== "object") continue;
    visited += 1;
    if (Array.isArray(current)) {
      for (const nested of current) pending.push(nested);
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (key === "@type") {
        if (typeof nested === "string") found.add(nested);
        else if (Array.isArray(nested)) {
          for (const candidate of nested) {
            if (typeof candidate === "string") found.add(candidate);
          }
        }
      }
      pending.push(nested);
    }
  }
  return boundedTokens([...found], 64);
}

function renderingFailure(errors: readonly BrowserRenderingError[]): Readonly<{
  type: string | null;
  message: string | null;
}> {
  if (errors.length === 0) return Object.freeze({ type: null, message: null });
  return Object.freeze({
    type: truncateCharacters(errors.map((error) => error.code).join(","), 120),
    message: truncateCharacters(errors.map((error) => error.message).join(" "), 2_000),
  });
}

function boundedSitemapParseIssues(
  issues: SitemapPersistenceRecord["parseIssues"],
): SitemapObservationPersistenceInput["parseIssues"] {
  const result: Array<SitemapObservationPersistenceInput["parseIssues"][number]> = [];
  for (const issue of issues.slice(0, 1_000)) {
    const bounded = Object.freeze({
      code: nullableText(truncateCharacters(issue.code, 120)) ?? "sitemap_parse_issue",
      entryIndex: issue.entryIndex,
      message:
        nullableText(truncateCharacters(issue.message, 2_000)) ??
        "The sitemap contains an invalid entry.",
    });
    if (Buffer.byteLength(JSON.stringify([...result, bounded])) > 120_000) break;
    result.push(bounded);
  }
  return Object.freeze(result);
}

function storedArtifact(pageId: string, artifact: StoredPageArtifact) {
  return Object.freeze({
    pageId,
    kind: artifact.kind,
    bucket: artifact.bucket,
    key: artifact.key,
    objectVersion: artifact.objectVersion,
    etag: artifact.etag,
    contentType: artifact.contentType,
    contentEncoding: artifact.contentEncoding,
    originalBytes: artifact.originalBytes,
    storedBytes: artifact.storedBytes,
    contentSha256: artifact.contentSha256,
    storageSha256: artifact.storageSha256,
    storedAt: artifact.storedAt,
  });
}

class DatabaseCoreCrawlPersistence implements CrawlPersistencePort {
  readonly #artifactStore: PageArtifactStore;
  readonly #configuration: AuthorizedCrawlExecution["configuration"];
  readonly #context: WorkerExecutionContext;
  readonly #frontierIds = new Map<string, string>();
  readonly #hooks: CrawlExecutionHooks;
  readonly #renderer: CrawlPageRenderer | undefined;
  readonly #repository: CrawlWorkerRepository;
  readonly #workerRenderingEnabled: boolean;
  #currentDepth = 0;
  #counters: CrawlProgressCounters;

  constructor(
    repository: CrawlWorkerRepository,
    context: WorkerExecutionContext,
    configuration: AuthorizedCrawlExecution["configuration"],
    hooks: CrawlExecutionHooks,
    initialCounters: CrawlProgressCounters,
    options: SafeDatabaseCrawlExecutorOptions,
  ) {
    this.#repository = repository;
    this.#context = context;
    this.#configuration = configuration;
    this.#hooks = hooks;
    this.#counters = { ...initialCounters };
    this.#artifactStore = options.artifactStore;
    this.#renderer = options.renderer;
    this.#workerRenderingEnabled = options.workerRenderingEnabled;
  }

  counters(): CrawlProgressCounters {
    return Object.freeze({ ...this.#counters });
  }

  async #ensureFrontier(
    entry: Pick<
      FrontierEntry,
      "depth" | "discoverySource" | "normalizedUrl" | "requestedUrl" | "urlHash"
    >,
  ): Promise<
    Readonly<{
      id: string;
      created: boolean;
      state: "discovered" | "fetching" | "fetched" | "blocked" | "failed" | "skipped";
    }>
  > {
    const known = this.#frontierIds.get(entry.urlHash);
    if (known !== undefined) {
      return Object.freeze({ id: known, created: false, state: "discovered" });
    }
    const parsed = new URL(entry.normalizedUrl);
    const stored = await this.#repository.persistDiscoveredUrl(this.#context, {
      requestedUrl: entry.requestedUrl,
      discoveredUrl: entry.requestedUrl,
      normalizedUrl: entry.normalizedUrl,
      urlHash: entry.urlHash,
      origin: parsed.origin,
      hostname: parsed.hostname.replace(/^\[|\]$/gu, ""),
      depth: entry.depth,
      discoverySource: entry.discoverySource,
      discoveredFromFrontierId: null,
    });
    this.#frontierIds.set(entry.urlHash, stored.id);
    if (stored.created) this.#counters.discovered += 1;
    this.#currentDepth = Math.max(this.#currentDepth, entry.depth);
    return stored;
  }

  async discover(entry: FrontierEntry): Promise<boolean> {
    const stored = await this.#ensureFrontier(entry);
    return stored.created || stored.state === "discovered" || stored.state === "fetching";
  }

  async recordFetch(fetch: PersistedFetch, fetchContext?: PersistedFetchContext): Promise<void> {
    const frontier = await this.#ensureFrontier(fetch);
    const outcome = fetchOutcome(fetch);
    const countsAsPage = fetch.fetchKind === "page";
    const htmlSniff = countsAsPage && fetch.body !== null ? sniffHtmlDocument(fetch.body) : null;
    const pageObservation = {
      frontierId: frontier.id,
      requestedUrl: fetch.requestedUrl,
      normalizedUrl: fetch.normalizedUrl,
      finalUrl: fetch.finalUrl,
      urlHash: fetch.urlHash,
      statusCode: fetch.statusCode,
      contentType: fetch.contentType,
      htmlDetected: htmlSniff?.detected ?? null,
      htmlDetectionSource: htmlSniff?.source ?? null,
      htmlDetectionBytes: htmlSniff?.bytesInspected ?? null,
      responseHeaders: fetch.responseHeaders,
      omittedResponseHeaders: fetch.omittedResponseHeaders,
      contentLength: fetch.contentLength,
      responseBytes: fetch.responseBytes,
      transferSize: fetch.transferBytes,
      compression: fetch.contentEncoding,
      cacheHeaders: selectedHeaders(fetch.responseHeaders, CACHE_HEADERS),
      securityHeaders: selectedHeaders(fetch.responseHeaders, SECURITY_HEADERS),
      depth: fetch.depth,
      redirectChain: storedRedirects(fetch),
      robotsDecision: fetch.robotsDecision,
      robotsObservationId: fetch.robotsObservationId,
      timing: storedTiming(fetch),
      errorType: fetch.errorCode,
      errorMessage: fetch.errorMessage,
      discoverySource: fetch.discoverySource,
      outcome,
      countsTowardPageLimit: countsAsPage,
    } satisfies WorkerPageObservationInput;
    const observation = await this.#repository.persistPageObservation(
      this.#context,
      pageObservation,
    );

    if (this.#isExtractableHtml(fetch) || observation.storedObservation !== null) {
      try {
        await this.#persistHtml(
          observation.pageId,
          fetch,
          pageObservation,
          observation.storedObservation,
          observation.rawArtifactExists,
          fetchContext,
        );
      } catch (error) {
        if (error instanceof ArtifactStorageError) {
          throw new CrawlExecutionError(
            {
              type: error.code,
              safeMessage: "The page artifact could not be stored safely.",
              retryable: error.retryable,
              partial: this.#counters.succeeded > 0 || outcome === "succeeded",
            },
            { cause: error },
          );
        }
        throw error;
      }
    }

    if (!observation.created) return;
    this.#counters.bytesReceived += fetch.responseBytes;
    if (!countsAsPage) return;
    this.#counters.processed += 1;
    if (outcome === "succeeded") this.#counters.succeeded += 1;
    else if (outcome === "failed") this.#counters.failed += 1;
    else if (outcome === "blocked") this.#counters.blocked += 1;
    else this.#counters.skipped += 1;
  }

  #isExtractableHtml(fetch: PersistedFetch): fetch is PersistedFetch & {
    body: Uint8Array;
    finalUrl: string;
    statusCode: number;
  } {
    const essence = fetch.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
    return (
      fetch.fetchKind === "page" &&
      fetch.body !== null &&
      fetch.finalUrl !== null &&
      fetch.statusCode !== null &&
      (essence === "text/html" || essence === "application/xhtml+xml")
    );
  }

  #extract(fetch: PersistedFetch & { body: Uint8Array; finalUrl: string; statusCode: number }) {
    const maxDocumentBytes = Math.min(
      10 * 1_024 * 1_024,
      Math.max(1_024, this.#configuration.maxResponseBytes),
    );
    return extractPage(
      {
        contentType: fetch.contentType,
        depth: fetch.depth,
        finalUrl: fetch.finalUrl,
        headers: fetch.responseHeaders,
        includeSubdomains: this.#configuration.includeSubdomains,
        normalizedUrl: fetch.normalizedUrl,
        raw: { body: fetch.body, kind: "raw" },
        redirectChain: fetch.redirectChain,
        requestedUrl: fetch.requestedUrl,
        responseBytes: fetch.responseBytes,
        scopeHostname: new URL(this.#configuration.startUrl).hostname,
        statusCode: fetch.statusCode,
        transferSize: fetch.transferBytes,
      },
      {
        maxDocumentBytes,
        maxExtractedItems: 10_000,
        maxJsonLdCharacters: Math.min(512 * 1_024, maxDocumentBytes),
        maxNodes: 100_000,
        maxTextCharacters: Math.min(10 * 1_024 * 1_024, maxDocumentBytes * 2),
      },
    );
  }

  async #persistHtml(
    pageId: string,
    fetch: PersistedFetch,
    pageObservation: WorkerPageObservationInput,
    storedObservation: WorkerStoredPageObservation | null,
    rawArtifactExists: boolean,
    fetchContext: PersistedFetchContext | undefined,
  ): Promise<void> {
    const scope = { ...this.#context, pageId };
    let extractionFetch: PersistedFetch & {
      body: Uint8Array;
      finalUrl: string;
      statusCode: number;
    };
    const loaded =
      storedObservation === null
        ? null
        : await this.#artifactStore.load(scope, "raw-html", this.#hooks.signal);
    if (loaded !== null && storedObservation !== null) {
      if (storedObservation.finalUrl === null || storedObservation.statusCode === null) {
        throw new ArtifactStorageError(
          "artifact_conflict",
          "The raw page artifact does not have a complete stored page observation.",
        );
      }
      if (!rawArtifactExists) {
        // The object write may have succeeded immediately before the worker
        // stopped. Recover its verified metadata instead of overwriting either
        // the object or the original transport snapshot with a retry response.
        await this.#repository.persistPageArtifact(this.#context, storedArtifact(pageId, loaded));
      }
      extractionFetch = Object.freeze({
        ...fetch,
        requestedUrl: storedObservation.requestedUrl,
        normalizedUrl: storedObservation.normalizedUrl,
        finalUrl: storedObservation.finalUrl,
        urlHash: storedObservation.urlHash,
        statusCode: storedObservation.statusCode,
        contentType: storedObservation.contentType,
        responseHeaders: storedObservation.responseHeaders,
        contentLength: storedObservation.contentLength,
        body: loaded.body,
        responseBytes: storedObservation.responseBytes,
        transferBytes: storedObservation.transferSize,
        contentEncoding: storedObservation.compression,
        depth: storedObservation.depth,
        redirectChain: storedObservation.redirectChain.map((hop) =>
          Object.freeze({
            fromUrl: hop.requestedUrl,
            statusCode: hop.statusCode,
            toUrl: hop.resolvedUrl,
          }),
        ),
        timing: storedObservation.timing,
        discoverySource: storedObservation.discoverySource,
      });
    } else {
      if (rawArtifactExists) {
        throw new ArtifactStorageError(
          "artifact_missing",
          "The raw page artifact referenced by the crawl record does not exist.",
        );
      }
      if (storedObservation !== null) {
        await this.#repository.replaceIncompletePageObservation(
          this.#context,
          pageId,
          pageObservation,
        );
      }
      if (!this.#isExtractableHtml(fetch)) return;
      extractionFetch = fetch;
      const rawArtifact = await this.#artifactStore.store({
        ...scope,
        kind: "raw-html",
        html: extractionFetch.body,
        ...(this.#hooks.signal === undefined ? {} : { signal: this.#hooks.signal }),
      });
      await this.#repository.persistPageArtifact(
        this.#context,
        storedArtifact(pageId, rawArtifact),
      );
    }

    let rawResult: PageExtractionResult;
    try {
      rawResult = this.#extract(extractionFetch);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      await this.#repository.persistPageExtraction(
        this.#context,
        this.#failedExtraction(pageId, error),
      );
      return;
    }

    let renderingErrors: readonly BrowserRenderingError[] = [];
    if (
      this.#configuration.renderingEnabled &&
      this.#workerRenderingEnabled &&
      this.#renderer !== undefined &&
      evaluateRenderingNeed(rawResult.raw, true).render
    ) {
      const rendered = await this.#renderer.render({
        url: extractionFetch.finalUrl,
        rawHtml: rawResult.raw.decodedHtml,
        ...(this.#hooks.signal === undefined ? {} : { signal: this.#hooks.signal }),
      });
      renderingErrors = rendered.errors;
      if (rendered.status === "rendered" && rendered.renderedHtml !== null) {
        try {
          const renderedResult = extractPage(
            {
              contentType: extractionFetch.contentType,
              depth: extractionFetch.depth,
              finalUrl: extractionFetch.finalUrl,
              headers: extractionFetch.responseHeaders,
              includeSubdomains: this.#configuration.includeSubdomains,
              normalizedUrl: extractionFetch.normalizedUrl,
              raw: { body: extractionFetch.body, kind: "raw" },
              redirectChain: extractionFetch.redirectChain,
              rendered: {
                body: rendered.renderedHtml,
                kind: "rendered",
                renderingErrors: rendered.errors,
              },
              requestedUrl: extractionFetch.requestedUrl,
              responseBytes: extractionFetch.responseBytes,
              scopeHostname: new URL(this.#configuration.startUrl).hostname,
              statusCode: extractionFetch.statusCode,
              transferSize: extractionFetch.transferBytes,
            },
            {
              maxDocumentBytes: Math.min(
                10 * 1_024 * 1_024,
                Math.max(1_024, this.#configuration.maxResponseBytes),
              ),
              maxExtractedItems: 10_000,
              maxJsonLdCharacters: Math.min(
                512 * 1_024,
                Math.max(1_024, this.#configuration.maxResponseBytes),
              ),
              maxNodes: 100_000,
              maxTextCharacters: Math.min(
                10 * 1_024 * 1_024,
                Math.max(2_048, this.#configuration.maxResponseBytes * 2),
              ),
            },
          );
          const renderedDocument = renderedResult.rendered;
          if (renderedDocument === null) throw new Error("Rendered extraction was not produced.");
          const renderedArtifact = await this.#artifactStore.store({
            ...scope,
            kind: "rendered-html",
            html: renderedDocument.decodedHtml,
            ...(this.#hooks.signal === undefined ? {} : { signal: this.#hooks.signal }),
          });
          await this.#repository.persistPageArtifact(
            this.#context,
            storedArtifact(pageId, renderedArtifact),
          );
          await this.#repository.persistPageExtraction(
            this.#context,
            await this.#storedExtraction(
              pageId,
              extractionFetch,
              renderedDocument,
              rendered.errors,
              fetchContext,
            ),
          );
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          renderingErrors = Object.freeze([
            ...rendered.errors,
            Object.freeze({
              code: "browser_error" as const,
              message: truncateCharacters(error.message, 2_000),
            }),
          ]);
        }
      }
    }

    // This is deliberately last. The durable frontier treats the raw extraction
    // plus raw artifact as the completion marker for an idempotent M3 page write.
    await this.#repository.persistPageExtraction(
      this.#context,
      await this.#storedExtraction(
        pageId,
        extractionFetch,
        rawResult.raw,
        renderingErrors,
        fetchContext,
      ),
    );
  }

  #failedExtraction(pageId: string, error: TypeError): PageExtractionPersistenceInput {
    return Object.freeze({
      pageId,
      source: "raw",
      status: "failed",
      title: null,
      metaDescription: null,
      metaRobots: [],
      xRobotsTag: [],
      directiveScopePreserved: false,
      linksComplete: false,
      canonicalUrl: null,
      canonicalTagCount: 0,
      canonicalNormalizationFailure: null,
      metaRefreshUrl: null,
      javascriptRedirectUrl: null,
      visibleText: null,
      visibleTextComplete: false,
      wordCount: 0,
      htmlLanguage: null,
      characterEncoding: null,
      openGraph: {},
      socialCards: {},
      contentHash: null,
      domHash: null,
      similarityFingerprint: null,
      meaningfulContent: false,
      clientRendered: false,
      renderingErrorType: "extraction_error",
      renderingErrorMessage: truncateCharacters(error.message, 2_000),
      headings: [],
      links: [],
      images: [],
      resources: [],
      structuredData: [],
      extractedAt: new Date(),
    });
  }

  async #storedExtraction(
    pageId: string,
    fetch: PersistedFetch,
    document: HtmlDocumentExtraction,
    renderErrors: readonly BrowserRenderingError[],
    fetchContext: PersistedFetchContext | undefined,
  ): Promise<PageExtractionPersistenceInput> {
    const discovered = new Set(fetch.discoveredUrls.map((url) => hashNormalizedUrl(url)));
    const links: PageLinkPersistenceInput[] = [];
    let linksComplete = document.linksComplete;
    const appendLink = (
      input: Readonly<{
        normalizedUrl: string | null;
        targetUrl: string | null;
        anchorText: string | null;
        relValues: readonly string[];
        linkType: PageLinkPersistenceInput["linkType"];
        hreflang: string | null;
      }>,
    ): void => {
      if (links.length >= 20_000) {
        linksComplete = false;
        return;
      }
      if (input.normalizedUrl === null || input.targetUrl === null) return;
      if (input.normalizedUrl.length > 4_096 || input.targetUrl.length > 4_096) {
        linksComplete = false;
        return;
      }
      const normalizedTargetUrl = normalizeCrawlUrl(input.normalizedUrl, {
        queryPolicy: this.#configuration.queryPolicy,
      });
      const relValues = boundedTokensWithCompleteness(input.relValues);
      if (
        !relValues.complete ||
        (input.anchorText !== null && !containsAtMostCharacters(input.anchorText, 4_000)) ||
        (input.hreflang !== null && !containsAtMostCharacters(input.hreflang, 80))
      ) {
        linksComplete = false;
      }
      const targetUrlHash = hashNormalizedUrl(normalizedTargetUrl);
      const internal = isUrlInScope(normalizedTargetUrl, {
        hostname: new URL(this.#configuration.startUrl).hostname,
        includeSubdomains: this.#configuration.includeSubdomains,
      });
      links.push({
        targetFrontierId: this.#frontierIds.get(targetUrlHash) ?? null,
        targetPageId: null,
        targetUrl: input.targetUrl,
        normalizedTargetUrl,
        targetUrlHash,
        scope: internal ? "internal" : "external",
        anchorText: input.anchorText === null ? null : truncateCharacters(input.anchorText, 4_000),
        relValues: relValues.values,
        linkType: input.linkType,
        hreflang:
          input.hreflang === null ? null : nullableText(truncateCharacters(input.hreflang, 80)),
        discovered: discovered.has(targetUrlHash) || this.#frontierIds.has(targetUrlHash),
        crawlDepth: Math.min(10, fetch.depth + 1),
        discoverySource: "link",
        ordinal: links.length,
      });
    };

    for (const link of document.links) {
      appendLink({
        normalizedUrl: link.normalizedTargetUrl,
        targetUrl: link.resolvedTargetUrl,
        anchorText: nullableText(link.anchorText),
        relValues: link.rel,
        linkType: link.linkType,
        hreflang: null,
      });
    }
    for (const canonical of document.canonicals) {
      appendLink({
        normalizedUrl: canonical.normalizedUrl,
        targetUrl: canonical.resolvedUrl,
        anchorText: null,
        relValues: ["canonical"],
        linkType: "canonical",
        hreflang: null,
      });
    }
    for (const alternate of document.hreflang) {
      appendLink({
        normalizedUrl: alternate.normalizedUrl,
        targetUrl: alternate.resolvedUrl,
        anchorText: null,
        relValues: ["alternate"],
        linkType: "hreflang",
        hreflang: nullableText(alternate.language),
      });
    }
    for (const frame of document.iframes) {
      appendLink({
        normalizedUrl: frame.source.normalizedUrl,
        targetUrl: frame.source.resolvedUrl,
        anchorText: frame.title,
        relValues: [],
        linkType: "iframe",
        hreflang: null,
      });
    }
    for (const form of document.forms) {
      appendLink({
        normalizedUrl: form.action.normalizedUrl,
        targetUrl: form.action.resolvedUrl,
        anchorText: null,
        relValues: [],
        linkType: "form_action",
        hreflang: null,
      });
    }

    const resources: PageResourcePersistenceInput[] = [];
    const appendResource = (
      resourceType: PageResourcePersistenceInput["resourceType"],
      reference: Readonly<{ normalizedUrl: string | null; resolvedUrl: string | null }> | null,
      resourceAttributes: Readonly<Record<string, string>>,
    ): void => {
      if (resources.length >= 20_000) return;
      const normalizedUrl = boundedUrl(reference?.normalizedUrl ?? null);
      const sourceUrl = boundedUrl(reference?.resolvedUrl ?? null);
      const urlHash = normalizedUrl === null ? null : hashNormalizedUrl(normalizedUrl);
      resources.push({
        resourceType,
        sourceUrl,
        normalizedUrl,
        urlHash,
        scope:
          normalizedUrl === null
            ? null
            : isUrlInScope(normalizedUrl, {
                  hostname: new URL(this.#configuration.startUrl).hostname,
                  includeSubdomains: this.#configuration.includeSubdomains,
                })
              ? "internal"
              : "external",
        attributes: resourceAttributes,
        robotsDecision: "not_checked",
        robotsObservationId: null,
        ordinal: resources.length,
      });
    };
    for (const script of document.scripts) {
      appendResource(
        "script",
        script.source,
        attributes({
          async: script.async,
          contentHash: script.contentHash,
          defer: script.defer,
          inlineBytes: script.inlineBytes,
          module: script.module,
          type: script.type,
        }),
      );
    }
    for (const stylesheet of document.stylesheets) {
      appendResource(
        "stylesheet",
        stylesheet.source,
        attributes({
          contentHash: stylesheet.contentHash,
          inline: stylesheet.inline,
          media: stylesheet.media,
        }),
      );
    }
    for (const frame of document.iframes) {
      appendResource(
        "iframe",
        frame.source,
        attributes({
          loading: frame.loading,
          sandbox: frame.sandbox.join(" "),
          title: frame.title,
        }),
      );
    }
    for (const form of document.forms) {
      appendResource(
        "form",
        form.action,
        attributes({
          enctype: form.enctype,
          hasFileInput: form.hasFileInput,
          hasPasswordInput: form.hasPasswordInput,
          inputCount: form.inputCount,
          method: form.method,
        }),
      );
    }

    const observedResources: PageResourcePersistenceInput[] = [];
    const observationsByUrl = new Map<string, ResourceRobotsObservation>();
    for (const resource of resources) {
      if (
        fetchContext === undefined ||
        resource.scope !== "internal" ||
        resource.normalizedUrl === null ||
        (resource.resourceType !== "script" && resource.resourceType !== "stylesheet")
      ) {
        observedResources.push(Object.freeze(resource));
        continue;
      }
      let observation = observationsByUrl.get(resource.normalizedUrl);
      if (observation === undefined) {
        // Resource lists are attacker-controlled. Sequential observation gives this
        // page a deterministic concurrency bound of one while robotsFor still
        // deduplicates the underlying policy fetch per origin.
        observation = await fetchContext.observeResourceRobots(resource.normalizedUrl);
        observationsByUrl.set(resource.normalizedUrl, observation);
      }
      observedResources.push(
        Object.freeze({
          ...resource,
          robotsDecision: observation.decision,
          robotsObservationId: observation.observationId,
        }),
      );
    }

    const structuredData: PageStructuredDataPersistenceInput[] = [];
    for (const block of document.jsonLd) {
      if (structuredData.length >= 1_000) break;
      const serialized = block.value === null ? null : JSON.stringify(block.value);
      const exceedsPersistenceLimit =
        Buffer.byteLength(block.raw) > 250_000 ||
        (serialized !== null && Buffer.byteLength(serialized) > 250_000);
      const parseError =
        block.error ??
        (block.value === null
          ? "JSON-LD must contain a non-null root value."
          : exceedsPersistenceLimit
            ? "JSON-LD exceeds the structured-data persistence limit."
            : null);
      structuredData.push({
        kind: "json_ld",
        parseStatus: parseError === null ? "parsed" : "invalid",
        schemaTypes: jsonSchemaTypes(block.value),
        rawValue: truncateUtf8Bytes(block.raw, 250_000),
        parsedValue: parseError === null ? block.value : null,
        errorMessage: parseError === null ? null : truncateCharacters(parseError, 2_000),
        ordinal: structuredData.length,
      });
    }
    for (const item of document.microdata) {
      if (structuredData.length >= 1_000) break;
      const serialized = JSON.stringify(item);
      const exceedsPersistenceLimit = Buffer.byteLength(serialized) > 250_000;
      structuredData.push({
        kind: "microdata",
        parseStatus: exceedsPersistenceLimit ? "invalid" : "parsed",
        schemaTypes: boundedTokens(item.types),
        rawValue: truncateUtf8Bytes(serialized, 250_000),
        parsedValue: exceedsPersistenceLimit ? null : item,
        errorMessage: exceedsPersistenceLimit
          ? "Microdata exceeds the structured-data persistence limit."
          : null,
        ordinal: structuredData.length,
      });
    }

    const failure = renderingFailure(renderErrors);
    const applicableDirectives = applicableRobotsDirectives(
      document.robots,
      this.#configuration.userAgent,
    );
    const metaRobots = boundedTokensWithCompleteness(applicableDirectives.meta);
    const xRobotsTag = boundedTokensWithCompleteness(applicableDirectives.xRobotsTag);
    const viewportDeclarations = document.viewportDeclarations
      .slice(0, 64)
      .map((value) => truncateUtf8Bytes(value, 2_000));
    const viewportDeclarationsComplete =
      document.viewportDeclarations.length <= 64 &&
      document.viewportDeclarations.every((value) => Buffer.byteLength(value, "utf8") <= 2_000);
    const openGraph = metadataRecord(document.openGraph);
    const socialCards = metadataRecord(document.socialCards);
    const headingsComplete =
      document.headingsComplete &&
      document.headings.length <= 1_000 &&
      document.headings.every((heading) => containsAtMostCharacters(heading.text, 2_000));
    const titleComplete =
      document.title === null || containsAtMostCharacters(document.title, 2_000);
    const firstMetaDescription = document.metaDescriptions[0] ?? null;
    const metaDescriptionComplete =
      firstMetaDescription === null || containsAtMostCharacters(firstMetaDescription, 8_000);
    return Object.freeze({
      pageId,
      source: document.sourceKind,
      status: "succeeded",
      title: document.title === null ? null : truncateCharacters(document.title, 2_000),
      documentMetadataComplete:
        document.documentMetadataComplete &&
        viewportDeclarationsComplete &&
        openGraph.complete &&
        socialCards.complete &&
        titleComplete &&
        metaDescriptionComplete,
      titleTagCount: Math.min(10_000, document.titles.length),
      metaDescription:
        document.metaDescriptions[0] === undefined
          ? null
          : truncateCharacters(document.metaDescriptions[0], 8_000),
      metaDescriptionTagCount: Math.min(10_000, document.metaDescriptionTagCount),
      metaRobots: metaRobots.values,
      xRobotsTag: xRobotsTag.values,
      directiveScopePreserved:
        document.robots.complete && metaRobots.complete && xRobotsTag.complete,
      linksComplete,
      canonicalUrl: boundedUrl(document.canonical?.normalizedUrl ?? null),
      canonicalTagCount: Math.min(100, document.canonicals.length),
      canonicalNormalizationFailure:
        document.canonicals.length === 1 &&
        document.canonical !== null &&
        document.canonical.error !== null
          ? Object.freeze({ code: document.canonical.error })
          : null,
      metaRefreshUrl: boundedUrl(document.metaRefreshUrl),
      javascriptRedirectUrl: boundedUrl(document.javascriptRedirectUrl),
      visibleText: truncateUtf8Bytes(document.visibleText, 1_990_000),
      visibleTextComplete: Buffer.byteLength(document.visibleText, "utf8") <= 1_990_000,
      wordCount: Math.min(1_000_000, document.wordCount),
      headingsComplete,
      htmlLanguage:
        document.htmlLanguage === null ? null : truncateCharacters(document.htmlLanguage, 80),
      characterEncoding: truncateCharacters(document.characterEncoding.used, 80),
      characterEncodingDeclared:
        document.characterEncoding.declared === null
          ? null
          : truncateCharacters(document.characterEncoding.declared, 80),
      characterEncodingSource: document.characterEncoding.source,
      characterEncodingDeclarationOffset: document.characterEncoding.declarationOffsetBytes,
      viewportDeclarations: Object.freeze(viewportDeclarations),
      htmlDoctypePresent: document.htmlDoctypePresent,
      iconDeclarationCount: Math.min(10_000, document.iconDeclarationCount),
      openGraph: openGraph.values,
      socialCards: socialCards.values,
      contentHash: document.contentHash,
      domHash: document.domHash,
      similarityFingerprint: document.similarityFingerprint,
      meaningfulContent: document.meaningfulContent,
      clientRendered: document.clientRenderedSignals.length > 0,
      renderingErrorType: failure.type,
      renderingErrorMessage: failure.message,
      headings: document.headings.slice(0, 1_000).map((heading, ordinal) => ({
        ...heading,
        text: truncateCharacters(heading.text, 2_000),
        ordinal,
      })),
      links: Object.freeze(links),
      images: document.images.map((image, ordinal) => {
        const normalizedUrl = boundedUrl(image.source.normalizedUrl);
        const sourceUrl = boundedUrl(image.source.resolvedUrl);
        const sourceSet =
          image.sourceSet.length === 0
            ? null
            : image.sourceSet
                .map((candidate) =>
                  candidate.descriptor === null
                    ? candidate.rawUrl
                    : `${candidate.rawUrl} ${candidate.descriptor}`,
                )
                .join(", ");
        return Object.freeze({
          sourceUrl,
          normalizedUrl,
          urlHash: normalizedUrl === null ? null : hashNormalizedUrl(normalizedUrl),
          scope:
            normalizedUrl === null
              ? null
              : isUrlInScope(normalizedUrl, {
                    hostname: new URL(this.#configuration.startUrl).hostname,
                    includeSubdomains: this.#configuration.includeSubdomains,
                  })
                ? "internal"
                : "external",
          altText: image.alt === null ? null : truncateCharacters(image.alt, 4_000),
          title: image.title === null ? null : truncateCharacters(image.title, 2_000),
          width: image.width !== null && image.width <= 100_000 ? image.width : null,
          height: image.height !== null && image.height <= 100_000 ? image.height : null,
          loading: image.loading === null ? null : truncateCharacters(image.loading, 80),
          srcset: sourceSet === null ? null : truncateCharacters(sourceSet, 16_000),
          ordinal,
        });
      }),
      resources: Object.freeze(observedResources),
      structuredData: Object.freeze(structuredData),
      extractedAt: new Date(),
    });
  }

  async recordSitemap(record: SitemapPersistenceRecord): Promise<Readonly<{ id: string }>> {
    const entries: SitemapObservationPersistenceInput["entries"] = record.locations
      .slice(0, 50_000)
      .flatMap((location, ordinal) => {
        if (location.normalizedUrl === null || location.urlHash === null) return [];
        if (location.normalizedUrl.length > 4_096 || location.rawUrl.length > 4_096) return [];
        const normalizedLoc =
          location.entryType === "url"
            ? normalizeCrawlUrl(location.normalizedUrl, {
                queryPolicy: this.#configuration.queryPolicy,
              })
            : location.normalizedUrl;
        const urlHash =
          location.entryType === "url" ? hashNormalizedUrl(normalizedLoc) : location.urlHash;
        const lastmodAt =
          location.lastModifiedValid && location.lastModified !== null
            ? new Date(location.lastModified)
            : null;
        return [
          Object.freeze({
            entryType: location.entryType,
            loc: location.rawUrl,
            normalizedLoc,
            urlHash,
            lastmodRaw:
              location.lastModified === null
                ? null
                : truncateCharacters(location.lastModified, 128),
            lastmodAt,
            targetFrontierId:
              location.entryType === "url" ? (this.#frontierIds.get(urlHash) ?? null) : null,
            targetPageId: null,
            targetSitemapId: null,
            ordinal,
          }),
        ];
      });
    const now = new Date();
    const errorMessage =
      record.errorMessage ??
      (record.parseIssues.length === 0
        ? null
        : record.parseIssues.map((issue) => issue.message).join(" "));
    const result = await this.#repository.persistSitemapObservation(this.#context, {
      parentSitemapId: record.parentPersistenceId,
      requestedUrl: record.requestedUrl,
      robotsDecision: record.robotsDecision,
      robotsObservationId: record.robotsObservationId,
      normalizedUrl: record.normalizedUrl,
      finalUrl: record.finalUrl,
      urlHash: record.urlHash,
      source: record.source === "index" ? "nested" : record.source,
      status: record.state,
      format:
        record.kind === "sitemap_index"
          ? "index"
          : record.kind === "url_set"
            ? "urlset"
            : "unknown",
      compression: record.compression,
      statusCode: record.statusCode,
      contentType: record.contentType,
      contentLength: record.contentLength,
      transferSize: record.transferBytes,
      contentDigest: record.documentDigest,
      depth: record.depth,
      redirectChain: storedRedirects(record),
      parseIssues: boundedSitemapParseIssues(record.parseIssues),
      errorType: record.state === "parsed" ? null : (record.errorCode ?? "sitemap_error"),
      errorMessage:
        record.state === "parsed"
          ? null
          : truncateCharacters(errorMessage ?? "The sitemap could not be processed.", 2_000),
      fetchedAt: record.statusCode === null ? null : now,
      parsedAt: record.state === "parsed" ? now : null,
      entries,
    });
    return Object.freeze({ id: result.sitemapId });
  }

  async recordProgress(): Promise<void> {
    await this.#repository.saveCheckpoint(this.#context, this.#currentDepth);
    await this.#hooks.reportProgress(this.counters());
  }

  async recordRobots(record: RobotsPersistenceRecord): Promise<RobotsPersistenceReceipt> {
    const isNotFound =
      record.state === "unavailable" &&
      record.statusCode !== null &&
      [404, 410].includes(record.statusCode);
    const result =
      record.state === "parsed"
        ? "fetched"
        : isNotFound
          ? "not_found"
          : record.state === "unreachable" &&
              record.statusCode !== null &&
              record.statusCode >= 200 &&
              record.statusCode < 300
            ? "invalid"
            : "unavailable";
    const observation = await this.#repository.persistRobotsObservation(this.#context, {
      origin: record.origin,
      hostname: record.hostname,
      requestedUrl: record.requestedUrl,
      finalUrl: record.finalUrl,
      statusCode: record.statusCode,
      contentType: record.contentType,
      result,
      userAgent: record.userAgent,
      contentSha256: record.contentDigest,
      content: record.content,
      crawlDelayMs: record.crawlDelayMs,
      sitemapUrls: record.sitemapUrls,
      fetchedAt: new Date(),
    });
    return Object.freeze({ observationId: observation.id, result: observation.result });
  }

  async transition(state: CrawlState): Promise<void> {
    if (state === "discovering" || state === "crawling") {
      await this.#repository.transitionStage(this.#context, state);
    }
  }
}

export class SafeDatabaseCrawlExecutor implements CrawlExecutor {
  readonly #options: SafeDatabaseCrawlExecutorOptions;
  readonly #persistence: DatabaseCrawlProcessingPersistence;
  readonly #repository: CrawlWorkerRepository;
  #closePromise: Promise<void> | undefined;

  constructor(
    repository: CrawlWorkerRepository,
    persistence: DatabaseCrawlProcessingPersistence,
    options: SafeDatabaseCrawlExecutorOptions,
  ) {
    if (options.workerRenderingEnabled && options.renderer === undefined) {
      throw new TypeError("A renderer is required when worker rendering is enabled.");
    }
    this.#repository = repository;
    this.#persistence = persistence;
    this.#options = options;
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#options.renderer?.close() ?? Promise.resolve();
    return this.#closePromise;
  }

  async execute(
    execution: AuthorizedCrawlExecution,
    hooks: CrawlExecutionHooks,
  ): Promise<CrawlExecutionResult> {
    const configuration = execution.configuration;
    if (
      !configuration.supportedContentTypes.some((contentType) =>
        ["application/xhtml+xml", "text/html"].includes(contentType),
      )
    ) {
      throw new CrawlExecutionError({
        type: "unsupported_content_type_configuration",
        safeMessage: "The crawl configuration does not allow an HTML content type.",
        retryable: false,
        partial: false,
      });
    }

    const context = this.#persistence.contextFor(execution);
    const initialCounters = this.#persistence.initialCountersFor(execution);
    if (initialCounters.processed > configuration.pageLimit) {
      throw new CrawlExecutionError({
        type: "crawl_page_limit_exceeded",
        safeMessage: "Stored crawl progress exceeds the configured page limit.",
        retryable: false,
        partial: initialCounters.succeeded > 0,
      });
    }
    const discoveryLimit = Math.min(100_000, Math.max(configuration.pageLimit * 10, 100));
    if (initialCounters.discovered > discoveryLimit) {
      throw new CrawlExecutionError({
        type: "crawl_discovery_limit_exceeded",
        safeMessage: "Stored crawl discovery progress exceeds the crawl-wide safety limit.",
        retryable: false,
        partial: initialCounters.succeeded > 0,
      });
    }
    if (await hooks.isCancellationRequested()) {
      return Object.freeze({ status: "cancelled", counters: initialCounters });
    }
    const remainingPages = configuration.pageLimit - initialCounters.processed;
    const resumeEntries = await this.#persistence.resumableFrontierFor(execution, discoveryLimit);
    const hasIncompletePersistedPage = resumeEntries.some((entry) => !entry.countsTowardPageLimit);
    if (remainingPages === 0 && !hasIncompletePersistedPage) {
      return Object.freeze({
        status: initialCounters.failed > 0 ? "partially_completed" : "completed",
        counters: initialCounters,
      });
    }
    const corePersistence = new DatabaseCoreCrawlPersistence(
      this.#repository,
      context,
      configuration,
      hooks,
      initialCounters,
      this.#options,
    );
    const requestTimeoutMs = configuration.requestTimeoutMs;
    const client = createSafeHttpClient({
      userAgent: configuration.userAgent,
      pageContentTypes: configuration.supportedContentTypes,
      fetchLimits: {
        connectTimeoutMs: Math.min(5_000, requestTimeoutMs),
        dnsTimeoutMs: Math.min(5_000, requestTimeoutMs),
        headersTimeoutMs: requestTimeoutMs,
        idleTimeoutMs: requestTimeoutMs,
        requestTimeoutMs,
        redirectLimit: configuration.redirectLimit,
        maxResponseBytes: configuration.maxResponseBytes,
        maxEncodedBytes: configuration.maxResponseBytes,
      },
    });
    const result = await createCrawlRunner({
      cancellation: { isCancellationRequested: hooks.isCancellationRequested },
      client,
      persistence: corePersistence,
    }).run({
      config: {
        maxPages: configuration.pageLimit,
        maxDepth: configuration.maxDepth,
        maxDiscoveredUrls: discoveryLimit,
        maxQueryVariantsPerPath: configuration.queryPolicy === "ignore_all" ? 1 : 20,
        queryPolicy: configuration.queryPolicy,
        includePatterns: configuration.includePatterns,
        excludePatterns: configuration.excludePatterns,
        cancellationPollMs: 500,
        concurrency: configuration.concurrency,
        includeSubdomains: configuration.includeSubdomains,
        maxRetries: 2,
        maxSitemapUrls: Math.min(50_000, Math.max(configuration.pageLimit * 10, 100)),
        maxSitemaps: 100,
        maxSitemapDepth: 5,
        submittedSitemapUrls: configuration.submittedSitemapUrls,
        requestDelayMs: configuration.requestDelayMs,
        respectRobots: configuration.respectRobots,
        supportedContentTypes: configuration.supportedContentTypes,
        totalDeadlineMs: configuration.totalTimeoutMs,
      },
      initialDiscoveredCount: initialCounters.discovered,
      initialProcessedCount: initialCounters.processed,
      ...(resumeEntries.length === 0
        ? {}
        : {
            resumeEntries: resumeEntries.map((entry) =>
              Object.freeze({
                countsTowardPageLimit: entry.countsTowardPageLimit,
                depth: entry.depth,
                discoverySource: entry.discoverySource,
                requestedUrl: entry.requestedUrl,
              }),
            ),
          }),
      target: {
        organizationId: execution.organizationId,
        projectId: execution.projectId,
        crawlId: execution.crawlId,
        startUrl: configuration.startUrl,
      },
      ...(hooks.signal === undefined ? {} : { signal: hooks.signal }),
    });
    const counters = corePersistence.counters();
    if (result.state === "failed") {
      const type = result.errorCode ?? "crawl_failed";
      throw new CrawlExecutionError({
        type,
        safeMessage: "The crawl could not complete within its configured safety limits.",
        retryable: false,
        partial: counters.succeeded > 0,
      });
    }

    return Object.freeze({
      status:
        result.state === "completed" && counters.failed > 0 ? "partially_completed" : result.state,
      counters,
    });
  }
}
