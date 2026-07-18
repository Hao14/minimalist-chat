import {
  hashNormalizedUrl,
  type CrawlPersistencePort,
  type CrawlProgress,
  type CrawlRunInput,
  type CrawlRunnerDependencies,
  type FrontierEntry,
  type PersistedFetch,
  type SitemapPersistenceRecord,
} from "@searvia/crawler-core";
import type * as CrawlerCoreModule from "@searvia/crawler-core";
import type {
  CrawlWorkerRepository,
  WorkerCrawlConfigSnapshot,
  WorkerDatabaseRuntime,
  WorkerExecutionClaim,
} from "@searvia/database/workers";
import type { CrawlExecuteJob, CrawlProgressCounters } from "@searvia/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageArtifactStore, StoredPageArtifact } from "../src/artifact-storage.js";
import { SafeDatabaseCrawlExecutor, type CrawlPageRenderer } from "../src/crawl-executor.js";
import { DatabaseCrawlProcessingPersistence } from "../src/database-adapter.js";
import {
  classifyCrawlFailure,
  CrawlExecutionError,
  type AuthorizedCrawlExecution,
} from "../src/processor.js";

const crawlerCoreMocks = vi.hoisted(() => ({
  createCrawlRunner: vi.fn(),
  createSafeHttpClient: vi.fn(),
}));

vi.mock("@searvia/crawler-core", async (importOriginal) => ({
  ...(await importOriginal<typeof CrawlerCoreModule>()),
  ...crawlerCoreMocks,
}));

const EMPTY_COUNTERS: CrawlProgressCounters = Object.freeze({
  discovered: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  blocked: 0,
  skipped: 0,
  bytesReceived: 0,
});

const CORE_PROGRESS: CrawlProgress = Object.freeze({
  blocked: 0,
  bytes: 321,
  discovered: 2,
  failed: 0,
  processed: 1,
  queued: 0,
  skipped: 0,
  succeeded: 1,
});

function configuration(
  overrides: Partial<WorkerCrawlConfigSnapshot> = {},
): WorkerCrawlConfigSnapshot {
  return Object.freeze({
    version: 1,
    startUrl: "https://example.com/",
    pageLimit: 25,
    maxDepth: 3,
    includeSubdomains: false,
    respectRobots: true,
    requestDelayMs: 250,
    concurrency: 2,
    includePatterns: ["/**"],
    excludePatterns: ["/private/**"],
    queryPolicy: "ignore_tracking",
    userAgent: "SearviaBot/1.0 (+https://searvia.online/crawler)",
    redirectLimit: 5,
    maxResponseBytes: 2_000_000,
    requestTimeoutMs: 10_000,
    totalTimeoutMs: 600_000,
    supportedContentTypes: ["text/html", "application/xhtml+xml"],
    renderingEnabled: false,
    submittedSitemapUrls: [],
    ...overrides,
  });
}

function job(): CrawlExecuteJob {
  return Object.freeze({
    contractVersion: 1,
    jobType: "crawl.execute",
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    crawlId: crypto.randomUUID(),
    requestedByMembershipId: crypto.randomUUID(),
    traceId: "trace-executor-12345678",
    idempotencyKey: "idempotency-executor-12345678",
    createdAt: "2026-07-15T20:00:00.000Z",
    estimatedPages: 25,
  });
}

function claimed(
  contract: CrawlExecuteJob,
  config = configuration(),
  counters: CrawlProgressCounters = EMPTY_COUNTERS,
): WorkerExecutionClaim {
  return Object.freeze({
    kind: "claimed",
    executionToken: crypto.randomUUID(),
    crawl: Object.freeze({
      organizationId: contract.organizationId,
      projectId: contract.projectId,
      crawlId: contract.crawlId,
      traceId: contract.traceId,
      status: "validating",
      config,
      counters,
    }),
  });
}

function fakeRepository(overrides: Partial<CrawlWorkerRepository> = {}): CrawlWorkerRepository {
  const pageId = crypto.randomUUID();
  const repository: CrawlWorkerRepository = {
    claimOutboxBatch: vi.fn(async () => []),
    recoverExpiredOutboxLeases: vi.fn(async () => 0),
    markOutboxPublished: vi.fn(async () => true),
    releaseOutboxClaim: vi.fn(async () => true),
    claimExecution: vi.fn(async () => Object.freeze({ kind: "cancelled" as const })),
    reconcilePreClaimFailure: vi.fn(async () => Object.freeze({ kind: "retryable" as const })),
    isCancellationRequested: vi.fn(async () => false),
    recordExecutionProgress: vi.fn(async () => undefined),
    renewExecutionLease: vi.fn(async () => true),
    transitionStage: vi.fn(async () => undefined),
    listResumableFrontier: vi.fn(async () => []),
    persistDiscoveredUrl: vi.fn(async () =>
      Object.freeze({ id: crypto.randomUUID(), created: true, state: "discovered" as const }),
    ),
    persistPageObservation: vi.fn(async () =>
      Object.freeze({
        pageId,
        created: true,
        rawArtifactExists: false,
        storedObservation: null,
      }),
    ),
    replaceIncompletePageObservation: vi.fn(async () => undefined),
    persistPageExtraction: vi.fn(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    ),
    persistPageArtifact: vi.fn(async () =>
      Object.freeze({ artifactId: crypto.randomUUID(), created: true }),
    ),
    persistSitemapObservation: vi.fn(async () =>
      Object.freeze({ sitemapId: crypto.randomUUID(), created: true, insertedEntryCount: 0 }),
    ),
    persistRobotsObservation: vi.fn(async (_context, input) =>
      Object.freeze({ id: crypto.randomUUID(), created: true, result: input.result }),
    ),
    saveCheckpoint: vi.fn(async () => undefined),
    releaseExecutionForRetry: vi.fn(async () => undefined),
    completeExecution: vi.fn(async () => undefined),
    finalizeExecutionFailure: vi.fn(async () => "failed" as const),
    recordDeadLetter: vi.fn(async () => undefined),
  };
  return Object.assign(repository, overrides);
}

function fakeRuntime(repository: CrawlWorkerRepository): WorkerDatabaseRuntime {
  return {
    repository,
    loadAuditCrawlSnapshot: vi.fn(async () => {
      throw new Error("Audit snapshot loading is not used by this test.");
    }),
    hasTerminalAuditEvaluationRun: vi.fn(async () => false),
    persistAuditEvaluationReport: vi.fn(async () => {
      throw new Error("Audit report persistence is not used by this test.");
    }),
    checkHealth: vi.fn(async () => Object.freeze({ latencyMs: 1, status: "ok" as const })),
    close: vi.fn(async () => undefined),
  };
}

async function authorizedExecution(
  persistence: DatabaseCrawlProcessingPersistence,
  contract: CrawlExecuteJob,
): Promise<AuthorizedCrawlExecution> {
  const result = await persistence.claimExecution({
    contract,
    queueJobId: contract.crawlId,
    attempt: 1,
  });
  if (result.state !== "claimed") throw new Error("Expected a claimed execution.");
  return result.execution;
}

function frontierEntry(url = "https://example.com/"): FrontierEntry {
  return Object.freeze({
    countsTowardPageLimit: true,
    depth: url.endsWith("/next") ? 1 : 0,
    discoverySource: url.endsWith("/next") ? "link" : "seed",
    normalizedUrl: url,
    requestedUrl: url,
    sequence: url.endsWith("/next") ? 1 : 0,
    urlHash: hashNormalizedUrl(url),
  });
}

function successfulFetch(): PersistedFetch {
  const body = new TextEncoder().encode(`<!doctype html>
    <html lang="en"><head>
      <title>Example title</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="description" content="A useful page description">
      <meta http-equiv="refresh" content="0; url=/meta-redirect">
      <link rel="canonical" href="/canonical">
      <link rel="icon" href="/favicon.svg">
      <link rel="stylesheet" href="/assets/app.css">
      <script src="/assets/blocked.js" defer></script>
      <script type="application/ld+json">{"@type":"Article","headline":"Example"}</script>
      <script>window.location.replace('/client-redirect');</script>
    </head><body>
      <h1>Primary heading</h1>
      <p>This is meaningful visible page content with enough words for deterministic extraction.</p>
      <a href="/next" rel="nofollow">Next page</a>
      <img src="/image.png" alt="Example image">
    </body></html>`);
  return Object.freeze({
    ...frontierEntry(),
    body,
    contentEncoding: "br",
    contentLength: body.byteLength,
    contentType: "text/html",
    discoveredUrls: ["https://example.com/next"],
    errorCode: null,
    errorMessage: null,
    fetchKind: "page",
    finalUrl: "https://example.com/",
    omittedResponseHeaders: ["set-cookie"],
    responseHeaders: {
      "cache-control": ["public, max-age=60"],
      "content-type": ["text/html; charset=utf-8"],
      "strict-transport-security": ["max-age=31536000"],
    },
    redirectChain: [],
    responseBytes: body.byteLength,
    robotsDecision: "allowed",
    robotsObservationId: crypto.randomUUID(),
    statusCode: 200,
    timing: Object.freeze({
      dnsMs: 1.2,
      downloadMs: 3.6,
      startedAt: "2026-07-15T20:00:00.000Z",
      totalMs: 8.6,
      ttfbMs: 3.4,
    }),
    transferBytes: 321,
  });
}

function successfulFetchWithLink(
  rawTargetUrl: string,
  discoveredTargetUrl: string,
): PersistedFetch {
  const body = new TextEncoder().encode(`<!doctype html>
    <html lang="en"><head><title>Query policy source</title></head>
    <body><h1>Query policy source</h1><a href="${rawTargetUrl}">Target</a></body></html>`);
  return Object.freeze({
    ...successfulFetch(),
    body,
    contentLength: body.byteLength,
    discoveredUrls: [discoveredTargetUrl],
    responseBytes: body.byteLength,
  });
}

function artifactStore(): PageArtifactStore & {
  load: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
} {
  const store = vi.fn(
    async (input: Parameters<PageArtifactStore["store"]>[0]) =>
      Object.freeze({
        organizationId: input.organizationId,
        projectId: input.projectId,
        crawlId: input.crawlId,
        pageId: input.pageId,
        kind: input.kind,
        bucket: "private-crawls",
        key: `organizations/${input.organizationId}/projects/${input.projectId}/crawls/${input.crawlId}/pages/${input.pageId}/${input.kind}.html.gz`,
        contentType: "text/html; charset=utf-8",
        contentEncoding: "gzip",
        contentSha256: "a".repeat(64),
        storageSha256: "b".repeat(64),
        originalBytes: Buffer.byteLength(input.html),
        storedBytes: 128,
        etag: '"etag"',
        objectVersion: "v1",
        storedAt: "2026-07-15T20:00:00.000Z",
        writeDisposition: "created",
      }) satisfies StoredPageArtifact,
  );
  return { load: vi.fn(async () => null), store };
}

function executor(
  repository: CrawlWorkerRepository,
  persistence: DatabaseCrawlProcessingPersistence,
  store: PageArtifactStore,
  options: Readonly<{ renderer?: CrawlPageRenderer; workerRenderingEnabled?: boolean }> = {},
): SafeDatabaseCrawlExecutor {
  return new SafeDatabaseCrawlExecutor(repository, persistence, {
    artifactStore: store,
    workerRenderingEnabled: options.workerRenderingEnabled ?? false,
    ...(options.renderer === undefined ? {} : { renderer: options.renderer }),
  });
}

function installRunner(
  run: (persistence: CrawlPersistencePort, input: CrawlRunInput) => Promise<void>,
): void {
  crawlerCoreMocks.createCrawlRunner.mockImplementation(
    (dependencies: CrawlRunnerDependencies) => ({
      async run(input: CrawlRunInput) {
        await run(dependencies.persistence, input);
        return Object.freeze({ errorCode: null, progress: CORE_PROGRESS, state: "completed" });
      },
    }),
  );
}

beforeEach(() => {
  crawlerCoreMocks.createCrawlRunner.mockReset();
  crawlerCoreMocks.createSafeHttpClient.mockReset();
  crawlerCoreMocks.createSafeHttpClient.mockReturnValue(
    Object.freeze({ fetch: vi.fn(async () => Promise.reject(new Error("unused"))) }),
  );
});

describe("M3 database crawl persistence", () => {
  it("stores response evidence, a raw artifact, extraction records, and the usable URL graph", async () => {
    const contract = job();
    const executionClaim = claimed(
      contract,
      configuration({
        submittedSitemapUrls: ["https://example.com/custom-sitemap.xml"],
      }),
    );
    const pageId = crypto.randomUUID();
    const nextFrontierId = crypto.randomUUID();
    const persistPageObservation = vi.fn(async () =>
      Object.freeze({
        pageId,
        created: true,
        rawArtifactExists: false,
        storedObservation: null,
      }),
    );
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const persistPageArtifact = vi.fn(async () =>
      Object.freeze({ artifactId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistDiscoveredUrl: vi.fn(async (_context, input) =>
        Object.freeze({
          id: input.normalizedUrl.endsWith("/next") ? nextFrontierId : crypto.randomUUID(),
          created: true,
          state: "discovered" as const,
        }),
      ),
      persistPageObservation,
      persistPageExtraction,
      persistPageArtifact,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    let capturedInput: CrawlRunInput | undefined;
    const robotsObservationId = crypto.randomUUID();
    let activeResourceObservations = 0;
    let maximumResourceObservationConcurrency = 0;
    const observeResourceRobots = vi.fn(async (url: string) => {
      activeResourceObservations += 1;
      maximumResourceObservationConcurrency = Math.max(
        maximumResourceObservationConcurrency,
        activeResourceObservations,
      );
      await Promise.resolve();
      activeResourceObservations -= 1;
      return Object.freeze({
        decision: url.endsWith("blocked.js") ? ("disallowed" as const) : ("allowed" as const),
        observationId: robotsObservationId,
        result: "fetched" as const,
      });
    });
    installRunner(async (crawlPersistence, input) => {
      capturedInput = input;
      await crawlPersistence.discover(frontierEntry());
      await crawlPersistence.discover(frontierEntry("https://example.com/next"));
      await crawlPersistence.recordFetch(successfulFetch(), { observeResourceRobots });
      await crawlPersistence.recordProgress(CORE_PROGRESS);
    });
    const store = artifactStore();

    await expect(
      executor(repository, processing, store).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      }),
    ).resolves.toMatchObject({ status: "completed", counters: { processed: 1, succeeded: 1 } });

    expect(capturedInput?.config).toMatchObject({
      maxSitemapDepth: 5,
      maxSitemaps: 100,
      submittedSitemapUrls: ["https://example.com/custom-sitemap.xml"],
    });
    expect(persistPageObservation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        responseHeaders: expect.objectContaining({ "cache-control": ["public, max-age=60"] }),
        omittedResponseHeaders: ["set-cookie"],
        contentLength: expect.any(Number),
        transferSize: 321,
        compression: "br",
        cacheHeaders: { "cache-control": ["public, max-age=60"] },
        securityHeaders: { "strict-transport-security": ["max-age=31536000"] },
        htmlDetected: true,
        htmlDetectionSource: "bounded_response_prefix",
        htmlDetectionBytes: expect.any(Number),
      }),
    );
    expect(store.store).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "raw-html",
        pageId,
      }),
    );
    const storedRawBody = store.store.mock.calls[0]?.[0].html;
    expect(Buffer.from(storedRawBody ?? "").toString("utf8")).toContain("Example title");
    expect(persistPageArtifact).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ pageId, kind: "raw-html" }),
    );
    const rawExtraction = persistPageExtraction.mock.calls.at(-1)?.[1];
    expect(rawExtraction).toMatchObject({
      pageId,
      source: "raw",
      title: "Example title",
      documentMetadataComplete: true,
      titleTagCount: 1,
      metaDescription: "A useful page description",
      metaDescriptionTagCount: 1,
      directiveScopePreserved: true,
      linksComplete: true,
      canonicalUrl: "https://example.com/canonical",
      canonicalNormalizationFailure: null,
      metaRefreshUrl: "https://example.com/meta-redirect",
      javascriptRedirectUrl: "https://example.com/client-redirect",
      visibleTextComplete: true,
      htmlLanguage: "en",
      characterEncoding: "utf-8",
      characterEncodingDeclared: "utf-8",
      characterEncodingSource: "http_header",
      characterEncodingDeclarationOffset: null,
      viewportDeclarations: ["width=device-width, initial-scale=1"],
      htmlDoctypePresent: true,
      iconDeclarationCount: 1,
      headingsComplete: true,
      headings: [{ level: 1, ordinal: 0, text: "Primary heading" }],
    });
    expect(rawExtraction?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedTargetUrl: "https://example.com/next",
          discovered: true,
          targetFrontierId: nextFrontierId,
          linkType: "anchor",
        }),
        expect.objectContaining({
          normalizedTargetUrl: "https://example.com/canonical",
          discovered: false,
          linkType: "canonical",
        }),
      ]),
    );
    expect(rawExtraction?.structuredData).toEqual([
      expect.objectContaining({
        kind: "json_ld",
        parseStatus: "parsed",
        schemaTypes: ["Article"],
      }),
    ]);
    expect(observeResourceRobots).toHaveBeenCalledTimes(2);
    expect(maximumResourceObservationConcurrency).toBe(1);
    expect(rawExtraction?.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: "script",
          normalizedUrl: "https://example.com/assets/blocked.js",
          robotsDecision: "disallowed",
          robotsObservationId,
        }),
        expect.objectContaining({
          resourceType: "stylesheet",
          normalizedUrl: "https://example.com/assets/app.css",
          robotsDecision: "allowed",
          robotsObservationId,
        }),
      ]),
    );
  });

  it("marks production extraction provenance incomplete at directive and aggregate-link bounds", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    const directiveTags = Array.from(
      { length: 65 },
      (_, index) => `<meta name="robots" content="custom-${index}">`,
    ).join("");
    const anchorTags = Array.from(
      { length: 10_000 },
      (_, index) => `<a href="/anchor-${index}">A</a>`,
    ).join("");
    const canonicalTags = Array.from(
      { length: 10_000 },
      (_, index) => `<link rel="canonical" href="/canonical-${index}">`,
    ).join("");
    const body = new TextEncoder().encode(
      `<!doctype html><head>${directiveTags}${canonicalTags}<link rel="alternate" hreflang="en" href="/overflow"></head><body>${anchorTags}</body>`,
    );
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body,
        contentLength: body.byteLength,
        discoveredUrls: [],
        responseBytes: body.byteLength,
        transferBytes: body.byteLength,
      });
    });

    await executor(repository, processing, artifactStore()).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    const stored = persistPageExtraction.mock.calls.at(-1)?.[1];
    expect(stored).toMatchObject({
      status: "succeeded",
      directiveScopePreserved: false,
      linksComplete: false,
    });
    expect(stored?.metaRobots).toHaveLength(64);
    expect(stored?.links).toHaveLength(20_000);
  });

  it("marks persisted headings and social metadata incomplete when worker bounds truncate them", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    const headings = Array.from(
      { length: 1_001 },
      (_, index) => `<h2>Persisted heading ${index}</h2>`,
    ).join("");
    const openGraph = Array.from(
      { length: 17 },
      (_, index) => `<meta property="og:title" content="Title ${index}">`,
    ).join("");
    const socialCards = Array.from(
      { length: 17 },
      (_, index) => `<meta name="twitter:title" content="Title ${index}">`,
    ).join("");
    const body = new TextEncoder().encode(
      `<!doctype html><html><head><title>Bounded metadata</title>${openGraph}${socialCards}</head><body>${headings}</body></html>`,
    );
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body,
        contentLength: body.byteLength,
        responseBytes: body.byteLength,
        transferBytes: body.byteLength,
      });
    });

    await executor(repository, processing, artifactStore()).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    const stored = persistPageExtraction.mock.calls.at(-1)?.[1];
    expect(stored).toMatchObject({
      status: "succeeded",
      documentMetadataComplete: false,
      headingsComplete: false,
    });
    expect(stored?.headings).toHaveLength(1_000);
    expect(stored?.openGraph["og:title"]).toHaveLength(16);
    expect(stored?.socialCards["twitter:title"]).toHaveLength(16);
  });

  it("bounds social metadata by the PostgreSQL JSONB text representation", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    const openGraph = Array.from(
      { length: 10_000 },
      (_, index) => `<meta property="og:k${index}" content="">`,
    ).join("");
    const body = new TextEncoder().encode(
      `<!doctype html><html><head><title>Bounded metadata</title>${openGraph}</head><body>Complete page content for extraction.</body></html>`,
    );
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body,
        contentLength: body.byteLength,
        responseBytes: body.byteLength,
        transferBytes: body.byteLength,
      });
    });

    await executor(repository, processing, artifactStore()).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    const stored = persistPageExtraction.mock.calls.at(-1)?.[1];
    const openGraphRecord = stored?.openGraph ?? {};
    const entries = Object.entries(openGraphRecord);
    const postgresJsonbTextBytes =
      Buffer.byteLength(JSON.stringify(openGraphRecord), "utf8") +
      (entries.length === 0 ? 0 : entries.length * 2 - 1) +
      entries.reduce((bytes, [, values]) => bytes + Math.max(0, values.length - 1), 0);
    expect(stored).toMatchObject({
      status: "succeeded",
      documentMetadataComplete: false,
    });
    expect(entries.length).toBeLessThan(10_000);
    expect(postgresJsonbTextBytes).toBeLessThanOrEqual(120_000);
  });

  it.each([
    {
      label: "title",
      title: "T".repeat(2_001),
      description: "A complete description",
      expectedTitleLength: 2_000,
      expectedDescriptionLength: "A complete description".length,
    },
    {
      label: "meta description",
      title: "A complete title",
      description: "D".repeat(8_001),
      expectedTitleLength: "A complete title".length,
      expectedDescriptionLength: 8_000,
    },
  ])(
    "marks document metadata incomplete when the persisted $label is truncated",
    async ({ title, description, expectedTitleLength, expectedDescriptionLength }) => {
      const contract = job();
      const executionClaim = claimed(contract);
      const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(
        async () => Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
      );
      const repository = fakeRepository({
        claimExecution: vi.fn(async () => executionClaim),
        persistPageExtraction,
      });
      const processing = new DatabaseCrawlProcessingPersistence(
        repository,
        fakeRuntime(repository),
        {
          crawlExecutionLeaseMs: 30_000,
        },
      );
      const execution = await authorizedExecution(processing, contract);
      const body = new TextEncoder().encode(
        `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}"></head><body><h1>Complete page</h1></body></html>`,
      );
      installRunner(async (crawlPersistence) => {
        await crawlPersistence.recordFetch({
          ...successfulFetch(),
          body,
          contentLength: body.byteLength,
          responseBytes: body.byteLength,
          transferBytes: body.byteLength,
        });
      });

      await executor(repository, processing, artifactStore()).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      });

      const stored = persistPageExtraction.mock.calls.at(-1)?.[1];
      expect(stored).toMatchObject({
        status: "succeeded",
        documentMetadataComplete: false,
      });
      expect(stored?.title).toHaveLength(expectedTitleLength);
      expect(stored?.metaDescription).toHaveLength(expectedDescriptionLength);
    },
  );

  it("marks link provenance incomplete when anchor or rel evidence is truncated", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    const rel = [...Array.from({ length: 64 }, (_, index) => `relationship-${index}`), "nofollow"];
    const anchorText = `${"A".repeat(4_000)}destination`;
    const body = new TextEncoder().encode(
      `<!doctype html><html><head><title>Complete page</title></head><body><a href="/target" rel="${rel.join(" ")}">${anchorText}</a></body></html>`,
    );
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body,
        contentLength: body.byteLength,
        responseBytes: body.byteLength,
        transferBytes: body.byteLength,
      });
    });

    await executor(repository, processing, artifactStore()).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    const stored = persistPageExtraction.mock.calls.at(-1)?.[1];
    const storedLink = stored?.links.find((link) => link.linkType === "anchor");
    expect(stored).toMatchObject({ status: "succeeded", linksComplete: false });
    expect(storedLink?.anchorText).toHaveLength(4_000);
    expect(storedLink?.relValues).toHaveLength(64);
    expect(storedLink?.relValues).not.toContain("nofollow");
  });

  it("persists bounded HTML-sniff provenance even when an incorrect MIME type prevents extraction", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const persistPageObservation = vi.fn<CrawlWorkerRepository["persistPageObservation"]>(
      async () =>
        Object.freeze({
          pageId: crypto.randomUUID(),
          created: true,
          rawArtifactExists: false,
          storedObservation: null,
        }),
    );
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageObservation,
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        contentType: "text/plain",
        responseHeaders: { "content-type": ["text/plain"] },
      });
    });

    await executor(repository, processing, artifactStore()).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    expect(persistPageObservation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        contentType: "text/plain",
        htmlDetected: true,
        htmlDetectionSource: "bounded_response_prefix",
        htmlDetectionBytes: expect.any(Number),
      }),
    );
    expect(persistPageExtraction).not.toHaveBeenCalled();
  });

  it.each([
    {
      queryPolicy: "ignore_tracking" as const,
      expectedTargetUrl: "https://example.com/target?item=1",
    },
    {
      queryPolicy: "keep" as const,
      expectedTargetUrl: "https://example.com/target?utm_source=mail&item=1",
    },
  ])(
    "persists extracted-link identity with the $queryPolicy crawl query policy",
    async ({ queryPolicy, expectedTargetUrl }) => {
      const contract = job();
      const executionClaim = claimed(contract, configuration({ queryPolicy }));
      const rawTargetUrl = "https://example.com/target?utm_source=mail&item=1";
      const targetFrontierId = crypto.randomUUID();
      const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(
        async () => Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
      );
      const repository = fakeRepository({
        claimExecution: vi.fn(async () => executionClaim),
        persistDiscoveredUrl: vi.fn(async (_context, input) =>
          Object.freeze({
            id:
              input.urlHash === hashNormalizedUrl(expectedTargetUrl)
                ? targetFrontierId
                : crypto.randomUUID(),
            created: true,
            state: "discovered" as const,
          }),
        ),
        persistPageExtraction,
      });
      const processing = new DatabaseCrawlProcessingPersistence(
        repository,
        fakeRuntime(repository),
        {
          crawlExecutionLeaseMs: 30_000,
        },
      );
      const execution = await authorizedExecution(processing, contract);
      installRunner(async (crawlPersistence) => {
        await crawlPersistence.discover(frontierEntry());
        await crawlPersistence.discover(frontierEntry(expectedTargetUrl));
        await crawlPersistence.recordFetch(
          successfulFetchWithLink(rawTargetUrl, expectedTargetUrl),
        );
      });

      await executor(repository, processing, artifactStore()).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      });

      const extraction = persistPageExtraction.mock.calls.at(-1)?.[1];
      const link = extraction?.links.find((candidate) => candidate.linkType === "anchor");
      expect(link).toMatchObject({
        targetUrl: rawTargetUrl,
        normalizedTargetUrl: expectedTargetUrl,
        targetUrlHash: hashNormalizedUrl(expectedTargetUrl),
        targetFrontierId,
        discovered: true,
      });
    },
  );

  it("recovers an orphaned immutable artifact and finishes from its stored transport snapshot", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const pageId = crypto.randomUUID();
    const originalBody = new TextEncoder().encode(
      "<html><head><title>Original evidence</title></head><body><p>Durable original body content.</p></body></html>",
    );
    const immutableObservation = Object.freeze({
      requestedUrl: "https://example.com/",
      normalizedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      urlHash: "a".repeat(64),
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      responseHeaders: Object.freeze({
        "x-robots-tag": Object.freeze(["googlebot: noindex", "SearviaBot: nofollow"]),
      }),
      contentLength: originalBody.byteLength,
      responseBytes: originalBody.byteLength,
      transferSize: originalBody.byteLength,
      compression: null,
      depth: 0,
      redirectChain: Object.freeze([]),
      timing: Object.freeze({
        startedAt: "2026-07-15T20:00:00.000Z",
        dnsMs: 1,
        ttfbMs: 2,
        downloadMs: 3,
        totalMs: 6,
      }),
      discoverySource: "seed" as const,
    });
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const persistPageArtifact = vi.fn<CrawlWorkerRepository["persistPageArtifact"]>(async () =>
      Object.freeze({ artifactId: crypto.randomUUID(), created: false }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageObservation: vi.fn(async () =>
        Object.freeze({
          pageId,
          created: false,
          rawArtifactExists: false,
          storedObservation: immutableObservation,
        }),
      ),
      persistPageExtraction,
      persistPageArtifact,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body: null,
        contentLength: null,
        contentType: null,
        finalUrl: null,
        responseBytes: 0,
        statusCode: null,
        transferBytes: 0,
        errorCode: "request_timeout",
        errorMessage: "The replay fetch timed out.",
      });
    });
    const store = artifactStore();
    store.load.mockResolvedValue(
      Object.freeze({
        organizationId: contract.organizationId,
        projectId: contract.projectId,
        crawlId: contract.crawlId,
        pageId,
        kind: "raw-html" as const,
        bucket: "private-crawls",
        key: `organizations/${contract.organizationId}/projects/${contract.projectId}/crawls/${contract.crawlId}/pages/${pageId}/raw-html.html.gz`,
        contentType: "text/html; charset=utf-8" as const,
        contentEncoding: "gzip" as const,
        contentSha256: "a".repeat(64),
        storageSha256: "b".repeat(64),
        originalBytes: originalBody.byteLength,
        storedBytes: 128,
        etag: '"etag"',
        objectVersion: "v1",
        storedAt: "2026-07-15T20:00:00.000Z",
        writeDisposition: "existing" as const,
        body: originalBody,
      }),
    );

    await executor(repository, processing, store).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    expect(store.load).toHaveBeenCalledWith(
      expect.objectContaining({ pageId }),
      "raw-html",
      undefined,
    );
    expect(store.store).not.toHaveBeenCalled();
    expect(persistPageArtifact).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ pageId, kind: "raw-html" }),
    );
    expect(repository.replaceIncompletePageObservation).not.toHaveBeenCalled();
    expect(persistPageExtraction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        pageId,
        source: "raw",
        title: "Original evidence",
        xRobotsTag: ["nofollow"],
        directiveScopePreserved: true,
      }),
    );
  });

  it("replaces an incomplete transport snapshot only after proving no raw object exists", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const pageId = crypto.randomUUID();
    const storedObservation = Object.freeze({
      requestedUrl: "https://example.com/",
      normalizedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      urlHash: "a".repeat(64),
      statusCode: 503,
      contentType: "text/html",
      responseHeaders: Object.freeze({}),
      contentLength: 10,
      responseBytes: 10,
      transferSize: 10,
      compression: null,
      depth: 0,
      redirectChain: Object.freeze([]),
      timing: null,
      discoverySource: "seed" as const,
    });
    const replaceIncompletePageObservation = vi.fn(async () => undefined);
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageObservation: vi.fn(async () =>
        Object.freeze({
          pageId,
          created: false,
          rawArtifactExists: false,
          storedObservation,
        }),
      ),
      replaceIncompletePageObservation,
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch(successfulFetch());
    });
    const store = artifactStore();

    await executor(repository, processing, store).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    expect(store.load).toHaveBeenCalledOnce();
    expect(replaceIncompletePageObservation).toHaveBeenCalledWith(
      expect.any(Object),
      pageId,
      expect.objectContaining({ statusCode: 200, responseBytes: expect.any(Number) }),
    );
    expect(store.store).toHaveBeenCalledOnce();
    expect(persistPageExtraction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ title: "Example title", source: "raw" }),
    );
  });

  it("stores hostile HTML evidence and records a bounded extraction failure", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      const body = new TextEncoder().encode("<i>".repeat(100_001));
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body,
        contentLength: body.byteLength,
        responseBytes: body.byteLength,
        transferBytes: body.byteLength,
      });
    });
    const store = artifactStore();

    await expect(
      executor(repository, processing, store).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      }),
    ).resolves.toMatchObject({ status: "completed" });

    expect(store.store).toHaveBeenCalledOnce();
    expect(persistPageExtraction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        source: "raw",
        status: "failed",
        renderingErrorType: "extraction_error",
        visibleText: null,
        visibleTextComplete: false,
        headings: [],
        links: [],
      }),
    );
  });

  it("renders only when both project and worker gates permit it, and commits raw extraction last", async () => {
    const contract = job();
    const executionClaim = claimed(contract, configuration({ renderingEnabled: true }));
    const extractionOrder: string[] = [];
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(
      async (_context, input) => {
        extractionOrder.push(input.source);
        return Object.freeze({ extractionId: crypto.randomUUID(), created: true });
      },
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body: new TextEncoder().encode(
          '<html><head></head><body><div id="root"></div><script>document.querySelector("#root").textContent="loaded"</script></body></html>',
        ),
      });
    });
    const renderer: CrawlPageRenderer = {
      render: vi.fn(async () =>
        Object.freeze({
          status: "rendered" as const,
          renderedHtml:
            '<html><head><title>Rendered</title><meta name="description" content="Rendered page"></head><body><h1>Loaded content</h1><p>Enough meaningful rendered content to persist.</p></body></html>',
          blockedRequests: [],
          blockedRequestCount: 0,
          errors: [
            Object.freeze({
              code: "console_error" as const,
              message: "A page script logged an error.",
            }),
          ],
          durationMs: 5,
        }),
      ),
      close: vi.fn(async () => undefined),
    };
    const store = artifactStore();

    await executor(repository, processing, store, {
      renderer,
      workerRenderingEnabled: true,
    }).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });

    expect(renderer.render).toHaveBeenCalledOnce();
    expect(store.store.mock.calls.map((call) => call[0].kind)).toEqual([
      "raw-html",
      "rendered-html",
    ]);
    expect(extractionOrder).toEqual(["rendered", "raw"]);
    expect(persistPageExtraction.mock.calls.map((call) => call[1].status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("records a rendered extraction safety failure without retrying the durable raw page", async () => {
    const contract = job();
    const executionClaim = claimed(contract, configuration({ renderingEnabled: true }));
    const persistPageExtraction = vi.fn<CrawlWorkerRepository["persistPageExtraction"]>(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch({
        ...successfulFetch(),
        body: new TextEncoder().encode(
          '<html><body><div id="root"></div><script>document.querySelector("#root").textContent="loaded"</script></body></html>',
        ),
      });
    });
    const renderer: CrawlPageRenderer = {
      render: vi.fn(async () =>
        Object.freeze({
          status: "rendered" as const,
          renderedHtml: "<i>".repeat(100_001),
          blockedRequests: [],
          blockedRequestCount: 0,
          errors: [],
          durationMs: 5,
        }),
      ),
      close: vi.fn(async () => undefined),
    };
    const store = artifactStore();

    await expect(
      executor(repository, processing, store, {
        renderer,
        workerRenderingEnabled: true,
      }).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      }),
    ).resolves.toMatchObject({ status: "completed" });

    expect(store.store.mock.calls.map((call) => call[0].kind)).toEqual(["raw-html"]);
    expect(persistPageExtraction).toHaveBeenCalledTimes(1);
    expect(persistPageExtraction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        source: "raw",
        status: "succeeded",
        renderingErrorType: "browser_error",
      }),
    );
  });

  it.each([
    { projectEnabled: false, workerEnabled: true },
    { projectEnabled: true, workerEnabled: false },
  ])(
    "does not render when either gate is disabled: $projectEnabled/$workerEnabled",
    async (gates) => {
      const contract = job();
      const executionClaim = claimed(
        contract,
        configuration({ renderingEnabled: gates.projectEnabled }),
      );
      const repository = fakeRepository({ claimExecution: vi.fn(async () => executionClaim) });
      const processing = new DatabaseCrawlProcessingPersistence(
        repository,
        fakeRuntime(repository),
        {
          crawlExecutionLeaseMs: 30_000,
        },
      );
      const execution = await authorizedExecution(processing, contract);
      installRunner(async (crawlPersistence) => {
        await crawlPersistence.recordFetch(successfulFetch());
      });
      const renderer: CrawlPageRenderer = {
        render: vi.fn(async () => {
          throw new Error("Rendering should remain gated.");
        }),
        close: vi.fn(async () => undefined),
      };

      await executor(repository, processing, artifactStore(), {
        ...(gates.workerEnabled ? { renderer } : {}),
        workerRenderingEnabled: gates.workerEnabled,
      }).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      });
      expect(renderer.render).not.toHaveBeenCalled();
    },
  );

  it("converts retryable artifact failures at the durable page boundary", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const persistPageExtraction = vi.fn(async () =>
      Object.freeze({ extractionId: crypto.randomUUID(), created: true }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageExtraction,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch(successfulFetch());
    });
    const store: PageArtifactStore = {
      load: vi.fn(async () => null),
      store: vi.fn(async () => {
        const { ArtifactStorageError } = await import("../src/artifact-storage.js");
        throw new ArtifactStorageError(
          "object_storage_request_failed",
          "Private object storage timed out.",
          { retryable: true },
        );
      }),
    };

    const executionPromise = executor(repository, processing, store).execute(execution, {
      signal: undefined,
      reportProgress: vi.fn(async () => undefined),
      isCancellationRequested: vi.fn(async () => false),
    });
    await expect(executionPromise).rejects.toMatchObject({
      failure: { type: "object_storage_request_failed", retryable: true, partial: true },
    });
    expect(persistPageExtraction).not.toHaveBeenCalled();
  });

  it("lets unexpected database persistence failures reach the queue retry classifier", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistPageArtifact: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    installRunner(async (crawlPersistence) => {
      await crawlPersistence.recordFetch(successfulFetch());
    });

    const failure = await executor(repository, processing, artifactStore())
      .execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(CrawlExecutionError);
    expect(classifyCrawlFailure(failure)).toMatchObject({
      type: "crawl_worker_error",
      retryable: true,
    });
  });

  it("maps nested sitemap entries, lastmod evidence, and parse status without page counters", async () => {
    const contract = job();
    const executionClaim = claimed(contract);
    const sitemapId = crypto.randomUUID();
    const persistSitemapObservation = vi.fn(async () =>
      Object.freeze({ sitemapId, created: true, insertedEntryCount: 1 }),
    );
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => executionClaim),
      persistSitemapObservation,
    });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    const sitemapRecord: SitemapPersistenceRecord = Object.freeze({
      compression: "gzip",
      contentLength: 512,
      documentDigest: "e".repeat(64),
      contentType: "application/xml",
      depth: 1,
      errorCode: null,
      errorMessage: null,
      finalUrl: "https://example.com/nested.xml.gz",
      kind: "url_set",
      locations: [
        Object.freeze({
          entryType: "url",
          lastModified: "2026-07-01T00:00:00.000Z",
          lastModifiedValid: true,
          normalizedUrl: "https://example.com/article",
          rawUrl: "https://example.com/article",
          urlHash: "c".repeat(64),
        }),
      ],
      normalizedUrl: "https://example.com/nested.xml.gz",
      parentPersistenceId: crypto.randomUUID(),
      parseIssues: [],
      redirectChain: [],
      requestedUrl: "https://example.com/nested.xml.gz",
      robotsDecision: "allowed",
      robotsObservationId: crypto.randomUUID(),
      source: "index",
      state: "parsed",
      statusCode: 200,
      transferBytes: 256,
      urlHash: "d".repeat(64),
    });
    installRunner(async (crawlPersistence) => {
      await expect(crawlPersistence.recordSitemap(sitemapRecord)).resolves.toEqual({
        id: sitemapId,
      });
    });

    await expect(
      executor(repository, processing, artifactStore()).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      }),
    ).resolves.toEqual({ status: "completed", counters: EMPTY_COUNTERS });
    expect(persistSitemapObservation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        source: "nested",
        status: "parsed",
        format: "urlset",
        compression: "gzip",
        transferSize: 256,
        entries: [
          expect.objectContaining({
            normalizedLoc: "https://example.com/article",
            lastmodAt: new Date("2026-07-01T00:00:00.000Z"),
          }),
        ],
      }),
    );
  });

  it.each([
    {
      queryPolicy: "ignore_tracking" as const,
      expectedTargetUrl: "https://example.com/article?item=1",
    },
    {
      queryPolicy: "keep" as const,
      expectedTargetUrl: "https://example.com/article?utm_source=mail&item=1",
    },
  ])(
    "persists sitemap URL identity with the $queryPolicy crawl query policy",
    async ({ queryPolicy, expectedTargetUrl }) => {
      const contract = job();
      const executionClaim = claimed(contract, configuration({ queryPolicy }));
      const rawTargetUrl = "https://example.com/article?utm_source=mail&item=1";
      const parserNormalizedTargetUrl = rawTargetUrl;
      const targetFrontierId = crypto.randomUUID();
      const persistSitemapObservation = vi.fn<CrawlWorkerRepository["persistSitemapObservation"]>(
        async () =>
          Object.freeze({ sitemapId: crypto.randomUUID(), created: true, insertedEntryCount: 1 }),
      );
      const repository = fakeRepository({
        claimExecution: vi.fn(async () => executionClaim),
        persistDiscoveredUrl: vi.fn(async () =>
          Object.freeze({ id: targetFrontierId, created: true, state: "discovered" as const }),
        ),
        persistSitemapObservation,
      });
      const processing = new DatabaseCrawlProcessingPersistence(
        repository,
        fakeRuntime(repository),
        {
          crawlExecutionLeaseMs: 30_000,
        },
      );
      const execution = await authorizedExecution(processing, contract);
      const sitemapRecord: SitemapPersistenceRecord = Object.freeze({
        compression: "identity",
        contentLength: 256,
        documentDigest: "a".repeat(64),
        contentType: "application/xml",
        depth: 0,
        errorCode: null,
        errorMessage: null,
        finalUrl: "https://example.com/sitemap.xml",
        kind: "url_set",
        locations: [
          Object.freeze({
            entryType: "url",
            lastModified: null,
            lastModifiedValid: false,
            normalizedUrl: parserNormalizedTargetUrl,
            rawUrl: rawTargetUrl,
            urlHash: hashNormalizedUrl(parserNormalizedTargetUrl),
          }),
        ],
        normalizedUrl: "https://example.com/sitemap.xml",
        parentPersistenceId: null,
        parseIssues: [],
        redirectChain: [],
        requestedUrl: "https://example.com/sitemap.xml",
        robotsDecision: "allowed",
        robotsObservationId: crypto.randomUUID(),
        source: "submitted",
        state: "parsed",
        statusCode: 200,
        transferBytes: 192,
        urlHash: hashNormalizedUrl("https://example.com/sitemap.xml"),
      });
      installRunner(async (crawlPersistence) => {
        await crawlPersistence.discover(frontierEntry(expectedTargetUrl));
        await crawlPersistence.recordSitemap(sitemapRecord);
      });

      await executor(repository, processing, artifactStore()).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      });

      expect(persistSitemapObservation).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          entries: [
            expect.objectContaining({
              loc: rawTargetUrl,
              normalizedLoc: expectedTargetUrl,
              urlHash: hashNormalizedUrl(expectedTargetUrl),
              targetFrontierId,
            }),
          ],
        }),
      );
    },
  );

  it("closes the shared renderer idempotently", async () => {
    const repository = fakeRepository();
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const renderer: CrawlPageRenderer = {
      render: vi.fn(async () => {
        throw new Error("unused");
      }),
      close: vi.fn(async () => undefined),
    };
    const crawlExecutor = executor(repository, processing, artifactStore(), {
      renderer,
      workerRenderingEnabled: true,
    });
    await Promise.all([crawlExecutor.close(), crawlExecutor.close()]);
    expect(renderer.close).toHaveBeenCalledOnce();
  });

  it("fails closed before constructing a client when HTML is excluded", async () => {
    const contract = job();
    const executionClaim = claimed(
      contract,
      configuration({ supportedContentTypes: ["application/json"] }),
    );
    const repository = fakeRepository({ claimExecution: vi.fn(async () => executionClaim) });
    const processing = new DatabaseCrawlProcessingPersistence(repository, fakeRuntime(repository), {
      crawlExecutionLeaseMs: 30_000,
    });
    const execution = await authorizedExecution(processing, contract);
    await expect(
      executor(repository, processing, artifactStore()).execute(execution, {
        signal: undefined,
        reportProgress: vi.fn(async () => undefined),
        isCancellationRequested: vi.fn(async () => false),
      }),
    ).rejects.toMatchObject({
      failure: { type: "unsupported_content_type_configuration", retryable: false },
    });
    expect(crawlerCoreMocks.createSafeHttpClient).not.toHaveBeenCalled();
  });
});
