import type { CrawlProgressRecord } from "@searvia/database/runtime";
import { describe, expect, it } from "vitest";

import {
  crawlProgressDtoSchema,
  formatCrawlStatus,
  serializeCrawlProgress,
  shouldPollCrawl,
} from "./crawl-progress";

const record: CrawlProgressRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  status: "crawling",
  cancellationRequested: false,
  discoveredCount: 12,
  processedCount: 7,
  succeededCount: 5,
  failedCount: 1,
  blockedCount: 1,
  skippedCount: 0,
  extractedPageCount: 4,
  extractionFailedCount: 1,
  renderedPageCount: 1,
  artifactCount: 5,
  sitemapCount: 2,
  sitemapUrlCount: 20,
  bytesReceived: 2_048,
  attemptCount: 1,
  completionReason: null,
  errorType: null,
  errorMessage: null,
  traceId: "trace-12345678",
  createdAt: new Date("2026-07-16T04:00:00.000Z"),
  startedAt: new Date("2026-07-16T04:00:01.000Z"),
  finishedAt: null,
  lastProgressAt: new Date("2026-07-16T04:00:02.000Z"),
};

describe("crawl progress UI logic", () => {
  it("serializes only real repository counters and ISO timestamps", () => {
    expect(serializeCrawlProgress(record)).toMatchObject({
      status: "crawling",
      discoveredCount: 12,
      processedCount: 7,
      extractedPageCount: 4,
      artifactCount: 5,
      bytesReceived: 2_048,
      startedAt: "2026-07-16T04:00:01.000Z",
      lastProgressAt: "2026-07-16T04:00:02.000Z",
    });
  });

  it.each(["queued", "validating", "discovering", "crawling"] as const)(
    "polls while a crawl is %s",
    (status) => {
      expect(shouldPollCrawl({ ...serializeCrawlProgress(record), status })).toBe(true);
    },
  );

  it.each(["cancelled", "failed", "partially_completed", "completed"] as const)(
    "stops polling when a crawl is %s",
    (status) => {
      expect(shouldPollCrawl({ ...serializeCrawlProgress(record), status })).toBe(false);
    },
  );

  it("rejects negative or fabricated counter shapes at the client boundary", () => {
    const invalid = { ...serializeCrawlProgress(record), processedCount: -1 };
    expect(crawlProgressDtoSchema.safeParse(invalid).success).toBe(false);
  });

  it("formats lifecycle values for accessible status text", () => {
    expect(formatCrawlStatus("partially_completed")).toBe("Partially Completed");
  });
});
