import {
  AUDIT_EVALUATE_JOB_TYPE,
  CRAWL_DEAD_LETTER_JOB_TYPE,
  CRAWL_EXECUTE_JOB_TYPE,
  auditEvaluateJobSchema,
  crawlQueueJobSchema,
  type AuditEvaluateJob,
  type CrawlQueueJob,
} from "@searvia/shared-types";
import type { JobsOptions } from "bullmq";

export const CRAWL_QUEUE_NAME = "searvia-crawl-v1" as const;
export const CRAWL_DEAD_LETTER_QUEUE_NAME = "searvia-crawl-dead-letter-v1" as const;
export const AUDIT_QUEUE_VERSION = 1 as const;
export const AUDIT_QUEUE_NAME = "searvia-audit-v1" as const;

export type SearviaQueueName =
  typeof CRAWL_QUEUE_NAME | typeof CRAWL_DEAD_LETTER_QUEUE_NAME | typeof AUDIT_QUEUE_NAME;

export type SearviaQueueJob = CrawlQueueJob | AuditEvaluateJob;

export function parseSearviaQueueJob(job: unknown): SearviaQueueJob {
  const audit = auditEvaluateJobSchema.safeParse(job);
  return audit.success ? audit.data : crawlQueueJobSchema.parse(job);
}

export interface CrawlJobRetryPolicy {
  readonly attempts: number;
  readonly backoffMs: number;
  readonly jitter: number;
}

export const DEFAULT_CRAWL_JOB_RETRY_POLICY: CrawlJobRetryPolicy = Object.freeze({
  attempts: 4,
  backoffMs: 1_000,
  jitter: 0.5,
});

export function validateCrawlJobRetryPolicy(policy: CrawlJobRetryPolicy): CrawlJobRetryPolicy {
  if (!Number.isInteger(policy.attempts) || policy.attempts < 1 || policy.attempts > 10) {
    throw new RangeError("Crawl job attempts must be between 1 and 10.");
  }

  if (!Number.isInteger(policy.backoffMs) || policy.backoffMs < 100 || policy.backoffMs > 60_000) {
    throw new RangeError("Crawl job backoff must be between 100 and 60000 milliseconds.");
  }

  if (!Number.isFinite(policy.jitter) || policy.jitter < 0 || policy.jitter > 1) {
    throw new RangeError("Crawl job jitter must be between 0 and 1.");
  }

  return Object.freeze({ ...policy });
}

export function crawlQueueJobId(job: SearviaQueueJob): string {
  const parsed = parseSearviaQueueJob(job);
  return parsed.jobType === AUDIT_EVALUATE_JOB_TYPE ? parsed.idempotencyKey : parsed.crawlId;
}

export function crawlQueueNameForJob(job: SearviaQueueJob): SearviaQueueName {
  if (job.jobType === AUDIT_EVALUATE_JOB_TYPE) return AUDIT_QUEUE_NAME;
  return job.jobType === CRAWL_DEAD_LETTER_JOB_TYPE
    ? CRAWL_DEAD_LETTER_QUEUE_NAME
    : CRAWL_QUEUE_NAME;
}

export function crawlQueueOptionsForJob(
  job: SearviaQueueJob,
  retryPolicy: CrawlJobRetryPolicy = DEFAULT_CRAWL_JOB_RETRY_POLICY,
): JobsOptions {
  const parsed = parseSearviaQueueJob(job);
  const policy = validateCrawlJobRetryPolicy(retryPolicy);

  if (parsed.jobType === CRAWL_DEAD_LETTER_JOB_TYPE) {
    return {
      attempts: 1,
      jobId: parsed.crawlId,
      removeOnComplete: { age: 604_800, count: 10_000 },
      removeOnFail: false,
    };
  }

  return {
    attempts: policy.attempts,
    backoff: {
      type: "exponential",
      delay: policy.backoffMs,
      jitter: policy.jitter,
    },
    jobId: crawlQueueJobId(parsed),
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: false,
  };
}

export const CRAWL_QUEUE_JOB_NAMES = Object.freeze({
  execute: CRAWL_EXECUTE_JOB_TYPE,
  deadLetter: CRAWL_DEAD_LETTER_JOB_TYPE,
});

export const AUDIT_QUEUE_JOB_NAMES = Object.freeze({
  evaluate: AUDIT_EVALUATE_JOB_TYPE,
});
