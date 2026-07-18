import {
  ACTIVE_AUDIT_RULES,
  AUDIT_ENGINE_VERSION,
  M4A_RULES,
  createActiveAuditEngine,
  type AuditCrawlSnapshot,
  type AuditEvaluationReport,
} from "@searvia/audit-engine";
import type { AuditEvaluateJob } from "@searvia/shared-types";
import type { AuditJobHandler, CrawlJobDeliveryContext } from "@searvia/job-queue";

export interface AuditRuleRegistrationRecord {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly defaultSeverity:
    "critical" | "high" | "medium" | "low" | "opportunity" | "manual-review";
  readonly defaultConfidence: "high" | "medium" | "low";
  readonly scope: "page" | "site";
  readonly deterministic: boolean;
  readonly eligibilityDescription: string;
  readonly requiredData: readonly string[];
  readonly explanation: string;
  readonly expectedValue: string;
  readonly recommendedFix: string;
  readonly verificationMethod: string;
  readonly impactAreas: readonly string[];
  readonly responsibleOwner: string;
  readonly firstSupportedVersion: string;
}

export interface AuditEvaluationResultRecord {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly scope: "page" | "site";
  readonly scopeKey: string;
  readonly pageId?: string | null;
  readonly normalizedUrl?: string | null;
  readonly eligibility: "eligible" | "ineligible" | "unavailable";
  readonly status:
    "passed" | "failed" | "warning" | "opportunity" | "manual-review" | "not-checked";
  readonly severity: "critical" | "high" | "medium" | "low" | "opportunity" | "manual-review";
  readonly confidence: "high" | "medium" | "low" | null;
  readonly missingData?: readonly string[];
  readonly notEvaluatedReasonCode?: string | null;
  readonly notEvaluatedReason?: string | null;
  readonly evidenceVersion?: number;
  readonly evidence: readonly unknown[];
  readonly detectedValue?: unknown;
  readonly expectedValue?: unknown;
  readonly explanation: string;
  readonly recommendedFix: string;
}

export interface AuditEvaluationReportPersistenceInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly engineVersion: number;
  readonly definitions: readonly AuditRuleRegistrationRecord[];
  readonly results: readonly AuditEvaluationResultRecord[];
  readonly now?: Date;
}

export interface AuditEvaluationPersistencePort {
  loadAuditSnapshot(
    scope: Readonly<{ organizationId: string; projectId: string; crawlId: string }>,
  ): Promise<AuditCrawlSnapshot>;
  hasTerminalEvaluationRun(
    scope: Readonly<{ organizationId: string; projectId: string; crawlId: string }>,
  ): Promise<boolean>;
  persistEvaluationReport(input: AuditEvaluationReportPersistenceInput): Promise<unknown>;
}

export interface AuditJobProcessorDependencies {
  readonly persistence: AuditEvaluationPersistencePort;
  readonly evaluate?: (snapshot: AuditCrawlSnapshot) => AuditEvaluationReport;
  readonly onError?: (error: unknown, contract: AuditEvaluateJob) => void;
}

function engineMajorVersion(): number {
  const version = Number.parseInt(AUDIT_ENGINE_VERSION.split(".")[0] ?? "", 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError("The audit engine version must begin with a positive integer.");
  }
  return version;
}

export function createM4ARuleRegistrations(): readonly AuditRuleRegistrationRecord[] {
  return createRuleRegistrations(M4A_RULES);
}

function createRuleRegistrations(
  rules: typeof ACTIVE_AUDIT_RULES,
): readonly AuditRuleRegistrationRecord[] {
  return Object.freeze(
    rules.map((rule) =>
      Object.freeze({
        id: rule.id,
        version: rule.version,
        title: rule.title,
        description: rule.description,
        category: rule.category,
        defaultSeverity: rule.defaultSeverity,
        defaultConfidence: rule.confidence,
        scope: rule.scope,
        deterministic: rule.deterministic,
        eligibilityDescription: rule.eligibility,
        requiredData: rule.requiredData,
        explanation: rule.explanation,
        expectedValue: rule.expectedValue,
        recommendedFix: rule.recommendedFix,
        verificationMethod: rule.verification,
        impactAreas: rule.impactAreas,
        responsibleOwner: rule.responsibleOwner,
        firstSupportedVersion: rule.firstSupportedVersion,
      }),
    ),
  );
}

export function createActiveRuleRegistrations(): readonly AuditRuleRegistrationRecord[] {
  return createRuleRegistrations(ACTIVE_AUDIT_RULES);
}

function persistenceResults(report: AuditEvaluationReport): readonly AuditEvaluationResultRecord[] {
  const detectorFailures = new Set(
    report.failures.map((failure) => `${failure.ruleId}@${String(failure.ruleVersion)}`),
  );
  return report.results.map((result) => {
    const notChecked = result.status === "not-checked";
    const detectorFailed = detectorFailures.has(`${result.ruleId}@${String(result.ruleVersion)}`);
    return Object.freeze({
      ruleId: result.ruleId,
      ruleVersion: result.ruleVersion,
      scope: result.scope,
      scopeKey: result.target.key,
      pageId: result.target.pageId,
      normalizedUrl: result.target.normalizedUrl,
      eligibility: result.eligibility.state,
      status: result.status,
      severity: result.defaultSeverity,
      confidence: notChecked ? null : result.confidence,
      missingData:
        result.eligibility.state === "eligible"
          ? Object.freeze([])
          : Object.freeze([...(result.eligibility.missingData ?? [])]),
      notEvaluatedReasonCode: notChecked
        ? detectorFailed
          ? "detector_error"
          : result.eligibility.state === "ineligible"
            ? "rule_ineligible"
            : "required_data_unavailable"
        : null,
      notEvaluatedReason: notChecked ? result.eligibility.reason : null,
      evidenceVersion: 1,
      evidence: result.evidence,
      detectedValue: result.detectedValue,
      expectedValue: result.expectedValue,
      explanation: result.explanation,
      recommendedFix: result.recommendedFix,
    });
  });
}

function assertContractMatchesSnapshot(
  contract: AuditEvaluateJob,
  snapshot: AuditCrawlSnapshot,
  delivery: CrawlJobDeliveryContext,
): void {
  if (
    snapshot.organizationId !== contract.organizationId ||
    snapshot.projectId !== contract.projectId ||
    snapshot.crawlId !== contract.crawlId
  ) {
    throw new TypeError("The audit snapshot does not match the queued tenant scope.");
  }
  if (snapshot.status !== contract.crawlStatus) {
    throw new TypeError("The audit snapshot status does not match the queued terminal status.");
  }
  if (Date.parse(snapshot.finishedAt) !== Date.parse(contract.crawlFinishedAt)) {
    throw new TypeError("The audit snapshot timestamp does not match the queued crawl snapshot.");
  }
  if (delivery.queueJobId !== contract.idempotencyKey) {
    throw new TypeError("The audit queue job ID does not match its deterministic idempotency key.");
  }
}

export function createAuditJobProcessor(
  dependencies: AuditJobProcessorDependencies,
): AuditJobHandler {
  const evaluate =
    dependencies.evaluate ?? ((snapshot) => createActiveAuditEngine().evaluate(snapshot));
  const definitions = createActiveRuleRegistrations();
  const engineVersion = engineMajorVersion();

  return async (contract, delivery) => {
    try {
      delivery.signal?.throwIfAborted();
      const scope = {
        organizationId: contract.organizationId,
        projectId: contract.projectId,
        crawlId: contract.crawlId,
      } as const;
      const snapshot = await dependencies.persistence.loadAuditSnapshot(scope);
      assertContractMatchesSnapshot(contract, snapshot, delivery);
      delivery.signal?.throwIfAborted();
      const hasTerminalEvaluationRun =
        await dependencies.persistence.hasTerminalEvaluationRun(scope);
      delivery.signal?.throwIfAborted();
      if (hasTerminalEvaluationRun) return;
      const report = evaluate(snapshot);
      delivery.signal?.throwIfAborted();
      await dependencies.persistence.persistEvaluationReport({
        ...scope,
        engineVersion,
        definitions,
        results: persistenceResults(report),
      });
    } catch (error) {
      dependencies.onError?.(error, contract);
      throw error;
    }
  };
}
