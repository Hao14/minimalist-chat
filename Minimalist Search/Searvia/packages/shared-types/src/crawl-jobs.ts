import { z } from "zod";

export const CRAWL_JOB_CONTRACT_VERSION = 1 as const;
export const CRAWL_EXECUTE_JOB_TYPE = "crawl.execute" as const;
export const CRAWL_DEAD_LETTER_JOB_TYPE = "crawl.dead-letter" as const;

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "Use only letters, numbers, dot, underscore, or hyphen.");

const crawlJobBaseShape = {
  contractVersion: z.literal(CRAWL_JOB_CONTRACT_VERSION),
  organizationId: z.uuid(),
  projectId: z.uuid(),
  crawlId: z.uuid(),
  traceId: boundedIdentifierSchema,
  idempotencyKey: boundedIdentifierSchema,
} as const;

export const crawlExecuteJobSchema = z
  .object({
    ...crawlJobBaseShape,
    jobType: z.literal(CRAWL_EXECUTE_JOB_TYPE),
    requestedByMembershipId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    estimatedPages: z.number().int().min(1).max(100),
  })
  .strict();

export type CrawlExecuteJob = z.infer<typeof crawlExecuteJobSchema>;

export const crawlDeadLetterJobSchema = z
  .object({
    ...crawlJobBaseShape,
    jobType: z.literal(CRAWL_DEAD_LETTER_JOB_TYPE),
    sourceJobId: z.uuid(),
    finalStatus: z.enum(["failed", "partially_completed"]),
    attemptsMade: z.number().int().min(1).max(100),
    errorType: z.string().trim().min(1).max(120),
    errorMessage: z.string().trim().min(1).max(1_000),
    failedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CrawlDeadLetterJob = z.infer<typeof crawlDeadLetterJobSchema>;

export const crawlQueueJobSchema = z.discriminatedUnion("jobType", [
  crawlExecuteJobSchema,
  crawlDeadLetterJobSchema,
]);

export type CrawlQueueJob = z.infer<typeof crawlQueueJobSchema>;
