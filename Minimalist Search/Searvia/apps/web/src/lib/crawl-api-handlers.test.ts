import {
  DatabaseDomainError,
  type CrawlPageDetailRecord,
  type CrawlPageRecord,
  type CrawlProgressRecord,
} from "@searvia/database/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  handleCancelCrawl,
  handleCreateCrawl,
  handleGetCrawlPage,
  handleGetCrawl,
  handleListCrawls,
  handleListCrawlPages,
  type CrawlApiDependencies,
} from "./crawl-api-handlers";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CRAWL_ID = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://searvia.online";

function crawl(overrides: Partial<CrawlProgressRecord> = {}): CrawlProgressRecord {
  const now = new Date("2026-07-16T04:00:00.000Z");
  return {
    id: CRAWL_ID,
    projectId: PROJECT_ID,
    status: "queued",
    cancellationRequested: false,
    discoveredCount: 0,
    processedCount: 0,
    succeededCount: 0,
    failedCount: 0,
    blockedCount: 0,
    skippedCount: 0,
    extractedPageCount: 0,
    extractionFailedCount: 0,
    renderedPageCount: 0,
    artifactCount: 0,
    sitemapCount: 0,
    sitemapUrlCount: 0,
    bytesReceived: 0,
    attemptCount: 0,
    completionReason: null,
    errorType: null,
    errorMessage: null,
    traceId: "trace-12345678",
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    lastProgressAt: now,
    ...overrides,
  };
}

function crawlPage(): CrawlPageRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    crawlId: CRAWL_ID,
    requestedUrl: "https://example.com/",
    normalizedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    urlHash: "a".repeat(64),
    statusCode: 200,
    contentType: "text/html",
    htmlDetected: true,
    htmlDetectionSource: "bounded_response_prefix",
    htmlDetectionBytes: 100,
    responseHeaders: {},
    omittedResponseHeaders: [],
    contentLength: 100,
    responseBytes: 100,
    transferSize: 80,
    compression: "gzip",
    cacheHeaders: {},
    securityHeaders: {},
    depth: 0,
    redirectChain: [],
    robotsDecision: "not_checked",
    robotsObservationId: null,
    timing: null,
    errorType: null,
    errorMessage: null,
    discoverySource: "seed",
    fetchedAt: new Date("2026-07-16T04:00:00.000Z"),
  };
}

function crawlPageDetail(): CrawlPageDetailRecord {
  return {
    page: crawlPage(),
    extractions: [],
    artifacts: [],
    headings: [],
    links: [],
    images: [],
    resources: [],
    structuredData: [],
    collectionTruncated: {
      headings: false,
      links: false,
      images: false,
      resources: false,
      structuredData: false,
    },
  };
}

function dependencies(options: Readonly<{ authenticated?: boolean; created?: boolean }> = {}) {
  const scope = { tenant: "organization-1" } as const;
  const repository = {
    createCrawl: vi.fn(async () => ({ crawl: crawl(), created: options.created ?? true })),
    listCrawls: vi.fn(async () => [crawl()]),
    getCrawl: vi.fn(async () => crawl()),
    listCrawlPages: vi.fn(async () => ({ items: [crawlPage()], nextCursor: null })),
    getCrawlPage: vi.fn(async () => crawlPageDetail()),
    requestCancellation: vi.fn(async () => crawl({ cancellationRequested: true })),
  };
  const result: CrawlApiDependencies<typeof scope> = {
    trustedMutationOrigins: [ORIGIN],
    generateTraceId: () => "trace-generated-1",
    getSession: vi.fn(async () =>
      options.authenticated === false
        ? null
        : { user: { id: "user-1" }, session: { id: "session-1" } },
    ),
    loadScope: vi.fn(async () => scope),
    repository,
  };
  return { result, repository };
}

function mutationRequest(path: string, headers: HeadersInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-request-id": "trace-12345678",
      ...headers,
    },
  });
}

describe("crawl API handlers", () => {
  it("creates a crawl with authenticated tenant scope and an idempotency key", async () => {
    const { result, repository } = dependencies();
    const response = await handleCreateCrawl(
      mutationRequest(`/api/projects/${PROJECT_ID}/crawls`, {
        "idempotency-key": "crawl-client-key-1",
      }),
      PROJECT_ID,
      result,
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}`);
    expect(repository.createCrawl).toHaveBeenCalledWith({ tenant: "organization-1" }, PROJECT_ID, {
      idempotencyKey: "crawl-client-key-1",
      traceId: "trace-12345678",
    });
    expect(result.loadScope).toHaveBeenCalledWith("user-1", "session-1");
  });

  it("returns 200 for an idempotent replay", async () => {
    const { result } = dependencies({ created: false });
    const response = await handleCreateCrawl(
      mutationRequest(`/api/projects/${PROJECT_ID}/crawls`, {
        "idempotency-key": "crawl-client-key-1",
      }),
      PROJECT_ID,
      result,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ created: false });
  });

  it("rejects a cross-site mutation before authentication or persistence", async () => {
    const { result, repository } = dependencies();
    const response = await handleCreateCrawl(
      new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls`, {
        method: "POST",
        headers: { origin: "https://attacker.example", "idempotency-key": "crawl-client-key-1" },
      }),
      PROJECT_ID,
      result,
    );
    expect(response.status).toBe(403);
    expect(result.getSession).not.toHaveBeenCalled();
    expect(repository.createCrawl).not.toHaveBeenCalled();
  });

  it("requires authentication without invoking the crawl repository", async () => {
    const { result, repository } = dependencies({ authenticated: false });
    const response = await handleCreateCrawl(
      mutationRequest(`/api/projects/${PROJECT_ID}/crawls`, {
        "idempotency-key": "crawl-client-key-1",
      }),
      PROJECT_ID,
      result,
    );
    expect(response.status).toBe(401);
    expect(repository.createCrawl).not.toHaveBeenCalled();
  });

  it("validates client idempotency keys", async () => {
    const { result, repository } = dependencies();
    const response = await handleCreateCrawl(
      mutationRequest(`/api/projects/${PROJECT_ID}/crawls`, { "idempotency-key": "short" }),
      PROJECT_ID,
      result,
    );
    expect(response.status).toBe(400);
    expect(repository.createCrawl).not.toHaveBeenCalled();
  });

  it.each([
    ["idempotency key", { "idempotency-key": "crawl:client:key" }],
    [
      "request trace ID",
      { "idempotency-key": "crawl-client-key-1", "x-request-id": "trace:client:id" },
    ],
  ])("rejects a colon-bearing %s before persistence", async (_label, headers) => {
    const { result, repository } = dependencies();
    const response = await handleCreateCrawl(
      mutationRequest(`/api/projects/${PROJECT_ID}/crawls`, headers),
      PROJECT_ID,
      result,
    );

    expect(response.status).toBe(400);
    expect(repository.createCrawl).not.toHaveBeenCalled();
  });

  it("bounds mutation bodies before reading or persisting them", async () => {
    const { result, repository } = dependencies();
    const response = await handleCreateCrawl(
      new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "idempotency-key": "crawl-client-key-1",
          "x-request-id": "trace-12345678",
        },
        body: "x".repeat(1_025),
      }),
      PROJECT_ID,
      result,
    );
    expect(response.status).toBe(413);
    expect(repository.createCrawl).not.toHaveBeenCalled();
  });

  it("maps cross-tenant not-found errors without returning internal detail", async () => {
    const { result, repository } = dependencies();
    repository.getCrawl.mockRejectedValueOnce(
      new DatabaseDomainError("NOT_FOUND", "project belongs to organization-secret"),
    );
    const response = await handleGetCrawl(
      new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}`),
      PROJECT_ID,
      CRAWL_ID,
      result,
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("organization-secret");
    expect(body).toContain("requested resource was not found");
  });

  it("maps repository throttling to 429", async () => {
    const { result, repository } = dependencies();
    repository.createCrawl.mockRejectedValueOnce(
      new DatabaseDomainError("RATE_LIMITED", "internal quota detail"),
    );
    const response = await handleCreateCrawl(
      mutationRequest(`/api/projects/${PROJECT_ID}/crawls`, {
        "idempotency-key": "crawl-client-key-1",
      }),
      PROJECT_ID,
      result,
    );
    expect(response.status).toBe(429);
  });

  it.each(["limit=0", "limit=01", "limit=1e1", "limit=1&limit=2", "sort=status"])(
    "rejects invalid crawl list query %s before authentication",
    async (query) => {
      const { result, repository } = dependencies();
      const response = await handleListCrawls(
        new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls?${query}`),
        PROJECT_ID,
        result,
      );

      expect(response.status).toBe(400);
      expect(result.getSession).not.toHaveBeenCalled();
      expect(repository.listCrawls).not.toHaveBeenCalled();
    },
  );

  it("requests cancellation through the scoped repository", async () => {
    const { result, repository } = dependencies();
    const response = await handleCancelCrawl(
      mutationRequest(`/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/cancel`),
      PROJECT_ID,
      CRAWL_ID,
      result,
    );
    expect(response.status).toBe(202);
    expect(repository.requestCancellation).toHaveBeenCalledWith(
      { tenant: "organization-1" },
      PROJECT_ID,
      CRAWL_ID,
      "trace-12345678",
    );
  });

  it("lists tenant-scoped crawl pages with strict pagination and no-store", async () => {
    const { result, repository } = dependencies();
    const response = await handleListCrawlPages(
      new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages?limit=25`),
      PROJECT_ID,
      CRAWL_ID,
      result,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(repository.listCrawlPages).toHaveBeenCalledWith(
      { tenant: "organization-1" },
      PROJECT_ID,
      CRAWL_ID,
      { limit: 25, cursor: null },
    );
    await expect(response.json()).resolves.toMatchObject({
      pages: [{ id: "33333333-3333-4333-8333-333333333333", statusCode: 200 }],
      nextCursor: null,
    });
  });

  it.each(["limit=0", "limit=1.5", "limit=01", "limit=10&limit=20", "sort=status"])(
    "rejects invalid crawl page query %s before authentication",
    async (query) => {
      const { result, repository } = dependencies();
      const response = await handleListCrawlPages(
        new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages?${query}`),
        PROJECT_ID,
        CRAWL_ID,
        result,
      );
      expect(response.status).toBe(400);
      expect(result.getSession).not.toHaveBeenCalled();
      expect(repository.listCrawlPages).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed page cursors before persistence", async () => {
    const { result, repository } = dependencies();
    const response = await handleListCrawlPages(
      new Request(
        `${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages?cursor=not%2Bbase64`,
      ),
      PROJECT_ID,
      CRAWL_ID,
      result,
    );
    expect(response.status).toBe(400);
    expect(repository.listCrawlPages).not.toHaveBeenCalled();
  });

  it("requires authentication for crawl page reads", async () => {
    const { result, repository } = dependencies({ authenticated: false });
    const response = await handleListCrawlPages(
      new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages`),
      PROJECT_ID,
      CRAWL_ID,
      result,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(repository.listCrawlPages).not.toHaveBeenCalled();
  });

  it("loads page detail through the authenticated tenant scope", async () => {
    const { result, repository } = dependencies();
    const response = await handleGetCrawlPage(
      new Request(
        `${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages/33333333-3333-4333-8333-333333333333`,
      ),
      PROJECT_ID,
      CRAWL_ID,
      "33333333-3333-4333-8333-333333333333",
      result,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(repository.getCrawlPage).toHaveBeenCalledWith(
      { tenant: "organization-1" },
      PROJECT_ID,
      CRAWL_ID,
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("maps cross-tenant crawl-page reads to a detail-free 404", async () => {
    const { result, repository } = dependencies();
    repository.getCrawlPage.mockRejectedValueOnce(
      new DatabaseDomainError("NOT_FOUND", "organization-secret page"),
    );
    const response = await handleGetCrawlPage(
      new Request(
        `${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages/33333333-3333-4333-8333-333333333333`,
      ),
      PROJECT_ID,
      CRAWL_ID,
      "33333333-3333-4333-8333-333333333333",
      result,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("organization-secret");
  });

  it("rejects crawl page detail query parameters before authentication", async () => {
    const { result, repository } = dependencies();
    const response = await handleGetCrawlPage(
      new Request(
        `${ORIGIN}/api/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages/33333333-3333-4333-8333-333333333333?include=artifact`,
      ),
      PROJECT_ID,
      CRAWL_ID,
      "33333333-3333-4333-8333-333333333333",
      result,
    );
    expect(response.status).toBe(400);
    expect(result.getSession).not.toHaveBeenCalled();
    expect(repository.getCrawlPage).not.toHaveBeenCalled();
  });
});
