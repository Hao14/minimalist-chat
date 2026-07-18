import {
  AUDIT_JOB_CONTRACT_VERSION,
  CRAWL_JOB_CONTRACT_VERSION,
  auditEvaluateJobSchema,
  crawlQueueJobSchema,
} from "@searvia/shared-types";
import {
  crawlQueueJobId,
  crawlQueueNameForJob,
  type CrawlJobPublisher,
  type SearviaQueueJob,
} from "@searvia/job-queue";

export interface ClaimedCrawlOutboxJob {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly traceId: string;
  readonly idempotencyKey: string;
  readonly jobType: string;
  readonly contractVersion: number;
  readonly payload: unknown;
  readonly leaseToken: string;
  readonly publishAttempt: number;
}

export interface CrawlOutboxPersistencePort {
  recoverExpiredLeases(now: Date): Promise<number>;
  claimBatch(
    input: Readonly<{
      now: Date;
      leaseMs: number;
      limit: number;
      publisherId: string;
    }>,
  ): Promise<readonly ClaimedCrawlOutboxJob[]>;
  markPublished(
    input: Readonly<{
      outboxId: string;
      leaseToken: string;
      queueJobId: string;
      publishedAt: Date;
    }>,
  ): Promise<void>;
  releaseForRetry(
    input: Readonly<{
      outboxId: string;
      leaseToken: string;
      availableAt: Date;
      errorType: string;
      errorMessage: string;
    }>,
  ): Promise<void>;
  markDeadLettered(
    input: Readonly<{
      outboxId: string;
      leaseToken: string;
      failedAt: Date;
      errorType: string;
      errorMessage: string;
    }>,
  ): Promise<void>;
  close?(): Promise<void>;
}

export interface OutboxDispatchResult {
  readonly recovered: number;
  readonly claimed: number;
  readonly published: number;
  readonly retryScheduled: number;
  readonly deadLettered: number;
  readonly acknowledgementDeferred: number;
}

export interface OutboxDispatcherConfiguration {
  readonly publisherId: string;
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly maxPublishAttempts: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
}

export interface OutboxDispatcherDependencies {
  readonly persistence: CrawlOutboxPersistencePort;
  readonly publisher: CrawlJobPublisher;
  readonly configuration: OutboxDispatcherConfiguration;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly onError?: (error: unknown, outboxId: string | null) => void;
}

function validateConfiguration(
  configuration: OutboxDispatcherConfiguration,
): OutboxDispatcherConfiguration {
  if (configuration.publisherId.trim().length < 8 || configuration.publisherId.length > 128) {
    throw new RangeError("Outbox publisher ID must be between 8 and 128 characters.");
  }
  if (!Number.isInteger(configuration.leaseMs) || configuration.leaseMs < 1_000) {
    throw new RangeError("Outbox lease must be at least 1000 milliseconds.");
  }
  if (
    !Number.isInteger(configuration.batchSize) ||
    configuration.batchSize < 1 ||
    configuration.batchSize > 100
  ) {
    throw new RangeError("Outbox batch size must be between 1 and 100.");
  }
  if (
    !Number.isInteger(configuration.maxPublishAttempts) ||
    configuration.maxPublishAttempts < 1 ||
    configuration.maxPublishAttempts > 100
  ) {
    throw new RangeError("Outbox publish attempts must be between 1 and 100.");
  }
  return Object.freeze({ ...configuration });
}

function contractFor(row: ClaimedCrawlOutboxJob): SearviaQueueJob {
  const parsedAudit = auditEvaluateJobSchema.safeParse(row.payload);
  const parsed = parsedAudit.success ? parsedAudit.data : crawlQueueJobSchema.parse(row.payload);
  const expectedVersion =
    parsed.jobType === "audit.evaluate" ? AUDIT_JOB_CONTRACT_VERSION : CRAWL_JOB_CONTRACT_VERSION;
  if (
    row.contractVersion !== expectedVersion ||
    row.jobType !== parsed.jobType ||
    row.organizationId !== parsed.organizationId ||
    row.projectId !== parsed.projectId ||
    row.crawlId !== parsed.crawlId ||
    row.traceId !== parsed.traceId ||
    row.idempotencyKey !== parsed.idempotencyKey
  ) {
    throw new TypeError("Outbox metadata does not match its background job contract.");
  }
  return parsed;
}

export function outboxRetryDelayMs(
  attempt: number,
  input: Readonly<{ baseMs?: number; maxMs?: number; random?: () => number }> = {},
): number {
  const baseMs = input.baseMs ?? 500;
  const maxMs = input.maxMs ?? 60_000;
  const random = input.random ?? Math.random;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitterMultiplier = 0.5 + Math.min(1, Math.max(0, random())) * 0.5;
  return Math.max(100, Math.round(exponential * jitterMultiplier));
}

export class CrawlOutboxDispatcher {
  readonly #dependencies: OutboxDispatcherDependencies;
  readonly #configuration: OutboxDispatcherConfiguration;

  constructor(dependencies: OutboxDispatcherDependencies) {
    this.#dependencies = dependencies;
    this.#configuration = validateConfiguration(dependencies.configuration);
  }

  async dispatchOnce(signal?: AbortSignal): Promise<OutboxDispatchResult> {
    signal?.throwIfAborted();
    const now = this.#dependencies.now?.() ?? new Date();
    const recovered = await this.#dependencies.persistence.recoverExpiredLeases(now);
    signal?.throwIfAborted();
    const rows = await this.#dependencies.persistence.claimBatch({
      now,
      leaseMs: this.#configuration.leaseMs,
      limit: this.#configuration.batchSize,
      publisherId: this.#configuration.publisherId,
    });
    signal?.throwIfAborted();
    let published = 0;
    let retryScheduled = 0;
    let deadLettered = 0;
    let acknowledgementDeferred = 0;

    for (const row of rows) {
      signal?.throwIfAborted();
      let contract: SearviaQueueJob;
      try {
        contract = contractFor(row);
      } catch (error) {
        signal?.throwIfAborted();
        this.#dependencies.onError?.(error, row.id);
        await this.#dependencies.persistence.markDeadLettered({
          outboxId: row.id,
          leaseToken: row.leaseToken,
          failedAt: now,
          errorType: "invalid_job_contract",
          errorMessage: "The outbox record did not contain a valid background job contract.",
        });
        deadLettered += 1;
        continue;
      }

      let queueJobId: string;
      try {
        const published = await this.#dependencies.publisher.publish(contract);
        if (
          published.jobId !== crawlQueueJobId(contract) ||
          published.queueName !== crawlQueueNameForJob(contract)
        ) {
          throw new TypeError(
            "The queue publisher returned an unexpected deterministic job ID or queue name.",
          );
        }
        queueJobId = published.jobId;
        signal?.throwIfAborted();
      } catch (error) {
        signal?.throwIfAborted();
        this.#dependencies.onError?.(error, row.id);
        if (row.publishAttempt >= this.#configuration.maxPublishAttempts) {
          await this.#dependencies.persistence.markDeadLettered({
            outboxId: row.id,
            leaseToken: row.leaseToken,
            failedAt: now,
            errorType: "queue_publish_exhausted",
            errorMessage: "The queue publish retry allowance was exhausted.",
          });
          deadLettered += 1;
        } else {
          const delay = outboxRetryDelayMs(row.publishAttempt, {
            ...(this.#configuration.retryBaseMs === undefined
              ? {}
              : { baseMs: this.#configuration.retryBaseMs }),
            ...(this.#configuration.retryMaxMs === undefined
              ? {}
              : { maxMs: this.#configuration.retryMaxMs }),
            ...(this.#dependencies.random === undefined
              ? {}
              : { random: this.#dependencies.random }),
          });
          await this.#dependencies.persistence.releaseForRetry({
            outboxId: row.id,
            leaseToken: row.leaseToken,
            availableAt: new Date(now.getTime() + delay),
            errorType: "queue_publish_unavailable",
            errorMessage: "The background queue was temporarily unavailable.",
          });
          retryScheduled += 1;
        }
        continue;
      }

      try {
        await this.#dependencies.persistence.markPublished({
          outboxId: row.id,
          leaseToken: row.leaseToken,
          queueJobId,
          publishedAt: now,
        });
        published += 1;
      } catch (error) {
        signal?.throwIfAborted();
        // The queue accepted the deterministic job ID. Leaving the lease in place
        // makes a later publisher retry safely after lease recovery.
        this.#dependencies.onError?.(error, row.id);
        acknowledgementDeferred += 1;
      }
    }

    return Object.freeze({
      recovered,
      claimed: rows.length,
      published,
      retryScheduled,
      deadLettered,
      acknowledgementDeferred,
    });
  }
}
