import type {
  AuditCategory,
  AuditConfidence,
  AuditEvidenceItem,
  AuditImpactArea,
  AuditResponsibleOwner,
  AuditResultStatus,
  AuditRuleScope,
  AuditSeverity,
} from "@searvia/shared-types";

import type { AuditCrawlSnapshot } from "./snapshot.js";

export const AUDIT_OBSERVATION_KEYS = [
  "crawl",
  "configuration",
  "pages",
  "transport",
  "headers",
  "redirects",
  "raw-extraction",
  "rendered-extraction",
  "links",
  "resources",
  "robots",
  "sitemaps",
  "sitemap-entries",
  "crawl-history",
  "redirect-signals",
] as const;

export type AuditObservationKey = (typeof AUDIT_OBSERVATION_KEYS)[number];
export type AuditRuleId = `${"CRW" | "HTTP" | "RSM" | "URL" | "ONS" | "CNT" | "LNK"}-${string}`;

export interface AuditEnginePolicy {
  readonly importantDepthThreshold: number;
  readonly redirectChainThreshold: number;
  readonly minimumCompressionBytes: number;
  readonly urlLengthThreshold: number;
  readonly queryVariantThreshold: number;
  readonly soft404MaximumWords: number;
  readonly nearDuplicateMaximumDistance: number;
  readonly sitemapMismatchRatio: number;
  readonly titleMinimumCharacters: number;
  readonly titleMaximumCharacters: number;
  readonly metaDescriptionMinimumCharacters: number;
  readonly metaDescriptionMaximumCharacters: number;
  readonly thinContentMinimumWords: number;
  readonly minimumImportantInboundLinks: number;
  readonly excessivePageLinkThreshold: number;
}

export const DEFAULT_AUDIT_ENGINE_POLICY: AuditEnginePolicy = Object.freeze({
  importantDepthThreshold: 3,
  redirectChainThreshold: 3,
  minimumCompressionBytes: 1_024,
  urlLengthThreshold: 115,
  queryVariantThreshold: 10,
  soft404MaximumWords: 100,
  nearDuplicateMaximumDistance: 12,
  sitemapMismatchRatio: 0.1,
  titleMinimumCharacters: 15,
  titleMaximumCharacters: 60,
  metaDescriptionMinimumCharacters: 50,
  metaDescriptionMaximumCharacters: 160,
  thinContentMinimumWords: 100,
  minimumImportantInboundLinks: 2,
  excessivePageLinkThreshold: 200,
});

export type AuditEligibility =
  | Readonly<{ state: "eligible"; reason: string }>
  | Readonly<{
      state: "ineligible" | "unavailable";
      reason: string;
      missingData: readonly AuditObservationKey[];
    }>;

export interface AuditRuleTarget {
  readonly scope: AuditRuleScope;
  readonly key: string;
  readonly pageId: string | null;
  readonly normalizedUrl: string | null;
}

export interface AuditRuleOutcome {
  readonly target: AuditRuleTarget;
  readonly eligibility: AuditEligibility;
  readonly status: AuditResultStatus;
  readonly evidence: readonly AuditEvidenceItem[];
  readonly detectedValue: string;
  readonly expectedValue?: string;
  readonly confidence?: AuditConfidence;
}

export interface AuditRuleDefinition {
  readonly id: AuditRuleId;
  readonly version: number;
  readonly title: string;
  readonly category: AuditCategory;
  readonly defaultSeverity: AuditSeverity;
  readonly scope: AuditRuleScope;
  readonly description: string;
  readonly eligibility: string;
  readonly requiredData: readonly AuditObservationKey[];
  readonly deterministic: true;
  readonly explanation: string;
  readonly expectedValue: string;
  readonly recommendedFix: string;
  readonly verification: string;
  readonly confidence: AuditConfidence;
  readonly impactAreas: readonly AuditImpactArea[];
  readonly responsibleOwner: AuditResponsibleOwner;
  readonly firstSupportedVersion: string;
  evaluate(snapshot: AuditCrawlSnapshot, policy: AuditEnginePolicy): readonly AuditRuleOutcome[];
}

export interface AuditRuleResult {
  readonly ruleId: AuditRuleId;
  readonly ruleVersion: number;
  readonly title: string;
  readonly category: AuditCategory;
  readonly defaultSeverity: AuditSeverity;
  readonly scope: AuditRuleScope;
  readonly target: AuditRuleTarget;
  readonly eligibility: AuditEligibility;
  readonly requiredData: readonly AuditObservationKey[];
  readonly status: AuditResultStatus;
  readonly evidence: readonly AuditEvidenceItem[];
  readonly detectedValue: string;
  readonly expectedValue: string;
  readonly explanation: string;
  readonly recommendedFix: string;
  readonly verification: string;
  readonly confidence: AuditConfidence;
  readonly impactAreas: readonly AuditImpactArea[];
  readonly responsibleOwner: AuditResponsibleOwner;
}

export interface AuditEvaluationFailure {
  readonly ruleId: AuditRuleId;
  readonly ruleVersion: number;
  readonly errorType: "detector-error" | "invalid-result";
  readonly message: string;
}

export interface AuditEvaluationReport {
  readonly engineVersion: string;
  readonly catalogVersion: string;
  readonly crawlId: string;
  readonly results: readonly AuditRuleResult[];
  readonly failures: readonly AuditEvaluationFailure[];
  readonly counts: Readonly<{
    rules: number;
    results: number;
    eligible: number;
    evaluated: number;
    failed: number;
    warning: number;
    opportunity: number;
    manualReview: number;
    passed: number;
    notChecked: number;
  }>;
}
