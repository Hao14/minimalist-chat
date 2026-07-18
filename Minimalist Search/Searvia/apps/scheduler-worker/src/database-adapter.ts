import type { CrawlWorkerRepository, WorkerDatabaseRuntime } from "@searvia/database/workers";

import type { ClaimedCrawlOutboxJob, CrawlOutboxPersistencePort } from "./outbox-publisher.js";

function requireAcknowledged(value: boolean, operation: string): void {
  if (!value) {
    throw new Error(`The outbox ${operation} was rejected because its lease is no longer active.`);
  }
}

export function createDatabaseOutboxPersistence(
  repository: CrawlWorkerRepository,
  databaseRuntime: WorkerDatabaseRuntime,
): CrawlOutboxPersistencePort {
  let closePromise: Promise<void> | undefined;

  return Object.freeze({
    recoverExpiredLeases: (now: Date) => repository.recoverExpiredOutboxLeases(now),
    async claimBatch(
      input: Parameters<CrawlOutboxPersistencePort["claimBatch"]>[0],
    ): Promise<readonly ClaimedCrawlOutboxJob[]> {
      const rows = await repository.claimOutboxBatch({
        limit: input.limit,
        leaseMs: input.leaseMs,
        now: input.now,
      });
      return rows.map((row) =>
        Object.freeze({
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
        }),
      );
    },
    async markPublished(input: Parameters<CrawlOutboxPersistencePort["markPublished"]>[0]) {
      requireAcknowledged(
        await repository.markOutboxPublished(
          input.outboxId,
          input.leaseToken,
          input.queueJobId,
          input.publishedAt,
        ),
        "publish acknowledgement",
      );
    },
    async releaseForRetry(input: Parameters<CrawlOutboxPersistencePort["releaseForRetry"]>[0]) {
      requireAcknowledged(
        await repository.releaseOutboxClaim({
          outboxId: input.outboxId,
          claimToken: input.leaseToken,
          errorMessage: `${input.errorType}: ${input.errorMessage}`,
          retryAt: input.availableAt,
          terminal: false,
        }),
        "retry release",
      );
    },
    async markDeadLettered(input: Parameters<CrawlOutboxPersistencePort["markDeadLettered"]>[0]) {
      requireAcknowledged(
        await repository.releaseOutboxClaim({
          outboxId: input.outboxId,
          claimToken: input.leaseToken,
          errorMessage: `${input.errorType}: ${input.errorMessage}`,
          retryAt: input.failedAt,
          terminal: true,
          now: input.failedAt,
        }),
        "dead-letter acknowledgement",
      );
    },
    close() {
      closePromise ??= databaseRuntime.close();
      return closePromise;
    },
  });
}
