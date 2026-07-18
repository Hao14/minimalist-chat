import { describe, expect, it } from "vitest";

import {
  CRAWL_JOB_CONTRACT_VERSION,
  crawlDeadLetterJobSchema,
  crawlExecuteJobSchema,
  crawlQueueJobSchema,
} from "../src/index.js";

function executionJob() {
  return {
    contractVersion: CRAWL_JOB_CONTRACT_VERSION,
    jobType: "crawl.execute" as const,
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    crawlId: crypto.randomUUID(),
    requestedByMembershipId: crypto.randomUUID(),
    traceId: "trace-12345678",
    idempotencyKey: "idempotency-12345678",
    createdAt: "2026-07-15T20:00:00.000Z",
    estimatedPages: 50,
  };
}

describe("crawl queue contracts", () => {
  it("parses the strict versioned execution contract", () => {
    expect(crawlExecuteJobSchema.parse(executionJob())).toMatchObject({
      jobType: "crawl.execute",
      contractVersion: 1,
      estimatedPages: 50,
    });
  });

  it("rejects unknown versions, fields, and credential-shaped identifiers", () => {
    expect(
      crawlExecuteJobSchema.safeParse({
        ...executionJob(),
        contractVersion: 2,
        authorization: "Bearer secret",
      }).success,
    ).toBe(false);
    expect(
      crawlExecuteJobSchema.safeParse({
        ...executionJob(),
        idempotencyKey: "unsafe:value",
      }).success,
    ).toBe(false);
  });

  it("parses a bounded terminal dead-letter contract", () => {
    const source = executionJob();
    expect(
      crawlDeadLetterJobSchema.parse({
        contractVersion: 1,
        jobType: "crawl.dead-letter",
        organizationId: source.organizationId,
        projectId: source.projectId,
        crawlId: source.crawlId,
        sourceJobId: source.crawlId,
        traceId: source.traceId,
        idempotencyKey: `dead-letter-${source.crawlId}`,
        finalStatus: "failed",
        attemptsMade: 4,
        errorType: "request_timeout",
        errorMessage: "The crawl exhausted its retry allowance.",
        failedAt: "2026-07-15T20:05:00.000Z",
      }),
    ).toMatchObject({ jobType: "crawl.dead-letter" });
  });

  it("discriminates queue contracts by job type", () => {
    expect(crawlQueueJobSchema.parse(executionJob()).jobType).toBe("crawl.execute");
  });
});
