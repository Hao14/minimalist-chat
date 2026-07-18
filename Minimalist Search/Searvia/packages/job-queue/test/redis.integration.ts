import {
  AUDIT_JOB_CONTRACT_VERSION,
  CRAWL_JOB_CONTRACT_VERSION,
  type AuditEvaluateJob,
  type CrawlExecuteJob,
} from "@searvia/shared-types";
import { expect, test } from "vitest";

import {
  AUDIT_QUEUE_NAME,
  CRAWL_QUEUE_NAME,
  createBullMqAuditWorker,
  createBullMqCrawlJobPublisher,
  createBullMqCrawlWorker,
} from "../src/index.js";

test("durable crawl and audit jobs remain isolated on real BullMQ queues", async () => {
  const redisUrl = process.env.REDIS_INTEGRATION_URL;
  if (redisUrl === undefined) {
    throw new Error(
      "REDIS_INTEGRATION_URL is required. This explicit integration suite never skips silently.",
    );
  }

  const crawlId = crypto.randomUUID();
  const prefix = `searvia-integration-${crawlId}`;
  let received: CrawlExecuteJob | undefined;
  let receivedAudit: AuditEvaluateJob | undefined;
  let resolveReceived: (() => void) | undefined;
  const receivedPromise = new Promise<void>((resolve) => {
    resolveReceived = resolve;
  });
  let resolveAuditReceived: (() => void) | undefined;
  const auditReceivedPromise = new Promise<void>((resolve) => {
    resolveAuditReceived = resolve;
  });
  const crawlWorker = createBullMqCrawlWorker({
    redisUrl,
    redisConnectTimeoutMs: 5_000,
    queuePrefix: prefix,
    concurrency: 1,
    handler: async (job) => {
      received = job;
      resolveReceived?.();
    },
  });
  const auditWorker = createBullMqAuditWorker({
    redisUrl,
    redisConnectTimeoutMs: 5_000,
    queuePrefix: prefix,
    concurrency: 1,
    handler: async (job) => {
      receivedAudit = job;
      resolveAuditReceived?.();
    },
  });
  const publisher = createBullMqCrawlJobPublisher({
    redisUrl,
    redisConnectTimeoutMs: 5_000,
    queuePrefix: prefix,
    retryPolicy: { attempts: 2, backoffMs: 100, jitter: 0 },
  });

  try {
    await crawlWorker.start();
    await publisher.waitUntilReady();
    const publishedCrawl = await publisher.publish({
      contractVersion: CRAWL_JOB_CONTRACT_VERSION,
      jobType: "crawl.execute",
      organizationId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      crawlId,
      requestedByMembershipId: crypto.randomUUID(),
      traceId: "trace-integration-1234",
      idempotencyKey: `integration-${crawlId}`,
      createdAt: new Date().toISOString(),
      estimatedPages: 1,
    });
    const crawlFinishedAt = new Date().toISOString();
    const publishedAudit = await publisher.publish({
      contractVersion: AUDIT_JOB_CONTRACT_VERSION,
      jobType: "audit.evaluate",
      organizationId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      crawlId,
      traceId: "trace-integration-1234",
      idempotencyKey: `audit-${crawlId}`,
      crawlStatus: "completed",
      crawlFinishedAt,
    });
    expect(publishedCrawl.queueName).toBe(CRAWL_QUEUE_NAME);
    expect(publishedAudit.queueName).toBe(AUDIT_QUEUE_NAME);

    await Promise.race([
      receivedPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for the crawl worker.")), 10_000);
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(receivedAudit).toBeUndefined();

    await auditWorker.start();
    await Promise.race([
      auditReceivedPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for the audit worker.")), 10_000);
      }),
    ]);

    expect(received?.crawlId).toBe(crawlId);
    expect(receivedAudit).toMatchObject({
      crawlId,
      idempotencyKey: `audit-${crawlId}`,
      crawlFinishedAt,
    });
  } finally {
    await publisher.close();
    await Promise.all([crawlWorker.close(true), auditWorker.close(true)]);
  }
});
