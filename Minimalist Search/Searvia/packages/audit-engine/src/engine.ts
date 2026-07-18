import {
  AUDIT_EVIDENCE_KINDS,
  AUDIT_EVIDENCE_SOURCES,
  auditEvidenceItemSchema,
  privacySafeAuditPageUrl,
  redactAuditUrlDetails,
  type AuditEvidenceItem,
  type AuditEvidenceScalar,
} from "@searvia/shared-types";

import {
  DEFAULT_AUDIT_ENGINE_POLICY,
  type AuditEnginePolicy,
  type AuditEvaluationFailure,
  type AuditEvaluationReport,
  type AuditRuleDefinition,
  type AuditRuleOutcome,
  type AuditRuleResult,
  type AuditRuleTarget,
} from "./contracts.js";
import type { AuditCrawlSnapshot, AuditPageObservation } from "./snapshot.js";

export const AUDIT_ENGINE_VERSION = "1.0.0";
export const M4A_CATALOG_VERSION = "m4a-5";
export const ACTIVE_AUDIT_CATALOG_VERSION = "m5-partial-3";

const MAX_EVIDENCE_ITEMS = 25;
const MAX_EVIDENCE_BYTES = 65_536;
const MAX_VALUE_LENGTH = 4_096;
const EVIDENCE_KINDS = new Set<string>(AUDIT_EVIDENCE_KINDS);
const EVIDENCE_SOURCES = new Set<string>(AUDIT_EVIDENCE_SOURCES);

function redactEvidenceScalar(value: AuditEvidenceScalar): AuditEvidenceScalar {
  return typeof value === "string" ? redactAuditUrlDetails(value) : value;
}

type SnapshotPageIndex = ReadonlyMap<string, AuditPageObservation | null>;

function indexSnapshotPages(snapshot: AuditCrawlSnapshot): SnapshotPageIndex {
  const pages = new Map<string, AuditPageObservation | null>();
  for (const page of snapshot.pages) {
    pages.set(page.id, pages.has(page.id) ? null : page);
  }
  return pages;
}

function privacySafeTarget(
  target: AuditRuleTarget,
  definition: AuditRuleDefinition,
  snapshotPages: SnapshotPageIndex,
): AuditRuleTarget {
  if (target.scope !== "page" || target.normalizedUrl === null) return target;
  const snapshotPage = snapshotPages.get(target.pageId ?? "");
  if (snapshotPage === undefined) {
    throw new TypeError(`Rule ${definition.id} targeted a page outside the crawl snapshot.`);
  }
  if (snapshotPage === null) {
    throw new TypeError(`Rule ${definition.id} targeted a duplicate crawl snapshot page ID.`);
  }
  if (
    target.normalizedUrl !== snapshotPage.normalizedUrl ||
    target.key !== snapshotPage.normalizedUrl
  ) {
    throw new TypeError(`Rule ${definition.id} returned a page URL that does not match its ID.`);
  }
  const normalizedUrl = privacySafeAuditPageUrl(snapshotPage.normalizedUrl, snapshotPage.urlHash);
  return Object.freeze({
    ...target,
    key: normalizedUrl,
    normalizedUrl,
  });
}

function isEvidenceArray(
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
): value is readonly AuditEvidenceScalar[] {
  return Array.isArray(value);
}

function normalizeEvidenceItem(item: AuditEvidenceItem): AuditEvidenceItem {
  const value = isEvidenceArray(item.value)
    ? Object.freeze(item.value.map(redactEvidenceScalar))
    : redactEvidenceScalar(item.value);
  return Object.freeze({
    ...item,
    value,
    ...(item.url === undefined ? {} : { url: redactAuditUrlDetails(item.url) }),
    ...(item.excerpt === undefined ? {} : { excerpt: redactAuditUrlDetails(item.excerpt) }),
  });
}

function boundedText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VALUE_LENGTH) {
    throw new TypeError(`${field} must contain between 1 and ${MAX_VALUE_LENGTH} characters.`);
  }
  return trimmed;
}

function validateTarget(
  target: AuditRuleTarget,
  definition: AuditRuleDefinition,
  outcome: AuditRuleOutcome,
): void {
  if (target.scope !== definition.scope) {
    throw new TypeError(`Rule ${definition.id} returned a target with the wrong scope.`);
  }
  if (target.key.trim().length === 0 || target.key.length > 4_096) {
    throw new TypeError(`Rule ${definition.id} returned an invalid target key.`);
  }
  if (target.scope === "site") {
    if (target.pageId !== null || target.normalizedUrl !== null) {
      throw new TypeError(`Rule ${definition.id} returned page identity for a site target.`);
    }
    return;
  }

  if ((target.pageId === null) !== (target.normalizedUrl === null)) {
    throw new TypeError(`Rule ${definition.id} returned incomplete page identity.`);
  }
  if (target.pageId === null) {
    if (outcome.status !== "not-checked" || outcome.eligibility.state === "eligible") {
      throw new TypeError(
        `Rule ${definition.id} returned a checked page result without page identity.`,
      );
    }
    return;
  }
  if (target.key !== target.normalizedUrl) {
    throw new TypeError(`Rule ${definition.id} returned a page key that does not match its URL.`);
  }
}

function validateEvidence(evidence: readonly AuditEvidenceItem[], ruleId: string): void {
  if (evidence.length === 0 || evidence.length > MAX_EVIDENCE_ITEMS) {
    throw new TypeError(`Rule ${ruleId} must return 1-${MAX_EVIDENCE_ITEMS} evidence items.`);
  }
  const serialized = JSON.stringify(evidence);
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_BYTES) {
    throw new TypeError(
      `Rule ${ruleId} returned evidence larger than ${MAX_EVIDENCE_BYTES} bytes.`,
    );
  }
  for (const item of evidence) {
    const parsed = auditEvidenceItemSchema.safeParse(item);
    if (!parsed.success) {
      throw new TypeError(`Rule ${ruleId} returned evidence outside the shared audit schema.`);
    }
    if (redactAuditUrlDetails(item.observationId) !== item.observationId) {
      throw new TypeError(`Rule ${ruleId} returned a secret-bearing evidence observation ID.`);
    }
    if (!EVIDENCE_KINDS.has(item.kind) || !EVIDENCE_SOURCES.has(item.source)) {
      throw new TypeError(`Rule ${ruleId} returned an invalid evidence kind or source.`);
    }
    if (item.observationId.trim().length === 0 || item.observationId.length > 256) {
      throw new TypeError(`Rule ${ruleId} returned an invalid evidence observation identifier.`);
    }
    if (item.field.trim().length === 0 || item.field.length > 160) {
      throw new TypeError(`Rule ${ruleId} returned an invalid evidence field.`);
    }
    if (!Number.isFinite(Date.parse(item.observedAt))) {
      throw new TypeError(`Rule ${ruleId} returned an invalid evidence timestamp.`);
    }
    const values = isEvidenceArray(item.value) ? item.value : [item.value];
    if (
      values.some(
        (value) =>
          value !== null &&
          typeof value !== "string" &&
          typeof value !== "boolean" &&
          (typeof value !== "number" || !Number.isFinite(value)),
      )
    ) {
      throw new TypeError(`Rule ${ruleId} returned a non-scalar or non-finite evidence value.`);
    }
  }
}

function normalizeOutcome(
  definition: AuditRuleDefinition,
  outcome: AuditRuleOutcome,
  snapshotPages: SnapshotPageIndex,
): AuditRuleResult {
  validateTarget(outcome.target, definition, outcome);
  const target = privacySafeTarget(outcome.target, definition, snapshotPages);
  const normalizedEvidence = outcome.evidence.map(normalizeEvidenceItem);
  validateEvidence(normalizedEvidence, definition.id);
  if (outcome.eligibility.state !== "eligible" && outcome.status !== "not-checked") {
    throw new TypeError(`Rule ${definition.id} marked an ineligible result as checked.`);
  }
  if (outcome.eligibility.state === "eligible" && outcome.status === "not-checked") {
    throw new TypeError(`Rule ${definition.id} marked an eligible result as not checked.`);
  }
  if (outcome.eligibility.state !== "eligible") {
    const declared = new Set(definition.requiredData);
    const undeclared = outcome.eligibility.missingData.filter((key) => !declared.has(key));
    if (undeclared.length > 0) {
      throw new TypeError(
        `Rule ${definition.id} reported undeclared missing data: ${[...new Set(undeclared)].join(", ")}.`,
      );
    }
  }

  return Object.freeze({
    ruleId: definition.id,
    ruleVersion: definition.version,
    title: definition.title,
    category: definition.category,
    defaultSeverity: definition.defaultSeverity,
    scope: definition.scope,
    target,
    eligibility: Object.freeze({
      ...outcome.eligibility,
      reason: redactAuditUrlDetails(outcome.eligibility.reason),
      ...(outcome.eligibility.state === "eligible"
        ? {}
        : { missingData: Object.freeze([...outcome.eligibility.missingData]) }),
    }),
    requiredData: Object.freeze([...definition.requiredData]),
    status: outcome.status,
    evidence: Object.freeze(normalizedEvidence),
    detectedValue: boundedText(redactAuditUrlDetails(outcome.detectedValue), "detectedValue"),
    expectedValue: boundedText(
      redactAuditUrlDetails(outcome.expectedValue ?? definition.expectedValue),
      "expectedValue",
    ),
    explanation: boundedText(definition.explanation, "explanation"),
    recommendedFix: boundedText(definition.recommendedFix, "recommendedFix"),
    verification: boundedText(definition.verification, "verification"),
    confidence: outcome.confidence ?? definition.confidence,
    impactAreas: Object.freeze([...definition.impactAreas]),
    responsibleOwner: definition.responsibleOwner,
  });
}

function evaluationFailure(
  definition: AuditRuleDefinition,
  snapshot: AuditCrawlSnapshot,
  snapshotPages: SnapshotPageIndex,
  errorType: AuditEvaluationFailure["errorType"],
  cause: unknown,
): Readonly<{ result: AuditRuleResult; failure: AuditEvaluationFailure }> {
  const message =
    cause instanceof Error
      ? redactAuditUrlDetails(cause.message).slice(0, 500)
      : "Unknown detector failure.";
  const target: AuditRuleTarget = Object.freeze({
    scope: definition.scope,
    key: `${snapshot.origin}#${definition.id.toLowerCase()}-${errorType}`,
    pageId: null,
    normalizedUrl: null,
  });
  const outcome: AuditRuleOutcome = Object.freeze({
    target,
    eligibility: Object.freeze({
      state: "unavailable",
      reason:
        errorType === "detector-error"
          ? "The deterministic detector failed before it could reach a conclusion."
          : "The deterministic detector returned a result that violated the engine contract.",
      missingData: Object.freeze([]),
    }),
    status: "not-checked",
    evidence: Object.freeze([
      Object.freeze({
        kind: "engine",
        source: "engine",
        observationId: `${definition.id}@${definition.version}`,
        observedAt: snapshot.finishedAt,
        field: errorType === "detector-error" ? "detector" : "result_validation",
        value: "failed",
      }),
    ]),
    detectedValue: "Detector error; no conclusion was produced.",
  });
  return Object.freeze({
    result: normalizeOutcome(definition, outcome, snapshotPages),
    failure: Object.freeze({
      ruleId: definition.id,
      ruleVersion: definition.version,
      errorType,
      message,
    }),
  });
}

function validateCatalog(rules: readonly AuditRuleDefinition[]): readonly AuditRuleDefinition[] {
  const keys = new Set<string>();
  const activeRuleIds = new Set<string>();
  for (const rule of rules) {
    if (!/^(CRW|HTTP|RSM|URL|ONS|CNT|LNK)-\d{3}$/u.test(rule.id)) {
      throw new TypeError(`Audit rule ID ${rule.id} is not stable catalog syntax.`);
    }
    if (!Number.isInteger(rule.version) || rule.version < 1) {
      throw new TypeError(`Audit rule ${rule.id} has an invalid version.`);
    }
    if (rule.deterministic !== true) {
      throw new TypeError(`Audit rule ${rule.id} must declare deterministic evaluation.`);
    }
    const key = `${rule.id}@${rule.version}`;
    if (keys.has(key)) throw new TypeError(`Duplicate audit rule version ${key}.`);
    if (activeRuleIds.has(rule.id)) {
      throw new TypeError(`Multiple active versions were registered for audit rule ${rule.id}.`);
    }
    keys.add(key);
    activeRuleIds.add(rule.id);
  }
  return Object.freeze([...rules].sort((left, right) => left.id.localeCompare(right.id)));
}

/**
 * Treat extraction-derived evidence as unavailable unless the persistence adapter
 * proves that the extraction attempt succeeded. This runtime guard is deliberate:
 * queue/database adapters are trust boundaries even though their TypeScript shape
 * narrows successful extractions at compile time.
 */
function enforceExtractionProvenance(snapshot: AuditCrawlSnapshot): AuditCrawlSnapshot {
  let changed = false;
  const pages = snapshot.pages.map((page) => {
    const extractionStatus: unknown = page.extraction?.status;
    const renderedExtractionStatus: unknown = page.renderedExtraction?.status;
    const extractionValid = page.extraction === null || extractionStatus === "succeeded";
    const graphProvenanceValid = page.extraction !== null && extractionStatus === "succeeded";
    const renderedExtractionValid =
      page.renderedExtraction === null || renderedExtractionStatus === "succeeded";
    if (
      extractionValid &&
      renderedExtractionValid &&
      (graphProvenanceValid || (page.links.length === 0 && page.resources.length === 0))
    ) {
      return page;
    }
    if (
      page.extraction === null &&
      page.renderedExtraction === null &&
      page.links.length === 0 &&
      page.resources.length === 0
    ) {
      return page;
    }
    changed = true;
    return Object.freeze({
      ...page,
      extraction: extractionValid ? page.extraction : null,
      renderedExtraction: renderedExtractionValid ? page.renderedExtraction : null,
      links: graphProvenanceValid ? page.links : Object.freeze([]),
      resources: graphProvenanceValid ? page.resources : Object.freeze([]),
    });
  });
  return changed ? Object.freeze({ ...snapshot, pages: Object.freeze(pages) }) : snapshot;
}

export class VersionedAuditEngine {
  readonly #catalogVersion: string;
  readonly #policy: AuditEnginePolicy;
  readonly #rules: readonly AuditRuleDefinition[];

  constructor(
    rules: readonly AuditRuleDefinition[],
    policy: AuditEnginePolicy = DEFAULT_AUDIT_ENGINE_POLICY,
    catalogVersion = M4A_CATALOG_VERSION,
  ) {
    if (catalogVersion.trim().length === 0) {
      throw new TypeError("Audit catalog version must be nonempty.");
    }
    this.#catalogVersion = catalogVersion;
    this.#rules = validateCatalog(rules);
    this.#policy = Object.freeze({ ...policy });
  }

  definitions(): readonly AuditRuleDefinition[] {
    return this.#rules;
  }

  evaluate(snapshot: AuditCrawlSnapshot): AuditEvaluationReport {
    const safeSnapshot = enforceExtractionProvenance(snapshot);
    const snapshotPages = indexSnapshotPages(safeSnapshot);
    const results: AuditRuleResult[] = [];
    const failures: AuditEvaluationFailure[] = [];

    for (const definition of this.#rules) {
      let outcomes: readonly AuditRuleOutcome[];
      try {
        outcomes = definition.evaluate(safeSnapshot, this.#policy);
      } catch (cause) {
        const failure = evaluationFailure(
          definition,
          safeSnapshot,
          snapshotPages,
          "detector-error",
          cause,
        );
        results.push(failure.result);
        failures.push(failure.failure);
        continue;
      }

      try {
        if (outcomes.length === 0) {
          throw new TypeError(`Rule ${definition.id} returned no coverage result.`);
        }
        results.push(
          ...outcomes
            .map((outcome) => normalizeOutcome(definition, outcome, snapshotPages))
            .sort((left, right) => left.target.key.localeCompare(right.target.key)),
        );
      } catch (cause) {
        const failure = evaluationFailure(
          definition,
          safeSnapshot,
          snapshotPages,
          "invalid-result",
          cause,
        );
        results.push(failure.result);
        failures.push(failure.failure);
      }
    }

    const eligible = results.filter((result) => result.eligibility.state === "eligible").length;
    const notChecked = results.filter((result) => result.status === "not-checked").length;
    const passed = results.filter((result) => result.status === "passed").length;
    const failed = results.filter((result) => result.status === "failed").length;
    const warning = results.filter((result) => result.status === "warning").length;
    const opportunity = results.filter((result) => result.status === "opportunity").length;
    const manualReview = results.filter((result) => result.status === "manual-review").length;

    return Object.freeze({
      engineVersion: AUDIT_ENGINE_VERSION,
      catalogVersion: this.#catalogVersion,
      crawlId: snapshot.crawlId,
      results: Object.freeze(results),
      failures: Object.freeze(failures),
      counts: Object.freeze({
        rules: this.#rules.length,
        results: results.length,
        eligible,
        evaluated: results.length - notChecked,
        failed,
        warning,
        opportunity,
        manualReview,
        passed,
        notChecked,
      }),
    });
  }
}
