import { createHash } from "node:crypto";

import {
  auditEvidenceItemSchema,
  privacySafeAuditPageUrl,
  redactAuditUrlDetails,
  roleHasCapability,
  type AuditEvidenceItem,
  type AuditEvidenceScalar,
  type OrganizationRole,
} from "@searvia/shared-types";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";

import type { SearviaDatabase } from "./client.js";
import { DatabaseDomainError } from "./domain-errors.js";
import type { OrganizationScope } from "./repository.js";
import {
  auditEvaluationRuns,
  auditFindingOccurrences,
  auditFindings,
  auditLogs,
  auditRules,
  auditRuleVersions,
  crawlPages,
  crawls,
  memberships,
  organizations,
  projects,
  sessions,
  type StoredAuditRuleManifestEntry,
} from "./schema.js";

export type AuditRuleScope = "page" | "site";
export type AuditSeverity =
  "critical" | "high" | "medium" | "low" | "opportunity" | "manual-review";
export type AuditEligibility = "eligible" | "ineligible" | "unavailable";
export type AuditEvaluationResultStatus =
  "passed" | "failed" | "warning" | "opportunity" | "manual-review" | "not-checked";
export type AuditConfidence = "high" | "medium" | "low";
export type AuditFindingLifecycle = "new" | "existing" | "returned" | "fixed" | "not-evaluated";
export type AuditFindingDisposition = "open" | "ignored" | "accepted-risk";
export type AuditReportHashIntegrity = "verified" | "legacy-unverifiable";
export type AuditFindingEffectiveState =
  AuditFindingLifecycle | Exclude<AuditFindingDisposition, "open">;

export interface AuditRuleVersionRegistration {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly defaultSeverity: AuditSeverity;
  readonly defaultConfidence: AuditConfidence;
  readonly scope: AuditRuleScope;
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

export interface AuditEvaluationResultInput {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly scope: AuditRuleScope;
  readonly scopeKey: string;
  readonly pageId?: string | null;
  readonly normalizedUrl?: string | null;
  readonly eligibility: AuditEligibility;
  readonly status: AuditEvaluationResultStatus;
  readonly severity: AuditSeverity;
  readonly confidence: AuditConfidence | null;
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

export interface PersistAuditEvaluationReportInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly engineVersion: number;
  readonly definitions: readonly AuditRuleVersionRegistration[];
  readonly results: readonly AuditEvaluationResultInput[];
  readonly now?: Date;
}

export interface AuditEvaluationRunRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly engineVersion: number;
  readonly catalogHash: string;
  readonly reportHash: string;
  readonly reportHashIntegrity: AuditReportHashIntegrity;
  readonly status: "completed" | "partially-completed";
  readonly resultCount: number;
  readonly eligibleCount: number;
  readonly evaluatedCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly warningCount: number;
  readonly opportunityCount: number;
  readonly manualReviewCount: number;
  readonly notCheckedCount: number;
  readonly ruleErrorCount: number;
  readonly snapshotAt: Date;
  readonly finishedAt: Date;
}

export interface AuditFindingRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly ruleId: string;
  readonly scope: AuditRuleScope;
  readonly scopeKey: string;
  readonly normalizedUrl: string | null;
  readonly lifecycle: AuditFindingLifecycle;
  readonly disposition: AuditFindingDisposition;
  readonly effectiveState: AuditFindingEffectiveState;
  readonly severity: AuditSeverity;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly lastEvaluatedAt: Date;
  readonly lastFixedAt: Date | null;
  readonly dispositionReason: string | null;
}

export interface SetAuditFindingDispositionInput {
  readonly disposition: AuditFindingDisposition;
  readonly reason?: string | null;
  readonly traceId: string;
  readonly now?: Date;
}

type Transaction = Parameters<Parameters<SearviaDatabase["transaction"]>[0]>[0];
type StoredSeverity = typeof auditRuleVersions.$inferInsert.defaultSeverity;
type StoredResultStatus = typeof auditFindingOccurrences.$inferInsert.resultStatus;
type StoredLifecycle = NonNullable<typeof auditFindingOccurrences.$inferInsert.lifecycle>;

interface NormalizedRuleDefinition {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly defaultSeverity: StoredSeverity;
  readonly defaultConfidence: AuditConfidence;
  readonly scope: AuditRuleScope;
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
  readonly definitionHash: string;
}

interface NormalizedEvaluationResult {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly scope: AuditRuleScope;
  readonly scopeKey: string;
  readonly scopeKeyHash: string;
  readonly pageId: string | null;
  readonly normalizedUrl: string | null;
  readonly coverageOnly: boolean;
  readonly eligibility: AuditEligibility;
  readonly status: StoredResultStatus;
  readonly severity: StoredSeverity;
  readonly confidence: AuditConfidence | null;
  readonly missingData: readonly string[];
  readonly notEvaluatedReasonCode: string | null;
  readonly notEvaluatedReason: string | null;
  readonly evidenceVersion: number;
  readonly evidence: readonly unknown[];
  readonly detectedValue: unknown | null;
  readonly expectedValue: unknown | null;
  readonly explanation: string;
  readonly recommendedFix: string;
}

const RULE_ID_PATTERN = /^[A-Z]{3,4}-[0-9]{3}$/u;
const ISSUE_STATUSES = new Set<StoredResultStatus>([
  "failed",
  "warning",
  "opportunity",
  "manual_review",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalValue(value: unknown, path = "$", seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${path} must not contain circular values.`);
    seen.add(value);
    const normalized = value.map((entry, index) =>
      canonicalValue(entry, `${path}[${index}]`, seen),
    );
    seen.delete(value);
    return normalized;
  }
  if (typeof value === "object") {
    const object = value as object;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only JSON objects.`);
    }
    if (seen.has(object)) throw new TypeError(`${path} must not contain circular values.`);
    seen.add(object);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      const entry = Reflect.get(object, key) as unknown;
      if (entry === undefined) throw new TypeError(`${path}.${key} must not be undefined.`);
      normalized[key] = canonicalValue(entry, `${path}.${key}`, seen);
    }
    seen.delete(object);
    return normalized;
  }
  throw new TypeError(`${path} must be JSON serializable.`);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function redactCanonicalStrings(value: unknown): unknown {
  if (typeof value === "string") return redactAuditUrlDetails(value);
  if (Array.isArray(value)) return value.map(redactCanonicalStrings);
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const redactedKey = redactAuditUrlDetails(key);
      if (Object.hasOwn(redacted, redactedKey)) {
        throw new TypeError("Audit value keys collide after sensitive URL details are removed.");
      }
      redacted[redactedKey] = redactCanonicalStrings(entry);
    }
    return redacted;
  }
  return value;
}

function redactEvidenceScalar(value: AuditEvidenceScalar): AuditEvidenceScalar {
  return typeof value === "string" ? redactAuditUrlDetails(value) : value;
}

function normalizeEvidence(
  input: readonly unknown[],
  ruleId: string,
): readonly AuditEvidenceItem[] {
  return Object.freeze(
    input.map((item, index) => {
      const parsed = auditEvidenceItemSchema.safeParse(item);
      if (!parsed.success) {
        throw new TypeError(`Audit result ${ruleId} has invalid evidence item ${String(index)}.`);
      }
      if (redactAuditUrlDetails(parsed.data.observationId) !== parsed.data.observationId) {
        throw new TypeError(`Audit result ${ruleId} has an unsafe evidence observation ID.`);
      }
      const value = Array.isArray(parsed.data.value)
        ? Object.freeze(parsed.data.value.map(redactEvidenceScalar))
        : redactEvidenceScalar(parsed.data.value);
      return Object.freeze({
        kind: parsed.data.kind,
        source: parsed.data.source,
        observationId: parsed.data.observationId,
        observedAt: parsed.data.observedAt,
        field: parsed.data.field,
        value,
        ...(parsed.data.url === undefined ? {} : { url: redactAuditUrlDetails(parsed.data.url) }),
        ...(parsed.data.excerpt === undefined
          ? {}
          : { excerpt: redactAuditUrlDetails(parsed.data.excerpt) }),
      });
    }),
  );
}

function boundedText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > max || /\p{Cc}/u.test(normalized)) {
    throw new TypeError(`${name} must contain 1 to ${String(max)} visible characters.`);
  }
  return normalized;
}

function boundedStringSet(
  values: readonly string[],
  name: string,
  maximumCount: number,
  maximumItemLength: number,
): readonly string[] {
  if (values.length < 1 || values.length > maximumCount) {
    throw new TypeError(`${name} must contain 1 to ${String(maximumCount)} values.`);
  }
  const normalized = [
    ...new Set(values.map((value) => boundedText(value, name, maximumItemLength))),
  ].sort();
  if (normalized.length < 1) throw new TypeError(`${name} must not be empty.`);
  return Object.freeze(normalized);
}

function storedSeverity(value: AuditSeverity): StoredSeverity {
  return value === "manual-review" ? "manual_review" : value;
}

function publicSeverity(value: StoredSeverity): AuditSeverity {
  return value === "manual_review" ? "manual-review" : value;
}

function storedResultStatus(value: AuditEvaluationResultStatus): StoredResultStatus {
  if (value === "manual-review") return "manual_review";
  if (value === "not-checked") return "not_checked";
  return value;
}

function publicLifecycle(value: StoredLifecycle): AuditFindingLifecycle {
  return value === "not_evaluated" ? "not-evaluated" : value;
}

function storedDisposition(
  value: AuditFindingDisposition,
): typeof auditFindings.$inferInsert.disposition {
  return value === "accepted-risk" ? "accepted_risk" : value;
}

function publicDisposition(
  value: typeof auditFindings.$inferSelect.disposition,
): AuditFindingDisposition {
  return value === "accepted_risk" ? "accepted-risk" : value;
}

function definitionForHash(input: Omit<NormalizedRuleDefinition, "definitionHash">): unknown {
  return input;
}

function normalizeRuleDefinitions(
  definitions: readonly AuditRuleVersionRegistration[],
  oneVersionPerRule: boolean,
): readonly NormalizedRuleDefinition[] {
  if (definitions.length < 1 || definitions.length > 500) {
    throw new TypeError("An audit catalog must contain 1 to 500 rule versions.");
  }
  const seenVersions = new Set<string>();
  const seenRules = new Set<string>();
  const normalized = definitions.map((definition) => {
    const id = definition.id.trim();
    if (!RULE_ID_PATTERN.test(id)) throw new TypeError(`Invalid audit rule ID: ${id}`);
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new TypeError(`Audit rule ${id} must have a positive integer version.`);
    }
    const versionKey = `${id}@${String(definition.version)}`;
    if (seenVersions.has(versionKey)) {
      throw new DatabaseDomainError("CONFLICT", `Duplicate audit rule version: ${versionKey}`);
    }
    if (oneVersionPerRule && seenRules.has(id)) {
      throw new DatabaseDomainError(
        "CONFLICT",
        `An evaluation catalog may select only one version of ${id}.`,
      );
    }
    seenVersions.add(versionKey);
    seenRules.add(id);
    if (definition.deterministic !== true) {
      throw new TypeError(`Audit rule ${id} must declare deterministic evaluation.`);
    }
    const withoutHash = Object.freeze({
      id,
      version: definition.version,
      title: boundedText(definition.title, `${id} title`, 240),
      description: boundedText(definition.description, `${id} description`, 8_000),
      category: boundedText(definition.category, `${id} category`, 80),
      defaultSeverity: storedSeverity(definition.defaultSeverity),
      defaultConfidence: definition.defaultConfidence,
      scope: definition.scope,
      deterministic: definition.deterministic,
      eligibilityDescription: boundedText(
        definition.eligibilityDescription,
        `${id} eligibility description`,
        4_000,
      ),
      requiredData: boundedStringSet(definition.requiredData, `${id} required data`, 64, 240),
      explanation: boundedText(definition.explanation, `${id} explanation`, 8_000),
      expectedValue: boundedText(definition.expectedValue, `${id} expected value`, 8_000),
      recommendedFix: boundedText(definition.recommendedFix, `${id} recommended fix`, 8_000),
      verificationMethod: boundedText(
        definition.verificationMethod,
        `${id} verification method`,
        4_000,
      ),
      impactAreas: boundedStringSet(definition.impactAreas, `${id} impact areas`, 16, 120),
      responsibleOwner: boundedText(definition.responsibleOwner, `${id} responsible owner`, 120),
      firstSupportedVersion: boundedText(
        definition.firstSupportedVersion,
        `${id} first supported version`,
        120,
      ),
    });
    return Object.freeze({
      ...withoutHash,
      definitionHash: sha256(canonicalJson(definitionForHash(withoutHash))),
    });
  });
  return Object.freeze(
    normalized.sort(
      (left, right) => left.id.localeCompare(right.id) || left.version - right.version,
    ),
  );
}

function normalizeEvaluationResults(
  results: readonly AuditEvaluationResultInput[],
  definitions: ReadonlyMap<string, NormalizedRuleDefinition>,
): readonly NormalizedEvaluationResult[] {
  if (results.length < 1 || results.length > 100_000) {
    throw new TypeError("An audit report must contain 1 to 100000 rule results.");
  }
  const identities = new Map<string, string>();
  const normalized = results.map((result) => {
    const definition = definitions.get(result.ruleId);
    if (definition === undefined || definition.version !== result.ruleVersion) {
      throw new DatabaseDomainError(
        "CONFLICT",
        `Audit result ${result.ruleId}@${String(result.ruleVersion)} is not in the catalog.`,
      );
    }
    if (result.scope !== definition.scope) {
      throw new DatabaseDomainError(
        "CONFLICT",
        `Audit result ${result.ruleId} does not match its registered scope.`,
      );
    }
    const scopeKey = boundedText(result.scopeKey, `${result.ruleId} scope key`, 4_096);
    const scopeKeyHash = sha256(scopeKey);
    const identityKey = `${result.ruleId}:${scopeKeyHash}`;
    const existingScopeKey = identities.get(identityKey);
    if (existingScopeKey !== undefined) {
      if (existingScopeKey !== scopeKey) {
        throw new DatabaseDomainError(
          "CONFLICT",
          "An audit scope-key hash collision was detected.",
        );
      }
      throw new DatabaseDomainError(
        "CONFLICT",
        `Duplicate audit result identity: ${result.ruleId} ${scopeKey}`,
      );
    }
    identities.set(identityKey, scopeKey);
    const pageId = result.pageId ?? null;
    const normalizedUrl = result.normalizedUrl ?? null;
    const status = storedResultStatus(result.status);
    const coverageOnly =
      result.scope === "page" &&
      pageId === null &&
      normalizedUrl === null &&
      status === "not_checked" &&
      result.eligibility !== "eligible";
    if (
      (result.scope === "page" &&
        !coverageOnly &&
        (pageId === null || normalizedUrl === null || normalizedUrl !== scopeKey)) ||
      (result.scope === "site" && (pageId !== null || normalizedUrl !== null))
    ) {
      throw new TypeError(`${result.ruleId} has an invalid ${result.scope} result target.`);
    }
    const reasonCode = result.notEvaluatedReasonCode ?? null;
    const reason = result.notEvaluatedReason ?? null;
    const missingDataInput = result.missingData ?? [];
    if (missingDataInput.length > 64) {
      throw new TypeError(`${result.ruleId} missing data must contain at most 64 values.`);
    }
    const missingData =
      missingDataInput.length === 0
        ? Object.freeze([])
        : boundedStringSet(missingDataInput, `${result.ruleId} missing data`, 64, 240);
    const undeclaredMissingData = missingData.filter(
      (value) => !definition.requiredData.includes(value),
    );
    if (undeclaredMissingData.length > 0) {
      throw new DatabaseDomainError(
        "CONFLICT",
        `Audit result ${result.ruleId} reports missing data outside its immutable rule contract: ${undeclaredMissingData.join(", ")}.`,
      );
    }
    if (status === "not_checked") {
      if (
        result.eligibility === "eligible" ||
        result.confidence !== null ||
        reasonCode === null ||
        reason === null
      ) {
        throw new TypeError(
          `${result.ruleId} not-checked results require ineligible or unavailable eligibility, a reason, and no confidence.`,
        );
      }
    } else if (
      result.eligibility !== "eligible" ||
      result.confidence === null ||
      missingData.length > 0 ||
      reasonCode !== null ||
      reason !== null
    ) {
      throw new TypeError(
        `${result.ruleId} evaluated results must be eligible, confident, and have no unavailable-data reason.`,
      );
    }
    const evidenceVersion = result.evidenceVersion ?? 1;
    if (!Number.isInteger(evidenceVersion) || evidenceVersion < 1) {
      throw new TypeError(`${result.ruleId} evidence version must be a positive integer.`);
    }
    if (
      !Array.isArray(result.evidence) ||
      result.evidence.length < 1 ||
      result.evidence.length > 100
    ) {
      throw new TypeError(`${result.ruleId} evidence must contain 1 to 100 records.`);
    }
    const evidence = normalizeEvidence(result.evidence, result.ruleId);
    const detectedValue =
      result.detectedValue === undefined
        ? null
        : redactCanonicalStrings(
            canonicalValue(result.detectedValue, `${result.ruleId}.detectedValue`),
          );
    const expectedValue =
      result.expectedValue === undefined
        ? null
        : redactCanonicalStrings(
            canonicalValue(result.expectedValue, `${result.ruleId}.expectedValue`),
          );
    if (Buffer.byteLength(canonicalJson(evidence)) > 131_072) {
      throw new TypeError(`${result.ruleId} evidence exceeds 131072 bytes.`);
    }
    if (detectedValue !== null && Buffer.byteLength(canonicalJson(detectedValue)) > 32_768) {
      throw new TypeError(`${result.ruleId} detected value exceeds 32768 bytes.`);
    }
    if (expectedValue !== null && Buffer.byteLength(canonicalJson(expectedValue)) > 32_768) {
      throw new TypeError(`${result.ruleId} expected value exceeds 32768 bytes.`);
    }
    const severity = storedSeverity(result.severity);
    const explanation = boundedText(
      result.explanation,
      `${result.ruleId} result explanation`,
      8_000,
    );
    const recommendedFix = boundedText(
      result.recommendedFix,
      `${result.ruleId} result recommended fix`,
      8_000,
    );
    if (
      severity !== definition.defaultSeverity ||
      explanation !== definition.explanation ||
      recommendedFix !== definition.recommendedFix
    ) {
      throw new DatabaseDomainError(
        "CONFLICT",
        `Audit result ${result.ruleId} does not match its immutable severity, explanation, or recommended fix.`,
      );
    }
    return Object.freeze({
      ruleId: result.ruleId,
      ruleVersion: result.ruleVersion,
      scope: result.scope,
      scopeKey,
      scopeKeyHash,
      pageId,
      normalizedUrl,
      coverageOnly,
      eligibility: result.eligibility,
      status,
      severity,
      confidence: result.confidence,
      missingData,
      notEvaluatedReasonCode:
        reasonCode === null ? null : boundedText(reasonCode, `${result.ruleId} reason code`, 120),
      notEvaluatedReason:
        reason === null
          ? null
          : boundedText(redactAuditUrlDetails(reason), `${result.ruleId} reason`, 2_000),
      evidenceVersion,
      evidence,
      detectedValue,
      expectedValue,
      explanation,
      recommendedFix,
    });
  });
  const coveredRuleIds = new Set(normalized.map((result) => result.ruleId));
  const missingRuleIds = [...definitions.keys()].filter((ruleId) => !coveredRuleIds.has(ruleId));
  if (missingRuleIds.length > 0) {
    throw new DatabaseDomainError(
      "CONFLICT",
      `Audit report is missing coverage for ${missingRuleIds.join(", ")}.`,
    );
  }
  return Object.freeze(
    normalized.sort(
      (left, right) =>
        left.ruleId.localeCompare(right.ruleId) || left.scopeKey.localeCompare(right.scopeKey),
    ),
  );
}

function manifestFor(
  definitions: readonly NormalizedRuleDefinition[],
): readonly StoredAuditRuleManifestEntry[] {
  return Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        ruleId: definition.id,
        ruleVersion: definition.version,
        definitionHash: definition.definitionHash,
      }),
    ),
  );
}

function publicRun(row: typeof auditEvaluationRuns.$inferSelect): AuditEvaluationRunRecord {
  if (
    (row.status !== "completed" && row.status !== "partially_completed") ||
    row.finishedAt === null
  ) {
    throw new Error("The audit evaluation run is not complete.");
  }
  return Object.freeze({
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    crawlId: row.crawlId,
    engineVersion: row.engineVersion,
    catalogHash: row.catalogHash,
    reportHash: row.reportHash,
    reportHashIntegrity:
      row.reportHashIntegrity === "legacy_unverifiable" ? "legacy-unverifiable" : "verified",
    status: row.status === "partially_completed" ? "partially-completed" : "completed",
    resultCount: row.resultCount,
    eligibleCount: row.eligibleCount,
    evaluatedCount: row.evaluatedCount,
    passedCount: row.passedCount,
    failedCount: row.failedCount,
    warningCount: row.warningCount,
    opportunityCount: row.opportunityCount,
    manualReviewCount: row.manualReviewCount,
    notCheckedCount: row.notCheckedCount,
    ruleErrorCount: row.ruleErrorCount,
    snapshotAt: row.snapshotAt,
    finishedAt: row.finishedAt,
  });
}

function publicFinding(row: typeof auditFindings.$inferSelect): AuditFindingRecord {
  const lifecycle = publicLifecycle(row.currentLifecycle);
  const disposition = publicDisposition(row.disposition);
  const effectiveState =
    disposition !== "open" && ["new", "existing", "returned"].includes(lifecycle)
      ? disposition
      : lifecycle;
  return Object.freeze({
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    ruleId: row.ruleId,
    scope: row.scope,
    scopeKey: row.scopeKey,
    normalizedUrl: row.normalizedUrl,
    lifecycle,
    disposition,
    effectiveState,
    severity: publicSeverity(row.severity),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastEvaluatedAt: row.lastEvaluatedAt,
    lastFixedAt: row.lastFixedAt,
    dispositionReason:
      row.dispositionReason === null ? null : redactAuditUrlDetails(row.dispositionReason),
  });
}

async function registerDefinitions(
  transaction: Transaction,
  definitions: readonly NormalizedRuleDefinition[],
): Promise<void> {
  for (const definition of definitions) {
    await transaction.insert(auditRules).values({ id: definition.id }).onConflictDoNothing();
    await transaction
      .insert(auditRuleVersions)
      .values({
        ruleId: definition.id,
        version: definition.version,
        title: definition.title,
        description: definition.description,
        category: definition.category,
        defaultSeverity: definition.defaultSeverity,
        defaultConfidence: definition.defaultConfidence,
        scope: definition.scope,
        deterministic: definition.deterministic,
        eligibilityDescription: definition.eligibilityDescription,
        requiredData: [...definition.requiredData],
        explanation: definition.explanation,
        expectedValue: definition.expectedValue,
        recommendedFix: definition.recommendedFix,
        verificationMethod: definition.verificationMethod,
        impactAreas: [...definition.impactAreas],
        responsibleOwner: definition.responsibleOwner,
        firstSupportedVersion: definition.firstSupportedVersion,
        definitionHash: definition.definitionHash,
      })
      .onConflictDoNothing();
    const [stored] = await transaction
      .select()
      .from(auditRuleVersions)
      .where(
        and(
          eq(auditRuleVersions.ruleId, definition.id),
          eq(auditRuleVersions.version, definition.version),
        ),
      )
      .limit(1);
    if (stored === undefined || stored.definitionHash !== definition.definitionHash) {
      throw new DatabaseDomainError(
        "CONFLICT",
        `Audit rule ${definition.id}@${String(definition.version)} changed without a version bump.`,
      );
    }
  }
}

function reportCounters(results: readonly NormalizedEvaluationResult[]) {
  const count = (status: StoredResultStatus): number =>
    results.filter((result) => result.status === status).length;
  const passedCount = count("passed");
  const failedCount = count("failed");
  const warningCount = count("warning");
  const opportunityCount = count("opportunity");
  const manualReviewCount = count("manual_review");
  const notCheckedCount = count("not_checked");
  const evaluatedCount =
    passedCount + failedCount + warningCount + opportunityCount + manualReviewCount;
  const eligibleCount = results.filter((result) => result.eligibility === "eligible").length;
  const ruleErrorCount = results.filter(
    (result) =>
      result.status === "not_checked" && result.notEvaluatedReasonCode === "detector_error",
  ).length;
  return Object.freeze({
    resultCount: results.length,
    eligibleCount,
    evaluatedCount,
    passedCount,
    failedCount,
    warningCount,
    opportunityCount,
    manualReviewCount,
    notCheckedCount,
    ruleErrorCount,
  });
}

function findingIdentity(ruleId: string, scopeKeyHash: string): string {
  return `${ruleId}:${scopeKeyHash}`;
}

/**
 * Lifecycle columns are derived from immutable result statuses. Rebuilding the
 * derived links/projection in crawl-snapshot order lets delayed jobs arrive in
 * any order without changing an evaluation run or regressing the current view.
 */
async function reconcileFindingHistory(
  transaction: Transaction,
  scope: Readonly<{ organizationId: string; projectId: string }>,
  now: Date,
): Promise<void> {
  const [latestRun] = await transaction
    .select({
      id: auditEvaluationRuns.id,
      crawlId: auditEvaluationRuns.crawlId,
      ruleManifest: auditEvaluationRuns.ruleManifest,
      snapshotAt: auditEvaluationRuns.snapshotAt,
    })
    .from(auditEvaluationRuns)
    .where(
      and(
        eq(auditEvaluationRuns.organizationId, scope.organizationId),
        eq(auditEvaluationRuns.projectId, scope.projectId),
      ),
    )
    .orderBy(desc(auditEvaluationRuns.snapshotAt), desc(auditEvaluationRuns.crawlId))
    .limit(1);
  if (latestRun === undefined) return;

  const findings = await transaction
    .select()
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.organizationId, scope.organizationId),
        eq(auditFindings.projectId, scope.projectId),
      ),
    )
    .for("update");
  if (findings.length === 0) return;

  const occurrences = await transaction
    .select({
      id: auditFindingOccurrences.id,
      evaluationRunId: auditFindingOccurrences.evaluationRunId,
      findingId: auditFindingOccurrences.findingId,
      lifecycle: auditFindingOccurrences.lifecycle,
      resultStatus: auditFindingOccurrences.resultStatus,
      ruleId: auditFindingOccurrences.ruleId,
      scopeKeyHash: auditFindingOccurrences.scopeKeyHash,
      severity: auditFindingOccurrences.severity,
      crawlId: auditEvaluationRuns.crawlId,
      snapshotAt: auditEvaluationRuns.snapshotAt,
    })
    .from(auditFindingOccurrences)
    .innerJoin(
      auditEvaluationRuns,
      and(
        eq(auditEvaluationRuns.organizationId, auditFindingOccurrences.organizationId),
        eq(auditEvaluationRuns.projectId, auditFindingOccurrences.projectId),
        eq(auditEvaluationRuns.crawlId, auditFindingOccurrences.crawlId),
        eq(auditEvaluationRuns.id, auditFindingOccurrences.evaluationRunId),
      ),
    )
    .where(
      and(
        eq(auditFindingOccurrences.organizationId, scope.organizationId),
        eq(auditFindingOccurrences.projectId, scope.projectId),
      ),
    )
    .orderBy(
      asc(auditEvaluationRuns.snapshotAt),
      asc(auditEvaluationRuns.crawlId),
      asc(auditFindingOccurrences.id),
    );
  const histories = new Map<string, typeof occurrences>();
  for (const occurrence of occurrences) {
    const key = findingIdentity(occurrence.ruleId, occurrence.scopeKeyHash);
    const history = histories.get(key) ?? [];
    history.push(occurrence);
    histories.set(key, history);
  }
  const latestRuleIds = new Set(latestRun.ruleManifest.map((entry) => entry.ruleId));

  for (const finding of findings) {
    const history = histories.get(findingIdentity(finding.ruleId, finding.scopeKeyHash)) ?? [];
    let seenIssue = false;
    let firstSeenAt: Date | null = null;
    let lastSeenAt: Date | null = null;
    let lastFixedAt: Date | null = null;
    let lastEligibleResultStatus: StoredResultStatus | null = null;
    let lastEligibleSeverity: StoredSeverity | null = null;
    let lastDerivedLifecycle: StoredLifecycle | null = null;
    let lastHistoryAt: Date | null = null;
    let latestLifecycle: StoredLifecycle | null = null;

    for (const occurrence of history) {
      let lifecycle: StoredLifecycle | null;
      let findingId: string | null;
      if (ISSUE_STATUSES.has(occurrence.resultStatus)) {
        lifecycle = !seenIssue
          ? "new"
          : lastEligibleResultStatus === "passed"
            ? "returned"
            : "existing";
        findingId = finding.id;
        seenIssue = true;
        firstSeenAt ??= occurrence.snapshotAt;
        lastSeenAt = occurrence.snapshotAt;
        lastEligibleResultStatus = occurrence.resultStatus;
        lastEligibleSeverity = occurrence.severity;
      } else if (occurrence.resultStatus === "passed") {
        lifecycle = seenIssue ? "fixed" : null;
        findingId = seenIssue ? finding.id : null;
        if (seenIssue) lastFixedAt = occurrence.snapshotAt;
        lastEligibleResultStatus = occurrence.resultStatus;
        lastEligibleSeverity = occurrence.severity;
      } else {
        lifecycle = "not_evaluated";
        findingId = seenIssue ? finding.id : null;
      }

      if (occurrence.lifecycle !== lifecycle || occurrence.findingId !== findingId) {
        await transaction
          .update(auditFindingOccurrences)
          .set({ lifecycle, findingId })
          .where(
            and(
              eq(auditFindingOccurrences.organizationId, scope.organizationId),
              eq(auditFindingOccurrences.projectId, scope.projectId),
              eq(auditFindingOccurrences.id, occurrence.id),
            ),
          );
      }
      lastDerivedLifecycle = lifecycle;
      lastHistoryAt = occurrence.snapshotAt;
      if (occurrence.evaluationRunId === latestRun.id) latestLifecycle = lifecycle;
    }

    if (
      !seenIssue ||
      firstSeenAt === null ||
      lastSeenAt === null ||
      lastEligibleResultStatus === null ||
      lastEligibleSeverity === null ||
      lastHistoryAt === null
    ) {
      throw new Error("An audit finding has no issue occurrence history.");
    }

    let currentLifecycle: StoredLifecycle;
    let lastEvaluatedAt: Date;
    if (latestRuleIds.has(finding.ruleId)) {
      if (latestLifecycle !== null) {
        currentLifecycle = latestLifecycle;
        lastEvaluatedAt = latestRun.snapshotAt;
      } else if (lastEligibleResultStatus === "passed") {
        currentLifecycle = "fixed";
        lastEvaluatedAt = lastHistoryAt;
      } else {
        currentLifecycle = "not_evaluated";
        lastEvaluatedAt = latestRun.snapshotAt;
      }
    } else {
      currentLifecycle = lastDerivedLifecycle ?? finding.currentLifecycle;
      lastEvaluatedAt = lastHistoryAt;
    }

    if (currentLifecycle === "fixed" && lastFixedAt === null) {
      throw new Error("A fixed audit finding has no fixing occurrence.");
    }
    await transaction
      .update(auditFindings)
      .set({
        currentLifecycle,
        severity: lastEligibleSeverity,
        lastEligibleResultStatus,
        firstSeenAt,
        lastSeenAt,
        lastEvaluatedAt,
        lastFixedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(auditFindings.organizationId, scope.organizationId),
          eq(auditFindings.projectId, scope.projectId),
          eq(auditFindings.id, finding.id),
        ),
      );
  }
}

async function requireDispositionProject(
  transaction: Transaction,
  scope: OrganizationScope,
  projectId: string,
): Promise<void> {
  const now = new Date();
  const [actor] = await transaction
    .select({ role: memberships.role })
    .from(sessions)
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, scope.membership.id),
        eq(memberships.organizationId, scope.organization.id),
        eq(memberships.userId, sessions.userId),
        eq(memberships.status, "active"),
      ),
    )
    .innerJoin(
      organizations,
      and(eq(organizations.id, memberships.organizationId), isNull(organizations.deletedAt)),
    )
    .where(
      and(
        eq(sessions.id, scope.sessionId),
        eq(sessions.userId, scope.userId),
        eq(sessions.activeOrganizationId, scope.organization.id),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1)
    .for("share", { of: [sessions, memberships, organizations] });
  if (actor === undefined) {
    throw new DatabaseDomainError("UNAUTHENTICATED", "Your session is no longer active.");
  }
  if (!roleHasCapability(actor.role as OrganizationRole, "project:update")) {
    throw new DatabaseDomainError("FORBIDDEN", "You do not have permission for this action.");
  }
  const [project] = await transaction
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, scope.organization.id),
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (project === undefined) throw new DatabaseDomainError("NOT_FOUND", "Project not found.");
}

export class SearviaAuditRepository {
  readonly #db: SearviaDatabase;

  constructor(database: SearviaDatabase) {
    this.#db = database;
  }

  async registerRuleVersions(
    definitions: readonly AuditRuleVersionRegistration[],
  ): Promise<readonly StoredAuditRuleManifestEntry[]> {
    const normalized = normalizeRuleDefinitions(definitions, false);
    await this.#db.transaction((transaction) => registerDefinitions(transaction, normalized));
    return manifestFor(normalized);
  }

  async hasTerminalEvaluationRun(
    scope: Readonly<{ organizationId: string; projectId: string; crawlId: string }>,
  ): Promise<boolean> {
    const [run] = await this.#db
      .select({ id: auditEvaluationRuns.id })
      .from(auditEvaluationRuns)
      .where(
        and(
          eq(auditEvaluationRuns.organizationId, scope.organizationId),
          eq(auditEvaluationRuns.projectId, scope.projectId),
          eq(auditEvaluationRuns.crawlId, scope.crawlId),
          inArray(auditEvaluationRuns.status, ["completed", "partially_completed"]),
        ),
      )
      .limit(1);
    return run !== undefined;
  }

  async persistEvaluationReport(
    input: PersistAuditEvaluationReportInput,
  ): Promise<AuditEvaluationRunRecord> {
    if (!Number.isInteger(input.engineVersion) || input.engineVersion < 1) {
      throw new TypeError("The audit engine version must be a positive integer.");
    }
    const definitions = normalizeRuleDefinitions(input.definitions, true);
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
    const results = normalizeEvaluationResults(input.results, definitionById);
    const manifest = manifestFor(definitions);
    const catalogHash = sha256(canonicalJson(manifest));
    const reportHash = sha256(
      canonicalJson({
        engineVersion: input.engineVersion,
        catalogHash,
        results,
      }),
    );
    const now = input.now ?? new Date();
    const counters = reportCounters(results);

    return this.#db.transaction(async (transaction) => {
      await registerDefinitions(transaction, definitions);
      const [project] = await transaction
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, input.organizationId),
            eq(projects.id, input.projectId),
            isNull(projects.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (project === undefined) throw new DatabaseDomainError("NOT_FOUND", "Project not found.");

      const [crawl] = await transaction
        .select({
          id: crawls.id,
          status: crawls.status,
          finishedAt: crawls.finishedAt,
        })
        .from(crawls)
        .where(
          and(
            eq(crawls.organizationId, input.organizationId),
            eq(crawls.projectId, input.projectId),
            eq(crawls.id, input.crawlId),
          ),
        )
        .limit(1);
      if (crawl === undefined) throw new DatabaseDomainError("NOT_FOUND", "Crawl not found.");
      if (
        (crawl.status !== "completed" && crawl.status !== "partially_completed") ||
        crawl.finishedAt === null
      ) {
        throw new DatabaseDomainError(
          "CONFLICT",
          "Audit rules require a completed or partially completed crawl snapshot.",
        );
      }

      const [existingRun] = await transaction
        .select()
        .from(auditEvaluationRuns)
        .where(
          and(
            eq(auditEvaluationRuns.organizationId, input.organizationId),
            eq(auditEvaluationRuns.projectId, input.projectId),
            eq(auditEvaluationRuns.crawlId, input.crawlId),
          ),
        )
        .limit(1);
      if (existingRun !== undefined) {
        if (existingRun.reportHashIntegrity !== "verified") {
          throw new DatabaseDomainError(
            "CONFLICT",
            "This legacy audit run predates verifiable report-hash provenance and cannot be claimed as an exact replay.",
          );
        }
        if (
          existingRun.engineVersion !== input.engineVersion ||
          existingRun.catalogHash !== catalogHash ||
          existingRun.reportHash !== reportHash ||
          canonicalJson(existingRun.ruleManifest) !== canonicalJson(manifest)
        ) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "This crawl already has a different immutable audit evaluation report.",
          );
        }
        return publicRun(existingRun);
      }

      const pageIds = [
        ...new Set(results.flatMap((result) => (result.pageId === null ? [] : [result.pageId]))),
      ];
      const storedPages =
        pageIds.length === 0
          ? []
          : await transaction
              .select({
                id: crawlPages.id,
                normalizedUrl: crawlPages.normalizedUrl,
                urlHash: crawlPages.urlHash,
              })
              .from(crawlPages)
              .where(
                and(
                  eq(crawlPages.organizationId, input.organizationId),
                  eq(crawlPages.projectId, input.projectId),
                  eq(crawlPages.crawlId, input.crawlId),
                  inArray(crawlPages.id, pageIds),
                ),
              );
      const storedPageById = new Map(storedPages.map((page) => [page.id, page]));
      for (const result of results) {
        if (result.pageId === null) continue;
        const storedPage = storedPageById.get(result.pageId);
        const expectedAuditUrl =
          storedPage === undefined
            ? null
            : privacySafeAuditPageUrl(storedPage.normalizedUrl, storedPage.urlHash);
        if (expectedAuditUrl === null || result.normalizedUrl !== expectedAuditUrl) {
          throw new DatabaseDomainError(
            "NOT_FOUND",
            `Audit page target not found for ${result.ruleId}.`,
          );
        }
      }

      const [run] = await transaction
        .insert(auditEvaluationRuns)
        .values({
          organizationId: input.organizationId,
          projectId: input.projectId,
          crawlId: input.crawlId,
          engineVersion: input.engineVersion,
          catalogHash,
          reportHash,
          reportHashIntegrity: "verified",
          ruleManifest: manifest,
          status: "running",
          snapshotAt: crawl.finishedAt,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (run === undefined) throw new Error("Audit evaluation run insert returned no row.");

      for (const result of results) {
        const definition = definitionById.get(result.ruleId);
        if (definition === undefined)
          throw new Error("The audit rule catalog changed unexpectedly.");
        const [storedFinding] = result.coverageOnly
          ? [undefined]
          : await transaction
              .select()
              .from(auditFindings)
              .where(
                and(
                  eq(auditFindings.organizationId, input.organizationId),
                  eq(auditFindings.projectId, input.projectId),
                  eq(auditFindings.ruleId, result.ruleId),
                  eq(auditFindings.scopeKeyHash, result.scopeKeyHash),
                ),
              )
              .limit(1)
              .for("update");
        if (
          storedFinding !== undefined &&
          (storedFinding.scopeKey !== result.scopeKey ||
            storedFinding.scope !== result.scope ||
            storedFinding.normalizedUrl !== result.normalizedUrl)
        ) {
          throw new DatabaseDomainError(
            "CONFLICT",
            "An audit scope-key hash collision was detected.",
          );
        }

        let finding = storedFinding;
        let lifecycle: StoredLifecycle | null;
        if (ISSUE_STATUSES.has(result.status)) {
          if (finding === undefined) {
            [finding] = await transaction
              .insert(auditFindings)
              .values({
                organizationId: input.organizationId,
                projectId: input.projectId,
                ruleId: result.ruleId,
                scope: result.scope,
                scopeKey: result.scopeKey,
                scopeKeyHash: result.scopeKeyHash,
                normalizedUrl: result.normalizedUrl,
                currentLifecycle: "new",
                severity: result.severity,
                lastEligibleResultStatus: result.status,
                firstSeenAt: crawl.finishedAt,
                lastSeenAt: crawl.finishedAt,
                lastEvaluatedAt: crawl.finishedAt,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            if (finding === undefined) throw new Error("Audit finding insert returned no row.");
            lifecycle = "new";
          } else {
            lifecycle = finding.lastEligibleResultStatus === "passed" ? "returned" : "existing";
          }
        } else if (result.status === "passed") {
          if (finding === undefined || finding.firstSeenAt > crawl.finishedAt) {
            finding = undefined;
            lifecycle = null;
          } else {
            lifecycle = "fixed";
          }
        } else {
          lifecycle = "not_evaluated";
          if (finding !== undefined && finding.firstSeenAt > crawl.finishedAt) finding = undefined;
        }

        await transaction.insert(auditFindingOccurrences).values({
          organizationId: input.organizationId,
          projectId: input.projectId,
          crawlId: input.crawlId,
          evaluationRunId: run.id,
          findingId: finding?.id ?? null,
          ruleId: result.ruleId,
          ruleVersion: result.ruleVersion,
          scope: result.scope,
          scopeKey: result.scopeKey,
          scopeKeyHash: result.scopeKeyHash,
          pageId: result.pageId,
          normalizedUrl: result.normalizedUrl,
          eligibility: result.eligibility,
          resultStatus: result.status,
          lifecycle,
          severity: result.severity,
          confidence: result.confidence,
          missingData: [...result.missingData],
          notEvaluatedReasonCode: result.notEvaluatedReasonCode,
          notEvaluatedReason: result.notEvaluatedReason,
          evidenceVersion: result.evidenceVersion,
          evidence: result.evidence,
          detectedValue: result.detectedValue,
          expectedValue: result.expectedValue,
          explanation: result.explanation,
          recommendedFix: result.recommendedFix,
          impactAreas: [...definition.impactAreas],
          responsibleOwner: definition.responsibleOwner,
          evaluatedAt: now,
          createdAt: now,
        });
      }

      await reconcileFindingHistory(
        transaction,
        { organizationId: input.organizationId, projectId: input.projectId },
        now,
      );

      const status = counters.ruleErrorCount > 0 ? "partially_completed" : "completed";
      const [completed] = await transaction
        .update(auditEvaluationRuns)
        .set({
          ...counters,
          status,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(auditEvaluationRuns.id, run.id))
        .returning();
      if (completed === undefined) throw new Error("Audit evaluation completion returned no row.");
      return publicRun(completed);
    });
  }

  async setFindingDisposition(
    scope: OrganizationScope,
    projectId: string,
    findingId: string,
    input: SetAuditFindingDispositionInput,
  ): Promise<AuditFindingRecord> {
    const disposition = storedDisposition(input.disposition);
    const now = input.now ?? new Date();
    const traceId = boundedText(input.traceId, "Trace ID", 128);
    const reason =
      disposition === "open"
        ? null
        : boundedText(
            redactAuditUrlDetails(input.reason ?? ""),
            "Finding disposition reason",
            2_000,
          );
    return this.#db.transaction(async (transaction) => {
      await requireDispositionProject(transaction, scope, projectId);
      const [finding] = await transaction
        .select()
        .from(auditFindings)
        .where(
          and(
            eq(auditFindings.organizationId, scope.organization.id),
            eq(auditFindings.projectId, projectId),
            eq(auditFindings.id, findingId),
          ),
        )
        .limit(1)
        .for("update");
      if (finding === undefined) throw new DatabaseDomainError("NOT_FOUND", "Finding not found.");
      if (disposition !== "open" && finding.currentLifecycle === "fixed") {
        throw new DatabaseDomainError("CONFLICT", "A fixed finding cannot be ignored or accepted.");
      }
      if (
        finding.disposition === disposition &&
        (disposition === "open" || finding.dispositionReason === reason)
      ) {
        return publicFinding(finding);
      }
      const [updated] = await transaction
        .update(auditFindings)
        .set({
          disposition,
          dispositionReason: reason,
          dispositionByMembershipId: disposition === "open" ? null : scope.membership.id,
          dispositionAt: disposition === "open" ? null : now,
          updatedAt: now,
        })
        .where(
          and(
            eq(auditFindings.organizationId, scope.organization.id),
            eq(auditFindings.projectId, projectId),
            eq(auditFindings.id, findingId),
          ),
        )
        .returning();
      if (updated === undefined) throw new Error("Audit finding disposition returned no row.");
      await transaction.insert(auditLogs).values({
        organizationId: scope.organization.id,
        actorKind: "user",
        actorUserId: scope.userId,
        actorMembershipId: scope.membership.id,
        action:
          disposition === "open"
            ? "finding.reopened"
            : disposition === "ignored"
              ? "finding.ignored"
              : "finding.accepted_risk",
        targetType: "audit_finding",
        targetId: findingId,
        traceId,
        metadataVersion: 2,
        metadata: {
          projectId,
          previousDisposition: finding.disposition,
          previousDispositionReason:
            finding.dispositionReason === null
              ? null
              : redactAuditUrlDetails(finding.dispositionReason),
          disposition,
          dispositionReason: reason,
        },
      });
      return publicFinding(updated);
    });
  }
}

export function createSearviaAuditRepository(database: SearviaDatabase): SearviaAuditRepository {
  return new SearviaAuditRepository(database);
}
