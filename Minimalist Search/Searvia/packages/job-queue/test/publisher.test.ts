import {
  AUDIT_JOB_CONTRACT_VERSION,
  CRAWL_JOB_CONTRACT_VERSION,
  type AuditEvaluateJob,
  type CrawlDeadLetterJob,
  type CrawlExecuteJob,
} from "@searvia/shared-types";
import type { JobsOptions } from "bullmq";
import { describe, expect, it } from "vitest";

import {
  AUDIT_QUEUE_NAME,
  CRAWL_DEAD_LETTER_QUEUE_NAME,
  CRAWL_QUEUE_NAME,
  PortBackedCrawlJobPublisher,
  type QueueAddPort,
} from "../src/index.js";

class FakeQueue<
  TJob extends CrawlExecuteJob | CrawlDeadLetterJob | AuditEvaluateJob,
> implements QueueAddPort<TJob> {
  readonly added: Array<{ name: TJob["jobType"]; data: TJob; options: JobsOptions }> = [];
  readyCount = 0;
  closeCount = 0;

  async add(name: TJob["jobType"], data: TJob, options: JobsOptions): Promise<void> {
    this.added.push({ name, data, options });
  }

  async waitUntilReady(): Promise<void> {
    this.readyCount += 1;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

function auditJob(crawlId = crypto.randomUUID()): AuditEvaluateJob {
  return {
    contractVersion: AUDIT_JOB_CONTRACT_VERSION,
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

function executeJob(crawlId = crypto.randomUUID()): CrawlExecuteJob {
  return {
    contractVersion: CRAWL_JOB_CONTRACT_VERSION,
    jobType: "crawl.execute",
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    crawlId,
    requestedByMembershipId: crypto.randomUUID(),
    traceId: "trace-12345678",
    idempotencyKey: "idempotency-12345678",
    createdAt: "2026-07-15T20:00:00.000Z",
    estimatedPages: 25,
  };
}

describe("crawl job publisher", () => {
  it("routes audit evaluation with a crawl-distinct deterministic job ID", async () => {
    const executionQueue = new FakeQueue<CrawlExecuteJob>();
    const auditQueue = new FakeQueue<AuditEvaluateJob>();
    const deadLetterQueue = new FakeQueue<CrawlDeadLetterJob>();
    const publisher = new PortBackedCrawlJobPublisher(
      executionQueue,
      deadLetterQueue,
      { attempts: 3, backoffMs: 500, jitter: 0.25 },
      auditQueue,
    );
    const audit = auditJob();

    await expect(publisher.publish(audit)).resolves.toEqual({
      jobId: audit.idempotencyKey,
      queueName: AUDIT_QUEUE_NAME,
    });
    expect(auditQueue.added).toHaveLength(1);
    expect(auditQueue.added[0]?.options.jobId).toBe(audit.idempotencyKey);
    expect(executionQueue.added).toHaveLength(0);
    expect(deadLetterQueue.added).toHaveLength(0);
  });

  it("owns readiness and shutdown for every distinct durable queue", async () => {
    const executionQueue = new FakeQueue<CrawlExecuteJob>();
    const auditQueue = new FakeQueue<AuditEvaluateJob>();
    const deadLetterQueue = new FakeQueue<CrawlDeadLetterJob>();
    const publisher = new PortBackedCrawlJobPublisher(
      executionQueue,
      deadLetterQueue,
      { attempts: 3, backoffMs: 500, jitter: 0.25 },
      auditQueue,
    );

    await publisher.waitUntilReady();
    await publisher.close();

    expect([executionQueue.readyCount, auditQueue.readyCount, deadLetterQueue.readyCount]).toEqual([
      1, 1, 1,
    ]);
    expect([executionQueue.closeCount, auditQueue.closeCount, deadLetterQueue.closeCount]).toEqual([
      1, 1, 1,
    ]);
  });

  it("publishes duplicate deliveries with the same deterministic job ID", async () => {
    const executionQueue = new FakeQueue<CrawlExecuteJob>();
    const deadLetterQueue = new FakeQueue<CrawlDeadLetterJob>();
    const publisher = new PortBackedCrawlJobPublisher(executionQueue, deadLetterQueue, {
      attempts: 3,
      backoffMs: 500,
      jitter: 0.25,
    });
    const job = executeJob();

    const first = await publisher.publish(job);
    const duplicate = await publisher.publish(job);

    expect(first).toEqual({ jobId: job.crawlId, queueName: CRAWL_QUEUE_NAME });
    expect(duplicate).toEqual(first);
    expect(executionQueue.added).toHaveLength(2);
    expect(executionQueue.added.map((entry) => entry.options.jobId)).toEqual([
      job.crawlId,
      job.crawlId,
    ]);
    expect(deadLetterQueue.added).toHaveLength(0);
  });

  it("routes terminal records to the dead-letter queue", async () => {
    const executionQueue = new FakeQueue<CrawlExecuteJob>();
    const deadLetterQueue = new FakeQueue<CrawlDeadLetterJob>();
    const publisher = new PortBackedCrawlJobPublisher(executionQueue, deadLetterQueue, {
      attempts: 4,
      backoffMs: 1_000,
      jitter: 0.5,
    });
    const execution = executeJob();
    const deadLetter: CrawlDeadLetterJob = {
      contractVersion: 1,
      jobType: "crawl.dead-letter",
      organizationId: execution.organizationId,
      projectId: execution.projectId,
      crawlId: execution.crawlId,
      sourceJobId: execution.crawlId,
      traceId: execution.traceId,
      idempotencyKey: `dead-letter-${execution.crawlId}`,
      finalStatus: "failed",
      attemptsMade: 4,
      errorType: "request_timeout",
      errorMessage: "The crawl exhausted its retry allowance.",
      failedAt: "2026-07-15T20:05:00.000Z",
    };

    expect(await publisher.publish(deadLetter)).toEqual({
      jobId: execution.crawlId,
      queueName: CRAWL_DEAD_LETTER_QUEUE_NAME,
    });
    expect(deadLetterQueue.added).toHaveLength(1);
    expect(executionQueue.added).toHaveLength(0);
  });
});
