import { parseWorkerEnvironment } from "@searvia/config/worker";
import type { CrawlWorkerHandle } from "@searvia/job-queue";
import { describe, expect, it, vi } from "vitest";

import { createCrawlerWorkerRuntime } from "../src/runtime.js";

function fakeWorker(input?: Readonly<{ gracefulNeverCompletes?: boolean }>) {
  const calls: string[] = [];
  const handle: CrawlWorkerHandle = {
    async start() {
      calls.push("start");
    },
    async waitUntilReady() {},
    async close(force = false) {
      calls.push(`close:${String(force)}`);
      if (!force && input?.gracefulNeverCompletes === true) {
        await new Promise<void>(() => undefined);
      }
    },
    cancelAll(reason) {
      calls.push(`cancel:${reason ?? "none"}`);
    },
    isRunning() {
      return true;
    },
  };
  return { handle, calls };
}

describe("crawler worker runtime", () => {
  it("starts, gracefully closes, and closes persistence once", async () => {
    const worker = fakeWorker();
    const closePersistence = vi.fn(async () => undefined);
    const runtime = createCrawlerWorkerRuntime({
      environment: parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "test",
        WORKER_HEALTH_INTERVAL_MS: "300000",
      }),
      handler: vi.fn(),
      worker: worker.handle,
      closePersistence,
    });

    await runtime.start();
    await Promise.all([runtime.shutdown("SIGTERM"), runtime.shutdown("SIGTERM")]);

    expect(worker.calls).toEqual(["start", "close:false"]);
    expect(closePersistence).toHaveBeenCalledOnce();
  });

  it("starts and gracefully drains the independent crawl and audit consumers", async () => {
    const crawlWorker = fakeWorker();
    const auditWorker = fakeWorker();
    const runtime = createCrawlerWorkerRuntime({
      environment: parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "test",
        WORKER_HEALTH_INTERVAL_MS: "300000",
      }),
      handler: vi.fn(),
      auditHandler: vi.fn(),
      worker: crawlWorker.handle,
      auditWorker: auditWorker.handle,
    });

    await runtime.start();
    await runtime.shutdown("SIGTERM");

    expect(crawlWorker.calls).toEqual(["start", "close:false"]);
    expect(auditWorker.calls).toEqual(["start", "close:false"]);
  });

  it("forces shutdown after the graceful bound", async () => {
    const worker = fakeWorker({ gracefulNeverCompletes: true });
    const auditWorker = fakeWorker();
    const runtime = createCrawlerWorkerRuntime({
      environment: parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "test",
        WORKER_HEALTH_INTERVAL_MS: "300000",
        WORKER_SHUTDOWN_TIMEOUT_MS: "100",
      }),
      handler: vi.fn(),
      auditHandler: vi.fn(),
      worker: worker.handle,
      auditWorker: auditWorker.handle,
    });

    await runtime.start();
    await runtime.shutdown("SIGINT");

    expect(worker.calls).toEqual(["start", "close:false", "cancel:worker-shutdown", "close:true"]);
    expect(auditWorker.calls).toEqual([
      "start",
      "close:false",
      "cancel:worker-shutdown",
      "close:true",
    ]);
  });

  it("rejects an unmanaged audit worker handle without a handler", () => {
    const auditWorker = fakeWorker();

    expect(() =>
      createCrawlerWorkerRuntime({
        environment: parseWorkerEnvironment("crawler-worker", { NODE_ENV: "test" }),
        handler: vi.fn(),
        auditWorker: auditWorker.handle,
      }),
    ).toThrow("audit job handler");
  });

  it("reports a persistence-close failure instead of completing shutdown", async () => {
    const worker = fakeWorker();
    const closeFailure = new Error("Persistence close failed.");
    const runtime = createCrawlerWorkerRuntime({
      environment: parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "test",
        WORKER_HEALTH_INTERVAL_MS: "300000",
      }),
      handler: vi.fn(),
      worker: worker.handle,
      closePersistence: vi.fn(async () => Promise.reject(closeFailure)),
    });

    await runtime.start();
    await expect(runtime.shutdown("SIGTERM")).rejects.toBe(closeFailure);
    expect(worker.calls).toEqual(["start", "close:false"]);
  });
});
