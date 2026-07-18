export {
  AUDIT_OBSERVATION_KEYS,
  DEFAULT_AUDIT_ENGINE_POLICY,
  type AuditEligibility,
  type AuditEnginePolicy,
  type AuditEvaluationFailure,
  type AuditEvaluationReport,
  type AuditObservationKey,
  type AuditRuleDefinition,
  type AuditRuleId,
  type AuditRuleOutcome,
  type AuditRuleResult,
  type AuditRuleTarget,
} from "./contracts.js";
export {
  ACTIVE_AUDIT_CATALOG_VERSION,
  AUDIT_ENGINE_VERSION,
  M4A_CATALOG_VERSION,
  VersionedAuditEngine,
} from "./engine.js";
export {
  ACTIVE_AUDIT_RULES,
  CNT_RULES,
  CRW_RULES,
  HTTP_RULES,
  LNK_RULES,
  M4A_RULES,
  M5_EXPANSION_RULES,
  ONS_RULES,
  RSM_RULES,
  URL_RULES,
  createActiveAuditEngine,
  createM4AAuditEngine,
} from "./catalog.js";
export type {
  AuditCrawlSnapshot,
  AuditHeaderMap,
  AuditPageExtraction,
  AuditPageLink,
  AuditPageObservation,
  AuditPageResource,
  AuditRedirectHop,
  AuditRobotsObservation,
  AuditSitemapEntry,
  AuditSitemapObservation,
  HistoricalRedirectObservation,
  HistoricalRedirectCoverage,
} from "./snapshot.js";

export function isCheckedAuditResult(result: Readonly<{ status: string }>): boolean {
  return result.status !== "not-checked";
}

/** Backward-compatible marker retained for foundation import consumers. */
export const auditEngineFoundation = Object.freeze({ milestone: "M0" as const });
