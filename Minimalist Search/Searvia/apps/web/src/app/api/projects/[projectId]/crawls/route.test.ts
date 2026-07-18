import type { CrawlProgressRecord } from "@searvia/database/runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencyMocks = vi.hoisted(() => ({
  getCrawlApiDependencies: vi.fn(),
}));

vi.mock("@/lib/crawl-api-dependencies", () => dependencyMocks);

import { GET, POST } from "./route";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CRAWL_ID = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://searvia.online";

const crawl: CrawlProgressRecord = {
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
  traceId: "trace-route-1",
  createdAt: new Date("2026-07-16T04:00:00.000Z"),
  startedAt: null,
  finishedAt: null,
  lastProgressAt: new Date("2026-07-16T04:00:00.000Z"),
};

describe("crawl collection route", () => {
  const createCrawl = vi.fn(async () => ({ crawl, created: true }));
  const listCrawls = vi.fn(async () => [crawl]);

  beforeEach(() => {
    vi.clearAllMocks();
    dependencyMocks.getCrawlApiDependencies.mockReturnValue({
      trustedMutationOrigins: [ORIGIN],
      generateTraceId: () => "trace-route-1",
      getSession: async () => ({ user: { id: "user-1" }, session: { id: "session-1" } }),
      loadScope: async () => ({ tenant: "organization-1" }),
      repository: {
        createCrawl,
        listCrawls,
        getCrawl: async () => crawl,
        listCrawlPages: async () => ({ items: [], nextCursor: null }),
        getCrawlPage: async () => {
          throw new Error("not used");
        },
        requestCancellation: async () => crawl,
      },
    });
  });

  it("forwards POST params through the authorized creation handler", async () => {
    const response = await POST(
      new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "idempotency-key": "route-idempotency-1",
          "x-request-id": "trace-route-1",
        },
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(202);
    expect(createCrawl).toHaveBeenCalledWith({ tenant: "organization-1" }, PROJECT_ID, {
      idempotencyKey: "route-idempotency-1",
      traceId: "trace-route-1",
    });
  });

  it("returns serialized tenant-scoped records from GET", async () => {
    const response = await GET(new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/crawls?limit=5`), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(200);
    expect(listCrawls).toHaveBeenCalledWith({ tenant: "organization-1" }, PROJECT_ID, 5);
    await expect(response.json()).resolves.toMatchObject({
      crawls: [{ id: CRAWL_ID, status: "queued", discoveredCount: 0 }],
    });
  });
});
