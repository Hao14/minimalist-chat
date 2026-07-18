import {
  createWorkerDatabaseRuntime,
  type CrawlWorkerRepository,
  type WorkerCrawlConfigSnapshot,
  type WorkerDatabaseRuntime,
  type WorkerExecutionClaim,
} from "@searvia/database/workers";
/*
 * Keep the production worker-runtime import above: its PostgreSQL pool is lazy, so
 * factory wiring and fail-closed configuration can be verified without a live DB.
 */
import type {
  CrawlDeadLetterJob,
  CrawlExecuteJob,
  CrawlProgressCounters,
} from "@searvia/shared-types";
import { describe, expect, it, vi } from "vitest";

import { DatabaseCrawlProcessingPersistence } from "../src/database-adapter.js";
import type { AuthorizedCrawlExecution } from "../src/processor.js";

const INITIAL_COUNTERS: CrawlProgressCounters = Object.freeze({
  discovered: 2,
  processed: 1,
  succeeded: 1,
  failed: 0,
  blocked: 0,
  skipped: 0,
  bytesReceived: 128,
});

const UPDATED_COUNTERS: CrawlProgressCounters = Object.freeze({
  discovered: 4,
  processed: 3,
  succeeded: 2,
  failed: 1,
  blocked: 0,
  skipped: 0,
  bytesReceived: 512,
});

function crawlConfiguration(): WorkerCrawlConfigSnapshot {
  return Object.freeze({
    version: 1,
    startUrl: "https://example.com/",
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
  });
}

function executeJob(): CrawlExecuteJob {
  return Object.freeze({
    contractVersion: 1,
    jobType: "crawl.execute",
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    crawlId: crypto.randomUUID(),
    requestedByMembershipId: crypto.randomUUID(),
    traceId: "trace-adapter-12345678",
    idempotencyKey: "idempotency-adapter-12345678",
    createdAt: "2026-07-15T20:00:00.000Z",
    estimatedPages: 25,
  });
}

function claimedExecution(job: CrawlExecuteJob): WorkerExecutionClaim {
  return Object.freeze({
    kind: "claimed",
    executionToken: crypto.randomUUID(),
    crawl: Object.freeze({
      organizationId: job.organizationId,
      projectId: job.projectId,
      crawlId: job.crawlId,
      traceId: job.traceId,
      status: "validating",
      config: crawlConfiguration(),
      counters: INITIAL_COUNTERS,
    }),
  });
}

function fakeRepository(overrides: Partial<CrawlWorkerRepository> = {}): CrawlWorkerRepository {
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
        pageId: crypto.randomUUID(),
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

function fakeRuntime(repository: CrawlWorkerRepository) {
  const close = vi.fn(async () => undefined);
  const runtime: WorkerDatabaseRuntime = {
    repository,
    loadAuditCrawlSnapshot: vi.fn(async () => {
      throw new Error("Audit snapshot loading is not used by this test.");
    }),
    hasTerminalAuditEvaluationRun: vi.fn(async () => false),
    persistAuditEvaluationReport: vi.fn(async () => {
      throw new Error("Audit report persistence is not used by this test.");
    }),
    checkHealth: vi.fn(async () => Object.freeze({ latencyMs: 1, status: "ok" as const })),
    close,
  };
  return { close, runtime };
}

async function claim(
  persistence: DatabaseCrawlProcessingPersistence,
  job: CrawlExecuteJob,
): Promise<AuthorizedCrawlExecution> {
  const result = await persistence.claimExecution({
    contract: job,
    queueJobId: job.crawlId,
    attempt: 2,
  });
  if (result.state !== "claimed") throw new Error("Expected a claimed execution.");
  return result.execution;
}

function deadLetter(job: CrawlExecuteJob): CrawlDeadLetterJob {
  return Object.freeze({
    contractVersion: 1,
    jobType: "crawl.dead-letter",
    organizationId: job.organizationId,
    projectId: job.projectId,
    crawlId: job.crawlId,
    sourceJobId: job.crawlId,
    traceId: job.traceId,
    idempotencyKey: `dead-letter-${job.crawlId}`,
    finalStatus: "failed",
    attemptsMade: 4,
    errorType: "request_timeout",
    errorMessage: "The destination timed out.",
    failedAt: "2026-07-15T20:05:00.000Z",
  });
}

describe("crawler database persistence adapter", () => {
  it("wires the worker database runtime lazily and fails closed without PostgreSQL config", async () => {
    expect(() => createWorkerDatabaseRuntime({}, "crawler-worker-test")).toThrow("DATABASE_URL");

    const runtime = createWorkerDatabaseRuntime(
      {
        DATABASE_URL: "postgresql://searvia:development@127.0.0.1:5432/searvia",
      },
      "crawler-worker-test",
    );
    expect(runtime.repository).toMatchObject({
      claimExecution: expect.any(Function),
      claimOutboxBatch: expect.any(Function),
      recordExecutionProgress: expect.any(Function),
      completeExecution: expect.any(Function),
    });
    await runtime.close();
  });

  it("maps complete queue claim metadata and retains the execution lease context", async () => {
    const job = executeJob();
    const storedClaim = claimedExecution(job);
    const claimExecution = vi.fn(async () => storedClaim);
    const isCancellationRequested = vi.fn(async () => false);
    const recordExecutionProgress = vi.fn(async () => undefined);
    const renewExecutionLease = vi.fn(async () => true);
    const repository = fakeRepository({
      claimExecution,
      isCancellationRequested,
      recordExecutionProgress,
      renewExecutionLease,
    });
    const { close, runtime } = fakeRuntime(repository);
    const persistence = new DatabaseCrawlProcessingPersistence(repository, runtime, {
      crawlExecutionLeaseMs: 45_000,
    });
    const execution = await claim(persistence, job);

    expect(claimExecution).toHaveBeenCalledWith({
      organizationId: job.organizationId,
      projectId: job.projectId,
      crawlId: job.crawlId,
      queueJobId: job.crawlId,
      requestedByMembershipId: job.requestedByMembershipId,
      traceId: job.traceId,
      idempotencyKey: job.idempotencyKey,
      estimatedPages: job.estimatedPages,
      leaseMs: 45_000,
    });
    expect(execution).toMatchObject({
      organizationId: job.organizationId,
      projectId: job.projectId,
      crawlId: job.crawlId,
      configuration: storedClaim.kind === "claimed" ? storedClaim.crawl.config : undefined,
    });
    expect(persistence.initialCountersFor(execution)).toEqual(INITIAL_COUNTERS);

    await persistence.isCancellationRequested(execution);
    await persistence.renewExecutionLease(execution);
    await persistence.recordProgress(execution, UPDATED_COUNTERS);
    expect(persistence.executionLeaseHeartbeatMs).toBe(15_000);
    expect(isCancellationRequested).toHaveBeenCalledWith(
      job.organizationId,
      job.projectId,
      job.crawlId,
      storedClaim.kind === "claimed" ? storedClaim.executionToken : undefined,
    );
    expect(recordExecutionProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
        executionToken: storedClaim.kind === "claimed" ? storedClaim.executionToken : undefined,
      }),
      UPDATED_COUNTERS,
      45_000,
    );
    expect(renewExecutionLease).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
        executionToken: storedClaim.kind === "claimed" ? storedClaim.executionToken : undefined,
      }),
      45_000,
    );

    await Promise.all([persistence.close(), persistence.close()]);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ["busy", { state: "busy", retryAfterMs: 1_000 }],
    ["terminal", { state: "terminal" }],
    ["cancelled", { state: "cancelled" }],
  ] as const)(
    "maps a %s repository claim without losing lease state",
    async (repositoryState, expected) => {
      const job = executeJob();
      const claimExecution = vi.fn(async (): Promise<WorkerExecutionClaim> => {
        if (repositoryState === "busy") return { kind: "busy", retryAfterMs: 1_000 };
        if (repositoryState === "terminal") return { kind: "terminal", status: "completed" };
        return { kind: "cancelled" };
      });
      const repository = fakeRepository({ claimExecution });
      const persistence = new DatabaseCrawlProcessingPersistence(
        repository,
        fakeRuntime(repository).runtime,
        { crawlExecutionLeaseMs: 30_000 },
      );

      await expect(
        persistence.claimExecution({ contract: job, queueJobId: job.crawlId, attempt: 1 }),
      ).resolves.toEqual(expected);
    },
  );

  it("fails closed when PostgreSQL refuses an execution lease renewal", async () => {
    const job = executeJob();
    const storedClaim = claimedExecution(job);
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => storedClaim),
      renewExecutionLease: vi.fn(async () => false),
    });
    const persistence = new DatabaseCrawlProcessingPersistence(
      repository,
      fakeRuntime(repository).runtime,
      { crawlExecutionLeaseMs: 30_000 },
    );
    const execution = await claim(persistence, job);

    await expect(persistence.renewExecutionLease(execution)).rejects.toThrow(
      "execution lease is no longer active",
    );
  });

  it("reconciles pre-claim failures with the complete tenant and queue contract", async () => {
    const job = executeJob();
    const reconcilePreClaimFailure = vi.fn(async () => ({
      kind: "failed" as const,
      status: "failed" as const,
    }));
    const repository = fakeRepository({ reconcilePreClaimFailure });
    const persistence = new DatabaseCrawlProcessingPersistence(
      repository,
      fakeRuntime(repository).runtime,
      { crawlExecutionLeaseMs: 30_000 },
    );

    await expect(
      persistence.recordPreClaimFailure({
        contract: job,
        queueJobId: job.crawlId,
        attempt: 4,
        errorType: "crawl_worker_error",
        errorMessage: "The crawl worker could not complete this attempt.",
        terminal: true,
      }),
    ).resolves.toEqual({ state: "failed", finalStatus: "failed" });
    expect(reconcilePreClaimFailure).toHaveBeenCalledWith({
      organizationId: job.organizationId,
      projectId: job.projectId,
      crawlId: job.crawlId,
      queueJobId: job.crawlId,
      requestedByMembershipId: job.requestedByMembershipId,
      traceId: job.traceId,
      idempotencyKey: job.idempotencyKey,
      estimatedPages: job.estimatedPages,
      attemptsMade: 4,
      errorType: "crawl_worker_error",
      errorMessage: "The crawl worker could not complete this attempt.",
      terminal: true,
    });
  });

  it("persists progress before completion and cancellation with the active lease", async () => {
    const job = executeJob();
    const storedClaim = claimedExecution(job);
    const events: string[] = [];
    const recordExecutionProgress = vi.fn(async () => {
      events.push("progress");
    });
    const completeExecution = vi.fn(async (_context, input) => {
      events.push(`complete:${input.status}`);
    });
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => storedClaim),
      recordExecutionProgress,
      completeExecution,
    });
    const persistence = new DatabaseCrawlProcessingPersistence(
      repository,
      fakeRuntime(repository).runtime,
      { crawlExecutionLeaseMs: 30_000 },
    );
    const firstExecution = await claim(persistence, job);

    await persistence.recordCompletion(firstExecution, {
      status: "partially_completed",
      counters: UPDATED_COUNTERS,
    });
    expect(events).toEqual(["progress", "complete:partially_completed"]);
    expect(completeExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
        executionToken: storedClaim.kind === "claimed" ? storedClaim.executionToken : undefined,
      }),
      {
        status: "partially_completed",
        completionReason: "frontier_exhausted_with_failures",
      },
    );

    events.length = 0;
    const secondJob = executeJob();
    const secondClaim = claimedExecution(secondJob);
    const secondRepository = fakeRepository({
      claimExecution: vi.fn(async () => secondClaim),
      recordExecutionProgress,
      completeExecution,
    });
    const secondPersistence = new DatabaseCrawlProcessingPersistence(
      secondRepository,
      fakeRuntime(secondRepository).runtime,
      { crawlExecutionLeaseMs: 30_000 },
    );
    const secondExecution = await claim(secondPersistence, secondJob);
    await secondPersistence.recordCancellation(secondExecution, UPDATED_COUNTERS);

    expect(events).toEqual(["progress", "complete:cancelled"]);
    expect(completeExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: secondJob.organizationId,
        projectId: secondJob.projectId,
        crawlId: secondJob.crawlId,
        executionToken: secondClaim.kind === "claimed" ? secondClaim.executionToken : undefined,
      }),
      { status: "cancelled", completionReason: "cancelled_by_user" },
    );
  });

  it("releases transient failures and atomically finalizes exhausted failures with a DLQ intent", async () => {
    const job = executeJob();
    const storedClaim = claimedExecution(job);
    const releaseExecutionForRetry = vi.fn(async () => undefined);
    const completeExecution = vi.fn(async () => undefined);
    const recordDeadLetter = vi.fn(async () => undefined);
    const finalizeExecutionFailure = vi.fn(async () => "failed" as const);
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => storedClaim),
      releaseExecutionForRetry,
      completeExecution,
      finalizeExecutionFailure,
      recordDeadLetter,
    });
    const persistence = new DatabaseCrawlProcessingPersistence(
      repository,
      fakeRuntime(repository).runtime,
      { crawlExecutionLeaseMs: 30_000 },
    );
    const execution = await claim(persistence, job);

    await persistence.recordFailure(execution, {
      attempt: 1,
      errorType: "request_timeout",
      errorMessage: "The destination timed out.",
      retryable: true,
      terminal: false,
      finalStatus: null,
      deadLetter: null,
    });
    expect(releaseExecutionForRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
        executionToken: storedClaim.kind === "claimed" ? storedClaim.executionToken : undefined,
      }),
      "request_timeout",
      "The destination timed out.",
    );
    expect(completeExecution).not.toHaveBeenCalled();

    const dlq = deadLetter(job);
    await persistence.recordFailure(execution, {
      attempt: 4,
      errorType: dlq.errorType,
      errorMessage: dlq.errorMessage,
      retryable: true,
      terminal: true,
      finalStatus: "failed",
      deadLetter: dlq,
    });
    expect(finalizeExecutionFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
        executionToken: storedClaim.kind === "claimed" ? storedClaim.executionToken : undefined,
      }),
      {
        errorType: dlq.errorType,
        errorMessage: dlq.errorMessage,
        attemptsMade: dlq.attemptsMade,
        now: new Date(dlq.failedAt),
      },
    );
    expect(completeExecution).not.toHaveBeenCalled();
    expect(recordDeadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters rejected scope metadata and checkpoints shutdown as a retry", async () => {
    const job = executeJob();
    const storedClaim = claimedExecution(job);
    const recordDeadLetter = vi.fn(async () => undefined);
    const releaseExecutionForRetry = vi.fn(async () => undefined);
    const repository = fakeRepository({
      claimExecution: vi.fn(async () => storedClaim),
      recordDeadLetter,
      releaseExecutionForRetry,
    });
    const persistence = new DatabaseCrawlProcessingPersistence(
      repository,
      fakeRuntime(repository).runtime,
      { crawlExecutionLeaseMs: 30_000 },
    );
    const execution = await claim(persistence, job);
    const dlq = deadLetter(job);

    await persistence.recordRejectedScope({
      contract: job,
      queueJobId: job.crawlId,
      attempt: 1,
      errorType: "tenant_scope_mismatch",
      errorMessage: "The queued scope did not match.",
      deadLetter: dlq,
    });
    expect(recordDeadLetter).toHaveBeenCalledWith(
      {
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
      },
      expect.objectContaining({
        queueJobId: job.crawlId,
        attemptsMade: dlq.attemptsMade,
      }),
    );

    await persistence.checkpointInterruption(execution, {
      attempt: 2,
      reason: "worker-shutdown",
    });
    expect(releaseExecutionForRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
        executionToken: storedClaim.kind === "claimed" ? storedClaim.executionToken : undefined,
      }),
      "crawl_interrupted",
      "The worker shut down before the crawl completed.",
    );
  });

  it("rejects lease operations for executions that were not claimed by this adapter", async () => {
    const repository = fakeRepository();
    const persistence = new DatabaseCrawlProcessingPersistence(
      repository,
      fakeRuntime(repository).runtime,
      { crawlExecutionLeaseMs: 30_000 },
    );
    const job = executeJob();
    const foreignExecution: AuthorizedCrawlExecution = {
      organizationId: job.organizationId,
      projectId: job.projectId,
      crawlId: job.crawlId,
      configuration: crawlConfiguration(),
      initialCounters: INITIAL_COUNTERS,
    };

    expect(() => persistence.contextFor(foreignExecution)).toThrow("active database lease");
    expect(() => persistence.initialCountersFor(foreignExecution)).toThrow("active database lease");
  });
});
