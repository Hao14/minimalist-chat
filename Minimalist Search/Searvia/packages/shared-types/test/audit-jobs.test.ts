import { describe, expect, it } from "vitest";

import { AUDIT_JOB_CONTRACT_VERSION, auditEvaluateJobSchema } from "../src/index.js";

function auditJob(crawlId = crypto.randomUUID()) {
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
  } as const;
}

describe("audit evaluation job contract", () => {
  it("accepts the versioned terminal-crawl contract", () => {
    expect(auditEvaluateJobSchema.parse(auditJob())).toMatchObject({
      contractVersion: 1,
      jobType: "audit.evaluate",
      crawlStatus: "completed",
    });
  });

  it("rejects non-terminal status and non-deterministic idempotency", () => {
    expect(auditEvaluateJobSchema.safeParse({ ...auditJob(), crawlStatus: "failed" }).success).toBe(
      false,
    );
    expect(
      auditEvaluateJobSchema.safeParse({ ...auditJob(), idempotencyKey: "audit-another-crawl" })
        .success,
    ).toBe(false);
  });

  it("rejects additional unversioned fields", () => {
    expect(
      auditEvaluateJobSchema.safeParse({ ...auditJob(), secret: "must-not-cross" }).success,
    ).toBe(false);
  });

  it("rejects control characters and non-identifier trace punctuation", () => {
    expect(
      auditEvaluateJobSchema.safeParse({
        ...auditJob(),
        traceId: "trace-safe\nforged-log-entry",
      }).success,
    ).toBe(false);
    expect(
      auditEvaluateJobSchema.safeParse({
        ...auditJob(),
        traceId: "trace://not-an-identifier",
      }).success,
    ).toBe(false);
  });
});
