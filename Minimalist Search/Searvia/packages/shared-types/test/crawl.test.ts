import { describe, expect, it } from "vitest";

import {
  canTransitionCrawlStatus,
  crawlProgressSchema,
  isTerminalCrawlStatus,
} from "../src/index.js";

describe("crawl lifecycle contracts", () => {
  it("allows forward lifecycle transitions and keeps terminal states terminal", () => {
    expect(canTransitionCrawlStatus("queued", "validating")).toBe(true);
    expect(canTransitionCrawlStatus("validating", "discovering")).toBe(true);
    expect(canTransitionCrawlStatus("discovering", "crawling")).toBe(true);
    expect(canTransitionCrawlStatus("crawling", "queued")).toBe(true);
    expect(canTransitionCrawlStatus("crawling", "completed")).toBe(true);
    expect(canTransitionCrawlStatus("completed", "crawling")).toBe(false);
    expect(isTerminalCrawlStatus("partially_completed")).toBe(true);
    expect(isTerminalCrawlStatus("crawling")).toBe(false);
  });

  it("accepts bounded monotonic progress counters", () => {
    expect(
      crawlProgressSchema.parse({
        crawlId: crypto.randomUUID(),
        status: "crawling",
        counters: {
          discovered: 7,
          processed: 4,
          succeeded: 2,
          failed: 1,
          blocked: 1,
          skipped: 0,
          bytesReceived: 42_000,
        },
        cancellationRequested: false,
        lastProgressAt: "2026-07-15T20:00:00.000Z",
      }),
    ).toMatchObject({ status: "crawling" });
  });

  it("rejects impossible progress and unknown fields", () => {
    const result = crawlProgressSchema.safeParse({
      crawlId: crypto.randomUUID(),
      status: "crawling",
      counters: {
        discovered: 1,
        processed: 2,
        succeeded: 2,
        failed: 1,
        blocked: 0,
        skipped: 0,
        bytesReceived: 0,
      },
      cancellationRequested: false,
      lastProgressAt: "2026-07-15T20:00:00.000Z",
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });
});
