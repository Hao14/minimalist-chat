import { z } from "zod";

export { privacySafeAuditPageUrl } from "./audit-page-url.js";
export { redactAuditUrlDetails } from "./audit-redaction.js";

export {
  CANONICAL_NORMALIZATION_FAILURE_CODES,
  type CanonicalNormalizationFailure,
  type CanonicalNormalizationFailureCode,
} from "./canonical.js";

export {
  AUDIT_EVALUATE_JOB_TYPE,
  AUDIT_JOB_CONTRACT_VERSION,
  auditEvaluateJobSchema,
  type AuditEvaluateJob,
} from "./audit-jobs.js";
export {
  AUDIT_CATEGORIES,
  AUDIT_CONFIDENCE_LEVELS,
  AUDIT_EVALUATION_RUN_STATUSES,
  AUDIT_EVIDENCE_KINDS,
  AUDIT_EVIDENCE_SOURCES,
  AUDIT_FINDING_LIFECYCLE_STATES,
  AUDIT_IMPACT_AREAS,
  AUDIT_RESPONSIBLE_OWNERS,
  AUDIT_RESULT_STATUSES,
  AUDIT_RULE_SCOPES,
  AUDIT_SEVERITIES,
  auditCategorySchema,
  auditConfidenceSchema,
  auditEvaluationRunStatusSchema,
  auditEvidenceItemSchema,
  auditEvidenceKindSchema,
  auditEvidenceScalarSchema,
  auditEvidenceSourceSchema,
  auditFindingLifecycleStateSchema,
  auditImpactAreaSchema,
  auditResponsibleOwnerSchema,
  auditResultStatusSchema,
  auditRuleScopeSchema,
  auditSeveritySchema,
  type AuditCategory,
  type AuditConfidence,
  type AuditEvaluationRunStatus,
  type AuditEvidenceItem,
  type AuditEvidenceKind,
  type AuditEvidenceScalar,
  type AuditEvidenceSource,
  type AuditFindingLifecycleState,
  type AuditImpactArea,
  type AuditResponsibleOwner,
  type AuditResultStatus,
  type AuditRuleScope,
  type AuditSeverity,
} from "./audit.js";

export {
  canManageRole,
  ORGANIZATION_CAPABILITIES,
  ORGANIZATION_ROLES,
  organizationCapabilitySchema,
  organizationRoleSchema,
  roleHasCapability,
  roleRequiresProjectScope,
  type OrganizationCapability,
  type OrganizationRole,
} from "./authorization.js";
export {
  canTransitionCrawlStatus,
  CRAWL_STATUSES,
  CRAWL_TERMINAL_STATUSES,
  crawlProgressCountersSchema,
  crawlProgressSchema,
  crawlStatusSchema,
  crawlTerminalStatusSchema,
  isTerminalCrawlStatus,
  type CrawlProgress,
  type CrawlProgressCounters,
  type CrawlStatus,
  type CrawlTerminalStatus,
} from "./crawl.js";
export {
  CRAWL_DEAD_LETTER_JOB_TYPE,
  CRAWL_EXECUTE_JOB_TYPE,
  CRAWL_JOB_CONTRACT_VERSION,
  crawlDeadLetterJobSchema,
  crawlExecuteJobSchema,
  crawlQueueJobSchema,
  type CrawlDeadLetterJob,
  type CrawlExecuteJob,
  type CrawlQueueJob,
} from "./crawl-jobs.js";
export {
  normalizeProjectOrigin,
  PROJECT_ORIGIN_ERROR_CODES,
  ProjectOriginValidationError,
  type CrawlTargetValidator,
  type NormalizedProjectOrigin,
  type ProjectOriginErrorCode,
  type ProjectOriginNormalizer,
} from "./project-origin.js";

export const runtimeEnvironmentSchema = z.enum(["development", "test", "production"]);

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export const logLevelSchema = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);

export type LogLevel = z.infer<typeof logLevelSchema>;

export const serviceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "Use a lowercase, hyphenated service name.");

export const healthStatusSchema = z.enum([
  "starting",
  "healthy",
  "degraded",
  "unhealthy",
  "stopping",
  "stopped",
]);

export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const dependencyHealthSchema = z
  .object({
    status: healthStatusSchema,
    checkedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const serviceHealthEventSchema = z
  .object({
    service: serviceNameSchema,
    environment: runtimeEnvironmentSchema,
    status: healthStatusSchema,
    checkedAt: z.string().datetime({ offset: true }),
    traceId: z.string().trim().min(1).max(128),
    dependencies: z.record(z.string(), dependencyHealthSchema),
  })
  .strict();

export type ServiceHealthEvent = z.infer<typeof serviceHealthEventSchema>;

export type IntegrationAvailability =
  | Readonly<{
      state: "available";
      source: string;
      checkedAt: string;
    }>
  | Readonly<{
      state: "not-configured" | "not-implemented" | "disabled";
      reason: string;
      setupAction?: string;
    }>;

export type SafeLogMetadata = Readonly<Record<string, unknown>>;
