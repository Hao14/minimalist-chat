import {
  DEFAULT_AUDIT_ENGINE_POLICY,
  type AuditEnginePolicy,
  type AuditRuleDefinition,
} from "./contracts.js";
import { ACTIVE_AUDIT_CATALOG_VERSION, VersionedAuditEngine } from "./engine.js";
import { CRW_RULES } from "./rules/crw.js";
import { CNT_RULES } from "./rules/cnt.js";
import { HTTP_RULES } from "./rules/http.js";
import { LNK_RULES } from "./rules/lnk.js";
import { ONS_RULES } from "./rules/ons.js";
import { RSM_RULES } from "./rules/rsm.js";
import { URL_RULES } from "./rules/url.js";

export const M4A_RULES: readonly AuditRuleDefinition[] = Object.freeze([
  ...CRW_RULES,
  ...HTTP_RULES,
  ...RSM_RULES,
  ...URL_RULES,
]);

export function createM4AAuditEngine(
  policy: AuditEnginePolicy = DEFAULT_AUDIT_ENGINE_POLICY,
): VersionedAuditEngine {
  return new VersionedAuditEngine(M4A_RULES, policy);
}

export const M5_EXPANSION_RULES: readonly AuditRuleDefinition[] = Object.freeze([
  ...ONS_RULES,
  ...CNT_RULES,
  ...LNK_RULES,
]);

/** Active 130-rule catalog. The remaining approved Phase 1 categories are not implemented yet. */
export const ACTIVE_AUDIT_RULES: readonly AuditRuleDefinition[] = Object.freeze([
  ...M4A_RULES,
  ...M5_EXPANSION_RULES,
]);

export function createActiveAuditEngine(
  policy: AuditEnginePolicy = DEFAULT_AUDIT_ENGINE_POLICY,
): VersionedAuditEngine {
  return new VersionedAuditEngine(ACTIVE_AUDIT_RULES, policy, ACTIVE_AUDIT_CATALOG_VERSION);
}

export { CNT_RULES, CRW_RULES, HTTP_RULES, LNK_RULES, ONS_RULES, RSM_RULES, URL_RULES };
