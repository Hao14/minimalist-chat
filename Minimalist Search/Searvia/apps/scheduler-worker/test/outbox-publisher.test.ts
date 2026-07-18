import type { AuditEvaluateJob, CrawlExecuteJob } from "@searvia/shared-types";
import {
  CRAWL_QUEUE_NAME,
  crawlQueueNameForJob,
  type CrawlJobPublisher,
  type PublishedCrawlJob,
  type SearviaQueueJob,
} from "@searvia/job-queue";
import { describe, expect, it, vi } from "vitest";

import {
  CrawlOutboxDispatcher,
  type ClaimedCrawlOutboxJob,
  type CrawlOutboxPersistencePort,
} from "../src/outbox-publisher.js";

type RowStatus = "pending" | "publishing" | "published" | "dead_lettered";

interface MutableRow {
  id: string;
  job: SearviaQueueJob;
  payload: unknown;
  status: RowStatus;
  availableAt: Date;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  publishAttempt: number;
  queueJobId: string | null;
}

class FakeOutboxPort implements CrawlOutboxPersistencePort {
  readonly row: MutableRow;
  acknowledgementFailures = 0;

  constructor(job: SearviaQueueJob, payload: unknown = job) {
    this.row = {
      id: crypto.randomUUID(),
      job,
      payload,
      status: "pending",
      availableAt: new Date("2026-07-15T20:00:00.000Z"),
      leaseToken: null,
      leaseExpiresAt: null,
      publishAttempt: 0,
      queueJobId: null,
    };
  }

  async recoverExpiredLeases(now: Date): Promise<number> {
    if (
      this.row.status === "publishing" &&
      this.row.leaseExpiresAt !== null &&
      this.row.leaseExpiresAt <= now
    ) {
      this.row.status = "pending";
      this.row.leaseToken = null;
      this.row.leaseExpiresAt = null;
      return 1;
    }
    return 0;
  }

  async claimBatch(
    input: Readonly<{
      now: Date;
      leaseMs: number;
      limit: number;
      publisherId: string;
    }>,
  ): Promise<readonly ClaimedCrawlOutboxJob[]> {
    if (input.limit < 1 || this.row.status !== "pending" || this.row.availableAt > input.now) {
      return [];
    }
    this.row.status = "publishing";
    this.row.publishAttempt += 1;
    this.row.leaseToken = `${input.publisherId}-${this.row.publishAttempt}`;
    this.row.leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    return [
      {
        id: this.row.id,
        organizationId: this.row.job.organizationId,
        projectId: this.row.job.projectId,
        crawlId: this.row.job.crawlId,
        traceId: this.row.job.traceId,
        idempotencyKey: this.row.job.idempotencyKey,
        jobType: this.row.job.jobType,
        contractVersion: this.row.job.contractVersion,
        payload: this.row.payload,
        leaseToken: this.row.leaseToken,
        publishAttempt: this.row.publishAttempt,
      },
    ];
  }

  async markPublished(
    input: Readonly<{
      outboxId: string;
      leaseToken: string;
      queueJobId: string;
      publishedAt: Date;
    }>,
  ): Promise<void> {
    this.#assertLease(input.outboxId, input.leaseToken);
    if (this.acknowledgementFailures > 0) {
      this.acknowledgementFailures -= 1;
      throw new Error("Database acknowledgement unavailable");
    }
    this.row.status = "published";
    this.row.queueJobId = input.queueJobId;
    this.row.leaseToken = null;
    this.row.leaseExpiresAt = null;
  }

  async releaseForRetry(
    input: Readonly<{
      outboxId: string;
      leaseToken: string;
      availableAt: Date;
      errorType: string;
      errorMessage: string;
    }>,
  ): Promise<void> {
    this.#assertLease(input.outboxId, input.leaseToken);
    this.row.status = "pending";
    this.row.availableAt = input.availableAt;
    this.row.leaseToken = null;
    this.row.leaseExpiresAt = null;
  }

  async markDeadLettered(
    input: Readonly<{
      outboxId: string;
      leaseToken: string;
      failedAt: Date;
      errorType: string;
      errorMessage: string;
    }>,
  ): Promise<void> {
    this.#assertLease(input.outboxId, input.leaseToken);
    this.row.status = "dead_lettered";
    this.row.leaseToken = null;
    this.row.leaseExpiresAt = null;
  }

  #assertLease(outboxId: string, leaseToken: string): void {
    if (outboxId !== this.row.id || leaseToken !== this.row.leaseToken) {
      throw new Error("Stale outbox lease");
    }
  }
}

class FakePublisher implements CrawlJobPublisher {
  readonly published: SearviaQueueJob[] = [];
  failures = 0;

  async publish(job: SearviaQueueJob): Promise<PublishedCrawlJob> {
    this.published.push(job);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("Redis unavailable");
    }
    return {
      jobId: job.jobType === "audit.evaluate" ? job.idempotencyKey : job.crawlId,
      queueName: crawlQueueNameForJob(job),
    };
  }

  async waitUntilReady(): Promise<void> {}

  async close(): Promise<void> {}
}

function executionJob(): CrawlExecuteJob {
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

function auditJob(): AuditEvaluateJob {
  const crawlId = crypto.randomUUID();
  return {
    contractVersion: 1,
    jobType: "audit.evaluate",
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    crawlId,
    traceId: "trace-12345678",
    idempotencyKey: `audit-${crawlId}`,
    crawlStatus: "completed",
    crawlFinishedAt: "2026-07-16T17:00:00.000Z",
  };
}

describe("crawl outbox dispatcher", () => {
  it("leaves a claimed row leased when shutdown interrupts an accepted publish", async () => {
    const job = executionJob();
    const persistence = new FakeOutboxPort(job);
    let resolvePublish!: (value: PublishedCrawlJob) => void;
    const publisher: CrawlJobPublisher = {
      publish: vi.fn(
        () =>
          new Promise<PublishedCrawlJob>((resolve) => {
            resolvePublish = resolve;
          }),
      ),
      waitUntilReady: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const dispatcher = new CrawlOutboxDispatcher({
      persistence,
      publisher,
      configuration: {
        publisherId: "publisher-abort-1234",
        leaseMs: 1_000,
        batchSize: 10,
        maxPublishAttempts: 3,
      },
    });
    const abort = new AbortController();

    const dispatch = dispatcher.dispatchOnce(abort.signal);
    await vi.waitFor(() => expect(publisher.publish).toHaveBeenCalledOnce());
    abort.abort(new Error("scheduler-shutdown"));
    resolvePublish({ jobId: job.crawlId, queueName: CRAWL_QUEUE_NAME });

    await expect(dispatch).rejects.toThrow("scheduler-shutdown");
    expect(persistence.row).toMatchObject({
      status: "publishing",
      queueJobId: null,
      publishAttempt: 1,
    });
  });

  it("recovers a publisher crash after queue acceptance without duplicating logical work", async () => {
    const job = executionJob();
    const persistence = new FakeOutboxPort(job);
    persistence.acknowledgementFailures = 1;
    const publisher = new FakePublisher();
    let now = new Date("2026-07-15T20:00:00.000Z");
    const dispatcher = new CrawlOutboxDispatcher({
      persistence,
      publisher,
      configuration: {
        publisherId: "publisher-test-1234",
        leaseMs: 1_000,
        batchSize: 10,
        maxPublishAttempts: 3,
      },
      now: () => now,
      random: () => 0,
    });

    expect(await dispatcher.dispatchOnce()).toMatchObject({
      claimed: 1,
      published: 0,
      acknowledgementDeferred: 1,
    });
    expect(persistence.row.status).toBe("publishing");

    now = new Date(now.getTime() + 1_001);
    expect(await dispatcher.dispatchOnce()).toMatchObject({ recovered: 1, published: 1 });
    expect(persistence.row.status).toBe("published");
    expect(publisher.published.map((entry) => entry.crawlId)).toEqual([job.crawlId, job.crawlId]);
    expect(persistence.row.queueJobId).toBe(job.crawlId);
  });

  it("retries transient publication and dead-letters after the bounded allowance", async () => {
    const persistence = new FakeOutboxPort(executionJob());
    const publisher = new FakePublisher();
    publisher.failures = 2;
    let now = new Date("2026-07-15T20:00:00.000Z");
    const dispatcher = new CrawlOutboxDispatcher({
      persistence,
      publisher,
      configuration: {
        publisherId: "publisher-test-1234",
        leaseMs: 1_000,
        batchSize: 10,
        maxPublishAttempts: 2,
        retryBaseMs: 100,
        retryMaxMs: 100,
      },
      now: () => now,
      random: () => 1,
    });

    expect(await dispatcher.dispatchOnce()).toMatchObject({ retryScheduled: 1 });
    expect(persistence.row.status).toBe("pending");
    now = new Date(now.getTime() + 100);
    expect(await dispatcher.dispatchOnce()).toMatchObject({ deadLettered: 1 });
    expect(persistence.row.status).toBe("dead_lettered");
  });

  it("validates and publishes a durable audit evaluation intent", async () => {
    const job = auditJob();
    const persistence = new FakeOutboxPort(job);
    const publisher = new FakePublisher();
    const dispatcher = new CrawlOutboxDispatcher({
      persistence,
      publisher,
      configuration: {
        publisherId: "publisher-audit-1234",
        leaseMs: 1_000,
        batchSize: 10,
        maxPublishAttempts: 3,
      },
    });

    await expect(dispatcher.dispatchOnce()).resolves.toMatchObject({ published: 1 });
    expect(publisher.published).toEqual([job]);
    expect(persistence.row.queueJobId).toBe(job.idempotencyKey);
  });

  it.each(["job ID", "queue name"] as const)(
    "refuses to acknowledge an audit intent when the publisher returns the wrong %s",
    async (mismatch) => {
      const job = auditJob();
      const persistence = new FakeOutboxPort(job);
      const publisher: CrawlJobPublisher = {
        async publish(contract) {
          return {
            jobId: mismatch === "job ID" ? contract.crawlId : job.idempotencyKey,
            queueName:
              mismatch === "queue name" ? CRAWL_QUEUE_NAME : crawlQueueNameForJob(contract),
          };
        },
        async waitUntilReady() {},
        async close() {},
      };
      const dispatcher = new CrawlOutboxDispatcher({
        persistence,
        publisher,
        configuration: {
          publisherId: "publisher-routing-1234",
          leaseMs: 1_000,
          batchSize: 10,
          maxPublishAttempts: 3,
        },
        random: () => 0,
      });

      await expect(dispatcher.dispatchOnce()).resolves.toMatchObject({
        published: 0,
        retryScheduled: 1,
      });
      expect(persistence.row).toMatchObject({
        status: "pending",
        queueJobId: null,
        publishAttempt: 1,
      });
    },
  );

  it.each([
    ["organization", { organizationId: crypto.randomUUID() }],
    ["trace", { traceId: "trace-mismatched-12345678" }],
    ["idempotency", { idempotencyKey: "idempotency-mismatched-12345678" }],
  ])(
    "dead-letters malformed or cross-scope %s contracts before Redis publication",
    async (_, patch) => {
      const job = executionJob();
      const persistence = new FakeOutboxPort(job, {
        ...job,
        ...patch,
      });
      const publisher = new FakePublisher();
      const dispatcher = new CrawlOutboxDispatcher({
        persistence,
        publisher,
        configuration: {
          publisherId: "publisher-test-1234",
          leaseMs: 1_000,
          batchSize: 10,
          maxPublishAttempts: 2,
        },
      });

      expect(await dispatcher.dispatchOnce()).toMatchObject({ deadLettered: 1 });
      expect(publisher.published).toHaveLength(0);
      expect(persistence.row.status).toBe("dead_lettered");
    },
  );
});
