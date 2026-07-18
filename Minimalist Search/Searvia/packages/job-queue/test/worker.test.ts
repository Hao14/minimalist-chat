import { DelayedError } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import {
  createBullMqAuditWorker,
  createBullMqCrawlWorker,
  deferActiveCrawlJob,
} from "../src/worker.js";

describe("crawl worker delivery deferral", () => {
  it.each([
    [-100, 50],
    [1_250.2, 1_251],
    [1_000_000, 900_000],
  ] as const)("clamps %s milliseconds to %s and preserves lock ownership", async (input, delay) => {
    const moveToDelayed = vi.fn(async () => undefined);
    const deferred = deferActiveCrawlJob({ moveToDelayed }, "bullmq-lock-token", input, 1_000_000);

    await expect(deferred).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(1_000_000 + delay, "bullmq-lock-token");
  });

  it("fails closed when the active delivery has no lock token", async () => {
    const moveToDelayed = vi.fn(async () => undefined);

    await expect(deferActiveCrawlJob({ moveToDelayed }, undefined, 1_000)).rejects.toThrow(
      "BullMQ lock token",
    );
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it("rejects non-finite delays without moving the job", async () => {
    const moveToDelayed = vi.fn(async () => undefined);

    await expect(
      deferActiveCrawlJob({ moveToDelayed }, "bullmq-lock-token", Number.NaN),
    ).rejects.toBeInstanceOf(RangeError);
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it("propagates a failed delayed-state transition instead of acknowledging the job", async () => {
    const redisFailure = new Error("Redis connection failed.");
    const moveToDelayed = vi.fn(async () => Promise.reject(redisFailure));

    await expect(deferActiveCrawlJob({ moveToDelayed }, "bullmq-lock-token", 1_000)).rejects.toBe(
      redisFailure,
    );
  });
});

describe("isolated queue worker configuration", () => {
  it("validates crawl and audit concurrency before opening Redis", () => {
    const base = {
      redisUrl: "redis://127.0.0.1:6379/0",
      redisConnectTimeoutMs: 5_000,
      queuePrefix: "searvia-test",
      concurrency: 0,
      handler: vi.fn(async () => undefined),
    };

    expect(() => createBullMqCrawlWorker(base)).toThrow("Crawler worker concurrency");
    expect(() => createBullMqAuditWorker(base)).toThrow("Audit worker concurrency");
  });
});
