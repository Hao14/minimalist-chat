import { z } from "zod";

export const AUDIT_CATEGORIES = [
  "crawlability",
  "http",
  "robots-sitemaps",
  "urls-canonicals",
  "on-page",
  "content-quality",
  "links-architecture",
] as const;

export const auditCategorySchema = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof auditCategorySchema>;

export const AUDIT_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "opportunity",
  "manual-review",
] as const;

export const auditSeveritySchema = z.enum(AUDIT_SEVERITIES);
export type AuditSeverity = z.infer<typeof auditSeveritySchema>;

export const AUDIT_RESULT_STATUSES = [
  "passed",
  "failed",
  "warning",
  "opportunity",
  "manual-review",
  "not-checked",
] as const;

export const auditResultStatusSchema = z.enum(AUDIT_RESULT_STATUSES);
export type AuditResultStatus = z.infer<typeof auditResultStatusSchema>;

export const AUDIT_FINDING_LIFECYCLE_STATES = [
  "new",
  "existing",
  "returned",
  "fixed",
  "ignored",
  "accepted-risk",
  "not-evaluated",
] as const;

export const auditFindingLifecycleStateSchema = z.enum(AUDIT_FINDING_LIFECYCLE_STATES);
export type AuditFindingLifecycleState = z.infer<typeof auditFindingLifecycleStateSchema>;

export const AUDIT_RULE_SCOPES = ["page", "site"] as const;
export const auditRuleScopeSchema = z.enum(AUDIT_RULE_SCOPES);
export type AuditRuleScope = z.infer<typeof auditRuleScopeSchema>;

export const AUDIT_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const auditConfidenceSchema = z.enum(AUDIT_CONFIDENCE_LEVELS);
export type AuditConfidence = z.infer<typeof auditConfidenceSchema>;

export const AUDIT_IMPACT_AREAS = [
  "crawlability",
  "indexability",
  "search-visibility",
  "ai-retrievability",
  "user-experience",
  "security",
] as const;

export const auditImpactAreaSchema = z.enum(AUDIT_IMPACT_AREAS);
export type AuditImpactArea = z.infer<typeof auditImpactAreaSchema>;

export const AUDIT_RESPONSIBLE_OWNERS = ["developer", "seo", "content", "infrastructure"] as const;

export const auditResponsibleOwnerSchema = z.enum(AUDIT_RESPONSIBLE_OWNERS);
export type AuditResponsibleOwner = z.infer<typeof auditResponsibleOwnerSchema>;

export const AUDIT_EVALUATION_RUN_STATUSES = [
  "running",
  "completed",
  "partially-completed",
  "failed",
] as const;
export const auditEvaluationRunStatusSchema = z.enum(AUDIT_EVALUATION_RUN_STATUSES);
export type AuditEvaluationRunStatus = z.infer<typeof auditEvaluationRunStatusSchema>;

export const AUDIT_EVIDENCE_KINDS = [
  "crawl",
  "page",
  "header",
  "redirect",
  "robots",
  "sitemap",
  "link",
  "extraction",
  "configuration",
  "engine",
] as const;

export const auditEvidenceKindSchema = z.enum(AUDIT_EVIDENCE_KINDS);
export type AuditEvidenceKind = z.infer<typeof auditEvidenceKindSchema>;

export const AUDIT_EVIDENCE_SOURCES = [
  "crawl",
  "transport",
  "raw",
  "rendered",
  "robots",
  "sitemap",
  "graph",
  "configuration",
  "engine",
] as const;

export const auditEvidenceSourceSchema = z.enum(AUDIT_EVIDENCE_SOURCES);
export type AuditEvidenceSource = z.infer<typeof auditEvidenceSourceSchema>;

export type AuditEvidenceScalar = boolean | number | string | null;

export const auditEvidenceScalarSchema = z.union([
  z.string().max(4_096),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const visibleAuditEvidenceText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/\p{Cc}/u.test(value), "Control characters are not allowed.");

export const auditEvidenceItemSchema = z
  .object({
    kind: auditEvidenceKindSchema,
    source: auditEvidenceSourceSchema,
    observationId: visibleAuditEvidenceText(256),
    observedAt: visibleAuditEvidenceText(64).refine(
      (value) => Number.isFinite(Date.parse(value)),
      "A valid observation timestamp is required.",
    ),
    field: visibleAuditEvidenceText(160),
    value: z.union([auditEvidenceScalarSchema, z.array(auditEvidenceScalarSchema).max(1_000)]),
    url: visibleAuditEvidenceText(4_096).optional(),
    excerpt: visibleAuditEvidenceText(4_096).optional(),
  })
  .strict();

export interface AuditEvidenceItem {
  readonly kind: AuditEvidenceKind;
  readonly source: AuditEvidenceSource;
  readonly observationId: string;
  readonly observedAt: string;
  readonly field: string;
  readonly value: AuditEvidenceScalar | readonly AuditEvidenceScalar[];
  readonly url?: string;
  readonly excerpt?: string;
}
