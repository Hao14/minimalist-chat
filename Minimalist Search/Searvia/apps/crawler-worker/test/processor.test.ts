import type {
  CrawlDeadLetterJob,
  CrawlExecuteJob,
  CrawlProgressCounters,
} from "@searvia/shared-types";
import { UnrecoverableCrawlJobError, type CrawlJobDeliveryContext } from "@searvia/job-queue";
import { describe, expect, it, vi } from "vitest";

import {
  CrawlExecutionError,
  createCrawlJobProcessor,
  type AuthorizedCrawlExecution,
  type CrawlExecutor,
  type CrawlProcessingPersistencePort,
} from "../src/processor.js";

const COUNTERS: CrawlProgressCounters = {
  discovered: 3,
  processed: 2,
  succeeded: 1,
  failed: 1,
  blocked: 0,
  skipped: 0,
  bytesReceived: 1_024,
};

const EMPTY_COUNTERS: CrawlProgressCounters = {
  discovered: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  blocked: 0,
  skipped: 0,
  bytesReceived: 0,
};

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function contract(): CrawlExecuteJob {
  return {
    contractVersion: 1,
    jobType: "crawl.execute",
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    crawlId: crypto.randomUUID(),
    requestedByMembershipId: crypto.randomUUID(),
    traceId: "trace-12345678",
    idempotencyKey: "idempotency-12345678",
    createdAt: "2026-07-15T20:00:00.000Z",
    estimatedPages: 25,
  };
}

function delivery(overrides: Partial<CrawlJobDeliveryContext> = {}): CrawlJobDeliveryContext {
  return {
    queueJobId: crypto.randomUUID(),
    attemptsMade: 0,
    attemptsStarted: 1,
    maxAttempts: 4,
    signal: undefined,
    async defer() {
      throw new Error("This delivery was not expected to be deferred.");
    },
    ...overrides,
  };
}

function execution(
  job: CrawlExecuteJob,
  initialCounters: CrawlProgressCounters = EMPTY_COUNTERS,
): AuthorizedCrawlExecution {
  return {
    organizationId: job.organizationId,
    projectId: job.projectId,
    crawlId: job.crawlId,
    initialCounters,
    configuration: {
      startUrl: "https://example.com",
      pageLimit: 25,
      maxDepth: 3,
      includeSubdomains: false,
      respectRobots: true,
      requestDelayMs: 250,
      concurrency: 2,
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "ignore_tracking",
      userAgent: "SearviaBot/1.0 (+https://searvia.online/crawler)",
      redirectLimit: 5,
      maxResponseBytes: 2_000_000,
      requestTimeoutMs: 10_000,
      totalTimeoutMs: 600_000,
      supportedContentTypes: ["text/html"],
      renderingEnabled: false,
      submittedSitemapUrls: [],
    },
  };
}

function persistence(job: CrawlExecuteJob, executionLeaseHeartbeatMs = 10_000) {
  const failures: Array<{
    terminal: boolean;
    finalStatus: "failed" | "partially_completed" | null;
    deadLetter: CrawlDeadLetterJob | null;
    errorType: string;
    errorMessage: string;
    retryable: boolean;
  }> = [];
  const rejectedScopes: Array<{
    errorType: string;
    errorMessage: string;
    deadLetter: CrawlDeadLetterJob;
  }> = [];
  const port: CrawlProcessingPersistencePort = {
    executionLeaseHeartbeatMs,
    claimExecution: vi.fn(async () => ({
      state: "claimed" as const,
      execution: execution(job),
    })),
    recordPreClaimFailure: vi.fn(async () => ({ state: "retryable" as const })),
    isCancellationRequested: vi.fn(async () => false),
    renewExecutionLease: vi.fn(async () => undefined),
    recordProgress: vi.fn(async () => undefined),
    recordCompletion: vi.fn(async () => undefined),
    recordCancellation: vi.fn(async () => undefined),
    recordFailure: vi.fn(async (_scope, input) => {
      failures.push(input);
    }),
    recordRejectedScope: vi.fn(async (input) => {
      rejectedScopes.push(input);
    }),
    checkpointInterruption: vi.fn(async () => undefined),
  };
  return { port, failures, rejectedScopes };
}

describe("crawler job processor", () => {
  it("defers a busy lease without burning the attempt, then processes its redelivery", async () => {
    const job = contract();
    const state = persistence(job);
    state.port.claimExecution = vi
      .fn()
      .mockResolvedValueOnce({ state: "busy" as const, retryAfterMs: 1_250 })
      .mockResolvedValueOnce({ state: "claimed" as const, execution: execution(job) });
    const executor: CrawlExecutor = {
      execute: vi.fn(async () => ({ status: "completed" as const, counters: COUNTERS })),
    };
    const deferred = new Error("BullMQ moved the job to delayed.");
    const defer = vi.fn(async () => {
      throw deferred;
    });
    const processor = createCrawlJobProcessor({ persistence: state.port, executor });

    await expect(processor(job, delivery({ defer }))).rejects.toBe(deferred);

    expect(defer).toHaveBeenCalledWith(1_250);
    expect(state.port.claimExecution).toHaveBeenCalledOnce();
    expect(executor.execute).not.toHaveBeenCalled();

    await processor(job, delivery());

    expect(state.port.claimExecution).toHaveBeenCalledTimes(2);
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("reconciles a pre-claim exception and leaves a non-final delivery retryable", async () => {
    const job = contract();
    const state = persistence(job);
    state.port.claimExecution = vi.fn(async () => {
      throw new Error("password=do-not-surface");
    });
    const recordPreClaimFailure = vi.fn(async () => ({ state: "retryable" as const }));
    state.port.recordPreClaimFailure = recordPreClaimFailure;
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: { execute: vi.fn() },
    });
    const queueDelivery = delivery({ queueJobId: job.crawlId });

    await expect(processor(job, queueDelivery)).rejects.toMatchObject({
      failure: {
        type: "crawl_worker_error",
        safeMessage: "The crawl worker could not complete this attempt.",
        retryable: true,
      },
    });
    expect(recordPreClaimFailure).toHaveBeenCalledWith({
      contract: job,
      queueJobId: job.crawlId,
      attempt: 1,
      errorType: "crawl_worker_error",
      errorMessage: "The crawl worker could not complete this attempt.",
      terminal: false,
    });
  });

  it("reconciles and dead-letters a pre-claim exception on the final delivery", async () => {
    const job = contract();
    const state = persistence(job);
    state.port.claimExecution = vi.fn(async () => {
      throw new Error("Database connection failed.");
    });
    const recordPreClaimFailure = vi.fn(async () => ({
      state: "failed" as const,
      finalStatus: "failed" as const,
    }));
    state.port.recordPreClaimFailure = recordPreClaimFailure;
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: { execute: vi.fn() },
    });

    await expect(
      processor(job, delivery({ queueJobId: job.crawlId, attemptsMade: 3, maxAttempts: 4 })),
    ).rejects.toBeInstanceOf(CrawlExecutionError);
    expect(recordPreClaimFailure).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 4, terminal: true }),
    );
  });

  it("honors persisted cancellation before the first request", async () => {
    const job = contract();
    const state = persistence(job);
    state.port.isCancellationRequested = vi.fn(async () => true);
    const executor: CrawlExecutor = { execute: vi.fn() };
    const processor = createCrawlJobProcessor({ persistence: state.port, executor });

    await processor(job, delivery());

    expect(executor.execute).not.toHaveBeenCalled();
    expect(state.port.recordCancellation).toHaveBeenCalledOnce();
  });

  it("uses durable counters when a resumed crawl is cancelled before execution", async () => {
    const job = contract();
    const state = persistence(job);
    state.port.claimExecution = vi.fn(async () => ({
      state: "claimed" as const,
      execution: execution(job, COUNTERS),
    }));
    state.port.isCancellationRequested = vi.fn(async () => true);
    const executor: CrawlExecutor = { execute: vi.fn() };

    await createCrawlJobProcessor({ persistence: state.port, executor })(job, delivery());

    expect(executor.execute).not.toHaveBeenCalled();
    expect(state.port.recordCancellation).toHaveBeenCalledWith(expect.any(Object), COUNTERS);
  });

  it("defers without consuming the final attempt when terminal state persistence is unavailable", async () => {
    const job = contract();
    const state = persistence(job);
    state.port.recordCompletion = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const deferred = new Error("moved to delayed");
    const defer = vi.fn(async () => {
      throw deferred;
    });
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        execute: vi.fn(async () => ({ status: "completed" as const, counters: COUNTERS })),
      },
    });

    await expect(processor(job, delivery({ attemptsMade: 3, maxAttempts: 4, defer }))).rejects.toBe(
      deferred,
    );
    expect(defer).toHaveBeenCalledWith(1_000);
    expect(state.port.recordFailure).not.toHaveBeenCalled();
  });

  it("defers a final failure when its atomic terminal write is unavailable", async () => {
    const job = contract();
    const state = persistence(job);
    state.port.recordFailure = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const deferred = new Error("moved to delayed");
    const defer = vi.fn(async () => {
      throw deferred;
    });
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        execute: vi.fn(async () => {
          throw new CrawlExecutionError({
            type: "request_timeout",
            safeMessage: "The destination timed out.",
            retryable: true,
            partial: false,
          });
        }),
      },
    });

    await expect(processor(job, delivery({ attemptsMade: 3, maxAttempts: 4, defer }))).rejects.toBe(
      deferred,
    );
    expect(defer).toHaveBeenCalledWith(1_000);
  });

  it("reports validated progress and completion", async () => {
    const job = contract();
    const state = persistence(job);
    const executor: CrawlExecutor = {
      async execute(_scope, hooks) {
        await hooks.reportProgress(COUNTERS);
        return { status: "completed", counters: COUNTERS };
      },
    };
    const processor = createCrawlJobProcessor({ persistence: state.port, executor });

    await processor(job, delivery());

    expect(state.port.recordProgress).toHaveBeenCalledWith(expect.any(Object), COUNTERS);
    expect(state.port.recordCompletion).toHaveBeenCalledWith(expect.any(Object), {
      status: "completed",
      counters: COUNTERS,
    });
  });

  it("renews the execution lease independently while a crawl has no progress events", async () => {
    vi.useFakeTimers();
    try {
      const job = contract();
      const state = persistence(job, 10_000);
      const entered = deferred<void>();
      const finished = deferred<{ status: "completed"; counters: CrawlProgressCounters }>();
      const executor: CrawlExecutor = {
        execute: vi.fn(async () => {
          entered.resolve(undefined);
          return finished.promise;
        }),
      };
      const processor = createCrawlJobProcessor({ persistence: state.port, executor });
      const processing = processor(job, delivery());

      await entered.promise;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(state.port.renewExecutionLease).toHaveBeenCalledOnce();

      finished.resolve({ status: "completed", counters: COUNTERS });
      await processing;
      expect(state.port.recordCompletion).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts and retries safely when an independent lease renewal fails", async () => {
    vi.useFakeTimers();
    try {
      const job = contract();
      const state = persistence(job, 5_000);
      state.port.renewExecutionLease = vi.fn(async () => {
        throw new Error("password=never-surface-this");
      });
      const entered = deferred<void>();
      const executor: CrawlExecutor = {
        async execute(_execution, hooks) {
          entered.resolve(undefined);
          const signal = hooks.signal;
          if (signal === undefined) throw new Error("Expected a worker abort signal.");
          return new Promise((_resolve, reject) => {
            const rejectForAbort = () => reject(signal.reason);
            if (signal.aborted) rejectForAbort();
            else signal.addEventListener("abort", rejectForAbort, { once: true });
          });
        },
      };
      const processor = createCrawlJobProcessor({ persistence: state.port, executor });
      const processing = processor(job, delivery());
      const rejected = expect(processing).rejects.toMatchObject({
        failure: {
          type: "execution_lease_renewal_failed",
          safeMessage: "The crawl worker could not renew its execution lease.",
          retryable: true,
        },
      });

      await entered.promise;
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
      expect(state.failures).toEqual([
        expect.objectContaining({
          terminal: false,
          errorType: "execution_lease_renewal_failed",
          errorMessage: "The crawl worker could not renew its execution lease.",
        }),
      ]);
      expect(state.failures[0]?.errorMessage).not.toContain("never-surface-this");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a cross-tenant persisted context as unrecoverable and creates a DLQ record", async () => {
    const job = contract();
    const state = persistence(job);
    const wrong = { ...execution(job), organizationId: crypto.randomUUID() };
    state.port.claimExecution = vi.fn(async () => ({
      state: "claimed" as const,
      execution: wrong,
    }));
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: { execute: vi.fn() },
    });

    await expect(processor(job, delivery())).rejects.toBeInstanceOf(UnrecoverableCrawlJobError);
    expect(state.failures).toEqual([]);
    expect(state.rejectedScopes[0]).toMatchObject({
      errorType: "tenant_scope_mismatch",
      deadLetter: { jobType: "crawl.dead-letter", errorType: "tenant_scope_mismatch" },
    });
  });

  it("keeps a transient failure retryable before the final attempt", async () => {
    const job = contract();
    const state = persistence(job);
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        async execute() {
          throw new CrawlExecutionError({
            type: "request_timeout",
            safeMessage: "The destination timed out.",
            retryable: true,
            partial: false,
          });
        },
      },
    });

    await expect(processor(job, delivery())).rejects.toBeInstanceOf(CrawlExecutionError);
    expect(state.failures).toEqual([
      expect.objectContaining({ terminal: false, finalStatus: null, deadLetter: null }),
    ]);
  });

  it("persists one partial terminal DLQ record when transient retries are exhausted", async () => {
    const job = contract();
    const state = persistence(job);
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        async execute(_scope, hooks) {
          await hooks.reportProgress(COUNTERS);
          throw new CrawlExecutionError({
            type: "connection_reset",
            safeMessage: "The destination repeatedly reset the connection.",
            retryable: true,
            partial: true,
          });
        },
      },
    });

    await expect(
      processor(job, delivery({ attemptsMade: 3, attemptsStarted: 4, maxAttempts: 4 })),
    ).rejects.toBeInstanceOf(CrawlExecutionError);
    expect(state.failures[0]).toMatchObject({
      terminal: true,
      finalStatus: "partially_completed",
      deadLetter: {
        jobType: "crawl.dead-letter",
        attemptsMade: 4,
        finalStatus: "partially_completed",
      },
    });
  });

  it("checkpoints queue cancellation without misreporting user cancellation", async () => {
    const job = contract();
    const state = persistence(job);
    const controller = new AbortController();
    controller.abort("lost-lock");
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        async execute() {
          throw new Error("Interrupted");
        },
      },
    });

    await expect(processor(job, delivery({ signal: controller.signal }))).rejects.toThrow(
      "Crawl processing was interrupted.",
    );
    expect(state.port.checkpointInterruption).toHaveBeenCalledWith(expect.any(Object), {
      attempt: 1,
      reason: "queue-abort",
    });
    expect(state.port.recordCancellation).not.toHaveBeenCalled();
  });

  it("checkpoints a forced shutdown when the executor returns cancelled", async () => {
    const job = contract();
    const state = persistence(job);
    const controller = new AbortController();
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        async execute() {
          controller.abort("worker-shutdown");
          return { status: "cancelled", counters: COUNTERS };
        },
      },
    });

    await expect(processor(job, delivery({ signal: controller.signal }))).rejects.toThrow(
      "Crawl processing was interrupted.",
    );
    expect(state.port.checkpointInterruption).toHaveBeenCalledWith(expect.any(Object), {
      attempt: 1,
      reason: "worker-shutdown",
    });
    expect(state.port.recordCancellation).not.toHaveBeenCalled();
  });

  it("terminalizes and dead-letters an interrupted claimed execution on its final attempt", async () => {
    const job = contract();
    const state = persistence(job);
    const controller = new AbortController();
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        async execute(_execution, hooks) {
          await hooks.reportProgress(COUNTERS);
          controller.abort("worker-shutdown");
          return { status: "cancelled", counters: COUNTERS };
        },
      },
    });

    await expect(
      processor(
        job,
        delivery({
          attemptsMade: 3,
          attemptsStarted: 4,
          maxAttempts: 4,
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow("Crawl processing was interrupted.");
    expect(state.port.checkpointInterruption).not.toHaveBeenCalled();
    expect(state.port.recordCancellation).not.toHaveBeenCalled();
    expect(state.failures).toEqual([
      expect.objectContaining({
        attempt: 4,
        errorType: "crawl_interrupted",
        retryable: true,
        terminal: true,
        finalStatus: "partially_completed",
        deadLetter: expect.objectContaining({
          attemptsMade: 4,
          finalStatus: "partially_completed",
          errorType: "crawl_interrupted",
        }),
      }),
    ]);
  });

  it("does not persist an unknown exception message that may contain a secret", async () => {
    const job = contract();
    const state = persistence(job);
    const processor = createCrawlJobProcessor({
      persistence: state.port,
      executor: {
        async execute() {
          throw new Error("password=never-persist-this");
        },
      },
    });

    await expect(processor(job, delivery())).rejects.toThrow(
      "The crawl worker could not complete this attempt.",
    );
    expect(state.failures[0]?.errorMessage).not.toContain("never-persist-this");
  });
});
