import { parseWorkerEnvironment } from "@searvia/config/worker";
import type { CrawlQueueJob } from "@searvia/shared-types";
import {
  CRAWL_QUEUE_NAME,
  type CrawlJobPublisher,
  type PublishedCrawlJob,
} from "@searvia/job-queue";
import { describe, expect, it, vi } from "vitest";

import type { CrawlOutboxPersistencePort } from "../src/outbox-publisher.js";
import { createOutboxPublisherRuntime } from "../src/runtime.js";

describe("outbox publisher runtime", () => {
  it("starts, stops its loop, and closes queue and persistence once", async () => {
    const events: string[] = [];
    const persistence: CrawlOutboxPersistencePort = {
      recoverExpiredLeases: vi.fn(async () => 0),
      claimBatch: vi.fn(async () => []),
      markPublished: vi.fn(),
      releaseForRetry: vi.fn(),
      markDeadLettered: vi.fn(),
      close: vi.fn(async () => {
        events.push("persistence:close");
      }),
    };
    const publisher: CrawlJobPublisher = {
      async publish(job: CrawlQueueJob): Promise<PublishedCrawlJob> {
        return { jobId: job.crawlId, queueName: CRAWL_QUEUE_NAME };
      },
      async waitUntilReady() {
        events.push("publisher:ready");
      },
      async close() {
        events.push("publisher:close");
      },
    };
    const runtime = createOutboxPublisherRuntime({
      environment: parseWorkerEnvironment("scheduler-worker", {
        NODE_ENV: "test",
        OUTBOX_POLL_INTERVAL_MS: "60000",
      }),
      persistence,
      publisher,
      publisherId: "publisher-runtime-1234",
    });

    await Promise.all([runtime.start(), runtime.start()]);
    await Promise.all([runtime.shutdown("SIGTERM"), runtime.shutdown("SIGTERM")]);

    expect(events).toEqual(["publisher:ready", "publisher:close", "persistence:close"]);
    expect(events.filter((event) => event === "publisher:ready")).toHaveLength(1);
    expect(persistence.claimBatch).toHaveBeenCalled();
  });

  it("forces a bounded exit without racing persistence close against a live dispatch", async () => {
    const events: string[] = [];
    const persistence: CrawlOutboxPersistencePort = {
      recoverExpiredLeases: vi.fn(
        () =>
          new Promise<number>(() => {
            events.push("recover:start");
          }),
      ),
      claimBatch: vi.fn(async () => []),
      markPublished: vi.fn(),
      releaseForRetry: vi.fn(),
      markDeadLettered: vi.fn(),
      close: vi.fn(async () => {
        events.push("persistence:close");
      }),
    };
    const publisher: CrawlJobPublisher = {
      publish: vi.fn(async (job: CrawlQueueJob) => ({
        jobId: job.crawlId,
        queueName: CRAWL_QUEUE_NAME,
      })),
      waitUntilReady: vi.fn(async () => undefined),
      close: vi.fn(async () => {
        events.push("publisher:close");
      }),
      disconnect: vi.fn(() => {
        events.push("publisher:disconnect");
      }),
    };
    const runtime = createOutboxPublisherRuntime({
      environment: parseWorkerEnvironment("scheduler-worker", {
        NODE_ENV: "test",
        OUTBOX_POLL_INTERVAL_MS: "60000",
        WORKER_SHUTDOWN_TIMEOUT_MS: "100",
      }),
      persistence,
      publisher,
      publisherId: "publisher-runtime-forced-1234",
      forceExit: (code) => {
        events.push(`force-exit:${code}`);
      },
    });

    await runtime.start();
    await runtime.shutdown("SIGTERM");

    expect(events).toEqual(["recover:start", "publisher:disconnect", "force-exit:1"]);
    expect(publisher.close).not.toHaveBeenCalled();
    expect(persistence.close).not.toHaveBeenCalled();
  });

  it("attempts persistence close when publisher close fails", async () => {
    const events: string[] = [];
    const persistence: CrawlOutboxPersistencePort = {
      recoverExpiredLeases: vi.fn(async () => 0),
      claimBatch: vi.fn(async () => []),
      markPublished: vi.fn(),
      releaseForRetry: vi.fn(),
      markDeadLettered: vi.fn(),
      close: vi.fn(async () => {
        events.push("persistence:close");
      }),
    };
    const publisher: CrawlJobPublisher = {
      publish: vi.fn(async (job: CrawlQueueJob) => ({
        jobId: job.crawlId,
        queueName: CRAWL_QUEUE_NAME,
      })),
      waitUntilReady: vi.fn(async () => undefined),
      close: vi.fn(async () => {
        events.push("publisher:close");
        throw new Error("Redis close failed");
      }),
      disconnect: vi.fn(() => {
        events.push("publisher:disconnect");
      }),
    };
    const runtime = createOutboxPublisherRuntime({
      environment: parseWorkerEnvironment("scheduler-worker", {
        NODE_ENV: "test",
        OUTBOX_POLL_INTERVAL_MS: "60000",
      }),
      persistence,
      publisher,
      publisherId: "publisher-runtime-close-1234",
      forceExit: (code) => {
        events.push(`force-exit:${code}`);
      },
    });

    await runtime.start();
    await runtime.shutdown("SIGTERM");

    expect(events).toEqual([
      "publisher:close",
      "persistence:close",
      "publisher:disconnect",
      "force-exit:1",
    ]);
    expect(persistence.close).toHaveBeenCalledOnce();
  });
});
