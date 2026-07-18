import { z } from "zod";

export const AUDIT_JOB_CONTRACT_VERSION = 1 as const;
export const AUDIT_EVALUATE_JOB_TYPE = "audit.evaluate" as const;

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "Use only letters, numbers, dot, underscore, or hyphen.");

const auditJobBaseSchema = z
  .object({
    contractVersion: z.literal(AUDIT_JOB_CONTRACT_VERSION),
    jobType: z.literal(AUDIT_EVALUATE_JOB_TYPE),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    crawlId: z.string().uuid(),
    traceId: boundedIdentifierSchema,
    idempotencyKey: boundedIdentifierSchema,
    crawlStatus: z.enum(["partially_completed", "completed"]),
    crawlFinishedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const auditEvaluateJobSchema = auditJobBaseSchema.superRefine((job, context) => {
  if (job.idempotencyKey !== `audit-${job.crawlId}`) {
    context.addIssue({
      code: "custom",
      path: ["idempotencyKey"],
      message: "The audit evaluation idempotency key must be derived from the crawl ID.",
    });
  }
});

export type AuditEvaluateJob = z.infer<typeof auditEvaluateJobSchema>;
