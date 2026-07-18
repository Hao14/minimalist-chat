import {
  AUDIT_JOB_CONTRACT_VERSION,
  CRAWL_JOB_CONTRACT_VERSION,
  type AuditEvaluateJob,
  type CrawlDeadLetterJob,
  type CrawlExecuteJob,
} from "@searvia/shared-types";
import { describe, expect, it } from "vitest";

import {
  AUDIT_QUEUE_JOB_NAMES,
  AUDIT_QUEUE_NAME,
  AUDIT_QUEUE_VERSION,
  CRAWL_DEAD_LETTER_QUEUE_NAME,
  CRAWL_QUEUE_JOB_NAMES,
  CRAWL_QUEUE_NAME,
  crawlQueueJobId,
  crawlQueueNameForJob,
  crawlQueueOptionsForJob,
  producerRedisOptions,
  workerRedisOptions,
} from "../src/index.js";

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

describe("BullMQ crawl queue contracts", () => {
  it("uses the crawl UUID as a stable colon-free duplicate-suppression ID", () => {
    const crawlId = crypto.randomUUID();
    expect(crawlQueueJobId(executeJob(crawlId))).toBe(crawlId);
    expect(crawlQueueJobId(executeJob(crawlId))).not.toContain(":");
  });

  it("uses a separate versioned durable queue and stable audit job ID", () => {
    const crawlId = crypto.randomUUID();
    const audit = auditJob(crawlId);
    expect(crawlQueueJobId(audit)).toBe(`audit-${crawlId}`);
    expect(AUDIT_QUEUE_VERSION).toBe(1);
    expect(AUDIT_QUEUE_VERSION).toBe(AUDIT_JOB_CONTRACT_VERSION);
    expect(AUDIT_QUEUE_NAME).toBe("searvia-audit-v1");
    expect(crawlQueueNameForJob(audit)).toBe(AUDIT_QUEUE_NAME);
    expect(AUDIT_QUEUE_NAME).not.toBe(CRAWL_QUEUE_NAME);
    expect(CRAWL_QUEUE_JOB_NAMES).not.toHaveProperty("audit");
    expect(AUDIT_QUEUE_JOB_NAMES).toEqual({ evaluate: "audit.evaluate" });
    expect(crawlQueueOptionsForJob(audit)).toMatchObject({
      attempts: 4,
      jobId: `audit-${crawlId}`,
    });
  });

  it("applies bounded exponential retry with jitter only to execution jobs", () => {
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

    expect(crawlQueueOptionsForJob(execution)).toMatchObject({
      attempts: 4,
      jobId: execution.crawlId,
      backoff: { type: "exponential", delay: 1_000, jitter: 0.5 },
    });
    expect(crawlQueueOptionsForJob(deadLetter)).toMatchObject({
      attempts: 1,
      jobId: execution.crawlId,
    });
    expect(crawlQueueNameForJob(execution)).toBe(CRAWL_QUEUE_NAME);
    expect(crawlQueueNameForJob(deadLetter)).toBe(CRAWL_DEAD_LETTER_QUEUE_NAME);
  });

  it("uses fail-fast producers and persistent worker Redis commands", () => {
    expect(producerRedisOptions(5_000)).toMatchObject({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    expect(workerRedisOptions(5_000)).toMatchObject({ maxRetriesPerRequest: null });
  });
});
