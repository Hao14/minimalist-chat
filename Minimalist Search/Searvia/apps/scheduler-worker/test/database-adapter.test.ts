import type {
  CrawlWorkerRepository,
  WorkerClaimedOutboxRecord,
  WorkerDatabaseRuntime,
} from "@searvia/database/workers";
import { describe, expect, it, vi } from "vitest";

import { createDatabaseOutboxPersistence } from "../src/database-adapter.js";

function claimedOutboxRecord(): WorkerClaimedOutboxRecord {
  const crawlId = crypto.randomUUID();
  const payload = Object.freeze({
    contractVersion: 1,
    jobType: "crawl.execute",
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    crawlId,
    requestedByMembershipId: crypto.randomUUID(),
    traceId: "trace-outbox-adapter-12345678",
    idempotencyKey: "idempotency-outbox-adapter-12345678",
    createdAt: "2026-07-15T20:00:00.000Z",
    estimatedPages: 25,
  });
  return Object.freeze({
    id: crypto.randomUUID(),
    jobType: "crawl.execute",
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    crawlId,
    idempotencyKey: payload.idempotencyKey,
    traceId: payload.traceId,
    contractVersion: 1,
    payload,
    publishAttemptCount: 2,
    claimToken: crypto.randomUUID(),
    leaseExpiresAt: new Date("2026-07-15T20:01:00.000Z"),
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
      throw new Error("Audit snapshot loading is not used by this scheduler test.");
    }),
    hasTerminalAuditEvaluationRun: vi.fn(async () => false),
    persistAuditEvaluationReport: vi.fn(async () => {
      throw new Error("Audit report persistence is not used by this scheduler test.");
    }),
    checkHealth: vi.fn(async () => Object.freeze({ latencyMs: 1, status: "ok" as const })),
    close,
  };
  return { close, runtime };
}

describe("scheduler database outbox adapter", () => {
  it("maps lease recovery, claim bounds, payload metadata, and publisher acknowledgements", async () => {
    const row = claimedOutboxRecord();
    const recoverExpiredOutboxLeases = vi.fn(async () => 3);
    const claimOutboxBatch = vi.fn(async () => [row]);
    const markOutboxPublished = vi.fn(async () => true);
    const repository = fakeRepository({
      recoverExpiredOutboxLeases,
      claimOutboxBatch,
      markOutboxPublished,
    });
    const { close, runtime } = fakeRuntime(repository);
    const persistence = createDatabaseOutboxPersistence(repository, runtime);
    const now = new Date("2026-07-15T20:00:00.000Z");

    await expect(persistence.recoverExpiredLeases(now)).resolves.toBe(3);
    await expect(
      persistence.claimBatch({
        now,
        leaseMs: 45_000,
        limit: 20,
        publisherId: "publisher-adapter-1234",
      }),
    ).resolves.toEqual([
      {
        id: row.id,
        organizationId: row.organizationId,
        projectId: row.projectId,
        crawlId: row.crawlId,
        traceId: row.traceId,
        idempotencyKey: row.idempotencyKey,
        jobType: row.jobType,
        contractVersion: row.contractVersion,
        payload: row.payload,
        leaseToken: row.claimToken,
        publishAttempt: row.publishAttemptCount,
      },
    ]);
    expect(recoverExpiredOutboxLeases).toHaveBeenCalledWith(now);
    expect(claimOutboxBatch).toHaveBeenCalledWith({
      limit: 20,
      leaseMs: 45_000,
      now,
    });

    const publishedAt = new Date("2026-07-15T20:00:05.000Z");
    await persistence.markPublished({
      outboxId: row.id,
      leaseToken: row.claimToken,
      queueJobId: row.crawlId,
      publishedAt,
    });
    expect(markOutboxPublished).toHaveBeenCalledWith(
      row.id,
      row.claimToken,
      row.crawlId,
      publishedAt,
    );

    await Promise.all([persistence.close?.(), persistence.close?.()]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("maps retry and terminal publication failures to token-guarded outbox releases", async () => {
    const row = claimedOutboxRecord();
    const releaseOutboxClaim = vi.fn(async () => true);
    const repository = fakeRepository({ releaseOutboxClaim });
    const persistence = createDatabaseOutboxPersistence(
      repository,
      fakeRuntime(repository).runtime,
    );
    const availableAt = new Date("2026-07-15T20:00:10.000Z");

    await persistence.releaseForRetry({
      outboxId: row.id,
      leaseToken: row.claimToken,
      availableAt,
      errorType: "queue_publish_unavailable",
      errorMessage: "The queue was temporarily unavailable.",
    });
    expect(releaseOutboxClaim).toHaveBeenNthCalledWith(1, {
      outboxId: row.id,
      claimToken: row.claimToken,
      errorMessage: "queue_publish_unavailable: The queue was temporarily unavailable.",
      retryAt: availableAt,
      terminal: false,
    });

    const failedAt = new Date("2026-07-15T20:01:00.000Z");
    await persistence.markDeadLettered({
      outboxId: row.id,
      leaseToken: row.claimToken,
      failedAt,
      errorType: "queue_publish_exhausted",
      errorMessage: "The queue publish retry allowance was exhausted.",
    });
    expect(releaseOutboxClaim).toHaveBeenNthCalledWith(2, {
      outboxId: row.id,
      claimToken: row.claimToken,
      errorMessage: "queue_publish_exhausted: The queue publish retry allowance was exhausted.",
      retryAt: failedAt,
      terminal: true,
      now: failedAt,
    });
  });

  it.each([
    ["publish acknowledgement", "markPublished"],
    ["retry release", "releaseForRetry"],
    ["dead-letter acknowledgement", "markDeadLettered"],
  ] as const)("fails closed when the %s lease token is stale", async (message, operation) => {
    const row = claimedOutboxRecord();
    const repository = fakeRepository({
      markOutboxPublished: vi.fn(async () => false),
      releaseOutboxClaim: vi.fn(async () => false),
    });
    const persistence = createDatabaseOutboxPersistence(
      repository,
      fakeRuntime(repository).runtime,
    );
    const now = new Date("2026-07-15T20:00:00.000Z");

    const action =
      operation === "markPublished"
        ? persistence.markPublished({
            outboxId: row.id,
            leaseToken: row.claimToken,
            queueJobId: row.crawlId,
            publishedAt: now,
          })
        : operation === "releaseForRetry"
          ? persistence.releaseForRetry({
              outboxId: row.id,
              leaseToken: row.claimToken,
              availableAt: now,
              errorType: "queue_publish_unavailable",
              errorMessage: "Queue unavailable.",
            })
          : persistence.markDeadLettered({
              outboxId: row.id,
              leaseToken: row.claimToken,
              failedAt: now,
              errorType: "queue_publish_exhausted",
              errorMessage: "Queue publish exhausted.",
            });

    await expect(action).rejects.toThrow(message);
  });
});
